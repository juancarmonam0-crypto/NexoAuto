import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_THEME_MODE,
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  THEME_MODES,
  THEME_STORAGE_KEY,
  applyTheme,
  isThemeMode,
  nextThemeMode,
  parseThemeMode,
  persistThemeMode,
  readStoredThemeMode,
  resolveTheme,
  themeBootScript,
} from "@/lib/theme";

/**
 * THEME — light / dark / system.
 *
 * WHAT THIS FILE PINS
 * 1. Three modes, one cycle, and `system` resolved against the OS.
 * 2. Stored values are validated before use, so a hand-edited localStorage entry
 *    or cookie cannot put the app into a state it does not understand.
 * 3. Both stores are written on change, and the boot script reads the same keys.
 * 4. The boot script is dependency-free, runs before paint, and is actually
 *    inlined in the document head — this is what prevents the light flash, and it
 *    is the kind of thing that silently breaks when a layout is refactored.
 * 5. Dark is a real design, not an inversion: no `filter: invert` anywhere.
 */

const repoRoot = join(__dirname, "..");

/** A minimal stand-in for `window`/`document` inside the node test environment. */
function fakeDom() {
  const store = new Map<string, string>();
  const cookieJar: Record<string, string> = {};
  const classes = new Set<string>();

  const element = {
    classList: {
      toggle(name: string, force?: boolean) {
        if (force) classes.add(name);
        else classes.delete(name);
      },
      contains: (name: string) => classes.has(name),
    },
    style: { colorScheme: "" } as { colorScheme: string },
    dataset: {} as Record<string, string>,
  };

  const win = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
    get document() {
      return {
        documentElement: element,
        set cookie(value: string) {
          const [pair] = value.split(";");
          const [name, raw] = pair.split("=");
          cookieJar[name.trim()] = raw ?? "";
        },
        get cookie() {
          return Object.entries(cookieJar)
            .map(([name, value]) => `${name}=${value}`)
            .join("; ");
        },
      };
    },
  };

  return { win, element, classes, store, cookieJar };
}

/** Points the module's global lookups at the fake DOM for one assertion. */
function withFakeDom<T>(fn: (dom: ReturnType<typeof fakeDom>) => T): T {
  const dom = fakeDom();
  const originalWindow = (globalThis as { window?: unknown }).window;
  const originalDocument = (globalThis as { document?: unknown }).document;

  Object.defineProperty(globalThis, "window", { value: dom.win, configurable: true });
  Object.defineProperty(globalThis, "document", { value: dom.win.document, configurable: true });

  try {
    return fn(dom);
  } finally {
    Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
    Object.defineProperty(globalThis, "document", { value: originalDocument, configurable: true });
  }
}

describe("THEME — modes and resolution", () => {
  it("offers exactly light, dark and system", () => {
    expect(THEME_MODES).toEqual(["light", "dark", "system"]);
    expect(DEFAULT_THEME_MODE).toBe("system");
  });

  it("validates a stored value before trusting it", () => {
    expect(isThemeMode("dark")).toBe(true);
    expect(isThemeMode("light")).toBe(true);
    expect(isThemeMode("system")).toBe(true);
    expect(isThemeMode("Dark")).toBe(false);
    expect(isThemeMode("solarized")).toBe(false);
    expect(isThemeMode(null)).toBe(false);
    expect(isThemeMode(undefined)).toBe(false);
  });

  it("narrows a raw value, including case and whitespace", () => {
    expect(parseThemeMode(" Dark ")).toBe("dark");
    expect(parseThemeMode("SYSTEM")).toBe("system");
    expect(parseThemeMode("nonsense")).toBeNull();
    expect(parseThemeMode("")).toBeNull();
  });

  it("follows the OS only while the mode is `system`", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    // An explicit choice always wins over the OS.
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("cycles light → dark → system → light", () => {
    expect(nextThemeMode("light")).toBe("dark");
    expect(nextThemeMode("dark")).toBe("system");
    expect(nextThemeMode("system")).toBe("light");
  });
});

describe("THEME — applying and persisting", () => {
  it("toggles the single class every dark style keys off, plus color-scheme", () => {
    const dom = fakeDom();

    applyTheme("dark", dom.element as unknown as HTMLElement);
    expect(dom.classes.has("dark")).toBe(true);
    expect(dom.element.style.colorScheme).toBe("dark");
    expect(dom.element.dataset.theme).toBe("dark");

    applyTheme("light", dom.element as unknown as HTMLElement);
    expect(dom.classes.has("dark")).toBe(false);
    expect(dom.element.style.colorScheme).toBe("light");
    expect(dom.element.dataset.theme).toBe("light");
  });

  it("does nothing when there is no document (server render)", () => {
    // The module must be importable in a server component without exploding.
    expect(() => applyTheme("dark", undefined as unknown as HTMLElement)).not.toThrow();
  });

  it("writes the choice to BOTH stores so either can be read first", () => {
    withFakeDom((dom) => {
      persistThemeMode("dark");

      expect(dom.store.get(THEME_STORAGE_KEY)).toBe("dark");
      expect(dom.cookieJar[THEME_COOKIE]).toBe("dark");
    });
  });

  it("gives the cookie a long, same-site, path-wide lifetime", () => {
    withFakeDom((dom) => {
      persistThemeMode("light");
      expect(THEME_COOKIE_MAX_AGE).toBe(60 * 60 * 24 * 365);
      // The raw cookie string is assembled by persistThemeMode; the jar above
      // confirms the name/value, and the attributes are asserted on the source.
      const source = readFileSync(join(repoRoot, "src/lib/theme.ts"), "utf8");
      expect(source).toContain("path=/; max-age=");
      expect(source).toContain("samesite=lax");
    });
  });

  it("reads the stored preference, preferring localStorage over the cookie", () => {
    withFakeDom((dom) => {
      dom.win.localStorage.setItem(THEME_STORAGE_KEY, "light");
      expect(readStoredThemeMode()).toBe("light");

      // With no localStorage entry, the cookie carries it.
      dom.win.localStorage.removeItem(THEME_STORAGE_KEY);
      persistThemeMode("dark");
      dom.win.localStorage.removeItem(THEME_STORAGE_KEY);
      expect(readStoredThemeMode()).toBe("dark");
    });
  });

  it("ignores a corrupted stored value instead of breaking", () => {
    withFakeDom((dom) => {
      dom.win.localStorage.setItem(THEME_STORAGE_KEY, "{not-a-mode}");
      expect(readStoredThemeMode()).toBeNull();
    });
  });

  it("survives storage being unavailable (private mode)", () => {
    withFakeDom((dom) => {
      Object.defineProperty(dom.win, "localStorage", {
        value: {
          getItem() {
            throw new Error("blocked");
          },
          setItem() {
            throw new Error("blocked");
          },
        },
        configurable: true,
      });

      expect(() => persistThemeMode("dark")).not.toThrow();
      // The cookie still carries the preference.
      expect(readStoredThemeMode()).toBe("dark");
    });
  });
});

describe("THEME — no flash before first paint", () => {
  const boot = themeBootScript();

  it("is a self-contained statement with no imports or dependencies", () => {
    expect(boot.startsWith("(function(){")).toBe(true);
    expect(boot).not.toMatch(/\bimport\b|\brequire\b/);
    expect(boot.trim().endsWith("})();")).toBe(true);
  });

  it("reads exactly the keys the app writes", () => {
    expect(boot).toContain(JSON.stringify(THEME_STORAGE_KEY));
    expect(boot).toContain(THEME_COOKIE);
  });

  it("defaults to `system` and resolves the OS preference", () => {
    expect(boot).toContain("'system'");
    expect(boot).toContain("prefers-color-scheme: dark");
  });

  it("applies the class before anything renders", () => {
    expect(boot).toContain("classList.add('dark')");
    expect(boot).toContain("colorScheme");
  });

  it("is inlined into the document head, ahead of the body", () => {
    const layout = readFileSync(join(repoRoot, "src/app/layout.tsx"), "utf8");
    expect(layout).toContain("themeBootScript()");
    expect(layout).toMatch(/<head>[\s\S]*themeBootScript\(\)[\s\S]*<\/head>/);
    expect(layout.indexOf("themeBootScript()")).toBeLessThan(layout.indexOf("<body>"));
    // React would otherwise warn about the class this script sets.
    expect(layout).toContain("suppressHydrationWarning");
  });

  it("is valid JavaScript", () => {
    // A syntax error here would break the whole document silently.
    expect(() => new Function(boot)).not.toThrow();
  });
});

describe("THEME — dark mode is designed, not inverted", () => {
  const css = readFileSync(join(repoRoot, "src/app/globals.css"), "utf8");

  it("declares the class-based dark variant Tailwind v4 needs", () => {
    expect(css).toContain("@custom-variant dark");
  });

  it("defines dark surfaces as real colours rather than a filter", () => {
    expect(css).toMatch(/\.dark\s*\{[\s\S]*--surface-page/);
    expect(css).toMatch(/\.dark\s*\{[\s\S]*--surface-card/);
    expect(css).not.toMatch(/filter:\s*invert/);
    expect(css).not.toMatch(/\bgrayscale\(/);
  });

  it("keeps the brand band navy in both themes", () => {
    // The navy band is brand structure, not a dark-mode affordance.
    expect(css).toContain(".brand-panel");
    expect(css).toMatch(/\.dark \.brand-panel/);
  });

  it("tracks color-scheme so native controls follow", () => {
    expect(css).toMatch(/color-scheme:\s*light/);
    expect(css).toMatch(/color-scheme:\s*dark/);
  });
});
