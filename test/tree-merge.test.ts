/**
 * The merges of concurrent tree versions (0.75.0): worklogs by thread
 * (src/core/worklog-merge.ts), spec ticks (src/core/spec-merge.ts), the
 * claims file (src/core/claims-merge.ts), and the `tree.conflict` line when
 * no merge applies (src/core/tree-conflicts.ts).
 *
 * The two-host tests follow test/tree.test.ts: each host has its own state
 * and config dir, and `ship` moves ledger chunks and blobs by hand, the way
 * `darius sync` would through the bucket.
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { mergeClaims } from "../src/core/claims-merge.ts";
import { appendLines, closeOpenChunk, readLedger } from "../src/core/ledger.ts";
import { isSpecPath, mergeSpecTicks } from "../src/core/spec-merge.ts";
import { openProject, sha256Hex, type Project } from "../src/core/store.ts";
import { isMergeablePath, syncTree, treeDir } from "../src/core/tree.ts";
import { conflictAdvice, readTreeConflicts, TREE_CONFLICT, TREE_RESOLVED } from "../src/core/tree-conflicts.ts";
import { isWorklogPath, mergeWorklog } from "../src/core/worklog-merge.ts";
import { sleepSync } from "../src/runtime.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-tree-merge-"));
after(() => rmSync(SANDBOX, { recursive: true, force: true }));

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array | null): string => (bytes === null ? "<null>" : new TextDecoder().decode(bytes));

// --- worklog ----------------------------------------------------------------

interface ThreadSpec {
  id: string;
  stage?: string;
  stamps?: { stage: string; at: string; host: string }[];
  closed?: string;
  entries?: { at: string; kind?: string; text: string }[];
}

/** A thread as the legacy serializer writes it. */
function thread(given: ThreadSpec): string {
  const lines = [`## ${given.id} — ${given.id}`, "<!-- opened: 2026-10-08T10:00:00.000Z -->", "<!-- spec: .tracker/M1-alpha/01-a.md -->"];
  if (given.stage !== undefined) lines.push(`<!-- stage: ${given.stage} -->`);
  for (const stamp of given.stamps ?? []) lines.push(`<!-- stamp: ${JSON.stringify({ stage: stamp.stage, at: stamp.at, head: "none", host: stamp.host })} -->`);
  if (given.closed !== undefined) lines.push(`<!-- closed: 2026-10-08T12:00:00.000Z status: ${given.closed} -->`);
  for (const entry of given.entries ?? []) lines.push(`### ${entry.at} [${entry.kind ?? "note"}]`, entry.text);
  lines.push("");
  return lines.join("\n");
}

const worklog = (...threads: ThreadSpec[]): string => threads.map(thread).join("\n");

const BASE: ThreadSpec = {
  id: "T1",
  stage: "planned",
  stamps: [{ stage: "planned", at: "2026-10-08T10:00:00.000Z", host: "host-a" }],
  entries: [{ at: "2026-10-08T10:01:00.000Z", text: "start" }],
};

test("worklog paths: worklog/<name>.md merges, the 00- index and other folders do not", () => {
  assert.equal(isWorklogPath("worklog/M1-alpha.md"), true);
  assert.equal(isWorklogPath("worklog/00-INDEX.md"), false);
  assert.equal(isWorklogPath("archive/worklog-raw/M1-alpha.md"), false);
  assert.equal(isMergeablePath("worklog/M1-alpha.md"), true);
  assert.equal(isMergeablePath("M1-alpha/01-a.md"), true);
  assert.equal(isMergeablePath(".session-claims.json"), true);
  assert.equal(isMergeablePath("M1-alpha/00-README.md"), false);
  assert.equal(isMergeablePath("notes.md"), false);
});

test("worklog merge: two hosts add different threads; the winner's come first, then the other's new ones", () => {
  const onA = worklog(BASE, { id: "T2", entries: [{ at: "2026-10-08T11:00:00.000Z", text: "from A" }] });
  const onB = worklog(BASE, { id: "T3", entries: [{ at: "2026-10-08T11:00:01.000Z", text: "from B" }] });
  assert.equal(dec(mergeWorklog(enc(onB), enc(onA))), worklog(BASE, { id: "T3", entries: [{ at: "2026-10-08T11:00:01.000Z", text: "from B" }] }, { id: "T2", entries: [{ at: "2026-10-08T11:00:00.000Z", text: "from A" }] }));
});

test("worklog merge: both hosts add notes to the same thread; a multi-line note stays one block", () => {
  const noteA = { at: "2026-10-08T11:00:00.000Z", text: "A line one\nA line two" };
  const noteB = { at: "2026-10-08T11:00:02.000Z", text: "B note" };
  const onA = worklog({ ...BASE, entries: [...(BASE.entries ?? []), noteA] });
  const onB = worklog({ ...BASE, entries: [...(BASE.entries ?? []), noteB] });
  assert.equal(dec(mergeWorklog(enc(onB), enc(onA))), worklog({ ...BASE, entries: [...(BASE.entries ?? []), noteB, noteA] }));
});

test("worklog merge: one host parks while the other adds a note; closed wins and both notes stay", () => {
  const park = { at: "2026-10-08T12:00:00.000Z", text: "Parked: waiting" };
  const note = { at: "2026-10-08T11:30:00.000Z", text: "more work" };
  const parked = worklog({ ...BASE, closed: "blocked", entries: [...(BASE.entries ?? []), park] });
  const noted = worklog({ ...BASE, entries: [...(BASE.entries ?? []), note] });
  const mergedOne = dec(mergeWorklog(enc(noted), enc(parked)));
  assert.match(mergedOne, /<!-- closed: .* status: blocked -->/u, "closed beats open, whichever side won");
  assert.match(mergedOne, /more work/u);
  assert.match(mergedOne, /Parked: waiting/u);
  assert.equal(dec(mergeWorklog(enc(parked), enc(noted))), worklog({ ...BASE, closed: "blocked", entries: [...(BASE.entries ?? []), park, note] }));
});

test("worklog merge: the stage is the furthest; stamps are the union in time order", () => {
  const verified = { stage: "verified", at: "2026-10-08T11:00:00.000Z", host: "host-a" };
  const dispatched = { stage: "dispatched", at: "2026-10-08T10:30:00.000Z", host: "host-b" };
  const onA = worklog({ ...BASE, stage: "verified", stamps: [...(BASE.stamps ?? []), verified] });
  const onB = worklog({ ...BASE, stage: "dispatched", stamps: [...(BASE.stamps ?? []), dispatched] });
  const want = worklog({ ...BASE, stage: "verified", stamps: [...(BASE.stamps ?? []), dispatched, verified] });
  assert.equal(dec(mergeWorklog(enc(onB), enc(onA))), want);
  assert.equal(dec(mergeWorklog(enc(onA), enc(onB))), want);
});

test("worklog merge: deterministic; merging the result again adds nothing; the other side subsumed gives the winner's bytes", () => {
  const onA = worklog(BASE, { id: "T2", entries: [{ at: "2026-10-08T11:00:00.000Z", text: "from A" }] });
  const onB = worklog({ ...BASE, entries: [...(BASE.entries ?? []), { at: "2026-10-08T11:00:02.000Z", text: "B" }] });
  const once = mergeWorklog(enc(onB), enc(onA));
  const twice = mergeWorklog(enc(onB), enc(onA));
  assert.ok(once !== null && twice !== null);
  assert.equal(sha256Hex(once), sha256Hex(twice));
  const again = mergeWorklog(once, enc(onA));
  assert.equal(again, once, "the winner's own bytes");
  assert.equal(mergeWorklog(once, enc(onB)), once);
});

test("worklog merge: a distilled stub or a changed preamble does not merge", () => {
  const stub = `<!-- distilled: 2026-10-08T00:00:00.000Z source-sha256: ${"a".repeat(64)} raw: archive/worklog-raw/M1-alpha.md -->\n# Anchor\n`;
  assert.equal(mergeWorklog(enc(stub), enc(worklog(BASE))), null);
  assert.equal(mergeWorklog(enc(worklog(BASE)), enc(stub)), null);
  assert.equal(dec(mergeWorklog(enc(stub), enc(stub))), stub);
  assert.equal(mergeWorklog(enc(`# Title A\n\n${worklog(BASE)}`), enc(`# Title B\n\n${worklog(BASE)}`)), null);
  assert.equal(mergeWorklog(enc("plain notes\n"), enc("other notes\n")), null, "a file with no thread is all preamble");
  assert.equal(mergeWorklog(new Uint8Array([0xff, 0xfe]), enc(worklog(BASE))), null, "not UTF-8");
});

test("worklog merge: an unmarked ## heading stays prose inside its thread, and freeform lines are joined", () => {
  const winner = worklog(BASE);
  const other = worklog(BASE).replace("### 2026-10-08T10:01:00.000Z [note]", "## Plain heading\nprose line\n### 2026-10-08T10:01:00.000Z [note]");
  const merged = dec(mergeWorklog(enc(winner), enc(other)));
  assert.match(merged, /## Plain heading\nprose line\n### 2026-10-08T10:01:00.000Z \[note\]/u);
});

// --- spec ticks -------------------------------------------------------------

function spec(boxes: string, fields: { updated?: string; passed?: string; verified?: boolean; status?: string; agent?: string } = {}): string {
  const front = ["---"];
  if (fields.status !== undefined) front.push(`status: ${fields.status}`);
  if (fields.verified === true) {
    const done = [...boxes].filter((box) => box === "x").length;
    front.push(`verified: ${String(done)}/${String(boxes.length)}`);
  }
  front.push(`updated: '${fields.updated ?? "2026-10-07"}'`, `agent: ${fields.agent ?? "test"}`);
  if (fields.passed !== undefined) front.push(`verification_passed: '${fields.passed}'`, "verification_method: executed");
  front.push("---", "", "# Spec", "", "## Verification Checklist", "");
  const items = [...boxes].map((box, index) => `- [${box}] item ${String(index)}\n  - Command: \`true\`\n  - Expected: \`exit 0\``);
  return `${[...front, ...items].join("\n")}\n`;
}

test("spec paths: M<n>-*/<NN>-*.md, not the README", () => {
  assert.equal(isSpecPath("M1-alpha/01-a.md"), true);
  assert.equal(isSpecPath("M12-x/10-b.md"), true);
  assert.equal(isSpecPath("M1-alpha/00-README.md"), false);
  assert.equal(isSpecPath("archive/M1-alpha.md"), false);
});

test("spec merge: disjoint ticks merge; verified, status, updated and verification_passed follow", () => {
  const onA = spec("x  ", { updated: "2026-10-08", passed: "2026-10-08T10:00:00.000Z", verified: true, status: "In Progress" });
  const onB = spec(" x ", { updated: "2026-10-08", passed: "2026-10-08T11:00:00.000Z", verified: true, status: "In Progress" });
  const want = spec("xx ", { updated: "2026-10-08", passed: "2026-10-08T11:00:00.000Z", verified: true, status: "In Progress" });
  assert.equal(dec(mergeSpecTicks(enc(onA), enc(onB))), want);
  assert.equal(dec(mergeSpecTicks(enc(onB), enc(onA))), want);
  const done = dec(mergeSpecTicks(enc(spec("xx ", { verified: true, status: "In Progress" })), enc(spec("  x", { verified: true, status: "In Progress" }))));
  assert.equal(done, spec("xxx", { verified: true, status: "Complete" }), "status derived from the merged items");
});

test("spec merge: the same item in different states takes the further one; [!] and [-] win over [ ] only", () => {
  const pick = (a: string, b: string): string => {
    const merged = mergeSpecTicks(enc(spec(a)), enc(spec(b)));
    return [...dec(merged).matchAll(/^- \[(.)\]/gmu)].map((match) => match[1]).join("");
  };
  assert.equal(pick("~", "x"), "x");
  assert.equal(pick("x", "~"), "x");
  assert.equal(pick(" ", "~"), "~");
  assert.equal(pick("!", " "), "!");
  assert.equal(pick(" ", "!"), "!");
  assert.equal(pick("!", "~"), "~");
  assert.equal(pick("x", "!"), "x");
  assert.equal(pick("-", " "), "-");
  assert.equal(pick("!", "-"), "!", "two decisions: the winner's");
  assert.equal(pick("-", "!"), "-");
});

test("spec merge: any other difference does not merge", () => {
  assert.equal(mergeSpecTicks(enc(spec("x ")), enc(spec(" x").replace("item 1", "item one"))), null, "text change");
  assert.equal(mergeSpecTicks(enc(spec("x ")), enc(spec("x  "))), null, "an added item");
  assert.equal(mergeSpecTicks(enc(spec("x ", { agent: "a" })), enc(spec(" x", { agent: "b" }))), null, "another frontmatter key");
  assert.equal(mergeSpecTicks(enc(spec("x ", { status: "Blocked" })), enc(spec(" x", { status: "In Progress" }))), null, "a status set by hand");
  const same = enc(spec("x "));
  assert.equal(mergeSpecTicks(same, enc(spec("x "))), same, "nothing new: the winner's bytes");
});

// --- claims -----------------------------------------------------------------

function claims(entries: Record<string, { session: string; at: string; expiresAt: string; host?: string }>, released: Record<string, { session: string; at: string; expiresAt: string }> = {}): string {
  const doc = Object.keys(released).length > 0 ? { version: 1, claims: entries, released } : { version: 1, claims: entries };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

test("claims merge: per spec the newer claim wins; both hosts' specs stay; host and old entries kept as written", () => {
  const a = { session: "sA", at: "2026-10-08T10:00:00.000Z", expiresAt: "2026-10-08T18:00:00.000Z", host: "host-a" };
  const b = { session: "sB", at: "2026-10-08T10:05:00.000Z", expiresAt: "2026-10-08T18:05:00.000Z", host: "host-b" };
  const old = { session: "sOld", at: "2026-10-08T09:00:00.000Z", expiresAt: "2026-10-08T17:00:00.000Z" };
  const onA = claims({ "x.md": a, "y.md": old });
  const onB = claims({ "x.md": b, "z.md": b });
  const want = claims({ "x.md": b, "y.md": old, "z.md": b });
  assert.equal(dec(mergeClaims(enc(onA), enc(onB))), want);
  assert.equal(dec(mergeClaims(enc(onB), enc(onA))), claims({ "x.md": b, "z.md": b, "y.md": old }));
});

test("claims merge: a release tombstone beats an older claim; expired entries drop out; a bad side counts as empty", () => {
  const claim = { session: "sA", at: "2026-10-08T10:00:00.000Z", expiresAt: "2026-10-08T18:00:00.000Z", host: "host-a" };
  const tomb = { session: "sA", at: "2026-10-08T11:00:00.000Z", expiresAt: "2026-10-08T18:00:00.000Z" };
  const expired = { session: "sX", at: "2026-10-07T01:00:00.000Z", expiresAt: "2026-10-07T09:00:00.000Z" };
  const released = claims({}, { "x.md": tomb });
  const holding = claims({ "x.md": claim, "old.md": expired });
  assert.equal(dec(mergeClaims(enc(holding), enc(released))), claims({}, { "x.md": tomb }));
  assert.equal(dec(mergeClaims(enc(released), enc(holding))), claims({}, { "x.md": tomb }));
  assert.equal(dec(mergeClaims(enc("{not json"), enc(holding))), claims({ "x.md": claim }));
});

// --- two hosts --------------------------------------------------------------

interface Host {
  name: string;
  state: string;
  config: string;
}

function makeHost(name: string): Host {
  const host: Host = { name, state: join(SANDBOX, name, "state"), config: join(SANDBOX, name, "config") };
  mkdirSync(host.state, { recursive: true });
  mkdirSync(host.config, { recursive: true });
  writeFileSync(join(host.config, "config.toml"), `host = "${name}"\n`);
  return host;
}

const hostA = makeHost("host-a");
const hostB = makeHost("host-b");
let projects = 0;

function projectOn(host: Host, name: string): Project {
  process.env.DARIUS_STATE_DIR = host.state;
  process.env.DARIUS_CONFIG_DIR = host.config;
  return openProject(name, { create: true });
}

function newProject(): string {
  projects += 1;
  return `merge-${String(projects)}`;
}

function put(host: Host, name: string, path: string, content: string): void {
  const file = join(treeDir(projectOn(host, name)), path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function read(host: Host, name: string, path: string): string {
  return readFileSync(join(treeDir(projectOn(host, name)), path), "utf8");
}

function ship(from: Host, to: Host, name: string): void {
  const sender = projectOn(from, name);
  closeOpenChunk(sender);
  const receiver = projectOn(to, name);
  const chunks = join(sender.root, "ledger", from.name);
  if (existsSync(chunks)) cpSync(chunks, join(receiver.root, "ledger", from.name), { recursive: true });
  cpSync(join(sender.root, "blobs"), join(receiver.root, "blobs"), { recursive: true });
}

/** One host syncs its tree and ships to the other. */
interface Round {
  merged: number;
  problems: string[];
}

function syncRound(host: Host, other: Host, name: string): Round {
  const { apply } = syncTree(projectOn(host, name));
  ship(host, other, name);
  return { merged: apply.merged, problems: apply.problems };
}

function conflictLines(host: Host, name: string): number {
  return readLedger(projectOn(host, name)).filter((line) => line.type === TREE_CONFLICT).length;
}

/** Both hosts write their versions; A captures first, so B's line is the later one and wins. */
function concurrent(name: string, path: string, onA: string, onB: string): void {
  put(hostA, name, path, onA);
  syncRound(hostA, hostB, name);
  sleepSync(5);
  put(hostB, name, path, onB);
  syncRound(hostB, hostA, name);
}

function seed(name: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) put(hostA, name, path, content);
  syncRound(hostA, hostB, name);
  syncRound(hostB, hostA, name);
}

test("two hosts: concurrent worklog threads, spec ticks and claims all merge; both hosts converge; no conflict line", () => {
  const name = newProject();
  const log = "worklog/M1-alpha.md";
  const specPath = "M1-alpha/01-a.md";
  seed(name, { [log]: worklog(BASE), [specPath]: spec("   ", { verified: true, status: "Not Started" }) });

  const claimA = { session: "sA", at: "2026-10-08T10:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", host: "host-a" };
  const claimB = { session: "sB", at: "2026-10-08T10:01:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", host: "host-b" };
  put(hostA, name, log, worklog(BASE, { id: "TA", entries: [{ at: "2026-10-08T11:00:00.000Z", text: "A" }] }));
  put(hostA, name, specPath, spec("x  ", { verified: true, status: "In Progress" }));
  put(hostA, name, ".session-claims.json", claims({ ".tracker/M1-alpha/01-a.md": claimA }));
  syncRound(hostA, hostB, name);
  sleepSync(5);
  put(hostB, name, log, worklog(BASE, { id: "TB", entries: [{ at: "2026-10-08T11:00:01.000Z", text: "B" }] }));
  put(hostB, name, specPath, spec("  x", { verified: true, status: "In Progress" }));
  put(hostB, name, ".session-claims.json", claims({ ".tracker/M1-alpha/02-b.md": claimB }));
  assert.equal(syncRound(hostB, hostA, name).merged, 0, "B's own lines are the later ones: nothing to merge on B");
  assert.equal(syncRound(hostA, hostB, name).merged, 3, "A merges its versions into B's winners");
  assert.equal(syncRound(hostB, hostA, name).merged, 0, "the merged lines were written on top of B's");
  syncRound(hostA, hostB, name);

  for (const host of [hostA, hostB]) {
    const text = read(host, name, log);
    assert.match(text, /## TA — TA/u);
    assert.match(text, /## TB — TB/u);
    assert.equal(read(host, name, specPath), spec("x x", { verified: true, status: "In Progress" }));
    const doc = JSON.parse(read(host, name, ".session-claims.json"));
    assert.deepEqual(Object.keys(doc.claims).toSorted(), [".tracker/M1-alpha/01-a.md", ".tracker/M1-alpha/02-b.md"]);
    assert.equal(doc.claims[".tracker/M1-alpha/02-b.md"].host, "host-b");
  }
  assert.equal(read(hostA, name, log), read(hostB, name, log));
  assert.equal(conflictLines(hostA, name) + conflictLines(hostB, name), 0, "a conflict a merge resolved is not recorded");
  const lines = readLedger(projectOn(hostA, name)).length;
  for (let round = 0; round < 2; round += 1) {
    assert.equal(syncRound(hostA, hostB, name).merged, 0);
    assert.equal(syncRound(hostB, hostA, name).merged, 0);
  }
  assert.equal(readLedger(projectOn(hostA, name)).length, lines, "no ping-pong once both hosts agree");
});

test("two hosts: a host that captured twice before it synced still meets the other host's version, which merges", () => {
  const name = newProject();
  const log = "worklog/M1-alpha.md";
  seed(name, { [log]: worklog(BASE) });
  put(hostB, name, log, worklog(BASE, { id: "TB" }));
  syncTree(projectOn(hostB, name));
  sleepSync(5);
  put(hostA, name, log, worklog(BASE, { id: "TA1" }));
  syncTree(projectOn(hostA, name));
  put(hostA, name, log, worklog(BASE, { id: "TA1" }, { id: "TA2" }));
  syncRound(hostA, hostB, name);
  ship(hostB, hostA, name);
  assert.equal(syncRound(hostB, hostA, name).merged, 1, "B meets A's run of two lines and merges its own version in");
  syncRound(hostA, hostB, name);
  for (const host of [hostA, hostB]) assert.equal(read(host, name, log), worklog(BASE, { id: "TA1" }, { id: "TA2" }, { id: "TB" }));
  assert.equal(conflictLines(hostA, name) + conflictLines(hostB, name), 0);
});

test("two hosts: a spec text change on one side keeps last-writer-wins and records one tree.conflict line", () => {
  const name = newProject();
  const specPath = "M1-alpha/01-a.md";
  seed(name, { [specPath]: spec("  ") });
  const lostText = spec("x ").replace("item 1", "item one");
  concurrent(name, specPath, lostText, spec(" x"));
  assert.equal(read(hostB, name, specPath), spec(" x"), "B's line is the later one");
  const onA = syncRound(hostA, hostB, name);
  assert.equal(onA.merged, 0);
  assert.equal(read(hostA, name, specPath), spec(" x"));
  assert.match(onA.problems.join("\n"), /concurrent edit of M1-alpha\/01-a\.md: kept the version of host-b/u);
  assert.equal(conflictLines(hostA, name), 1);
  syncRound(hostB, hostA, name);
  syncRound(hostA, hostB, name);
  assert.equal(conflictLines(hostA, name), 1, "recorded once");
  assert.equal(conflictLines(hostB, name), 1, "the line syncs");

  const open = readTreeConflicts(readLedger(projectOn(hostB, name))).open;
  assert.equal(open.length, 1);
  const [conflict] = open;
  assert.ok(conflict !== undefined);
  assert.equal(conflict.path, specPath);
  assert.equal(conflict.loserSha, sha256Hex(lostText));
  assert.equal(conflict.winnerSha, sha256Hex(spec(" x")));
  assert.deepEqual([conflict.winnerHost, conflict.loserHost], ["host-b", "host-a"]);
  assert.equal(conflictAdvice(conflict)[1], `  get it back (replaces the current file): darius tree restore ${specPath} --at ${sha256Hex(lostText)} --force`);
});

test("tree conflicts close on a restore of the lost blob, a removal, or tree.resolved; each pair counts once", () => {
  const name = newProject();
  const project = projectOn(hostA, name);
  const loser = "a".repeat(64);
  const winner = "b".repeat(64);
  const conflict = { who: "t", type: TREE_CONFLICT, path: "M1-x/01-a.md", winner_sha: winner, loser_sha: loser, winner_host: "h2", loser_host: "h1" };
  // The lines name blob shas; readTreeConflicts reads only the ledger, so no blobs are needed here.
  appendLines(project, [conflict, conflict, { ...conflict, path: "M1-x/02-b.md" }, { ...conflict, path: "M1-x/03-c.md" }]);
  let state = readTreeConflicts(readLedger(project));
  assert.equal(state.open.length, 3);
  appendLines(project, [{ who: "t", type: "tree.put", path: "M1-x/01-a.md", body_sha: winner, size: 1, prev_sha: null }]);
  assert.equal(readTreeConflicts(readLedger(project)).open.length, 3, "another put keeps it open");
  appendLines(project, [{ who: "t", type: "tree.put", path: "M1-x/01-a.md", body_sha: loser, size: 1, prev_sha: winner }]);
  appendLines(project, [{ who: "t", type: "tree.removed", path: "M1-x/02-b.md", prev_sha: winner }]);
  state = readTreeConflicts(readLedger(project));
  assert.deepEqual(state.open.map((one) => one.path), ["M1-x/03-c.md"]);
  appendLines(project, [{ who: "t", type: TREE_RESOLVED, path: "M1-x/03-c.md" }]);
  state = readTreeConflicts(readLedger(project));
  assert.equal(state.open.length, 0);
  assert.equal(state.all.size, 3);
});
