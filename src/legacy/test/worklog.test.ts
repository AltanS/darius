/**
 * Tests for worklog open|append|close|list operations.
 *
 * pnpm vitest run worklog
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { initTracker, addMilestone } from "../lib/tracker-writer.ts";
import {
  openThread,
  appendThread,
  closeThread,
  listThreads,
  findWorklogFileForThread,
} from "../lib/worklog.ts";

describe("worklog", () => {
  let tmpDir: string;
  let trackerRoot: string;
  let worklogDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tracker-worklog-test-"));
    initTracker({ projectRoot: tmpDir });
    trackerRoot = join(tmpDir, ".tracker");
    worklogDir = join(trackerRoot, "worklog");
    addMilestone({
      trackerRoot,
      name: "Test Milestone",
      slug: "test-milestone",
      owner: "dev@example.com",
    });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // open
  // -------------------------------------------------------------------------

  it("open creates a worklog file and returns a thread ID", () => {
    const worklogPath = join(worklogDir, "test.md");

    const threadId = openThread({
      worklogPath,
      slug: "auth-refactor",
    });

    expect(threadId).toMatch(/^[0-9A-Z]{20}-auth-refactor$/);
    expect(existsSync(worklogPath)).toBe(true);

    const content = readFileSync(worklogPath, "utf-8");
    expect(content).toContain(threadId);
    expect(content).toContain("auth-refactor");
  });

  it("open with message includes note entry", () => {
    const worklogPath = join(worklogDir, "test.md");

    openThread({
      worklogPath,
      slug: "test",
      message: "started work on auth",
    });

    const content = readFileSync(worklogPath, "utf-8");
    expect(content).toContain("started work on auth");
    expect(content).toContain("[note]");
  });

  it("open with specPath includes spec reference", () => {
    const worklogPath = join(worklogDir, "test.md");

    openThread({
      worklogPath,
      slug: "test",
      specPath: ".tracker/M1-test/01-spec.md",
    });

    const content = readFileSync(worklogPath, "utf-8");
    expect(content).toContain(".tracker/M1-test/01-spec.md");
  });

  // -------------------------------------------------------------------------
  // append
  // -------------------------------------------------------------------------

  it("append adds a note entry to an existing thread", () => {
    const worklogPath = join(worklogDir, "test.md");

    const threadId = openThread({ worklogPath, slug: "test" });

    appendThread({
      worklogPath,
      threadId,
      section: "note",
      message: "implementation decision made",
    });

    const content = readFileSync(worklogPath, "utf-8");
    expect(content).toContain("implementation decision made");
    expect(content).toContain("[note]");
  });

  it("append adds an artifact entry", () => {
    const worklogPath = join(worklogDir, "test.md");

    const threadId = openThread({ worklogPath, slug: "test" });

    appendThread({
      worklogPath,
      threadId,
      section: "artifact",
      message: "some/file.ts",
    });

    const content = readFileSync(worklogPath, "utf-8");
    expect(content).toContain("some/file.ts");
    expect(content).toContain("[artifact]");
  });

  it("append adds a blocker entry", () => {
    const worklogPath = join(worklogDir, "test.md");

    const threadId = openThread({ worklogPath, slug: "test" });

    appendThread({
      worklogPath,
      threadId,
      section: "blocker",
      message: "waiting for API key",
    });

    const content = readFileSync(worklogPath, "utf-8");
    expect(content).toContain("waiting for API key");
    expect(content).toContain("[blocker]");
  });

  it("append throws if thread not found", () => {
    const worklogPath = join(worklogDir, "test.md");
    openThread({ worklogPath, slug: "test" });

    expect(() =>
      appendThread({
        worklogPath,
        threadId: "NONEXISTENT-thread",
        section: "note",
        message: "test",
      }),
    ).toThrow("Thread not found");
  });

  // -------------------------------------------------------------------------
  // close
  // -------------------------------------------------------------------------

  it("close marks a thread as closed with status", () => {
    const worklogPath = join(worklogDir, "test.md");

    const threadId = openThread({ worklogPath, slug: "test" });

    closeThread({ worklogPath, threadId, status: "done" });

    const content = readFileSync(worklogPath, "utf-8");
    expect(content).toContain("status: done");
  });

  it("close with blocked status", () => {
    const worklogPath = join(worklogDir, "test.md");
    const threadId = openThread({ worklogPath, slug: "test" });
    closeThread({ worklogPath, threadId, status: "blocked" });

    const content = readFileSync(worklogPath, "utf-8");
    expect(content).toContain("status: blocked");
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  it("list returns threads from all worklog files", () => {
    const worklogPath1 = join(worklogDir, "milestone1.md");
    const worklogPath2 = join(worklogDir, "milestone2.md");

    openThread({ worklogPath: worklogPath1, slug: "thread-a" });
    openThread({ worklogPath: worklogPath2, slug: "thread-b" });

    const threads = listThreads({ trackerRoot });
    expect(threads.length).toBe(2);
  });

  it("list --active filters out closed threads", () => {
    const worklogPath = join(worklogDir, "test.md");

    const threadId1 = openThread({ worklogPath, slug: "open-thread" });
    const threadId2 = openThread({ worklogPath, slug: "closed-thread" });
    closeThread({ worklogPath, threadId: threadId2, status: "done" });

    const threads = listThreads({ trackerRoot, activeOnly: true });
    const ids = threads.map((t) => t.threadId);
    expect(ids).toContain(threadId1);
    expect(ids).not.toContain(threadId2);
  });

  it("list --milestone filters by milestone slug", () => {
    const worklogPath1 = join(worklogDir, "M1-design.md");
    const worklogPath2 = join(worklogDir, "M2-tracker.md");

    openThread({ worklogPath: worklogPath1, slug: "design-thread" });
    openThread({ worklogPath: worklogPath2, slug: "tracker-thread" });

    const threads = listThreads({ trackerRoot, milestoneSlug: "M1" });
    expect(threads.length).toBe(1);
    expect(threads[0]?.worklogFile).toBe("M1-design.md");
  });

  // -------------------------------------------------------------------------
  // findWorklogFileForThread
  // -------------------------------------------------------------------------

  it("findWorklogFileForThread locates the correct file", () => {
    const worklogPath = join(worklogDir, "test.md");
    const threadId = openThread({ worklogPath, slug: "findme" });

    const found = findWorklogFileForThread({ trackerRoot, threadId });
    expect(found).toBe(worklogPath);
  });

  it("findWorklogFileForThread returns null for unknown thread", () => {
    const found = findWorklogFileForThread({ trackerRoot, threadId: "NOTEXIST" });
    expect(found).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Multiple threads per file
  // -------------------------------------------------------------------------

  it("supports multiple threads in the same worklog file", () => {
    const worklogPath = join(worklogDir, "test.md");

    const id1 = openThread({ worklogPath, slug: "first" });
    const id2 = openThread({ worklogPath, slug: "second" });

    appendThread({ worklogPath, threadId: id1, section: "note", message: "note for first" });
    appendThread({ worklogPath, threadId: id2, section: "note", message: "note for second" });

    const threads = listThreads({ trackerRoot });
    expect(threads.length).toBe(2);

    const content = readFileSync(worklogPath, "utf-8");
    expect(content).toContain("note for first");
    expect(content).toContain("note for second");
  });

  // -------------------------------------------------------------------------
  // CLI integration
  // -------------------------------------------------------------------------

  it("CLI worklog open returns a thread ID on stdout", () => {
    const result = spawnSync(
      "node",
      [
        "--experimental-strip-types",
        "--no-warnings",
        join(process.cwd(), "bin/tracker.mts"),
        "worklog",
        "open",
        "test-milestone",
        "--message",
        "hello",
      ],
      {
        encoding: "utf-8",
        cwd: tmpDir,
        timeout: 30_000,
      },
    );

    expect(result.status).toBe(0);
    const threadId = result.stdout.trim();
    expect(threadId).toMatch(/^[0-9A-Z]{20}-test-milestone$/);
  });

  // -------------------------------------------------------------------------
  // CLI: a worklog belongs to a milestone
  // -------------------------------------------------------------------------

  function runOpen(args: string[]): { stdout: string; stderr: string; exitCode: number } {
    const result = spawnSync(
      "node",
      [
        "--experimental-strip-types",
        "--no-warnings",
        join(process.cwd(), "bin/tracker.mts"),
        "worklog",
        "open",
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

  it("CLI worklog open refuses a slug that names no milestone", () => {
    const { stderr, exitCode } = runOpen(["acme-deploy-latency", "--message", "x"]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain(
      'tracker worklog open: "acme-deploy-latency" names no milestone in .tracker/.',
    );
    expect(stderr).toContain("darius add milestone <name>");
    expect(existsSync(join(worklogDir, "acme-deploy-latency.md"))).toBe(false);
  });

  it("CLI worklog open refuses a missing slug and writes no default.md", () => {
    const { stderr, exitCode } = runOpen(["--message", "x"]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("name the milestone: worklog open <milestone-slug>");
    expect(existsSync(join(worklogDir, "default.md"))).toBe(false);
  });

  it("CLI worklog open accepts the full milestone folder name", () => {
    const folder = readdirSync(trackerRoot).find((e) => /^M\d+-test-milestone$/.test(e));
    expect(folder).toBeDefined();

    const { stdout, exitCode } = runOpen([folder!]);

    expect(exitCode).toBe(0);
    expect(stdout.trim().toLowerCase()).toMatch(new RegExp(`^[0-9a-z]{20}-${folder!.toLowerCase()}$`));
    expect(existsSync(join(worklogDir, `${folder}.md`))).toBe(true);
  });

  it("CLI worklog open accepts the bare milestone slug", () => {
    const { exitCode } = runOpen(["test-milestone"]);

    expect(exitCode).toBe(0);
    expect(existsSync(join(worklogDir, "test-milestone.md"))).toBe(true);
  });

  it("CLI worklog open refuses a milestone that exists only in the archive", () => {
    mkdirSync(join(trackerRoot, "archive"), { recursive: true });
    writeFileSync(join(trackerRoot, "archive", "M90-old-thing.md"), "# old\n", "utf-8");
    mkdirSync(join(trackerRoot, "archive", "M91-older-thing"), { recursive: true });

    for (const slug of ["old-thing", "M90-old-thing", "older-thing", "archive/M91-older-thing"]) {
      const { stderr, exitCode } = runOpen([slug]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("names no milestone");
    }
  });

  it("CLI worklog open refuses folders that are not milestones", () => {
    for (const slug of ["worklog", "archive", ".."]) {
      const { exitCode } = runOpen([slug]);
      expect(exitCode).toBe(1);
    }
  });
});
