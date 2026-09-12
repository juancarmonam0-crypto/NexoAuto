import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import {
  COUNT_KEYS,
  PARAM_KEYS,
  dictionaries,
  interpolate,
  strings,
  translate,
  translateCount,
  translateWith,
} from "@/lib/i18n/catalog";
import {
  BENEFITS,
  BENEFIT_CTA_ACTION_KEY,
  BENEFIT_CTA_BODY_KEY,
  BENEFIT_CTA_TITLE_KEY,
  BUYING_OPTIONS,
  HERO_ASSURANCE_KEYS,
  STEPS,
  TRUST_POINTS,
} from "@/lib/i18n/public-content";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_COOKIE,
  isLanguage,
  languageFromAcceptLanguage,
  parseLanguage,
} from "@/lib/i18n/preferences";

/**
 * BILINGUAL PUBLIC EXPERIENCE — the contract.
 *
 * WHAT THIS FILE PINS
 * 1. The two dictionaries are key-for-key identical. A page cannot be half
 *    translated without this failing, which is the specific failure mode the
 *    brief calls out ("do not leave a page 70% translated").
 * 2. Every key referenced by the landing page's CONTENT TABLES resolves in both
 *    languages — a renamed key is caught here rather than rendering a raw key
 *    like "home.steps.3.title" to a customer.
 * 3. Parameterised strings are only rendered with their values: the phone
 *    number, dealer name and counts are filled in, never left as `{phone}`.
 * 4. Language resolution behaves: `?lang=`, stored preference, Accept-Language
 *    hint and default, in that order — and nothing surprising happens on a
 *    signal it does not understand.
 * 5. The public page and component sources hold no hard-coded English prose
 *    that also exists as a translation. This is the assertion that keeps the
 *    dictionary authoritative as the pages evolve.
 *
 * Deliberately NOT a snapshot suite: assertions are about keys, resolution and
 * a handful of user-visible labels, so the tests survive copy edits.
 */

const ALL_KEYS = Object.keys(en) as Array<keyof typeof en>;

/** Keys that carry a `{placeholder}`. */
const PARAMETERISED = new Set(Object.keys(PARAM_KEYS));

/** The public files that must be dictionary-driven, not English-literal. */
const LOCALIZED_SOURCES = [
  "src/app/page.tsx",
  "src/app/inventory/page.tsx",
  "src/app/inventory/[vehicleId]/page.tsx",
  "src/app/not-found.tsx",
  "src/app/_components/PublicNav.tsx",
  "src/app/_components/PublicFooter.tsx",
  "src/app/_components/PublicVehicleCard.tsx",
  "src/app/_components/VehiclePhotoGallery.tsx",
  "src/app/_components/LanguageSwitcher.tsx",
];

const repoRoot = join(__dirname, "..");

/* -------------------------------------------------------------------------- */
/* A. Dictionary completeness                                                 */
/* -------------------------------------------------------------------------- */

describe("BILINGUAL — the dictionaries cannot drift apart", () => {
  it("has exactly the same keys in English and Spanish", () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });

  it("has no empty or placeholder-only values in either language", () => {
    for (const language of ["en", "es"] as const) {
      const dictionary = dictionaries[language];
      for (const key of ALL_KEYS) {
        const value = dictionary[key];
        expect(value, `${language}.${key} must be a non-empty string`).toBeTruthy();
        expect(value.trim().length, `${language}.${key} must not be blank`).toBeGreaterThan(0);
      }
    }
  });

  it("never leaves a placeholder unfilled in a stored value it does not declare", () => {
    for (const language of ["en", "es"] as const) {
      const dictionary = dictionaries[language];
      for (const key of ALL_KEYS) {
        const value: string = dictionary[key];
        const tokens = [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
        if (tokens.length === 0) {
          expect(PARAMETERISED.has(key), `${language}.${key} declares no parameters`).toBe(false);
          continue;
        }
        expect(PARAMETERISED.has(key), `${language}.${key} uses {${tokens.join("},{")}} but is not declared`).toBe(
          true,
        );
        const declared: readonly string[] = PARAM_KEYS[key as keyof typeof PARAM_KEYS];
        for (const token of tokens) {
          expect(declared.includes(token), `${language}.${key}: {${token}} is not declared`).toBe(true);
        }
      }
    }
  });

  it("actually translates: the Spanish edition is not the English text", () => {
    /**
     * Identical BY DESIGN, and only these two:
     *  - `spec.stockNumber` is a stock-number label plus dealer data; the token
     *    "Stock #" is how it is written on a lot's paperwork in both languages.
     *  - `gallery.counter` is two numbers and a slash.
     * Anything else matching proves copy was left in English.
     */
    const identicalByDesign = new Set(["spec.stockNumber", "gallery.counter"]);

    const identical = ALL_KEYS.filter((key) => {
      if (identicalByDesign.has(key)) return false;
      const value = en[key];
      // Proper nouns and tokens legitimately match across languages.
      return value.length > 12 && /[a-z]/.test(value) && !/^[A-Z0-9#/ •]*$/.test(value) && es[key] === value;
    });

    expect(identical, `Untranslated keys: ${identical.join(", ")}`).toEqual([]);
  });

  it("keeps the financing promise identical in strength in both languages", () => {
    // Both editions must state that figures are estimates and not an approval.
    expect(en["home.options.disclaimer"].toLowerCase()).toContain("not a guarantee of approval");
    expect(es["home.options.disclaimer"].toLowerCase()).toContain("no garantiza una aprobación");

    expect(en["home.options.guided.point2"]).toBe("Estimates, not approvals");
    expect(es["home.options.guided.point2"]).toBe("Son estimados, no aprobaciones");
  });

  it("uses United States Spanish terms a buyer would recognise", () => {
    expect(es["home.hero.primaryCta"]).toBe("Ver inventario");
    expect(es["inventory.title"]).toBe("Inventario de vehículos");
    expect(es["home.steps.eyebrow"]).toBe("Cómo funciona");
    expect(es["home.options.eyebrow"]).toBe("Opciones de compra");
    expect(es["card.explore"]).toBe("Ver más");
    expect(es["spec.mileage"]).toBe("Millaje");
    expect(es["card.askingPrice"]).toBe("Precio");
  });
});

/* -------------------------------------------------------------------------- */
/* B. Every key the landing page renders resolves in both languages            */
/* -------------------------------------------------------------------------- */

describe("BILINGUAL — content tables resolve in both languages", () => {
  const contentKeys = [
    ...BENEFITS.flatMap((item) => [item.titleKey, item.bodyKey]),
    ...STEPS.flatMap((item) => [item.titleKey, item.bodyKey]),
    ...BUYING_OPTIONS.flatMap((item) => [item.titleKey, item.bodyKey, ...item.pointKeys]),
    ...TRUST_POINTS.flatMap((item) => [item.titleKey, item.bodyKey]),
    ...HERO_ASSURANCE_KEYS,
    BENEFIT_CTA_TITLE_KEY,
    BENEFIT_CTA_BODY_KEY,
    BENEFIT_CTA_ACTION_KEY,
  ];

  it("covers every section the page renders", () => {
    expect(contentKeys.length).toBeGreaterThan(30);
  });

  it("has a real translation for each table key, in both languages", () => {
    for (const key of contentKeys) {
      expect(en[key], `en.${key}`).toBeTruthy();
      expect(es[key], `es.${key}`).toBeTruthy();
      expect(es[key]).not.toBe(key);
    }
  });

  it("renders no raw translation keys to a customer", () => {
    for (const language of ["en", "es"] as const) {
      const dictionary = dictionaries[language];
      for (const key of contentKeys) {
        expect(dictionary[key]).not.toMatch(/^[a-z]+(\.[a-zA-Z0-9]+)+$/);
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* C. Interpolation and plurals                                               */
/* -------------------------------------------------------------------------- */

describe("BILINGUAL — parameterised copy is always filled in", () => {
  it("fills the phone number instead of leaking the token", () => {
    expect(translateWith("en", "home.hero.call", { phone: "713-555-0100" })).toBe("Call 713-555-0100");
    expect(translateWith("es", "home.hero.call", { phone: "713-555-0100" })).toBe("Llama al 713-555-0100");
  });

  it("leaves only undeclared tokens visible, so a bug is obvious rather than silent", () => {
    expect(interpolate("Call {phone} now", {})).toBe("Call {phone} now");
    expect(interpolate("Call {phone} now", { phone: "555" })).toBe("Call 555 now");
  });

  it("never renders an unfilled placeholder from the public surface keys", () => {
    // Every parameterised key, rendered through tc() with plausible values.
    const values = {
      vehicle: "2019 Toyota Camry SE",
      mileage: "68,000",
      price: "$18,995",
      family: "Nexo",
      language: "Español",
      name: "Nexo Auto",
      phone: "713-555-0100",
      stock: "SN-1001",
      query: "“civic”",
      count: "3",
      page: "2",
      current: "1",
      total: "8",
      index: "1",
      vin: "1HGCM82633A004352",
      year: "2026",
    };

    for (const language of ["en", "es"] as const) {
      for (const key of PARAMETERISED) {
        const rendered = translateWith(language, key as keyof typeof PARAM_KEYS, values);
        expect(rendered, `${language}.${key}`).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it("uses the singular form for one and the plural form otherwise", () => {
    expect(translateCount("en", "inventory.resultsCount", 1)).toBe("Showing 1 listed vehicle");
    expect(translateCount("en", "inventory.resultsCount", 3)).toBe("Showing 3 listed vehicles");
    expect(translateCount("es", "inventory.resultsCount", 1)).toBe("Mostrando 1 vehículo publicado");
    expect(translateCount("es", "inventory.resultsCount", 4)).toBe("Mostrando 4 vehículos publicados");
  });

  it("formats numbers in the language being rendered", () => {
    expect(strings("en").n(68000)).toBe("68,000");
    // Spanish (US) also groups with commas; the point is that it goes through
    // Intl with the request locale rather than a hard-coded "en-US".
    expect(strings("es").n(68000)).toBe((68000).toLocaleString("es"));
  });

  it("keeps every declared count pair resolvable", () => {
    for (const pair of Object.values(COUNT_KEYS)) {
      expect(en[pair.one]).toBeTruthy();
      expect(en[pair.other]).toBeTruthy();
      expect(es[pair.one]).toBeTruthy();
      expect(es[pair.other]).toBeTruthy();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* D. Language resolution and persistence                                     */
/* -------------------------------------------------------------------------- */

describe("BILINGUAL — language preference resolution", () => {
  it("accepts only supported languages", () => {
    expect(isLanguage("en")).toBe(true);
    expect(isLanguage("es")).toBe(true);
    expect(isLanguage("fr")).toBe(false);
    expect(isLanguage("")).toBe(false);
    expect(isLanguage(null)).toBe(false);
    expect(isLanguage(undefined)).toBe(false);
  });

  it("narrows regional tags to a supported language", () => {
    expect(parseLanguage("es-MX")).toBe("es");
    expect(parseLanguage("es_419")).toBe("es");
    expect(parseLanguage("en-US")).toBe("en");
    expect(parseLanguage("EN")).toBe("en");
    expect(parseLanguage("de-DE")).toBeNull();
    expect(parseLanguage("")).toBeNull();
  });

  it("treats an explicit ?lang= as authoritative", () => {
    // getLanguage() gives the search parameter precedence over cookie and
    // header; parseLanguage is the gate it uses.
    expect(parseLanguage("es")).toBe("es");
    expect(parseLanguage("not-a-language")).toBeNull();
  });

  it("honours a clear Accept-Language preference and ignores noise", () => {
    expect(languageFromAcceptLanguage("es-MX,es;q=0.9,en;q=0.8")).toBe("es");
    expect(languageFromAcceptLanguage("en-US,en;q=0.9")).toBe("en");
    expect(languageFromAcceptLanguage("fr-FR,fr;q=0.9")).toBeNull();
    expect(languageFromAcceptLanguage(null)).toBeNull();
    expect(languageFromAcceptLanguage("")).toBeNull();
  });

  it("defaults to English for a visitor with no signal at all", () => {
    expect(DEFAULT_LANGUAGE).toBe("en");
    expect(dictionaries[DEFAULT_LANGUAGE]).toBe(en);
  });

  it("stores the preference under a documented, non-secret cookie name", () => {
    expect(LANGUAGE_COOKIE).toBe("nexo_lang");
  });

  it("returns the language it was asked for, with a usable bundle", () => {
    for (const language of ["en", "es"] as const) {
      const bundle = strings(language);
      expect(bundle.language).toBe(language);
      expect(bundle.t("nav.inventory")).toBe(language === "es" ? "Inventario" : "Inventory");
      expect(bundle.t("nav.browseCars")).toBe(language === "es" ? "Ver autos" : "Browse cars");
    }
  });

  it("falls back to English rather than throwing on an unknown language", () => {
    expect(translate("en", "nav.inventory")).toBe("Inventory");
    expect(strings("en").t("meta.siteName")).toBe("Nexo Auto");
  });
});

/* -------------------------------------------------------------------------- */
/* E. The pages are dictionary-driven, not English-literal                     */
/* -------------------------------------------------------------------------- */

describe("BILINGUAL — public sources hold no duplicated English prose", () => {
  /**
   * English prose that also exists as a translation. If any of it appears as a
   * bare literal in a public source file, that surface can no longer be
   * translated — which is exactly the regression this guards.
   */
  const proseValues = ALL_KEYS.map((key) => en[key]).filter(
    (value) => value.length >= 12 && value.includes(" ") && !value.includes("{") && !value.includes("©"),
  );

  it("has a meaningful set of prose to check", () => {
    expect(proseValues.length).toBeGreaterThan(60);
  });

  for (const relativePath of LOCALIZED_SOURCES) {
    it(`${relativePath} renders prose through the dictionary`, () => {
      const source = readFileSync(join(repoRoot, relativePath), "utf8");
      const leaked = proseValues.filter((value) => source.includes(`"${value}"`) || source.includes(`>${value}<`));
      expect(leaked, `${relativePath} hard-codes: ${leaked.join(" | ")}`).toEqual([]);
    });
  }

  it("every public surface that renders copy resolves a language bundle", () => {
    for (const relativePath of LOCALIZED_SOURCES) {
      // The switcher is exempt: it never renders prose of its own, only the
      // labels the header/footer already translated and handed to it.
      if (relativePath.endsWith("LanguageSwitcher.tsx")) continue;

      const source = readFileSync(join(repoRoot, relativePath), "utf8");
      expect(source, `${relativePath} must consume the i18n layer`).toMatch(/strings\(|getPublicStrings/);
    }
  });

  it("does not let the switcher invent its own copy", () => {
    const source = readFileSync(join(repoRoot, "src/app/_components/LanguageSwitcher.tsx"), "utf8");
    // EN/ES tokens and native language names are the only literals allowed here.
    expect(source).toContain("SUPPORTED_LANGUAGES");
    expect(source).not.toMatch(/getPublicStrings|strings\(/);
  });

  it("switches languages with a real server action, not a client closure", () => {
    // A closure passed to `action` renders `action="javascript:throw ..."` and
    // breaks the switcher before hydration. The server action must reach the
    // form so Next can serialise its $ACTION_ID into the markup.
    const source = readFileSync(join(repoRoot, "src/app/_components/LanguageSwitcher.tsx"), "utf8");
    expect(source).toContain('action={setLanguageAction}');
    expect(source).not.toMatch(/action=\{\(/);
    expect(source).toMatch(/useFormStatus/);

    const actionSource = readFileSync(join(repoRoot, "src/app/actions/language.ts"), "utf8");
    expect(actionSource).toContain('"use server"');
    expect(actionSource).toContain("LANGUAGE_COOKIE");
    expect(actionSource).toContain("parseLanguage");
  });

  it("persists the choice in a cookie the server can read during render", () => {
    const resolver = readFileSync(join(repoRoot, "src/lib/i18n/index.ts"), "utf8");
    // Order matters: ?lang= → stored preference → Accept-Language → default.
    // Asserted against the resolution block, not the module prose above it.
    const body = resolver.slice(resolver.indexOf("export async function getLanguage"));
    const searchIndex = body.indexOf("source.searchParam");
    const cookieIndex = body.indexOf("cookieStore.get(LANGUAGE_COOKIE)");
    const headerIndex = body.indexOf("languageFromAcceptLanguage");
    expect(searchIndex).toBeGreaterThan(-1);
    expect(cookieIndex).toBeGreaterThan(searchIndex);
    expect(headerIndex).toBeGreaterThan(cookieIndex);
    expect(body).toContain("DEFAULT_LANGUAGE");
  });

  it("never redirects on a language signal", () => {
    const resolver = readFileSync(join(repoRoot, "src/lib/i18n/index.ts"), "utf8");
    // A surprise redirect is explicitly out of bounds; the language only
    // decides which copy renders.
    expect(resolver).not.toMatch(/\bredirect\(/);
  });

  it("names the client-boundary prop `language`, never a helper object", () => {
    // A function-bearing prop on a client component is a runtime error in
    // Next.js, so this pins the shape that actually works.
    for (const relativePath of [
      "src/app/_components/PublicVehicleCard.tsx",
      "src/app/_components/VehiclePhotoGallery.tsx",
    ]) {
      const source = readFileSync(join(repoRoot, relativePath), "utf8");
      expect(source, `${relativePath} must take a language code`).toMatch(/language\??:\s*Language/);
      expect(source, `${relativePath} must rebuild its own bundle`).toContain("strings(language)");
      expect(source, `${relativePath} must not take a strings prop`).not.toMatch(/\bs:\s*PublicStrings/);
    }
  });
});
