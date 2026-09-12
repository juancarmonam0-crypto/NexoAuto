/**
 * Theme preference — the client-safe half.
 *
 * THREE MODES, ONE SWITCH
 *   light | dark | system
 *
 * `system` is the default and follows the OS until the visitor chooses
 * explicitly. The resolved theme is written to `html.dark`, so every dark
 * style in the app keys off one class and no component has to know how the
 * preference was stored.
 *
 * WHY NO THEME LIBRARY
 * This is a class toggle plus a `matchMedia` listener — about 60 lines. A theme
 * package would add a provider, a hydration boundary and a bundle for the same
 * result, and the public pages are deliberately light on client JavaScript.
 *
 * PERSISTENCE
 * `localStorage` is the source of truth for the choice, mirrored into a cookie
 * so the server could read it later without a round trip. The no-flash boot
 * script in `src/app/layout.tsx` reads BOTH before first paint.
 */

export const THEME_STORAGE_KEY = "nexo-theme";
export const THEME_COOKIE = "nexo_theme";

export const THEME_MODES = ["light", "dark", "system"] as const;

export type ThemeMode = (typeof THEME_MODES)[number];
/** What is actually painted once `system` has been resolved. */
export type ResolvedTheme = "light" | "dark";

export const DEFAULT_THEME_MODE: ThemeMode = "system";

/** One year, in seconds. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isThemeMode(value: string | null | undefined): value is ThemeMode {
  return typeof value === "string" && (THEME_MODES as readonly string[]).includes(value);
}

/** Narrows anything to a theme mode, or null when it is not one. */
export function parseThemeMode(value: string | null | undefined): ThemeMode | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return isThemeMode(normalized) ? normalized : null;
}

/** Resolves the mode that should actually be painted. */
export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === "system") return prefersDark ? "dark" : "light";
  return mode;
}

/** The next mode in the cycle: light → dark → system → light. */
export function nextThemeMode(mode: ThemeMode): ThemeMode {
  const index = THEME_MODES.indexOf(mode);
  return THEME_MODES[(index + 1) % THEME_MODES.length];
}

/**
 * Applies a theme to the document: the class every dark style keys off, plus
 * `color-scheme` so native form controls, scrollbars and the browser UI follow.
 */
export function applyTheme(resolved: ResolvedTheme, root?: HTMLElement): void {
  const el = root ?? (typeof document !== "undefined" ? document.documentElement : null);
  if (!el) return;

  el.classList.toggle("dark", resolved === "dark");
  el.style.colorScheme = resolved;
  // Lets CSS know the visitor chose a side, which is useful for the hero media,
  // whose approved artwork is a bright, light-mode composition.
  el.dataset.theme = resolved;
}

/** Persists the choice to both stores. Safe to call with storage unavailable. */
export function persistThemeMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Private mode or storage disabled: the cookie below still carries it.
  }

  try {
    document.cookie = `${THEME_COOKIE}=${mode}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax`;
  } catch {
    // Nothing else to do; the theme still applies for this page view.
  }
}

/** Reads the stored preference, preferring `localStorage` over the cookie. */
export function readStoredThemeMode(): ThemeMode | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = parseThemeMode(window.localStorage.getItem(THEME_STORAGE_KEY));
    if (stored) return stored;
  } catch {
    // Fall through to the cookie.
  }

  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${THEME_COOKIE}=([^;]*)`));
  return parseThemeMode(match?.[1] ?? null);
}

/* ---------------------------------------------------------------------------
   Reactive reads for React.
   ---------------------------------------------------------------------------
   `useSyncExternalStore` is the supported way to read a browser API during
   render: it needs a snapshot function plus a subscription, and — crucially — a
   server snapshot, so the first client render matches the server render and
   hydration stays clean. Both stores below follow that shape, which is why
   neither component needs a "read it in an effect" workaround.
   --------------------------------------------------------------------------- */

const modeListeners = new Set<() => void>();

/** Notifies every subscribed component that the stored preference changed. */
function emitModeChange(): void {
  for (const listener of modeListeners) listener();
}

/** The current preference as React sees it. Stable between changes. */
export function subscribeThemeMode(listener: () => void): () => void {
  modeListeners.add(listener);
  return () => {
    modeListeners.delete(listener);
  };
}

/** Server snapshot: the server cannot know the visitor's choice. */
export function themeModeServerSnapshot(): ThemeMode {
  return DEFAULT_THEME_MODE;
}

/**
 * Live OS dark-mode preference.
 *
 * `system` has to keep tracking the operating system while it is selected, so the
 * media query is exposed as an external store rather than read during render
 * (which would be impure and would not update when the OS flips).
 */
export function subscribeSystemDark(listener: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

export function systemDarkSnapshot(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Server snapshot: light until the client says otherwise. */
export function systemDarkServerSnapshot(): boolean {
  return false;
}

/**
 * Applies a mode: persists it, resolves it, and paints it.
 *
 * Persisting notifies subscribers, so the control and the document can never
 * disagree about the current mode.
 */
export function setThemeMode(mode: ThemeMode): void {
  persistThemeMode(mode);
  applyTheme(resolveTheme(mode, systemDarkSnapshot()));
  emitModeChange();
}

/**
 * The pre-paint boot script, inlined into `<head>`.
 *
 * It runs before any content is parsed, so a visitor who chose dark never sees a
 * white flash. Kept to one statement and no dependency; the constants are
 * inlined by `themeBootScript()` from the values above so the script and the
 * module cannot disagree about key names.
 */
export function themeBootScript(): string {
  return `(function(){try{var m=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(m!=='light'&&m!=='dark'&&m!=='system'){m=null;}if(!m){var c=document.cookie.match(/(?:^|;\\s*)${THEME_COOKIE}=([^;]*)/);m=c&&c[1]?c[1]:null;}if(m!=='light'&&m!=='dark'&&m!=='system'){m='system';}var d=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;if(d){e.classList.add('dark');}e.style.colorScheme=d?'dark':'light';e.dataset.theme=d?'dark':'light';e.dataset.themeMode=m;}catch(_){}})();`;
}
