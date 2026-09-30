/**
 * Unit tests for the session-claim model (M247/03).
 *
 * Pure rules only — TTL parsing, staleness, ownership, ref normalization,
 * tolerant reads. The CLI surface is covered in claim-cli.test.ts.
 *
 * pnpm vitest run session-claims
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_TTL_MS,
  TtlParseError,
  claimsPath,
  emptyClaimsDoc,
  formatClaimLine,
  formatDuration,
  formatTtl,
  inspectClaim,
  listClaims,
  mutateClaims,
  normalizeClaimRef,
  parseTtl,
  readClaims,
  resolveSessionId,
  writeClaims,
  type ClaimsDoc,
} from "../lib/session-claims.ts";

const NOW = new Date("2026-08-03T12:00:00.000Z");

function docWith(entries: Record<string, { session: string; agoMs: number; ttlMs: number }>): ClaimsDoc {
  const doc = emptyClaimsDoc();
  for (const [ref, e] of Object.entries(entries)) {
    const at = new Date(NOW.getTime() - e.agoMs);
    doc.claims[ref] = {
      session: e.session,
      at: at.toISOString(),
      expiresAt: new Date(at.getTime() + e.ttlMs).toISOString(),
    };
  }
  return doc;
}

describe("parseTtl", () => {
  it("defaults to 8h when absent", () => {
    expect(parseTtl(undefined)).toBe(DEFAULT_TTL_MS);
    expect(DEFAULT_TTL_MS).toBe(8 * 60 * 60 * 1000);
  });

  it("reads a bare number as HOURS, not minutes", () => {
    // A bare `4` meaning minutes would be a silent 60x error in the direction
    // that drops claims early — the failure mode this module exists to prevent.
    expect(parseTtl("4")).toBe(4 * 60 * 60 * 1000);
  });

  it("parses every supported unit", () => {
    expect(parseTtl("500ms")).toBe(500);
    expect(parseTtl("30s")).toBe(30_000);
    expect(parseTtl("90m")).toBe(90 * 60 * 1000);
    expect(parseTtl("8h")).toBe(8 * 60 * 60 * 1000);
    expect(parseTtl("2d")).toBe(2 * 24 * 60 * 60 * 1000);
    expect(parseTtl("1.5h")).toBe(90 * 60 * 1000);
  });

  it("is case-insensitive and tolerates whitespace", () => {
    expect(parseTtl(" 2H ")).toBe(2 * 60 * 60 * 1000);
  });

  it("refuses garbage and non-positive values", () => {
    expect(() => parseTtl("bogus")).toThrow(TtlParseError);
    expect(() => parseTtl("8 hours")).toThrow(TtlParseError);
    expect(() => parseTtl("-3h")).toThrow(TtlParseError);
    expect(() => parseTtl("0")).toThrow(TtlParseError);
  });

  it("round-trips through formatTtl for whole units", () => {
    expect(formatTtl(parseTtl("8h"))).toBe("8h");
    // Shortest EXACT unit — 90m is not a whole number of hours, so it stays minutes.
    expect(formatTtl(parseTtl("90m"))).toBe("90m");
    expect(formatTtl(parseTtl("120m"))).toBe("2h");
    expect(formatTtl(parseTtl("2d"))).toBe("2d");
    expect(formatTtl(1)).toBe("1ms");
  });
});

describe("formatDuration", () => {
  it("renders compact human durations", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(12 * 60_000)).toBe("12m");
    expect(formatDuration(3 * 3_600_000 + 12 * 60_000)).toBe("3h12m");
    expect(formatDuration(5 * 3_600_000)).toBe("5h");
    expect(formatDuration(51 * 3_600_000)).toBe("2d3h");
    expect(formatDuration(48 * 3_600_000)).toBe("2d");
  });

  it("clamps negatives to 0s rather than printing -1s", () => {
    expect(formatDuration(-5000)).toBe("0s");
  });
});

describe("resolveSessionId", () => {
  it("prefers the flag, then the env var", () => {
    expect(resolveSessionId("flagged", { CLAUDE_SESSION_ID: "env" })).toBe("flagged");
    expect(resolveSessionId(undefined, { CLAUDE_SESSION_ID: "env" })).toBe("env");
  });

  it("returns null when neither is present or both are blank", () => {
    expect(resolveSessionId(undefined, {})).toBeNull();
    expect(resolveSessionId("   ", { CLAUDE_SESSION_ID: "  " })).toBeNull();
  });
});

describe("inspectClaim", () => {
  it("reports unclaimed for an unknown ref", () => {
    const status = inspectClaim(emptyClaimsDoc(), "spec.md", "me", NOW);
    expect(status.state).toBe("unclaimed");
    expect(status.claim).toBeNull();
  });

  it("reports own for the acting session, even past expiry", () => {
    const doc = docWith({ "spec.md": { session: "me", agoMs: 9 * 3_600_000, ttlMs: 3_600_000 } });
    expect(inspectClaim(doc, "spec.md", "me", NOW).state).toBe("own");
  });

  it("reports held for another session inside the TTL, with age and expiry", () => {
    const doc = docWith({ "spec.md": { session: "other", agoMs: 12 * 60_000, ttlMs: DEFAULT_TTL_MS } });
    const status = inspectClaim(doc, "spec.md", "me", NOW);
    expect(status.state).toBe("held");
    expect(status.ageLabel).toBe("12m");
    expect(status.expiryLabel).toBe("expires in 7h48m");
  });

  it("reports stale once the TTL has elapsed", () => {
    const doc = docWith({ "spec.md": { session: "dead", agoMs: 10 * 3_600_000, ttlMs: DEFAULT_TTL_MS } });
    const status = inspectClaim(doc, "spec.md", "me", NOW);
    expect(status.state).toBe("stale");
    expect(status.expiryLabel).toBe("expired 2h ago");
  });

  it("treats a claim with no acting session as another session's", () => {
    // An unattributable caller must SEE other sessions' claims, never inherit them.
    const doc = docWith({ "spec.md": { session: "other", agoMs: 60_000, ttlMs: DEFAULT_TTL_MS } });
    expect(inspectClaim(doc, "spec.md", null, NOW).state).toBe("held");
  });

  it("treats an unparseable expiry as stale, not as a permanent hold", () => {
    const doc = emptyClaimsDoc();
    doc.claims["spec.md"] = { session: "other", at: NOW.toISOString(), expiresAt: "not-a-date" };
    expect(inspectClaim(doc, "spec.md", "me", NOW).state).toBe("stale");
  });
});

describe("listClaims / formatClaimLine", () => {
  it("lists oldest-claimed first and labels stale entries", () => {
    const doc = docWith({
      "a.md": { session: "s1", agoMs: 60_000, ttlMs: DEFAULT_TTL_MS },
      "b.md": { session: "s2", agoMs: 10 * 3_600_000, ttlMs: 3_600_000 },
    });
    const list = listClaims(doc, "me", NOW);
    expect(list.map((c) => c.ref)).toEqual(["b.md", "a.md"]);
    expect(formatClaimLine(list[0]!)).toBe(
      "b.md — STALE session s2, claimed 10h ago, expired 9h ago",
    );
    expect(formatClaimLine(list[1]!)).toBe("a.md — session s1, claimed 1m ago, expires in 7h59m");
  });
});

describe("readClaims / writeClaims", () => {
  let tmpDir: string;
  let trackerRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-claims-unit-"));
    trackerRoot = join(tmpDir, ".tracker");
    mkdirSync(trackerRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads an absent file as no claims", () => {
    expect(readClaims(trackerRoot).claims).toEqual({});
  });

  it("round-trips a written doc", () => {
    const doc = docWith({ "spec.md": { session: "s1", agoMs: 0, ttlMs: DEFAULT_TTL_MS } });
    writeClaims(trackerRoot, doc);
    expect(readClaims(trackerRoot)).toEqual(doc);
  });

  it("degrades a corrupt file to no claims instead of throwing", () => {
    // A half-written file left by a killed session must not brick `next`.
    writeFileSync(claimsPath(trackerRoot), '{"version":1,"claims":{"a.md":', "utf-8");
    expect(readClaims(trackerRoot).claims).toEqual({});
  });

  it("drops malformed entries but keeps the valid ones", () => {
    writeFileSync(
      claimsPath(trackerRoot),
      JSON.stringify({
        version: 1,
        claims: {
          "good.md": { session: "s1", at: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T08:00:00.000Z" },
          "nosession.md": { at: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T08:00:00.000Z" },
          "notobject.md": "nope",
        },
      }),
      "utf-8",
    );
    expect(Object.keys(readClaims(trackerRoot).claims)).toEqual(["good.md"]);
  });

  it("mutateClaims does not write when the mutation declines", () => {
    mutateClaims(trackerRoot, (doc) => ({ doc, write: false, result: null }));
    expect(readClaims(trackerRoot).claims).toEqual({});

    mutateClaims(trackerRoot, (doc) => {
      doc.claims["x.md"] = { session: "s", at: NOW.toISOString(), expiresAt: NOW.toISOString() };
      return { doc, write: true, result: null };
    });
    expect(Object.keys(readClaims(trackerRoot).claims)).toEqual(["x.md"]);
  });
});

describe("normalizeClaimRef", () => {
  let tmpDir: string;
  let trackerRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-claims-ref-"));
    trackerRoot = join(tmpDir, ".tracker");
    mkdirSync(join(trackerRoot, "M1-probe"), { recursive: true });
    writeFileSync(join(trackerRoot, "M1-probe", "01-p.md"), "# spec\n", "utf-8");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const rel = ".tracker/M1-probe/01-p.md";

  it("normalizes every spelling of the same spec to one repo-relative key", () => {
    const forms = [
      rel,
      `./${rel}`,
      join(tmpDir, rel), // absolute
      "M1-probe/01-p.md", // tracker-relative
    ];
    for (const ref of forms) {
      expect(normalizeClaimRef({ trackerRoot, ref, cwd: tmpDir })).toBe(rel);
    }
  });

  it("resolves a cwd-relative ref from inside a subdirectory", () => {
    expect(
      normalizeClaimRef({ trackerRoot, ref: "01-p.md", cwd: join(trackerRoot, "M1-probe") }),
    ).toBe(rel);
  });

  it("keeps an unresolvable ref verbatim so scratch/not-yet-written refs still coordinate", () => {
    expect(normalizeClaimRef({ trackerRoot, ref: "scratch/does-not-exist.md", cwd: tmpDir })).toBe(
      "scratch/does-not-exist.md",
    );
  });
});
