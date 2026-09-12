import { z } from "zod";
import { MAX_SAFE_CENTS } from "@/lib/money";
import { isValidVinShape, normalizeVin } from "@/lib/providers/vin-decode";

/**
 * Shared input primitives for the operations layer.
 *
 * Every number that reaches an operation has already been turned into integer
 * cents by the caller (`parseMoneyToCents` on a form field). Operations never
 * accept dollars, floats or formatted strings, because a single ambiguous
 * "18500" is how a $18,500 car becomes a $185 car.
 */

/** Money: whole, non-negative US cents. Rejects floats outright. */
export const centsSchema = z.number().int().min(0).max(MAX_SAFE_CENTS);

/** Money that must actually be paid: strictly positive cents. */
export const positiveCentsSchema = z.number().int().min(1).max(MAX_SAFE_CENTS);

/** A database record id. */
export const recordIdSchema = z.string().trim().min(1).max(64);

/**
 * A VIN. Normalised (trimmed, upper-cased, separators removed) and validated
 * against the same rule the decoder uses, so a value that reaches a vehicle row
 * is one a real VIN decoder would accept.
 */
export const vinSchema = z
  .string()
  .trim()
  .transform(normalizeVin)
  .refine(isValidVinShape, "That does not look like a valid VIN (11-17 characters, no I, O or Q).");

/** Required free text. */
export const requiredText = (max: number) => z.string().trim().min(1).max(max);

/** Optional free text; an empty string is normalised to undefined. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? undefined : value))
    .optional();

/** Optional date, accepting an ISO string or a Date. Explicit null clears it. */
export const optionalDate = z.coerce.date().nullable().optional();
