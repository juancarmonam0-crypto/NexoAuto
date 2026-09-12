"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

export interface FormActionOutcome {
  ok: boolean;
  error?: string;
  code?: string;
}

export type FormAction = (formData: FormData) => Promise<FormActionOutcome>;

interface ActionFormProps {
  action: FormAction;
  children?: ReactNode;
  submitLabel: string;
  successMessage?: string;
  className?: string;
  buttonVariant?: "primary" | "secondary" | "danger" | "success" | "outline" | "neutral";
  buttonClassName?: string;
  buttonSize?: "sm" | "md" | "lg";
}

export function ActionForm({
  action,
  children,
  submitLabel,
  successMessage = "Saved successfully.",
  className = "",
  buttonVariant = "primary",
  buttonClassName = "",
  buttonSize = "md",
}: ActionFormProps) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<FormActionOutcome | null>(null);
  const [pending, startTransition] = useTransition();

  const variantStyles = {
    primary:
      "bg-orange-600 hover:bg-orange-700 text-white font-semibold shadow-xs active:bg-orange-800 focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2",
    secondary:
      "bg-slate-900 hover:bg-slate-800 text-white font-medium active:bg-slate-950 focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2",
    danger:
      "bg-rose-600 hover:bg-rose-700 text-white font-medium active:bg-rose-800 focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2",
    success:
      "bg-emerald-600 hover:bg-emerald-700 text-white font-medium active:bg-emerald-800 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2",
    outline:
      "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 font-medium focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2",
    neutral:
      "border border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200 font-medium focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2",
  };

  const sizeStyles = {
    sm: "px-3 py-1.5 text-xs rounded-lg",
    md: "px-4 py-2 text-sm rounded-lg",
    lg: "px-5 py-2.5 text-base rounded-xl font-semibold",
  };

  return (
    <form
      className={`space-y-4 ${className}`}
      action={(formData: FormData) => {
        setOutcome(null);
        startTransition(async () => {
          const result = await action(formData);
          setOutcome(result);
          if (result.ok) {
            router.refresh();
          }
        });
      }}
    >
      {children}

      <div className="pt-1">
        <button
          type="submit"
          disabled={pending}
          className={`inline-flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${variantStyles[buttonVariant]} ${sizeStyles[buttonSize]} ${buttonClassName}`}
        >
          {pending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Processing...</span>
            </>
          ) : (
            <span>{submitLabel}</span>
          )}
        </button>
      </div>

      {outcome && !outcome.ok ? (
        <div
          role="alert"
          className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2"
        >
          <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-medium">{outcome.error || "Operation failed."}</p>
            {outcome.code ? (
              <p className="text-[11px] text-rose-600 font-mono">
                Code: {outcome.code}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {outcome?.ok ? (
        <div
          role="status"
          className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <p className="font-medium">{successMessage}</p>
        </div>
      ) : null}
    </form>
  );
}
