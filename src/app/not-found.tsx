import Link from "next/link";
import type { Metadata } from "next";
import { getPublicStrings } from "@/lib/i18n";
import { PublicNav } from "@/app/_components/PublicNav";
import { PublicFooter } from "@/app/_components/PublicFooter";
import { ArrowRight, Car } from "lucide-react";

/**
 * Public not-found page.
 *
 * A wrong URL is a customer-facing dead end, so it gets a real page rather than
 * the framework default: the brand shell, the language the visitor is already
 * using, and two obvious ways forward. Vehicle detail pages call `notFound()`
 * for sold, unlisted and non-existent vehicles alike, so this is the page a
 * buyer sees most often after a stale link.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const s = await getPublicStrings();
  return { title: s.t("meta.vehicle.notFound"), robots: { index: false, follow: true } };
}

export default async function NotFound() {
  const s = await getPublicStrings();

  return (
    <div className="flex min-h-screen flex-col surface-page">
      <PublicNav language={s.language} />

      <main className="mx-auto flex w-full max-w-6xl flex-1 items-center px-4 py-16 sm:px-6">
        <div className="w-full rounded-2xl p-8 text-center surface-card sm:p-12">
          <span className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300">
            <Car className="h-7 w-7" aria-hidden="true" />
          </span>

          <h1 className="mt-5 text-2xl font-extrabold tracking-tight text-[var(--brand-navy-900)] sm:text-3xl dark:text-white">
            {s.t("meta.vehicle.notFound")}
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            {s.t("inventory.empty.body")}
          </p>

          <div className="mt-7 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center">
            <Link
              href="/inventory"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-orange-600 px-6 text-sm font-semibold text-white transition-colors hover:bg-orange-700"
            >
              <span>{s.t("home.inventory.viewAll")}</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link
              href="/"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 px-6 text-sm font-semibold text-[var(--brand-navy-900)] transition-colors hover:bg-slate-50 dark:border-white/20 dark:text-white dark:hover:bg-white/10"
            >
              <span>{s.t("inventory.empty.home")}</span>
            </Link>
          </div>
        </div>
      </main>

      <PublicFooter language={s.language} />
    </div>
  );
}
