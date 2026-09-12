"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Mail, Menu, Phone, X } from "lucide-react";

/**
 * Mobile navigation drawer.
 *
 * WHY A DRAWER NOW
 * The mockup's header carries five destinations plus the language, theme and CTA
 * controls. That does not fit a 375px bar without shrinking tap targets, and
 * squeezing desktop links onto a phone is exactly what the brief rules out.
 *
 * ACCESSIBILITY
 * A real disclosure: the panel is a labelled `<nav>`, the trigger reports
 * `aria-expanded`/`aria-controls`, Escape closes it, focus moves into the panel on
 * open and returns to the trigger on close, and the page behind is locked from
 * scrolling. Links arrive already translated from the server component, so the
 * drawer holds no copy of its own and stays language-agnostic.
 *
 * The drawer closes on link activation rather than on a pathname effect: the
 * overlay is gone before the route changes, and no state is derived inside an
 * effect.
 */

export interface MenuLink {
  href: string;
  label: string;
}

interface MobileMenuProps {
  links: MenuLink[];
  openLabel: string;
  closeLabel: string;
  title: string;
  /** Contact actions, rendered as real links when configured. */
  phone?: string | null;
  email?: string | null;
  callLabel: string;
  emailLabel: string;
  /** Header-level controls (language + theme) shown inside the drawer too. */
  children?: React.ReactNode;
}

export function MobileMenu({
  links,
  openLabel,
  closeLabel,
  title,
  phone,
  email,
  callLabel,
  emailLabel,
  children,
}: MobileMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    // Move focus into the panel so the first Tab lands inside it.
    panelRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="mobile-menu-panel"
        aria-label={open ? closeLabel : openLabel}
        className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 lg:hidden dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
      >
        {open ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
      </button>

      {open && (
        <div
          id="mobile-menu-panel"
          ref={panelRef}
          tabIndex={-1}
          className="fixed inset-x-0 top-16 z-40 max-h-[calc(100dvh-4rem)] overflow-y-auto border-b border-slate-200 bg-white px-4 pb-6 pt-4 shadow-xl outline-none lg:hidden dark:border-white/10 dark:bg-[var(--brand-navy-950)]"
        >
          <nav aria-label={title}>
            <ul className="space-y-1">
              {links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    // Closing on activation is the reliable moment: the drawer is
                    // gone before the route changes, so the new page never renders
                    // underneath an open overlay.
                    onClick={() => setOpen(false)}
                    className="flex h-12 items-center rounded-xl px-3 text-base font-semibold text-[var(--brand-navy-900)] transition-colors hover:bg-slate-100 dark:text-white dark:hover:bg-white/10"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {(phone || email) && (
            <div className="mt-4 space-y-2 border-t border-slate-200 pt-4 dark:border-white/10">
              {phone && (
                <a
                  href={`tel:${phone.replace(/[^+\d]/g, "")}`}
                  className="flex h-12 items-center gap-2 rounded-xl bg-orange-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-orange-700"
                >
                  <Phone className="h-4 w-4" aria-hidden="true" />
                  <span>{callLabel}</span>
                </a>
              )}
              {email && (
                <a
                  href={`mailto:${email}`}
                  className="flex h-12 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-[var(--brand-navy-900)] transition-colors hover:bg-slate-50 dark:border-white/20 dark:text-white dark:hover:bg-white/10"
                >
                  <Mail className="h-4 w-4 text-orange-600 dark:text-orange-400" aria-hidden="true" />
                  <span>{emailLabel}</span>
                </a>
              )}
            </div>
          )}

          {children && (
            <div className="mt-4 flex items-center gap-3 border-t border-slate-200 pt-4 dark:border-white/10">
              {children}
            </div>
          )}
        </div>
      )}
    </>
  );
}
