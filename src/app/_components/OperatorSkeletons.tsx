/**
 * Operator route skeletons — the SHARED shape only, never data.
 *
 * The operator pages are `force-dynamic` and read the operation layer, so a cold
 * navigation shows nothing until the server has the rows. The seven
 * `loading.tsx` files in this segment tree render these blocks instead: a calm
 * header plus a few card outlines at the real page's rough heights, so the
 * operator sees the screen settle instead of a blank shell or a spinner.
 *
 * Rules these blocks obey:
 *   - PURE SERVER COMPONENTS: no `"use client"`, no data access, no imports from
 *     the operation layer or Prisma. They are inert markup.
 *   - NO APP CHROME: the `(operator)` layout renders `OperatorNav` and the page
 *     container, and it stays on screen the whole time. Nothing here repeats or
 *     replaces it.
 *   - EXISTING CONVENTIONS ONLY: slate surfaces, `rounded-xl border
 *     border-slate-200 bg-white p-5 shadow-xs`, `animate-pulse`. No new colours,
 *     no new radii, no spinner.
 *   - MOBILE FIRST: one column by default, the page's own breakpoints above.
 *   - HEIGHTS, NOT CONTENT: the pulses reserve roughly the height the real block
 *     occupies, which is what keeps the arrival of data from shifting the page.
 */

/** One pulsing bar. `tone` picks the surface the bar sits on. */
export function SkeletonBar({
  className = "",
  tone = "strong",
}: {
  className?: string;
  tone?: "strong" | "soft";
}) {
  return (
    <div
      className={`animate-pulse rounded ${tone === "strong" ? "bg-slate-200" : "bg-slate-100"} ${className}`}
    />
  );
}

/** The page wrapper every operator page uses. */
export function SkeletonPage({ children }: { children: React.ReactNode }) {
  return <div className="space-y-6">{children}</div>;
}

/**
 * The page header every operator page opens with: an icon eyebrow, a title, a
 * one-line description, an optional right-hand meta row, and the rule beneath.
 */
export function SkeletonHeader({
  titleWidth = "w-56 sm:w-72",
  chipCount = 1,
}: {
  titleWidth?: string;
  chipCount?: number;
}) {
  return (
    <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-4 sm:flex-row sm:items-center">
      <div className="min-w-0 space-y-2">
        <div className="flex items-center gap-2">
          <SkeletonBar className="h-4 w-4" />
          <SkeletonBar className="h-3 w-32" />
        </div>
        <SkeletonBar className={`h-7 ${titleWidth}`} />
        <SkeletonBar className="h-3 w-full max-w-md" tone="soft" />
      </div>
      {chipCount > 0 ? <SkeletonChipRow count={chipCount} /> : null}
    </div>
  );
}

/** The right-hand meta row: "role:", "on the lot:", "N matching filter". */
export function SkeletonChipRow({ count = 2 }: { count?: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 shadow-xs"
        >
          <SkeletonBar className="h-3 w-16" tone="soft" />
        </div>
      ))}
    </div>
  );
}

/** One card, at roughly the height of the real card in that grid. */
export function SkeletonCard({ height = "h-40", lines = 3 }: { height?: string; lines?: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
      <SkeletonBar className={`w-full ${height}`} tone="soft" />
      <div className="mt-4 space-y-2">
        {Array.from({ length: lines }, (_, index) => (
          <SkeletonBar
            key={index}
            className={`h-3 ${index === lines - 1 ? "w-2/3" : "w-full"}`}
            tone="soft"
          />
        ))}
      </div>
    </div>
  );
}

/** A responsive grid of cards, mirroring the page's own breakpoints. */
export function SkeletonCardGrid({
  count = 6,
  columns = "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
  height = "h-40",
  lines = 3,
}: {
  count?: number;
  columns?: string;
  height?: string;
  lines?: number;
}) {
  return (
    <div className={`grid gap-6 ${columns}`}>
      {Array.from({ length: count }, (_, index) => (
        <SkeletonCard key={index} height={height} lines={lines} />
      ))}
    </div>
  );
}

/** A section heading with its own content card underneath. */
export function SkeletonSection({
  height = "h-24",
  lines = 3,
}: {
  height?: string;
  lines?: number;
}) {
  return (
    <section className="space-y-4">
      <SkeletonBar className="h-4 w-40" />
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <SkeletonBar className={`w-full ${height}`} tone="soft" />
        <div className="mt-4 space-y-2">
          {Array.from({ length: lines }, (_, index) => (
            <SkeletonBar key={index} className="h-3 w-full" tone="soft" />
          ))}
        </div>
      </div>
    </section>
  );
}

/** One tall card standing in for a form or a workbench panel. */
export function SkeletonPanel({
  height = "h-72",
  fieldRows = 2,
}: {
  height?: string;
  fieldRows?: number;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <SkeletonBar className="h-4 w-48" />
        <SkeletonBar className="h-3 w-32" tone="soft" />
      </div>
      <div className="mt-4 space-y-4">
        {Array.from({ length: fieldRows }, (_, row) => (
          <div key={row} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, field) => (
              <div key={field} className="space-y-2">
                <SkeletonBar className="h-3 w-24" />
                <SkeletonBar className="h-10 w-full" tone="soft" />
              </div>
            ))}
          </div>
        ))}
        <SkeletonBar className={`w-full ${height}`} tone="soft" />
      </div>
    </section>
  );
}

/** A row of small metric tiles, as the list pages use above their grids. */
export function SkeletonMetricRow({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <SkeletonBar className="h-3 w-20" />
          <SkeletonBar className="mt-3 h-6 w-24" tone="soft" />
        </div>
      ))}
    </div>
  );
}
