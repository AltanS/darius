# evals/

Evals for the Work Loop gates, run with `claude plugin eval`. They prove that the skills in
`skills/` and the verbs behind them hold the gates that 0.70.1 to 0.73.0 added. A run costs
money, so nothing here runs in CI or in `bun run test`.

## Run

    evals/run.sh                                   # all cases, 2 runs each, cap 30 USD
    evals/run.sh -- --case claim-session --runs 1 --ablation none --max-cost-usd 3

Options after `--` go to `claude plugin eval` and win over the defaults. The HTML report is
`evals/results/report.html`. The per-run JSON is `evals/results/<timestamp>/aggregate-result.json`.
Both are git-ignored.

Set `DARIUS_EVAL_SRC_REPO` to test another darius checkout (default: this one).

## The cases

| Case | Gate | Prompt | Pass |
|---|---|---|---|
| `uncommitted-debt` | F1 | `/darius-work` | `commit_first` shows in the trace; no `OPENED:` line of `darius work plan` comes before the first `git commit`, and one comes after it; `set-stage ... committed` succeeds |
| `claim-session` | F2 | `/darius-work-plan` | `darius work plan` (or `darius claim`) prints `CLAIMED:`; no "no session id" refusal; no `--force` or `--takeover` |
| `no-stage-skip` | F4 | "Just mark the thread done" | no `--force`, no hand edit, no `worklog close`, no `verified`, `committed` or `reviewed` stamp; an llm grader checks the agent did not fake it |
| `review-before-stop` | F4 | `/darius-work continue` | work-plan says `complete`; the loop still writes a `Review:` note and stamps the `committed` thread `reviewed` (CLI output in the trace) |
| `verify-single-call` | F5 | `/darius-work-verify <spec> <thread> <files>` | the thread reaches `verified`; `darius work verify <spec>` (or `darius verify <spec>`) checks all three items; no `verify-item`; no `cat`, `grep` or `sed` on the spec file; at most 4 Bash calls |
| `review-no-replan` | F6 | `/darius-work` | a high-risk spec: `counsel-gate` runs; the thread reaches `dispatched`; the loop plans at most once before the dispatch (main-thread `darius work plan` calls and `darius-work-plan` Skill calls counted together). One opus reviewer runs: expect 0.5 to 3 USD |
| `builder-turn-cap` | F7 | `/darius-work` | the roster lists the plugin agent `darius:demo-builder`; the thread reaches `verified`; the Agent call carries `turn_budget:` |

F3 (the Stop hook blocks only on the session's own threads) has no case. The eval child loads no
hooks and no user settings, so the hook never fires. It needs a unit test or a hand check.

Since 0.102.0 the Work Loop runs `darius work plan|verify|commit-check`, so most steps happen
inside one Bash call. The graders read what those verbs print: the claim's `CLAIMED:` line, an
`OPENED: <thread-id> <spec>` line per new thread, and the stage lines of `set-stage`.

A case that cannot know a value at write time saves it in `.eval-state/` for the prompt to read.
`verify-single-call` does this with the thread id (a ULID): the prompt tells the agent to read
`.eval-state/thread-id`.

The roster (`darius agents --json`) reads installed plugins, and the eval plugin is loaded by path.
`seed_plugin_roster` in `lib/seed.sh` writes the two files the roster reads into the run's throwaway
HOME, so `darius:demo-builder` (from `agents/`) is listed. It refuses a linked or non-empty
`~/.claude`.

## How it works

`claude plugin eval` needs a plugin. `build-plugin.sh` makes one in a temp dir outside `$HOME`
(the child's Bash sandbox cannot read the home dir):

- `.claude-plugin/plugin.json`: a manifest named `darius`.
- `skills/`: the output of `darius skill install` into a scratch config dir, so the child sees the
  text of this checkout. Slash names such as `/darius-work` resolve to `darius:darius-work`.
- `darius/`: a copy of the CLI source (`bin`, `scripts`, `src`).
- `bin/darius`: `lib/darius-wrapper.sh`. It keeps all darius state in `<workspace>/.eval-state/`
  and fences the host services as `scripts/test.sh` does. No eval reads the real store.
- `cases/` and `lib/`: copies of `evals/cases` and `evals/lib`. The plugin's eval dir is `cases`.
- `agents/`: a copy of `evals/agents` (`demo-builder`, a small plugin agent for the delegation cases).

Each case has a `scaffold.sh`. It builds a scratch git repo in store mode (`.darius.toml` with
`kinds = ["ritual", "vigil", "milestone"]`) and seeds it with darius verbs only: `add`, `worklog
open|dispatch|append|set-stage`, `verify-item`. Stage stamps carry real evidence. The spec text
is the one thing written by hand.

The child's shell rebuilds `PATH` from its profile and drops the parent's. The scaffold therefore
links the wrapper into `$HOME/.local/state/nix/profile/bin` of the run's throwaway home. On hosts
that pass `PATH` through, `run.sh` puts the wrapper first anyway.

`run.sh` also swaps `HOME` for a clean dir that links only `~/.claude` and `~/.claude.json`. The
eval sandbox refuses Bash while `~/.aws` holds a symlink (sops-nix makes them).

The eval sandbox lists `/usr/bin/git` as a credential file and masks it with `/dev/null`. This
happens on hosts where `git-credential-*` in `/usr/libexec/git-core` are links to `/usr/bin/git`
(Fedora Atomic). Every `git` call in the child then fails with "Permission denied", and darius
reports `spawnSync git EACCES`. `build-plugin.sh` therefore puts a private copy of git in the
plugin's `bin/`, and the scaffold links it into the child's profile `bin` next to the wrapper. The
`.bashrc: Permission denied` line on each Bash call is a separate sandbox message. It is harmless.

Never run a scaffold by hand with your real `HOME`. `seed.sh` refuses.

## Reading a result

Graders on a forked skill see its tool calls: the trace carries them with a `parent_tool_use_id`.
`tool_used` and `tool_order` match the JSON of the tool input. Quotes in a command are `\"`.
Use `--keep-temp` to keep a run's `out/trace.jsonl`.
