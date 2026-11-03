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

## Candles: cut from the first version

The candle design note (2026-11-01) left these out on purpose. Candles shipped in 0.106.0 to 0.113.0.

- Model-free command rituals: a ritual that runs a shell command with no model. This is the real cost fix for a simple check; today a check of this kind costs a model run, or a vigil.
- Reminders: nothing alerts again for a candle that stays open.
- Delivery by severity: the channels depend on the candle's severity. Today the channel list is per ritual, vigil or call.
- SMTP: the email channel is HTTP JSON only. SMTP would go behind the same `sendEmail` function.
- Tokens for callers outside the tailnet: `POST /api/candle/light` takes a tailnet identity only.
- TUI rows: the Due screen lists lit candles, with answer and accept keys.
- Address filters: status, ritual and severity in the address of the Candles place.
- The list of open candles on the ritual page.
- A test button for email in Settings, Notifications (`POST /api/email/test`). `darius email test` is the CLI path.
- A relight API: `candle relight` and `candle blow-out` are CLI only.
- Follow-up for a candle from outside: `answer --follow-up` needs a newest report from a run. A candle from a script or a vigil has no parent run.

## Run isolation

What the gate and the mask cannot do (concept, "What the gate does not stop").

- A full boundary for runs: a separate Unix user for runs, and a broker that writes the store for them. This is a design decision for the operator, not a feature to pick up by default. It costs a second user on every host, a new daemon that every write verb goes through, a second login for the harness, and every checkout readable and writable by that user. It is the only thing that stops a hostile run. A token in the web page does not help, because a run can fetch the page.
- Vigil sweep Commands in the box. A vigil checks private hosts, so a sweep in the box needs its own `reach`. Today the sweep runs outside the box.
- Git commits from a boxed run. `.git` is read-only in the box, so a run cannot commit. The options are a broker verb that commits for the run after a check of the diff, or an opt-in per ritual that leaves `.git` writable. Either one weakens the `.git` guard, so it needs its own decision.
- A separate Unix user for runs stays a note. The box blocks writes, sockets and the network without it. The user would still add a real identity boundary, at the cost named above.
- Harness adapters beyond Claude Code (Codex, opencode, pi) need three fields before they run in the box: `boxWritable` (the login and session paths that persist), `boxScratch` (the per-run folders that must be empty) and `boxHosts` (the API hosts for every `net` mode). `boxCopies` and `boxEnv` too. Without them a ritual that names such a harness cannot be boxed.
- S3 bucket versioning, as protection against a run that deletes data. A delete keeps the older version, so the bucket survives what the mask does not stop.
- A Tailscale ACL as the cross-host step: a run host reaches only the ports it needs on other hosts, so a run on one host cannot call the web API of another.

## Marker v3 follow-ups

Left out of the v3 design on purpose (design section 14).

- `dir` on a ritual (a working directory inside the checkout).
- Weekday lists (`days = [...]`). `cadence = "1w"` with `from` on a Monday gives a weekly Monday ritual.
- More than one `at` per ritual: use two rituals.
- A due window that expires a missed occurrence. Today nothing expires.
- Store policies and a policy library across repos.
- `.mcp.json` forwarding and phase 3 vigils.
- The web shows the policy name of a repo ritual. The store keeps only the resolved policy, so this needs the name mirrored by reconcile.

## Architecture

- The central server, with a service per host and the djinns (paused discussion).
