"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * SCROLL REVEAL — the public landing's single motion primitive.
 *
 * WHY IT WORKS THIS WAY
 *
 * The server renders every section VISIBLE. Nothing on the page is hidden by
 * markup or by CSS that a browser would apply on its own. The hidden state is
 * only ever set here, on the client, and only after this component has decided
 * that (a) it is running, (b) a scroll observer is available, and (c) the
 * element is genuinely below the fold.
 *
 * The consequences are the ones that matter for a marketing page:
 *
 *   - No JavaScript  → the whole page is visible, nothing is blank.
 *   - No IntersectionObserver (older browsers) → the same.
 *   - `prefers-reduced-motion: reduce` → the same, and no attribute is written
 *     at all, so the CSS never has a reason to move anything.
 *   - Crawlers and screen readers → the complete document, in order.
 *
 * Elements already on screen at mount are deliberately left alone. Animating
 * something the visitor is currently looking at is not an entrance, it is a
 * flash of missing content, and it also delays the largest contentful paint.
 *
 * The stagger is a transition DELAY, applied by `Reveal.tsx`, so a row of cards
 * arrives in sequence while every card remains independently observable.
 *
 * ONE OBSERVER, NOT ONE PER ELEMENT
 * A single module-level IntersectionObserver serves the whole page, and each
 * element is unobserved the moment it is released. There is no scroll listener,
 * no per-frame work, and no layout thrash while the visitor scrolls.
 */

/** How far below the fold an element must be before it is worth animating. */
const ALREADY_VISIBLE_RATIO = 0.85;

/** A reveal waits until the element is properly inside the viewport. */
const OBSERVER_OPTIONS: IntersectionObserverInit = {
  rootMargin: "0px 0px -8% 0px",
  threshold: 0.08,
};

let sharedObserver: IntersectionObserver | null = null;

function revealObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === "undefined") return null;

  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const element = entry.target as HTMLElement;
        /*
          Arming and releasing in the same frame is intentional: the transition
          itself is declared by `[data-reveal-armed]`, so the element goes from a
          static hidden state to an animated visible one. It can never animate
          "out" on the way in.
        */
        element.setAttribute("data-reveal-armed", "");
        element.setAttribute("data-reveal", "shown");
        sharedObserver?.unobserve(element);
      }
    }, OBSERVER_OPTIONS);
  }

  return sharedObserver;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface RevealProps {
  children: ReactNode;
  /**
   * Stagger, in milliseconds. Kept small (60–100ms) so a row of four settles in
   * well under half a second.
   */
  delay?: number;
  /**
   * `rise` moves 22px up into place; `fade` only changes opacity, which is the
   * calmer choice for large surfaces such as a full-width panel.
   */
  motion?: "rise" | "fade";
  className?: string;
}

export function Reveal({ children, delay = 0, motion = "rise", className = "" }: RevealProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (prefersReducedMotion()) return;

    const observer = revealObserver();
    if (!observer) return;

    // Already on screen: leave it visible. See the note at the top of the file.
    const rect = element.getBoundingClientRect();
    const onScreen = rect.top < window.innerHeight * ALREADY_VISIBLE_RATIO && rect.bottom > 0;
    if (onScreen) return;

    if (delay > 0) element.style.setProperty("--reveal-delay", `${delay}ms`);
    element.setAttribute("data-reveal-motion", motion);
    element.setAttribute("data-reveal", "hidden");
    observer.observe(element);

    return () => observer.unobserve(element);
  }, [delay, motion]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
