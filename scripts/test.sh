#!/usr/bin/env bash
# The unit suite. `bun run test`, or run this directly.
#
# NODE'S BUILT-IN RUNNER, not Bun's, and that is deliberate: `node:test` is
# stdlib on a runtime darius already supports, so the suite adds no dependency
# and there is still no build step. Node also runs each test FILE in its own
# process, which lets a test set an environment variable and re-import a module
# that read it at load time.
#
# Both runtimes are still checked, by executing the CLI under each at the bottom
# of this script. That is the part `node:test` cannot cover.
#
# The state and config directories are THROWAWAY. Without that the suite would
# read and write the operator's real store under ~/.local/share/darius.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT

# Every mkdtemp in the suite (node's os.tmpdir() and mktemp both read TMPDIR)
# lands inside the sandbox, so the trap above removes all of it on exit.
mkdir -p "$SANDBOX/tmp"
export TMPDIR="$SANDBOX/tmp"

export DARIUS_STATE_DIR="$SANDBOX/state"
export DARIUS_CONFIG_DIR="$SANDBOX/config"
mkdir -p "$DARIUS_STATE_DIR" "$DARIUS_CONFIG_DIR"
# The operator's herdr is live: a test that reached it would open tabs there.
# Tests that need herdr put a fake on DARIUS_HERDR themselves.
export DARIUS_HERDR="$SANDBOX/no-herdr"
# The same for Tailscale: the web page's `auto` bind and identity checks
# must not reach the real tailnet from a test.
export DARIUS_TAILSCALE="$SANDBOX/no-tailscale"
# The same for the app install and updates: no test may touch
# ~/.local/opt/darius, clone from GitHub, or ssh into a real host. Tests that
# need them build a local source repo and a fake ssh themselves.
export DARIUS_APP_DIR="$SANDBOX/app"
export DARIUS_SOURCE="$SANDBOX/no-source"
export DARIUS_SSH="$SANDBOX/no-ssh"
# Claude Code's config dir: `darius setup` refreshes a stamped skill file
# there, and `darius skill install` writes one. No test may touch ~/.claude.
export CLAUDE_CONFIG_DIR="$SANDBOX/claude"
# Push: no test reaches a real push service; a test that needs one adds its own
# fake's origin, and nothing else may add one.
unset DARIUS_PUSH_ORIGINS

NODE="${DARIUS_NODE:-node}"
"$NODE" --no-warnings --test "test/*.test.ts"

# The runtime matrix. `--version` loads the CLI entrypoint and everything it
# imports under each runtime, which catches an enum, a `Bun.*` outside
# runtime.ts, or a constructor parameter property.
echo
for runtime in node bun; do
  if DARIUS_RUNTIME="$runtime" ./bin/darius --version >/dev/null 2>&1; then
    echo "✓ runs under $runtime"
  else
    echo "✗ FAILED under $runtime" >&2
    exit 1
  fi
done
