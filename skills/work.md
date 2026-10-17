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

You, the main conversation agent, drive the full implementation cycle **end-to-end in one turn**. You do the judgment (agent selection, review, the commit message); the `darius work` verbs do the mechanics in one Bash call each. Do not pause between stages to ask "should I continue?", stages chain automatically.

$ARGUMENTS

```
1. PLAN    → Bash: darius work plan --json           (one call)
2. EXECUTE → Task: delegate per task                  (expert agents, pinned models)
3. VERIFY  → Bash: darius work verify ... --json      (one call per task)
4. COMMIT  → Bash: darius work commit-check, git, set-stage committed
5. REVIEW  → YOU, directly                            (worklog Review: note, no silent pass)
6. LEARN   → Skill: /darius-enrich                    (conditional)
   └── more tasks? loop back to 1
```

**Pause only on:** `commit_first` (commit, then resume), review `blocked`/`counsel_exhausted`/`needs_ack` (see Review Handling), a verify failure you cannot auto-route, or an explicit user-input blocker flagged by the spec. Everything else lands in one turn. If a Task delegation is in flight when the turn would otherwise end, wait for it, work isn't done until Stage 3 verify passes (or a blocker is surfaced).

## Stage 1: Plan

Run `darius work plan --json` (add `--batch N`, 2 to 5, when the user asks for several things). It runs the commit-first gate, `next`, the dependency gate, `spec check`, the review stamp, the worklog context, the claim, the thread (opened at `planned`, or reused) and the roster. Read `status`:

- `ready` → Stage 2 with `tasks[]`. Each task has `spec`, `specAbsPath`, `milestone`, `task`, `threadId`, `worklogPath`, `agent`, `verification`, `priorArtifacts`, `counselTranscript`. `context` lists the open threads of the milestone with their last note.
- `commit_first` → `specs` are verified but not committed. Do Stage 4 for them, then plan again. Never pass `--skip-commit-first` unless the user defers the commit.
- `spec_invalid` → invoke `/darius-enrich` with `specs` and `problems`, then plan again.
- `complete` → nothing left to plan. `pending` lists open threads that still owe a stage. A thread at `committed` still owes Stage 5: review it, log the `Review:` note, then `set-stage <thread-id> reviewed`.
- `review_required` / `blocked` / `counsel_exhausted` → see **Review Handling**. Keep the `tasks[]` that `review_required` carries.

`blocked[]` names specs skipped (a claim, `depends_on`). `warnings[]` is advice, such as a spec over 5 items. Mention both to the user.

## Stage 2: Execute

`agent` is the spec's `agent:` frontmatter when the roster has it, `main` when the roster is empty, else null: pick from `availableAgents` by description. If the roster has agents and none clearly fits, do NOT guess, park the thread (`darius worklog park <thread-id> --reason "..."`) and ask the user to set `agent:` in the spec. For exploration-only tasks use `Explore`.

**Empty roster** (`agent: main`): the main thread does the work itself. Never invent an agent name. Stamp the dispatch with `--agent main`, skip the Task call, and do the task in this thread. Stages 3 to 5 stay the same.

Before each Task call (or before you start the work yourself), stamp the dispatch. It arms the exit gate and logs the selection:
`darius worklog dispatch <thread-id> --agent <invocable> --reason "<one-line reason>"`

If dispatch refuses because another live session claimed the spec, take different work. Never pass `--force`, `--takeover` or `--as-other-session` unless the user says so. After Stage 4 commits (or when a thread is parked), drop your own claim: `darius release <spec-path>`.

Delegate with the typed envelope (canonical schema: `darius delegation`):

```
task: <one-line checklist item>
spec_path: <specAbsPath>
milestone_slug: <milestone>
thread_id: <threadId>
worklog_path: <worklogPath>
verification:
  - command: <shell string>
    expected: <"exit 0" | stdout contains "X" | stdout matches /re/ | file exists path>
prior_artifacts: [<paths>]
counsel_transcript: <counselTranscript>   # optional
turn_budget: 60
```

Add these two lines for the builder under the envelope: "Count your tool calls. At the budget, stop: append a worklog note `Budget: done <what>, left <what>` and return `status: blocked` with notes that start with `turn_budget:`."

Agents return `status: complete | blocked | out-of-domain` (+ artifacts, notes). On `out-of-domain`, re-delegate to the named `next_agent` on the same thread: run `worklog dispatch` again with the new agent. On a `turn_budget:` return, run `worklog dispatch` again on the same thread and hand a fresh agent of the same type the same envelope plus the `Budget:` note. At most 2 such continuations per thread; then park it with a reason and tell the user. For `--batch`, emit all Task calls in a single message; collect all results before Stage 3.

## Stage 3: Verify

Once per finished task:
`darius work verify <spec> --thread <thread-id> --touched <file1,file2> --json`
It runs the artifact and stub scans, `verify` on the whole spec, the index rebuild, the Artifacts entry, and `set-stage verified` when all of it passed. Read `status`:
- `pass` → Stage 4.
- `manual` → for each item in `manual[]`, check it yourself, then `darius mark <spec> <index> --verified --evidence "<what was checked, how, by whom>"`. Then `darius worklog set-stage <thread-id> verified`.
- `fail` with `reason` `artifacts` or `stubs` → route `findings` back to the implementing agent via Task, then verify again.
- `fail` with `verification` → route the findings back; the agent fixes, you verify again. A runnable check that cannot run here (no network, a missing service) is not a fail to route: `darius mark <spec> <index> --verified --override "<why it cannot run>" --evidence "<what was checked>"`. Check that the reason is real.
- `fail` with `spec_grammar` → invoke `/darius-enrich` to fix the `Command:` or `Expected:` clause, then verify again.

## Stage 4: Commit

Once per batch, when every task verified:
1. `darius work commit-check <spec>... --json`. It refuses (exit 1) a thread that is not `verified`, has no artifacts, or has nothing to commit, and prints the `next:` command. A spec that changes no code: `darius worklog set-stage <thread-id> committed --no-code "<reason>"`.
2. `git add <add[]>` (only those paths), then `git commit -m "<conventional message>" -m "<trailer>"`. Write the message yourself from the change. `trailer` is the `Tracker:` progress line. `.pending-sync` drift in `warnings` never blocks.
3. For each thread: `darius worklog set-stage <thread-id> committed --commit $(git rev-parse HEAD)`. It also drops the thread's artifacts from `.pending-sync`.

In store mode the commit holds code only.

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

A Stop hook blocks your turn end while a thread your session owns sits before `reviewed`. Do the action it names, or park the thread with a reason. Never hand-edit or force a stage to silence it.

## Review Handling

Every spec gets `darius spec check` (no model) in `work plan`. Only a high-risk spec gets a reviewer, and only when `config.yml` in the tracker root does not say `review_gate: off`. Never write `counsel:` lines, `counsel: addressed` or `counsel: overridden` into a spec yourself. Only `counsel-gate` writes them, and dispatch refuses a hand-written one.

- `status: review_required` → spawn ONE reviewer with the Agent tool: `subagent_type: general-purpose`, `model: opus`. Give it `review.spec` (the absolute path is `specAbsPath` of that task), `review.riskReasons`, and this fixed checklist: `data-loss`, `irreversible`, `hidden-scope`, `missing-test`, `rollback`. Tell it to read the spec and the code the spec names itself, and to judge each item `ok`, `concern` or `blocker` with one line of reason. Do not write a brief for it. Tell it to answer only with this block:
  ````
  ```darius-review
  {"reviewer":"<model>","items":{"data-loss":{"verdict":"ok","reason":"..."},"irreversible":{...},"hidden-scope":{...},"missing-test":{...},"rollback":{...}}}
  ```
  ````
  Write the reply with a file tool: `BRIEF_HASH = sha256(the prompt you gave the reviewer)`; the reply goes to `<trackerRoot>/{MILESTONE}/_counsel/.objects/{BRIEF_HASH}.md` (frontmatter: `model`, `timestamp`, `brief_hash`, `reviewer`), and the same bytes go to `review.transcriptPath`, a plain file. Never a symlink: the store does not sync links. Never delete old objects. Then run the deterministic gate, never count verdicts yourself:
  `darius counsel-gate {MILESTONE}/_counsel/{spec-slug}.md --spec {SPEC}`
  It exits 2 when an item is missing or the JSON is bad: send the reviewer the error and ask again. Act on the CLI's STATUS verbatim:
  - `ready` → the CLI stamped the spec. Go to Stage 2 with the saved `tasks[]`. Do NOT plan again: `worklog dispatch` refuses a stale or missing stamp. Plan again only after an enrich or a dispatch refusal.
  - `needs_ack` → surface each concern (`DISSENT_SUMMARY`) verbatim with your read (genuine gap / spec-authorized / taste). On user acknowledgement re-run with `--ack-dissent`, then proceed as for `ready`; if the user calls it a gap, run `/darius-enrich` first.
  - `blocked` → classify each blocker first: **spec-authorized** (the spec already declared this scope or tradeoff) or **taste** (no concrete cost) → stand ground; if ALL are, run `darius counsel-gate --spec {SPEC} --override "<reason that cites the spec lines>"` and proceed as for `ready`. A **genuine gap** (a concrete, unanticipated risk) → `/darius-enrich`, revise, plan again (it reuses the open thread). Auto-routing every block to enrich is the loop trap, classify first.
  - `counsel_exhausted` → the round budget (`max_counsel_rounds:`, default 2) is spent and the CLI stamped `counsel: exhausted`. Do NOT re-run the review or auto-enrich. Surface the blockers and your classification; the user chooses: `darius counsel-gate --spec {SPEC} --override "<reason>"` (or `darius work plan --override "<reason>"`), an explicit enrich, or park the spec.

If the user parks or abandons the spec at `needs_ack`, `blocked` or `counsel_exhausted`, park the thread (`darius worklog park <thread-id> --reason "..."`) and run `darius release {SPEC}`, or the exit gate traps the turn.

A review stamp is tied to the spec text. If the spec text changes after the review (an enrich, a hand edit), the stamp no longer matches, and dispatch refuses. Ticking a checklist box is not a change. `worklog dispatch` says "changed since its review" when this happens. Run the review again (spawn the reviewer, write the transcript, run `counsel-gate`), or override with a reason.

## Hygiene

Worklogs are shared with other hosts and agents (committed, or synced through the darius store), never write secrets into them; instruct implementing agents to scrub command output. Reference worklog findings in your reports. Tracker state reads go through the CLI (`darius work plan|status|show|next --json`), not the Read tool. Checklist indexes in `mark`, `verify-item` and `verify` are 0-based: the first item is `0`. Paths are tracker-relative (`M2-api-layer/01-auth.md`).
