"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

/**
 * The one client component in the Phase 6 shell.
 *
 * WHY IT EXISTS
 * A server-rendered `<form action={serverAction}>` works without JavaScript,
 * but its return value is discarded, so an operator would see a failed mutation
 * as "the page did not change". This wrapper keeps the canonical action
 * signature — `(FormData) => Promise<ActionResult>` — and adds the two things a
 * form needs: a pending state and the action's own error message.
 *
 * It is presentation scaffolding. The final UI is expected to replace it with
 * its own form primitives; the ACTIONS it calls are the stable contract.
 *
 * The outcome is typed structurally on purpose: the client only needs to know
 * whether the call succeeded and, if not, what to show.
 */

export interface FormActionOutcome {
  ok: boolean;
  error?: string;
  code?: string;
}

export type FormAction = (formData: FormData) => Promise<FormActionOutcome>;

interface ActionFormProps {
  action: FormAction;
  children: ReactNode;
  submitLabel: string;
  successMessage?: string;
}

export function ActionForm({ action, children, submitLabel, successMessage = "Saved." }: ActionFormProps) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<FormActionOutcome | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData: FormData) => {
        startTransition(async () => {
          const result = await action(formData);
          setOutcome(result);
          // Re-fetch the server components so the page reflects the new state.
          if (result.ok) router.refresh();
        });
      }}
    >
      {children}
      <button type="submit" disabled={pending}>
        {pending ? "Working…" : submitLabel}
      </button>
      {outcome && !outcome.ok ? (
        <p className="banner banner-error" role="alert">
          {outcome.error}
          {outcome.code ? <span className="muted"> ({outcome.code})</span> : null}
        </p>
      ) : null}
      {outcome?.ok ? (
        <p className="banner banner-ok" role="status">
          {successMessage}
        </p>
      ) : null}
    </form>
  );
}
