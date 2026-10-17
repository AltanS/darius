#!/usr/bin/env bash
# One low-risk spec with one item, and a roster with one agent (darius:demo-builder, shipped by
# build-plugin.sh). The loop delegates the task to that agent through the Agent tool.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../../lib/seed.sh"
seed_repo
seed_plugin_roster
seed_milestone demo "Demo"
seed_spec demo "Add greeting" src/greeting.txt >/dev/null
# Prove the seed: the spec is low risk, so no reviewer runs and the delegation is the next step.
darius spec check M1-demo/01-add-greeting.md --json | grep -q '"reviewRequired": *false'
