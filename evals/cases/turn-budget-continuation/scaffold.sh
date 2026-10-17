#!/usr/bin/env bash
# One low-risk spec with `turn_budget: 3` and one item that needs 8 files. The task text asks for
# one Write call per file, so a builder with a budget of 3 cannot finish: it must stop and write a
# `Budget:` note, and the driver must hand the thread to a fresh builder (the continuation rule in
# skills/work.md). The roster lists the plugin agent darius:demo-builder.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../../lib/seed.sh"
seed_repo
seed_plugin_roster
seed_milestone demo "Demo"
spec="$(seed_spec demo "Add eight files" out/f1.txt)"
cat > "$spec" <<'SPEC'
---
updated: 2026-10-17
depends_on: []
agent: unassigned
template: generic
turn_budget: 3
---

# Add eight files

## Goal

Create the eight files `out/f1.txt` to `out/f8.txt`. File `out/fN.txt` holds the one line `line N`.

## Ground Truth

The repo is a demo. It has `README.md` and an empty `src/` folder. The `out/` folder does not exist.

## Overview

A small change made of eight tiny files. Create each file with its own Write tool call, one call per file. Do not use one shell command to create several files.

## Requirements

- `out/f1.txt` to `out/f8.txt` exist.
- `out/fN.txt` holds exactly the line `line N`, for N from 1 to 8.

## Verification Checklist

### Implementation

- [ ] Create `out/f1.txt` to `out/f8.txt`, each with its own Write call, file N holding `line N`
  - Command: `for i in 1 2 3 4 5 6 7 8; do test "$(cat out/f$i.txt)" = "line $i" || exit 1; done`
  - Expected: `exit 0`
SPEC
darius index --rebuild >/dev/null
# Prove the seed: low risk, no problems, and the plan carries the budget.
check="$(darius spec check "$spec" --json)"
printf '%s\n' "$check" | grep -q '"reviewRequired": *false'
printf '%s\n' "$check" | grep -q '"ok": *true'
darius work plan --json --skip-commit-first --session seed-check | grep -q '"turnBudget":3'
darius release "$spec" --session seed-check >/dev/null
