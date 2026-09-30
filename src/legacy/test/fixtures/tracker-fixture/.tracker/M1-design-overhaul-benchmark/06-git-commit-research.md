---
status: Not Started
verified: 0/3
updated: 2026-04-28
depends_on: []
agent: Explore
template: generic
research_only: true
---

# Research: Git Commit Style Guide

## Goal

Survey how recent plugin commits structure their messages and produce a short style guide for design-plugin commits going forward.

## Overview

The repository has developed a consistent commit style across the tracker and typescript plugin work. Before the design plugin migration produces its own commit history, we should document that style so contributors follow it consistently.

**This is a research-only spec. No code must be written or changed.**

Topics to cover in the style guide:
- Conventional commits format (type(scope): subject line)
- The `(vX.Y.Z)` suffix pattern — when it appears and in which position
- Version-bump cadence — patch vs minor vs major triggers, with examples from the actual commit log
- Scope conventions — what scope strings have been used (e.g. `tracker`, `typescript`, `design`, `marketplace`)
- Multi-file commits — when to split vs combine (e.g. plugin.json + marketplace.json always together)
- How breaking changes are signaled

## Requirements

- Survey at minimum the commits in the range accessible via `git log --oneline` on this repo
- Produce a short style guide (500–1000 words, or a structured reference table) covering all six topics above
- The guide may be appended to this spec body, recorded in the worklog thread, or saved at .tracker/M1-design-overhaul-benchmark/commit-style-guide.md

## Deliverable

A short written style guide covering the six topics, with real examples drawn from the commit log.

## Verification Checklist

### Implementation

- [ ] Git log has been reviewed for the commit message patterns
  - Command: `git -C /home/user/projects/agent-plugins log --oneline -30 | wc -l`
  - Expected: `stdout matches /\d+/`
- [ ] Style guide written and available (in spec body, worklog, or companion file)
  - Command: `test -f /home/user/projects/agent-plugins/.tracker/M1-design-overhaul-benchmark/commit-style-guide.md || grep -q "Conventional\|conventional" /home/user/projects/agent-plugins/.tracker/M1-design-overhaul-benchmark/06-git-commit-research.md`
  - Expected: `exit 0`

### Integration Tests

- [ ] Style guide reviewed and approved by a human before marking spec complete
  - Command: `grep -q "status: Verified" /home/user/projects/agent-plugins/.tracker/M1-design-overhaul-benchmark/06-git-commit-research.md`
  - Expected: `exit 0`
