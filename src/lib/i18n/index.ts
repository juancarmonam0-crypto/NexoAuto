import { cookies, headers } from "next/headers";
import { cache } from "react";
import { DEFAULT_LANGUAGE, LANGUAGE_COOKIE, type Language, languageFromAcceptLanguage, parseLanguage } from "@/lib/i18n/preferences";
import { strings, type PublicStrings } from "@/lib/i18n/catalog";

/**
 * The SERVER-ONLY half of the translation layer: resolving which language this
 * request should render in.
 *
 * The dictionaries and the formatting helpers live in `./catalog`, which client
 * components import directly. This file adds the parts that need request state,
 * so importing it is what pulls in `next/headers`.
 *
 * WHY THERE IS NO LOCALIZED ROUTING
 * Nexo Auto renders one route set and localizes the copy, rather than shipping
 * `/es/...` duplicate URLs. Two reasons: the language is a customer preference,
 * so it belongs in a cookie and not in a link that breaks when shared; and a
 * locale-prefixed route tree would be a routing migration touching the operator
 * surfaces too, which this phase explicitly excludes. The SEO consequence is
 * reported as follow-up work rather than absorbed here.
 */

export interface LanguageSource {
  /** `?lang=` — explicit, so it wins. */
  searchParam?: string | null;
}

/**
 * Resolves the language for this request.
 *
 * Precedence: an explicit `?lang=` parameter, then the stored preference, then a
 * *clear* browser-language signal, then English. Nothing here redirects: an
 * unsupported or missing signal simply renders the default, so a visitor can
 * never be bounced to a URL they did not ask for.
 */
export async function getLanguage(source: LanguageSource = {}): Promise<Language> {
  const explicit = parseLanguage(source.searchParam);
  if (explicit) return explicit;

  return resolveStoredLanguage();
}

/**
 * The stored preference and the browser hint — resolved ONCE per request.
 *
 * The root layout, `generateMetadata` and the page body each need the language,
 * and each of them used to read cookies and headers and re-parse
 * `Accept-Language` independently: three times per render for a value that cannot
 * change mid-request. React's `cache()` scopes this to the request, and because
 * everything request-specific is read inside the wrapped function the memo needs
 * no arguments at all — one entry per render.
 */
const resolveStoredLanguage = cache(async (): Promise<Language> => {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);

  const stored = parseLanguage(cookieStore.get(LANGUAGE_COOKIE)?.value);
  if (stored) return stored;

  // Only a stated, supported preference is honoured, so an "en-US" browser stays
  // on the default rather than taking a different path through the page.
  const hinted = languageFromAcceptLanguage(headerList.get("accept-language"));
  return hinted ?? DEFAULT_LANGUAGE;
});

/**
 * The strings bundle for this request, accepting an optional `?lang=` override.
 *
 * Public pages accept `?lang=en|es` so a link can point at a specific language
 * without the visitor hunting for the switcher. The cookie is still what
 * persists the choice across navigation.
 */
export async function getPublicStrings(source: LanguageSource = {}): Promise<PublicStrings> {
  return strings(await getLanguage(source));
}

export * from "@/lib/i18n/catalog";
export {
  DEFAULT_LANGUAGE,
  LANGUAGE_COOKIE,
  LANGUAGE_COOKIE_MAX_AGE,
  SUPPORTED_LANGUAGES,
  isLanguage,
  parseLanguage,
  languageFromAcceptLanguage,
} from "@/lib/i18n/preferences";
export type { Language };
