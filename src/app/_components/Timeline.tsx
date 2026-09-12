export interface TimelineEntry {
  id: string;
  title: string;
  /** Pre-formatted on the server so the component stays presentation-only. */
  timestamp: string;
  body?: string | null;
  tone?: "neutral" | "progress" | "success" | "danger";
}

const TONE_CLASS: Record<NonNullable<TimelineEntry["tone"]>, string> = {
  neutral: "bg-slate-300",
  progress: "bg-amber-500",
  success: "bg-emerald-500",
  danger: "bg-rose-500",
};

/**
 * Vertical timeline for the two histories the backend already records:
 * `LeadActivity` rows (notes, calls, status changes) and `VehicleStatusEvent`
 * rows. Server-rendered: no client state, no polling.
 */
export function Timeline({ entries, emptyLabel }: { entries: readonly TimelineEntry[]; emptyLabel: string }) {
  if (entries.length === 0) {
    return <p className="text-xs text-slate-500">{emptyLabel}</p>;
  }

  return (
    <ol className="space-y-0">
      {entries.map((entry, index) => (
        <li key={entry.id} className="relative flex gap-3 pb-4 last:pb-0">
          {/* connector */}
          {index < entries.length - 1 ? (
            <span aria-hidden="true" className="absolute left-[5px] top-4 h-full w-px bg-slate-200" />
          ) : null}
          <span
            aria-hidden="true"
            className={`relative z-10 mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${TONE_CLASS[entry.tone ?? "neutral"]}`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="text-sm font-semibold text-slate-900">{entry.title}</p>
              <p className="font-mono text-[11px] text-slate-500">{entry.timestamp}</p>
            </div>
            {entry.body ? <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{entry.body}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
