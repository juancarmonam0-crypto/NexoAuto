"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import {
  type ResolvedTheme,
  type ThemeMode,
  applyTheme,
  nextThemeMode,
  readStoredThemeMode,
  resolveTheme,
  setThemeMode,
  subscribeSystemDark,
  subscribeThemeMode,
  systemDarkServerSnapshot,
  systemDarkSnapshot,
  themeModeServerSnapshot,
} from "@/lib/theme";

/**
 * Light / Dark / System control.
 *
 * MODES, NOT A SWITCH
 * A two-state toggle cannot express "follow my phone", which is what most
 * visitors actually want, so the control cycles light → dark → system and the
 * icon always shows the CURRENT mode (sun, moon, monitor).
 *
 * NO FLASH, NO HYDRATION MISMATCH
 * The pre-paint boot script has already applied the right class. This component
 * reads the preference and the OS setting as EXTERNAL STORES via
 * `useSyncExternalStore`, whose server snapshot is the default: the first client
 * render therefore matches the server render exactly, and the real value arrives
 * in the same commit — no effect-based setState, no cascading render, no flicker.
 *
 * SPANISH-SAFE
 * The label sits on the button's accessible name only, so the control is a fixed
 * 40px square in either language and can never push the header wider.
 */

const ICONS = {
  light: Sun,
  dark: Moon,
  system: Monitor,
} as const;

interface ThemeToggleProps {
  /** Translated name for the control, e.g. "Theme". */
  label: string;
  /** Translated names per mode, e.g. { light: "Light", … }. */
  modeLabels: Record<ThemeMode, string>;
  /** Translated template for the action, e.g. "Switch to {theme}". */
  switchToLabel: string;
  className?: string;
}

export function ThemeToggle({ label, modeLabels, switchToLabel, className = "" }: ThemeToggleProps) {
  const stored = useSyncExternalStore(subscribeThemeMode, readStoredThemeMode, themeModeServerSnapshot);
  const systemDark = useSyncExternalStore(subscribeSystemDark, systemDarkSnapshot, systemDarkServerSnapshot);
  // Before the client snapshot lands, fall back to the documented default.
  const mode: ThemeMode = stored ?? "system";

  // Keep `system` honest: while it is selected, the OS flipping re-paints the
  // document (the store subscription above re-renders this component too).
  useEffect(() => {
    const resolved: ResolvedTheme = resolveTheme(mode, systemDark);
    applyTheme(resolved, document.documentElement);
  }, [mode, systemDark]);

  const cycle = useCallback(() => {
    setThemeMode(nextThemeMode(mode));
  }, [mode]);

  const Icon = ICONS[mode];

  return (
    <button
      type="button"
      onClick={cycle}
      // The accessible name states what the NEXT tap will do, which is what a
      // three-state control needs; the visible icon shows the CURRENT state.
      aria-label={switchToLabel.replace("{theme}", modeLabels[nextThemeMode(mode)])}
      title={`${label}: ${modeLabels[mode]}`}
      className={`inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white ${className}`}
    >
      <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      <span className="sr-only">{`${label}: ${modeLabels[mode]}`}</span>
    </button>
  );
}
