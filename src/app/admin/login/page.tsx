import Link from "next/link";
import { ActionForm } from "@/app/_components/ActionForm";
import { loginAction } from "@/app/actions/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { Car, Lock, ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) {
    redirect("/buy");
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 font-sans selection:bg-orange-500 selection:text-white">
      <div className="sm:mx-auto sm:w-full sm:max-w-md space-y-4">
        {/* Brand & Back link */}
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Public Catalog</span>
          </Link>

          <span className="text-[11px] font-mono text-slate-400">Nexo Operator</span>
        </div>

        <div className="text-center space-y-1">
          <div className="w-10 h-10 rounded-xl bg-slate-900 text-white mx-auto flex items-center justify-center">
            <Car className="w-5 h-5 text-orange-500" />
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900">
            Operator Access
          </h1>
          <p className="text-xs text-slate-500">
            Sign in with authorized dealer credentials to access operator tools.
          </p>
        </div>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-6 shadow-xs rounded-xl border border-slate-200 sm:px-10">
          <ActionForm
            action={loginAction}
            submitLabel="Sign In to Operator Tools"
            buttonVariant="secondary"
            buttonSize="md"
            buttonClassName="w-full"
          >
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Email Address
                </label>
                <input
                  type="email"
                  name="email"
                  required
                  autoComplete="email"
                  placeholder="operator@nexoauto.com"
                  className="w-full px-3.5 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Password
                </label>
                <input
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
