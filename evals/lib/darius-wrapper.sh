#!/usr/bin/env bash
# The `darius` the eval child sees. run.sh puts this file's directory first on
# PATH. It runs the darius source copy next to it (evals/build-plugin.sh makes
# the copy), and it keeps all state inside the run's workspace, so no eval ever
# reads or writes the real store, the real config or a real bucket.
set -euo pipefail

# The scaffold links this file into the child HOME, so resolve the link first.
self="$(readlink -f "${BASH_SOURCE[0]}")"
here="$(cd "$(dirname "$self")" && pwd -P)"
src="${DARIUS_EVAL_SRC:-$here/../darius}"
top="$(git rev-parse --show-toplevel 2>/dev/null || pwd -P)"

export DARIUS_STATE_DIR="${DARIUS_STATE_DIR:-$top/.eval-state/state}"
export DARIUS_CONFIG_DIR="${DARIUS_CONFIG_DIR:-$top/.eval-state/config}"
# Same fences as scripts/test.sh: nothing may reach a real host service.
export DARIUS_HERDR="$top/.eval-state/no-herdr"
export DARIUS_TAILSCALE="$top/.eval-state/no-tailscale"
export DARIUS_APP_DIR="$top/.eval-state/app"
export DARIUS_SOURCE="$top/.eval-state/no-source"
export DARIUS_SSH="$top/.eval-state/no-ssh"
export DARIUS_SYSTEMCTL="$top/.eval-state/no-systemctl"
unset DARIUS_PUSH_ORIGINS
export DARIUS_RUNTIME=node
mkdir -p "$DARIUS_STATE_DIR" "$DARIUS_CONFIG_DIR"

exec bash "$src/scripts/run.sh" cli "$@"
