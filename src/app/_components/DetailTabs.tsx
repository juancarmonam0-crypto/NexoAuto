import Link from "next/link";

/**
 * Section tabs for a detail page — URL-driven, server-rendered.
 *
 * Progressive disclosure without shipping client state: the active section
 * lives in `?tab=`, so every section is deep-linkable, the back button works,
 * and only the selected section is rendered (no "dump every field on one
 * screen"). Loading a section is a normal navigation, not a client re-render.
 */

export interface DetailTab {
  key: string;
  label: string;
  /** Optional count shown beside the label, e.g. number of expenses. */
  count?: number;
}

interface DetailTabsProps {
  basePath: string;
  tabs: readonly DetailTab[];
  active: string;
}

export function DetailTabs({ basePath, tabs, active }: DetailTabsProps) {
  return (
    <nav
      aria-label="Sections"
      className="-mx-4 mb-5 flex gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
    >
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={`${basePath}?tab=${tab.key}`}
            aria-current={isActive ? "page" : undefined}
            className={`shrink-0 rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${
              isActive
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            {tab.label}
            {typeof tab.count === "number" ? (
              <span className={`ml-1.5 font-mono ${isActive ? "text-orange-300" : "text-slate-400"}`}>
                {tab.count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
