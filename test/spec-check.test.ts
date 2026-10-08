/**
 * `darius spec check` (0.74.0): the item rules, depends_on, the risk patterns,
 * the frontmatter raise (never a lower), the rollback rule, the JSON shape and
 * the exit codes, and the `review_gate:` config mapping. The CLI cases run
 * under both runtimes.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkSpecText, loadSpecGrammar, parseReviewGate, RISK_PATTERNS, type SpecCheckResult } from "../src/core/spec-check.ts";

const BIN = join(import.meta.dirname, "..", "bin", "darius");
const RUNTIMES = ["node", "bun"] as const;
const grammar = await loadSpecGrammar();

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function cli(argv: string[], cwd: string, runtime: string): CliResult {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: join(cwd, ".home"), DARIUS_RUNTIME: runtime };
  const r = spawnSync(BIN, argv, { encoding: "utf8", env, cwd, timeout: 20_000 });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** A checkout with `.tracker/M1-t/` and an optional config. Returns the root. */
function checkout(config?: string): string {
  const root = mkdtempSync(join(tmpdir(), "darius-spec-check-"));
  mkdirSync(join(root, ".tracker", "M1-t"), { recursive: true });
  if (config !== undefined) writeFileSync(join(root, ".tracker", "config.yml"), config);
  return root;
}

const GOOD_ITEM = "- [ ] builds\n  - Command: `test -d src`\n  - Expected: `exit 0`\n";

function spec(body: string, frontmatter = "name: T"): string {
  return `---\n${frontmatter}\n---\n# T\n\n${body}`;
}

function check(text: string, root = checkout()): SpecCheckResult {
  const path = join(root, ".tracker", "M1-t", "01-t.md");
  writeFileSync(path, text);
  return checkSpecText(text, path, join(root, ".tracker"), grammar, "auto");
}

// --- items ---------------------------------------------------------------------

test("a plain low-risk spec with a valid item passes", () => {
  const result = check(spec(GOOD_ITEM));
  assert.equal(result.ok, true, result.problems.join("; "));
  assert.equal(result.risk, "low");
  assert.deepEqual(result.riskReasons, []);
  assert.equal(result.reviewRequired, false);
});

test("an item without a Command fails", () => {
  const result = check(spec("- [ ] no command here\n"));
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /item 0 .*no Command/u);
});

test("an Expected outside the grammar fails", () => {
  const result = check(spec("- [ ] bad\n  - Command: `test -d src`\n  - Expected: `exits zero`\n"));
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /grammar error: unknown expectation form/u);
});

test("a manual item needs a Manual: reason line", () => {
  const manual = "- [ ] decide\n  - Command: `echo ask the owner`\n  - Expected: `manual (owner: ops, expires: 2027-01-01)`\n";
  const without = check(spec(manual));
  assert.equal(without.ok, false);
  assert.match(without.problems.join("\n"), /Manual: <reason>/u);
  const withReason = check(spec(`${manual}  - Manual: only the owner can sign off the wording\n`));
  assert.equal(withReason.ok, true, withReason.problems.join("; "));
  const noOp = check(spec("- [ ] look\n  - Command: `echo look at it`\n  - Expected: `exit 0`\n"));
  assert.match(noOp.problems.join("\n"), /Manual: <reason>/u);
});

test("a spec with no checklist items fails", () => {
  assert.match(check(spec("Nothing to check.\n")).problems.join("\n"), /no checklist items/u);
});

test("depends_on targets must exist", () => {
  const root = checkout();
  writeFileSync(join(root, ".tracker", "M1-t", "00-base.md"), spec(GOOD_ITEM));
  const fine = check(spec(GOOD_ITEM, "name: T\ndepends_on:\n  - 00-base.md\n  - M1-t/00-base.md\n  - .tracker/M1-t/00-base.md"), root);
  assert.equal(fine.ok, true, fine.problems.join("; "));
  const missing = check(spec(GOOD_ITEM, "name: T\ndepends_on:\n  - M1-t/09-gone.md"), root);
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.problems, ["depends_on: M1-t/09-gone.md does not exist"]);
});

// --- risk ----------------------------------------------------------------------

const ROLLBACK = "\n## Rollback\n\nRevert the commit.\n";

const RISK_SAMPLES = {
  "rm-rf": "Clean with rm -rf build/ first.",
  "git-push-force": "Then git push --force origin topic.",
  "git-reset-hard": "Run git reset --hard HEAD~1.",
  "sql-drop": "DROP TABLE sessions;",
  "sql-delete": "delete from users where id = 1",
  "sql-truncate": "TRUNCATE events;",
  migration: "Add a migration for the new column.",
  "curl-write": "curl -X POST https://api.example.com/items",
  deploy: "Deploy the worker.",
  publish: "Publish the package.",
  "git-push": "git push origin main",
  auth: "Change the OAuth login flow.",
  token: "Rotate the API key.",
  credential: "Read the credentials file.",
  secret: "Store the secret in the vault.",
  permission: "Run chmod on the key file.",
} satisfies Record<string, string>;

test("every risk pattern has a sample, and each sample makes the spec high risk", () => {
  assert.deepEqual(Object.keys(RISK_SAMPLES).toSorted(), RISK_PATTERNS.map((p) => p.id).toSorted());
  for (const [id, line] of Object.entries(RISK_SAMPLES)) {
    const result = check(spec(`${line}\n\n${GOOD_ITEM}${ROLLBACK}`));
    assert.equal(result.risk, "high", id);
    const reason = result.riskReasons.find((r) => r.pattern === id);
    assert.ok(reason !== undefined, `${id} not named: ${JSON.stringify(result.riskReasons)}`);
    assert.equal(reason.line, 6, id);
    assert.equal(reason.text, line);
    assert.equal(result.ok, true, `${id}: ${result.problems.join("; ")}`);
  }
});

test("each risk class is covered", () => {
  assert.deepEqual([...new Set(RISK_PATTERNS.map((p) => p.class))].toSorted(), ["auth", "data", "destructive", "external-write"]);
});

test("a risky Command line counts, not only prose", () => {
  const result = check(spec(`- [ ] cleaned\n  - Command: \`rm -rf dist && test ! -d dist\`\n  - Expected: \`exit 0\`\n${ROLLBACK}`));
  assert.equal(result.risk, "high");
  assert.equal(result.riskReasons[0]?.pattern, "rm-rf");
  assert.equal(result.riskReasons[0]?.line, 7);
});

test("frontmatter risk: high raises a low spec", () => {
  const result = check(spec(`${GOOD_ITEM}${ROLLBACK}`, "name: T\nrisk: high"));
  assert.equal(result.risk, "high");
  assert.deepEqual(result.riskReasons, [{ pattern: "frontmatter", class: "frontmatter", line: 3, text: "risk: high" }]);
  assert.equal(result.reviewRequired, true);
});

test("frontmatter risk: low cannot lower a derived high", () => {
  const result = check(spec(`git push origin main\n\n${GOOD_ITEM}${ROLLBACK}`, "name: T\nrisk: low"));
  assert.equal(result.risk, "high");
  assert.equal(result.reviewRequired, true);
});

test("an unknown risk value is a problem", () => {
  assert.match(check(spec(GOOD_ITEM, "name: T\nrisk: medium")).problems.join("\n"), /risk: medium is not low or high/u);
});

test("a high-risk spec without a Rollback section fails, with one it passes", () => {
  const without = check(spec(`Deploy it.\n\n${GOOD_ITEM}`));
  assert.equal(without.ok, false);
  assert.match(without.problems.join("\n"), /no ## Rollback section/u);
  const empty = check(spec(`Deploy it.\n\n${GOOD_ITEM}\n## Rollback\n\n<!-- todo -->\n\n## Notes\n\nx\n`));
  assert.equal(empty.ok, false);
  const withRollback = check(spec(`Deploy it.\n\n${GOOD_ITEM}${ROLLBACK}`));
  assert.equal(withRollback.ok, true, withRollback.problems.join("; "));
});

// --- config --------------------------------------------------------------------

test("review_gate config: auto by default, old counsel_gate keys read as auto, off only when said", () => {
  assert.equal(parseReviewGate(null).gate, "auto");
  assert.equal(parseReviewGate("counsel_threshold: 2\n").gate, "auto");
  assert.equal(parseReviewGate("counsel_gate: on\n").gate, "auto");
  assert.equal(parseReviewGate("counsel_gate: off\n").gate, "auto");
  assert.equal(parseReviewGate("review_gate: off\n").gate, "off");
  assert.equal(parseReviewGate("counsel_gate: on\nreview_gate: off\n").gate, "off");
  assert.equal(parseReviewGate("review_gate: auto\n").gate, "auto");
  const odd = parseReviewGate("review_gate: maybe\n");
  assert.equal(odd.gate, "auto");
  assert.match(odd.warning ?? "", /not auto or off/u);
});

// --- CLI -----------------------------------------------------------------------

test("spec check exit codes and JSON shape, under both runtimes", () => {
  for (const runtime of RUNTIMES) {
    const root = checkout("review_gate: off\n");
    writeFileSync(join(root, ".tracker", "M1-t", "01-ok.md"), spec(GOOD_ITEM, "name: T\ncounsel: 2026-10-08T00:00:00Z"));
    writeFileSync(join(root, ".tracker", "M1-t", "02-bad.md"), spec("Deploy it.\n\n- [ ] x\n"));

    const ok = cli(["spec", "check", ".tracker/M1-t/01-ok.md", "--json"], root, runtime);
    assert.equal(ok.code, 0, `${runtime}: ${ok.stderr}`);
    const okJson = JSON.parse(ok.stdout);
    assert.deepEqual(Object.keys(okJson).toSorted(), ["counsel", "ok", "problems", "reviewGate", "reviewRequired", "risk", "riskReasons"]);
    assert.equal(okJson.ok, true);
    assert.equal(okJson.risk, "low");
    assert.equal(okJson.reviewGate, "off");
    assert.equal(okJson.counsel, "2026-10-08T00:00:00Z");

    const bad = cli(["spec", "check", ".tracker/M1-t/02-bad.md", "--json"], root, runtime);
    assert.equal(bad.code, 1, runtime);
    const badJson = JSON.parse(bad.stdout);
    assert.equal(badJson.ok, false);
    assert.equal(badJson.risk, "high");
    assert.equal(badJson.reviewRequired, false, "review_gate: off skips the reviewer");
    assert.equal(badJson.riskReasons[0].pattern, "deploy");
    assert.ok(badJson.problems.length >= 2);

    const text = cli(["spec", "check", ".tracker/M1-t/02-bad.md"], root, runtime);
    assert.equal(text.code, 1);
    assert.match(text.stdout, /^FAIL /u);
    assert.match(text.stdout, /deploy \(external-write\) line 6: Deploy it\./u);

    assert.equal(cli(["spec", "check"], root, runtime).code, 2);
    assert.equal(cli(["spec"], root, runtime).code, 2);
    const missing = cli(["spec", "check", ".tracker/M1-t/09-none.md"], root, runtime);
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /no spec at/u);
  }
});

// --- counsel-gate --------------------------------------------------------------

function reviewTranscript(verdicts: Record<string, string>): string {
  const items = Object.fromEntries(Object.entries(verdicts).map(([name, verdict]) => [name, { verdict, reason: `${name} looked at` }]));
  return `---\nmodel: opus\n---\n# Review\n\n\`\`\`darius-review\n${JSON.stringify({ reviewer: "opus", items })}\n\`\`\`\n`;
}

const ALL_OK = { "data-loss": "ok", irreversible: "ok", "hidden-scope": "ok", "missing-test": "ok", rollback: "ok" };

function gate(root: string, transcript: string, runtime: string, extra: string[] = []): CliResult {
  const path = join(root, ".tracker", "M1-t", "_counsel", "01-t.md");
  mkdirSync(join(root, ".tracker", "M1-t", "_counsel"), { recursive: true });
  writeFileSync(path, transcript);
  return cli(["counsel-gate", path, "--spec", ".tracker/M1-t/01-t.md", "--json", ...extra], root, runtime);
}

test("counsel-gate reads the review block: ready, needs_ack, blocked, ack, stamps, under both runtimes", () => {
  for (const runtime of RUNTIMES) {
    const root = checkout();
    const specPath = join(root, ".tracker", "M1-t", "01-t.md");
    writeFileSync(specPath, spec(GOOD_ITEM));

    const ready = gate(root, reviewTranscript(ALL_OK), runtime);
    assert.equal(ready.code, 0, `${runtime}: ${ready.stderr}`);
    const readyJson = JSON.parse(ready.stdout);
    assert.equal(readyJson.status, "ready");
    assert.equal(readyJson.format, "review");
    assert.equal(readyJson.reviewer, "opus");
    assert.equal(readyJson.thumbsUp, 5);
    for (const key of ["status", "reason", "thumbsDown", "thumbsSideways", "thumbsUp", "threshold", "rounds", "maxRounds"]) assert.ok(key in readyJson, key);
    assert.match(readFileSync(specPath, "utf8"), /^counsel: "?\d{4}-\d\d-\d\dT/mu);
    assert.match(readFileSync(specPath, "utf8"), /^counsel_rounds: 1$/mu);

    writeFileSync(specPath, spec(GOOD_ITEM));
    const concern = gate(root, reviewTranscript({ ...ALL_OK, "missing-test": "concern" }), runtime);
    assert.equal(concern.code, 0);
    const concernJson = JSON.parse(concern.stdout);
    assert.equal(concernJson.status, "needs_ack");
    assert.match(concernJson.dissentSummary, /missing-test: missing-test looked at/u);
    assert.doesNotMatch(readFileSync(specPath, "utf8"), /^counsel:/mu, "needs_ack leaves the spec unstamped");
    const acked = gate(root, reviewTranscript({ ...ALL_OK, "missing-test": "concern" }), runtime, ["--ack-dissent"]);
    assert.equal(JSON.parse(acked.stdout).status, "ready");

    writeFileSync(specPath, spec(GOOD_ITEM));
    const blocked = gate(root, reviewTranscript({ ...ALL_OK, "data-loss": "blocker", rollback: "concern" }), runtime);
    const blockedJson = JSON.parse(blocked.stdout);
    assert.equal(blockedJson.status, "blocked");
    assert.equal(blockedJson.thumbsDown, 1);
    assert.match(blockedJson.blockingSummary, /^data-loss: /u);
    assert.match(readFileSync(specPath, "utf8"), /^counsel: rejected$/mu);
    const ackBlocked = gate(root, reviewTranscript({ ...ALL_OK, "data-loss": "blocker" }), runtime, ["--ack-dissent"]);
    assert.notEqual(JSON.parse(ackBlocked.stdout).status, "ready", "an ack never clears a blocker");
  }
});

test("counsel-gate round budget turns a second blocked review into counsel_exhausted", () => {
  const root = checkout();
  writeFileSync(join(root, ".tracker", "M1-t", "01-t.md"), spec(GOOD_ITEM));
  const blocker = reviewTranscript({ ...ALL_OK, irreversible: "blocker" });
  assert.equal(JSON.parse(gate(root, blocker, "bun").stdout).status, "blocked");
  assert.equal(JSON.parse(gate(root, blocker, "bun").stdout).status, "counsel_exhausted");
});

test("counsel-gate exits 2 on a missing item, an unknown item, a bad verdict or bad JSON, under both runtimes", () => {
  for (const runtime of RUNTIMES) {
    const root = checkout();
    writeFileSync(join(root, ".tracker", "M1-t", "01-t.md"), spec(GOOD_ITEM));
    const { rollback: _dropped, ...missingRollback } = ALL_OK;
    const missing = gate(root, reviewTranscript(missingRollback), runtime);
    assert.equal(missing.code, 2, runtime);
    assert.match(missing.stderr, /review item "rollback" is missing/u);
    const unknown = gate(root, reviewTranscript({ ...ALL_OK, style: "ok" }), runtime);
    assert.equal(unknown.code, 2);
    assert.match(unknown.stderr, /unknown review item/u);
    const verdict = gate(root, reviewTranscript({ ...ALL_OK, rollback: "maybe" }), runtime);
    assert.equal(verdict.code, 2);
    assert.match(verdict.stderr, /verdict must be ok, concern or blocker/u);
    const json = gate(root, "```darius-review\n{\"reviewer\": \"opus\", items: }\n```\n", runtime);
    assert.equal(json.code, 2);
    assert.match(json.stderr, /not valid JSON/u);
  }
});

function advisor(n: number, persona: string, verdict: string): string {
  return `\n## Advisor ${n} — ${persona}\n\n**Verdict**: thumbs_${verdict}\n\n**Assessment**: ${persona} view\n`;
}

test("counsel-gate still reads a four-advisor transcript as before, under both runtimes", () => {
  const transcript = `# Counsel\n\n## Brief\n\nx\n${advisor(1, "Senior Developer", "up")}${advisor(2, "Architect", "down")}${advisor(3, "Skeptic", "down")}${advisor(4, "End User", "sideways")}`;
  for (const runtime of RUNTIMES) {
    const root = checkout();
    writeFileSync(join(root, ".tracker", "M1-t", "01-t.md"), spec(GOOD_ITEM));
    const result = gate(root, transcript, runtime);
    assert.equal(result.code, 0, `${runtime}: ${result.stderr}`);
    const json = JSON.parse(result.stdout);
    assert.equal(json.status, "blocked");
    assert.equal(json.format, "counsel");
    assert.equal(json.thumbsDown, 2);
    assert.equal(json.thumbsUp, 1);
    assert.equal(json.thumbsSideways, 1);
    assert.equal(json.threshold, 2);
    assert.equal(json.rounds, 1);
    assert.match(json.blockingSummary, /Architect: Architect view \| Skeptic: Skeptic view/u);
  }
});

test("everyday words do not raise the risk", () => {
  for (const line of [
    "Credit the author in the header.",
    "Count the tokens of each prompt.",
    "Ask the operator for permission before the next step.",
    "The authored date stays as it is.",
  ]) {
    const result = check(spec(`${line}\n\n${GOOD_ITEM}`));
    assert.equal(result.risk, "low", `${line}: ${JSON.stringify(result.riskReasons)}`);
  }
});
