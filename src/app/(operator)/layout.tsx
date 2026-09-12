import Link from "next/link";
import type { ReactNode } from "react";
import { logoutAction } from "@/app/actions/auth";
import { requireStaff } from "@/lib/auth/guards";

/**
 * Operator shell.
 *
 * The authentication gate for every operator route lives HERE, in a server
 * component, and calls the existing `requireStaff()` guard: an anonymous
 * visitor is redirected to the sign-in page before any page body runs. Hiding
 * navigation in the browser is presentation; this is the boundary.
 */

export const dynamic = "force-dynamic";

export default async function OperatorLayout({ children }: { children: ReactNode }) {
  const user = await requireStaff();

  return (
    <>
      <nav aria-label="Operator">
        <strong>Nexo Auto</strong>
        <Link href="/buy">BUY</Link>
        <Link href="/cars">CARS</Link>
        <Link href="/leads">LEADS</Link>
        <Link href="/sales">SALES</Link>
        <span className="muted">
          {user.name} · {user.role}
        </span>
        <form action={logoutAction}>
          <button type="submit">Sign out</button>
        </form>
      </nav>
      <main>{children}</main>
    </>
  );
}
