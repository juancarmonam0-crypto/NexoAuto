"use client";

import { useFormStatus } from "react-dom";
import { setLanguageAction } from "@/app/actions/language";
import { SUPPORTED_LANGUAGES, type Language } from "@/lib/i18n/preferences";

/**
 * EN | ES switcher.
 *
 * WHY A TWO-BUTTON GROUP AND NOT A DROPDOWN
 * A `<select>` needs JavaScript to do anything useful and hides the alternative
 * behind a tap. Two short labels show the current language AND the other one,
 * and each is a single tap — which matters most on a phone.
 *
 * WHY TWO FORMS
 * Each option is its own `<form>` posting to the Server Action with a hidden
 * `lang` field, rather than one form with two submit buttons. A button's value
 * is not reliably part of a progressively-enhanced submission, and a client
 * closure passed to `action` — the obvious first implementation — renders
 * `action="javascript:throw new Error(...)"`, which means the switcher silently
 * fails with JavaScript unavailable or still loading. A real form action is
 * serialised into the markup as a hidden `$ACTION_ID`, so the control works
 * before hydration and without JavaScript at all.
 *
 * `useFormStatus` supplies the pending state; no transition bookkeeping and no
 * controlled component is needed.
 */

const LABELS: Record<Language, string> = { en: "EN", es: "ES" };
/** Language names read in their OWN language, which is how switchers are read. */
const NATIVE_NAMES: Record<Language, string> = { en: "English", es: "Español" };

interface LanguageSwitcherProps {
  /** The language currently being rendered. A plain code, so it serializes. */
  language: Language;
  /** Accessible group label, already translated by the caller. */
  label: string;
  /** Accessible name template for the inactive option, e.g. "Switch to {language}". */
  switchToLabel: string;
  /** `light` = white header, `dark` = navy footer/panel. */
  tone?: "light" | "dark";
  className?: string;
}

export function LanguageSwitcher({
  language: current,
  label,
  switchToLabel,
  tone = "light",
  className = "",
}: LanguageSwitcherProps) {
  const shell = tone === "dark" ? "border-white/15 bg-white/5" : "border-slate-200 bg-slate-50";

  return (
    <div
      role="group"
      aria-label={label}
      className={`inline-flex items-center rounded-full border p-0.5 ${shell} ${className}`}
    >
      {SUPPORTED_LANGUAGES.map((language) => (
        <form key={language} action={setLanguageAction} className="contents">
          <input type="hidden" name="lang" value={language} />
          <LanguageOption
            language={language}
            isCurrent={language === current}
            label={
              language === current
                ? NATIVE_NAMES[language]
                : switchToLabel.replace("{language}", NATIVE_NAMES[language])
            }
            tone={tone}
          />
        </form>
      ))}
    </div>
  );
}

/**
 * One option. Split out only because `useFormStatus` reports the status of the
 * form it is rendered inside, so it must be a child of that form.
 */
function LanguageOption({
  language,
  isCurrent,
  label,
  tone,
}: {
  language: Language;
  isCurrent: boolean;
  label: string;
  tone: "light" | "dark";
}) {
  const { pending } = useFormStatus();

  const idle = tone === "dark" ? "text-slate-300 hover:text-white" : "text-slate-500 hover:text-slate-900";
  const active =
    tone === "dark"
      ? "bg-white text-[var(--brand-navy-900)] shadow-sm"
      : "bg-[var(--brand-navy-900)] text-white shadow-sm";

  return (
    <button
      type="submit"
      disabled={pending}
      aria-current={isCurrent ? "true" : undefined}
      aria-label={label}
      className={`inline-flex h-8 min-w-9 cursor-pointer items-center justify-center rounded-full px-2.5 font-mono text-[11px] font-bold tracking-wide transition-colors disabled:cursor-default ${
        isCurrent ? active : idle
      } ${pending ? "opacity-70" : ""}`}
    >
      {LABELS[language]}
    </button>
  );
}
