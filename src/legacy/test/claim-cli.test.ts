/**
 * CLI tests for `tracker claim` / `tracker release` and the claim gates on
 * `next`, `worklog dispatch`, `list specs` and `doctor` (M247/03).
 *
 * These run the real binary in a temp tracker, because the whole point of the
 * feature is what a SECOND process sees — an in-process test would share the
 * state it is supposed to be reading across a process boundary.
 *
 * pnpm vitest run claim-cli
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { initTracker, addMilestone } from "../lib/tracker-writer.ts";
import { readClaims, writeClaims, emptyClaimsDoc } from "../lib/session-claims.ts";

const SPEC = `---
updated: 2026-01-01
agent: test
---

# Claimable Spec

## Verification Checklist

### Implementation

- [ ] do the thing
`;

const SPEC_REF = ".tracker/M1-probe/01-p.md";
/** The claims key since 0.76.0: tracker-relative, whatever form was passed. */
const KEY = "M1-probe/01-p.md";

describe("claim / release CLI", () => {
  let tmpDir: string;
  let trackerRoot: string;
  let specPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-claim-cli-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
    addMilestone({
      trackerRoot,
      name: "Probe",
      slug: "probe",
      owner: "dev@example.com",
    });
    specPath = join(trackerRoot, "M1-probe", "01-p.md");
    writeFileSync(specPath, SPEC, "utf-8");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function runTracker(
    args: string[],
    session?: string,
    envVars: Record<string, string> = session !== undefined ? { CLAUDE_SESSION_ID: session } : {},
  ): { stdout: string; stderr: string; exitCode: number } {
    const env = { ...process.env };
    delete env["CLAUDE_SESSION_ID"];
    delete env["CLAUDE_CODE_SESSION_ID"];
    Object.assign(env, envVars);

    const result = spawnSync(
      "node",
      ["--experimental-strip-types", "--no-warnings", join(process.cwd(), "bin/tracker.mts"), ...args],
      { encoding: "utf-8", cwd: tmpDir, timeout: 30_000, env },
    );
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.status ?? -1,
    };
  }

  /** Backdate an existing claim so it is past its expiry. */
  function expireClaim(ref = KEY): void {
    const doc = readClaims(trackerRoot);
    const claim = doc.claims[ref]!;
    const past = new Date(Date.now() - 9 * 60 * 60 * 1000);
    doc.claims[ref] = {
      ...claim,
      at: past.toISOString(),
      expiresAt: new Date(past.getTime() + 60 * 60 * 1000).toISOString(),
    };
    writeClaims(trackerRoot, doc);
  }

  // -------------------------------------------------------------------------
  // claim
  // -------------------------------------------------------------------------

  it("writes {session, at, expiresAt} keyed by the repo-relative spec path", () => {
    const { exitCode, stdout } = runTracker(["claim", SPEC_REF], "sessA");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("CLAIMED");

    const doc = readClaims(trackerRoot);
    const claim = doc.claims[KEY];
    expect(claim).toBeDefined();
    expect(claim!.session).toBe("sessA");
    expect(Date.parse(claim!.expiresAt) - Date.parse(claim!.at)).toBe(8 * 60 * 60 * 1000);
  });

  it("--ttl overrides the default 8h window", () => {
    runTracker(["claim", SPEC_REF, "--ttl", "30m"], "sessA");
    const claim = readClaims(trackerRoot).claims[KEY]!;
    expect(Date.parse(claim.expiresAt) - Date.parse(claim.at)).toBe(30 * 60 * 1000);
  });

  it("refuses an invalid --ttl before touching the claims file", () => {
    const { exitCode, stderr } = runTracker(["claim", SPEC_REF, "--ttl", "bogus"], "sessA");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("invalid --ttl");
    expect(existsSync(join(trackerRoot, ".session-claims.json"))).toBe(false);
  });

  it("refuses to claim with no session id, naming both ways to supply one", () => {
    const { exitCode, stderr } = runTracker(["claim", SPEC_REF]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("no session id");
    expect(stderr).toContain("--session");
    expect(stderr).toContain("CLAUDE_CODE_SESSION_ID");
    expect(existsSync(join(trackerRoot, ".session-claims.json"))).toBe(false);
  });

  it("claims with only CLAUDE_CODE_SESSION_ID set", () => {
    const { exitCode } = runTracker(["claim", SPEC_REF], undefined, { CLAUDE_CODE_SESSION_ID: "codeSess" });
    expect(exitCode).toBe(0);
    expect(readClaims(trackerRoot).claims[KEY]!.session).toBe("codeSess");
  });

  it("still claims with only the older CLAUDE_SESSION_ID set", () => {
    const { exitCode } = runTracker(["claim", SPEC_REF], undefined, { CLAUDE_SESSION_ID: "oldSess" });
    expect(exitCode).toBe(0);
    expect(readClaims(trackerRoot).claims[KEY]!.session).toBe("oldSess");
  });

  it("--session wins over both env vars", () => {
    const { exitCode } = runTracker(["claim", SPEC_REF, "--session", "flagged"], undefined, {
      CLAUDE_CODE_SESSION_ID: "codeSess",
      CLAUDE_SESSION_ID: "oldSess",
    });
    expect(exitCode).toBe(0);
    expect(readClaims(trackerRoot).claims[KEY]!.session).toBe("flagged");
  });

  it("accepts --session as an alternative to the env var", () => {
    const { exitCode } = runTracker(["claim", SPEC_REF, "--session", "flagged"]);
    expect(exitCode).toBe(0);
    expect(readClaims(trackerRoot).claims[KEY]!.session).toBe("flagged");
  });

  it("refuses a spec freshly claimed by another session, naming it and its age", () => {
    runTracker(["claim", SPEC_REF], "sessA");
    const { exitCode, stderr } = runTracker(["claim", SPEC_REF], "sessB");

    expect(exitCode).toBe(1);
    expect(stderr).toContain("REFUSED");
    expect(stderr).toContain("sessA");
    // Seconds granularity, not an exact value — the two CLI spawns can straddle
    // a second boundary under load, and the claim is fresh either way.
    expect(stderr).toMatch(/claimed \d+s ago/);
    expect(stderr).toContain("--takeover");
    // The refusal must not have stolen the claim.
    expect(readClaims(trackerRoot).claims[KEY]!.session).toBe("sessA");
  });

  it("--takeover overrides a live claim with a loud notice", () => {
    runTracker(["claim", SPEC_REF], "sessA");
    const { exitCode, stdout } = runTracker(["claim", SPEC_REF, "--takeover"], "sessB");

    expect(exitCode).toBe(0);
    expect(stdout).toContain("TAKEOVER");
    expect(stdout).toContain("still LIVE");
    expect(stdout).toContain("sessA");
    expect(readClaims(trackerRoot).claims[KEY]!.session).toBe("sessB");
  });

  it("re-claiming your own spec refreshes the window instead of refusing", () => {
    runTracker(["claim", SPEC_REF, "--ttl", "1h"], "sessA");
    const first = readClaims(trackerRoot).claims[KEY]!;

    const { exitCode, stdout } = runTracker(["claim", SPEC_REF, "--ttl", "8h"], "sessA");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("refreshed");

    const second = readClaims(trackerRoot).claims[KEY]!;
    expect(Date.parse(second.expiresAt)).toBeGreaterThan(Date.parse(first.expiresAt));
  });

  it("takes over an EXPIRED claim without --takeover, and says so", () => {
    runTracker(["claim", SPEC_REF], "sessA");
    expireClaim();

    const { exitCode, stdout } = runTracker(["claim", SPEC_REF], "sessB");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("STALE CLAIM TAKEN OVER");
    expect(stdout).toContain("sessA");
    expect(stdout).toContain("presumed dead");
    expect(readClaims(trackerRoot).claims[KEY]!.session).toBe("sessB");
  });

  it("prints an uncommitted-changes preflight after claiming", () => {
    // No git repo here on purpose: the preflight must degrade to one quiet
    // line rather than failing the claim or leaking git's own stderr.
    const { exitCode, stdout, stderr } = runTracker(["claim", SPEC_REF], "sessA");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("PREFLIGHT:");
    expect(stderr).not.toContain("not a git repository");
  });

  it("counts and lists uncommitted paths inside a real repo", () => {
    const git = (args: string[]) => spawnSync("git", args, { cwd: tmpDir, encoding: "utf-8" });
    git(["init", "-q"]);
    git(["config", "user.email", "dev@example.com"]);
    git(["config", "user.name", "dev"]);
    writeFileSync(join(tmpDir, "leftover.txt"), "from a killed session\n", "utf-8");

    const { stdout } = runTracker(["claim", SPEC_REF], "sessA");
    expect(stdout).toMatch(/PREFLIGHT: \d+ uncommitted change\(s\)/);
    expect(stdout).toContain("leftover.txt");
  });

  it("normalizes every spelling of a spec to the same claim", () => {
    runTracker(["claim", SPEC_REF], "sessA");
    for (const form of [`./${SPEC_REF}`, specPath, "M1-probe/01-p.md"]) {
      const { exitCode, stderr } = runTracker(["claim", form], "sessB");
      expect(exitCode, `form ${form} should collide`).toBe(1);
      expect(stderr).toContain("sessA");
    }
    expect(Object.keys(readClaims(trackerRoot).claims)).toHaveLength(1);
  });

  it("refuses a ref that names no spec (0.76.0)", () => {
    const { exitCode, stderr } = runTracker(["claim", "scratch/not-a-spec.md"], "sessA");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("no spec at scratch/not-a-spec.md");
    expect(existsSync(join(trackerRoot, ".session-claims.json"))).toBe(false);
  });

  it("keys every spelling by the tracker-relative path (0.76.0)", () => {
    for (const form of [SPEC_REF, `./${SPEC_REF}`, specPath, KEY]) {
      runTracker(["claim", form], "sessA");
    }
    expect(Object.keys(readClaims(trackerRoot).claims)).toEqual([KEY]);
    expect(Object.keys(JSON.parse(readFileSync(join(trackerRoot, ".session-claims.json"), "utf-8")).claims)).toEqual([KEY]);
  });

  it("reads an old repo-relative key as the canonical key (0.76.0)", () => {
    const doc = emptyClaimsDoc();
    const now = Date.now();
    doc.claims[SPEC_REF] = { session: "sessA", at: new Date(now).toISOString(), expiresAt: new Date(now + 3_600_000).toISOString() };
    writeClaims(trackerRoot, doc);
    expect(Object.keys(readClaims(trackerRoot).claims)).toEqual([KEY]);
    const { exitCode, stderr } = runTracker(["claim", KEY], "sessB");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("sessA");
  });

  it("claim and release --json print JSON only on stdout (0.76.0)", () => {
    const claimed = runTracker(["claim", SPEC_REF, "--json"], "sessA");
    expect(claimed.exitCode).toBe(0);
    expect(JSON.parse(claimed.stdout).action).toBe("claimed");
    expect(claimed.stderr).toContain("CLAIMED");
    const released = runTracker(["release", SPEC_REF, "--json"], "sessA");
    expect(released.exitCode).toBe(0);
    expect(JSON.parse(released.stdout).action).toBe("released");
  });

  it("--list reports outstanding claims, fresh and stale", () => {
    writeFileSync(join(trackerRoot, "M1-probe", "02-other.md"), SPEC, "utf-8");
    runTracker(["claim", SPEC_REF], "sessA");
    runTracker(["claim", "M1-probe/02-other.md"], "sessB");
    expireClaim();

    const { exitCode, stdout } = runTracker(["claim", "--list"], "sessC");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("OUTSTANDING CLAIMS: 2");
    expect(stdout).toContain("STALE session sessA");
    expect(stdout).toContain("session sessB");
  });

  // -------------------------------------------------------------------------
  // release
  // -------------------------------------------------------------------------

  it("releases its own claim", () => {
    runTracker(["claim", SPEC_REF], "sessA");
    const { exitCode, stdout } = runTracker(["release", SPEC_REF], "sessA");

    expect(exitCode).toBe(0);
    expect(stdout).toContain("RELEASED");
    expect(readClaims(trackerRoot).claims[KEY]).toBeUndefined();
  });

  it("is idempotent — releasing an unclaimed spec is not an error", () => {
    const { exitCode, stdout } = runTracker(["release", SPEC_REF], "sessA");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("NO CLAIM");
  });

  it("refuses to release another session's live claim without --force", () => {
    runTracker(["claim", SPEC_REF], "sessA");
    const { exitCode, stderr } = runTracker(["release", SPEC_REF], "sessB");

    expect(exitCode).toBe(1);
    expect(stderr).toContain("REFUSED");
    expect(stderr).toContain("sessA");
    expect(readClaims(trackerRoot).claims[KEY]).toBeDefined();
  });

  it("--force releases another session's live claim, loudly", () => {
    runTracker(["claim", SPEC_REF], "sessA");
    const { exitCode, stdout } = runTracker(["release", SPEC_REF, "--force"], "sessB");

    expect(exitCode).toBe(0);
    expect(stdout).toContain("FORCE-released");
    expect(readClaims(trackerRoot).claims[KEY]).toBeUndefined();
  });

  it("releases a stale claim held by another session, with a notice", () => {
    runTracker(["claim", SPEC_REF], "sessA");
    expireClaim();

    const { exitCode, stdout } = runTracker(["release", SPEC_REF], "sessB");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("STALE");
    expect(readClaims(trackerRoot).claims[KEY]).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // next
  // -------------------------------------------------------------------------

  it("next refuses a spec freshly claimed by another session, naming it", () => {
    runTracker(["claim", SPEC_REF], "sessA");
    const { exitCode, stdout, stderr } = runTracker(["next"], "sessB");

    expect(exitCode).toBe(1);
    expect(stderr).toContain("REFUSED");
    expect(stderr).toContain("sessA");
    expect(stdout).not.toContain("do the thing");
  });

  it("next --force proceeds past a live claim with a warning", () => {
    runTracker(["claim", SPEC_REF], "sessA");
    const { exitCode, stdout, stderr } = runTracker(["next", "--force"], "sessB");

    expect(exitCode).toBe(0);
    expect(stdout).toContain("do the thing");
    expect(stderr).toContain("--force");
  });

  it("next hands out your own claimed spec without complaint", () => {
    runTracker(["claim", SPEC_REF], "sessA");
    const { exitCode, stdout, stderr } = runTracker(["next"], "sessA");

    expect(exitCode).toBe(0);
    expect(stdout).toContain("do the thing");
    expect(stderr).toBe("");
  });

  it("next proceeds past a STALE claim but never silently — it names the dead session", () => {
    runTracker(["claim", SPEC_REF], "sessA");
    expireClaim();

    const { exitCode, stdout, stderr } = runTracker(["next"], "sessB");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("do the thing");
    expect(stderr).toContain("STALE");
    expect(stderr).toContain("sessA");
  });

  it("next is untouched when no claims file exists", () => {
    const { exitCode, stdout, stderr } = runTracker(["next"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("do the thing");
    expect(stderr).toBe("");
  });

  it("a claim on a COMPLETE spec never blocks the next actionable one", () => {
    // The gate fires where work is handed out, not while scanning: a claimed
    // spec with nothing left to do must not refuse a task it would never offer.
    writeFileSync(specPath, SPEC.replace("- [ ] do the thing", "- [x] do the thing"), "utf-8");
    writeFileSync(
      join(trackerRoot, "M1-probe", "02-q.md"),
      SPEC.replace("# Claimable Spec", "# Second Spec").replace(
        "- [ ] do the thing",
        "- [ ] the other thing",
      ),
      "utf-8",
    );
    runTracker(["claim", SPEC_REF], "sessA");

    const { exitCode, stdout } = runTracker(["next"], "sessB");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("the other thing");
  });

  // -------------------------------------------------------------------------
  // worklog dispatch
  // -------------------------------------------------------------------------

  it("worklog dispatch refuses a thread whose spec is claimed elsewhere, and --force overrides", () => {
    const opened = runTracker(["worklog", "open", "probe", "--spec", SPEC_REF, "--message", "hi"]);
    expect(opened.exitCode).toBe(0);
    // M7/01: `worklog list --json` now emits { threads, files } so thread-less
    // legacy files can carry a per-file `legacy` flag; threads moved under .threads.
    const { threads } = JSON.parse(runTracker(["worklog", "list", "--json"]).stdout) as {
      threads: Array<{ threadId: string }>;
    };
    const threadId = threads[0]!.threadId;

    runTracker(["claim", SPEC_REF], "sessA");

    const refused = runTracker(
      ["worklog", "dispatch", threadId, "--agent", "typescript:typescript-expert"],
      "sessB",
    );
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain("REFUSED");
    expect(refused.stderr).toContain("sessA");

    const forced = runTracker(
      ["worklog", "dispatch", threadId, "--agent", "typescript:typescript-expert", "--force"],
      "sessB",
    );
    expect(forced.exitCode).toBe(0);
    expect(forced.stdout).toContain("dispatched");
  });

  it("worklog dispatch is unaffected when the thread carries no spec", () => {
    runTracker(["worklog", "open", "probe", "--message", "hi"]);
    // M7/01: threads live under `.threads` in the list JSON (see note above).
    const { threads } = JSON.parse(runTracker(["worklog", "list", "--json"]).stdout) as {
      threads: Array<{ threadId: string }>;
    };
    runTracker(["claim", SPEC_REF], "sessA");

    const { exitCode } = runTracker(
      ["worklog", "dispatch", threads[0]!.threadId, "--agent", "typescript:typescript-expert"],
      "sessB",
    );
    expect(exitCode).toBe(0);
  });

  // -------------------------------------------------------------------------
  // list specs + doctor
  // -------------------------------------------------------------------------

  it("list specs marks claimed specs in both text and JSON", () => {
    runTracker(["claim", SPEC_REF], "sessA");

    const text = runTracker(["list", "specs"], "sessB");
    expect(text.stdout).toContain("[CLAIMED: session sessA");

    const json = JSON.parse(runTracker(["list", "specs", "--json"], "sessB").stdout) as Array<{
      claim?: { state: string; session: string };
    }>;
    expect(json[0]!.claim).toEqual(
      expect.objectContaining({ state: "held", session: "sessA" }),
    );
  });

  it("list specs output is byte-identical to before when nothing is claimed", () => {
    const before = runTracker(["list", "specs"], "sessB").stdout;
    expect(before).toBe("M1-probe/01-p.md  0/1  Not Started\n");

    const json = JSON.parse(runTracker(["list", "specs", "--json"], "sessB").stdout) as Array<
      Record<string, unknown>
    >;
    expect(json[0]).not.toHaveProperty("claim");
  });

  it("doctor lists outstanding claims with ages, marks stale ones, and stays healthy", () => {
    writeFileSync(join(trackerRoot, "M1-probe", "02-other.md"), SPEC, "utf-8");
    runTracker(["claim", SPEC_REF], "sessA");
    runTracker(["claim", "M1-probe/02-other.md"], "sessB");
    expireClaim();

    const { exitCode, stdout } = runTracker(["doctor"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("2 outstanding session claim(s)");
    expect(stdout).toContain("(1 STALE)");
    expect(stdout).toContain("sessA");
    expect(stdout).toContain("sessB");
    expect(stdout).toContain("tracker release");
  });

  it("doctor says nothing about claims when none are held", () => {
    const { stdout } = runTracker(["doctor"]);
    expect(stdout).not.toContain("outstanding session claim");
  });

  it("a corrupt claims file degrades to no-claims rather than breaking the CLI", () => {
    writeFileSync(join(trackerRoot, ".session-claims.json"), "{not json", "utf-8");

    expect(runTracker(["next"], "sessB").exitCode).toBe(0);
    expect(runTracker(["list", "specs"], "sessB").exitCode).toBe(0);
    expect(runTracker(["doctor"]).exitCode).toBe(0);
  });

  it("claims for different specs written by different sessions do not clobber each other", () => {
    writeClaims(trackerRoot, emptyClaimsDoc());
    for (const name of ["a", "b", "c"]) writeFileSync(join(trackerRoot, "M1-probe", `0${name === "a" ? 2 : name === "b" ? 3 : 4}-${name}.md`), SPEC, "utf-8");
    runTracker(["claim", "M1-probe/02-a.md"], "sessA");
    runTracker(["claim", "M1-probe/03-b.md"], "sessB");
    runTracker(["claim", "M1-probe/04-c.md"], "sessC");

    const claims = readClaims(trackerRoot).claims;
    expect(Object.keys(claims).sort()).toEqual(["M1-probe/02-a.md", "M1-probe/03-b.md", "M1-probe/04-c.md"]);
  });

  it("the claims file is valid JSON with the documented shape", () => {
    runTracker(["claim", SPEC_REF], "sessA");
    const raw = JSON.parse(
      readFileSync(join(trackerRoot, ".session-claims.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(raw["version"]).toBe(1);
    expect(Object.keys((raw["claims"] as Record<string, Record<string, unknown>>)[KEY]!).sort()).toEqual([
      "at",
      "expiresAt",
      "host",
      "session",
    ]);
  });

  it("release leaves a tombstone in released, and a new claim clears it (0.75.0)", () => {
    runTracker(["claim", SPEC_REF], "sessA");
    expect(runTracker(["release", SPEC_REF], "sessA").exitCode).toBe(0);
    const doc = readClaims(trackerRoot);
    expect(doc.claims[KEY]).toBeUndefined();
    expect(doc.released?.[KEY]?.session).toBe("sessA");
    runTracker(["claim", SPEC_REF], "sessB");
    const again = readClaims(trackerRoot);
    expect(again.claims[KEY]?.session).toBe("sessB");
    expect(again.released).toBeUndefined();
  });

  it("a claim taken on another host names that host and blocks the same session id here (0.75.0)", () => {
    const now = Date.now();
    writeClaims(trackerRoot, {
      version: 1,
      claims: {
        [SPEC_REF]: {
          session: "sessA",
          at: new Date(now - 60_000).toISOString(),
          expiresAt: new Date(now + 3_600_000).toISOString(),
          host: "other-host",
        },
      },
    });
    const refused = runTracker(["claim", SPEC_REF], "sessA");
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain("claimed by session sessA on other-host");
    const list = JSON.parse(runTracker(["claim", "--list", "--json"], "sessA").stdout) as Array<Record<string, unknown>>;
    expect(list[0]?.["host"]).toBe("other-host");
    expect(list[0]?.["state"]).toBe("held");
  });

  it("an old claim entry without host still reads, lists and gates as before", () => {
    const now = Date.now();
    writeFileSync(
      join(trackerRoot, ".session-claims.json"),
      JSON.stringify({
        version: 1,
        claims: {
          [SPEC_REF]: { session: "oldSess", at: new Date(now - 60_000).toISOString(), expiresAt: new Date(now + 3_600_000).toISOString() },
        },
      }),
      "utf-8",
    );
    expect(runTracker(["claim", SPEC_REF], "oldSess").exitCode).toBe(0);
    const refused = runTracker(["claim", SPEC_REF], "otherSess");
    expect(refused.stderr).toContain("claimed by session oldSess (");
    const list = JSON.parse(runTracker(["claim", "--list", "--json"], "x").stdout) as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
  });
});
