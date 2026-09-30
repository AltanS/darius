---
status: Not Started
verified: 0/5
updated: 2026-04-28
depends_on:
  - M1-design-overhaul-benchmark/03-multi-model-support.md
agent: typescript:typescript-expert
template: generic
---

# Example Infographic Benchmark Fixture

## Goal

Build the benchmark fixture directory under plugins/design/benchmarks/example-infographic/ containing a canonical infographic prompt and expected output spec, ready to be fed into the benchmark runner.

## Overview

The benchmark needs a fixed, reproducible input so model outputs are comparable across runs. This spec creates that fixture.

**Regulation brief dependency:** An example regulation summary (`regulation-brief.md`) is being authored in a parallel research task. It will be dropped at:

```
plugins/design/benchmarks/example-infographic/regulation-brief.md
```

This spec must not be marked complete until that file exists. The canonical infographic prompt must reference and consume the brief.

**Fixture structure to create:**
```
plugins/design/benchmarks/example-infographic/
  regulation-brief.md          ← dropped by parallel research task (not authored here)
  prompt.md                    ← canonical infographic generation prompt
  fixture.json                 ← expected output spec (dimensions, aspect ratio, format)
  README.md                    ← explains the fixture and how to use it
```

**Canonical prompt requirements:**
- Written in German (Deutsch) — the infographic audience is German-speaking
- Instructs the model to produce a regulation summary infographic
- References the regulation-brief.md content (either by inclusion or by instruction to read it)
- Specifies output dimensions / aspect ratio explicitly (to be determined based on spec 03 model capabilities)
- Produces a "coherent infographic suitable for visual comparison" — i.e., structured layout, readable text, on-brand colors appropriate for a German regulatory context

## Requirements

- plugins/design/benchmarks/example-infographic/ directory exists
- prompt.md contains a valid, runnable canonical prompt
- fixture.json specifies: output format (PNG), dimensions, aspect ratio, and any model-agnostic params
- README.md explains fixture purpose, how regulation-brief.md is sourced, and how to run the fixture manually
- Spec is not marked complete until regulation-brief.md is present (from parallel task)

## Verification Checklist

### Implementation

- [ ] Benchmark fixture directory exists
  - Command: `test -d /home/user/projects/agent-plugins/plugins/design/benchmarks/example-infographic`
  - Expected: `exit 0`
- [ ] prompt.md exists and contains German text
  - Command: `test -f /home/user/projects/agent-plugins/plugins/design/benchmarks/example-infographic/prompt.md && grep -q "[äöüÄÖÜß]" /home/user/projects/agent-plugins/plugins/design/benchmarks/example-infographic/prompt.md`
  - Expected: `exit 0`
- [ ] fixture.json exists and specifies output format and dimensions
  - Command: `jq -e '.format and .dimensions' /home/user/projects/agent-plugins/plugins/design/benchmarks/example-infographic/fixture.json`
  - Expected: `exit 0`
- [ ] regulation-brief.md is present (from parallel research task)
  - Command: `test -f /home/user/projects/agent-plugins/plugins/design/benchmarks/example-infographic/regulation-brief.md`
  - Expected: `exit 0`

### Integration Tests

- [ ] Running the canonical prompt via generate_image.ts dry-run produces a valid request body
  - Command: `cd /home/user/projects/agent-plugins/plugins/design && node --disable-warning=ExperimentalWarning scripts/generate_image.ts --prompt-file benchmarks/example-infographic/prompt.md --aspect-ratio 9:16 --size 2K --dry-run /tmp/discard.png 2>&1`
  - Expected: `stdout matches /dry.run|9:16|gemini/i`
