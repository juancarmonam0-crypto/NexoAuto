import Link from "next/link";
import type { Metadata } from "next";
import { logoutAction } from "@/app/actions/auth";
import { requireStaff } from "@/lib/auth/guards";
import { capabilitiesFor } from "@/lib/auth/roles";

/**
 * Where the page guards send a signed-in operator who lacks a capability.
 *
 * Requires staff rather than a capability: the whole point is to render for
 * someone who does not have one.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Access denied" };

export default async function DeniedPage() {
  const user = await requireStaff();
  const capabilities = capabilitiesFor(user.role);

  return (
    <main>
      <h1>Access denied</h1>
      <p>
        You are signed in as <strong>{user.name}</strong> ({user.role}), but this area needs a capability your
        role does not have.
      </p>
      <p className="muted">Your role grants: {capabilities.join(", ")}</p>
      <div className="row">
        <Link href="/buy">Go to BUY</Link>
        <Link href="/cars">Go to CARS</Link>
        <form action={logoutAction}>
          <button type="submit">Sign out</button>
        </form>
      </div>
    </main>
  );
}
