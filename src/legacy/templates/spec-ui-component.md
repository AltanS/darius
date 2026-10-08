---
updated: {{DATE}}
depends_on: []
agent: {{AGENT}}
template: ui-component
---

# {{COMPONENT_NAME}}

## Goal

{{ONE_SENTENCE_GOAL}}

## Ground Truth

<!-- REQUIRED before scoping: files read first-hand, commands run, findings with file:line. If claiming "X does not exist", name the search that failed AND the most likely home of X. -->

## Props / Inputs

- `{{PROP_1}}`: {{TYPE_1}} — {{DESC_1}}
- `{{PROP_2}}`: {{TYPE_2}} — {{DESC_2}}

## Behavior

- {{BEHAVIOR_1}}
- {{BEHAVIOR_2}}

## Verification Checklist

<!-- PATHS: every path in a `Command:` line — and anywhere in this spec — MUST be repo-relative (e.g. `src/x.ts`, NOT `/home/you/repo/src/x.ts`). Verification runs from the repo root, and tracker files are shared with other hosts and sessions, so an absolute path leaks your home-dir layout and won't run on any other machine. -->

### Implementation

- [ ] Component renders without crashing with default props
  - Command: `{{TEST_CMD}} -t renders`
  - Expected: `exit 0`
- [ ] Responds correctly to prop changes
  - Command: `{{TEST_CMD}} -t props`
  - Expected: `exit 0`
- [ ] Accessible — roles, labels, focus order
  - Command: `{{A11Y_CMD}}`
  - Expected: `exit 0`

### Integration Tests

- [ ] Works within parent layout without style bleed
  - Command: `{{VISUAL_CMD}}`
  - Expected: `exit 0`
- [ ] Keyboard navigation works
  - Command: `{{KEYBOARD_CMD}}`
  - Expected: `exit 0`
