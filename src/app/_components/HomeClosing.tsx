import Link from "next/link";
import { ArrowRight, Mail, Phone } from "lucide-react";
import { type PublicStrings } from "@/lib/i18n/catalog";
import { RichHeading } from "@/app/_components/RichHeading";
import { Reveal } from "@/app/_components/Reveal";
import {
  NEXO_HERO_HEIGHT,
  NEXO_HERO_LOCAL,
  NEXO_HERO_WIDTH,
} from "@/app/_components/brand";

/**
 * THE CLOSING MOMENT — the page's handshake.
 *
 * Without this section the landing simply stopped after the brand story: the
 * last thing a visitor read was information, and the next thing they saw was
 * the footer. Now the page ends on one clear, calm statement of the whole
 * promise — find the car, see the price, choose how to pay — and the two things
 * a visitor can actually do about it.
 *
 * COMPOSITION — the hero, answered. The page opens with the approved artwork and
 * the car on the right; it closes with the same artwork, cropped tighter and
 * held inside a navy plate on the right of a floating panel. It is a bookend,
 * not a second hero: the image is clipped by the panel's radius and carries a
 * navy gradient, so it reads as a material the brand owns rather than as a
 * photograph competing with the copy.
 *
 * The panel is inset and fully rounded, which is deliberately a different shape
 * from the full-bleed buying-options band above it.
 *
 * Only real destinations appear here. If the dealership has configured a phone
 * number or an email address, that action is offered; if it has not, the visitor
 * gets the one action that always works.
 */
export function HomeClosing({
  s,
  phone,
  email,
  name,
}: {
  s: PublicStrings;
  phone: string | null;
  email: string | null;
  name: string;
}) {
  const telHref = phone ? `tel:${phone.replace(/[^+\d]/g, "")}` : null;
  const mailHref = email
    ? `mailto:${email}?subject=${encodeURIComponent(s.tc("home.inventory.empty.mailSubject", { name }))}`
    : null;

  return (
    <section aria-labelledby="home-closing-heading" className="pb-14 sm:pb-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal motion="fade">
          <div className="brand-panel relative isolate overflow-hidden rounded-[24px] sm:rounded-[32px]">
            {/*
              The artwork bookend. Desktop only: on a phone the panel is copy and
              two buttons, and nothing competes with that.
            */}
            <div aria-hidden="true" className="absolute inset-y-0 right-0 hidden w-[46%] lg:block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={NEXO_HERO_LOCAL}
                alt=""
                width={NEXO_HERO_WIDTH}
                height={NEXO_HERO_HEIGHT}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover object-[76%_42%]"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-[var(--brand-navy-900)] via-[var(--brand-navy-900)]/65 to-[var(--brand-navy-900)]/25" />
            </div>

            <span aria-hidden="true" className="absolute left-8 top-0 h-px w-16 bg-orange-500 sm:left-10" />

            <div className="relative max-w-xl px-6 py-12 sm:px-10 sm:py-14 lg:max-w-[36rem] lg:py-16">
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-orange-400">
                {s.t("home.closing.eyebrow")}
              </p>

              <RichHeading
                as="h2"
                id="home-closing-heading"
                runs={s.rich("home.closing.title")}
                className="mt-4 text-[1.75rem] font-extrabold leading-[1.08] tracking-[-0.02em] text-white sm:text-[2.15rem] lg:text-[2.4rem]"
                emphasisClassName="text-orange-400"
              />

              <p className="mt-5 max-w-md text-sm leading-relaxed text-slate-300 sm:text-base">
                {s.t("home.closing.body")}
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
                <Link
                  href="/inventory"
                  className="group/cta inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-orange-600 px-6 text-sm font-semibold text-white shadow-[0_14px_30px_-16px_rgba(234,88,12,0.9)] transition-colors hover:bg-orange-700"
                >
                  <span>{s.t("home.closing.primaryCta")}</span>
                  <ArrowRight
                    className="motion-nudge h-4 w-4 transition-transform duration-300 group-hover/cta:translate-x-1"
                    aria-hidden="true"
                  />
                </Link>

                {phone && telHref && (
                  <a
                    href={telHref}
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/5 px-5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
                  >
                    <Phone className="h-4 w-4 text-orange-400" aria-hidden="true" />
                    <span>{s.tc("home.closing.callCta", { phone })}</span>
                  </a>
                )}

                {mailHref && (
                  <a
                    href={mailHref}
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/5 px-5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
                  >
                    <Mail className="h-4 w-4 text-orange-400" aria-hidden="true" />
                    <span>{s.t("home.closing.emailCta")}</span>
                  </a>
                )}
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
