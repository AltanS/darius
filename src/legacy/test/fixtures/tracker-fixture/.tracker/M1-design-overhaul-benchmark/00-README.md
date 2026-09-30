---
name: Design Plugin Overhaul & Image-Model Benchmark
slug: design-overhaul-benchmark
started: 2026-04-28
target: TBD
owner: user@example.com
status: Not Started
---

# Design Plugin Overhaul & Image-Model Benchmark

## Goal

Modernize the design plugin (plugins/design/ v1.5.7) to match patterns introduced by recent commits in other plugins, migrate Python scripts to TypeScript, and stand up a reproducible image-model benchmark comparing Gemini 3 Pro Image Preview vs openai/gpt-5.4-image-2 using a German example infographic fixture.

## Why this matters

The design plugin is the only plugin in the marketplace still using Python for its command scripts. Migrating to TypeScript aligns it with the patterns established by the tracker and typescript plugins, reduces the tool-chain surface, and makes skills/hooks consistent across the repo. The image-model benchmark gives the team a reproducible, human-eval-friendly way to compare models on a real-world task before committing to a default.

## Success criteria

- All Python scripts replaced by TypeScript equivalents with identical invocation contracts
- A model registry supports at minimum google/gemini-3-pro-image-preview and openai/gpt-5.4-image-2 as first-class targets
- The example-infographic benchmark fixture exists, the canonical prompt runs end-to-end, and side-by-side outputs are saved under a timestamped run directory
- Plugin structure, plugin.json, hook wiring, and version-bump discipline match the patterns identified in the audit specs

## Non-goals

- Automated quality scoring of model outputs (human-eval only)
- Changing skill UX or prompt behavior during the TypeScript migration
- Publishing benchmark results — this is internal tooling

## Specs in this milestone

<!-- rebuilt from file listing; do not edit manually -->

## Lessons

<!-- populated by /tracker:enrich when the milestone completes -->
