---
name: darius-candle
description: Choose between a candle, a finding, a vigil and a ritual, and set up a candle. Use when the operator says "check this every N days and tell me", "close it or light a candle", or "alert me when X fails"
allowed-tools: Bash
---

# Candles

A candle is a problem that needs the operator. It stays open until a person answers it, accepts it, or it goes out. A candle is only a result. It has no schedule and it does no work. A ritual, a vigil or a script does the check.

A line that starts with `!darius ...` is a shell command. Run it with Bash and use its output.

## Choose

- The operator must decide or follow up: a candle.
- The result is for the record: a finding in the result block of a run.
- One check at a date or after an event: a vigil.
- The same check again and again: a ritual.
- Not sure: ask which one the operator wants. Do not light a candle for every finding. An alert nobody needs trains the operator to ignore alerts.

## Recipe 1: check xyz every 7 days, light a candle if it finds something

1. Put a ritual in `.darius.toml`. Add `candle_deliver` only to change the channels.

   ```toml
   [rituals.check-xyz]
   title = "Check xyz"
   cadence = "1w"
   skill = "check-xyz"
   mode = "report"
   candle_deliver = ["push", "email"]
   ```

2. Write the skill `.claude/skills/check-xyz/SKILL.md`. It does the check. It ends with a `darius-result` block. Each problem that needs the operator is an item with `"candle": true`, a stable `key` and the state `needs-decision`:

   ```darius-result
   {"v":1,"status":"attention","summary":"One package has a known hole.","items":[{"title":"Package foo has a known hole","severity":"high","state":"needs-decision","key":"xyz/foo-cve","target":"web/package.json","candle":true}]}
   ```

3. Report the same key with the flag in every run while the problem stands. When the problem is fixed, report it with the state `fixed` and the flag. That puts the candle out. A candle also goes out after two complete runs that do not report it.
4. Commit `.darius.toml`, then run `!darius ritual reconcile`. Start a first run with `!darius run now check-xyz`.

Rules for the skill:

- The key is one line of at most 120 characters. A longer key is refused. The same problem keeps the same key. A key that changes starts a new candle.
- The state must be `needs-decision`, or `fixed`. Any other state with the flag is refused.
- The run prompt lists the open candles of the ritual under `## Open candles`. Reuse those keys.
- A candle item is no finding. Do not also ask a question about the same matter, or the operator is alerted twice.

## Recipe 2: a vigil in 7 days, close it or light a candle

`kinds` in `.darius.toml` must list `vigil`. Without it `--in` and `--candle` are refused.

```bash
darius vigil add xyz --in 7d --candle high --stdin < body.md
darius vigil add xyz --in 7d --candle high --candle-deliver push,email --stdin < body.md
darius vigil set xyz --candle medium    # change it
darius vigil set xyz --no-candle        # remove it
```

- The body has a `## Verification Checklist`. Each item has a `Command:`, a shell command. A check that needs judgment is a ritual, not a vigil.
- A daily sweep runs the Commands. All pass: the vigil closes as held, and a candle it lit is blown out. A check fails: the candle `vigil:xyz` lights, and the vigil keeps watching.
- The candle has the key `vigil:xyz` and needs a person. `candle accept vigil:xyz` also closes the vigil. `candle answer vigil:xyz` leaves it armed.
- `--candle` needs a date (`--due` or `--in`) or a `--gate-command`.
- A command such as `check || darius candle light` does not work. The check passes, so the vigil closes.

## A script or a CI job

```bash
darius candle light dep/cve-1 --title "Vulnerable dependency" --severity high --target web/package.json --source ci:nightly --deliver push,email
```

- `--stdin` stores a body. Light the same key again at the same or a lower severity: nothing is sent, the candle counts the report. A higher severity, or a light after the candle was out, sends again.
- A script on the tailnet can call `POST /api/candle/light` instead. The README shows the request.
- A candle from a script never goes out by itself. A person ends it with `candle blow-out`, or closes it with `answer` or `accept`.

## Delivery

- A ritual: `candle_deliver` in `.darius.toml`. A vigil: `--candle-deliver`. The CLI: `--deliver`. Each takes `push`, `email`, or `none`.
- `none` means the app only. Default is `push`.
- Email needs `darius email set` on each host that sends. Without it darius notes "not set up on host" once per notice, and the candle still shows in the app. `darius email set` says how many open candles it could not send.
- A run cannot choose a channel. Only the marker can. Every host must run the same version first.

## What a run never does

A run never runs `candle light`, `answer`, `accept`, `blow-out` or `relight`, and never `email set`. The gate denies them. A run reports through the result block only. A run may read: `darius candle list` and `darius candle show <key>`.

A person (or a session with a person) answers: `darius candle answer <key> --note "..."`, with `--follow-up` to start a run that carries out the proposal. `accept` closes the candle as a risk the operator takes.
