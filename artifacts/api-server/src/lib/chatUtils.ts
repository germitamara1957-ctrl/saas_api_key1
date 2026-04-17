import { eq, sql, and } from "drizzle-orm";
import { db, usersTable, usageLogsTable } from "@workspace/db";
import { calculateChatCost } from "./billing";

// ── Think-tag filter ────────────────────────────────────────────────────────
// Some reasoning models (MiniMax-M2, DeepSeek-R1, Kimi-K2, etc.) emit
// chain-of-thought wrapped in <think>...</think> blocks. We strip these
// before returning the content to the caller.

export function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trimStart();
}

// Streaming variant: processes chunks incrementally so <think> blocks that
// span multiple SSE events are correctly suppressed.
export class ThinkTagFilter {
  private buf = "";
  private inside = false;

  push(chunk: string): string {
    this.buf += chunk;
    let out = "";
    while (true) {
      if (this.inside) {
        const end = this.buf.indexOf("</think>");
        if (end === -1) {
          this.buf = this.buf.slice(Math.max(0, this.buf.length - 7));
          break;
        }
        this.buf = this.buf.slice(end + 8);
        this.inside = false;
      } else {
        const start = this.buf.indexOf("<think>");
        if (start === -1) {
          const partial = this._partialPrefix("<think>");
          out += this.buf.slice(0, this.buf.length - partial);
          this.buf = this.buf.slice(this.buf.length - partial);
          break;
        }
        out += this.buf.slice(0, start);
        this.buf = this.buf.slice(start + 7);
        this.inside = true;
      }
    }
    return out;
  }

  flush(): string {
    const out = this.inside ? "" : this.buf;
    this.buf = "";
    this.inside = false;
    return out;
  }

  private _partialPrefix(tag: string): number {
    for (let len = Math.min(tag.length - 1, this.buf.length); len > 0; len--) {
      if (tag.startsWith(this.buf.slice(this.buf.length - len))) return len;
    }
    return 0;
  }
}

// ── Deduct credits + log usage ───────────────────────────────────────────────
// Smart split-balance deduction:
//
//   • Subscription credit (users.credit_balance):
//       - Earned via plan upgrade (monthly subscription)
//       - Restricted to models the user's current plan allows
//
//   • Top-up credit (users.topup_credit_balance):
//       - Added manually by admin
//       - Works on ALL models (pay-as-you-go)
//
// Rules:
//   1. If model IS in the user's plan: subscription credit is consumed first,
//      then top-up credit covers any remainder.
//   2. If model is NOT in the user's plan: only top-up credit can be used.
//
// This prevents the security loophole where a Free-plan user could exploit
// premium models using subscription credit gifted by their plan.

export async function deductAndLog(
  userId: number,
  apiKeyId: number,
  model: string,
  requestId: string,
  inputTokens: number,
  outputTokens: number,
  costUsd: number,
  options?: { modelInPlan?: boolean },
): Promise<boolean> {
  const totalTokens = inputTokens + outputTokens;
  // Default true for backward compat when caller hasn't supplied the flag
  const modelInPlan = options?.modelInPlan ?? true;

  // Atomic split-balance deduction in a single SQL UPDATE.
  // - When modelInPlan=true: subscription first (capped at sub balance), then top-up covers remainder.
  // - When modelInPlan=false: top-up covers the entire cost; subscription untouched.
  // The WHERE clause guarantees the combined available balance covers costUsd.
  const updated = modelInPlan
    ? await db
        .update(usersTable)
        .set({
          creditBalance: sql`GREATEST(${usersTable.creditBalance} - ${costUsd}, 0)`,
          topupCreditBalance: sql`${usersTable.topupCreditBalance} - GREATEST(${costUsd} - ${usersTable.creditBalance}, 0)`,
        })
        .where(
          and(
            eq(usersTable.id, userId),
            sql`(${usersTable.creditBalance} + ${usersTable.topupCreditBalance}) >= ${costUsd}`,
          ),
        )
        .returning({
          subscriptionCredit: usersTable.creditBalance,
          topupCredit: usersTable.topupCreditBalance,
        })
    : await db
        .update(usersTable)
        .set({
          topupCreditBalance: sql`${usersTable.topupCreditBalance} - ${costUsd}`,
        })
        .where(
          and(
            eq(usersTable.id, userId),
            sql`${usersTable.topupCreditBalance} >= ${costUsd}`,
          ),
        )
        .returning({
          subscriptionCredit: usersTable.creditBalance,
          topupCredit: usersTable.topupCreditBalance,
        });

  const sufficient = updated.length > 0;

  await db.insert(usageLogsTable).values({
    apiKeyId,
    model,
    inputTokens,
    outputTokens,
    totalTokens,
    costUsd: sufficient ? costUsd : 0,
    requestId,
    status: sufficient ? "success" : "error",
    errorMessage: sufficient
      ? null
      : modelInPlan
        ? "Insufficient credits at billing time"
        : `Insufficient top-up credits — model "${model}" is not in your plan and requires top-up balance`,
  });

  return sufficient;
}

/**
 * Returns true if the model is allowed by the plan's `modelsAllowed` array.
 * Empty array = unrestricted (allows everything).
 */
export function isModelInPlan(planModelsAllowed: string[], normalizedModel: string): boolean {
  if (!planModelsAllowed || planModelsAllowed.length === 0) return true;
  return planModelsAllowed.includes(normalizedModel);
}

// ── Estimate cost for pre-flight check ──────────────────────────────────────

export function estimateChatCost(
  messages: Array<{ content: string | unknown[] }>,
  model: string,
  maxOutputTokens: number | undefined,
): number {
  const estimatedInput = messages.reduce((acc, m) => {
    const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    return acc + Math.ceil(text.length / 4);
  }, 0);
  const estimatedOutput = maxOutputTokens ?? 2000;
  return calculateChatCost(model, estimatedInput, estimatedOutput);
}
