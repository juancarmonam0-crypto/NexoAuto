import { ActionError } from "@/lib/action-result";
import { type Cents, parseMoneyToCents } from "@/lib/money";

/**
 * FormData → operation input, with the messages an operator can act on.
 *
 * Every failure is raised as an `ActionError` carrying a `fieldErrors` entry, so
 * the boundary returns `VALIDATION_ERROR` with the offending field named rather
 * than a generic "please correct the highlighted fields".
 *
 * MONEY: forms carry what a human typed ("$18,500", "18500.50"). Conversion to
 * integer cents happens HERE, through the canonical `parseMoneyToCents`, so no
 * caller ever does money arithmetic and no float ever reaches an operation.
 */

/** Reads a text field. Files and blank strings are treated as "not supplied". */
function text(data: FormData, key: string): string | undefined {
  const value = data.get(key);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function fieldError(key: string, message: string): ActionError {
  return new ActionError(message, { [key]: [message] });
}

export function optionalFormString(data: FormData, key: string): string | undefined {
  return text(data, key);
}

export function requireFormString(data: FormData, key: string, label = key): string {
  const value = text(data, key);
  if (value === undefined) throw fieldError(key, `${label} is required.`);
  return value;
}

export function optionalFormId(data: FormData, key: string): string | undefined {
  return text(data, key);
}

/**
 * Reads a value WITHOUT trimming.
 *
 * Required for secrets: a password whose first or last character is a space is
 * a different password, and silently trimming it would lock the operator out.
 */
export function requireFormSecret(data: FormData, key: string, label = key): string {
  const value = data.get(key);
  if (typeof value !== "string" || value === "") throw fieldError(key, `${label} is required.`);
  return value;
}

export function formBoolean(data: FormData, key: string): boolean {
  const value = data.get(key);
  return value === "on" || value === "true" || value === "1";
}

function toCents(value: string, key: string, label: string): Cents {
  const cents = parseMoneyToCents(value);
  if (cents === null) throw fieldError(key, `${label} must be an amount, for example 18500.`);
  if (cents < 0) throw fieldError(key, `${label} cannot be negative.`);
  return cents;
}

export function optionalFormCents(data: FormData, key: string, label = key): Cents | undefined {
  const value = text(data, key);
  return value === undefined ? undefined : toCents(value, key, label);
}

export function requireFormCents(data: FormData, key: string, label = key): Cents {
  const value = text(data, key);
  if (value === undefined) throw fieldError(key, `${label} is required.`);
  return toCents(value, key, label);
}

export function optionalFormInt(data: FormData, key: string, label = key): number | undefined {
  const value = text(data, key);
  if (value === undefined) return undefined;
  if (!/^-?\d+$/.test(value)) throw fieldError(key, `${label} must be a whole number.`);
  return Number.parseInt(value, 10);
}

export function requireFormInt(data: FormData, key: string, label = key): number {
  const value = optionalFormInt(data, key, label);
  if (value === undefined) throw fieldError(key, `${label} is required.`);
  return value;
}

export function optionalFormDate(data: FormData, key: string, label = key): Date | undefined {
  const value = text(data, key);
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw fieldError(key, `${label} must be a date.`);
  return parsed;
}

/**
 * Validates a form value against the values an operation actually accepts.
 *
 * The browser is free to submit anything; an unchecked value would otherwise be
 * cast into a union type and rejected only by the operation's schema, producing
 * a generic field error instead of naming the field.
 */export function enumField<T extends string>(
  data: FormData,
  key: string,
  allowed: readonly T[],
  fallback?: T,
  label = key,
): T {
  const value = text(data, key);
  if (value === undefined) {
    if (fallback !== undefined) return fallback;
    throw fieldError(key, `${label} is required.`);
  }
  if (!(allowed as readonly string[]).includes(value)) {
    throw fieldError(key, `${label} is not a supported value.`);
  }
  return value as T;
}

/**
 * Drops the keys a form did not supply.
 *
 * Without this an update built from optional fields carries `undefined` for
 * everything the operator left blank, which makes "nothing to update" checks
 * meaningless and turns a partial edit into an accidental full overwrite.
 */
export function suppliedOnly<T extends object>(values: T): Partial<T> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Partial<T>;
}
