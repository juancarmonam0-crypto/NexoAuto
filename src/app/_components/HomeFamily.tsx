import { type PublicStrings } from "@/lib/i18n/catalog";
import { SECTION_IDS } from "@/lib/i18n/public-content";
import { RichHeading } from "@/app/_components/RichHeading";
import { SectionIntro } from "@/app/_components/HomeSection";
import { Reveal } from "@/app/_components/Reveal";
import { NexoFamilyNote, NexoMark } from "@/app/_components/brand";

/**
 * THE NEXO FAMILY — the brand plate.
 *
 * The page's one purely brand section, and the one place where nothing is for
 * sale. It is set as a light editorial split: the story on the left, and on the
 * right a navy plate carrying the owner-approved mark and the family line.
 *
 * There is no second photograph here on purpose. Stopping the page's photography
 * for one section is what makes this read as the brand beat rather than as
 * another row of content, and it keeps the section honest — no stock image is
 * invented to fill the column.
 *
 * This section carries NO call to action. The hero already asked the visitor to
 * browse, and the closing panel immediately below asks again with somewhere to
 * go; a third orange button here would only dilute both.
 */
export function HomeFamily({ s, name }: { s: PublicStrings; name: string }) {
  return (
    <section
      id={SECTION_IDS.family}
      aria-labelledby="home-family-heading"
      /*
        No bottom hairline: the family story and the closing panel sit on the
        same canvas, and a full-bleed rule across two sections of identical
        colour would draw a division that is not there. The navy slab above ends
        this section; the closing panel below begins the next beat.
      */
      className=""
    >
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16 lg:py-20">
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-14">
          <Reveal className="lg:col-span-7">
            <SectionIntro
              index="04"
              label={s.t("home.family.eyebrow")}
              titleId="home-family-heading"
              title={
                <RichHeading
                  as="span"
                  runs={s.rich("home.family.title")}
                  emphasisClassName="text-orange-600 dark:text-orange-500"
                />
              }
              titleClassName="sm:text-4xl"
              body={s.t("home.family.body")}
              bodyClassName="max-w-2xl"
            />
          </Reveal>

          <Reveal delay={140} motion="fade" className="lg:col-span-5">
            <div className="brand-panel relative overflow-hidden rounded-[26px] p-7 sm:p-8">
              {/* A single soft accent, the same device the rest of the page uses. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-orange-500/15 blur-3xl"
              />
              <span aria-hidden="true" className="absolute left-7 top-0 h-px w-14 bg-orange-500 sm:left-8" />

              <div className="relative space-y-6">
                <div className="flex items-center gap-3">
                  <NexoMark size={40} className="rounded-[10px]" />
                  <div className="flex min-w-0 flex-col leading-none">
                    <span className="truncate text-base font-extrabold tracking-tight text-white">
                      {name.toUpperCase()}
                    </span>
                    <span className="mt-1 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">
                      {s.t("meta.tagline")}
                    </span>
                  </div>
                </div>

                <NexoFamilyNote
                  tone="dark"
                  text={s.tc("brand.familyNote", { family: s.t("brand.familyName") })}
                />
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
