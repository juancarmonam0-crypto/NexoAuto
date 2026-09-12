import Link from "next/link";
import { Car, Lock } from "lucide-react";

export function PublicNav() {
  return (
    <header className="sticky top-0 z-40 bg-white border-b border-slate-200">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center">
            <Car className="w-4 h-4 text-orange-500" />
          </div>
          <span className="font-extrabold text-base tracking-tight text-slate-900 group-hover:text-orange-600 transition-colors">
            NEXO AUTO
          </span>
        </Link>

        {/* Navigation Actions */}
        <div className="flex items-center gap-4">
          <Link
            href="/inventory"
            className="text-xs font-semibold text-slate-700 hover:text-orange-600 transition-colors"
          >
            Inventory
          </Link>

          {/* Discreet Operator Access */}
          <Link
            href="/admin/login"
            title="Operator Sign In"
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <Lock className="w-3.5 h-3.5" />
            <span className="sr-only">Staff Login</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
