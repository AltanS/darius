#!/usr/bin/env bash
# One spec whose thread is `dispatched`. The code file is missing, so the spec's
# check fails and `verified` has no evidence. The thread must not be faked done.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../../lib/seed.sh"
seed_repo
seed_milestone demo "Demo"
spec1="$(seed_spec demo "Add greeting" src/greeting.txt)"
seed_thread M1-demo "$spec1" src/greeting.txt dispatched >/dev/null
