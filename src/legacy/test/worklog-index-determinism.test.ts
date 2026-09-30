/**
 * `worklog index` — clone stability (M7/05).
 *
 * `.tracker/worklog/00-INDEX.md` is a *committed* generated file, so "running
 * it twice writes identical bytes" is not enough: a fresh `git clone` must
 * regenerate the exact bytes already in the repo, or every checkout produces a
 * spurious diff and the tail of the table reshuffles for nobody's benefit.
 *
 * git does not preserve mtimes — a clone stamps every file with the checkout
 * time — so the only way to get that is for the index to derive its dates from
 * file *content* and nothing else. These tests do what a clone does (touch the
 * files, leave the bytes alone) and demand the same output.
 *
 * The distill age gate deliberately keeps its mtime fallback: "has anyone
 * touched this in 14 days" is a question about this checkout, answered inside
 * the session that asks. That contrast is pinned here too.
 *
 * pnpm vitest run worklog-index-determinism
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTracker } from "../lib/tracker-writer.ts";
import { scanWorklogFile, worklogLastActivity, worklogThreadActivity } from "../lib/worklog.ts";
import {
  collectWorklogIndexRows,
  rebuildWorklogIndex,
  WORKLOG_INDEX_FILE,
} from "../lib/worklog-index.ts";

const THREADED = [
  "## 01ABCDEFGHJKMNPQRSTD-auth — M9-auth",
  "<!-- opened: 2026-03-10T09:00:00.000Z -->",
  "<!-- closed: 2026-03-11T09:00:00.000Z status: done -->",
  "### 2026-03-10T09:00:00.000Z [note]",
  "rotate the signing keys",
  "",
].join("\n");

// Pre-CLI prose: no threads, no stamp — nothing in the bytes says when this
// file was last touched.
const LEGACY = [
  "# Worklog — cross-cutting investigation",
  "",
  "## Root cause",
  "The parser treated every heading as a thread.",
  "",
].join("\n");

const LEGACY_TWO = ["# Worklog — flaky CI", "", "Reproduced on the linux runner only.", ""].join(
  "\n",
);

const DISTILLED = [
  "<!-- distilled: 2026-01-15T12:00:00.000Z source-sha256: " +
    "0000000000000000000000000000000000000000000000000000000000000000 " +
    "raw: .tracker/archive/worklog-raw/M5-old.md -->",
  "# Worklog — M5 migration (distilled)",
  "",
  "Anchor: the migration ran in two passes.",
  "",
].join("\n");

describe("worklog index determinism", () => {
  let tmpDir: string;
  let trackerRoot: string;
  let worklogDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-worklog-det-"));
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

  function readIndex(): string {
    return readFileSync(join(worklogDir, WORKLOG_INDEX_FILE), "utf-8");
  }

  /** What a clone does to a worklog directory: new mtimes, identical bytes. */
  function restampMtimes(files: string[], when: Date): void {
    for (const file of files) {
      utimesSync(join(worklogDir, file), when, when);
    }
  }

  function writeMixedDir(): void {
    write("M9-auth.md", THREADED);
    write("investigation.md", LEGACY);
    write("flaky-ci.md", LEGACY_TWO);
    write("M5-old.md", DISTILLED);
  }

  const ALL = ["M9-auth.md", "investigation.md", "flaky-ci.md", "M5-old.md"];

  // -------------------------------------------------------------------------
  // 1. The clone test.
  // -------------------------------------------------------------------------

  it("regenerates byte-identical output after a touch-only mtime change", () => {
    writeMixedDir();
    restampMtimes(ALL, new Date("2024-01-02T03:04:05.000Z"));

    rebuildWorklogIndex(trackerRoot);
    const before = readIndex();

    // Same bytes on disk, wildly different mtimes — exactly a fresh checkout.
    restampMtimes(ALL, new Date("2026-08-05T11:22:33.000Z"));
    rebuildWorklogIndex(trackerRoot);

    expect(readIndex()).toBe(before);
  });

  it("keeps the row order stable across an mtime change", () => {
    writeMixedDir();
    restampMtimes(ALL, new Date("2024-01-02T03:04:05.000Z"));
    const before = collectWorklogIndexRows(trackerRoot).map((r) => r.file);

    // Reverse the mtime order of the files: nothing about the content moved.
    restampMtimes(["investigation.md"], new Date("2026-08-05T11:22:33.000Z"));
    restampMtimes(["M5-old.md"], new Date("2026-08-04T11:22:33.000Z"));

    expect(collectWorklogIndexRows(trackerRoot).map((r) => r.file)).toEqual(before);
  });

  it("never emits today's date for a file whose content carries no date", () => {
    write("investigation.md", LEGACY);
    restampMtimes(["investigation.md"], new Date());

    const today = new Date().toISOString().slice(0, 10);
    rebuildWorklogIndex(trackerRoot);
    expect(readIndex()).not.toContain(today);
  });

  // -------------------------------------------------------------------------
  // 2. Where each row's date comes from.
  // -------------------------------------------------------------------------

  it("dates a distilled stub from its provenance stamp, not the filesystem", () => {
    write("M5-old.md", DISTILLED);
    restampMtimes(["M5-old.md"], new Date("2026-08-05T11:22:33.000Z"));

    expect(collectWorklogIndexRows(trackerRoot)[0]).toMatchObject({
      state: "distilled",
      lastActivity: "2026-01-15",
    });
  });

  it("dates a threaded file from its newest thread timestamp", () => {
    write("M9-auth.md", THREADED);
    restampMtimes(["M9-auth.md"], new Date("2026-08-05T11:22:33.000Z"));

    expect(collectWorklogIndexRows(trackerRoot)[0]!.lastActivity).toBe("2026-03-11");
  });

  it("leaves legacy prose dateless and renders it as an em dash", () => {
    write("investigation.md", LEGACY);

    expect(collectWorklogIndexRows(trackerRoot)[0]!.lastActivity).toBeNull();
    rebuildWorklogIndex(trackerRoot);
    expect(readIndex()).toContain("| [investigation.md](investigation.md) | — | legacy | 0/0 | — |");
  });

  // -------------------------------------------------------------------------
  // 3. Dateless rows still sort totally.
  // -------------------------------------------------------------------------

  it("sorts dateless rows last, among themselves by filename", () => {
    writeMixedDir();

    const rows = collectWorklogIndexRows(trackerRoot);
    expect(rows.map((r) => r.file)).toEqual([
      "M9-auth.md", // 2026-03-11
      "M5-old.md", // 2026-01-15
      "flaky-ci.md", // dateless, sorts before investigation.md
      "investigation.md", // dateless
    ]);
  });

  it("orders an all-dateless directory by filename regardless of write order", () => {
    write("zulu.md", LEGACY);
    write("alpha.md", LEGACY_TWO);
    write("mike.md", LEGACY);

    expect(collectWorklogIndexRows(trackerRoot).map((r) => r.file)).toEqual([
      "alpha.md",
      "mike.md",
      "zulu.md",
    ]);
  });

  // -------------------------------------------------------------------------
  // 4. The two activity functions, and why there are two.
  // -------------------------------------------------------------------------

  it("worklogThreadActivity is pure — null for thread-less files, whatever their mtime", () => {
    write("investigation.md", LEGACY);
    const legacyScan = scanWorklogFile(join(worklogDir, "investigation.md"));
    expect(worklogThreadActivity(legacyScan.doc)).toBeNull();

    write("M5-old.md", DISTILLED);
    const stubScan = scanWorklogFile(join(worklogDir, "M5-old.md"));
    expect(worklogThreadActivity(stubScan.doc)).toBeNull();

    write("M9-auth.md", THREADED);
    const threadScan = scanWorklogFile(join(worklogDir, "M9-auth.md"));
    expect(worklogThreadActivity(threadScan.doc)).toBe("2026-03-11T09:00:00.000Z");
  });

  it("worklogLastActivity keeps the mtime fallback the distill age gate needs", () => {
    write("investigation.md", LEGACY);
    const path = join(worklogDir, "investigation.md");
    restampMtimes(["investigation.md"], new Date("2024-06-07T08:09:10.000Z"));

    const { doc } = scanWorklogFile(path);
    expect(worklogLastActivity(doc, path)).toBe("2024-06-07T08:09:10.000Z");
  });

  it("worklogLastActivity prefers content over mtime when the content has dates", () => {
    write("M9-auth.md", THREADED);
    const path = join(worklogDir, "M9-auth.md");
    restampMtimes(["M9-auth.md"], new Date("2026-08-05T11:22:33.000Z"));

    const { doc } = scanWorklogFile(path);
    expect(worklogLastActivity(doc, path)).toBe("2026-03-11T09:00:00.000Z");
  });
});
