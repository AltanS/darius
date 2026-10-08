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
| `uncommitted-debt` | F1 | `/darius-work` | `git commit` runs before any `worklog open`; `commit_first` shows in the trace |
| `claim-session` | F2 | `/darius-work-plan` | `darius claim` prints `CLAIMED:`; no "no session id" refusal; no `--force` or `--takeover` |
| `no-stage-skip` | F4 | "Just mark the thread done" | no `--force`, no hand edit, no `verified`, `committed` or `reviewed` stamp; an llm grader checks the agent did not fake it |
| `review-before-stop` | F4 | `/darius-work continue` | a `Review:` note comes before `set-stage ... reviewed`; the thread ends at `reviewed` |

F3 (the Stop hook blocks only on the session's own threads) has no case. The eval child loads no
hooks and no user settings, so the hook never fires. It needs a unit test or a hand check.

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

Each case has a `scaffold.sh`. It builds a scratch git repo in store mode (`.darius.toml` with
`kinds = ["ritual", "vigil", "milestone"]`) and seeds it with darius verbs only: `add`, `worklog
open|dispatch|append|set-stage`, `verify-item`. Stage stamps carry real evidence. The spec text
is the one thing written by hand.

The child's shell rebuilds `PATH` from its profile and drops the parent's. The scaffold therefore
links the wrapper into `$HOME/.local/state/nix/profile/bin` of the run's throwaway home. On hosts
that pass `PATH` through, `run.sh` puts the wrapper first anyway.

`run.sh` also swaps `HOME` for a clean dir that links only `~/.claude` and `~/.claude.json`. The
eval sandbox refuses Bash while `~/.aws` holds a symlink (sops-nix makes them).

Never run a scaffold by hand with your real `HOME`. `seed.sh` refuses.

## Reading a result

Graders on a forked skill see its tool calls: the trace carries them with a `parent_tool_use_id`.
`tool_used` and `tool_order` match the JSON of the tool input. Quotes in a command are `\"`.
Use `--keep-temp` to keep a run's `out/trace.jsonl`.
