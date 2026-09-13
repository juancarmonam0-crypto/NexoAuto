import { type PublicStrings } from "@/lib/i18n/catalog";
import { BUYING_OPTIONS, SECTION_IDS } from "@/lib/i18n/public-content";
import { RichHeading } from "@/app/_components/RichHeading";
import { SectionIntro } from "@/app/_components/HomeSection";
import { Reveal } from "@/app/_components/Reveal";

/**
 * BUYING OPTIONS — the navy ledger.
 *
 * On mobile the options are swipeable cards with mandatory snap. On desktop
 * they retain the compact numbered-ledger treatment inside the navy slab.
 *
 * WHY THE SLAB IS SHAPED THIS WAY
 * It is full-bleed with a large radius on its top edge and pulled 32px up over
 * the section above it, so the dark band rises out of the light section instead
 * of butting against it. The bottom edge stays square, which is what keeps it a
 * structural band rather than another floating card — and it means the closing
 * panel below can be a floating card without the two reading as a repeat.
 *
 * THE ROWS ARE NOT INTERACTIVE, so they do not pretend to be: no hover
 * background, no cursor change, no fake affordance. The motion in this section
 * is the entrance stagger alone.
 *
 * HONESTY: every line states a mechanism the dealership can actually describe
 * ("apply with a lender", "bring a budget"), never an outcome. The required
 * disclaimer is part of the composition rather than buried at its foot.
 */
export function HomeBuyingOptions({ s }: { s: PublicStrings }) {
  return (
    <section
      id={SECTION_IDS.buyingOptions}
      aria-labelledby="home-options-heading"
      className="brand-panel relative z-10 -mt-8 rounded-t-[2rem] sm:rounded-t-[2.75rem]"
    >
      <div className="mx-auto max-w-6xl px-4 pb-9 pt-11 sm:px-6 sm:pb-12 sm:pt-16">
        <div className="grid grid-cols-1 gap-7 sm:gap-9 lg:grid-cols-12 lg:gap-12">
          <Reveal className="lg:col-span-5">
            <SectionIntro
              index="03"
              label={s.t("home.options.eyebrow")}
              tone="dark"
              titleId="home-options-heading"
              title={
                <RichHeading
                  as="span"
                  runs={s.rich("home.options.title")}
                  emphasisClassName="text-orange-400"
                />
              }
              body={s.t("home.options.subtitle")}
            />
          </Reveal>

          <div className="lg:col-span-7">
            <ul className="snap-rail -mx-4 flex gap-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 lg:mx-0 lg:block lg:overflow-visible lg:border-b lg:border-white/10 lg:px-0 lg:pb-0">
              {BUYING_OPTIONS.map((option, index) => {
                const Icon = option.icon;

                return (
                  <li
                    key={option.titleKey}
                    className="snap-item basis-[calc(100%-3.5rem)] shrink-0 rounded-2xl border border-white/15 border-t-2 border-t-orange-400/80 bg-gradient-to-br from-white/[0.09] to-white/[0.035] p-5 shadow-[0_18px_40px_-28px_rgba(0,0,0,0.8)] sm:basis-[calc(100%-5rem)] sm:p-6 lg:min-h-0 lg:basis-auto lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none"
                  >
                    <Reveal delay={index * 80}>
                      <div className="grid grid-cols-[2.25rem_1fr_auto] items-start gap-3 sm:grid-cols-[2.75rem_1fr_auto] sm:gap-5 lg:border-t lg:border-white/10 lg:py-6">
                        <span
                          aria-hidden="true"
                          className="pt-0.5 font-mono text-xs font-bold tracking-[0.14em] text-orange-400"
                        >
                          {String(index + 1).padStart(2, "0")}
                        </span>

                        <div>
                          <h3 className="text-base font-bold tracking-tight text-white sm:text-[17px]">
                            {s.t(option.titleKey)}
                          </h3>
                          <p className="mt-1 text-sm leading-relaxed text-slate-300">
                            {s.t(option.bodyKey)}
                          </p>
                        </div>

                        <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] lg:h-auto lg:w-auto lg:border-0 lg:bg-transparent">
                          <Icon className="h-4 w-4 shrink-0 text-orange-300 lg:h-5 lg:w-5 lg:text-slate-400" aria-hidden="true" />
                        </span>
                      </div>
                    </Reveal>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        {/* Required honesty note — present, and part of the composition. */}
        <Reveal delay={60} className="mt-7 border-t border-white/10 pt-5 sm:mt-9 sm:pt-6">
          <p className="max-w-3xl text-[11px] leading-relaxed text-slate-400">
            <span className="font-semibold text-slate-300">{s.t("home.options.disclaimerLabel")}</span>{" "}
            {s.t("home.options.disclaimer")}
          </p>
        </Reveal>
      </div>
    </section>
  );
}
