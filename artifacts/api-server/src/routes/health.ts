import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();
const startedAt = Date.now();

async function healthHandler(_req: Parameters<Parameters<typeof router.get>[1]>[0], res: Parameters<Parameters<typeof router.get>[1]>[1]) {
  const t0 = Date.now();
  let dbOk = false;
  let dbLatencyMs = -1;

  try {
    await db.execute(sql`SELECT 1`);
    dbLatencyMs = Date.now() - t0;
    dbOk = true;
  } catch {
    dbLatencyMs = Date.now() - t0;
  }

  const status = dbOk ? "ok" : "degraded";
  res
    .status(dbOk ? 200 : 503)
    .json({
      status,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      db: { ok: dbOk, latencyMs: dbLatencyMs },
      timestamp: new Date().toISOString(),
    });
}

// /healthz — standard Kubernetes liveness probe path
router.get("/healthz", healthHandler);
// /health — common alias used by Docker, monitoring tools, and load balancers
router.get("/health", healthHandler);

export default router;
