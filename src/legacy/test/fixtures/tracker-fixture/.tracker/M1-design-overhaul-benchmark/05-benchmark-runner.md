---
status: Not Started
verified: 0/6
updated: 2026-04-28
depends_on:
  - M1-design-overhaul-benchmark/04-example-infographic-fixture.md
agent: typescript:typescript-expert
template: generic
---

# Benchmark Runner

## Goal

A script (or skill) that runs the canonical benchmark prompt against multiple models, saves side-by-side output images under a timestamped run directory, and writes a manifest file.

## Overview

After specs 02–04 are complete, we have TypeScript scripts, a model registry, and a fixture. This spec wires them together into a single invocable benchmark runner.

**Output structure per run:**
```
plugins/design/benchmarks/example-infographic/runs/
  <ISO-timestamp>/
    manifest.json              ← run metadata
    gemini-3-pro.png           ← output for first model
    gpt-5.4-image.png          ← output for second model
    <additional-model>.png     ← extensible
```

**manifest.json schema (minimum):**
```json
{
  "run_id": "2026-04-28T14:30:00Z",
  "fixture": "example-infographic",
  "prompt_file": "benchmarks/example-infographic/prompt.md",
  "models": [
    {
      "alias": "gemini-3-pro",
      "full_id": "google/gemini-3-pro-image-preview",
      "output_file": "gemini-3-pro.png",
      "params": {},
      "duration_ms": 4200,
      "status": "ok"
    }
  ]
}
```

**Invocation target:** should be runnable as `bun run benchmark` (or equivalent) from plugins/design/, and ideally also exposed as a skill `/design:benchmark` (optional — flag as stretch goal if time-constrained).

## Requirements

- plugins/design/scripts/benchmark.ts (or benchmark-runner.ts) exists
- Accepts optional --models flag to override which models to run (default: all in registry)
- Accepts optional --fixture flag (default: example-infographic)
- Saves output to benchmarks/<fixture>/runs/<timestamp>/<model-slug>.png
- Writes manifest.json in the same run directory
- Exits non-zero if any model call fails (manifest records individual statuses)
- Human-eval only — no automated scoring

## Verification Checklist

### Implementation

- [ ] Benchmark script exists
  - Command: `test -f /home/user/projects/agent-plugins/plugins/design/scripts/benchmark.ts`
  - Expected: `exit 0`
- [ ] Script accepts --models flag (check argument parsing)
  - Command: `grep -q "\-\-models" /home/user/projects/agent-plugins/plugins/design/scripts/benchmark.ts`
  - Expected: `exit 0`
- [ ] Script accepts --fixture flag
  - Command: `grep -q "\-\-fixture" /home/user/projects/agent-plugins/plugins/design/scripts/benchmark.ts`
  - Expected: `exit 0`
- [ ] package.json includes a "benchmark" script entry
  - Command: `jq -e '.scripts.benchmark' /home/user/projects/agent-plugins/plugins/design/package.json`
  - Expected: `exit 0`

### Integration Tests

- [ ] Running with --dry-run creates the run directory and manifest skeleton
  - Command: `cd /home/user/projects/agent-plugins/plugins/design && node --disable-warning=ExperimentalWarning scripts/benchmark.ts --fixture example-infographic --dry-run 2>&1 | tail -3`
  - Expected: `stdout matches /manifest|dry.run/i`
- [ ] manifest.json output contains required top-level keys
  - Command: `find /home/user/projects/agent-plugins/plugins/design/benchmarks/example-infographic/runs -name manifest.json | head -1 | xargs jq -e '.run_id and .models'`
  - Expected: `exit 0`
