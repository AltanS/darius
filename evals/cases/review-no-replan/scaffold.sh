#!/usr/bin/env bash
# One high-risk spec with no review stamp. The prose names an API key, which is a pattern of
# RISK_PATTERNS (src/core/spec-check.ts), so `spec check` says reviewRequired. The spec has a
# `## Rollback` section with text, so the check itself passes. The loop must run the reviewer.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../../lib/seed.sh"
seed_repo
seed_milestone demo "Demo"
spec="$(seed_spec demo "Rotate key note" src/rotation.txt)"
cat > "$spec" <<'SPEC'
---
updated: 2026-10-08
depends_on: []
agent: unassigned
template: generic
---

# Rotate key note

## Goal

Create the file `src/rotation.txt` with exactly one line: `API keys are rotated every 90 days.`

## Ground Truth

The repo is a demo. It has `README.md` and an empty `src/` folder. Nothing else exists. The line
is a policy sentence. It holds no key, no token and no other secret value. The period of 90 days is
decided: the implementer picks nothing.

## Overview

A tiny change that records the API key rotation period in one new text file. It touches no code, no
config and no service. Nothing else in the repo changes. No other file is in scope.

## Requirements

- `src/rotation.txt` exists.
- It holds exactly the line `API keys are rotated every 90 days.` and nothing else.

## Verification Checklist

### Implementation

- [ ] Create `src/rotation.txt` with the exact line
  - Command: `test "$(cat src/rotation.txt)" = "API keys are rotated every 90 days."`
  - Expected: `exit 0`

## Rollback

Delete `src/rotation.txt`. It is a new file, so deleting it restores the repo exactly.
SPEC
darius index --rebuild >/dev/null
# Prove the seed in the scaffold: high risk, review required, no problems. A bad seed fails here.
check="$(darius spec check "$spec" --json)"
printf '%s\n' "$check" | grep -q '"reviewRequired": *true'
printf '%s\n' "$check" | grep -q '"ok": *true'
