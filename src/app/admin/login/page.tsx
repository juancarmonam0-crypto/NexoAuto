import Link from "next/link";
import { ActionForm } from "@/app/_components/ActionForm";
import { loginAction } from "@/app/actions/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { NexoMark } from "@/app/_components/brand";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) {
    redirect("/buy");
  }

  return (
    <div className="flex min-h-screen flex-col justify-center bg-slate-50 px-4 py-12 font-sans selection:bg-orange-500 selection:text-white sm:px-6 lg:px-8">
      <div className="space-y-4 sm:mx-auto sm:w-full sm:max-w-md">
        {/* Brand & Back link */}
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 transition-colors hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Public catalog</span>
          </Link>

          <span className="font-mono text-[11px] text-slate-400">Nexo Operator</span>
        </div>

        <div className="space-y-2 text-center">
          <NexoMark size={48} className="mx-auto rounded-xl" />
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">Operator access</h1>
          <p className="text-xs text-slate-500">
            Sign in with authorized dealer credentials to reach the operator tools.
          </p>
        </div>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-8 shadow-xs sm:px-10">
          <ActionForm
            action={loginAction}
            submitLabel="Sign In to Operator Tools"
            buttonVariant="secondary"
            buttonSize="md"
            buttonClassName="w-full"
          >
            <div className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Email Address
                </label>
                <input id="email"
                  type="email"
                  name="email"
                  required
                  autoComplete="email"
                  placeholder="operator@nexoauto.com"
                  className="w-full px-3.5 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Password
                </label>
                <input id="password"
                  type="password"
                  name="password"
                  required
                  autoComplete="current-password"
                  placeholder="••••••••••••"
                  className="w-full px-3.5 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                />
              </div>
            </div>
          </ActionForm>
        </div>
      </div>
    </div>
  );
}
