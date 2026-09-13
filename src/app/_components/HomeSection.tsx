import type { ReactNode } from "react";

/**
 * SECTION MARKER — the landing's connective tissue.
 *
 * Every content section opens with the same three-part mark: its position in
 * the page ("01"), a hairline, then the section's own name. That single repeated
 * device is what makes visually different sections read as one continuous,
 * art-directed document rather than separately designed blocks — the visitor can
 * always tell where they are without every section looking alike.
 *
 * The number is real information (it is the page's order), so it is not hidden
 * from assistive technology. The hairline is decoration, so it is.
 */

export type MarkerTone = "light" | "dark";

interface SectionMarkerProps {
  /** The section's one-based position on the page, already zero-padded. */
  index: string;
  /** The section's name, already translated. */
  label: string;
  /** `dark` is the navy slab, where the ink has to invert. */
  tone?: MarkerTone;
}

export function SectionMarker({ index, label, tone = "light" }: SectionMarkerProps) {
  const dark = tone === "dark";

  return (
    <p className="flex items-center gap-3">
      <span
        className={`font-mono text-[11px] font-bold tracking-[0.2em] ${
          dark ? "text-orange-400" : "text-orange-600 dark:text-orange-400"
        }`}
      >
        {index}
      </span>
      <span
        aria-hidden="true"
        className={`h-px w-7 shrink-0 ${dark ? "bg-white/25" : "bg-slate-300 dark:bg-white/20"}`}
      />
      <span
        className={`font-mono text-[11px] font-bold uppercase tracking-[0.18em] ${
          dark ? "text-slate-400" : "text-slate-500 dark:text-slate-400"
        }`}
      >
        {label}
      </span>
    </p>
  );
}

interface SectionIntroProps {
  index: string;
  label: string;
  /**
   * The heading CONTENT. A plain string, or `<RichHeading as="span">` when the
   * dictionary marks a phrase for the orange emphasis treatment. The `<h2>`
   * itself belongs to this component so every section keeps real heading
   * semantics and a consistent typographic rhythm.
   */
  title: ReactNode;
  body?: ReactNode;
  tone?: MarkerTone;
  /** Set on the `<h2>`, so a section can point `aria-labelledby` at it. */
  titleId?: string;
  className?: string;
  titleClassName?: string;
  bodyClassName?: string;
}

export function SectionIntro({
  index,
  label,
  title,
  body,
  tone = "light",
  titleId,
  className = "",
  titleClassName = "",
  bodyClassName = "max-w-2xl",
}: SectionIntroProps) {
  const dark = tone === "dark";

  return (
    <div className={className}>
      <SectionMarker index={index} label={label} tone={tone} />
      <h2
        id={titleId}
        className={`mt-4 text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl ${
          dark ? "text-white" : "text-[var(--brand-navy-900)] dark:text-white"
        } ${titleClassName}`}
      >
        {title}
      </h2>
      {body && (
        <p
          className={`mt-3 text-sm leading-relaxed sm:text-base ${
            dark ? "text-slate-300" : "text-slate-600 dark:text-slate-300"
          } ${bodyClassName}`}
        >
          {body}
        </p>
      )}
    </div>
  );
}
