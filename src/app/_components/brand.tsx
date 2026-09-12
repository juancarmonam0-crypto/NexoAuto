/**
 * The Nexo Auto brand lockup.
 *
 * THE MARK IS THE OWNER-SUPPLIED ASSET. It is not drawn, redrawn, recoloured,
 * re-exported or substituted here — the approved file is rendered as-is:
 *
 *   public/brand/85ea2b4f-556e-4a9e-926d-721fd2328e78.png
 *   byte-identical to the approved object
 *   (SHA-256 a42c8bc65b6341df20550d1e8b9b203b88c7433bd939f7f9aa9d8fd1a7de0f5e)
 *
 * WHY THE FILE IS BUNDLED RATHER THAN HOT-LINKED
 * The approved asset was published on the owner's Supabase bucket. During this
 * phase that public object stopped resolving — the Storage API answers
 * `404 NoSuchKey` for it — and its `/render/image` transformation endpoint was
 * never enabled on that bucket (every request returns 400). A header logo or a
 * favicon that 404s is worse than a large one, so the app serves the approved
 * bytes from `public/`, patched-free and identical, and `NEXO_MARK_SOURCE`
 * records the canonical URL so the same object can be re-fetched or re-uploaded
 * by the owner at any time.
 *
 * COST
 * The original is 1254×1254 and ~1.03 MB. It is served once and then cached
 * aggressively by the browser; `width`/`height` are set on the element so the
 * header reserves its box and nothing shifts. Re-encoding a smaller variant was
 * rejected deliberately: that would mean shipping a modified copy of an asset
 * the owner asked to be used exactly as supplied.
 *
 * The asset's own white padding is part of the approved artwork: it visually
 * separates the navy tile from the wordmark. On the navy panels (footer, hero)
 * that white surround is preserved deliberately — the tile would otherwise
 * disappear into the background, and nothing about the artwork is altered to
 * achieve it.
 */

/** The Supabase bucket the approved asset was published in. */
const ASSET_BUCKET = "Nexo auto imagenes";
/** The approved object name — also the served filename, so the id is traceable. */
const ASSET_FILE = "85ea2b4f-556e-4a9e-926d-721fd2328e78.png";
/** Local path, deliberately space-free so the URL needs no escaping. */
const ASSET_DIR = "brand";

/** The approved file, served by this application. */
export const NEXO_MARK_LOCAL = `/${ASSET_DIR}/${ASSET_FILE}`;

/** SHA-256 of the approved bytes, so a swap can always be verified. */
export const NEXO_MARK_SHA256 = "a42c8bc65b6341df20550d1e8b9b203b88c7433bd939f7f9aa9d8fd1a7de0f5e";

/** The canonical published object, recorded as the source of truth. */
export const NEXO_MARK_SOURCE = `https://wydsorvcpwuqqfzvnokg.supabase.co/storage/v1/object/public/${encodeURIComponent(
  ASSET_BUCKET,
)}/${ASSET_FILE}`;

/**
 * The URL for the approved mark.
 *
 * Returns the bundled approved file. The `width` argument is accepted so call
 * sites describe the rendered size (and so a future CDN variant needs one edit
 * here), but it never changes which artwork is shown.
 */
export function nexoMarkUrl(_width?: number): string {
  return NEXO_MARK_LOCAL;
}

/**
 * The approved hero visual.
 *
 * Same rules as the logo: the owner-supplied file is used exactly as delivered —
 * not replaced with stock photography, not re-cropped into a new composition, not
 * padded with another navy block, and never baked with text. The image already
 * carries the composition the mockup relies on:
 *
 *   - the white SUV occupies the right half,
 *   - the left half is bright negative space, which is where the real HTML
 *     headline, supporting copy and CTAs sit,
 *   - the translucent Nexo "N" is part of the artwork itself.
 *
 * Because the left side is genuinely light, the hero copy is dark navy over it in
 * BOTH themes and no scrim is needed — the artwork stays visible instead of being
 * covered by a "giant navy rectangle".
 *
 *   public/brand/816a8203-84c9-4cca-8bc5-695ebaaf97d7.png
 *   1672×941 (16:9), byte-identical to the approved object
 *   (SHA-256 529f2c1b3dba8231d5334b42791aa56afb77f36b0673cadc7ab97b7eea7e9440)
 */
const HERO_FILE = "816a8203-84c9-4cca-8bc5-695ebaaf97d7.png";

/** The approved hero image, served by this application. */
export const NEXO_HERO_LOCAL = `/${ASSET_DIR}/${HERO_FILE}`;

/** SHA-256 of the approved hero bytes. */
export const NEXO_HERO_SHA256 = "529f2c1b3dba8231d5334b42791aa56afb77f36b0673cadc7ab97b7eea7e9440";

/** The canonical published object for the hero image. */
export const NEXO_HERO_SOURCE = `https://wydsorvcpwuqqfzvnokg.supabase.co/storage/v1/object/public/${encodeURIComponent(
  ASSET_BUCKET,
)}/${HERO_FILE}`;

/** Intrinsic size of the approved hero image, used to reserve its box. */
export const NEXO_HERO_WIDTH = 1672;
export const NEXO_HERO_HEIGHT = 941;

/** The approved hero image URL. */
export function nexoHeroUrl(): string {
  return NEXO_HERO_LOCAL;
}

/** Wordmark sizes. The mark is square, so one dimension drives everything. */
export type LogoSize = "sm" | "md" | "lg";

const SIZES: Record<LogoSize, { mark: number; word: string; sub: string; gap: string; plate: string }> = {
  sm: { mark: 30, word: "text-sm", sub: "text-[9px]", gap: "gap-2", plate: "h-8 w-8 rounded-lg" },
  // 36px keeps the tile confident without eating the mobile row: at 375px the
  // lockup and the header controls together must still fit.
  md: {
    mark: 36,
    word: "text-[15px] tracking-tight",
    sub: "text-[9px]",
    gap: "gap-2",
    plate: "h-9 w-9 rounded-[10px]",
  },
  lg: { mark: 52, word: "text-lg", sub: "text-[11px]", gap: "gap-3", plate: "h-[52px] w-[52px] rounded-xl" },
};

/** The approved tile occupies ~91.4% of the canvas (measured from the file). */
const TILE_RATIO = 91.4;

interface NexoMarkProps {
  /** Rendered edge length in CSS pixels. */
  size?: number;
  /**
   * `light` = white or light surface (the asset's own white surround blends in).
   * `dark`  = navy panel, where the mark gets a white plate so the navy tile
   *           keeps the same edge definition it has on light surfaces.
   */
  tone?: "light" | "dark";
  /** Set false to render the bare logo without the plate on dark surfaces. */
  plate?: boolean;
  className?: string;
}

/**
 * The official Nexo Auto logo, as an image.
 *
 * `alt` is intentionally empty: the mark always sits beside, or inside, a link
 * whose accessible name already carries the brand ("Nexo Auto — home"), so a
 * second announcement would only add noise for screen-reader users.
 */
export function NexoMark({ size = 40, tone = "light", plate, className = "" }: NexoMarkProps) {
  const usePlate = plate ?? tone === "dark";

  // Compensating for the artwork's built-in padding keeps the navy tile the same
  // optical size on both tones.
  const rendered = usePlate ? Math.round((size * 100) / TILE_RATIO) : size;

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl ${
        usePlate ? "bg-white" : ""
      } ${className}`}
      style={{ width: rendered, height: rendered }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={nexoMarkUrl(size)}
        alt=""
        width={rendered}
        height={rendered}
        // Above the fold in the header, so it must not wait behind lazy images.
        loading="eager"
        decoding="async"
        fetchPriority="high"
        className="h-full w-full object-contain"
      />
    </span>
  );
}

interface NexoLogoProps {
  /** Live dealer name; falls back to the brand default. */
  name?: string | null;
  /** The translated sub-line under the wordmark. */
  tagline?: string | null;
  size?: LogoSize;
  /** `dark` = navy panel, where the mark gets its white plate. */
  tone?: "light" | "dark";
  /** Renders the wordmark beside the mark. `false` gives just the logo. */
  showWordmark?: boolean;
  /**
   * The sub-line is the first thing to go when horizontal room runs out. The
   * approved mark plus "NEXO AUTO" already names the brand, so the tagline only
   * appears where the header genuinely has room for it — and it never competes
   * with the navigation or the language/theme controls.
   */
  taglineFrom?: "always" | "xl";
  /** Accessible name for the surrounding link, already translated. */
  ariaLabel?: string;
  className?: string;
}

export function NexoLogo({
  name,
  tagline,
  size = "md",
  tone = "light",
  showWordmark = true,
  taglineFrom = "always",
  ariaLabel,
  className = "",
}: NexoLogoProps) {
  const s = SIZES[size];
  const label = (name?.trim() || "Nexo Auto").toUpperCase();

  return (
    <span className={`inline-flex min-w-0 items-center ${s.gap} ${className}`} aria-label={ariaLabel}>
      <NexoMark size={s.mark} tone={tone} className={s.plate} />
      {showWordmark && (
        <span className="flex min-w-0 flex-col leading-none">
          <span className={`truncate font-extrabold tracking-tight text-slate-900 ${s.word}`}>{label}</span>
          {tagline && (
            <span
              className={`mt-1 font-mono font-medium uppercase tracking-[0.14em] text-slate-400 ${s.sub} ${
                taglineFrom === "xl" ? "hidden truncate xl:block" : "truncate"
              }`}
            >
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
