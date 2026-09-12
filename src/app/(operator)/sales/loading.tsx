import {
  SkeletonCard,
  SkeletonHeader,
  SkeletonPage,
  SkeletonPanel,
} from "@/app/_components/OperatorSkeletons";

/**
 * SALES loading skeleton.
 *
 * Mirrors the real page: the "Deals & Closings" eyebrow, the SALES heading with
 * its Deal Desk link and the on-the-lot / completed chips, then the completed-sales
 * section and the two-column close-a-sale grid. The `(operator)` layout supplies
 * the navigation.
 */
export default function SalesLoading() {
  return (
    <SkeletonPage>
      <SkeletonHeader titleWidth="w-40 sm:w-48" chipCount={2} />
      <div className="space-y-4">
        <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />
        <SkeletonPanel fieldRows={1} height="h-20" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SkeletonCard height="h-32" lines={3} />
        <SkeletonCard height="h-32" lines={3} />
      </div>
    </SkeletonPage>
  );
}
