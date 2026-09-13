import Link from "next/link";
import type { CSSProperties } from "react";
import { ArrowRight } from "lucide-react";
import { type PublicStrings } from "@/lib/i18n/catalog";
import { HERO_ASSURANCES, SECTION_IDS } from "@/lib/i18n/public-content";
import { RichHeading } from "@/app/_components/RichHeading";
import {
  NEXO_HERO_FALLBACK_SRC,
  NEXO_HERO_FALLBACK_SRC_SET,
  NEXO_HERO_HEIGHT,
  NEXO_HERO_WEBP_SRC_SET,
  NEXO_HERO_WIDTH,
} from "@/app/_components/brand";

/**
 * One stagger step of the hero's entrance. The delay is a CSS custom property
 * (see `.rise` in `globals.css`) so the whole choreography stays in the
 * stylesheet and nothing here needs to be a client component.
 */
function riseStep(ms: number): CSSProperties {
  return { "--rise-delay": `${ms}ms` } as CSSProperties;
}

/**
 * The hero.
 *
 * COMPOSITION — the approved artwork IS the section background, at every size:
 * the artwork puts the vehicle on the RIGHT and leaves the LEFT genuinely
 * bright, so the real HTML headline, supporting copy and CTAs sit in that
 * negative space. The image is never cropped into a card, never covered by a
 * navy scrim, and never carries baked text — everything readable here is live,
 * selectable, translatable HTML.
 *
 * RESPONSIVE COMPOSITION — one image, one background, no second artwork:
 *   ≥ lg   : cropped to favour the car on the right, copy over the bright left.
 *   < lg   : the SAME image stays behind the copy, cropped toward the vehicle,
 *            with a contrast fade across the artwork that keeps the live text
 *            readable over it.
 *
 * DELIVERY — the artwork is served at the width the viewport actually needs (see
 * `brand.tsx`): the approved 1.85 MB PNG is never sent to a browser that can take
 * a 27–107 KB WebP. `sizes="100vw"` is accurate because the image is the
 * full-bleed background at every size, and the approved original remains the
 * largest candidate, so a display wider than 1672px still gets full resolution.
 * No `<link rel=preload>`: the correct candidate depends on the viewport and the
 * device pixel ratio, which the server cannot know, and preloading the wrong one
 * would download bytes twice.
 *
 * MOTION — the only place on the page where content is animated on load instead
 * of on scroll, and it is done in pure CSS (`.rise` + `--rise-delay`): the
 * eyebrow, headline, supporting copy, actions and spec strip arrive in one
 * 300ms stagger. No JavaScript is shipped for the first screen, the animation
 * has no overshoot, and `prefers-reduced-motion` removes it entirely.
 *
 * The artwork itself is deliberately NOT animated: it is the largest contentful
 * paint on the page, and animating it would push back the moment the car
 * appears. The car is simply there; the words arrive.
 *
 * THEME — the left of the artwork is light in both modes, so the copy stays deep
 * navy and legible without a scrim. Dark mode tints the surrounding band and the
 * dividers rather than the photograph, keeping the vehicle's natural colour.
 *
 * LCP — this is the largest contentful element on the page, so it is eager,
 * high-priority and dimensioned to reserve its box (no layout shift).
 */
export function HomeHero({ s, ctaHref = "/inventory" }: { s: PublicStrings; ctaHref?: string }) {
  return (
    <section className="relative isolate overflow-hidden border-b border-slate-200/70 bg-white dark:border-white/10 dark:bg-[var(--brand-navy-950)]">
      {/* --- The approved artwork is the section background at every size ---- */}
      <div className="absolute inset-0">
        <picture className="block h-full w-full">
          <source type="image/webp" srcSet={NEXO_HERO_WEBP_SRC_SET} sizes="100vw" />
          <img
            src={NEXO_HERO_FALLBACK_SRC}
            srcSet={NEXO_HERO_FALLBACK_SRC_SET}
            sizes="100vw"
            alt=""
            aria-hidden="true"
            width={NEXO_HERO_WIDTH}
            height={NEXO_HERO_HEIGHT}
            // Above the fold and the LCP element: never lazy, always high priority.
            loading="eager"
            decoding="async"
            fetchPriority="high"
            // Mobile favours the vehicle; desktop lets the copy own the left.
            className="h-full w-full object-cover object-[70%_50%] lg:object-right"
          />
        </picture>
        {/*
          A short, soft fade on the far left only — it extends the artwork's own
          negative space so long Spanish lines stay readable. It is a gradient,
          not a panel: the car and skyline remain fully visible.
        */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-r from-white via-white/90 to-white/35 dark:from-[var(--brand-navy-950)] dark:via-[var(--brand-navy-950)]/90 dark:to-[var(--brand-navy-950)]/35 lg:right-auto lg:w-[64%] lg:to-transparent"
        />
        {/*
          The seam into the inventory section. A hard border under a photograph
          reads as a cropped image; this 64px of fading light hands the page over
          to the showroom floor instead.
        */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-[var(--surface-page)]"
        />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid grid-cols-1 gap-8 pb-12 pt-10 sm:gap-10 sm:pb-16 sm:pt-14 lg:grid-cols-12 lg:gap-8 lg:pb-24 lg:pt-20">
          {/* --- Copy column: the artwork's intended negative space --------- */}
          <div className="lg:col-span-6">
            <p
              className="rise flex items-center gap-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-orange-600 dark:text-orange-400"
              style={riseStep(0)}
            >
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-orange-600 dark:bg-orange-500" />
              {s.t("home.hero.eyebrow")}
            </p>

            {/*
              The page's only H1. The artwork's H1 is this text; nothing is baked
              into the image, so it is translatable, selectable and indexable.
            */}
            <div className="rise" style={riseStep(70)}>
              <RichHeading
                as="h1"
                runs={s.rich("home.hero.headline")}
                className="mt-4 text-[2.35rem] font-extrabold leading-[1.03] tracking-[-0.02em] text-[var(--brand-navy-900)] sm:text-[3.25rem] lg:text-[3.6rem] dark:text-white"
                emphasisClassName="text-orange-600 dark:text-orange-500"
              />
            </div>

            <p
              className="rise mt-5 max-w-lg text-[15px] leading-relaxed text-slate-600 sm:text-base dark:text-slate-300"
              style={riseStep(150)}
            >
              {s.t("home.hero.subtext")}
            </p>

            <div className="rise mt-7 flex flex-col gap-3 sm:flex-row sm:items-center" style={riseStep(230)}>
              {/* Primary action: one accent colour on the whole page. */}
              <Link
                href={ctaHref}
                className="group/cta inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-orange-600 px-6 text-sm font-semibold text-white shadow-[0_14px_30px_-16px_rgba(234,88,12,0.9)] transition-colors hover:bg-orange-700 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <span>{s.t("home.hero.primaryCta")}</span>
                <ArrowRight
                  className="motion-nudge h-4 w-4 transition-transform duration-300 group-hover/cta:translate-x-1"
                  aria-hidden="true"
                />
              </Link>

              <Link
                href={`#${SECTION_IDS.journey}`}
                className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-300 bg-white/80 px-6 text-sm font-semibold text-[var(--brand-navy-900)] backdrop-blur-sm transition-colors hover:bg-white dark:border-white/20 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
              >
                {s.t("home.hero.secondaryCta")}
              </Link>
            </div>

            {/*
              The spec strip. Three hairline-separated pairs that read like a
              vehicle specification sheet rather than three trust badges — and
              every line describes something the listing actually contains.
            */}
            <dl
              className="rise mt-9 grid grid-cols-1 gap-x-6 gap-y-4 border-t border-slate-200/80 pt-6 sm:grid-cols-3 dark:border-white/10"
              style={riseStep(310)}
            >
              {HERO_ASSURANCES.map((item) => (
                <div
                  key={item.key}
                  className="sm:border-l sm:border-slate-200/80 sm:pl-5 sm:first:border-l-0 sm:first:pl-0 dark:sm:border-white/10"
                >
                  <dt className="text-[13px] font-semibold leading-tight text-[var(--brand-navy-900)] dark:text-white">
                    {s.t(item.key)}
                  </dt>
                  <dd className="mt-1 text-[11px] leading-tight text-slate-600 dark:text-slate-400">
                    {s.t(item.bodyKey)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}
