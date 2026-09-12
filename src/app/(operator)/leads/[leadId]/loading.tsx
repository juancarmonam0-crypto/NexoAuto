import {
  SkeletonBar,
  SkeletonCard,
  SkeletonMetricRow,
  SkeletonPage,
} from "@/app/_components/OperatorSkeletons";

/**
 * LEADS / [leadId] loading skeleton.
 *
 * Mirrors the real page: the back link, the customer name with its status badge,
 * the mono context line, the "Structure a deal for this lead" entry, then the
 * metric row and the panels of follow-up history. The `(operator)` layout supplies
 * the navigation.
 */
export default function LeadDetailLoading() {
  return (
    <SkeletonPage>
      <div className="space-y-3">
        <SkeletonBar className="h-4 w-28" tone="soft" />
        <div className="border-b border-slate-200 pb-4">
          <div className="flex flex-wrap items-center gap-3">
            <SkeletonBar className="h-7 w-56 sm:w-72" />
            <SkeletonBar className="h-6 w-24" tone="soft" />
          </div>
          <SkeletonBar className="mt-2 h-3 w-full max-w-lg" tone="soft" />
          <div className="mt-3">
            <SkeletonBar className="h-8 w-56 rounded-lg" tone="soft" />
          </div>
        </div>
      </div>

      <SkeletonMetricRow count={4} />

      <div className="space-y-5">
        <SkeletonCard height="h-28" lines={3} />
        <SkeletonCard height="h-28" lines={3} />
      </div>
    </SkeletonPage>
  );
}
