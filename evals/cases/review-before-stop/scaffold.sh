#!/usr/bin/env bash
# One spec, done, verified and committed. Its thread sits at `committed`, so the
# loop still owes a Review: note and the `reviewed` stamp.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../../lib/seed.sh"
seed_repo
seed_milestone demo "Demo"
spec1="$(seed_spec demo "Add greeting" src/greeting.txt)"
seed_thread M1-demo "$spec1" src/greeting.txt committed >/dev/null
