import type { ReactNode } from "react";
import { requireStaff } from "@/lib/auth/guards";
import { OperatorNav } from "@/app/_components/OperatorNav";

export const dynamic = "force-dynamic";

export default async function OperatorLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireStaff();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-orange-500 selection:text-white pb-20 md:pb-10">
      <OperatorNav currentUser={user} />
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}
