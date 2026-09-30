/**
 * `tracker worklog index` — the generated worklog/00-INDEX.md (M7/03).
 *
 * The index is the cheap findability layer over a worklog directory: one row
 * per file, so an agent can locate a worklog without reading any of them. These
 * tests pin the row data (state, counts, milestone, hook), the ordering, the
 * empty-directory case, and the rule that makes the whole thing safe to re-run:
 * `00-` files are never enumerated, least of all by the index itself.
 *
 * pnpm vitest run worklog-index
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { initTracker } from "../lib/tracker-writer.ts";
import { listWorklogFiles, findWorklogFileForThread } from "../lib/worklog.ts";
import { listDistillCandidates } from "../lib/worklog-distill.ts";
import {
  collectWorklogIndexRows,
  rebuildWorklogIndex,
  WORKLOG_INDEX_FILE,
} from "../lib/worklog-index.ts";

// An open thread — the file is still being worked in. Shaped the way the CLI
// actually writes one: the label is the slug (which is also the filename), and
// the description the caller passed as `--message` is the first entry.
const ACTIVE = [
  "# Worklog — M9 auth",
  "",
  "## 01ABCDEFGHJKMNPQRST1-auth — M9-auth",
  "<!-- opened: 2026-03-10T09:00:00.000Z -->",
  "### 2026-03-10T09:00:00.000Z [note]",
  "rotate the signing keys",
  "",
].join("\n");

// Two threads, both closed.
const CLOSED = [
  "# Worklog — M8 storage",
  "",
  "## 01ABCDEFGHJKMNPQRST2-alpha — M8-storage",
  "<!-- opened: 2026-02-01T09:00:00.000Z -->",
  "<!-- closed: 2026-02-02T09:00:00.000Z status: done -->",
  "### 2026-02-01T09:00:00.000Z [note]",
  "shard the blob store",
  "## 01ABCDEFGHJKMNPQRST3-beta — beta",
  "<!-- opened: 2026-02-03T09:00:00.000Z -->",
  "<!-- closed: 2026-02-05T09:00:00.000Z status: done -->",
  "### 2026-02-03T09:00:00.000Z [note]",
  "another note",
  "",
].join("\n");

// Pre-CLI prose: headings with no `opened:` marker, so no threads at all.
const LEGACY = [
  "# Worklog — cross-cutting investigation",
  "",
  "## Root cause",
  "The parser treated every heading as a thread.",
  "",
].join("\n");

// A distilled anchor stub: the provenance stamp, then prose.
const DISTILLED = [
  "<!-- distilled: 2026-01-15T12:00:00.000Z source-sha256: " +
    "0000000000000000000000000000000000000000000000000000000000000000 " +
    "raw: .tracker/archive/worklog-raw/M5-old.md -->",
  "# Worklog — M5 migration (distilled)",
  "",
  "Anchor: the migration ran in two passes.",
  "",
].join("\n");

const LONG_LABEL =
  "rework the entire verification ledger so every checklist item carries executable evidence";

describe("worklog index", () => {
  let tmpDir: string;
  let trackerRoot: string;
  let worklogDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-worklog-index-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
    worklogDir = join(trackerRoot, "worklog");
    mkdirSync(worklogDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function write(file: string, content: string): void {
    writeFileSync(join(worklogDir, file), content, "utf-8");
  }

  function writeFixtureDir(): void {
    write("M9-auth.md", ACTIVE);
    write("M8-storage.md", CLOSED);
    write("investigation.md", LEGACY);
    write("M5-old.md", DISTILLED);
  }

  function runTracker(args: string[]): { stdout: string; stderr: string; exitCode: number } {
    const result = spawnSync(
      "node",
      [
        "--experimental-strip-types",
        "--no-warnings",
        join(process.cwd(), "bin/tracker.mts"),
        ...args,
      ],
      { encoding: "utf-8", cwd: tmpDir, timeout: 30_000 },
    );
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.status ?? -1,
    };
  }

  function readIndex(): string {
    return readFileSync(join(worklogDir, WORKLOG_INDEX_FILE), "utf-8");
  }

  // -------------------------------------------------------------------------
  // 1. Row data — one row per file, with the right state.
  // -------------------------------------------------------------------------

  it("derives a row per worklog file with state, counts, milestone and hook", () => {
    writeFixtureDir();

    const byFile = new Map(collectWorklogIndexRows(trackerRoot).map((r) => [r.file, r]));
    expect([...byFile.keys()].sort()).toEqual([
      "M5-old.md",
      "M8-storage.md",
      "M9-auth.md",
      "investigation.md",
    ]);

    expect(byFile.get("M9-auth.md")).toMatchObject({
      milestone: "M9",
      state: "active",
      openThreads: 1,
      totalThreads: 1,
      lastActivity: "2026-03-10",
      hook: "rotate the signing keys",
    });

    expect(byFile.get("M8-storage.md")).toMatchObject({
      milestone: "M8",
      state: "closed",
      openThreads: 0,
      totalThreads: 2,
      lastActivity: "2026-02-05",
      hook: "shard the blob store",
    });

    // Cross-cutting: no milestone code in the filename.
    expect(byFile.get("investigation.md")).toMatchObject({
      milestone: null,
      state: "legacy",
      openThreads: 0,
      totalThreads: 0,
      hook: "Worklog — cross-cutting investigation",
    });

    // The stamp wins over the "thread-less prose" legacy reading, and dates the
    // row — the distillation is the last thing that genuinely happened here.
    expect(byFile.get("M5-old.md")).toMatchObject({
      milestone: "M5",
      state: "distilled",
      openThreads: 0,
      totalThreads: 0,
      lastActivity: "2026-01-15",
      hook: "Worklog — M5 migration (distilled)",
    });
  });

  it("leaves pre-CLI prose dateless rather than dating it from the filesystem", () => {
    write("investigation.md", LEGACY);

    expect(collectWorklogIndexRows(trackerRoot)[0]!.lastActivity).toBeNull();
    rebuildWorklogIndex(trackerRoot);
    expect(readIndex()).toContain("| [investigation.md](investigation.md) | — | legacy | 0/0 | — |");
  });

  it("reads a file with folded legacy headings AND real threads as closed, not legacy", () => {
    write(
      "M4-mixed.md",
      [
        "# Worklog — mixed",
        "",
        "## Background",
        "prose that predates the CLI",
        "",
        "## 01ABCDEFGHJKMNPQRST4-gamma — gamma",
        "<!-- opened: 2026-01-02T09:00:00.000Z -->",
        "<!-- closed: 2026-01-03T09:00:00.000Z status: done -->",
        "",
      ].join("\n"),
    );

    expect(collectWorklogIndexRows(trackerRoot)[0]).toMatchObject({
      state: "closed",
      totalThreads: 1,
    });
  });

  it("reads an empty worklog file as closed with no threads", () => {
    write("M3-empty.md", "");

    expect(collectWorklogIndexRows(trackerRoot)[0]).toMatchObject({
      state: "closed",
      openThreads: 0,
      totalThreads: 0,
      hook: "—",
    });
  });

  // -------------------------------------------------------------------------
  // 2. Hook derivation and truncation.
  // -------------------------------------------------------------------------

  it("prefers the first entry's text over a label that only restates the filename", () => {
    write("M9-auth.md", ACTIVE);

    // The CLI stores the slug as the label, and the slug is the filename stem —
    // so a label-first hook would make the Hook column echo the File column.
    expect(collectWorklogIndexRows(trackerRoot)[0]!.hook).toBe("rotate the signing keys");
  });

  it("falls back to the thread label only when the thread has no entry text", () => {
    write(
      "M6-labelled.md",
      [
        "## 01ABCDEFGHJKMNPQRSTA-lab — hunt the flaky lock test",
        "<!-- opened: 2026-06-01T09:00:00.000Z -->",
        "",
      ].join("\n"),
    );

    expect(collectWorklogIndexRows(trackerRoot)[0]!.hook).toBe("hunt the flaky lock test");
  });

  it("skips a leading artifact entry, which carries a path and no text", () => {
    write(
      "M6-artifact.md",
      [
        "## 01ABCDEFGHJKMNPQRSTB-art — M6-artifact",
        "<!-- opened: 2026-06-02T09:00:00.000Z -->",
        "### 2026-06-02T09:00:00.000Z [artifact]",
        "lib/lock.ts",
        "### 2026-06-02T10:00:00.000Z [note]",
        "the lock never released on throw",
        "",
      ].join("\n"),
    );

    expect(collectWorklogIndexRows(trackerRoot)[0]!.hook).toBe("the lock never released on throw");
  });

  it("takes only the first line of a multi-line entry", () => {
    write(
      "M6-multiline.md",
      [
        "## 01ABCDEFGHJKMNPQRSTC-ml — M6-multiline",
        "<!-- opened: 2026-06-03T09:00:00.000Z -->",
        "### 2026-06-03T09:00:00.000Z [note]",
        "split the parser from the renderer",
        "then thread the options through both",
        "",
      ].join("\n"),
    );

    expect(collectWorklogIndexRows(trackerRoot)[0]!.hook).toBe("split the parser from the renderer");
  });

  it("truncates a long hook to ~60 chars with an ellipsis", () => {
    write(
      "M2-long.md",
      [
        `## 01ABCDEFGHJKMNPQRST5-long — ${LONG_LABEL}`,
        "<!-- opened: 2026-04-01T09:00:00.000Z -->",
        "",
      ].join("\n"),
    );

    const { hook } = collectWorklogIndexRows(trackerRoot)[0]!;
    expect(hook.length).toBeLessThanOrEqual(60);
    expect(hook.endsWith("…")).toBe(true);
    expect(LONG_LABEL.startsWith(hook.slice(0, -1))).toBe(true);
  });

  it("keeps a pipe in a hook from breaking the table row", () => {
    write(
      "M2-pipe.md",
      [
        "## 01ABCDEFGHJKMNPQRST6-pipe — parse a | b",
        "<!-- opened: 2026-04-02T09:00:00.000Z -->",
        "",
      ].join("\n"),
    );

    expect(collectWorklogIndexRows(trackerRoot)[0]!.hook).toBe("parse a \\| b");
  });

  // -------------------------------------------------------------------------
  // 3. Sort order — active first, then newest activity.
  // -------------------------------------------------------------------------

  it("sorts active files first, then by last activity descending", () => {
    writeFixtureDir();
    // A second active file, older than M9-auth.md.
    write(
      "M7-older-active.md",
      [
        "## 01ABCDEFGHJKMNPQRST7-older — older",
        "<!-- opened: 2026-01-05T09:00:00.000Z -->",
        "",
      ].join("\n"),
    );

    const rows = collectWorklogIndexRows(trackerRoot);
    expect(rows.slice(0, 2).map((r) => r.file)).toEqual(["M9-auth.md", "M7-older-active.md"]);
    expect(rows.slice(0, 2).every((r) => r.state === "active")).toBe(true);

    // The remaining (non-active) rows are in descending date order.
    const tailDates = rows.slice(2).map((r) => r.lastActivity ?? "");
    expect([...tailDates].sort().reverse()).toEqual(tailDates);
  });

  // -------------------------------------------------------------------------
  // 4. Rendered document.
  // -------------------------------------------------------------------------

  it("writes 00-INDEX.md with the generated header naming its rebuild command", () => {
    writeFixtureDir();

    const result = rebuildWorklogIndex(trackerRoot);
    expect(result).not.toBeNull();
    expect(result!.path).toBe(join(worklogDir, WORKLOG_INDEX_FILE));

    const content = readIndex();
    expect(content.split("\n")[0]).toBe(
      "<!-- Generated by tracker CLI. Do not edit; run `tracker worklog index`. -->",
    );
    expect(content).toContain("| [M9-auth.md](M9-auth.md) | M9 | active | 1/1 | 2026-03-10 |");
    expect(content).toContain("| [investigation.md](investigation.md) | — | legacy | 0/0 |");
    expect(content).toContain("| [M5-old.md](M5-old.md) | M5 | distilled | 0/0 |");
  });

  it("renders an empty worklog directory as a header plus a no-worklogs line", () => {
    const result = rebuildWorklogIndex(trackerRoot);
    expect(result).not.toBeNull();
    expect(result!.rows).toEqual([]);

    const content = readIndex();
    expect(content).toContain("# Worklog Index");
    expect(content).toContain("_No worklogs yet_");
    expect(content).not.toContain("| File |");
  });

  it("is deterministic — two runs produce byte-identical output", () => {
    writeFixtureDir();

    rebuildWorklogIndex(trackerRoot);
    const first = readIndex();
    rebuildWorklogIndex(trackerRoot);
    expect(readIndex()).toBe(first);
  });

  // -------------------------------------------------------------------------
  // 5. `00-` files are never enumerated.
  // -------------------------------------------------------------------------

  it("excludes 00-INDEX.md from its own rows across repeated rebuilds", () => {
    writeFixtureDir();

    rebuildWorklogIndex(trackerRoot);
    const second = rebuildWorklogIndex(trackerRoot);

    expect(second!.rows.map((r) => r.file)).not.toContain(WORKLOG_INDEX_FILE);
    expect(readIndex()).not.toContain(`[${WORKLOG_INDEX_FILE}]`);
  });

  it("excludes 00- files from worklog list, distill --list and thread resolution", () => {
    write("M9-auth.md", ACTIVE);
    // A 00- file crafted to look like a distillable worklog with a real thread.
    write(
      "00-NOTES.md",
      [
        "## 01ABCDEFGHJKMNPQRST8-index — index thread",
        "<!-- opened: 2026-05-01T09:00:00.000Z -->",
        "",
      ].join("\n"),
    );

    expect(listWorklogFiles({ trackerRoot }).map((f) => f.worklogFile)).toEqual(["M9-auth.md"]);
    expect(listDistillCandidates({ trackerRoot }).map((c) => c.worklogFile)).toEqual([
      "M9-auth.md",
    ]);
    expect(
      findWorklogFileForThread({ trackerRoot, threadId: "01ABCDEFGHJKMNPQRST8-index" }),
    ).toBeNull();

    const { stdout } = runTracker(["worklog", "list"]);
    expect(stdout).not.toContain("00-NOTES.md");
    expect(stdout).not.toContain("01ABCDEFGHJKMNPQRST8-index");
  });

  it("still refuses a 00- file named explicitly to distill, with the index-file reason", () => {
    write("00-NOTES.md", LEGACY);

    const { stdout, exitCode } = runTracker(["worklog", "distill", "00-NOTES.md", "--check"]);
    expect(exitCode).toBe(1);
    expect(stdout.trim()).toBe("index-file");
  });

  // -------------------------------------------------------------------------
  // 6. CLI surface.
  // -------------------------------------------------------------------------

  it("`tracker worklog index` writes the file and reports the count", () => {
    writeFixtureDir();

    const { stdout, exitCode } = runTracker(["worklog", "index"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain(WORKLOG_INDEX_FILE);
    expect(stdout).toContain("(4 file(s))");
    expect(readIndex()).toContain("# Worklog Index");
  });

  it("`tracker worklog index` run twice is byte-stable", () => {
    writeFixtureDir();

    expect(runTracker(["worklog", "index"]).exitCode).toBe(0);
    const first = readIndex();
    expect(runTracker(["worklog", "index"]).exitCode).toBe(0);
    expect(readIndex()).toBe(first);
  });

  it("reports a missing worklog directory instead of failing", () => {
    rmSync(worklogDir, { recursive: true, force: true });

    expect(rebuildWorklogIndex(trackerRoot)).toBeNull();

    const { stdout, exitCode } = runTracker(["worklog", "index"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("nothing to index");
  });
});
