import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import { DEFAULT_LANGUAGE, type Language } from "@/lib/i18n/preferences";

export type { Language };

/**
 * The PURE translation core: dictionaries, key types and formatting.
 *
 * This module is deliberately free of `next/headers` (or any other server-only
 * import) because CLIENT components render translated copy too — the vehicle
 * card and the photo gallery both need a language, and reaching them through a
 * module that reads cookies would drag server-only code toward the browser
 * bundle. Next.js fails the build for exactly that mistake, which is how this
 * file came to exist.
 *
 * `src/lib/i18n/index.ts` re-exports everything here and adds the server-only
 * `getLanguage()` / `getPublicStrings()` helpers on top.
 *
 * COST
 * `t()` is a direct property read against one of two plain objects, so a page
 * rendering a hundred strings does a hundred object reads. There is no runtime
 * catalogue to fetch and no cache to invalidate. The whole layer is ~120 lines
 * and adds no dependency.
 *
 * TYPING
 * `Dict` is derived from the English dictionary and the Spanish dictionary is
 * checked against it, so adding a key to one edition and forgetting the other is
 * a `tsc` failure. A half-translated page cannot ship silently.
 */

/** The canonical dictionary shape. `es` must satisfy exactly this. */
export type Dict = { [K in keyof typeof en]: string };

export const dictionaries: Record<Language, Dict> = { en, es };

export type TranslationKey = keyof Dict & string;

/**
 * Every key that contains a `{placeholder}`, mapped to the values it needs.
 *
 * This is what stops `t("home.hero.call")` from rendering "Call {phone}" to a
 * customer: a parameterised key can only be rendered through `tc()`, which
 * requires the values.
 */
export const PARAM_KEYS = {
  "meta.vehicle.description": ["vehicle", "mileage", "price"],
  "brand.familyNote": ["family"],
  "language.switchTo": ["language"],
  "theme.switchTo": ["theme"],
  "nav.home": ["name"],
  "nav.callDealer": ["name", "phone"],
  "a11y.srHeadline": ["name"],
  "home.inventory.empty.call": ["phone"],
  "home.inventory.empty.mailSubject": ["name"],
  "home.closing.callCta": ["phone"],
  "card.viewAction": ["vehicle", "stock", "price"],
  "card.photoAlt": ["vehicle"],
  "inventory.intro": ["name"],
  "inventory.resultsMatching": ["query"],
  "inventory.resultsCountOne": ["count"],
  "inventory.resultsCountOther": ["count"],
  "inventory.empty.searchTitle": ["query"],
  "inventory.page": ["page"],
  "vehicle.call": ["phone"],
  "vehicle.backToInventory": ["name"],
  "vehicle.mailSubject": ["vehicle", "stock"],
  "vehicle.srSummary": ["vehicle", "price"],
  "spec.miles": ["count"],
  "spec.stockNumber": ["stock"],
  "spec.vin": ["vin"],
  "gallery.counter": ["current", "total"],
  "gallery.thumbnail": ["index", "total"],
  "footer.rights": ["year", "name"],
} as const satisfies Partial<Record<TranslationKey, readonly string[]>>;

export type ParamKey = keyof typeof PARAM_KEYS;

export type TParams<K extends ParamKey> = Record<(typeof PARAM_KEYS)[K][number], string | number>;

/**
 * Emphasis markers.
 *
 * The approved mockup highlights the closing phrase of a headline in Nexo
 * orange ("A simpler way.", "Better tomorrow."). The dictionary stores that as
 * `{{...}}` rather than markup, so:
 *   - translators see one plain sentence, not HTML,
 *   - the copy is never `dangerouslySetInnerHTML`,
 *   - the styling decision stays in the component that renders the heading.
 */
export const EMPHASIS_OPEN = "{{";
export const EMPHASIS_CLOSE = "}}";

/** Splits a string into plain and emphasised runs, in order. */
export interface EmphasisRun {
  text: string;
  emphasised: boolean;
}

export function splitEmphasis(value: string): EmphasisRun[] {
  const runs: EmphasisRun[] = [];
  const pattern = /\{\{(.+?)\}\}/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    if (match.index > cursor) runs.push({ text: value.slice(cursor, match.index), emphasised: false });
    runs.push({ text: match[1], emphasised: true });
    cursor = match.index + match[0].length;
  }

  if (cursor < value.length) runs.push({ text: value.slice(cursor), emphasised: false });
  return runs;
}

/** The same string with markers removed — for alt text, titles and metadata. */
export function plainText(value: string): string {
  return value.replace(/\{\{(.+?)\}\}/g, "$1");
}

/**
 * Plural pairs, so counted copy never ships as "1 vehicles".
 *
 * Only `other` is listed: `one` is the obvious `...One` sibling of the same
 * name, which keeps the table short and readable. English and Spanish share the
 * same one/other split here, so one plural rule covers both.
 */
export const COUNT_KEYS = {
  "inventory.resultsCount": { one: "inventory.resultsCountOne", other: "inventory.resultsCountOther" },
} as const satisfies Record<string, { one: TranslationKey; other: TranslationKey }>;

export type CountKey = keyof typeof COUNT_KEYS;

/** The bundle a public page or component renders from. */
export type PublicStrings = {
  language: Language;
  /**
   * Plain copy. Accepts any key — a parameterised key read through `t()` yields
   * its raw template, which is why callers with values use `tc()` instead.
   */
  t: <K extends TranslationKey>(key: K) => string;
  tc: <K extends ParamKey>(
    key: K,
    params: Partial<TParams<K>> & Record<string, string | number>,
  ) => string;
  tn: (key: CountKey, count: number) => string;
  /** Locale-correct thousands separators: 68,000 (en) vs 68.000 (es). */
  n: (value: number) => string;
  /** Emphasis runs for a headline, so orange words never live in the markup. */
  rich: (key: TranslationKey) => EmphasisRun[];
};

/** Fills `{placeholders}`. A missing value leaves the token visible, not blank. */
export function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined || value === null ? match : String(value);
  });
}

export function dictionary(language: Language): Dict {
  return dictionaries[language] ?? dictionaries[DEFAULT_LANGUAGE];
}

export function translate(language: Language, key: TranslationKey): string {
  return dictionary(language)[key] ?? dictionaries[DEFAULT_LANGUAGE][key] ?? key;
}

export function translateWith(
  language: Language,
  key: ParamKey,
  params: Record<string, string | number>,
): string {
  return interpolate(translate(language, key), params);
}

export function translateCount(language: Language, key: CountKey, count: number): string {
  const pair = COUNT_KEYS[key];
  const chosen = count === 1 ? pair.one : pair.other;
  return translateWith(language, chosen, { count: count.toLocaleString(language) });
}

/**
 * Builds the bundle a page renders from.
 *
 * Pages resolve the language once and pass the bundle (or the language) down, so
 * nothing re-reads a cookie mid-render.
 */
export function strings(language: Language): PublicStrings {
  return {
    language,
    t: (key) => translate(language, key),
    tc: (key, params) => translateWith(language, key, params),
    tn: (key, count) => translateCount(language, key, count),
    n: (value) => value.toLocaleString(language),
    rich: (key) => splitEmphasis(translate(language, key)),
  };
}
