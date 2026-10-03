/**
 * A project with ritual runs and findings lines for the findings tests
 * (test/finding-index.test.ts, test/finding-cli.test.ts). The test file sets
 * the sandbox dirs before it calls this.
 */

import { appendLine, readLedger, type LedgerLineInput } from "../../src/core/ledger.ts";
import { collectFindings, type Finding } from "../../src/core/finding-index.ts";
import type { ItemState, Severity } from "../../src/core/result.ts";
import { openProject, putBlob, type Project } from "../../src/core/store.ts";
import assert from "node:assert/strict";

export interface Item {
  key?: string;
  title?: string;
  severity?: Severity;
  state?: ItemState;
  group?: string;
  target?: string;
  detail?: string;
}

/** A project whose clock starts on 2026-10-01 and moves one hour per line, so ledger order is time order. */
export class Seeder {
  readonly project: Project;
  private hour = 0;
  private runs = 0;

  constructor(name: string) {
    this.project = openProject(name, { create: true });
  }

  private at(): string {
    this.hour += 1;
    return new Date(Date.UTC(2026, 9, 1, this.hour)).toISOString();
  }

  /** One finished run of `ritual` with a result; returns the run id. */
  run(ritual: string, items: Item[], opts: { outcome?: string; followUpOf?: string; raw?: string } = {}): string {
    this.runs += 1;
    const run = `RUN${String(this.runs).padStart(3, "0")}`;
    const item = `ritual/${ritual}`;
    const started: LedgerLineInput = {
      who: "t",
      type: "run.started",
      item,
      run,
      at: this.at(),
    };
    if (opts.followUpOf !== undefined) started.follow_up_of = opts.followUpOf;
    appendLine(this.project, started);
    const body = opts.raw ?? JSON.stringify({ v: 1, status: "ok", summary: "s", items: items.map(fill) });
    appendLine(this.project, {
      who: "t",
      type: "run.completed",
      item,
      run,
      outcome: opts.outcome ?? "complete",
      findings_sha: null,
      result_sha: putBlob(this.project, `${body}\n`),
      at: this.at(),
    });
    return run;
  }

  close(ritual: string, key: string, note?: string): void {
    const line: LedgerLineInput = { who: "op", type: "finding.closed", item: `ritual/${ritual}`, key, at: this.at() };
    if (note !== undefined) line.note = note;
    appendLine(this.project, line);
  }

  /** A `finding.reset` line (0.66.0): for one ritual, or for all without one. */
  reset(ritual?: string): void {
    const line: LedgerLineInput = { who: "op", type: "finding.reset", at: this.at() };
    if (ritual !== undefined) line.item = `ritual/${ritual}`;
    appendLine(this.project, line);
  }

  /** The next instant of the seeder's clock, for a line the test writes itself. */
  tick(): string {
    return this.at();
  }

  reopen(ritual: string, key: string): void {
    appendLine(this.project, { who: "op", type: "finding.reopened", item: `ritual/${ritual}`, key, at: this.at() });
  }

  findings(): Finding[] {
    return collectFindings(this.project, readLedger(this.project));
  }

  find(ritual: string, key: string): Finding {
    const found = this.findings().find((finding) => finding.ritual === ritual && finding.key === key);
    assert.ok(found !== undefined, `no finding ${ritual}/${key}`);
    return found;
  }
}

function fill(item: Item): Item & { title: string; severity: Severity; state: ItemState } {
  return { title: "Broken link", severity: "medium", state: "open", ...item };
}
