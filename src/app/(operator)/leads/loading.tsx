import {
  SkeletonCardGrid,
  SkeletonHeader,
  SkeletonPage,
  SkeletonPanel,
} from "@/app/_components/OperatorSkeletons";

/**
 * LEADS loading skeleton.
 *
 * Mirrors the real page: the "Customer Pipeline" eyebrow, the LEADS heading, the
 * open/matching count chip, the tall "Log a new inquiry" intake card, and the
 * lead card grid underneath. The `(operator)` layout supplies the navigation.
 */
export default function LeadsLoading() {
  return (
    <SkeletonPage>
      <SkeletonHeader titleWidth="w-60 sm:w-72" chipCount={1} />
      <SkeletonPanel fieldRows={1} height="h-24" />
      <SkeletonCardGrid count={6} height="h-36" lines={3} />
    </SkeletonPage>
  );
}
