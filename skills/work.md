---
name: darius-work
description: Drive the Work Loop, plan, delegate to expert agents, verify, commit, review, learn. Use when the user wants to work on the next tracked task or continue tracked implementation.
argument-hint: "[--batch N] [task hint]"
allowed-tools: Read, Glob, Grep, Bash, Skill, Task, Agent, Write
---

# Tracker Work Loop

**Before anything else**, run this line with Bash. If it prints a message, show the message to the user and stop.

```bash
command -v darius >/dev/null || { echo "darius is not installed. Install it: bash <(curl -fsSL https://raw.githubusercontent.com/AltanS/darius/main/scripts/install.sh)"; exit 1; }
```

You, the main conversation agent, drive the full implementation cycle **end-to-end in one turn**. You do the judgment (agent selection, review, classification); forked skills and the tracker CLI do the mechanics. Do not pause between stages to ask "should I continue?", stages chain automatically.

$ARGUMENTS

```
1. PLAN    → Skill: /darius-work-plan        (forked, sonnet)
2. EXECUTE → Task: delegate per task           (expert agents, pinned models)
3. VERIFY  → Skill: /darius-work-verify      (forked, sonnet), per task
4. COMMIT  → Skill: /darius-commit           (forked, sonnet), once per batch
5. REVIEW  → YOU, directly                    (worklog Review: note, no silent pass)
6. LEARN   → Skill: /darius-enrich           (conditional)
   └── more tasks? loop back to 1
```

**Pause only on:** `commit_first` (route to commit, then resume), review `blocked`/`counsel_exhausted`/`needs_ack` (see Review Handling), a verify failure you cannot auto-route, or an explicit user-input blocker flagged by the spec. Everything else lands in one turn. If a Task delegation is in flight when the turn would otherwise end, wait for it, work isn't done until Stage 3 verify passes (or a blocker is surfaced).

## Stage 1: Plan

Invoke `/darius-work-plan` (add `--batch N`, 2–5, when the user asks for multiple things or the milestone has ≥N independent unstarted specs). Act on its `STATUS`:

- `ready` → proceed to Stage 2 with the returned `TASKS[]` (spec, thread id, agent, verification commands, worklog context).
- `commit_first` → verified-but-uncommitted specs are open debt. Invoke `/darius-commit` scoped to the listed `SPECS:`, then re-invoke work-plan. Bypass only with `--skip-commit-first` when the user explicitly defers.
- `spec_invalid` → the deterministic spec check failed. Invoke `/darius-enrich` with the listed `PROBLEMS`, then re-invoke work-plan.
- `complete` → nothing is left to plan. Run `darius worklog list --active --json` first. A thread at stage `committed` still owes Stage 5: review it, log the `Review:` note, then `set-stage <thread-id> reviewed`. Do this before you end the turn or archive.
- `review_required` / `blocked` / `counsel_exhausted` → see **Review Handling**.

## Stage 2: Execute

Match each task to an expert agent from `available_agents` in the work-plan output (or `darius agents --json`). Honor a spec's `agent:` frontmatter when that agent is in the roster. If the roster has agents and none clearly fits, do NOT guess, park the thread (`darius worklog park <thread-id> --reason "..."`) and ask the user to set `agent:` in the spec. For exploration-only tasks use `Explore`.

**Empty roster** (`available_agents` is `[]`): the main thread does the work itself. Never invent an agent name. Stamp the dispatch with `--agent main`, skip the Task call, and do the task in this thread. Stages 3 to 5 stay the same.

Before each Task call (or before you start the work yourself), stamp the dispatch. It arms the exit gate and logs the selection:
`darius worklog dispatch <thread-id> --agent <invocable> --reason "<one-line reason>"`

Dispatch exits 1 if the thread's spec is claimed by another live session on this checkout (`--force` overrides, loudly). `worklog open --spec` refuses the same way (`--takeover` overrides). Don't force past it, another session is working that spec; take different work. `darius next --json` already skips claimed specs and lists them in `skippedClaimed`. A `--session` that is not your own is refused unless you pass `--as-other-session`, and the CLI records that. Use it only when the user asks you to act for another session. After Stage 4 commits (or when a thread is parked), drop your own claim: `darius release <spec-path>`.

**One thread per spec.** Work-plan opens it. Before you open another, check `darius worklog list --active --json` for a thread with the same `specPath`, and reuse it. Never open a second thread for the same spec.

Delegate with the typed envelope (canonical schema: `darius delegation`):

```
task: <one-line checklist item>
spec_path: <absPath from next/show --json>
milestone_slug: <e.g. M2-api-layer>
thread_id: <ULID-prefixed slug>
worklog_path: <trackerRoot>/worklog/<file>
verification:
  - command: <shell string>
    expected: <"exit 0" | stdout contains "X" | stdout matches /re/ | file exists path>
prior_artifacts: [<paths>]
counsel_transcript: <trackerRoot>/<milestone>/_counsel/<spec-slug>.md   # optional
```

Agents return `status: complete | blocked | out-of-domain` (+ artifacts, notes). On `out-of-domain`, re-delegate to the named `next_agent` on the same thread: run `worklog dispatch` again with the new agent. For `BATCH_SIZE > 1`, emit all Task calls in a single message; collect all results before Stage 3.

## Stage 3: Verify

Invoke `/darius-work-verify` once per finished task (pass spec path, thread id, touched files). On `STATUS: fail`:
- `artifacts` / `stubs` → route the findings back to the implementing agent via Task, then re-verify.
- `verification` → route the command output back; agent fixes, you re-verify. A runnable check that cannot run here (no network, a missing service) is not a fail to route. Work-verify marks it with `mark --verified --override "<why it cannot run>" --evidence "<what was checked>"`. That leaves a `manual-override` line in the ledger. Check that the reason is real.
- `spec_grammar` → invoke `/darius-enrich` to fix the `Expected:` clause, then re-verify.

## Stage 4: Commit

When every task in the batch verifies, invoke `/darius-commit` scoped to the batch's specs (once per batch, not per task). `.pending-sync` drift warns and never blocks. In store mode the commit holds code only. A spec that changes no code (docs in the store, a decision) has no code commit: commit stamps it with `set-stage committed --no-code "<reason>"`.

## Stage 5: Review, YOU do this, and YOU log it

Every review writes a worklog note:
`darius worklog append <thread-id> --section note --message "Review: pass, matches the spec intent"`
No silent passes. The note starts with `Review:` and has at least 3 more words. Then close the stage: `darius worklog set-stage <thread-id> reviewed`. It succeeds only when such a note was written after the commit stamp. A `committed` thread is still open loop work until it is `reviewed`.

- **Per task:** skim the implementation, real, matches spec *intent* (not just the literal verification grep)? Log `Review: pass, <reason>` or fail.
- **Per spec** (all items `[x]`): run `dev-tools:code-review` at effort `high` on the artifact files. **Reopen, don't defer to Lessons**, any unfinished spec intent: an untested spec-required branch, a missing implied assertion, behavior wrong despite a matching grep, anything you'd flag on someone else's PR. "Warning" severity is not automatically non-blocking. Reopened tasks → back to the implementing agent via Task → re-verify → re-review.
- **Per milestone** (100%): `dev-tools:code-review` at effort `xhigh` across all spec artifacts; critical findings block the Complete promotion.

Rule of thumb: "this task is incomplete" → reopen. "Next time we'd plan differently" → Lessons (Stage 6).

## Stage 6: Learn

After spec/milestone completion, invoke `/darius-enrich` if the work revealed surprises: discovered tasks, unexpected approaches, unanticipated sibling dependencies, scope mis-sizing, changed verification commands, a review concern that came true. Straightforward work that matched the spec → skip. On milestone completion (unless `lessons: skip`): `/darius-enrich --milestone M{N}` first, then `/darius-archive`, which returns `needs_lessons` without it.

## Exit Gate

A Stop hook guards your turn end. It blocks only on threads your session owns (`worklog open` and `dispatch` record the session) that sit in a pre-terminal stage: `planned`, `dispatched`, `verified` or `committed`. `reviewed`, closed and parked threads are done. The bounce names the literal next action. Do it, or park the thread with a reason. Each thread may bounce a stop 2 times per 24 h; after that the hook reports it and lets the stop through, while your other threads still block. Threads of other sessions, or of none, show in one notice line and never block. Stage stamps ride the skills you already call. Never hand-edit a stage to silence the gate. Each stage needs its evidence, so a stage cannot be skipped.

## Review Handling

Every spec gets `darius spec check` (no model) in work-plan. Only a high-risk spec gets a reviewer, and only when `config.yml` in the tracker root does not say `review_gate: off`. Never write `counsel:` lines, `counsel: addressed` or `counsel: overridden` into a spec yourself. Only `counsel-gate` writes them, and dispatch refuses a hand-written one.

- `STATUS: review_required` → spawn ONE reviewer with the Agent tool: `subagent_type: general-purpose`, `model: opus`. Give it the `BRIEF`, the spec path, the `RISK_REASONS`, and this fixed checklist: `data-loss`, `irreversible`, `hidden-scope`, `missing-test`, `rollback`. Tell it to read the code the spec names, and to judge each item `ok`, `concern` or `blocker` with one line of reason. Tell it to answer only with this block:
  ````
  ```darius-review
  {"reviewer":"<model>","items":{"data-loss":{"verdict":"ok","reason":"..."},"irreversible":{...},"hidden-scope":{...},"missing-test":{...},"rollback":{...}}}
  ```
  ````
  Write the transcript with a file tool, under `trackerRoot` from `darius root --json`: `BRIEF_HASH = sha256(brief)`; the reply goes to `<trackerRoot>/{MILESTONE}/_counsel/.objects/{BRIEF_HASH}.md` (frontmatter: `model`, `timestamp`, `brief_hash`, `reviewer`), and the same bytes go to a plain copy at `<trackerRoot>/{MILESTONE}/_counsel/{spec-slug}.md`. Never a symlink: the store does not sync links. Never delete old objects. Then run the deterministic gate, never count verdicts yourself:
  `darius counsel-gate {MILESTONE}/_counsel/{spec-slug}.md --spec {SPEC}`
  It exits 2 when an item is missing or the JSON is bad: send the reviewer the error and ask again. Act on the CLI's STATUS verbatim, then re-invoke work-plan:
  - `ready` → proceed (the CLI stamped the spec).
  - `needs_ack` → surface each concern (`DISSENT_SUMMARY`) verbatim with your read (genuine gap / spec-authorized / taste). On user acknowledgement re-run with `--ack-dissent`; if the user calls it a gap, run `/darius-enrich` first.
  - `blocked` → classify each blocker first: **spec-authorized** (the spec already declared this scope or tradeoff) or **taste** (no concrete cost) → stand ground; if ALL are, run `darius counsel-gate --spec {SPEC} --override "<reason that cites the spec lines>"` and re-invoke work-plan. A **genuine gap** (a concrete, unanticipated risk) → `/darius-enrich`, revise, re-invoke. Auto-routing every block to enrich is the loop trap, classify first.
  - `counsel_exhausted` → the round budget (`max_counsel_rounds:`, default 2) is spent and the CLI stamped `counsel: exhausted`. Do NOT re-run the review or auto-enrich. Surface the blockers and your classification; the user chooses: `darius counsel-gate --spec {SPEC} --override "<reason>"`, an explicit enrich, or park the spec.

A review stamp is tied to the spec text. If the spec text changes after the review (an enrich, a hand edit), the stamp no longer matches, and dispatch refuses. Ticking a checklist box is not a change. `worklog dispatch` says "changed since its review" when this happens. Run the review again (spawn the reviewer, write the transcript, run `counsel-gate`), or override with a reason.

Older transcripts with four advisor verdicts still parse; `counsel-gate` reads them as before.

## Hygiene

**Recovering tree files** (store mode). A file edit or a delete in the tracker tree is a version in the store, so nothing is lost. `darius tree log <path>` lists the versions of a file or folder, newest first. `darius tree restore <path> [--at <sha|ledger-id>] [--dry-run]` brings one back. Without `--at` it undoes the newest removal. It refuses when the working copy holds another version, unless `--force`. When two hosts changed a file and no merge could join it, `darius doctor` lists the conflict. `darius tree resolve <path>` keeps the current version and closes the conflict. Ask the user before you resolve. In git mode git has the history.

Worklogs are shared with other hosts and agents (committed, or synced through the darius store), never write secrets into them; instruct implementing agents to scrub command output. Reference worklog findings in your reports. Tracker state reads go through the CLI (`darius status|show|next --json`), not the Read tool. Checklist indexes in `mark`, `verify-item` and `verify` are 0-based: the first item is `0`. Paths are tracker-relative (`M2-api-layer/01-auth.md`). Detect the mode with `darius root --json`; git mode is deprecated and behaves differently only where a skill says so.
