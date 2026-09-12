import { describe, expect, it } from "vitest";
import type { VehicleStatus } from "@/generated/prisma";
import {
  ALL_VEHICLE_STATUSES,
  allowedTransitions,
  assertTransition,
  canTransition,
  deriveListingStatus,
  IN_PROGRESS_STATUSES,
  IN_RECON_STATUSES,
  InvalidVehicleTransitionError,
  isPubliclyVisible,
  isSoldStatus,
  isTerminal,
  PUBLICLY_VISIBLE_STATUSES,
  statusLabel,
  statusTone,
  STATUS_LABELS,
  TERMINAL_STATUSES,
} from "@/lib/vehicle-status";

describe("vehicle-status — catalogue integrity", () => {
  it("covers all twelve lifecycle statuses exactly once", () => {
    expect(ALL_VEHICLE_STATUSES).toHaveLength(12);
    expect(new Set(ALL_VEHICLE_STATUSES).size).toBe(12);
    expect([...ALL_VEHICLE_STATUSES]).toEqual([
      "SOURCING",
      "PURCHASED",
      "IN_TRANSIT",
      "INSPECTION",
      "RECONDITIONING",
      "READY",
      "LISTED",
      "RESERVED",
      "SOLD",
      "DELIVERED",
      "WHOLESALE",
      "REJECTED",
    ]);
  });

  it("has a label and a tone for every status", () => {
    const tones = ["neutral", "progress", "ready", "sold", "danger"];
    for (const status of ALL_VEHICLE_STATUSES) {
      expect(statusLabel(status), `${status} needs a label`).toBeTruthy();
      expect(STATUS_LABELS[status]).toBeTruthy();
      expect(tones).toContain(statusTone(status));
    }
  });
});

describe("vehicle-status — allowed transitions", () => {
  const EXPECTED_ALLOWED: Record<VehicleStatus, VehicleStatus[]> = {
    SOURCING: ["PURCHASED", "REJECTED"],
    PURCHASED: ["IN_TRANSIT", "INSPECTION", "RECONDITIONING", "WHOLESALE", "REJECTED"],
    IN_TRANSIT: ["INSPECTION", "RECONDITIONING", "WHOLESALE", "REJECTED"],
    INSPECTION: ["RECONDITIONING", "READY", "WHOLESALE", "REJECTED"],
    RECONDITIONING: ["READY", "INSPECTION", "WHOLESALE", "REJECTED"],
    READY: ["LISTED", "RECONDITIONING", "WHOLESALE", "REJECTED"],
    LISTED: ["RESERVED", "SOLD", "READY", "WHOLESALE", "REJECTED"],
    RESERVED: ["LISTED", "SOLD", "WHOLESALE"],
    SOLD: ["DELIVERED", "LISTED", "WHOLESALE"],
    DELIVERED: [],
    WHOLESALE: [],
    REJECTED: ["SOURCING"],
  };

  it("declares exactly the expected transition table", () => {
    for (const status of ALL_VEHICLE_STATUSES) {
      expect([...allowedTransitions(status)], `${status} transitions`).toEqual(EXPECTED_ALLOWED[status]);
    }
  });

  it("permits every declared transition and never throws for one", () => {
    for (const from of ALL_VEHICLE_STATUSES) {
      for (const to of allowedTransitions(from)) {
        expect(canTransition(from, to), `${from} -> ${to} should be allowed`).toBe(true);
        expect(() => assertTransition(from, to), `${from} -> ${to} should not throw`).not.toThrow();
      }
    }
  });

  it("forbids every transition that is not declared", () => {
    for (const from of ALL_VEHICLE_STATUSES) {
      const allowed = allowedTransitions(from);
      for (const to of ALL_VEHICLE_STATUSES) {
        if (to === from || allowed.includes(to)) continue;
        expect(canTransition(from, to), `${from} -> ${to} should be forbidden`).toBe(false);
        expect(() => assertTransition(from, to), `${from} -> ${to} should throw`).toThrow(
          InvalidVehicleTransitionError,
        );
      }
    }
  });
});

describe("vehicle-status — representative forbidden transitions", () => {
  it("refuses to sell a car that was never readied or listed", () => {
    expect(canTransition("SOURCING", "SOLD")).toBe(false);
    expect(canTransition("SOURCING", "LISTED")).toBe(false);
    expect(canTransition("PURCHASED", "SOLD")).toBe(false);
    expect(canTransition("IN_TRANSIT", "LISTED")).toBe(false);
    expect(canTransition("INSPECTION", "LISTED")).toBe(false);
    expect(canTransition("RECONDITIONING", "LISTED")).toBe(false);
    expect(canTransition("READY", "SOLD")).toBe(false);
  });

  it("refuses to skip backward through the pipeline", () => {
    expect(canTransition("LISTED", "SOURCING")).toBe(false);
    expect(canTransition("SOLD", "SOURCING")).toBe(false);
    expect(canTransition("REJECTED", "PURCHASED")).toBe(false);
    expect(canTransition("DELIVERED", "LISTED")).toBe(false);
  });

  it("refuses to reserve a car that is not listed", () => {
    expect(canTransition("READY", "RESERVED")).toBe(false);
    expect(canTransition("SOURCING", "RESERVED")).toBe(false);
  });

  it("forbids a status from transitioning to itself", () => {
    for (const status of ALL_VEHICLE_STATUSES) {
      expect(canTransition(status, status), `${status} -> ${status}`).toBe(false);
    }
  });

  it("reports a useful, human-readable error", () => {
    try {
      assertTransition("SOURCING", "SOLD");
      throw new Error("expected assertTransition to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidVehicleTransitionError);
      const typed = error as InvalidVehicleTransitionError;
      expect(typed.code).toBe("INVALID_TRANSITION");
      expect(typed.from).toBe("SOURCING");
      expect(typed.to).toBe("SOLD");
      expect(typed.message).toBe("A vehicle cannot move from Sourcing to Sold.");
    }
  });
});

describe("vehicle-status — terminal states", () => {
  it("treats delivered and wholesale as terminal with no onward transitions", () => {
    expect(TERMINAL_STATUSES).toEqual(["DELIVERED", "WHOLESALE"]);
    expect(isTerminal("DELIVERED")).toBe(true);
    expect(isTerminal("WHOLESALE")).toBe(true);
    expect(allowedTransitions("DELIVERED")).toEqual([]);
    expect(allowedTransitions("WHOLESALE")).toEqual([]);
  });

  it("does not treat sold as terminal, because a sale can be unwound or delivered", () => {
    expect(isTerminal("SOLD")).toBe(false);
    expect(allowedTransitions("SOLD")).toContain("DELIVERED");
    expect(allowedTransitions("SOLD")).toContain("LISTED");
  });

  it("allows a rejected unit to be reopened for correction", () => {
    expect(isTerminal("REJECTED")).toBe(false);
    expect(canTransition("REJECTED", "SOURCING")).toBe(true);
  });
});

describe("vehicle-status — sold and public visibility", () => {
  it("counts sold and delivered as sold, but not wholesale", () => {
    expect(isSoldStatus("SOLD")).toBe(true);
    expect(isSoldStatus("DELIVERED")).toBe(true);
    expect(isSoldStatus("WHOLESALE")).toBe(false);
    expect(isSoldStatus("LISTED")).toBe(false);
    expect(isSoldStatus("RESERVED")).toBe(false);
  });

  it("exposes only listed and reserved vehicles publicly", () => {
    expect(PUBLICLY_VISIBLE_STATUSES).toEqual(["LISTED", "RESERVED"]);
    expect(isPubliclyVisible("LISTED")).toBe(true);
    expect(isPubliclyVisible("RESERVED")).toBe(true);
    for (const status of ALL_VEHICLE_STATUSES) {
      if (status === "LISTED" || status === "RESERVED") continue;
      expect(isPubliclyVisible(status), `${status} must not be public`).toBe(false);
    }
  });

  it("categorises in-progress and in-recon statuses", () => {
    expect(IN_RECON_STATUSES).toEqual(["INSPECTION", "RECONDITIONING"]);
    expect(IN_PROGRESS_STATUSES).toEqual([
      "SOURCING",
      "PURCHASED",
      "IN_TRANSIT",
      "INSPECTION",
      "RECONDITIONING",
    ]);
    for (const status of IN_PROGRESS_STATUSES) {
      expect(isPubliclyVisible(status)).toBe(false);
    }
  });
});

describe("vehicle-status — listing status derivation", () => {
  it("keeps listing status consistent with the lifecycle status", () => {
    expect(deriveListingStatus("LISTED")).toBe("ACTIVE");
    expect(deriveListingStatus("RESERVED")).toBe("ACTIVE");
    expect(deriveListingStatus("READY")).toBe("UNLISTED");
    expect(deriveListingStatus("SOURCING")).toBe("PAUSED");
    expect(deriveListingStatus("PURCHASED")).toBe("PAUSED");
    expect(deriveListingStatus("IN_TRANSIT")).toBe("PAUSED");
    expect(deriveListingStatus("INSPECTION")).toBe("PAUSED");
    expect(deriveListingStatus("RECONDITIONING")).toBe("PAUSED");
    expect(deriveListingStatus("SOLD")).toBe("SOLD");
    expect(deriveListingStatus("DELIVERED")).toBe("SOLD");
    expect(deriveListingStatus("WHOLESALE")).toBe("ARCHIVED");
    expect(deriveListingStatus("REJECTED")).toBe("ARCHIVED");
  });

  it("never marks a non-public status as ACTIVE", () => {
    for (const status of ALL_VEHICLE_STATUSES) {
      const derived = deriveListingStatus(status);
      if (derived === "ACTIVE") {
        expect(isPubliclyVisible(status), `${status} derives ACTIVE but is not public`).toBe(true);
      }
    }
  });

  it("derives a listing status for every lifecycle status", () => {
    const valid = ["UNLISTED", "ACTIVE", "PAUSED", "SOLD", "ARCHIVED"];
    for (const status of ALL_VEHICLE_STATUSES) {
      expect(valid).toContain(deriveListingStatus(status));
    }
  });
});
