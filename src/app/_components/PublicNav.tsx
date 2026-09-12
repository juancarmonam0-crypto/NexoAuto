import Link from "next/link";
import { NexoLogo } from "@/app/_components/brand";
import { LanguageSwitcher } from "@/app/_components/LanguageSwitcher";
import { ThemeToggle } from "@/app/_components/ThemeToggle";
import { MobileMenu, type MenuLink } from "@/app/_components/MobileMenu";
import { type PublicDealerInfo } from "@/lib/public-catalog";
import { SECTION_IDS } from "@/lib/i18n/public-content";
import { strings, type Language } from "@/lib/i18n/catalog";

/**
 * Storefront header.
 *
 * COMPACT AND AUTOMOTIVE, per the mockup: the official logo on the left, the
 * destination set in the middle, then the language control, the theme control and
 * the orange "Browse cars" CTA on the right. One 64px row on desktop — the brief
 * explicitly rules out a tall header.
 *
 * RESPONSIVE STRATEGY
 *   ≥ lg : full navigation inline.
 *   < lg : logo + language + theme + hamburger. No desktop links are squeezed
 *          into the phone bar; the drawer carries them at full tap size.
 *
 * The request language arrives as a plain code — functions cannot cross the
 * server/client boundary — and each child rebuilds the bundle it needs.
 */

interface PublicNavProps {
  dealerInfo?: PublicDealerInfo | null;
  language: Language;
}

export function PublicNav({ dealerInfo, language }: PublicNavProps) {
  const s = strings(language);
  const name = dealerInfo?.name?.trim() || s.t("meta.siteName");
  const phone = dealerInfo?.phone?.trim() || null;
  const email = dealerInfo?.email?.trim() || null;
  const homeLabel = s.tc("nav.home", { name });

  const links: MenuLink[] = [
    { href: "/inventory", label: s.t("nav.inventory") },
    { href: `/#${SECTION_IDS.journey}`, label: s.t("nav.howItWorks") },
    { href: `/#${SECTION_IDS.buyingOptions}`, label: s.t("nav.financing") },
    { href: `/#${SECTION_IDS.family}`, label: s.t("nav.about") },
    { href: `/#${SECTION_IDS.contact}`, label: s.t("nav.contact") },
  ];

  const themeLabels = {
    light: s.t("theme.light"),
    dark: s.t("theme.dark"),
    system: s.t("theme.system"),
  };

  return (
    <header className="sticky top-0 z-40 border-b backdrop-blur-md surface-chrome">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-3 sm:px-6">
        {/*
          `min-w-0` + truncation: the lockup yields space to the controls instead
          of pushing them off-screen. At 375px the wordmark is the only flexible
          item on the row.
        */}
        <Link
          href="/"
          className="flex min-w-0 shrink items-center overflow-hidden rounded-lg"
          aria-label={homeLabel}
        >
          <NexoLogo name={name} tagline={s.t("meta.tagline")} size="md" taglineFrom="xl" />
        </Link>

        {/* Desktop navigation */}
        <nav aria-label={s.t("nav.primary")} className="hidden items-center gap-0.5 lg:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-[var(--brand-navy-900)] dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/*
          Controls never shrink. Below `xs` only the menu trigger survives here:
          both switchers live inside the drawer at full tap size, which is what
          keeps the lockup legible on a 375px phone.
        */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
          <LanguageSwitcher
            language={language}
            label={s.t("language.label")}
            switchToLabel={s.t("language.switchTo")}
            className="hidden xs:inline-flex"
          />

          <ThemeToggle
            label={s.t("theme.label")}
            modeLabels={themeLabels}
            switchToLabel={s.t("theme.switchTo")}
            className="hidden xs:inline-flex"
          />

          <Link
            href="/inventory"
            className="hidden h-11 items-center gap-1.5 rounded-lg bg-orange-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-orange-700 sm:inline-flex"
          >
            {s.t("nav.browseCars")}
          </Link>

          <MobileMenu
            links={links}
            openLabel={s.t("nav.openMenu")}
            closeLabel={s.t("nav.closeMenu")}
            title={s.t("nav.menuTitle")}
            phone={phone}
            email={email}
            callLabel={s.t("nav.callUs")}
            emailLabel={s.t("nav.emailUs")}
          >
            {/* The controls a narrow phone still needs, at full size. */}
            <LanguageSwitcher
              language={language}
              label={s.t("language.label")}
              switchToLabel={s.t("language.switchTo")}
              className="xs:hidden"
            />
            <ThemeToggle
              label={s.t("theme.label")}
              modeLabels={themeLabels}
              switchToLabel={s.t("theme.switchTo")}
              className="inline-flex xs:hidden"
            />
            <Link
              href="/inventory"
              className="inline-flex h-11 flex-1 items-center justify-center rounded-lg bg-orange-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-orange-700 sm:hidden"
            >
              {s.t("nav.browseCars")}
            </Link>
          </MobileMenu>
        </div>
      </div>
    </header>
  );
}
