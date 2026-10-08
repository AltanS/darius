#!/usr/bin/env bash
# Run the Work Loop gate evals. This costs real money: 4 cases x 2 runs x 2 arms is the
# default cap of 30 USD. Pass extra `claude plugin eval` options after `--`, for
# example: evals/run.sh -- --case claim-session --runs 1 --ablation none --max-cost-usd 3
#
#   DARIUS_EVAL_SRC_REPO  the darius checkout under test (default: this repo)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
[ "${1:-}" = "--" ] && shift

PLUGIN="$(mktemp -d "${TMPDIR:-/tmp}/darius-evals-plugin.XXXXXX")"
bash "$HERE/build-plugin.sh" "$PLUGIN"
mkdir -p "$HERE/results"

# The eval sandbox refuses to run Bash while ~/.aws holds a symlink (sops-nix and
# similar tools make them). It reads HOME, so give it a clean HOME, and keep the
# real Claude config dir for login. The child gets its own HOME anyway.
# The nix `claude` wrapper looks for the binary under $HOME, so resolve it first.
CLAUDE_BIN="${CLAUDE_BIN:-$(readlink -f "$HOME/.local/bin/claude" 2>/dev/null || command -v claude)}"
REAL_HOME="$HOME"
EVAL_HOME="$(mktemp -d)"
trap 'rm -rf "$EVAL_HOME" "$PLUGIN"' EXIT
# Login state is shared by link, as in a normal run. Nothing else of HOME is.
ln -s "$REAL_HOME/.claude" "$EVAL_HOME/.claude"
[ -e "$REAL_HOME/.claude.json" ] && ln -s "$REAL_HOME/.claude.json" "$EVAL_HOME/.claude.json"
export HOME="$EVAL_HOME"
# F2 must hold on what Claude Code sets in the child, not on what this shell passes down.
unset CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID

# The child inherits PATH, so the wrapper must come first. Without it the
# skills' own `command -v darius` check would fall through to a real install.
export PATH="$PLUGIN/bin:$PATH"

# The target comes before --allow-tools, which is variadic.
"$CLAUDE_BIN" plugin eval "$PLUGIN" \
  --eval-dir cases \
  --allow-tools Bash Write Edit \
  --scaffold --trust-plugin \
  --runs 2 --model sonnet \
  --max-cost-usd 30 \
  --no-publish \
  --output-dir "$HERE/results/$(date +%Y%m%d-%H%M%S)" \
  --report "$HERE/results/report.html" \
  "$@"
