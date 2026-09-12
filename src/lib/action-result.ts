import { ZodError } from "zod";
import { AuthorizationError } from "@/lib/auth/errors";

/**
 * Typed result for every server action and public form handler.
 *
 * Actions never throw at the UI: they return a discriminated result so the form
 * can render a real message. Unexpected errors are logged server-side and
 * reported generically, so internal details never leak to the browser.
 */
export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export function actionOk(): ActionResult<undefined>;
export function actionOk<T>(data: T): ActionResult<T>;
export function actionOk<T>(data?: T): ActionResult<T> {
  return { ok: true, data } as ActionResult<T>;
}

export function actionFail(error: string, fieldErrors?: Record<string, string[]>): ActionResult<never> {
  return fieldErrors ? { ok: false, error, fieldErrors } : { ok: false, error };
}

/** Raised by action code for expected, user-facing failures. */
export class ActionError extends Error {
  readonly fieldErrors?: Record<string, string[]>;
  constructor(message: string, fieldErrors?: Record<string, string[]>) {
    super(message);
    this.name = "ActionError";
    this.fieldErrors = fieldErrors;
  }
}

export function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export function isPrismaCheckViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2004"
  );
}

const GENERIC_ERROR = "Something went wrong. The action was not saved.";

/** Runs an action body and converts thrown errors into an ActionResult. */
export async function runAction<T>(
  scope: string,
  fn: () => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (error) {
    return actionFail(describeActionError(error, scope));
  }
}

export function describeActionError(error: unknown, scope: string): string {
  if (error instanceof AuthorizationError) return error.message;
  if (error instanceof ActionError) return error.message;
  if (error instanceof ZodError) return "Please correct the highlighted fields.";

  if (isPrismaUniqueViolation(error)) {
    const target = (error as { meta?: { target?: unknown } }).meta?.target;
    const fields = Array.isArray(target) ? target.join(", ") : String(target ?? "");
    if (fields.includes("reservations")) {
      return "This vehicle already has an active reservation.";
    }
    if (fields.includes("vin")) return "A vehicle with that VIN already exists.";
    if (fields.includes("stock_number")) return "That stock number is already in use.";
    if (fields.includes("email")) return "That email address is already registered.";
    return "That record conflicts with an existing one.";
  }
  if (isPrismaCheckViolation(error)) {
    return "The database rejected that value. Check prices, dates and required fields.";
  }

  // Never surface internal error text to the browser.
  console.error(`[action:${scope}] unexpected failure`, error);
  return GENERIC_ERROR;
}

/** Extracts a flat fieldErrors map from a ZodError for form rendering. */
export function zodFieldErrors(error: ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    result[key] = [...(result[key] ?? []), issue.message];
  }
  return result;
}
