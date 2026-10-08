---
name: darius-dream
model: opus
context: fork
description: Distill dead worklogs into anchor stubs, a worklog's end of life is a stub, never a delete
argument-hint: "[--min-age-days N]"
allowed-tools: Read, Bash
---

# Dream, Distill Dead Worklogs Into Anchor Stubs

**Before anything else**, run this line with Bash. If it prints a message, show the message to the user and stop.

```bash
command -v darius >/dev/null || { echo "darius is not installed. Install it: bash <(curl -fsSL https://raw.githubusercontent.com/AltanS/darius/main/scripts/install.sh)"; exit 1; }
```

A worklog that has gone quiet is still worth something, but not at full size. Dreaming replaces it with an **anchor stub**: the handful of facts a future agent would otherwise have to rediscover, small enough to read on sight. Nothing is lost, `distill` copies the original to `.tracker/archive/worklog-raw/<file>` and stamps the stub with the source digest before writing.

**You author content. The CLI owns the files.** Never Write, Edit, or `rm` a worklog file, and never write the `<!-- distilled: ... -->` stamp yourself. Every change goes through `worklog distill`, which enforces the eligibility gates, preserves the raw copy, and swaps atomically.

## 1. Survey

!`darius worklog distill --list --json $ARGUMENTS`

The JSON above is the work queue: one row per worklog file with `eligible`, a machine `reason`, and a human `detail`. Work **only** the rows where `eligible` is `true`.

Ineligible rows are not failures and are never argued with, `open-threads`, `milestone-active`, `not-archived`, `too-recent` and `already-distilled` each name a real reason the file is still live. Carry them into the report with their reason; do not reach for `--force`.

`--min-age-days N` passes straight through (default 14) and only loosens the age gate for cross-cutting, milestone-less files. It cannot make an active milestone or an open thread eligible.

## 2. Read the source

`Read` the eligible worklog in full, from `.tracker/worklog/<file>`. Read it once and author from it, the anchors must be facts *in the file*, never inferred, never imported from your own memory of the project.

## 3. Decide what survives

The anchor test: **would an agent six weeks from now have to rediscover this?**

- **Keep**: decisions and the reason behind them, root causes, gotchas and non-obvious constraints, hard-won facts (an exact error string, a schema quirk, a version floor), and paths/names that took work to find.
- **Drop**: process narration. Dispatch stamps, "agent selected: X", "read lines 40-80 then edit line 57", suite counts, "starting on task 2", empty skeleton sections.

Audit-derived rule of thumb for how much survives:

| Worklog flavor | Durable share | What the stub looks like |
|---|---|---|
| Curated handoff, written *for* the next agent | 80-90% durable | Mostly a compression; nearly every note yields an anchor |
| Execution trace, dispatch skeletons, line-number instructions | ~90% transient | Two or three anchors out of hundreds of lines |

A short stub from a long execution trace is the correct outcome, not a failure to try hard enough.

## 4. Author the stub

```markdown
# <H1 copied verbatim from the source file>

## Anchors

- 3-7 bullets. Each self-contained, no "see above", no "as noted earlier".
- Facts only from the source file. Never invent, never soften into a summary.

## Keywords

<one greppable line: entity names, error strings, slugs, route/CPT names, file names>

## Trail

- Raw: `.tracker/archive/worklog-raw/<file>`
- Archive: `.tracker/archive/<milestone-slug>.md`   ← milestone files only; omit for cross-cutting ones
```

**Size:** target ≤ 40 lines. Up to ~80 is permitted when the source is genuinely dense with durable content (a curated handoff for a large milestone), never to pad an execution trace. Over 4 KB the CLI warns and still writes; treat the warning as a prompt to cut, not as a pass.

**Secrets:** a secret spotted in a source worklog is **never** copied into a stub, not redacted, not paraphrased. Stop, leave the file undistilled, and surface it to the user as compromised: it must be rotated, not edited out.

### Worked example

Source: `M9-old-thing.md`, 681 bytes, one closed thread, three notes. Two notes carry root causes; one is a dispatch instruction ("Read lines 40-80 of parser.ts, then edit line 57. Dispatching to typescript-expert.") and is dropped.

```markdown
# M9-old-thing Worklog

## Anchors

- The worklog `## ` heading regex matched inside fenced code blocks, so every fenced code sample parsed as a fake open thread, the fix is requiring an explicit `<!-- opened: -->` marker on a heading before it counts as a thread.
- Legacy freeform worklog files carry no markers at all; they must fold into preamble text rather than error, or every pre-marker file becomes unreadable.

## Keywords

worklog parser, fenced code block, `<!-- opened: -->`, fake open threads, legacy freeform, preamble fold

## Trail

- Raw: `.tracker/archive/worklog-raw/M9-old-thing.md`
- Archive: `.tracker/archive/M9-old-thing.md`
```

## 5. Land it

One `--stdin` heredoc per file, no Write tool, no temp file:

```bash
darius \
  worklog distill M9-old-thing.md --stdin <<'STUB'
# M9-old-thing Worklog

## Anchors
...
STUB
```

Quote the heredoc delimiter (`<<'STUB'`), an unquoted one lets the shell expand backticks and `$` inside your prose. The CLI re-checks eligibility under its lock, so a file that went live between the survey and the write is refused rather than clobbered; treat that refusal as a skip and move on.

On success it prints the raw-copy disposition and the source digest:

```
darius worklog distill: M9-old-thing.md → anchor stub (raw copied: .tracker/archive/worklog-raw/M9-old-thing.md, sha256 0c78aaea3d27…)
```

## 6. Rebuild the index

Once, after the last file, not per file:

`darius worklog index`

Distilled files then read `distilled` in the `State` column of `.tracker/worklog/00-INDEX.md`. In a store-owned project (`.tracker` is a link to the darius store) darius records the stubs and the raw copies at the next darius verb or sync; `worklog index` is that verb, so end with it.

## 7. Report

- Files distilled, each with bytes before → after.
- Files skipped, each with its `reason` from the survey.
- Anything surfaced instead of distilled (a secret, a refused write).

## Cadence

Dreaming is maintenance, so put it on the clock rather than waiting for the directory to rot:

A repo without `.darius.toml` must run `darius init` first; darius refuses ritual verbs there with that hint.

```bash
darius ritual add worklog-dream --title "Worklog dream" --cadence 1m
```

It then shows up in `darius due` monthly; `darius run start worklog-dream` starts the run and `darius run complete <run> --outcome complete` rolls it forward.

Archiving a milestone distills that milestone's worklog on the way out (`skills/archive/SKILL.md` step 8), so the ritual exists to catch the backlog and the cross-cutting files archive never touches.

## Rules

- A worklog's end of life is a stub, never a delete. If a file cannot be distilled, leave it whole.
- Never `--force`. `already-distilled` means the anchors are already there; re-distilling risks overwriting the only surviving copy of a fact.
- One file at a time: read → author → land. Never batch several sources into one stub.
- The H1 is copied verbatim so `worklog index` and every existing link keep resolving.
