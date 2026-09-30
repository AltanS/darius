---
status: Not Started
verified: 0/6
updated: 2026-04-28
depends_on:
  - M1-design-overhaul-benchmark/01-research-recent-plugin-commits.md
agent: typescript:typescript-expert
template: generic
---

# TypeScript Migration of Python Scripts

## Goal

Replace scripts/generate_image.py and scripts/edit_image.py with TypeScript equivalents that have identical invocation contracts, mirroring the patterns used by the typescript plugin.

## Overview

The design plugin currently ships two Python scripts that are invoked by skills via Bash. These are the only Python artifacts in the marketplace. Migrating to TypeScript removes the Python runtime dependency, aligns the plugin with every other plugin in the repo, and opens the door for shared lib code across plugins.

The migration must be a pure refactor: the TypeScript entry points accept the same CLI arguments and produce the same outputs as the Python originals. Skill prompt text and user-facing behavior must not change.

**Decisions made during implementation:**
- Runtime: **Node ≥ 22.6** with built-in type-stripping (`node script.ts`). No `tsx`, no `bun`, no `ts-node`.
- Zero runtime deps achieved: native `fetch` (Node 18+), `util.parseArgs` (Node 18.3+), `node:fs`/`node:path`. `typescript` and `@types/node` listed as devDependencies for editor support / `tsc --noEmit` only.
- No build step — scripts run directly. Skills invoke with `node --disable-warning=ExperimentalWarning scripts/<name>.ts ...`.
- Shared logic extracted to `scripts/lib/openrouter.ts` (api key, request, streaming parser, image extraction, save).

## Requirements

- plugins/design/scripts/generate_image.ts replaces generate_image.py with identical CLI surface
- plugins/design/scripts/edit_image.ts replaces edit_image.py with identical CLI surface
- Skills (plugins/design/skills/*.md) updated to invoke the TS entry points via Bash
- Python scripts removed (or clearly marked deprecated with a removal note)
- package.json (or bun equivalent) added at plugins/design/ with correct entry points
- tsconfig.json added at plugins/design/ mirroring typescript plugin conventions
- No changes to skill prompt text or user-visible behavior

## Verification Checklist

### Implementation

- [ ] TypeScript entry point for generate_image exists
  - Command: `test -f /home/user/projects/agent-plugins/plugins/design/scripts/generate_image.ts`
  - Expected: `exit 0`
- [ ] TypeScript entry point for edit_image exists
  - Command: `test -f /home/user/projects/agent-plugins/plugins/design/scripts/edit_image.ts`
  - Expected: `exit 0`
- [ ] Skills reference the TS entry points (not .py) in their Bash invocations
  - Command: `grep -r "\.py" /home/user/projects/agent-plugins/plugins/design/skills/`
  - Expected: `exit 1`
- [ ] tsconfig.json present at plugins/design/
  - Command: `test -f /home/user/projects/agent-plugins/plugins/design/tsconfig.json`
  - Expected: `exit 0`
- [ ] package.json (or bun equivalent) present at plugins/design/
  - Command: `test -f /home/user/projects/agent-plugins/plugins/design/package.json || test -f /home/user/projects/agent-plugins/plugins/design/bunfig.toml`
  - Expected: `exit 0`

### Integration Tests

- [ ] TypeScript generate_image --help works under Node native TS execution
  - Command: `cd /home/user/projects/agent-plugins/plugins/design && node --disable-warning=ExperimentalWarning scripts/generate_image.ts --help 2>&1`
  - Expected: `stdout matches /prompt|usage|help/i`
