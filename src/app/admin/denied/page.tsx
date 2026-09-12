import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { capabilitiesFor } from "@/lib/auth/roles";
import { ShieldAlert, ArrowLeft, LogOut } from "lucide-react";
import { logoutAction } from "@/app/actions/auth";

export const dynamic = "force-dynamic";

export default async function AccessDeniedPage() {
  const user = await getCurrentUser();
  const capabilities = user ? capabilitiesFor(user.role) : [];

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans">
      <div className="max-w-md w-full bg-white rounded-xl border border-slate-200 p-8 shadow-xs space-y-6">
        <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
          <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">Access Restricted</h1>
            <p className="text-xs text-slate-500">
              Role permissions insufficient for requested screen.
            </p>
          </div>
        </div>

        {user ? (
          <div className="space-y-4 text-xs">
            <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1 font-mono">
              <div className="flex justify-between">
                <span className="text-slate-500">Authenticated User:</span>
                <span className="font-semibold text-slate-900">{user.name ?? user.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Assigned Role:</span>
                <span className="font-bold text-orange-600">{user.role}</span>
              </div>
            </div>

            <div>
              <span className="text-slate-500 uppercase tracking-wider text-[10px] font-mono block mb-1.5 font-semibold">
                Authorized Capabilities:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {capabilities.map((cap) => (
                  <span
                    key={cap}
                    className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-mono"
                  >
                    {cap}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-600">
            You must be signed in with an authorized staff account.
          </p>
        )}

        <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-3">
          <Link
            href="/buy"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Return to Workspace</span>
          </Link>

          {user && (
            <form action={logoutAction}>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5 text-slate-500" />
                <span>Sign Out</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
