#!/usr/bin/env bash
# A milestone with two specs. Spec 1 is done and verified, but its code file is
# not committed (thread at `verified`). Spec 2 is ready and untouched.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../../lib/seed.sh"
seed_repo
seed_milestone demo "Demo"
spec1="$(seed_spec demo "Add greeting" src/greeting.txt)"
seed_spec demo "Add farewell" src/farewell.txt >/dev/null
seed_thread M1-demo "$spec1" src/greeting.txt verified >/dev/null
