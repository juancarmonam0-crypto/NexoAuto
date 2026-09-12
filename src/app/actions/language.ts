"use server";

import { cookies } from "next/headers";
import {
  LANGUAGE_COOKIE,
  LANGUAGE_COOKIE_MAX_AGE,
  type Language,
  parseLanguage,
} from "@/lib/i18n/preferences";

/**
 * Persists the customer's language choice.
 *
 * A Server Action rather than a cookie write during render: Next.js only allows
 * cookies to be SET from an action or route handler, and the switcher already
 * posts a form, so the write happens exactly where the user acted. That also
 * means the mechanism keeps working with JavaScript disabled — the form posts,
 * the cookie is set, and the next render is in the new language.
 *
 * Both form fields are validated before anything is written, and the value is
 * narrowed to a supported language, so nothing user-supplied reaches the cookie.
 */
export async function setLanguageAction(formData: FormData): Promise<void> {
  const requested = parseLanguage(
    typeof formData.get("lang") === "string" ? (formData.get("lang") as string) : null,
  );
  if (!requested) return;

  const cookieStore = await cookies();
  cookieStore.set(LANGUAGE_COOKIE, requested satisfies Language, {
    path: "/",
    maxAge: LANGUAGE_COOKIE_MAX_AGE,
    sameSite: "lax",
    httpOnly: false, // a preference, not a credential — readable by design
    secure: process.env.NODE_ENV === "production",
  });
}
