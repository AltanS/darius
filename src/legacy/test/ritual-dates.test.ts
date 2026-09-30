/**
 * Tests for lib/dates.ts — pure calendar arithmetic.
 *
 * pnpm exec vitest run test/ritual-dates.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  addDays,
  addMonths,
  daysBetween,
  parseCadence,
  rollByCadence,
  isDue,
  isIsoDate,
} from "../lib/dates.ts";

describe("dates: addDays", () => {
  it("adds days within a month", () => {
    expect(addDays("2026-06-15", 7)).toBe("2026-06-22");
  });
  it("rolls over a month boundary", () => {
    expect(addDays("2026-06-28", 5)).toBe("2026-07-03");
  });
  it("rolls over a year boundary", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });
  it("handles leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
  it("subtracts with a negative offset", () => {
    expect(addDays("2026-06-15", -15)).toBe("2026-05-31");
  });
});

describe("dates: addMonths", () => {
  it("adds a month", () => {
    expect(addMonths("2026-06-15", 1)).toBe("2026-07-15");
  });
  it("clamps day to the target month's last day", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  });
  it("clamps into a leap February", () => {
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
  });
  it("rolls across a year", () => {
    expect(addMonths("2026-12-15", 2)).toBe("2027-02-15");
  });
});

describe("dates: daysBetween", () => {
  it("counts whole days forward", () => {
    expect(daysBetween("2026-06-15", "2026-06-22")).toBe(7);
  });
  it("is negative when b precedes a", () => {
    expect(daysBetween("2026-06-22", "2026-06-15")).toBe(-7);
  });
  it("is zero for the same day", () => {
    expect(daysBetween("2026-06-15", "2026-06-15")).toBe(0);
  });
});

describe("dates: parseCadence", () => {
  it("parses days", () => {
    expect(parseCadence("7d")).toEqual({ n: 7, unit: "d" });
  });
  it("parses weeks", () => {
    expect(parseCadence("2w")).toEqual({ n: 2, unit: "w" });
  });
  it("parses months", () => {
    expect(parseCadence("1m")).toEqual({ n: 1, unit: "m" });
  });
  it("treats a bare integer as days", () => {
    expect(parseCadence("3")).toEqual({ n: 3, unit: "d" });
  });
  it("rejects garbage", () => {
    expect(parseCadence("soon")).toBeNull();
    expect(parseCadence("0d")).toBeNull();
    expect(parseCadence("-5d")).toBeNull();
  });
});

describe("dates: rollByCadence", () => {
  it("rolls by days", () => {
    expect(rollByCadence("2026-06-15", "7d")).toBe("2026-06-22");
  });
  it("rolls by weeks", () => {
    expect(rollByCadence("2026-06-15", "2w")).toBe("2026-06-29");
  });
  it("rolls by months", () => {
    expect(rollByCadence("2026-01-31", "1m")).toBe("2026-02-28");
  });
  it("throws on invalid cadence", () => {
    expect(() => rollByCadence("2026-06-15", "whenever")).toThrow();
  });
});

describe("dates: isDue", () => {
  it("is due when today is the due date", () => {
    expect(isDue("2026-06-22", "2026-06-22")).toBe(true);
  });
  it("is due when today is past the due date", () => {
    expect(isDue("2026-06-22", "2026-06-25")).toBe(true);
  });
  it("is not due before the due date", () => {
    expect(isDue("2026-06-22", "2026-06-21")).toBe(false);
  });
  it("is never due with no/empty due date", () => {
    expect(isDue(undefined, "2026-06-22")).toBe(false);
    expect(isDue(null, "2026-06-22")).toBe(false);
    expect(isDue("", "2026-06-22")).toBe(false);
  });
});

describe("dates: isIsoDate", () => {
  it("accepts YYYY-MM-DD", () => {
    expect(isIsoDate("2026-06-15")).toBe(true);
  });
  it("rejects other shapes", () => {
    expect(isIsoDate("2026-6-15")).toBe(false);
    expect(isIsoDate("06/15/2026")).toBe(false);
  });
});
