/**
 * Language preference — the pieces that are safe on both the server and the
 * client.
 *
 * `preferences.ts` exists so a client component can know the cookie name and
 * the language type WITHOUT importing the dictionary module, which reads
 * `next/headers` and is therefore server-only. Keeping the boundary in its own
 * leaf file is what stops a cookie read from being pulled into a browser
 * bundle.
 */

export const SUPPORTED_LANGUAGES = ["en", "es"] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = "en";

/**
 * The persisted customer preference.
 *
 * A cookie is the right weight here: the public experience is rendered on the
 * server, so the choice must be readable during rendering — a `localStorage`
 * value would only be visible after hydration and would flash the wrong
 * language first. Long lifetime, `SameSite=Lax`, no sensitive content.
 */
export const LANGUAGE_COOKIE = "nexo_lang";

/** One year, in seconds. */
export const LANGUAGE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** True when a value is a language this app can actually render. */
export function isLanguage(value: string | null | undefined): value is Language {
  return typeof value === "string" && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/**
 * Narrows anything — a cookie value, a `?lang=` parameter, an
 * `Accept-Language` header — to a supported language, or null.
 *
 * Deliberately conservative: a bare `es` or an `es-MX` / `es-419` tag both
 * resolve to `es`, but nothing is guessed from weak signals. A miss returns
 * null so the caller decides what the fallback is.
 */
export function parseLanguage(value: string | null | undefined): Language | null {
  if (!value) return null;

  const tag = value.trim().toLowerCase();
  if (tag === "") return null;

  // Exact match first: "en", "es".
  if (isLanguage(tag)) return tag;

  // Region subtags: "es-MX", "es_419", "en-US" -> base language.
  const base = tag.split(/[-_]/)[0];
  return isLanguage(base) ? base : null;
}

/**
 * Picks a language from an `Accept-Language` header.
 *
 * Only used as a hint when the visitor has no stored preference, and only when
 * the header states a clear preference for Spanish. The result never triggers a
 * redirect — it just decides which copy renders.
 */
export function languageFromAcceptLanguage(header: string | null | undefined): Language | null {
  if (!header) return null;

  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="))
        ?.slice(2);
      const quality = q === undefined ? 1 : Number.parseFloat(q);
      return { tag, quality: Number.isFinite(quality) ? quality : 0 };
    })
    .filter((entry) => entry.tag !== "" && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality);

  for (const entry of ranked) {
    const language = parseLanguage(entry.tag);
    if (language) return language;
  }

  return null;
}
