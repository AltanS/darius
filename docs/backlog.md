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

## Web

- An answer form on the run page. Needs a write path with its own security design (CSRF, who may
  answer); the page is read-only today.
- A vigil detail page.

## Architecture

- The central server, with a service per host and the djinns (paused discussion).
