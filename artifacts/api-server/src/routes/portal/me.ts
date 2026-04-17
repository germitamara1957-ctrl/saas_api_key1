import { Router, type IRouter } from "express";
import { eq, sum, count, gte, inArray, and, sql } from "drizzle-orm";
import { db, usersTable, apiKeysTable, usageLogsTable, plansTable } from "@workspace/db";
import { generateApiKey, encryptApiKey, decryptApiKey } from "../../lib/crypto";

const router: IRouter = Router();

router.get("/portal/me", async (req, res): Promise<void> => {
  const userId = Number(req.authUser!.sub);

  const [user] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
      role: usersTable.role,
      isActive: usersTable.isActive,
      creditBalance: usersTable.creditBalance,
      topupCreditBalance: usersTable.topupCreditBalance,
      emailVerified: usersTable.emailVerified,
      currentPlanId: usersTable.currentPlanId,
      currentPeriodStartedAt: usersTable.currentPeriodStartedAt,
      currentPeriodEnd: usersTable.currentPeriodEnd,
      dailySpendLimitUsd: usersTable.dailySpendLimitUsd,
      monthlySpendLimitUsd: usersTable.monthlySpendLimitUsd,
      spendAlertThreshold: usersTable.spendAlertThreshold,
      createdAt: usersTable.createdAt,
      updatedAt: usersTable.updatedAt,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const userKeys = await db
    .select({ id: apiKeysTable.id })
    .from(apiKeysTable)
    .where(eq(apiKeysTable.userId, userId));

  const keyIds = userKeys.map((k) => k.id);

  const subscriptionCredit = Number(user?.creditBalance ?? 0);
  const topupCredit = Number(user?.topupCreditBalance ?? 0);
  const balanceResult = [{ total: subscriptionCredit + topupCredit }];

  let monthlyStats = { totalRequests: 0, totalTokens: 0 };
  let dailySpent = 0;
  let monthlySpent = 0;
  if (keyIds.length > 0) {
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const statsResult = await db
      .select({
        totalRequests: count(),
        totalTokens: sum(usageLogsTable.totalTokens),
        monthlyCost: sql<string>`COALESCE(SUM(${usageLogsTable.costUsd}), 0)`,
      })
      .from(usageLogsTable)
      .where(
        and(
          inArray(usageLogsTable.apiKeyId, keyIds),
          gte(usageLogsTable.createdAt, startOfMonth),
          eq(usageLogsTable.status, "success"),
        ),
      );

    const [daySpend] = await db
      .select({ total: sql<string>`COALESCE(SUM(${usageLogsTable.costUsd}), 0)` })
      .from(usageLogsTable)
      .where(and(
        inArray(usageLogsTable.apiKeyId, keyIds),
        gte(usageLogsTable.createdAt, startOfDay),
        eq(usageLogsTable.status, "success"),
      ));

    monthlyStats.totalRequests = Number(statsResult[0]?.totalRequests ?? 0);
    monthlyStats.totalTokens = Number(statsResult[0]?.totalTokens ?? 0);
    monthlySpent = Number(statsResult[0]?.monthlyCost ?? 0);
    dailySpent = Number(daySpend?.total ?? 0);
  }

  res.json({
    user,
    totalCreditsBalance: Number(balanceResult[0]?.total ?? 0),
    subscriptionCreditBalance: subscriptionCredit,
    topupCreditBalance: topupCredit,
    totalRequestsThisMonth: monthlyStats.totalRequests,
    totalTokensThisMonth: monthlyStats.totalTokens,
    spending: {
      dailySpent,
      monthlySpent,
      dailyLimit: user.dailySpendLimitUsd,
      monthlyLimit: user.monthlySpendLimitUsd,
      alertThreshold: user.spendAlertThreshold,
    },
  });
});

// PATCH /api/portal/me/spending-limits — update user spend caps
router.patch("/portal/me/spending-limits", async (req, res): Promise<void> => {
  const userId = Number(req.authUser!.sub);
  const body = req.body ?? {};

  // Validate
  const sanitizeMoney = (v: unknown): number | null | undefined => {
    if (v === undefined) return undefined;
    if (v === null || v === "" ) return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return undefined; // skip invalid
    return n;
  };
  const dailyLimit = sanitizeMoney(body.dailyLimit);
  const monthlyLimit = sanitizeMoney(body.monthlyLimit);
  const threshold =
    body.alertThreshold === undefined
      ? undefined
      : Math.min(1, Math.max(0.1, Number(body.alertThreshold)));

  const updates: Record<string, unknown> = {};
  if (dailyLimit !== undefined) updates.dailySpendLimitUsd = dailyLimit;
  if (monthlyLimit !== undefined) updates.monthlySpendLimitUsd = monthlyLimit;
  if (threshold !== undefined && Number.isFinite(threshold)) updates.spendAlertThreshold = threshold;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }

  // Reset alert dedupe whenever the user changes a limit so we can re-warn.
  updates.spendAlertEmailSentAt = null;

  const [updated] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, userId))
    .returning({
      dailySpendLimitUsd: usersTable.dailySpendLimitUsd,
      monthlySpendLimitUsd: usersTable.monthlySpendLimitUsd,
      spendAlertThreshold: usersTable.spendAlertThreshold,
    });

  res.json({
    dailyLimit: updated?.dailySpendLimitUsd ?? null,
    monthlyLimit: updated?.monthlySpendLimitUsd ?? null,
    alertThreshold: updated?.spendAlertThreshold ?? 0.8,
  });
});

router.get("/portal/api-keys", async (req, res): Promise<void> => {
  const userId = Number(req.authUser!.sub);

  const keys = await db
    .select({
      id: apiKeysTable.id,
      userId: apiKeysTable.userId,
      planId: apiKeysTable.planId,
      keyPrefix: apiKeysTable.keyPrefix,
      name: apiKeysTable.name,
      creditBalance: apiKeysTable.creditBalance,
      isActive: apiKeysTable.isActive,
      lastUsedAt: apiKeysTable.lastUsedAt,
      revokedAt: apiKeysTable.revokedAt,
      createdAt: apiKeysTable.createdAt,
      updatedAt: apiKeysTable.updatedAt,
      rpmLimit: apiKeysTable.rpmLimit,
      monthlySpendLimitUsd: apiKeysTable.monthlySpendLimitUsd,
    })
    .from(apiKeysTable)
    .where(eq(apiKeysTable.userId, userId))
    .orderBy(apiKeysTable.createdAt);

  res.json(keys);
});

router.post("/portal/api-keys", async (req, res): Promise<void> => {
  const userId = Number(req.authUser!.sub);

  const rawName = req.body?.name;
  if (rawName !== undefined && (typeof rawName !== "string" || rawName.length > 100)) {
    res.status(400).json({ error: "name must be a string of at most 100 characters" });
    return;
  }
  const keyName: string | null = typeof rawName === "string" && rawName.trim() ? rawName.trim() : null;

  const rawPlanId = req.body?.planId;
  let assignedPlanId: number | null = null;
  let initialCredits = 0;

  const [user] = await db
    .select({ id: usersTable.id, isActive: usersTable.isActive, currentPlanId: usersTable.currentPlanId })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1);

  if (!user || !user.isActive) {
    res.status(403).json({ error: "Account is not active" });
    return;
  }

  if (rawPlanId !== undefined) {
    const planIdNum = Number(rawPlanId);
    if (!Number.isInteger(planIdNum) || planIdNum <= 0) {
      res.status(400).json({ error: "Invalid planId" });
      return;
    }
    const [plan] = await db.select().from(plansTable)
      .where(and(eq(plansTable.id, planIdNum), eq(plansTable.isActive, true))).limit(1);
    if (!plan) {
      res.status(404).json({ error: "Plan not found" });
      return;
    }
    if (plan.priceUsd > 0 && user.currentPlanId !== planIdNum) {
      res.status(403).json({ error: "Paid plans require administrator approval. Please contact support." });
      return;
    }
    assignedPlanId = plan.id;
    const [priorKey] = await db.select({ id: apiKeysTable.id })
      .from(apiKeysTable)
      .where(and(eq(apiKeysTable.userId, userId), eq(apiKeysTable.planId, plan.id)))
      .limit(1);
    if (!priorKey) {
      initialCredits = plan.monthlyCredits;
    }
  } else if (user.currentPlanId != null) {
    assignedPlanId = user.currentPlanId;
  }

  const effectivePlanId = assignedPlanId ?? user.currentPlanId;
  const existingKeys = await db.select({ id: apiKeysTable.id, planId: apiKeysTable.planId })
    .from(apiKeysTable)
    .where(and(eq(apiKeysTable.userId, userId), eq(apiKeysTable.isActive, true)));

  let maxApiKeys = 1;
  const planIdForLimit = effectivePlanId ?? (existingKeys.find(k => k.planId != null)?.planId ?? null);
  if (planIdForLimit != null) {
    const [plan] = await db.select({ maxApiKeys: plansTable.maxApiKeys })
      .from(plansTable).where(eq(plansTable.id, planIdForLimit)).limit(1);
    if (plan) maxApiKeys = plan.maxApiKeys;
  }

  if (existingKeys.length >= maxApiKeys) {
    res.status(403).json({
      error: `Your plan allows a maximum of ${maxApiKeys} active API key${maxApiKeys === 1 ? "" : "s"}. Contact your administrator to upgrade.`,
    });
    return;
  }

  const { rawKey, keyHash, keyPrefix } = generateApiKey();
  const keyEncrypted = encryptApiKey(rawKey);

  const apiKey = await db.transaction(async (tx) => {
    const [key] = await tx.insert(apiKeysTable).values({
      userId,
      planId: assignedPlanId,
      keyPrefix,
      keyHash,
      keyEncrypted,
      name: keyName ?? (assignedPlanId ? "Free Plan Key" : "Default Key"),
      isActive: true,
    }).returning();

    if (initialCredits > 0) {
      await tx.update(usersTable)
        .set({ creditBalance: sql`credit_balance + ${initialCredits}` })
        .where(eq(usersTable.id, userId));
    }

    return key!;
  });

  res.status(201).json({
    id: apiKey.id,
    keyPrefix: apiKey.keyPrefix,
    fullKey: rawKey,
    name: apiKey.name,
    isActive: apiKey.isActive,
    createdAt: apiKey.createdAt,
  });
});

router.get("/portal/api-keys/:id/reveal", async (req, res): Promise<void> => {
  const userId = Number(req.authUser!.sub);
  const keyId = Number(req.params.id);

  if (!Number.isInteger(keyId) || keyId <= 0) {
    res.status(400).json({ error: "Invalid key ID" });
    return;
  }

  const [key] = await db
    .select({
      id: apiKeysTable.id,
      userId: apiKeysTable.userId,
      keyEncrypted: apiKeysTable.keyEncrypted,
      keyPrefix: apiKeysTable.keyPrefix,
      isActive: apiKeysTable.isActive,
    })
    .from(apiKeysTable)
    .where(and(eq(apiKeysTable.id, keyId), eq(apiKeysTable.userId, userId)))
    .limit(1);

  if (!key) {
    res.status(404).json({ error: "API key not found" });
    return;
  }

  if (!key.keyEncrypted) {
    res.status(404).json({ error: "Key data not available" });
    return;
  }

  const fullKey = decryptApiKey(key.keyEncrypted);
  if (!fullKey) {
    res.status(500).json({ error: "Failed to decrypt key" });
    return;
  }

  res.json({ fullKey });
});

router.patch("/portal/api-keys/:id", async (req, res): Promise<void> => {
  const userId = Number(req.authUser!.sub);
  const keyId = Number(req.params.id);
  if (!Number.isInteger(keyId) || keyId <= 0) {
    res.status(400).json({ error: "Invalid key ID" });
    return;
  }
  const [key] = await db.select({ id: apiKeysTable.id })
    .from(apiKeysTable)
    .where(and(eq(apiKeysTable.id, keyId), eq(apiKeysTable.userId, userId)))
    .limit(1);
  if (!key) {
    res.status(404).json({ error: "API key not found" });
    return;
  }
  const body = req.body ?? {};
  const updates: { rpmLimit?: number | null; monthlySpendLimitUsd?: number | null; name?: string } = {};
  if ("rpmLimit" in body) {
    const v = body.rpmLimit;
    if (v === null || v === "") updates.rpmLimit = null;
    else if (typeof v === "number" && Number.isInteger(v) && v > 0) updates.rpmLimit = v;
    else { res.status(400).json({ error: "rpmLimit must be a positive integer or null" }); return; }
  }
  if ("monthlySpendLimitUsd" in body) {
    const v = body.monthlySpendLimitUsd;
    if (v === null || v === "") updates.monthlySpendLimitUsd = null;
    else if (typeof v === "number" && v > 0) updates.monthlySpendLimitUsd = v;
    else { res.status(400).json({ error: "monthlySpendLimitUsd must be a positive number or null" }); return; }
  }
  if (typeof body.name === "string" && body.name.trim().length > 0) {
    updates.name = body.name.trim().slice(0, 100);
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }
  const [updated] = await db.update(apiKeysTable).set(updates).where(eq(apiKeysTable.id, keyId)).returning();
  res.json({
    id: updated.id,
    name: updated.name,
    rpmLimit: updated.rpmLimit,
    monthlySpendLimitUsd: updated.monthlySpendLimitUsd,
  });
});

router.delete("/portal/api-keys/:id", async (req, res): Promise<void> => {
  const userId = Number(req.authUser!.sub);
  const keyId = Number(req.params.id);

  if (!Number.isInteger(keyId) || keyId <= 0) {
    res.status(400).json({ error: "Invalid key ID" });
    return;
  }

  const [key] = await db.select({ id: apiKeysTable.id, userId: apiKeysTable.userId })
    .from(apiKeysTable)
    .where(and(eq(apiKeysTable.id, keyId), eq(apiKeysTable.userId, userId)))
    .limit(1);

  if (!key) {
    res.status(404).json({ error: "API key not found" });
    return;
  }

  await db.update(apiKeysTable)
    .set({ isActive: false })
    .where(eq(apiKeysTable.id, keyId));

  res.status(204).end();
});

router.get("/portal/plans", async (_req, res): Promise<void> => {
  const plans = await db
    .select()
    .from(plansTable)
    .where(eq(plansTable.isActive, true))
    .orderBy(plansTable.id);

  res.json(plans);
});

router.post("/portal/plans/:planId/enroll", async (req, res): Promise<void> => {
  const userId = Number(req.authUser!.sub);
  const planId = Number(req.params.planId);

  if (!Number.isInteger(planId) || planId <= 0) {
    res.status(400).json({ error: "Invalid planId" });
    return;
  }

  const [plan] = await db.select().from(plansTable)
    .where(and(eq(plansTable.id, planId), eq(plansTable.isActive, true))).limit(1);

  if (!plan) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }
  if (plan.priceUsd > 0) {
    res.status(403).json({ error: "Paid plans require administrator approval." });
    return;
  }

  const [user] = await db.select({ id: usersTable.id, isActive: usersTable.isActive })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user || !user.isActive) {
    res.status(403).json({ error: "Account is not active" });
    return;
  }

  const existingKeys = await db.select()
    .from(apiKeysTable)
    .where(and(eq(apiKeysTable.userId, userId), eq(apiKeysTable.isActive, true)))
    .limit(10);

  const planlessKey = existingKeys.find(k => k.planId === null);

  if (planlessKey) {
    await db.transaction(async (tx) => {
      await tx.update(apiKeysTable)
        .set({ planId: plan.id })
        .where(eq(apiKeysTable.id, planlessKey.id));

      const now = new Date();
      const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const userUpdate: Record<string, unknown> = {
        currentPlanId: plan.id,
        currentPeriodStartedAt: now,
        currentPeriodEnd: periodEnd,
      };
      if (plan.monthlyCredits > 0) {
        userUpdate["creditBalance"] = sql`credit_balance + ${plan.monthlyCredits}`;
      }
      await tx.update(usersTable).set(userUpdate).where(eq(usersTable.id, userId));
    });

    res.json({
      enrolled: true,
      existing: true,
      keyPrefix: planlessKey.keyPrefix,
      planName: plan.name,
      creditsAdded: plan.monthlyCredits,
    });
    return;
  }

  const alreadyOnPlan = existingKeys.find(k => k.planId === planId);
  if (alreadyOnPlan) {
    res.status(409).json({ error: "You are already on this plan." });
    return;
  }

  const { rawKey, keyHash, keyPrefix } = generateApiKey();
  const keyEncrypted = encryptApiKey(rawKey);

  const newKey = await db.transaction(async (tx) => {
    const [key] = await tx.insert(apiKeysTable).values({
      userId,
      planId: plan.id,
      keyPrefix,
      keyHash,
      keyEncrypted,
      name: `${plan.name} Key`,
      isActive: true,
    }).returning();

    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const userUpdate: Record<string, unknown> = {
      currentPlanId: plan.id,
      currentPeriodStartedAt: now,
      currentPeriodEnd: periodEnd,
    };
    if (plan.monthlyCredits > 0) {
      userUpdate["creditBalance"] = sql`credit_balance + ${plan.monthlyCredits}`;
    }
    await tx.update(usersTable).set(userUpdate).where(eq(usersTable.id, userId));

    return key!;
  });

  res.status(201).json({
    enrolled: true,
    existing: false,
    keyPrefix: newKey.keyPrefix,
    fullKey: rawKey,
    planName: plan.name,
    creditsAdded: plan.monthlyCredits,
  });
});

export default router;
