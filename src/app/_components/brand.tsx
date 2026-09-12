/**
 * Shared brand primitives for the public surface.
 *
 * There is no binary logo asset in this repository, so the mark is drawn as a
 * component: a navy tile holding the "nexo" glyph — three parallel strokes with
 * the middle one in the accent orange — plus a short motion bar. It reads as
 * confident geometry at 16px and stays recognisable as an app icon.
 *
 * `public/icon.svg` carries the identical drawing for favicon and app-icon use.
 * Replacing both with an approved asset later is a two-file change.
 *
 * `NexoLogo` is the one lockup the header uses, so the wordmark, sub-line and
 * tile spacing can never drift between pages. Copy arrives as already-translated
 * text, which keeps this module free of any language decisions.
 */

const MARK_GRADIENT_ID = "nexo-mark-gradient";

export type LogoSize = "sm" | "md" | "lg";

/** Tile and wordmark scale together so the lockup never distorts. */
const SIZES: Record<LogoSize, { tile: string; word: string; sub: string; gap: string }> = {
  sm: { tile: "h-8 w-8 rounded-lg", word: "text-sm", sub: "text-[9px]", gap: "gap-2" },
  md: { tile: "h-9 w-9 rounded-[10px]", word: "text-base", sub: "text-[10px]", gap: "gap-2.5" },
  lg: { tile: "h-11 w-11 rounded-xl", word: "text-lg", sub: "text-[11px]", gap: "gap-3" },
};

/** The standalone tile, for places that show the mark without the wordmark. */
export function NexoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-label="Nexo" focusable="false">
      <defs>
        <linearGradient id={MARK_GRADIENT_ID} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--brand-navy-800, #123058)" />
          <stop offset="100%" stopColor="var(--brand-navy-950, #071a33)" />
        </linearGradient>
      </defs>

      <rect width="32" height="32" rx="9" fill={`url(#${MARK_GRADIENT_ID})`} />

      {/* Three parallel strokes: the "nexo" glyph, middle stroke in accent. */}
      <g fill="none" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round">
        <path d="M7 22 L11 12" />
        <path d="M19 22 L23 12" />
      </g>
      <path
        d="M13 22 L17 12"
        fill="none"
        stroke="var(--brand-orange-500, #f97316)"
        strokeWidth="2.6"
        strokeLinecap="round"
      />

      {/* Motion bar, echoing the accent and tying the mark to the CTAs. */}
      <path
        d="M20.5 25.5 H25"
        fill="none"
        stroke="var(--brand-orange-500, #f97316)"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface NexoLogoProps {
  /** Live dealer name; falls back to the brand default. */
  name?: string | null;
  /** The translated sub-line under the wordmark. */
  tagline?: string | null;
  size?: LogoSize;
  /** Renders the wordmark beside the mark. `false` gives just the tile. */
  showWordmark?: boolean;
  /** Accessible name for the surrounding link, already translated. */
  ariaLabel?: string;
  className?: string;
}

export function NexoLogo({
  name,
  tagline,
  size = "md",
  showWordmark = true,
  ariaLabel,
  className = "",
}: NexoLogoProps) {
  const s = SIZES[size];
  const label = (name?.trim() || "Nexo Auto").toUpperCase();

  return (
    <span className={`inline-flex items-center ${s.gap} ${className}`} aria-label={ariaLabel}>
      <NexoMark className={`${s.tile} shrink-0 shadow-sm`} />
      {showWordmark && (
        <span className="flex flex-col leading-none">
          <span className={`font-extrabold tracking-tight text-slate-900 ${s.word}`}>{label}</span>
          {tagline && (
            <span className={`mt-0.5 font-mono font-medium uppercase tracking-[0.16em] text-slate-400 ${s.sub}`}>
              {tagline}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

/**
 * The inline "part of the Nexo family" line.
 *
 * A single hairline row with a small accent dot: the Nexo family story belongs
 * on the page, but this is an automotive sales site and must never read as
 * trailer rental. The sentence is passed in already translated.
 */
export function NexoFamilyNote({
  text,
  tone = "light",
  className = "",
}: {
  text: string;
  /** `light` = on white surfaces, `dark` = on the navy panel. */
  tone?: "light" | "dark";
  className?: string;
}) {
  const base = tone === "dark" ? "text-slate-400" : "text-slate-500";

  return (
    <p className={`inline-flex items-start gap-2 text-[11px] font-medium ${base} ${className}`}>
      <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
}
