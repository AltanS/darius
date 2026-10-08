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
- `review_required` / `blocked` / `counsel_exhausted` → see **Review Handling**.

## Stage 2: Execute

Match each task to an expert agent from `available_agents` in the work-plan output (or `darius agents --json`). Honor a spec's `agent:` frontmatter when that agent is in the roster. If nothing clearly fits, do NOT guess, park the thread (`darius worklog park <thread-id> --reason "..."`) and ask the user to set `agent:` in the spec. For exploration-only tasks use `Explore`.

Before each Task call, stamp the dispatch (arms the exit gate, logs the selection):
`darius worklog dispatch <thread-id> --agent <invocable> --reason "<one-line reason>"`

Dispatch exits 1 if the thread's spec is claimed by another live session on this checkout (`--force` overrides, loudly). Don't force past it, another session is working that spec; take different work. After Stage 4 commits (or when a thread is parked), drop your own claim: `darius release <spec-path>`.

Delegate with the typed envelope (canonical schema: `darius delegation`):

```
task: <one-line checklist item>
spec_path: <absolute>
milestone_slug: <e.g. M2-api-layer>
thread_id: <ULID-prefixed slug>
worklog_path: <absolute>
verification:
  - command: <shell string>
    expected: <"exit 0" | stdout contains "X" | stdout matches /re/ | file exists path>
prior_artifacts: [<paths>]
counsel_transcript: <path>          # optional
```

Agents return `status: complete | blocked | out-of-domain` (+ artifacts, notes). On `out-of-domain`, re-delegate to the named `next_agent` with a fresh thread on the same spec. For `BATCH_SIZE > 1`, emit all Task calls in a single message; collect all results before Stage 3.

## Stage 3: Verify

Invoke `/darius-work-verify` once per finished task (pass spec path, thread id, touched files). On `STATUS: fail`:
- `artifacts` / `stubs` → route the findings back to the implementing agent via Task, then re-verify.
- `verification` → route the command output back; agent fixes, you re-verify.
- `spec_grammar` → invoke `/darius-enrich` to fix the `Expected:` clause, then re-verify.

## Stage 4: Commit

When every task in the batch verifies, invoke `/darius-commit` scoped to the batch's specs (once per batch, not per task). `.pending-sync` drift warns and never blocks. In a store-owned project the commit holds code only.

## Stage 5: Review, YOU do this, and YOU log it

Every review writes a worklog note (`darius worklog append <thread-id> --message "Review: ..."`). No silent passes. Then close the stage: `darius worklog set-stage <thread-id> reviewed`. It succeeds only when a note that starts with `Review:` was written after the commit stamp. A `committed` thread is still open loop work until it is `reviewed`.

- **Per task:** skim the implementation, real, matches spec *intent* (not just the literal verification grep)? Log `Review: pass, <reason>` or fail.
- **Per spec** (all items `[x]`): run `dev-tools:code-review` on the artifact files. **Reopen, don't defer to Lessons**, any unfinished spec intent: an untested spec-required branch, a missing implied assertion, behavior wrong despite a matching grep, anything you'd flag on someone else's PR. "Warning" severity is not automatically non-blocking. Reopened tasks → back to the implementing agent via Task → re-verify → re-review.
- **Per milestone** (100%): code-review across all spec artifacts; critical findings block the Complete promotion.

Rule of thumb: "this task is incomplete" → reopen. "Next time we'd plan differently" → Lessons (Stage 6).

## Stage 6: Learn

After spec/milestone completion, invoke `/darius-enrich` if the work revealed surprises: discovered tasks, unexpected approaches, unanticipated sibling dependencies, scope mis-sizing, changed verification commands, a review concern that came true. Straightforward work that matched the spec → skip. On milestone completion (unless `lessons: skip`): `/darius-enrich --milestone M{N}` first, then `/darius-archive`, which returns `needs_lessons` without it.

## Exit Gate

A Stop hook guards your turn end. It blocks only on threads your session owns (`worklog open` and `dispatch` record the session) that sit in a pre-terminal stage: `planned`, `dispatched`, `verified` or `committed`. `reviewed`, closed and parked threads are done. The bounce names the literal next action. Do it, or park the thread with a reason. Each thread may bounce a stop 2 times per 24 h; after that the hook reports it and lets the stop through, while your other threads still block. Threads of other sessions, or of none, show in one notice line and never block. Stage stamps ride the skills you already call. Never hand-edit a stage to silence the gate. Each stage needs its evidence, so a stage cannot be skipped.

## Review Handling

Since darius 0.74.0 every spec gets `darius spec check` (no model) in work-plan. Only a high-risk spec gets a reviewer, and only when `.tracker/config.yml` does not say `review_gate: off`.

- `STATUS: review_required` → spawn ONE reviewer with the Agent tool: `subagent_type: general-purpose`, `model: opus`. Give it the `BRIEF`, the spec path, the `RISK_REASONS`, and this fixed checklist: `data-loss`, `irreversible`, `hidden-scope`, `missing-test`, `rollback`. Tell it to read the code the spec names, and to judge each item `ok`, `concern` or `blocker` with one line of reason. Tell it to answer only with this block:
  ````
  ```darius-review
  {"reviewer":"<model>","items":{"data-loss":{"verdict":"ok","reason":"..."},"irreversible":{...},"hidden-scope":{...},"missing-test":{...},"rollback":{...}}}
  ```
  ````
  Write the transcript: `BRIEF_HASH = sha256(brief)`; the reply goes to `{MILESTONE}/_counsel/.objects/{BRIEF_HASH}.md` (frontmatter: `model`, `timestamp`, `brief_hash`, `reviewer`), and the same bytes go to a plain copy at `{MILESTONE}/_counsel/{spec-slug}.md`. Never a symlink: the store does not sync links. Never delete old objects. Then run the deterministic gate, never count verdicts yourself:
  `darius counsel-gate {MILESTONE}/_counsel/{spec-slug}.md --spec {SPEC}`
  It exits 2 when an item is missing or the JSON is bad: send the reviewer the error and ask again. Act on the CLI's STATUS verbatim, then re-invoke work-plan:
  - `ready` → proceed (the CLI stamped `counsel: <ISO>`).
  - `needs_ack` → surface each concern (`DISSENT_SUMMARY`) verbatim with your read (genuine gap / spec-authorized / taste). On user acknowledgement re-run with `--ack-dissent`; if the user calls it a gap, run `/darius-enrich` first.
  - `blocked` → classify each blocker first: **spec-authorized** (the spec already declared this scope or tradeoff) or **taste** (no concrete cost) → stand ground; if ALL are, set `counsel: addressed` in spec frontmatter with a worklog note citing spec lines, re-invoke work-plan. A **genuine gap** (a concrete, unanticipated risk) → `/darius-enrich`, revise, re-invoke. Auto-routing every block to enrich is the loop trap, classify first.
  - `counsel_exhausted` → the round budget (`max_counsel_rounds:`, default 2) is spent and the CLI stamped `counsel: exhausted`. Do NOT re-run the review or auto-enrich. Surface the blockers and your classification; the user chooses: `--override "<reason>"`, an explicit enrich, or park the spec.

Older transcripts with four advisor verdicts still parse; `counsel-gate` reads them as before.

## Hygiene

Worklogs are shared with other hosts and agents (committed, or synced through the darius store), never write secrets into them; instruct implementing agents to scrub command output. Reference worklog findings in your reports. Tracker state reads go through the CLI (`darius status|show|next --json`), not the Read tool.
