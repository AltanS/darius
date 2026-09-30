# {{VIGIL_NAME}}

## Goal

<!-- TODO: what shipped, and what must hold true before this vigil can close? -->

## Trigger

This vigil is a **soak**: shipped code watching its first real-world exposure.
It stays **armed** until its gate fires — a `due:` date, an `until:` event, or
both (the date acting as a backstop when the event is slow to arrive). When the
gate fires the vigil becomes **due**: work the checklist below, then record a
verdict with `tracker vigil close <slug> --verdict held|failed`.

Lifecycle: **armed → due/triggered → work the checklist → close with a verdict**.
A `held` verdict means the shipped work survived its exposure; a `failed` verdict
means it did not.

**A failed verdict emits no automatic follow-up.** Route any remediation to a
new spec via `/tracker:add` — never bolt fixes onto the vigil itself. The vigil
only observes and records whether the shipped work held.

## Verification Checklist

<!-- The checks that confirm the shipped work held. Same checkbox + Command/
     Expected grammar as a spec, so the Work Loop can tick them.

     The scaffolded Commands below are DELIBERATE FAILURES — `test -f` on a path
     that will never exist. Replace each one with the real check before the gate
     fires. A placeholder that exits 0 (`echo todo`) reads like a check and is
     the reason 23 of 48 open vigils on this estate could never be closed;
     `tracker doctor` now FAILS on an armed vigil with no executable Command. -->

### Steps

- [ ] <!-- TODO: step 1 (e.g. grep prod logs for the guard marker) -->
  - Command: `test -f /nonexistent/replace-me-with-a-real-check`
  - Expected: `exit 0`
- [ ] <!-- TODO: step 2 (e.g. confirm no regressions surfaced) -->
  - Command: `test -f /nonexistent/replace-me-with-a-real-check`
  - Expected: `exit 0`
- [ ] Verdict recorded via `tracker vigil close`
  - Command: `test -f /nonexistent/replace-me-with-a-real-check`
  - Expected: `exit 0`

## Findings

<!-- Recorded when the vigil fires and you work the checklist. This body is the
     spec you work; a closed vigil keeps its file as the provenance record. -->
