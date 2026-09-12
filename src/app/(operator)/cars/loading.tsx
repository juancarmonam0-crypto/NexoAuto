import { SkeletonCardGrid, SkeletonHeader, SkeletonPage } from "@/app/_components/OperatorSkeletons";

/**
 * CARS loading skeleton.
 *
 * Mirrors the real page: the icon eyebrow, "CARS — Fleet Command", the published
 * count chip, and the one-to-three column card grid. The `(operator)` layout keeps
 * `OperatorNav` and the page container on screen, so nothing here touches the
 * navigation.
 */
export default function CarsLoading() {
  return (
    <SkeletonPage>
      <SkeletonHeader titleWidth="w-64 sm:w-80" chipCount={2} />
      <div className="space-y-4">
        <div className="h-6 w-44 animate-pulse rounded bg-slate-200" />
        <SkeletonCardGrid count={6} height="h-36" lines={3} />
      </div>
    </SkeletonPage>
  );
}
