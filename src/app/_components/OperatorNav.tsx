"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/actions/auth";
import type { SessionUser } from "@/lib/auth/session";
import {
  ShoppingBag,
  Car,
  Users,
  TrendingUp,
  LogOut,
  ExternalLink,
} from "lucide-react";

interface OperatorNavProps {
  currentUser: SessionUser;
}

const NAV_ITEMS = [
  { href: "/buy", label: "BUY", icon: ShoppingBag, desc: "Sourcing" },
  { href: "/cars", label: "CARS", icon: Car, desc: "Inventory" },
  { href: "/leads", label: "LEADS", icon: Users, desc: "CRM" },
  { href: "/sales", label: "SALES", icon: TrendingUp, desc: "Deals" },
];

export function OperatorNav({ currentUser }: OperatorNavProps) {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop & Tablet Top Navigation Bar */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          {/* Brand */}
          <div className="flex items-center gap-6">
            <Link href="/cars" className="flex items-center gap-2 group">
              <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center font-black">
                <Car className="w-4 h-4 text-orange-500" />
              </div>
              <span className="font-extrabold text-base tracking-tight text-slate-900 group-hover:text-orange-600 transition-colors">
                NEXO AUTO
              </span>
            </Link>

            {/* Desktop Tabs */}
            <nav className="hidden md:flex items-center gap-1">
              {NAV_ITEMS.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/" && pathname.startsWith(item.href));
                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      isActive
                        ? "bg-slate-900 text-white shadow-xs"
                        : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* User Profile, Public Link & Sign Out */}
          <div className="flex items-center gap-3">
            <Link
              href="/"
              target="_blank"
              title="View Public Catalog"
              className="hidden sm:flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900 px-2 py-1 rounded-md hover:bg-slate-100 transition-colors"
            >
              <span>Public Store</span>
              <ExternalLink className="w-3 h-3" />
            </Link>

            <div className="h-4 w-px bg-slate-200 hidden sm:block" />

            <div className="flex items-center gap-2 text-xs">
              <span className="hidden sm:inline font-medium text-slate-700">
                {currentUser.name ?? currentUser.email}
              </span>
              <span className="px-2 py-0.5 rounded-md bg-orange-50 text-orange-800 border border-orange-200 font-mono text-[10px] font-bold">
                {currentUser.role}
              </span>
            </div>

            <form action={logoutAction}>
              <button
                type="submit"
                title="Sign Out"
                className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span className="sr-only">Sign out</span>
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Mobile Fixed Bottom Navigation Bar (Under 768px) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-slate-200 px-2 py-1.5 flex items-center justify-around shadow-lg">
        {NAV_ITEMS.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center py-1 px-3 rounded-lg text-[10px] font-bold transition-all ${
                isActive
                  ? "text-orange-600 bg-orange-50/60 font-extrabold"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              <Icon className={`w-5 h-5 mb-0.5 ${isActive ? "text-orange-600" : "text-slate-500"}`} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
