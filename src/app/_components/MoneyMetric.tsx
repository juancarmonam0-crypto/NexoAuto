import { EyeOff } from "lucide-react";
import { formatBasisPoints, formatCents } from "@/lib/money";

interface MoneyMetricProps {
  label: string;
  valueCents: number | null;
  roiBasisPoints?: number | null;
  accent?: "default" | "orange" | "green" | "muted";
  size?: "sm" | "md" | "lg";
  /**
   * True when the figure is WITHHELD by role masking rather than simply absent.
   *
   * The two cases look different to an operator and must read differently: a
   * dash means "nothing recorded here yet", while "Hidden" means "this exists
   * and your role may not see it". A number is never invented for either.
   */
  masked?: boolean;
}

const MASKED_NOTE = "Your role is not permitted to view this figure.";

export function MoneyMetric({
  label,
  valueCents,
  roiBasisPoints,
  accent = "default",
  size = "md",
  masked,
}: MoneyMetricProps) {
  // Inferred when the caller does not say: every value withheld and no ROI
  // supplied means masking, since a genuinely empty record still carries 0.
  const isMasked = masked ?? (valueCents === null && roiBasisPoints === undefined);

  const accentStyles = {
    default: "text-slate-900",
    orange: "text-orange-700",
    green: "text-emerald-700",
    muted: "text-slate-500",
  };

  const sizeStyles = {
    sm: "text-sm",
    md: "text-base sm:text-lg font-bold",
    lg: "text-xl sm:text-2xl font-extrabold",
  };

  return (
    <div className="flex flex-col space-y-0.5">
      <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500 font-mono">
        {label}
      </span>
      {isMasked ? (
        <span
          title={MASKED_NOTE}
          className="inline-flex w-fit items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-500"
        >
          <EyeOff className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span>Hidden</span>
          <span className="sr-only">{MASKED_NOTE}</span>
        </span>
      ) : (
        <span className={`font-mono tracking-tight ${accentStyles[accent]} ${sizeStyles[size]}`}>
          {roiBasisPoints !== undefined && roiBasisPoints !== null
            ? formatBasisPoints(roiBasisPoints, 1)
            : formatCents(valueCents)}
        </span>
      )}
    </div>
  );
}
