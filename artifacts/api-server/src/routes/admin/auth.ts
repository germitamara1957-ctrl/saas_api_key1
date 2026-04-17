import { Router, type IRouter, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { AdminLoginBody } from "@workspace/api-zod";
import { verifyPassword } from "../../lib/crypto";
import { signToken } from "../../lib/jwt";
import { checkLoginLimit, resetLoginLimit } from "../../lib/ipRateLimit";
import { logAuditEvent } from "./auditLog";

const COOKIE_NAME = "auth_token";

function setAuthCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

const router: IRouter = Router();

router.post("/admin/auth/login", async (req, res): Promise<void> => {
  const ip = req.ip ?? "unknown";
  const parsed = AdminLoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { email, password } = parsed.data;

  const limitCheck = await checkLoginLimit(ip, email);
  if (!limitCheck.allowed) {
    const retryAfterSec = Math.ceil(limitCheck.retryAfterMs / 1000);
    res.status(429).json({ error: `Too many login attempts. Please try again in ${retryAfterSec} seconds.` });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (!user || user.role !== "admin" || !user.isActive) {
    await logAuditEvent({
      action: "admin.login.failed",
      actorEmail: email,
      details: "Invalid credentials or insufficient role",
      ip,
    });
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    await logAuditEvent({
      action: "admin.login.failed",
      actorEmail: email,
      details: "Wrong password",
      ip,
    });
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  resetLoginLimit(ip, email);

  await logAuditEvent({
    action: "admin.login",
    actorId: user.id,
    actorEmail: user.email,
    details: "Successful login",
    ip,
  });

  const token = signToken({
    sub: String(user.id),
    email: user.email,
    role: user.role,
    name: user.name,
  });

  setAuthCookie(res, token);

  res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
  });
});

router.post("/admin/auth/logout", (req, res): void => {
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ success: true, message: "Logged out" });
});

export default router;
