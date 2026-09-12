import { formatBasisPoints, formatCents } from "@/lib/money";

interface MoneyMetricProps {
  label: string;
  valueCents: number | null;
  roiBasisPoints?: number | null;
  accent?: "default" | "orange" | "green" | "muted";
  size?: "sm" | "md" | "lg";
}

export function MoneyMetric({
  label,
  valueCents,
  roiBasisPoints,
  accent = "default",
  size = "md",
}: MoneyMetricProps) {
  const isMasked = valueCents === null && roiBasisPoints === undefined;

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
      <span
        className={`font-mono tracking-tight ${accentStyles[accent]} ${sizeStyles[size]}`}
      >
        {isMasked
          ? "—"
          : roiBasisPoints !== undefined && roiBasisPoints !== null
            ? formatBasisPoints(roiBasisPoints, 1)
            : formatCents(valueCents)}
      </span>
    </div>
  );
}
