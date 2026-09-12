import { describe, expect, it } from "vitest";
import type { LeadStatus } from "@/generated/prisma";
import {
  ALL_LEAD_STATUSES,
  CLOSED_LEAD_STATUSES,
  InvalidLeadTransitionError,
  LEAD_STATUS_LABELS,
  OPEN_LEAD_STATUSES,
  allowedLeadTransitions,
  assertLeadTransition,
  canTransitionLead,
  isLeadClosed,
  isLeadOpen,
  leadStatusLabel,
  touchesCustomerOnTransition,
} from "@/lib/lead-status";

/**
 * The lead lifecycle is the contract the LEADS operations rely on, so it is
 * pinned here independently of any database.
 */

describe("lead lifecycle — the status set", () => {
  it("declares the nine statuses of the database enum, with no duplicates", () => {
    expect(ALL_LEAD_STATUSES).toHaveLength(9);
    expect(new Set(ALL_LEAD_STATUSES).size).toBe(9);
  });

  it("labels every status", () => {
    for (const status of ALL_LEAD_STATUSES) {
      expect(LEAD_STATUS_LABELS[status], `${status} needs a label`).toBeTruthy();
      expect(leadStatusLabel(status)).toBe(LEAD_STATUS_LABELS[status]);
    }
  });

  it("splits every status into open or closed, never both and never neither", () => {
    for (const status of ALL_LEAD_STATUSES) {
      const open = OPEN_LEAD_STATUSES.includes(status);
      const closed = CLOSED_LEAD_STATUSES.includes(status);
      expect(open !== closed, `${status} must be exactly one of open/closed`).toBe(true);
      expect(isLeadOpen(status)).toBe(open);
      expect(isLeadClosed(status)).toBe(closed);
    }
  });
});

describe("lead lifecycle — the MVP spine", () => {
  const SPINE: Array<[LeadStatus, LeadStatus]> = [
    ["NEW", "CONTACTED"],
    ["CONTACTED", "APPOINTMENT"],
    ["APPOINTMENT", "WON"],
    ["APPOINTMENT", "LOST"],
  ];

  it("allows NEW -> CONTACTED -> APPOINTMENT -> WON / LOST", () => {
    for (const [from, to] of SPINE) {
      expect(canTransitionLead(from, to), `${from} -> ${to} must be legal`).toBe(true);
    }
  });

  it("refuses shortcuts around the spine", () => {
    expect(canTransitionLead("NEW", "APPOINTMENT")).toBe(false);
    expect(canTransitionLead("NEW", "QUALIFYING")).toBe(false);
    expect(canTransitionLead("NEW", "FINANCING")).toBe(false);
  });

  it("treats WON as terminal", () => {
    expect(allowedLeadTransitions("WON")).toHaveLength(0);
    for (const status of ALL_LEAD_STATUSES) {
      expect(canTransitionLead("WON", status), `WON -> ${status} must be illegal`).toBe(false);
    }
  });

  it("lets a lost lead be reopened, but not won outright", () => {
    expect(canTransitionLead("LOST", "CONTACTED")).toBe(true);
    expect(canTransitionLead("LOST", "WON")).toBe(false);
  });

  it("never treats a status as its own successor", () => {
    for (const status of ALL_LEAD_STATUSES) {
      expect(canTransitionLead(status, status), `${status} -> ${status}`).toBe(false);
    }
  });

  it("leaves only WON without an exit", () => {
    const stuck = ALL_LEAD_STATUSES.filter((status) => allowedLeadTransitions(status).length === 0);
    expect(stuck).toEqual(["WON"]);
  });

  it("only ever moves to a declared status", () => {
    for (const status of ALL_LEAD_STATUSES) {
      for (const next of allowedLeadTransitions(status)) {
        expect(ALL_LEAD_STATUSES, `${status} -> ${next} targets an unknown status`).toContain(next);
      }
    }
  });
});

describe("lead lifecycle — assertLeadTransition", () => {
  it("passes a legal move silently", () => {
    expect(() => assertLeadTransition("NEW", "CONTACTED")).not.toThrow();
  });

  it("throws a typed error naming both states", () => {
    let error: unknown;
    try {
      assertLeadTransition("NEW", "WON");
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(InvalidLeadTransitionError);
    const typed = error as InvalidLeadTransitionError;
    expect(typed.code).toBe("INVALID_LEAD_TRANSITION");
    expect(typed.from).toBe("NEW");
    expect(typed.to).toBe("WON");
    expect(typed.message).toBe("A lead cannot move from New to Won.");
  });

  it("returns an empty list for an unknown status rather than throwing", () => {
    expect(allowedLeadTransitions("NOT_A_STATUS" as LeadStatus)).toEqual([]);
    expect(canTransitionLead("NOT_A_STATUS" as LeadStatus, "CONTACTED")).toBe(false);
  });
});

describe("lead lifecycle — contact tracking", () => {
  it("counts a move forward as contact but not a loss", () => {
    expect(touchesCustomerOnTransition("CONTACTED")).toBe(true);
    expect(touchesCustomerOnTransition("APPOINTMENT")).toBe(true);
    expect(touchesCustomerOnTransition("WON")).toBe(true);
    expect(touchesCustomerOnTransition("LOST")).toBe(false);
  });
});
