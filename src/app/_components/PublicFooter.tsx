import Link from "next/link";
import { type PublicDealerInfo } from "@/lib/public-catalog";
import { NexoFamilyNote, NexoMark } from "@/app/_components/brand";
import { LanguageSwitcher } from "@/app/_components/LanguageSwitcher";
import { SECTION_IDS } from "@/lib/i18n/public-content";
import { strings, type Language } from "@/lib/i18n/catalog";
import { Lock, Mail, MapPin, Phone, ShieldCheck } from "lucide-react";

/**
 * Storefront footer.
 *
 * Shares the navy surface with the homepage trust band, so the dark treatment
 * reads as one deliberate system rather than a one-off. The "Nexo family" line
 * lives here at hairline scale: it states the relationship without ever turning
 * an automotive sales page into a trailer-rental page.
 *
 * The language switcher is repeated here on purpose — a visitor who has read to
 * the bottom of a long page should not have to scroll back up to change
 * language. The bundle is rebuilt locally from the request language rather than
 * passed in, since functions cannot cross into the client component.
 */

interface PublicFooterProps {
  dealerInfo?: PublicDealerInfo | null;
  language: Language;
}

export function PublicFooter({ dealerInfo, language }: PublicFooterProps) {
  const s = strings(language);
  const name = dealerInfo?.name?.trim() || s.t("meta.siteName");
  const phone = dealerInfo?.phone?.trim() || null;
  const email = dealerInfo?.email?.trim() || null;
  const address = [dealerInfo?.addressLine1, dealerInfo?.city, dealerInfo?.state, dealerInfo?.postalCode]
    .filter(Boolean)
    .join(", ");

  const year = new Date().getFullYear();

  const exploreLinks = [
    { href: "/inventory", key: "footer.browseInventory" },
    { href: `/#${SECTION_IDS.howItWorks}`, key: "footer.howItWorks" },
    { href: `/#${SECTION_IDS.buyingOptions}`, key: "footer.buyingOptions" },
    { href: `/#${SECTION_IDS.whyNexo}`, key: "footer.whyNexo" },
  ] as const;

  return (
    <footer className="brand-panel mt-auto">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-14">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand */}
          <div className="space-y-4 lg:col-span-2">
            <Link href="/" className="inline-flex rounded-lg" aria-label={s.tc("nav.home", { name })}>
              <span className="inline-flex items-center gap-2.5">
                <NexoMark className="h-9 w-9 shrink-0 rounded-[10px]" />
                <span className="flex flex-col leading-none">
                  <span className="text-base font-extrabold tracking-tight text-white">{name.toUpperCase()}</span>
                  <span className="mt-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400">
                    {s.t("meta.tagline")}
                  </span>
                </span>
              </span>
            </Link>

            <p className="max-w-sm text-sm leading-relaxed text-slate-300">
              {dealerInfo?.tagline?.trim() || s.t("footer.taglineFallback")}
            </p>

            <NexoFamilyNote
              tone="dark"
              text={s.tc("brand.familyNote", { family: s.t("brand.familyName") })}
            />

            <LanguageSwitcher
              language={language}
              label={s.t("language.label")}
              switchToLabel={s.t("language.switchTo")}
              tone="dark"
            />
          </div>

          {/* Navigation */}
          <nav aria-label={s.t("footer.explore")} className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-white">{s.t("footer.explore")}</h2>
            <ul className="space-y-2 text-sm">
              {exploreLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-slate-300 transition-colors hover:text-orange-400">
                    {s.t(link.key)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* Contact */}
          <div className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-white">{s.t("footer.talkToUs")}</h2>

            {phone || email || address ? (
              <ul className="space-y-3 text-sm text-slate-300">
                {phone && (
                  <li>
                    <a
                      href={`tel:${phone.replace(/[^+\d]/g, "")}`}
                      className="inline-flex items-center gap-2 transition-colors hover:text-orange-400"
                    >
                      <Phone className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                      <span>{phone}</span>
                    </a>
                  </li>
                )}
                {email && (
                  <li>
                    <a
                      href={`mailto:${email}`}
                      className="inline-flex items-center gap-2 break-all transition-colors hover:text-orange-400"
                    >
                      <Mail className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                      <span>{email}</span>
                    </a>
                  </li>
                )}
                {address && (
                  <li className="flex items-start gap-2">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                    <span>{address}</span>
                  </li>
                )}
              </ul>
            ) : (
              <p className="text-sm leading-relaxed text-slate-400">{s.t("footer.noContact")}</p>
            )}

            <p className="inline-flex items-start gap-2 pt-1 text-[11px] text-slate-500">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{s.t("footer.financeNote")}</span>
            </p>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-10 flex flex-col gap-3 border-t border-white/10 pt-6 text-[11px] text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <p>{s.tc("footer.rights", { year, name })}</p>
          <Link
            href="/admin/login"
            className="inline-flex items-center gap-1.5 text-slate-500 transition-colors hover:text-slate-300"
          >
            <Lock className="h-3 w-3" aria-hidden="true" />
            <span>{s.t("nav.operatorSignIn")}</span>
          </Link>
        </div>
      </div>
    </footer>
  );
}
