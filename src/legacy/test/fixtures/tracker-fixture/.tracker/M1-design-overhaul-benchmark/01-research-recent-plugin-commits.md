---
status: Not Started
verified: 0/3
updated: 2026-04-28
depends_on: []
agent: Explore
template: generic
research_only: true
---

# Research: Recent Plugin Commits Audit

## Goal

Audit the last ~30 commits across plugins/tracker/, plugins/typescript/, and root config to extract structural patterns the design plugin should adopt or avoid.

## Overview

Recent work on the tracker and typescript plugins introduced a set of conventions that are not yet reflected in the design plugin: hook wiring style, plugin.json field layout, agent frontmatter shape, skill `context:` decisions, and version-bump discipline. Before migrating anything, we need a written record of those patterns so the implementation specs (02–05) can reference it.

**This is a research-only spec. No code must be written or changed.**

Commits in scope (use as starting points — follow the full ~30-commit window):
- ee9fb1a..d810872 (tracker v7, parallel loop, verify grammar, drift hook, lessons)
- 273203d — structural fix
- 9e13a62 — structural fix
- 3625865 — structural fix
- cfa3966 — structural fix
- ceed103 — structural fix

## Requirements

- Examine git log and diffs for plugins/tracker/, plugins/typescript/, and root-level config files within the commit range
- Produce a written summary (see Deliverable below) covering all six topic areas
- Do not touch any source files

## Deliverable

A written audit summary appended to this spec (or recorded in the worklog thread) covering:

1. **Hook wiring** — How hooks.json is structured, what the top-level `hooks` key wraps, how PreToolUse/PostToolUse matchers are written
2. **plugin.json structure** — Field order, required vs optional fields, how `skills`/`agents`/`hooks` are typed (string vs string[])
3. **Agent frontmatter** — Which YAML keys appear in agents/*.md, what the `context:` field values mean and when each is used
4. **Skill `context:` decisions** — When `fork` vs `new` is chosen and why
5. **Version-bump discipline** — When patch/minor/major is used, whether both plugin.json and marketplace.json must be bumped, the `(vX.Y.Z)` suffix convention in commit messages
6. **Lessons for design** — Specific things the design plugin is currently doing that conflict with these patterns, plus recommended changes

## Verification Checklist

### Implementation

- [ ] Git log and diffs for the commit range have been examined
  - Command: `git -C /home/user/projects/agent-plugins log --oneline ee9fb1a..HEAD -- plugins/tracker/ plugins/typescript/ .claude-plugin/ | wc -l`
  - Expected: `stdout matches /\d+/`
- [ ] Written audit summary exists covering all six topic areas
  - Command: `grep -q "Hook wiring" /home/user/projects/agent-plugins/.tracker/worklog/M1-01-research-recent-plugin-commits.md 2>/dev/null || grep -q "Hook wiring" /home/user/projects/agent-plugins/.tracker/M1-design-overhaul-benchmark/01-research-recent-plugin-commits.md`
  - Expected: `exit 0`

### Integration Tests

- [ ] Summary reviewed and approved by a human before marking spec complete
  - Command: `grep -q "status: Verified" /home/user/projects/agent-plugins/.tracker/M1-design-overhaul-benchmark/01-research-recent-plugin-commits.md`
  - Expected: `exit 0`
