---
updated: {{DATE}}
depends_on: []
agent: {{AGENT}}
template: api-endpoint
---

# {{ENDPOINT_NAME}}

## Goal

{{METHOD}} {{PATH}} — {{ONE_SENTENCE_GOAL}}

## Ground Truth

<!-- REQUIRED before scoping: files read first-hand, commands run, findings with file:line. If claiming "X does not exist", name the search that failed AND the most likely home of X. -->

## Contract

- **Request**: {{REQUEST_SHAPE}}
- **Response (success)**: {{SUCCESS_SHAPE}}
- **Auth**: {{AUTH_REQUIREMENT}}
- **Rate limit**: {{RATE_LIMIT}}

## Verification Checklist

<!-- PATHS: every path in a `Command:` line — and anywhere in this spec — MUST be repo-relative (e.g. `src/x.ts`, NOT `/home/you/repo/src/x.ts`). Verification runs from the repo root and .tracker/ is committed, so an absolute path leaks your home-dir layout into git history and won't run on any other machine. -->

### Implementation

- [ ] Route registered at `{{PATH}}`
  - Command: `{{ROUTE_CHECK_CMD}}`
  - Expected: `exit 0`
- [ ] Request validation rejects malformed input
  - Command: `{{TEST_CMD}} -t validation`
  - Expected: `stdout matches /passed/`
- [ ] Handler returns correct success shape
  - Command: `{{TEST_CMD}} -t happy-path`
  - Expected: `exit 0`
- [ ] Unauthenticated requests return {{AUTH_FAIL_CODE}}
  - Command: `{{TEST_CMD}} -t auth`
  - Expected: `exit 0`

### Integration Tests

- [ ] End-to-end happy path against a running instance
  - Command: `{{E2E_CMD}}`
  - Expected: `exit 0`
- [ ] Error envelope matches API style guide on failure paths
  - Command: `{{ERROR_SHAPE_CMD}}`
  - Expected: `stdout matches /"error":/`
