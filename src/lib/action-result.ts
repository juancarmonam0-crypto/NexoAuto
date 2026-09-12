import { ZodError } from "zod";
import { AuthorizationError } from "@/lib/auth/errors";
import { DomainError } from "@/lib/domain-errors";

/**
 * Stable, browser-safe error codes.
 *
 * The UI switches on these, never on message text: a message is written for an
 * operator and may be reworded, while a code is part of the contract. They are
 * deliberately coarse — the UI needs to know *what to do* (re-authenticate,
 * show a field error, offer a different state), not which layer failed.
 */
export const ACTION_ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "INVALID_STATE",
  "INTERNAL_ERROR",
] as const;

export type ActionErrorCode = (typeof ACTION_ERROR_CODES)[number];

/** The failure half of an ActionResult. */
export interface ActionFailure {
  ok: false;
  error: string;
  code: ActionErrorCode;
  fieldErrors?: Record<string, string[]>;
}

/**
 * Typed result for every server action and public form handler.
 *
 * Actions never throw at the UI: they return a discriminated result so the form
 * can render a real message. Unexpected errors are logged server-side and
 * reported generically, so internal details never leak to the browser.
 */
export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | ActionFailure;

export function actionOk(): ActionResult<undefined>;
export function actionOk<T>(data: T): ActionResult<T>;
export function actionOk<T>(data?: T): ActionResult<T> {
  return { ok: true, data } as ActionResult<T>;
}

export function actionFail(
  error: string,
  options: { code?: ActionErrorCode; fieldErrors?: Record<string, string[]> } = {},
): ActionFailure {
  const failure: ActionFailure = { ok: false, error, code: options.code ?? "INTERNAL_ERROR" };
  if (options.fieldErrors) failure.fieldErrors = options.fieldErrors;
  return failure;
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
    return failureFrom(error, scope);
  }
}

/**
 * Runs a domain OPERATION and wraps its value in an ActionResult.
 *
 * Operations (see `src/lib/operations`) return their result or throw; they do
 * not know about forms or HTTP. This adapter is what a server action calls so
 * a thrown NotFound/Conflict/Authorization error becomes a message the UI can
 * render instead of an unhandled rejection.
 */
export async function runOperation<T>(
  scope: string,
  fn: () => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    return actionOk(await fn());
  } catch (error) {
    return failureFrom(error, scope);
  }
}

/** Builds the browser-facing failure for a thrown error. */
export function failureFrom(error: unknown, scope: string): ActionFailure {
  return actionFail(describeActionError(error, scope), {
    code: actionErrorCode(error),
    fieldErrors: actionFieldErrors(error),
  });
}

/**
 * Classifies an error for the UI. Order matters: the typed domain errors are
 * checked before the generic `code` probe, because several of these classes
 * carry their own unrelated `code` property.
 */
export function actionErrorCode(error: unknown): ActionErrorCode {
  if (error instanceof AuthorizationError) {
    return error.reason === "unauthenticated" ? "UNAUTHORIZED" : "FORBIDDEN";
  }
  if (error instanceof ZodError) return "VALIDATION_ERROR";
  if (error instanceof DomainError) {
    if (error.code === "NOT_FOUND") return "NOT_FOUND";
    if (error.code === "CONFLICT") return "CONFLICT";
    return "VALIDATION_ERROR";
  }
  if (error instanceof ActionError) return "VALIDATION_ERROR";

  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && OPERATOR_FACING_CODES.has(code)) return "INVALID_STATE";

  if (isPrismaUniqueViolation(error)) return "CONFLICT";
  if (isPrismaCheckViolation(error)) return "VALIDATION_ERROR";
  return "INTERNAL_ERROR";
}

function actionFieldErrors(error: unknown): Record<string, string[]> | undefined {
  if (error instanceof ZodError) return zodFieldErrors(error);
  if (error instanceof ActionError) return error.fieldErrors;
  return undefined;
}

/**
 * Error codes that carry a message already written for the operator.
 *
 * The domain state machines (`vehicle-status`, `lead-status`) raise typed
 * errors for an illegal move. Their messages name the two states involved, so
 * they are surfaced as-is rather than collapsed into a generic failure.
 */
const OPERATOR_FACING_CODES = new Set(["INVALID_TRANSITION", "INVALID_LEAD_TRANSITION"]);

export function describeActionError(error: unknown, scope: string): string {
  if (error instanceof AuthorizationError) return error.message;
  if (error instanceof DomainError) return error.message;
  if (error instanceof ActionError) return error.message;
  if (error instanceof ZodError) return "Please correct the highlighted fields.";

  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && OPERATOR_FACING_CODES.has(code)) {
    return (error as Error).message;
  }

  if (isPrismaUniqueViolation(error)) {
    const target = (error as { meta?: { target?: unknown } }).meta?.target;
    const fields = Array.isArray(target) ? target.join(", ") : String(target ?? "");
    if (fields.includes("reservations")) {
      return "This vehicle already has an active reservation.";
    }
    if (fields.includes("deals_one_live_per_vehicle")) {
      return "This vehicle already has a live deal.";
    }
    if (fields.includes("vin")) return "A vehicle with that VIN already exists.";
    if (fields.includes("stock_number") || fields.includes("stockNumber")) {
      return "That stock number is already in use.";
    }
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
