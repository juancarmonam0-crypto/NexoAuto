import {
  SkeletonBar,
  SkeletonCard,
  SkeletonPage,
} from "@/app/_components/OperatorSkeletons";

/**
 * CARS / [vehicleId] loading skeleton — the heaviest operator read (the vehicle
 * detail with its economics), so this is the segment that most needs immediate
 * feedback.
 *
 * Mirrors the real page's command bar: the breadcrumb, the title with its status
 * chips, the lifecycle meta row, and then the tab strip over the first panel of
 * sections. The `(operator)` layout supplies the navigation.
 */
export default function VehicleDetailLoading() {
  return (
    <SkeletonPage>
      {/* Command bar — identity and lifecycle at a glance. */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <SkeletonBar className="h-3 w-20" />
          <SkeletonBar className="h-3 w-3" tone="soft" />
          <SkeletonBar className="h-3 w-24" tone="soft" />
        </div>

        <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <SkeletonBar className="h-7 w-64 sm:w-80" />
              <SkeletonBar className="h-6 w-24" tone="soft" />
              <SkeletonBar className="h-6 w-28" tone="soft" />
            </div>
            <SkeletonBar className="h-3 w-40" tone="soft" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SkeletonBar className="h-9 w-28" tone="soft" />
            <SkeletonBar className="h-9 w-28" tone="soft" />
          </div>
        </div>

        {/* Lifecycle metric row. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="rounded-lg border border-slate-200 bg-white p-3 shadow-xs">
              <SkeletonBar className="h-3 w-20" />
              <SkeletonBar className="mt-2 h-5 w-24" tone="soft" />
            </div>
          ))}
        </div>
      </div>

      {/* Tab strip. */}
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 5 }, (_, index) => (
          <SkeletonBar key={index} className="h-9 w-24 rounded-lg" tone={index === 0 ? "strong" : "soft"} />
        ))}
      </div>

      {/* First panel of sections. */}
      <div className="space-y-5">
        <SkeletonCard height="h-24" lines={2} />
        <SkeletonCard height="h-32" lines={3} />
      </div>
    </SkeletonPage>
  );
}
