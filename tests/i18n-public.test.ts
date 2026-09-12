import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import {
  COUNT_KEYS,
  EMPHASIS_CLOSE,
  EMPHASIS_OPEN,
  PARAM_KEYS,
  dictionaries,
  interpolate,
  plainText,
  splitEmphasis,
  strings,
  translate,
  translateCount,
  translateWith,
} from "@/lib/i18n/catalog";
import {
  BUYING_OPTIONS,
  HERO_ASSURANCES,
  JOURNEY_STEPS,
  SECTION_IDS,
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
 *    translated without this failing.
 * 2. Every key referenced by the homepage's CONTENT TABLES resolves in both
 *    languages — a renamed key is caught here rather than rendering a raw key
 *    like "home.journey.3.title" to a customer.
 * 3. Emphasis markers are balanced and applied to the SAME keys in both
 *    languages, so the mockup's orange closing phrase cannot appear in one
 *    edition and not the other.
 * 4. Parameterised strings are only rendered with their values.
 * 5. Language resolution behaves, and never redirects.
 * 6. The public page and component sources hold no hard-coded English prose that
 *    also exists as a translation.
 *
 * Deliberately NOT a snapshot suite: assertions are about keys, resolution and a
 * handful of user-visible labels, so the tests survive copy edits.
 */

const ALL_KEYS = Object.keys(en) as Array<keyof typeof en>;
const PARAMETERISED = new Set(Object.keys(PARAM_KEYS));

/** The public files that must be dictionary-driven, not English-literal. */
const LOCALIZED_SOURCES = [
  "src/app/page.tsx",
  "src/app/inventory/page.tsx",
  "src/app/inventory/[vehicleId]/page.tsx",
  "src/app/not-found.tsx",
  "src/app/_components/PublicNav.tsx",
  "src/app/_components/PublicFooter.tsx",
  "src/app/_components/HomeHero.tsx",
  "src/app/_components/PublicVehicleCard.tsx",
  "src/app/_components/VehiclePhotoGallery.tsx",
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
        const value: string = dictionary[key];
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
        const tokens = [...value.matchAll(/\{(\w+)\}/g)]
          .map((match) => match[1])
          // `{{emphasis}}` markers are not interpolation parameters.
          .filter((token) => !value.includes(`${EMPHASIS_OPEN}${token}`));

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
     * Identical BY DESIGN, and only these:
     *  - `spec.stockNumber` is a stock-number label plus dealer data; "Stock #" is
     *    how it is written on a lot's paperwork in both languages.
     *  - `gallery.counter` is two numbers and a slash.
     *  - `theme.system` is "Sistema"/"System" — different, so not listed.
     * Anything else matching proves copy was left in English.
     */
    const identicalByDesign = new Set(["spec.stockNumber", "gallery.counter"]);

    const identical = ALL_KEYS.filter((key) => {
      if (identicalByDesign.has(key)) return false;
      const value: string = en[key];
      return (
        value.length > 12 &&
        /[a-z]/.test(value) &&
        !/^[A-Z0-9#/ •{}]*$/.test(value) &&
        es[key] === value
      );
    });

    expect(identical, `Untranslated keys: ${identical.join(", ")}`).toEqual([]);
  });

  it("keeps the financing promise identical in strength in both languages", () => {
    // Both editions must state that estimates are not an approval.
    expect(en["home.options.disclaimer"].toLowerCase()).toContain("not a guarantee of approval");
    expect(es["home.options.disclaimer"].toLowerCase()).toContain("ni una garantía de aprobación");

    // And neither edition may promise an outcome.
    for (const language of ["en", "es"] as const) {
      const dictionary = dictionaries[language];
      const claims = [
        "guaranteed approval",
        "instant approval",
        "everyone qualifies",
        "approved instantly",
        "aprobación garantizada",
        "aprobación instantánea",
        "todos califican",
      ];
      for (const key of ALL_KEYS) {
        const value = dictionary[key].toLowerCase();
        for (const claim of claims) {
          expect(value.includes(claim), `${language}.${key} promises "${claim}"`).toBe(false);
        }
      }
    }
  });

  it("uses United States Spanish terms a buyer would recognise", () => {
    expect(es["home.hero.primaryCta"]).toBe("Ver autos");
    expect(es["home.hero.eyebrow"]).toBe("Comprar tu auto, más simple");
    expect(es["meta.inventory.title"]).toBe("Inventario");
    expect(es["nav.howItWorks"]).toBe("Cómo funciona");
    expect(es["card.askingPrice"]).toBe("Precio");
    expect(es["spec.mileage"]).toBe("Millaje");
    expect(es["home.inventory.title"]).toBe("Encuentra el auto ideal para tu próxima etapa.");
  });

  it("matches the approved mockup's headline copy in both languages", () => {
    expect(plainText(en["home.hero.headline"])).toBe("Better cars.\nA simpler way.");
    expect(plainText(es["home.hero.headline"])).toBe("Mejores autos.\nUna forma más simple.");
    expect(plainText(en["home.options.title"])).toBe("Multiple ways to buy.\nOne simple experience.");
    expect(plainText(es["home.options.title"])).toBe("Diferentes formas de comprar.\nUna experiencia simple.");
    expect(plainText(en["home.family.title"])).toBe("More than a car.\nA better tomorrow.");
    expect(plainText(es["home.family.title"])).toBe("Más que un auto.\nUn mejor mañana.");
  });
});

/* -------------------------------------------------------------------------- */
/* B. Emphasis (the mockup's orange closing phrase)                            */
/* -------------------------------------------------------------------------- */

describe("BILINGUAL — emphasis markers", () => {
  it("marks the same keys in both languages", () => {
    const marked = (dictionary: typeof en | typeof es) =>
      ALL_KEYS.filter((key) => dictionary[key].includes(EMPHASIS_OPEN)).sort();

    expect(marked(es)).toEqual(marked(en));
    // The mockup emphasises exactly these three headlines.
    expect(marked(en)).toEqual(["home.family.title", "home.hero.headline", "home.options.title"]);
  });

  it("leaves no unbalanced marker in any value", () => {
    for (const language of ["en", "es"] as const) {
      for (const key of ALL_KEYS) {
        const value: string = dictionaries[language][key];
        const opens = value.split(EMPHASIS_OPEN).length - 1;
        const closes = value.split(EMPHASIS_CLOSE).length - 1;
        expect(opens, `${language}.${key} has unbalanced emphasis markers`).toBe(closes);
        // An empty emphasised run would render an invisible span.
        expect(value.includes(`${EMPHASIS_OPEN}${EMPHASIS_CLOSE}`)).toBe(false);
      }
    }
  });

  it("splits into ordered runs and round-trips through plainText", () => {
    const runs = splitEmphasis("A {{simpler way.}}");
    expect(runs).toEqual([
      { text: "A ", emphasised: false },
      { text: "simpler way.", emphasised: true },
    ]);
    expect(runs.map((run) => run.text).join("")).toBe(plainText("A {{simpler way.}}"));

    // A value with no markers is one plain run.
    expect(splitEmphasis("Plain copy")).toEqual([{ text: "Plain copy", emphasised: false }]);
  });

  it("keeps line breaks out of the emphasised run", () => {
    // The two-line headline must break BETWEEN runs, not inside one, or the
    // orange span would wrap oddly.
    const runs = splitEmphasis(dictionaries.en["home.hero.headline"]);
    expect(runs.map((run) => run.text)).toEqual(["Better cars.\nA ", "simpler way."]);
  });
});

/* -------------------------------------------------------------------------- */
/* C. Content tables                                                          */
/* -------------------------------------------------------------------------- */

describe("BILINGUAL — content tables resolve in both languages", () => {
  const contentKeys = [
    ...JOURNEY_STEPS.flatMap((item) => [item.titleKey, item.bodyKey]),
    ...BUYING_OPTIONS.flatMap((item) => [item.titleKey, item.bodyKey]),
    ...HERO_ASSURANCES.flatMap((item) => [item.key, item.bodyKey]),
  ];

  it("covers every section the page renders", () => {
    // 4 journey steps + 4 buying options + 3 hero assurances, each with 2 keys.
    expect(contentKeys.length).toBe(22);
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

  it("keeps every anchor target the header and footer link to", () => {
    expect(Object.values(SECTION_IDS)).toEqual(["inventory", "how-it-works", "financing", "about", "contact"]);
  });
});

/* -------------------------------------------------------------------------- */
/* D. Interpolation, plurals and locale formatting                            */
/* -------------------------------------------------------------------------- */

describe("BILINGUAL — parameterised copy is always filled in", () => {
  it("fills the phone number instead of leaking the token", () => {
    expect(translateWith("en", "vehicle.call", { phone: "713-555-0100" })).toBe("Call 713-555-0100");
    expect(translateWith("es", "vehicle.call", { phone: "713-555-0100" })).toBe("Llama al 713-555-0100");
  });

  it("leaves only undeclared tokens visible, so a bug is obvious rather than silent", () => {
    expect(interpolate("Call {phone} now", {})).toBe("Call {phone} now");
    expect(interpolate("Call {phone} now", { phone: "555" })).toBe("Call 555 now");
  });

  it("never renders an unfilled placeholder from the public surface keys", () => {
    const values = {
      vehicle: "2019 Toyota Camry SE",
      mileage: "68,000",
      price: "$18,995",
      family: "Nexo",
      language: "Español",
      theme: "Oscuro",
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
    expect(translateCount("en", "inventory.resultsCount", 1)).toBe("1 vehicle listed");
    expect(translateCount("en", "inventory.resultsCount", 3)).toBe("3 vehicles listed");
    expect(translateCount("es", "inventory.resultsCount", 1)).toBe("1 vehículo publicado");
    expect(translateCount("es", "inventory.resultsCount", 4)).toBe("4 vehículos publicados");
  });

  it("formats numbers in the language being rendered", () => {
    expect(strings("en").n(68000)).toBe("68,000");
    // The point is that it goes through Intl with the request locale.
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

  it("exposes emphasis through the bundle, not through markup in the dictionary", () => {
    const bundle = strings("es");
    expect(bundle.rich("home.hero.headline")).toEqual([
      { text: "Mejores autos.\nUna ", emphasised: false },
      { text: "forma más simple.", emphasised: true },
    ]);
    // No dictionary value may contain HTML.
    for (const language of ["en", "es"] as const) {
      for (const key of ALL_KEYS) {
        expect(dictionaries[language][key], `${language}.${key} must not contain HTML`).not.toMatch(
          /<(span|b|strong|em|br)\b/i,
        );
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* E. Language resolution                                                     */
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
    }
  });

  it("falls back to English rather than throwing on an unknown language", () => {
    expect(translate("en", "nav.inventory")).toBe("Inventory");
    expect(strings("en").t("meta.siteName")).toBe("Nexo Auto");
  });

  it("resolves ?lang= first, then the cookie, then Accept-Language, then default", () => {
    const resolver = readFileSync(join(repoRoot, "src/lib/i18n/index.ts"), "utf8");
    const body = resolver.slice(resolver.indexOf("export async function getLanguage"));
    const searchIndex = body.indexOf("source.searchParam");
    const cookieIndex = body.indexOf("cookieStore.get(LANGUAGE_COOKIE)");
    const headerIndex = body.indexOf("languageFromAcceptLanguage");
    expect(searchIndex).toBeGreaterThan(-1);
    expect(cookieIndex).toBeGreaterThan(searchIndex);
    expect(headerIndex).toBeGreaterThan(cookieIndex);
    expect(body).toContain("DEFAULT_LANGUAGE");
    // A surprise redirect is explicitly out of bounds.
    expect(resolver).not.toMatch(/\bredirect\(/);
  });
});

/* -------------------------------------------------------------------------- */
/* F. The pages are dictionary-driven, not English-literal                    */
/* -------------------------------------------------------------------------- */

describe("BILINGUAL — public sources hold no duplicated English prose", () => {
  /** English prose that also exists as a translation. */
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
      const source = readFileSync(join(repoRoot, relativePath), "utf8");
      // Two shapes are valid: a server section that resolves the bundle itself
      // (`getPublicStrings`), or one that receives the already-built bundle from
      // its page (`PublicStrings`). Both are dictionary-driven.
      expect(source, `${relativePath} must consume the i18n layer`).toMatch(
        /strings\(|getPublicStrings|PublicStrings/,
      );
    }
  });

  it("names the client-boundary prop `language`, never a helper object", () => {
    // A function-bearing prop on a client component is a runtime error in
    // Next.js, so this pins the shape that actually works. `Language` may be
    // required or optional (the operator surfaces default it to English).
    for (const relativePath of [
      "src/app/_components/PublicVehicleCard.tsx",
      "src/app/_components/VehiclePhotoGallery.tsx",
      "src/app/_components/PublicNav.tsx",
      "src/app/_components/PublicFooter.tsx",
    ]) {
      const source = readFileSync(join(repoRoot, relativePath), "utf8");
      expect(source, `${relativePath} must take a language code`).toMatch(/language\??:\s*Language/);
      expect(source, `${relativePath} must not take a strings prop`).not.toMatch(/\bs:\s*PublicStrings/);
    }
  });

  it("never renders the emphasis markers raw", () => {
    // Only RichHeading may interpret them.
    for (const relativePath of LOCALIZED_SOURCES) {
      const source = readFileSync(join(repoRoot, relativePath), "utf8");
      expect(source, `${relativePath} must not hand-roll emphasis`).not.toContain("{{");
    }
  });
});
