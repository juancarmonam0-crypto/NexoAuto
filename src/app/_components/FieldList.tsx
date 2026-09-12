/**
 * Compact label/value list with honest empty handling.
 *
 * A `null` means "not recorded" OR "withheld by role masking" — the caller
 * decides which by passing `hidden`/omitting the field entirely, so the UI
 * never renders a bare `undefined`, a `$0` or an invented value.
 */

export interface FieldItem {
  label: string;
  value: string | number | null | undefined;
  /** Optional trailing note, e.g. the vendor or a date. */
  note?: string | null;
  /** Render the value in monospace (money, VIN, dates). */
  mono?: boolean;
}

interface FieldListProps {
  fields: readonly FieldItem[];
  columns?: 1 | 2 | 3;
}

const COLUMN_CLASS: Record<1 | 2 | 3, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
};

export function FieldList({ fields, columns = 2 }: FieldListProps) {
  const visible = fields.filter((field) => field.value !== undefined);
  if (visible.length === 0) return null;

  return (
    <dl className={`grid gap-3 ${COLUMN_CLASS[columns]}`}>
      {visible.map((field) => (
        <div key={field.label} className="min-w-0 space-y-0.5">
          <dt className="font-mono text-[11px] font-medium uppercase tracking-wider text-slate-500">
            {field.label}
          </dt>
          <dd
            className={`truncate text-sm text-slate-900 ${field.mono ? "font-mono" : ""} ${
              field.value === null || field.value === "" ? "text-slate-400" : ""
            }`}
          >
            {field.value === null || field.value === "" ? "Not recorded" : field.value}
            {field.note ? <span className="ml-2 text-xs text-slate-500">{field.note}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
