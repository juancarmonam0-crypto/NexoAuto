import {
  SkeletonBar,
  SkeletonCard,
  SkeletonHeader,
  SkeletonPage,
  SkeletonPanel,
} from "@/app/_components/OperatorSkeletons";

/**
 * BUY loading skeleton.
 *
 * Mirrors the real page: the "Sourcing Decision Engine" eyebrow, the BUY heading
 * with its opportunities chip, the tall evaluate-a-vehicle workbench, and the
 * two-column sourcing inbox underneath. The `(operator)` layout supplies the
 * navigation.
 */
export default function BuyLoading() {
  return (
    <SkeletonPage>
      <SkeletonHeader titleWidth="w-64 sm:w-72" chipCount={1} />
      <SkeletonPanel fieldRows={2} height="h-28" />
      <div className="space-y-4">
        <SkeletonBar className="h-4 w-44" />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <SkeletonCard height="h-32" lines={3} />
          <SkeletonCard height="h-32" lines={3} />
        </div>
      </div>
    </SkeletonPage>
  );
}
