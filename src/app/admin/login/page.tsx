import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ActionForm } from "@/app/_components/ActionForm";
import { loginAction } from "@/app/actions/auth";
import { getCurrentUser } from "@/lib/auth/session";

/**
 * Operator sign-in.
 *
 * Lives at /admin/login because that is where the existing page guards send an
 * anonymous visitor. The form posts to a server action; nothing about the actor
 * is supplied by the browser.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/buy");

  return (
    <main>
      <h1>Operator sign in</h1>

      <ActionForm action={loginAction} submitLabel="Sign in" successMessage="Signed in.">
        <label>
          Email
          <input type="email" name="email" required autoComplete="username" autoFocus />
        </label>
        <label>
          Password
          <input type="password" name="password" required autoComplete="current-password" />
        </label>
      </ActionForm>

      <p className="muted">
        Accounts are provisioned by the dealership. Ask an owner or manager if you need access.
      </p>
      <p>
        <Link href="/">← Back to the storefront</Link>
      </p>
    </main>
  );
}
