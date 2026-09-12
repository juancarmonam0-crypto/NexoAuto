interface StatusBadgeProps {
  /**
   * The canonical status token ("AVAILABLE", "RESERVED", …). Always English:
   * it is a value, and the variant is derived from it.
   */
  status: string;
  /**
   * Localised display text. When omitted the token itself is shown, which is
   * what the operator surfaces (English-only) rely on.
   */
  label?: string;
  variant?: "neutral" | "info" | "warning" | "success" | "danger" | "orange";
  size?: "sm" | "md";
}

export function StatusBadge({ status, label, variant, size = "sm" }: StatusBadgeProps) {
  const normalized = status.toUpperCase();

  let computedVariant = variant;
  if (!computedVariant) {
    if (["AVAILABLE", "ACTIVE", "LISTED", "WON", "COMPLETED", "APPROVED", "BUY"].includes(normalized)) {
      computedVariant = "success";
    } else if (["RESERVED", "WATCH", "IN_PROGRESS", "CONTACTED", "APPOINTMENT"].includes(normalized)) {
      computedVariant = "warning";
    } else if (["DEMO"].includes(normalized)) {
      // Honesty marker for vehicles that are not real inventory: visible, but
      // deliberately not styled like a state the customer should act on.
      computedVariant = "orange";
    } else if (["SOLD", "PASS", "LOST", "CANCELLED", "REJECTED"].includes(normalized)) {
      computedVariant = "neutral";
    } else if (["RECON", "TRANSIT", "INSPECTING"].includes(normalized)) {
      computedVariant = "info";
    } else {
      computedVariant = "neutral";
    }
  }

  const styles = {
    neutral: "bg-slate-100 text-slate-700 border-slate-200",
    info: "bg-blue-50 text-blue-800 border-blue-200",
    warning: "bg-amber-50 text-amber-800 border-amber-200",
    success: "bg-emerald-50 text-emerald-800 border-emerald-200",
    danger: "bg-rose-50 text-rose-800 border-rose-200",
    orange: "bg-orange-50 text-orange-800 border-orange-200 font-bold",
  };

  const sizes = {
    sm: "px-2 py-0.5 text-[11px]",
    md: "px-2.5 py-1 text-xs font-semibold",
  };

  return (
    <span
      className={`inline-flex items-center justify-center rounded-md font-mono border tracking-tight ${styles[computedVariant]} ${sizes[size]}`}
    >
      {label ?? status}
    </span>
  );
}
