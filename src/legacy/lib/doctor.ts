/**
 * tracker doctor — health check for the tracker directory.
 *
 * Validates:
 * 1. Schema: every spec, milestone README parses cleanly through Zod
 * 2. Dangling depends_on: every referenced spec exists
 * 3. Orphan specs: every spec is reachable from the milestone folder
 * 4. Missing index entries: index has a row for every milestone
 * 5. Unrunnable armed vigils: an armed vigil with no executable `Command:`
 *
 * Warn-only checks (never change the exit code):
 * - agent-not-in-roster: spec's `agent:` is not a live agent
 * - ground-truth-unfilled: the `## Ground Truth` placeholder is untouched
 * - verified-not-executed: a `[x]` with a shell no-op Command and no entry in
 *   `.verification-log.jsonl` — claimed, not executed
 * - session-claim: outstanding advisory session claims (fresh and stale, with ages)
 * - vigil-premise-unshipped: an armed vigil guarding a spec at 0 verified items
 *   whose milestone README records no deploy
 * - vigil-heavy-command: an armed vigil whose Command(s) look heavy enough that
 *   the daily `fc vigil-sweep` skips them unless run with `--include-heavy`
 *
 * With --fix:
 * - Strips derived fields (status, verified) from spec frontmatter
 * - Regenerates the index, which also stamps schema_version
 *
 * Without --fix doctor writes nothing (darius 0.66.0 carve-out). It used to
 * stamp an unstamped index on its own; now it warns that the index needs a
 * rebuild with --fix.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import {
  parseFrontmatter,
  serializeFrontmatter,
  findInlineSequences,
  rewriteInlineSequences,
  FrontmatterParseError,
} from "./markdown/frontmatter.ts";
import {
  parseSpec,
  SpecInputSchema,
  GROUND_TRUTH_PLACEHOLDER,
} from "./documents/spec.ts";
import { MilestoneInputSchema } from "./documents/milestone.ts";
import { parseChecklist } from "./markdown/checklist.ts";
import { isTrivialCommand } from "./verification/runner.ts";
import { findUnrunnableCommandShapes } from "./tracker-writer.ts";
import {
  isHeavyCommand,
  isPremiseUnshipped,
  isUnrunnable,
  readAllVigilHealth,
} from "./vigil-health.ts";
import {
  ledgerKey,
  ledgerKeys,
  toLedgerSpecPath,
  LEDGER_FILENAME,
} from "./verification/ledger.ts";
import {
  readClaims,
  listClaims,
  formatClaimLine,
  CLAIMS_FILENAME,
} from "./session-claims.ts";
import { atomicWriteFileSync } from "./atomic.ts";
import { scanWorklogDir, stageIntegrityProblems } from "./worklog.ts";
import { rebuildIndex } from "./tracker-writer.ts";
import { CURRENT_SCHEMA_VERSION } from "./version.ts";
import { discoverAgents } from "./agent-discovery.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DoctorFinding = {
  kind:
    | "inline-sequence"
    | "schema-error"
    | "dangling-dep"
    | "orphan-spec"
    | "missing-index-entry"
    | "version_drift"
    | "agent-not-in-roster"
    | "ground-truth-unfilled"
    | "verified-not-executed"
    | "session-claim"
    | "worklog-stage-unstamped"
    | "vigil-unrunnable"
    | "vigil-command-shape"
    | "vigil-premise-unshipped"
    | "vigil-heavy-command";
  file: string;
  detail: string;
  /** If true, this finding is a warning only — doctor still exits healthy. */
  warnOnly?: boolean;
};

export type DoctorReport = {
  findings: DoctorFinding[];
  /** Warn-only findings (agent-not-in-roster, etc.) — do not fail healthcheck. */
  warnings: DoctorFinding[];
  /** Whether all findings were resolved (by --fix or already healthy) */
  healthy: boolean;
};

// ---------------------------------------------------------------------------
// Main doctor function
// ---------------------------------------------------------------------------

export function runDoctor(opts: {
  trackerRoot: string;
  fix?: boolean;
}): DoctorReport {
  const { trackerRoot, fix = false } = opts;
  const findings: DoctorFinding[] = [];

  // Collect all milestone folders
  const milestoneFolders = getMilestoneFolders(trackerRoot);

  // Collect all spec absolute paths (for cross-reference)
  const allSpecPaths = new Set<string>();
  const allSpecRelPaths = new Set<string>();

  for (const folder of milestoneFolders) {
    const specs = getSpecFiles(folder);
    for (const spec of specs) {
      allSpecPaths.add(spec);
      // Register relative paths from repo root (parent of .tracker)
      const repoRoot = join(trackerRoot, "..");
      const rel = spec.replace(repoRoot + "/", "").replace(repoRoot + "\\", "");
      allSpecRelPaths.add(rel);
      allSpecRelPaths.add(basename(spec));
    }
  }

  // 0. Inline sequence syntax — `key: [a, b]` is the one YAML shape the
  // strict frontmatter parser rejects outright (block form only), and it's
  // the single most likely way a hand-written `depends_on:` breaks: the
  // parser throws, and — before this check existed — that throw either
  // surfaced as an opaque generic schema-error or (in the dangling-dep and
  // agent-roster passes below) crashed `tracker doctor` entirely. Detect it
  // explicitly, with a rewrite `--fix` can apply automatically, and track
  // which files it covers so the generic schema-error pass below doesn't
  // also report the exact same root cause a second time.
  const inlineSequenceFiles = new Set<string>();
  for (const folder of milestoneFolders) {
    const filesToScan = [join(folder, "00-README.md"), ...getSpecFiles(folder)].filter(
      existsSync,
    );

    for (const filePath of filesToScan) {
      const raw = readFileSync(filePath, "utf-8");
      const issues = findInlineSequences(raw);
      if (issues.length === 0) continue;

      if (fix) {
        const { raw: rewritten } = rewriteInlineSequences(raw);
        atomicWriteFileSync(filePath, rewritten);
        continue;
      }

      inlineSequenceFiles.add(filePath);
      for (const issue of issues) {
        const blockForm = issue.items.map((item) => `      - ${item}`).join("\n");
        findings.push({
          kind: "inline-sequence",
          file: filePath,
          detail:
            `${issue.key}: ${issue.raw} (line ${issue.line}) uses inline sequence syntax — ` +
            `the tracker's YAML parser only supports block form. Rewrite as:\n` +
            `    ${issue.key}:\n${blockForm}`,
        });
      }
    }
  }

  // 1. Schema validation
  for (const folder of milestoneFolders) {
    // Validate milestone README
    const readmePath = join(folder, "00-README.md");
    if (existsSync(readmePath)) {
      const raw = readFileSync(readmePath, "utf-8");
      try {
        const { data } = parseFrontmatter(raw);
        const result = MilestoneInputSchema.safeParse(data);
        if (!result.success) {
          findings.push({
            kind: "schema-error",
            file: readmePath,
            detail: `milestone README schema error: ${result.error.message}`,
          });
        }
      } catch (err) {
        if (!(err instanceof FrontmatterParseError && inlineSequenceFiles.has(readmePath))) {
          const message = err instanceof Error ? err.message : String(err);
          findings.push({
            kind: "schema-error",
            file: readmePath,
            detail: `milestone README schema error: ${message}`,
          });
        }
      }
    }

    // Validate each spec
    const specs = getSpecFiles(folder);
    for (const specPath of specs) {
      const raw = readFileSync(specPath, "utf-8");

      // If --fix, always strip derived fields regardless of whether parse errors
      if (fix) {
        try {
          const fixed = stripDerivedFields(raw);
          atomicWriteFileSync(specPath, fixed);
          parseSpec(fixed, specPath); // Verify fix worked
        } catch (fixErr) {
          const fixMessage = fixErr instanceof Error ? fixErr.message : String(fixErr);
          findings.push({
            kind: "schema-error",
            file: specPath,
            detail: `schema error (unfixable): ${fixMessage}`,
          });
        }
      } else {
        try {
          // parseSpec throws on schema errors
          parseSpec(raw, specPath);
        } catch (err) {
          if (err instanceof FrontmatterParseError && inlineSequenceFiles.has(specPath)) {
            // Already reported precisely by the inline-sequence check above.
            continue;
          }
          const message = err instanceof Error ? err.message : String(err);
          findings.push({
            kind: "schema-error",
            file: specPath,
            detail: `schema error: ${message}`,
          });
        }
      }
    }
  }

  // 2. Dangling depends_on
  for (const folder of milestoneFolders) {
    const specs = getSpecFiles(folder);
    for (const specPath of specs) {
      const raw = readFileSync(specPath, "utf-8");

      let data: Record<string, unknown>;
      try {
        ({ data } = parseFrontmatter(raw));
      } catch {
        // Already reported by the inline-sequence or schema-error checks above.
        continue;
      }

      let depsOn: string[] = [];
      if (Array.isArray(data["depends_on"])) {
        depsOn = data["depends_on"] as string[];
      }

      for (const dep of depsOn) {
        const depNorm = dep.replace(/^\.\//, "");
        const isResolvable =
          allSpecRelPaths.has(depNorm) ||
          allSpecRelPaths.has(basename(depNorm)) ||
          existsSync(join(trackerRoot, "..", depNorm));

        if (!isResolvable) {
          findings.push({
            kind: "dangling-dep",
            file: specPath,
            detail: `depends_on references missing spec: ${dep}`,
          });
        }
      }
    }
  }

  // 3. Missing index entries — check that each milestone folder is mentioned in 00-INDEX.md
  const indexPath = join(trackerRoot, "00-INDEX.md");
  if (existsSync(indexPath)) {
    const indexContent = readFileSync(indexPath, "utf-8");
    for (const folder of milestoneFolders) {
      const folderName = basename(folder);
      // Extract milestone slug (M{N}-{slug}) and number (M{N})
      const slugMatch = /^(M(\d+))-(.+)$/.exec(folderName);
      const milestoneSlug = slugMatch?.[3] ?? folderName;
      const milestonePrefix = slugMatch?.[1] ?? folderName; // e.g. "M1"

      // Read milestone name from its README
      let milestoneName: string | null = null;
      const readmePath = join(folder, "00-README.md");
      if (existsSync(readmePath)) {
        const raw = readFileSync(readmePath, "utf-8");
        try {
          const { data } = parseFrontmatter(raw);
          if (typeof data["name"] === "string") {
            milestoneName = data["name"] as string;
          }
        } catch {
          // Already reported above; fall back to folder-name matching only.
        }
      }

      // Check that the index mentions the milestone in any form:
      // - full folder name: "M1-test-milestone"
      // - slug only: "test-milestone"
      // - milestone prefix: "M1"
      // - milestone name from README: "Test Milestone"
      const isPresent =
        indexContent.includes(folderName) ||
        indexContent.includes(milestoneSlug) ||
        indexContent.includes(milestonePrefix) ||
        (milestoneName !== null && indexContent.includes(milestoneName));

      if (!isPresent) {
        findings.push({
          kind: "missing-index-entry",
          file: indexPath,
          detail: `milestone "${folderName}" not referenced in 00-INDEX.md`,
        });
      }
    }
  }

  // 4. If --fix, regenerate the index
  if (fix) {
    try {
      rebuildIndex(trackerRoot);
    } catch {
      // Ignore index rebuild errors — might be expected on first run
    }
  }

  // 5. Schema version check (re-read index in case --fix just regenerated it)
  // darius 0.66.0 carve-out: without --fix doctor writes nothing. An index
  // that needs the stamp gets a warning that names --fix instead.
  let stampNotice: DoctorFinding | undefined;
  if (existsSync(indexPath)) {
    const indexRaw = readFileSync(indexPath, "utf-8");
    const onDiskVersion = readIndexSchemaVersion(indexRaw);

    if (onDiskVersion !== null && onDiskVersion > CURRENT_SCHEMA_VERSION) {
      // Future version: hard error
      throw new Error(
        `schema_version: ${onDiskVersion} detected — plugin is too old; upgrade the tracker plugin`,
      );
    }

    if (onDiskVersion === null || onDiskVersion < CURRENT_SCHEMA_VERSION) {
      if (findings.length > 0) {
        // Other findings present: report version_drift, do NOT stamp
        findings.push({
          kind: "version_drift",
          file: indexPath,
          detail:
            `schema_version is ${onDiskVersion === null ? "missing" : onDiskVersion} (current: ${CURRENT_SCHEMA_VERSION}) — ask darius to migrate`,
        });
      } else if (fix) {
        // No other findings: auto-stamp by regenerating the index with the
        // current schema_version embedded (rebuildIndex calls rebuildIndexDoc
        // which always writes CURRENT_SCHEMA_VERSION).
        try {
          rebuildIndex(trackerRoot);
        } catch {
          // Non-fatal — might fail on edge-case tracker state
        }
      } else {
        stampNotice = {
          kind: "version_drift",
          file: indexPath,
          detail: `schema_version is ${onDiskVersion === null ? "missing" : onDiskVersion} (current: ${CURRENT_SCHEMA_VERSION}): the index needs a rebuild; run doctor --fix`,
          warnOnly: true,
        };
      }
    }
  }

  // 6. Agent roster check — warn when spec's agent: field is not in live roster
  const warnings: DoctorFinding[] = stampNotice === undefined ? [] : [stampNotice];
  try {
    const roster = discoverAgents();
    const rosterInvocables = new Set(roster.map((a) => a.invocable));
    for (const folder of milestoneFolders) {
      const specs = getSpecFiles(folder);
      for (const specPath of specs) {
        const raw = readFileSync(specPath, "utf-8");
        let data: Record<string, unknown>;
        try {
          ({ data } = parseFrontmatter(raw));
        } catch {
          // A parse failure here is already reported by the inline-sequence
          // or schema-error checks above — don't let it silently abort the
          // roster check for every spec after this one.
          continue;
        }
        const agentValue = data["agent"];
        if (typeof agentValue !== "string" || agentValue.trim() === "") continue;
        const agentName = agentValue.trim();
        // `add spec` stamps `unassigned` on every spec without an agent. That is
        // the normal state, not a roster miss, so it earns no warning per spec.
        if (agentName === "unassigned") continue;
        if (!rosterInvocables.has(agentName)) {
          warnings.push({
            kind: "agent-not-in-roster",
            file: specPath,
            detail: `WARN: agent '${agentName}' in ${specPath} is not in the live agent roster. Run \`darius agents\` to see available agents.`,
            warnOnly: true,
          });
        }
      }
    }
  } catch {
    // Discovery errors are non-fatal — agent roster check is advisory only
  }

  // 7. Ground Truth scaffold check — WARN ONLY.
  //
  // `tracker add spec` scaffolds a `## Ground Truth` section carrying an exact
  // placeholder comment. While that comment is still in the file, the section
  // was never filled in: the spec was scoped without anyone recording what they
  // read first-hand. That is the mechanism behind M248 (scoped to rebuild work
  // that had already shipped, twice).
  //
  // Keyed on the placeholder's PRESENCE, never on the section's absence — so
  // legacy specs authored before the scaffold existed (116 of them in this
  // workspace) can never trip it, and there is no ceremony flood. Warn-only by
  // design: an unfilled section is a quality signal, not a broken tracker, and
  // no `--fix` can write ground truth for you.
  for (const folder of milestoneFolders) {
    for (const specPath of getSpecFiles(folder)) {
      const raw = readFileSync(specPath, "utf-8");
      if (!raw.includes(GROUND_TRUTH_PLACEHOLDER)) continue;
      warnings.push({
        kind: "ground-truth-unfilled",
        file: specPath,
        detail:
          `WARN: ${specPath} still carries the untouched '## Ground Truth' placeholder. ` +
          `Record the files read first-hand, the commands run, and findings with file:line ` +
          `(and for any "X does not exist" claim, the search that failed AND the most likely ` +
          `home of X), then delete the placeholder comment.`,
        warnOnly: true,
      });
    }
  }

  // 8. Claimed-not-executed check — WARN ONLY.
  //
  // A `[x]` whose Command is a shell no-op (`echo manual: …`, `true`, `:`)
  // asserts nothing on its own; the ledger is where the actual evidence lives.
  // So: verified + trivial Command + no `.verification-log.jsonl` entry for
  // that item = a claim nobody stood behind. Every legitimate route now writes
  // a ledger line (`verify`/`verify-item` on execution, `mark --verified` on
  // assertion), so what this check surfaces is the one remaining path —
  // a checkbox flipped by hand in an editor.
  //
  // Warn-only, and deliberately narrow: items with a REAL command are not
  // reported (their tick may predate the ledger entirely), and neither are
  // items with no Command at all — most of a 116-spec legacy estate. Widening
  // it would trade a precise signal for a flood nobody reads.
  const ledgerSeen = ledgerKeys(trackerRoot);
  const claimed: Array<{ spec: string; index: number; label: string }> = [];
  for (const folder of milestoneFolders) {
    for (const specPath of getSpecFiles(folder)) {
      const raw = readFileSync(specPath, "utf-8");
      let body: string;
      try {
        ({ content: body } = parseFrontmatter(raw));
      } catch {
        // Reported by the inline-sequence / schema checks above.
        continue;
      }
      const relSpec = toLedgerSpecPath(trackerRoot, specPath);
      for (const item of parseChecklist(body)) {
        if (item.state !== "verified") continue;
        if (item.command === null || !isTrivialCommand(item.command)) continue;
        if (ledgerSeen.has(ledgerKey(relSpec, item.index))) continue;
        claimed.push({ spec: relSpec, index: item.index, label: item.label });
      }
    }
  }

  if (claimed.length > 0) {
    const CAP = 10;
    const shown = claimed
      .slice(0, CAP)
      .map((c) => `      - ${c.spec}#${c.index} ${c.label}`)
      .join("\n");
    const more =
      claimed.length > CAP ? `\n      … and ${claimed.length - CAP} more` : "";
    warnings.push({
      kind: "verified-not-executed",
      file: join(trackerRoot, LEDGER_FILENAME),
      detail:
        `WARN: ${claimed.length} checklist item(s) are marked verified with a shell no-op Command ` +
        `(echo/printf/true/:) and have NO entry in ${LEDGER_FILENAME} — claimed, not executed:\n` +
        `${shown}${more}\n` +
        `      Either replace the Command with a real check and re-run \`darius verify\`, or record ` +
        `what was actually done: \`darius mark <spec> <idx> --verified --evidence "..."\`.`,
      warnOnly: true,
    });
  }

  // 9. Outstanding session claims — WARN ONLY.
  //
  // Claims are advisory ephemeral state, so they can never be a hard finding.
  // But a claim nobody can see is worthless: doctor is the one command that
  // reports on tracker state as a whole, so this is where a session finds out
  // that another one holds a spec — and, more importantly, where a STALE claim
  // left by a killed session gets named instead of quietly blocking work.
  const claimStatuses = listClaims(readClaims(trackerRoot));
  if (claimStatuses.length > 0) {
    const CLAIM_CAP = 10;
    const staleCount = claimStatuses.filter((c) => c.state === "stale").length;
    const shown = claimStatuses
      .slice(0, CLAIM_CAP)
      .map((c) => `      - ${formatClaimLine(c)}`)
      .join("\n");
    const more =
      claimStatuses.length > CLAIM_CAP
        ? `\n      … and ${claimStatuses.length - CLAIM_CAP} more`
        : "";
    warnings.push({
      kind: "session-claim",
      file: join(trackerRoot, CLAIMS_FILENAME),
      detail:
        `WARN: ${claimStatuses.length} outstanding session claim(s)` +
        (staleCount > 0 ? ` (${staleCount} STALE)` : "") +
        ` in ${CLAIMS_FILENAME}:\n${shown}${more}\n` +
        `      Release your own with \`darius release <spec>\`; a STALE claim can be taken ` +
        `over with \`darius claim <spec>\` (no --takeover needed).`,
      warnOnly: true,
    });
  }

  // 9b. Stage markers without a CLI stamp: HARD FINDING (0.76.0).
  //
  // Since 0.72.0 every stage change writes a stamp next to the stage marker.
  // A thread with stamps whose stage has none, or whose stamps skip an
  // evidence stage, was edited by hand or forged through appended text
  // before 0.76.0 made appended text inert.
  for (const { path, doc } of scanWorklogDir(trackerRoot)) {
    for (const thread of doc.threads) {
      const problems = stageIntegrityProblems(thread);
      if (problems.length === 0) continue;
      findings.push({
        kind: "worklog-stage-unstamped",
        file: path,
        detail:
          `worklog thread ${thread.threadId} has stage markers the CLI did not write: ${problems.join("; ")}. ` +
          "Check the thread by hand. Close it and open a new one, or re-run the stage with " +
          '`darius worklog set-stage <id> <stage> --force --reason "..."` so the record is honest.',
      });
    }
  }

  // 10. Unrunnable armed vigils — HARD FINDING.
  //
  // A vigil is armed until it carries a verdict. If its checklist has no
  // executable `Command:` — no Command line at all, or only shell no-ops —
  // then no evidence can ever answer it and it will sit in `tracker due`
  // forever. Measured on this estate on 2026-09-02: 23 of 48 open vigils were
  // in exactly that state, several of them still carrying the scaffold's
  // `echo todo` weeks after arming.
  //
  // This fails rather than warns on purpose. A warning is what let the debt
  // build: the arming is cheap, the checklist is the work, and a vigil without
  // one is a promise nobody can collect.
  const vigilHealth = readAllVigilHealth(trackerRoot);

  for (const v of vigilHealth) {
    if (!isUnrunnable(v)) continue;
    const cause =
      v.commandCount === 0
        ? "its Verification Checklist has no `Command:` line at all"
        : `all ${v.commandCount} of its \`Command:\` lines are shell no-ops (echo/printf/true/:)`;
    findings.push({
      kind: "vigil-unrunnable",
      file: v.file,
      detail:
        `vigil "${v.slug}" is ARMED but unrunnable — ${cause}, so no evidence can ever close it. ` +
        `Give it at least one executable Command in ${v.file}, or close it now with ` +
        `\`darius vigil close ${v.slug} --verdict held|failed\`.`,
    });
  }

  ////////////////////////////////
  // 10b. A Command the PARSER cannot run — HARD FINDING (M346/03).
  //
  // `assertVigilBodyIsWorkable` refuses these three shapes at write time, so no NEW vigil can
  // carry one. This catches the files that predate that refusal. Measured 2026-09-10 across 222
  // vigil files: 13 heredocs and 18 unquoted `<placeholder>` Commands, all of them shipping a
  // shell error to the daily sweep, which filed it as an ordinary failure.
  //
  // Hard, not a warning, and for the same reason as 10: this is not a check that might fail, it
  // is a check that CANNOT RUN. It has never observed anything, so whatever it has been reporting
  // means nothing, in either direction.
  ////////////////////////////////
  for (const v of vigilHealth) {
    if (!v.armed) continue;
    let body: string;
    try {
      body = readFileSync(v.file, "utf-8");
    } catch {
      continue;
    }
    for (const reason of findUnrunnableCommandShapes(body)) {
      findings.push({
        kind: "vigil-command-shape",
        file: v.file,
        detail:
          `vigil "${v.slug}" carries a Command the parser cannot run — ${reason} ` +
          "Until it is rewritten this check has never executed, so neither its passes nor its " +
          "failures mean anything.",
      });
    }
  }

  // 11. Armed on a spec that never shipped — WARN ONLY.
  //
  // A soak observes shipped code. A vigil whose guarded spec has zero verified
  // items and whose milestone records no deploy is observing nothing, and four
  // such vigils on this estate stayed armed for 26 days before anyone noticed
  // the premise was void. Warn, never fail: arming a vigil in the same hour a
  // deploy lands — before `verify` has caught up with the checklist — is
  // legitimate and common. A `from:` that does not resolve to a spec is skipped
  // in silence.
  const unshipped = vigilHealth.filter(isPremiseUnshipped);
  if (unshipped.length > 0) {
    const CAP = 10;
    const shown = unshipped
      .slice(0, CAP)
      .map((v) => `      - ${v.slug} → ${v.fromSpecPath} (0 verified)`)
      .join("\n");
    const more =
      unshipped.length > CAP ? `\n      … and ${unshipped.length - CAP} more` : "";
    warnings.push({
      kind: "vigil-premise-unshipped",
      file: join(trackerRoot, "vigils"),
      detail:
        `WARN: ${unshipped.length} armed vigil(s) guard a spec with 0 verified items whose ` +
        `milestone README records no deploy — a soak over work that never shipped:\n` +
        `${shown}${more}\n` +
        `      Confirm the work actually deployed, or close the vigil: a vigil on an unshipped ` +
        `spec manufactures a permanent due item that no evidence can answer.`,
      warnOnly: true,
    });
  }

  // 12. Heavy Command in an armed vigil — WARN ONLY.
  //
  // a project's own sweep script runs every open vigil's `Command:` lines
  // unattended, once a day. A Command that spins up a toolbox container, runs
  // a full evaluation (`eval-*`), a bounded batch (`--runs`), or shells out to
  // `fc discover`/`fc check` is expensive enough that the sweep skips it
  // unless invoked with `--include-heavy` — so an armed vigil carrying one
  // waits longer than its `until`/`due` gate implies unless someone runs the
  // heavy sweep by hand.
  for (const v of vigilHealth) {
    if (!isHeavyCommand(v)) continue;
    warnings.push({
      kind: "vigil-heavy-command",
      file: v.file,
      detail:
        `heavy Command in vigil ${v.slug}: the daily sweep skips it unless --include-heavy`,
      warnOnly: true,
    });
  }

  const healthy = findings.length === 0;
  return { findings, warnings, healthy };
}

// ---------------------------------------------------------------------------
// Index frontmatter helpers
// ---------------------------------------------------------------------------

/**
 * Extract schema_version from an index file's frontmatter.
 *
 * The canonical index format begins with an HTML comment followed by a
 * YAML frontmatter block. gray-matter only parses frontmatter that starts
 * at the very beginning of the file, so we strip the leading comment first.
 *
 * Returns null when schema_version is absent or the file has no frontmatter.
 */
function readIndexSchemaVersion(raw: string): number | null {
  // Strip leading HTML comment (generated header) if present
  const stripped = raw.replace(/^<!--[\s\S]*?-->\s*/m, "");
  const { data } = parseFrontmatter(stripped);
  const v = data["schema_version"];
  return typeof v === "number" ? v : null;
}

// ---------------------------------------------------------------------------
// Strip derived fields from spec frontmatter
// ---------------------------------------------------------------------------

/**
 * Remove legacy derived fields (status, verified) from spec frontmatter.
 * These fields are computed at runtime and should not be stored on disk.
 */
function stripDerivedFields(raw: string): string {
  const { data, content } = parseFrontmatter(raw);

  // Derived fields that should not be stored
  const DERIVED_FIELDS = ["status", "verified"];

  const cleaned: Record<string, unknown> = { ...data };
  for (const field of DERIVED_FIELDS) {
    delete cleaned[field];
  }

  // Validate that remaining fields pass the SpecInputSchema
  SpecInputSchema.parse(cleaned);

  const serialized = serializeFrontmatter(cleaned, content);
  return serialized.endsWith("\n") ? serialized : `${serialized}\n`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getMilestoneFolders(trackerRoot: string): string[] {
  const entries = readdirSync(trackerRoot).sort();
  const folders: string[] = [];

  for (const entry of entries) {
    const fullPath = join(trackerRoot, entry);
    if (!statSync(fullPath).isDirectory()) continue;
    if (!/^M\d+-.+$/.test(entry)) continue;
    folders.push(fullPath);
  }

  return folders;
}

function getSpecFiles(milestoneFolder: string): string[] {
  const entries = readdirSync(milestoneFolder).sort();
  const specs: string[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    if (entry === "00-README.md") continue;

    const fullPath = join(milestoneFolder, entry);
    if (statSync(fullPath).isFile()) {
      specs.push(fullPath);
    }
  }

  return specs;
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

export function formatDoctorReport(report: DoctorReport): string {
  const warningLines: string[] = [];
  for (const w of (report.warnings ?? [])) {
    warningLines.push(`  ${w.detail}`);
  }

  if (report.healthy) {
    const base = "## darius doctor: OK\n\nAll checks passed — tracker is healthy.\n";
    if (warningLines.length === 0) return base;
    return base + "\n## Warnings\n\n" + warningLines.join("\n") + "\n";
  }

  const lines: string[] = [];
  lines.push("## darius doctor: FINDINGS");
  lines.push("");
  lines.push(`Found ${report.findings.length} issue(s):`);
  lines.push("");

  const byKind: Record<string, DoctorFinding[]> = {};
  for (const finding of report.findings) {
    if (!byKind[finding.kind]) byKind[finding.kind] = [];
    byKind[finding.kind]!.push(finding);
  }

  for (const [kind, items] of Object.entries(byKind)) {
    lines.push(`### ${kind.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`);
    lines.push("");
    for (const item of items) {
      lines.push(`- **${basename(item.file)}**: ${item.detail}`);
    }
    lines.push("");
  }

  // Warnings were previously printed only on the healthy path, so any warn-only
  // finding vanished the moment an unrelated hard finding existed.
  if (warningLines.length > 0) {
    lines.push("## Warnings");
    lines.push("");
    lines.push(...warningLines);
    lines.push("");
  }

  return lines.join("\n");
}
