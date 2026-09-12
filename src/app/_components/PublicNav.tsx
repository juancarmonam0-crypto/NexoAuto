import Link from "next/link";
import { Lock, Phone } from "lucide-react";
import { NexoLogo } from "@/app/_components/brand";
import { LanguageSwitcher } from "@/app/_components/LanguageSwitcher";
import { type PublicDealerInfo } from "@/lib/public-catalog";
import { SECTION_IDS } from "@/lib/i18n/public-content";
import { strings, type Language } from "@/lib/i18n/catalog";

/**
 * Storefront header.
 *
 * Mobile first, and deliberately without a hamburger menu: a drawer would need
 * client JavaScript, a focus trap and a bundle for what is three destinations.
 * Instead the mobile bar carries what a phone visitor actually wants (the phone
 * number, inventory) plus the language switcher, and every other section is
 * reachable by scrolling the landing page.
 *
 * The request language arrives as a plain code — never as a helper object,
 * because functions cannot cross the server/client boundary, and the language
 * switcher on this bar IS a client component. The bundle is rebuilt here from
 * that code.
 *
 * Spanish runs longer than English ("Ver autos" vs "Browse"), so the inventory
 * button shortens below `sm`. Nothing wraps and nothing overflows at 320px.
 */

interface PublicNavProps {
  dealerInfo?: PublicDealerInfo | null;
  language: Language;
}

const SECTION_LINKS = [
  { anchor: SECTION_IDS.howItWorks, key: "nav.howItWorks" },
  { anchor: SECTION_IDS.buyingOptions, key: "nav.buyingOptions" },
] as const;

export function PublicNav({ dealerInfo, language }: PublicNavProps) {
  const s = strings(language);
  const name = dealerInfo?.name?.trim() || s.t("meta.siteName");
  const phone = dealerInfo?.phone?.trim() || null;
  const homeLabel = s.tc("nav.home", { name });

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-3 sm:gap-3 sm:px-6">
        <Link href="/" className="flex min-w-0 shrink items-center rounded-lg" aria-label={homeLabel}>
          <NexoLogo name={name} tagline={s.t("meta.tagline")} size="md" />
        </Link>

        {/* Desktop navigation */}
        <nav aria-label={s.t("nav.primary")} className="hidden items-center gap-1 lg:flex">
          <Link
            href="/inventory"
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            {s.t("nav.inventory")}
          </Link>
          {SECTION_LINKS.map((link) => (
            <Link
              key={link.anchor}
              href={`/#${link.anchor}`}
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              {s.t(link.key)}
            </Link>
          ))}
        </nav>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
          <LanguageSwitcher
            language={language}
            label={s.t("language.label")}
            switchToLabel={s.t("language.switchTo")}
          />

          {phone && (
            <a
              href={`tel:${phone.replace(/[^+\d]/g, "")}`}
              aria-label={s.tc("nav.callDealer", { name, phone })}
              className="inline-flex h-11 w-10 items-center justify-center rounded-lg text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              <Phone className="h-4 w-4 shrink-0 text-orange-600" aria-hidden="true" />
            </a>
          )}

          <Link
            href="/inventory"
            className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-orange-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-orange-700 sm:px-4"
          >
            <span className="hidden sm:inline">{s.t("nav.browseCars")}</span>
            <span className="sm:hidden">{s.t("nav.browseCarsShort")}</span>
          </Link>

          <Link
            href="/admin/login"
            title={s.t("nav.operatorSignIn")}
            aria-label={s.t("nav.operatorSignIn")}
            className="inline-flex h-11 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <Lock className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </header>
  );
}
