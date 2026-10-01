# Backlog: future features

Ideas that are agreed but deferred. Nothing here is being built now: until the migration is done,
work goes into the migration phases or into fixes from real use (docs/concept.md, "Migration
plan" > "Scope rule"). When an item is picked up, it moves into the concept with a decision, and
out of this file.

## Spend caps

A limit on what unattended runs may spend, per project and per day. Off by default: a cap of `0`
means no cap, so existing setups do not change when it ships.

- **Where the limit lives:** a key in the repo's `.darius.toml`, next to `max_mode`, because it is
  a limit and decision 9 lets the repo hold limits. For example `daily_usd = 0`. Maybe also a
  store-wide default in `_global`.
- **What it needs first:** cost tracking. Today a run's cost exists only in the batch report
  (`RitualEntry.costUsd`, from Claude's `total_cost_usd`). A cap needs it in the ledger, for
  example as `cost_usd` on `run.completed`, so that every host can add up one day's spend.
- **How run-due uses it:** before a run, add up today's `cost_usd` for the project. At or over the
  cap, skip the ritual with a new skip reason, `budget-exhausted`, which the report counts as news.
- **Subscription note:** on a flat subscription `total_cost_usd` is the API-equivalent figure, not
  a bill. A cap still limits how much of the shared usage window unattended runs may take.

## Harnesses and surfaces

- Codex, opencode and pi adapters (concept, "Harnesses, profiles and surfaces", research done).
- `darius harness check`, a canary that proves the gate per harness version; run-due would refuse
  `harness-unchecked`.
- The TUI profile screen and herdr plugin actions ("run this ritual now in a pane", "due list").
- Plain-command rituals: a ritual that runs a shell command, with no model.
- Approve a held command: an answer that lets the resumed run execute exactly the held command
  once. Today the gate holds it again, and the model hands it to the operator in the findings.
- The full policy guard: `policy-check` compares `policy.json` with the `policy_sha` of the run's
  start line for every run, not only for a run with grants (0.47.1). Needs an answer for runs
  started before 0.47.1, which have no sha.

## Web

- An answer form on the run page. Needs a write path with its own security design (CSRF, who may
  answer); the page is read-only today.
- A vigil detail page.

## Marker v3 follow-ups

Left out of the v3 design on purpose (design section 14).

- `dir` on a ritual (a working directory inside the checkout).
- Weekday lists (`days = [...]`). `cadence = "1w"` with `from` on a Monday gives a weekly Monday ritual.
- More than one `at` per ritual: use two rituals.
- A due window that expires a missed occurrence. Today nothing expires.
- Store policies and a policy library across repos.
- `.mcp.json` forwarding and phase 3 vigils.
- `darius marker factor`: a helper that reads a marker, finds rituals that share `hold` or `may` patterns, and prints a proposed `[policies.*]` rewrite with `hold_extra` and `may_extra` as a diff. It writes nothing. `marker check` already warns about the overlap; this would show the fix.
- The web shows the policy name of a repo ritual. The store keeps only the resolved policy, so this needs the name mirrored by reconcile.

## Architecture

- The central server, with a service per host and the djinns (paused discussion).
