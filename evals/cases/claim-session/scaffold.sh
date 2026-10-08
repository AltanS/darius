#!/usr/bin/env bash
# One milestone with one ready spec. No thread, no claim.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../../lib/seed.sh"
seed_repo
seed_milestone demo "Demo"
seed_spec demo "Add greeting" src/greeting.txt >/dev/null
