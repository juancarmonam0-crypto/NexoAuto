import {
  SkeletonBar,
  SkeletonCard,
  SkeletonPage,
} from "@/app/_components/OperatorSkeletons";

/**
 * SALES / DESK loading skeleton.
 *
 * The desk is the one operator route that ships a real client bundle. This
 * skeleton mirrors the page's own header and the workbench's first paint: the
 * breadcrumb, DEAL DESK, the role / capability chips, the path selector, and the
 * first steps of the staged workflow — the same shape the calculators' own
 * `next/dynamic` placeholder uses, so choosing a path feels like the same screen
 * arriving rather than a new one.
 *
 * The `(operator)` layout keeps `OperatorNav` on screen; nothing here replaces it.
 * No client directive and no data access: this is inert markup.
 */
export default function DealDeskLoading() {
  return (
    <SkeletonPage>
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <SkeletonBar className="h-3 w-3" tone="soft" />
            <SkeletonBar className="h-3 w-16" />
          </div>
          <SkeletonBar className="h-7 w-48 sm:w-56" />
          <SkeletonBar className="h-3 w-full max-w-md" tone="soft" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SkeletonBar className="h-7 w-24 rounded-lg" tone="soft" />
          <SkeletonBar className="h-7 w-40 rounded-lg" tone="soft" />
          <SkeletonBar className="h-7 w-36 rounded-lg" tone="soft" />
        </div>
      </div>

      {/* Workbench — the path selector and the first workflow step. */}
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <SkeletonBar className="h-3 w-40" />
          <div className="mt-2 flex flex-col gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 sm:flex-row sm:flex-wrap">
            {Array.from({ length: 4 }, (_, index) => (
              <SkeletonBar
                key={index}
                className="h-10 flex-1 rounded-md sm:w-40 sm:flex-none"
                tone={index === 0 ? "strong" : "soft"}
              />
            ))}
          </div>
          <SkeletonBar className="mt-2 h-3 w-full max-w-lg" tone="soft" />
        </div>

        <SkeletonCard height="h-24" lines={2} />
        <SkeletonCard height="h-32" lines={3} />
      </div>
    </SkeletonPage>
  );
}
