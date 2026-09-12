"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ActionError, type ActionResult, runOperation } from "@/lib/action-result";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, destroyCurrentSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { requireFormSecret, requireFormString } from "@/lib/forms";

/**
 * Operator authentication.
 *
 * Built entirely from the EXISTING primitives: `verifyPassword` (bcrypt cost
 * 12), `createSession` (random token in an httpOnly cookie, only the SHA-256
 * hash stored in the database) and `destroyCurrentSession`. No second
 * authentication system, no client-supplied identity.
 *
 * Authentication is the ONE place the application talks to Prisma directly:
 * sessions and users are infrastructure, not dealership operations. Everything
 * else goes through the operation layer.
 *
 * NOT built, deliberately: password reset, email verification, SSO, OAuth,
 * MFA, invitations. A user exists because an operator was provisioned
 * (`prisma/seed.ts` locally, or the database directly in production).
 */

export interface LoginResult {
  role: string;
}

/**
 * A valid bcrypt hash of a value nobody can guess, used when the email is
 * unknown so that a failed sign-in performs the same work — and therefore takes
 * the same time — whether or not the account exists. Without it, response time
 * reveals which email addresses are registered.
 */
const TIMING_EQUALIZER_HASH = "$2b$12$GAeRgGOA/QtkFPZN0vaqduTSo4KriSv1GUVBh9zQu7XkkiyrnWwPC";

export async function loginAction(formData: FormData): Promise<ActionResult<LoginResult>> {
  const result = await runOperation("auth.login", async () => {
    const email = requireFormString(formData, "email", "Email").toLowerCase();
    const password = requireFormSecret(formData, "password", "Password");
    if (password.length > 200) throw new ActionError("Invalid email or password.");

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true, isActive: true, passwordHash: true },
    });

    const passwordMatches = await verifyPassword(password, user?.passwordHash ?? TIMING_EQUALIZER_HASH);
    if (!user || !user.isActive || !passwordMatches) {
      // One message for every failure mode: never reveal which part was wrong.
      throw new ActionError("Invalid email or password.");
    }

    const headerList = await headers();
    await createSession(user.id, {
      userAgent: headerList.get("user-agent"),
      ipAddress: headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    });
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    return { role: user.role };
  });

  // Redirected OUTSIDE runOperation: Next implements redirect() by throwing, and
  // that error must not be swallowed and reported as an internal failure.
  if (result.ok) redirect("/buy");

  return result;
}

/**
 * Signs out by deleting the server-side session row and clearing the cookie.
 *
 * Deliberately not wrapped in a try/catch: if the session cannot be revoked,
 * telling the operator they are signed out would be a lie.
 */
export async function logoutAction(): Promise<void> {
  await destroyCurrentSession();
  redirect("/");
}
