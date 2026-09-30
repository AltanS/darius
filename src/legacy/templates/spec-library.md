---
updated: {{DATE}}
depends_on: []
agent: {{AGENT}}
template: library
---

# {{LIBRARY_NAME}}

## Goal

{{ONE_SENTENCE_GOAL}}

## Ground Truth

<!-- REQUIRED before scoping: files read first-hand, commands run, findings with file:line. If claiming "X does not exist", name the search that failed AND the most likely home of X. -->

## Public API

- `{{EXPORT_1}}({{SIGNATURE_1}})` — {{DESC_1}}
- `{{EXPORT_2}}({{SIGNATURE_2}})` — {{DESC_2}}

## Invariants

- {{INVARIANT_1}}
- {{INVARIANT_2}}

## Verification Checklist

<!-- PATHS: every path in a `Command:` line — and anywhere in this spec — MUST be repo-relative (e.g. `src/x.ts`, NOT `/home/you/repo/src/x.ts`). Verification runs from the repo root and .tracker/ is committed, so an absolute path leaks your home-dir layout into git history and won't run on any other machine. -->

### Implementation

- [ ] All exports type-check
  - Command: `{{TYPECHECK_CMD}}`
  - Expected: `exit 0`
- [ ] Unit tests cover happy paths and edge cases
  - Command: `{{UNIT_CMD}}`
  - Expected: `stdout matches /\d+ passed/`
- [ ] No exported symbol goes unused by consumers
  - Command: `{{USAGE_CHECK_CMD}}`
  - Expected: `exit 0`

### Integration Tests

- [ ] Downstream consumer compiles and runs against this library
  - Command: `{{INTEGRATION_CMD}}`
  - Expected: `exit 0`
