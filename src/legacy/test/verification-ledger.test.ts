/**
 * Tests for the verification ledger (`.verification-log.jsonl`).
 *
 * pnpm vitest run verification-ledger
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  appendLedgerEntry,
  readLedger,
  ledgerKey,
  ledgerKeys,
  ledgerPath,
  toLedgerSpecPath,
  getPluginVersion,
  LEDGER_FILENAME,
} from "../lib/verification/ledger.ts";

describe("verification ledger", () => {
  let tmpDir: string;
  let trackerRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-ledger-test-"));
    trackerRoot = join(tmpDir, ".tracker");
    mkdirSync(join(trackerRoot, "M1-probe"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const specPath = () => join(trackerRoot, "M1-probe", "01-spec.md");

  function append(overrides: Partial<Parameters<typeof appendLedgerEntry>[0]> = {}): boolean {
    return appendLedgerEntry({
      trackerRoot,
      specPath: specPath(),
      index: 0,
      label: "some check",
      command: "pnpm test",
      expected: "exit 0",
      exitCode: 0,
      outcome: "pass",
      ...overrides,
    });
  }

  it("creates the ledger on first append and writes one JSON line", () => {
    expect(existsSync(ledgerPath(trackerRoot))).toBe(false);
    expect(append()).toBe(true);

    const raw = readFileSync(ledgerPath(trackerRoot), "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw.trim().split("\n")).toHaveLength(1);

    const entry = JSON.parse(raw.trim());
    expect(entry.outcome).toBe("pass");
    expect(entry.command).toBe("pnpm test");
    expect(entry.pluginVersion).toBe(getPluginVersion());
    expect(entry.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Absent, not null — an entry with no evidence carries no evidence key.
    expect("evidence" in entry).toBe(false);
  });

  it("appends rather than replaces", () => {
    append({ index: 0 });
    append({ index: 1, outcome: "fail", exitCode: 1 });
    const entries = readLedger(trackerRoot);
    expect(entries.map((e) => e.index)).toEqual([0, 1]);
    expect(entries[1]!.outcome).toBe("fail");
  });

  it("stores the spec path relative to the repo root, never absolute", () => {
    append();
    expect(readLedger(trackerRoot)[0]!.spec).toBe(".tracker/M1-probe/01-spec.md");
    expect(toLedgerSpecPath(trackerRoot, specPath())).toBe(".tracker/M1-probe/01-spec.md");
  });

  it("records trimmed evidence when given", () => {
    append({ outcome: "manual", exitCode: null, evidence: "  read the file by hand  " });
    expect(readLedger(trackerRoot)[0]!.evidence).toBe("read the file by hand");
  });

  it("caps oversized fields so a single append stays one atomic write", () => {
    append({
      outcome: "manual",
      exitCode: null,
      evidence: "e".repeat(5000),
      command: "c".repeat(5000),
    });
    const line = readFileSync(ledgerPath(trackerRoot), "utf-8").trim();
    // Comfortably under PIPE_BUF (4096), which is what makes the O_APPEND
    // write atomic against concurrent appenders.
    expect(Buffer.byteLength(line, "utf-8")).toBeLessThan(4096);
    expect(readLedger(trackerRoot)[0]!.evidence).toContain("[truncated]");
  });

  it("skips malformed lines instead of blinding the reader to the rest", () => {
    append({ index: 0 });
    appendFileSync(ledgerPath(trackerRoot), "{not json\n", "utf-8");
    append({ index: 2 });

    const entries = readLedger(trackerRoot);
    expect(entries.map((e) => e.index)).toEqual([0, 2]);
  });

  it("returns an empty list when no ledger exists", () => {
    expect(readLedger(trackerRoot)).toEqual([]);
    expect(ledgerKeys(trackerRoot).size).toBe(0);
  });

  it("ledgerKeys indexes by spec#index", () => {
    append({ index: 0 });
    append({ index: 3 });
    const keys = ledgerKeys(trackerRoot);
    expect(keys.has(ledgerKey(".tracker/M1-probe/01-spec.md", 0))).toBe(true);
    expect(keys.has(ledgerKey(".tracker/M1-probe/01-spec.md", 3))).toBe(true);
    expect(keys.has(ledgerKey(".tracker/M1-probe/01-spec.md", 9))).toBe(false);
  });

  it("never throws when the ledger cannot be written", () => {
    // trackerRoot points at an existing FILE — mkdir and append both fail.
    const blocked = join(tmpDir, "not-a-dir");
    writeFileSync(blocked, "x", "utf-8");
    expect(
      appendLedgerEntry({
        trackerRoot: blocked,
        specPath: join(blocked, "spec.md"),
        index: 0,
        label: "l",
        command: null,
        expected: null,
        exitCode: null,
        outcome: "manual",
      }),
    ).toBe(false);
  });

  it("survives 10 concurrent appenders with 10 intact lines", () => {
    // Each child appends one entry through the same code path the CLI uses.
    const script = `
      import { appendLedgerEntry } from ${JSON.stringify(join(process.cwd(), "lib/verification/ledger.ts"))};
      appendLedgerEntry({
        trackerRoot: ${JSON.stringify(trackerRoot)},
        specPath: ${JSON.stringify(specPath())},
        index: Number(process.argv[2]),
        label: "concurrent " + process.argv[2],
        command: "pnpm test",
        expected: "exit 0",
        exitCode: 0,
        outcome: "pass",
        evidence: "x".repeat(400),
      });
    `;
    const scriptPath = join(tmpDir, "append.mts");
    writeFileSync(scriptPath, script, "utf-8");

    const children = Array.from({ length: 10 }, (_, i) =>
      spawnSync("node", ["--experimental-strip-types", "--no-warnings", scriptPath, String(i)], {
        encoding: "utf-8",
        timeout: 30_000,
      }),
    );
    for (const c of children) expect(c.status).toBe(0);

    const lines = readFileSync(ledgerPath(trackerRoot), "utf-8")
      .split("\n")
      .filter((l) => l.trim() !== "");
    expect(lines).toHaveLength(10);
    // Every line parses — no half-written record, no interleaving.
    const indices = lines.map((l) => (JSON.parse(l) as { index: number }).index).sort((a, b) => a - b);
    expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("uses the documented filename", () => {
    expect(LEDGER_FILENAME).toBe(".verification-log.jsonl");
  });
});
