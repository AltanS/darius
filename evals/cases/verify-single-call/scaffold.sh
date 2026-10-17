#!/usr/bin/env bash
# One spec with three runnable checklist items. Its three files exist, a thread is
# dispatched for it, and the Artifacts entry is written. Only verification is left.
# The thread id is a ULID, so the scaffold saves it in .eval-state/thread-id for the prompt.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../../lib/seed.sh"
seed_repo
seed_milestone demo "Demo"
spec="$(seed_spec demo "Add demo files" src/alpha.txt)"
cat > "$spec" <<'SPEC'
---
updated: 2026-10-08
depends_on: []
agent: unassigned
template: generic
---

# Add demo files

## Goal

Create three small text files in `src/`.

## Ground Truth

The repo is a demo. It has `README.md` and an empty `src/` folder. Nothing else exists.

## Overview

A tiny change with three independent checks.

## Requirements

- `src/alpha.txt` exists.
- `src/beta.txt` holds the word `beta`.
- `src/gamma.txt` holds exactly the line `gamma`.

## Verification Checklist

### Implementation

- [ ] Create `src/alpha.txt`
  - Command: `test -f src/alpha.txt`
  - Expected: `exit 0`
- [ ] Write `beta` into `src/beta.txt`
  - Command: `grep -q beta src/beta.txt`
  - Expected: `exit 0`
- [ ] Write `gamma` into `src/gamma.txt`
  - Command: `test "$(cat src/gamma.txt)" = gamma`
  - Expected: `exit 0`
SPEC
darius index --rebuild >/dev/null
id="$(darius worklog open M1-demo --spec "$spec" --message "Add three demo files" --stage planned | head -n1)"
darius worklog dispatch "$id" --agent main --reason "eval seed" >/dev/null
printf 'alpha\n' > src/alpha.txt
printf 'beta\n' > src/beta.txt
printf 'gamma\n' > src/gamma.txt
darius worklog append "$id" --section Artifacts --message "src/alpha.txt, src/beta.txt, src/gamma.txt" >/dev/null
printf '%s\n' "$id" > .eval-state/thread-id
