# {{RITUAL_NAME}}

## Goal

<!-- TODO: what does each run of this ritual accomplish? -->

## Cadence

A run is **due** on or after the `due:` date. On completion the schedule rolls
forward by `cadence:` (e.g. `7d`, `2w`, `1m`); leave `cadence:` empty for an
on-demand ritual that goes dormant after each run. Each run is stamped into
`runs/<date>.md` and worked through the normal Work Loop.

**Remediation is not part of the ritual.** When a run surfaces work worth
fixing, the operator files it as an ordinary milestone via `/tracker:add` — the
ritual only analyzes and records findings.

## Verification Checklist

<!-- These steps are copied into every run. Keep them generic and repeatable. -->

### Steps

- [ ] <!-- TODO: step 1 (e.g. analyze logs) -->
  - Command: `echo todo`
  - Expected: `exit 0`
- [ ] <!-- TODO: step 2 (e.g. investigate errors) -->
  - Command: `echo todo`
  - Expected: `exit 0`
- [ ] Findings recorded in this run's Findings section
  - Command: `echo todo`
  - Expected: `exit 0`

## Findings

<!-- Recorded during each run. -->
