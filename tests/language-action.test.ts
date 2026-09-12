import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The language Server Action — the write half of the bilingual preference.
 *
 * Pins the three things that make the switcher trustworthy:
 *   1. a supported language is persisted under the documented cookie name,
 *   2. the cookie is long-lived, path-wide and SameSite=Lax, so navigation
 *      keeps the language without the visitor touching the switcher again,
 *   3. anything unsupported writes NOTHING — the action validates before it
 *      touches the cookie jar, so a crafted form field cannot set arbitrary
 *      data.
 *
 * `next/headers` is mocked because the action is the boundary under test; the
 * cookie read side is covered in `i18n-public.test.ts`, and the two together are
 * the full round trip.
 */

const cookieSet = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => undefined),
    set: cookieSet,
    delete: vi.fn(),
  })),
  headers: vi.fn(async () => new Headers()),
}));

import { setLanguageAction } from "@/app/actions/language";
import { LANGUAGE_COOKIE, LANGUAGE_COOKIE_MAX_AGE } from "@/lib/i18n/preferences";

function formWith(lang: string | null): FormData {
  const formData = new FormData();
  if (lang !== null) formData.set("lang", lang);
  return formData;
}

describe("language action — persists a supported preference", () => {
  beforeEach(() => {
    cookieSet.mockClear();
  });

  it("stores Spanish under the documented cookie name", async () => {
    await setLanguageAction(formWith("es"));

    expect(cookieSet).toHaveBeenCalledTimes(1);
    expect(cookieSet).toHaveBeenCalledWith(
      LANGUAGE_COOKIE,
      "es",
      expect.objectContaining({ path: "/", sameSite: "lax", maxAge: LANGUAGE_COOKIE_MAX_AGE }),
    );
  });

  it("stores English too, so a visitor can switch back", async () => {
    await setLanguageAction(formWith("en"));

    expect(cookieSet).toHaveBeenCalledWith(LANGUAGE_COOKIE, "en", expect.anything());
  });

  it("accepts a regional tag by narrowing it", async () => {
    await setLanguageAction(formWith("es-MX"));

    expect(cookieSet).toHaveBeenCalledWith(LANGUAGE_COOKIE, "es", expect.anything());
  });

  it("writes NOTHING for an unsupported or missing language", async () => {
    await setLanguageAction(formWith("fr"));
    await setLanguageAction(formWith(""));
    await setLanguageAction(formWith(null));
    await setLanguageAction(formWith("<script>alert(1)</script>"));

    expect(cookieSet).not.toHaveBeenCalled();
  });

  it("is permanent enough to survive a browsing session but not forever", async () => {
    expect(LANGUAGE_COOKIE_MAX_AGE).toBe(60 * 60 * 24 * 365);
  });

  it("marks the cookie secure in production only", async () => {
    const original = process.env.NODE_ENV;
    try {
      // @ts-expect-error NODE_ENV is read-only in the type system, writable at runtime.
      process.env.NODE_ENV = "production";
      await setLanguageAction(formWith("es"));
      expect(cookieSet).toHaveBeenCalledWith(
        LANGUAGE_COOKIE,
        "es",
        expect.objectContaining({ secure: true }),
      );
    } finally {
      // @ts-expect-error restored below
      process.env.NODE_ENV = original;
    }
  });
});
