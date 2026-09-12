import { describe, expect, it } from "vitest";
import { ConflictError } from "@/lib/domain-errors";
import { isMissingSchemaError, rethrowUniqueViolation, uniqueViolationTarget } from "@/lib/operations";

/**
 * PHASE 9D — the "the schema is behind the code" detector.
 *
 * WHY THIS TEST EXISTS
 * Phase 9 pushes code that expects columns created by migration 0006 BEFORE that
 * migration is applied to production. Exactly one failure mode means "this
 * database has not been migrated yet", and two routes rely on recognising it so
 * they can show an honest notice instead of a 500. If this detector ever widens
 * to swallow other errors, it would hide real failures — so the negative cases
 * below matter as much as the positive ones.
 */

describe("isMissingSchemaError — recognises only a schema that is behind the code", () => {
  it("matches the Prisma and PostgreSQL codes for a missing column or table", () => {
    // P2022: the column does not exist. P2021: the table does not exist.
    expect(isMissingSchemaError({ code: "P2022" })).toBe(true);
    expect(isMissingSchemaError({ code: "P2021" })).toBe(true);
    // The raw PostgreSQL SQLSTATEs, for an error that did not come through Prisma.
    expect(isMissingSchemaError({ code: "42703" })).toBe(true); // undefined_column
    expect(isMissingSchemaError({ code: "42P01" })).toBe(true); // undefined_table
  });

  it("does NOT match anything else, so a real failure still surfaces", () => {
    // A unique violation is a conflict the operator must see, not a migration.
    expect(isMissingSchemaError({ code: "P2002" })).toBe(false);
    // A connection failure is an outage, not a missing migration.
    expect(isMissingSchemaError({ code: "P1001" })).toBe(false);
    // A constraint violation is a data problem.
    expect(isMissingSchemaError({ code: "23514" })).toBe(false);

    expect(isMissingSchemaError(new Error("boom"))).toBe(false);
    expect(isMissingSchemaError(new ConflictError("That deal is already cancelled."))).toBe(false);
    expect(isMissingSchemaError(null)).toBe(false);
    expect(isMissingSchemaError(undefined)).toBe(false);
    expect(isMissingSchemaError("P2022")).toBe(false);
    expect(isMissingSchemaError({ code: 2022 })).toBe(false);
  });
});

describe("rethrowUniqueViolation — unchanged by the Phase 9D addition", () => {
  it("translates a unique violation by index name", () => {
    const error = { code: "P2002", meta: { target: ["vehicleId"] } };
    expect(() =>
      rethrowUniqueViolation(error, { vehicleId: "Already sold." }, "Conflict."),
    ).toThrow(ConflictError);
    expect(() =>
      rethrowUniqueViolation(error, { vehicleId: "Already sold." }, "Conflict."),
    ).toThrow("Already sold.");
  });

  it("falls back to the generic message for an unrecognised index", () => {
    const error = { code: "P2002", meta: { target: ["stockNumber"] } };
    expect(() => rethrowUniqueViolation(error, { vehicleId: "Already sold." }, "Conflict.")).toThrow(
      "Conflict.",
    );
  });

  it("re-throws anything that is not a unique violation, untouched", () => {
    const original = new Error("connection refused");
    expect(() => rethrowUniqueViolation(original, {}, "Conflict.")).toThrow(original);
  });

  it("reads the violation target defensively", () => {
    expect(uniqueViolationTarget({ meta: { target: ["a", "b"] } })).toBe("a,b");
    expect(uniqueViolationTarget({ meta: { target: "a" } })).toBe("a");
    expect(uniqueViolationTarget({})).toBe("");
  });
});
