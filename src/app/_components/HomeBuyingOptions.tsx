import { type PublicStrings } from "@/lib/i18n/catalog";
import { BUYING_OPTIONS, SECTION_IDS } from "@/lib/i18n/public-content";
import { RichHeading } from "@/app/_components/RichHeading";
import { SectionIntro } from "@/app/_components/HomeSection";
import { Reveal } from "@/app/_components/Reveal";

/**
 * BUYING OPTIONS — the navy ledger.
 *
 * The third grammar on the page, and deliberately not a card grid: these four
 * options are not four independent things to compare, they are four entries in
 * one list of ways to pay. So they are set as a ledger — a numbered index, a
 * hairline rule, a title and one line of mechanism — inside the brand's navy
 * slab.
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
      <div className="mx-auto max-w-6xl px-4 pb-12 pt-14 sm:px-6 sm:pb-16 sm:pt-20">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-12">
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
            <ul className="border-b border-white/10">
              {BUYING_OPTIONS.map((option, index) => {
                const Icon = option.icon;

                return (
                  <li key={option.titleKey}>
                    <Reveal delay={index * 80}>
                      <div className="grid grid-cols-[2.25rem_1fr_auto] items-start gap-4 border-t border-white/10 py-5 sm:grid-cols-[2.75rem_1fr_auto] sm:gap-5 sm:py-6">
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

                        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
                      </div>
                    </Reveal>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        {/* Required honesty note — present, and part of the composition. */}
        <Reveal delay={60} className="mt-10 border-t border-white/10 pt-6">
          <p className="max-w-3xl text-[11px] leading-relaxed text-slate-400">
            <span className="font-semibold text-slate-300">{s.t("home.options.disclaimerLabel")}</span>{" "}
            {s.t("home.options.disclaimer")}
          </p>
        </Reveal>
      </div>
    </section>
  );
}
