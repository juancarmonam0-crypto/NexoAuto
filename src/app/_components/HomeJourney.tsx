import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { type PublicStrings } from "@/lib/i18n/catalog";
import { JOURNEY_STEPS, SECTION_IDS } from "@/lib/i18n/public-content";
import { SectionIntro } from "@/app/_components/HomeSection";
import { Reveal } from "@/app/_components/Reveal";

/**
 * HOW IT WORKS — the route.
 *
 * The previous version of this section was a four-card grid, and directly below
 * it sat another four-card grid (buying options). Two identical card rows in a
 * row is what made the page read as assembled from components, so this section
 * now has its own grammar: a single connected track with four numbered stops.
 *
 * The number IS the design here. A four-stop route says "this is a sequence,
 * and it ends with you driving" in a way that four equal boxes cannot, and it
 * costs one hairline and four circles instead of four bordered cards.
 *
 * RESPONSIVE
 *   ≥ lg : the track runs horizontally, stops evenly spaced, copy centred under
 *          each one.
 *   < lg : the stops become swipeable cards with mandatory snap, keeping one
 *          step in focus while the next card peeks into view.
 *
 * MOTION — the track draws itself left-to-right (or top-to-bottom) once, and the
 * four stops arrive in a 90ms stagger as the section comes into view. The draw
 * is a single transform, so it stays on the compositor and costs nothing while
 * the visitor scrolls.
 */
export function HomeJourney({ s }: { s: PublicStrings }) {
  return (
    <section
      id={SECTION_IDS.journey}
      aria-labelledby="home-journey-heading"
      className="bg-white dark:bg-[var(--brand-navy-900)]/40"
    >
      {/*
        The bottom padding is deliberately larger than the top: the navy
        buying-options slab below is pulled 32px up over this section to make its
        curve an overlap rather than a seam, and that 32px has to come out of
        empty space rather than out of the gap under the last link.
      */}
      <div className="mx-auto max-w-6xl px-4 pb-20 pt-12 sm:px-6 sm:pb-24 sm:pt-16 lg:pb-28 lg:pt-20">
        <Reveal>
          <SectionIntro
            index="02"
            label={s.t("home.journey.eyebrow")}
            title={s.t("home.journey.title")}
            titleId="home-journey-heading"
            body={s.t("home.journey.subtitle")}
          />
        </Reveal>

        {/*
          The outer reveal arms the track (so the line draws when the route
          arrives); each stop carries its own reveal for the stagger.
        */}
        <Reveal className="relative mt-10 sm:mt-12">
          <span
            aria-hidden="true"
            className="track-line absolute left-[11.7%] right-[11.7%] top-[22px] hidden h-px bg-gradient-to-r from-orange-500 via-orange-500/45 to-slate-200 lg:block dark:to-white/15"
          />

          <ol className="snap-rail relative -mx-4 flex gap-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 lg:mx-0 lg:grid lg:grid-cols-4 lg:gap-6 lg:overflow-visible lg:px-0 lg:pb-0">
            {JOURNEY_STEPS.map((step, index) => {
              const Icon = step.icon;

              return (
                <li
                  key={step.titleKey}
                  className="snap-item surface-plate basis-[calc(100%-3.5rem)] shrink-0 rounded-[24px] border-t-2 border-t-orange-500 p-5 sm:basis-[calc(100%-5rem)] sm:p-6 lg:min-h-0 lg:basis-auto lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none dark:lg:bg-transparent dark:lg:shadow-none"
                >
                  <Reveal delay={index * 90} className="relative flex gap-4 lg:block">
                    <span className="relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white font-mono text-sm font-extrabold text-[var(--brand-navy-900)] shadow-[0_1px_2px_rgba(15,23,42,0.06)] lg:mx-auto dark:border-white/15 dark:bg-[var(--brand-navy-950)] dark:text-white">
                      {String(index + 1).padStart(2, "0")}
                    </span>

                    <div className="lg:mt-5 lg:text-center">
                      <h3 className="flex items-center gap-2 text-base font-bold tracking-tight text-[var(--brand-navy-900)] lg:justify-center dark:text-white">
                        <Icon className="h-4 w-4 shrink-0 text-orange-600 dark:text-orange-400" aria-hidden="true" />
                        {s.t(step.titleKey)}
                      </h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-slate-600 lg:mx-auto lg:max-w-[15rem] dark:text-slate-300">
                        {s.t(step.bodyKey)}
                      </p>
                    </div>
                  </Reveal>
                </li>
              );
            })}
          </ol>
        </Reveal>

        {/*
          The route's destination is the next section, so the action here is a
          link onward rather than a fourth orange button repeating "Browse cars".
          The page keeps its strong buttons for the hero and the closing panel.
        */}
        <Reveal delay={120} className="mt-10 sm:mt-12">
          <Link
            href={`#${SECTION_IDS.buyingOptions}`}
            className="group/next inline-flex items-center gap-2 text-sm font-semibold text-orange-700 transition-colors hover:text-orange-800 dark:text-orange-400 dark:hover:text-orange-300"
          >
            <span className="border-b border-orange-300/70 pb-0.5 dark:border-orange-500/40">
              {s.t("home.journey.cta")}
            </span>
            <ArrowRight
              className="motion-nudge h-4 w-4 transition-transform duration-300 group-hover/next:translate-x-1"
              aria-hidden="true"
            />
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
