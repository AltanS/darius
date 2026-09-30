---
status: Not Started
verified: 0/6
updated: 2026-04-28
depends_on:
  - M1-design-overhaul-benchmark/02-typescript-migration.md
agent: typescript:typescript-expert
template: generic
---

# Multi-Model Support

## Goal

Promote the --model flag to a first-class concept by defining a model registry and surfacing model choice through skills, env vars, and CLI flags.

## Overview

Currently the design plugin may hard-code a single model or treat the model as an ad-hoc string. This spec introduces a proper model registry that makes multi-model invocation explicit and extensible.

**Minimum registry entries:**
| Alias | Provider route | Notes |
|---|---|---|
| `gemini-3-pro` | `google/gemini-3-pro-image-preview` | Via OpenRouter |
| `gpt-5.4-image` | `openai/gpt-5.4-image-2` | Via OpenRouter |

The registry should live in a shared lib file (e.g. plugins/design/src/models.ts) so the benchmark runner (spec 05) and the core scripts both import from the same source of truth.

**Model choice priority (to be confirmed during implementation):**
1. Explicit CLI flag `--model <alias-or-full-id>`
2. Environment variable `DESIGN_MODEL` (or `OPENROUTER_DEFAULT_MODEL`)
3. Hardcoded default in registry (gemini-3-pro)

**Per-model differences to document:**
- Supported aspect ratios / output sizes
- Any param names that differ between models (e.g. `size` vs `aspect_ratio`)
- Rate limits or latency characteristics worth noting in the manifest

## Requirements

- Model registry defined in plugins/design/src/models.ts (or lib equivalent) with at minimum two entries
- Both generate_image.ts and edit_image.ts read model from flag → env var → default, in that priority order
- Skills expose model choice as an optional argument (documented in skill frontmatter or prompt body)
- Per-model param differences handled in the registry (not scattered across script code)
- README or inline JSDoc explains how to add a new model

## Verification Checklist

### Implementation

- [ ] Model registry file exists
  - Command: `test -f /home/user/projects/agent-plugins/plugins/design/scripts/lib/models.ts`
  - Expected: `exit 0`
- [ ] Registry contains at minimum two entries (gemini-3-pro and gpt-5.4-image)
  - Command: `grep -c "gemini-3-pro\|gpt-5.4-image" /home/user/projects/agent-plugins/plugins/design/scripts/lib/models.ts`
  - Expected: `stdout matches /^[2-9]/`
- [ ] generate_image.ts accepts --model flag
  - Command: `grep -q "\-\-model" /home/user/projects/agent-plugins/plugins/design/scripts/generate_image.ts`
  - Expected: `exit 0`
- [ ] Env var fallback implemented in registry
  - Command: `grep -qE "DESIGN_MODEL|OPENROUTER_DEFAULT_MODEL" /home/user/projects/agent-plugins/plugins/design/scripts/lib/models.ts`
  - Expected: `exit 0`

### Integration Tests

- [ ] Running generate_image.ts --dry-run with --model gemini-3-pro resolves cleanly
  - Command: `cd /home/user/projects/agent-plugins/plugins/design && node --disable-warning=ExperimentalWarning scripts/generate_image.ts --model gemini-3-pro --dry-run "test" 2>&1`
  - Expected: `stdout matches /gemini-3-pro|dry.run/i`
- [ ] Running generate_image.ts --dry-run with --model gpt-5.4-image resolves cleanly and skips image_config
  - Command: `cd /home/user/projects/agent-plugins/plugins/design && node --disable-warning=ExperimentalWarning scripts/generate_image.ts --model gpt-5.4-image --dry-run "test" 2>&1`
  - Expected: `stdout matches /gpt-5.4-image|dry.run/i`
