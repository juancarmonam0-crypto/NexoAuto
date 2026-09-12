import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import type { UserRole } from "@/generated/prisma";
import { prisma } from "@/lib/db";

/**
 * Session handling.
 *
 * The browser holds an opaque random token in an httpOnly cookie. The database
 * stores only the SHA-256 hash of that token, so a database disclosure cannot
 * be replayed as a live session. Sessions are server-side and revocable.
 *
 * This module is server-only. Middleware must NOT import it: middleware runs on
 * the edge runtime where Prisma is unavailable, and cookie presence is not an
 * authorization decision anyway. The real check happens in guards.ts.
 */

export const SESSION_COOKIE_NAME = "dd_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function createSession(
  userId: string,
  meta: { userAgent?: string | null; ipAddress?: string | null } = {},
): Promise<void> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
      userAgent: meta.userAgent?.slice(0, 500) ?? null,
      ipAddress: meta.ipAddress?.slice(0, 100) ?? null,
    },
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

/**
 * Resolves the signed-in staff member for this request.
 * Memoized per request so a page and its nested components share one query.
 * Fails closed: any error means "not signed in", never "signed in".
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  try {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE_NAME)?.value;
    if (!token) return null;

    const session = await prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        expiresAt: true,
        user: { select: { id: true, email: true, name: true, role: true, isActive: true } },
      },
    });

    if (!session) return null;
    if (session.expiresAt.getTime() <= Date.now()) return null;
    if (!session.user.isActive) return null;

    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,
    };
  } catch {
    // Database unreachable or cookie malformed: treat as anonymous.
    return null;
  }
});

export async function destroyCurrentSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  jar.delete(SESSION_COOKIE_NAME);
}

/** Used after a password change or deactivation. */
export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}

export async function purgeExpiredSessions(): Promise<number> {
  const result = await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return result.count;
}

/** True when the httpOnly session cookie is present. Never an auth decision. */
export function hasSessionCookie(cookieValue: string | undefined): boolean {
  return typeof cookieValue === "string" && cookieValue.length > 0;
}
