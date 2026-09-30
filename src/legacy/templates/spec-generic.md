---
updated: {{DATE}}
depends_on: []
agent: {{AGENT}}
template: generic
---

# {{FEATURE_NAME}}

## Goal

{{ONE_SENTENCE_GOAL}}

## Ground Truth

<!-- REQUIRED before scoping: files read first-hand, commands run, findings with file:line. If claiming "X does not exist", name the search that failed AND the most likely home of X. -->

## Overview

{{WHAT_AND_WHY}}

<!-- If this spec changes a SHARED signature (job handle(), controller action, service/interface method) and tests cover its callers, forecast the test-update tail here: e.g. "≈N call sites + their tests need updating (grep -rc lower bound)". Forecast only — do NOT make it a [ ] task. Delete this comment if no shared signature changes. -->


## Requirements

- {{REQUIREMENT_1}}
- {{REQUIREMENT_2}}

## Verification Checklist

<!-- PATHS: every path in a `Command:` line — and anywhere in this spec — MUST be repo-relative (e.g. `src/x.ts`, NOT `/home/you/repo/src/x.ts`). Verification runs from the repo root and .tracker/ is committed, so an absolute path leaks your home-dir layout into git history and won't run on any other machine. -->

### Implementation

- [ ] {{TASK_1}}
  - Command: `{{CMD_1}}`
  - Expected: `exit 0`
- [ ] {{TASK_2}}
  - Command: `{{CMD_2}}`
  - Expected: `exit 0`

### Integration Tests

- [ ] {{INTEGRATION_1}}
  - Command: `{{INT_CMD_1}}`
  - Expected: `exit 0`
