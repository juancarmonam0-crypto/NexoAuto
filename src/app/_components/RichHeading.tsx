import type { ReactNode } from "react";
import { type EmphasisRun } from "@/lib/i18n/catalog";

/**
 * Headline rendering.
 *
 * The approved mockup emphasises the closing phrase of a headline in Nexo
 * orange. The dictionary stores that as `{{...}}` rather than markup, and this
 * is the only place it becomes a `<span>`. That keeps three things true:
 *
 *   - the copy is never `dangerouslySetInnerHTML`,
 *   - a translator edits one plain sentence,
 *   - the orange treatment is a single design decision, not a per-page one.
 *
 * `\n` in a dictionary value becomes a real line break, which is how the mockup's
 * two-line headings ("Better cars." / "A simpler way.") are expressed without
 * inventing a second key per line.
 */
export function RichHeading({
  runs,
  as: Tag = "h2",
  className = "",
  emphasisClassName = "text-orange-600 dark:text-orange-500",
  id,
}: {
  runs: EmphasisRun[];
  as?: "h1" | "h2" | "h3" | "p" | "span";
  className?: string;
  emphasisClassName?: string;
  /** Lets the enclosing section point `aria-labelledby` at this heading. */
  id?: string;
}) {
  return (
    <Tag id={id} className={className}>
      {runs.map((run, index) => (
        <RichRun key={index} run={run} emphasisClassName={emphasisClassName} />
      ))}
    </Tag>
  );
}

function RichRun({ run, emphasisClassName }: { run: EmphasisRun; emphasisClassName: string }) {
  const parts = run.text.split("\n");

  const content: ReactNode = parts.map((part, index) => (
    <span key={index}>
      {index > 0 && <br />}
      {part}
    </span>
  ));

  if (!run.emphasised) return content;
  return <span className={emphasisClassName}>{content}</span>;
}

/** A single-line variant for inline use, e.g. a section eyebrow. */
export function richInline(runs: EmphasisRun[]): ReactNode {
  return runs.map((run, index) =>
    run.emphasised ? (
      <span key={index} className="text-orange-600 dark:text-orange-500">
        {run.text}
      </span>
    ) : (
      <span key={index}>{run.text}</span>
    ),
  );
}
