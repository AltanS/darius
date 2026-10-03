# Marker v3: rituals in git

A marker with `v = 3` can define rituals and policies. `darius marker check` checks them, and the
run-due timer runs them (see "How a v3 marker runs"). Root `tz` is required. Hosts need 0.53.0 or
later before a v3 marker is committed.

```toml
# .darius.toml
v = 3
project = "acme-web"
max_mode = "act"
tz = "Europe/Berlin"

[profiles.watch]
surface = "herdr"
permissions = "skip"

[defaults]
ritual = "watch"
follow_up = "watch"

[policies.read-only]
mode = "report"
may = [
  "Bash(cd tools)",
  "Bash(pnpm cli *)",
  "Bash(date *)",
]
hold = ['\bdeploy\b', '--confirm\b']
on_hold = "deny"

[rituals.daily-report]
title = "Daily site report"
cadence = "1d"
at = "07:00"
skill = "daily-report"
policy = "read-only"
timeout = "30m"

[rituals.weekly-audit]
title = "Weekly audit"
cadence = "1w"
from = "2026-10-05"
at = "09:05"
tz = "UTC"
skill = "weekly-audit"
mode = "act"
may = ["Bash(cd tools)", "Bash(pnpm cli *)"]
hold = ['\bdeploy\b']
notes = "Never push. Hand in a diff."
model = "opus"
max_turns = 200
```

Arrays may span lines. `'...'` is a literal string: nothing is escaped, so a regex keeps its
backslashes. A `'` inside one is not allowed.

`"""..."""` is a multi-line string, as in the TOML spec, for a long `notes` text. A newline right
after the opening `"""` is dropped. Other newlines stay. A backslash at the end of a line drops that
newline and the spaces before the next word. One or two quotes may sit inside; the string ends at
the first `"""` that is not escaped. Wrapping a value one way or the other never changes the
ritual's definition hash, because the hash covers the value. An unterminated one is an error that
names the line it opened on.

```toml
notes = """
Never push.
Hand in a diff.
"""
```

Root keys:

| Key | Rule |
|---|---|
| `v` | 1, 2 or 3. `tz`, `[rituals.*]` and `[policies.*]` need 3. `[profiles.*]` and `[defaults]` need 2 or 3. |
| `project` | The project name. |
| `max_mode` | `off`, `report` or `act`. The ceiling for every ritual. A ritual with `mode = "act"` needs `max_mode = "act"`. |
| `tz` | Required when `v = 3`. An IANA zone name, such as `Europe/Berlin`. |

`[rituals.<slug>]` takes a slug of lowercase letters, digits, `-` and `_` (at most 64, no dots):

| Key | Required | Rule |
|---|---|---|
| `title` | yes | Non-empty text. |
| `cadence` | no | `Nd`, `Nw` or `Nm`, such as `1d` or `2w`. Without it the ritual is on demand: only `run now` starts it. `at` and `from` need it. |
| `skill` | yes | The name of a skill in `.claude/skills/<skill>/SKILL.md`. The procedure is the skill; git holds no body. |
| `args` | no | Input for the skill, such as `args = "--site acme"`. One line, at most 256 characters, not empty. The run prompt passes it on under `## Arguments`, right after the skill. It is input, not procedure. It is part of the definition. |
| `anchor` | no | `due` (default) or `completion`. |
| `at` | no | `HH:MM`, 24 hour. In the ritual's `tz`, else the root `tz`. |
| `tz` | no | An IANA zone name. Overrides the root. |
| `from` | no | `YYYY-MM-DD`. The first date of the cadence grid. |
| `timeout` | no | `<N>m` or `<N>h`, from `1m` to `12h`. The budget of one run. |
| `profile`, `model`, `max_turns` | no | As on a v2 ritual. |
| `policy` | no | Names a `[policies.<name>]` table. Do not combine it with `mode`, `may`, `hold` or `on_hold`. Its `notes` may be combined with it. |
| `mode` | no | `off` (default), `report` or `act`. Not above `max_mode`. |
| `may` | no | A list of Claude Code permission rules, such as `Bash(date *)` or an MCP tool name such as `mcp__some-server__get_thing`. A tool name may hold `-` after its first character. |
| `hold` | no | A list of regular expressions. Each must compile with the `u` flag. |
| `on_hold` | no | `stop` (default) or `deny`: what a `hold` match or a report-mode write verb does in a run. `stop` holds the run until a person answers. `deny` refuses that one call with a reason that names the pattern or the verb, and the run goes on; the model records the command as a needs-decision item. The command never runs either way. A run can still hold itself with `darius run hold`. |
| `notes` | no | Plain text, or a `"""` string. Keep it short: over 300 characters `marker check` warns. With a `policy`, the policy's notes come first, then a blank line, then these. |
| `may_extra` | no | Rules to add to the `may` of the named policy, or of the ritual's own `may`. Same rules as `may`. |
| `hold_extra` | no | Patterns to add to the `hold` of the named policy, or of the ritual's own `hold`. Same rules as `hold`. |

`[policies.<name>]` takes `mode` (required), `may`, `hold`, `notes` and `on_hold`, with the same rules.
A policy's `on_hold` applies to every ritual that names the policy.
`may_extra` and `hold_extra` only add. The effective `may` is the base `may` and then the
extra rules; `hold` works the same way. A rule that is already there appears once. An extra can
never remove a rule, so a ritual never has fewer `hold` patterns than its policy. The mode stays
the base mode. The run, reconcile and the web all use the effective lists.
Unknown keys and sections are errors that name the file and line.

Check a marker before you commit it:

```bash
darius marker check          # the marker at or above the working directory
darius marker check ../repo  # the marker in another checkout
darius marker check --resolved daily-report  # the effective policy of one ritual
```

It prints `ok: v3, 2 rituals, 1 policies`, or the first error as `file:line: message` and exit 1.
A ritual whose skill file `.claude/skills/<skill>/SKILL.md` is missing in this checkout is an
error too (exit 1): the timer would skip it as `skill-missing`. Warnings do not change the exit
code: a policy no ritual uses, a v3 marker with no rituals, two rituals that share most of their
`hold` patterns (at least 5 in the shorter list, 80 percent of it in the other), and a `notes` text
over 300 characters. The overlap warning reads `[rituals.a] and [rituals.b] share 5 of 6 hold
patterns: factor into [policies.<name>] with hold_extra`, once per pair, and skips two rituals that
name the same `policy`. The notes warning says procedure belongs in the skill and rules in `hold`.
`--resolved <slug>` prints `mode:`, then `on_hold: deny` when the policy sets it, then
one `may:` and one `hold:` line per entry, each list sorted. An inline policy and a factored
one print the same lines. `darius link --list` adds `v3 (N rituals)` to a linked v3 checkout.

Every host must run 0.56.0 or later before a marker uses `may_extra` or `hold_extra`, and 0.57.0
or later before it uses `args` or a `"""` string, and 0.66.0 or later before it uses `on_hold`:
an older host refuses an unknown ritual key, and it cannot read a mirrored item that has `args`,
`on_hold` or a note with a newline.

## Factor shared rules

`darius marker factor` shows the fix for the overlap warning:

```bash
darius marker factor          # print a summary and a diff; write nothing
darius marker factor --write  # write .darius.toml; never runs git
```

It groups rituals with an inline policy (no `policy = "<name>"`) that have the same mode and
the same `on_hold`, and pass the overlap rule above. A group's `on_hold = "deny"` moves into its
new policy table. A group is every ritual linked to another by that rule, in file
order, with at least 2 rituals. The shared `may` and `hold` rules (the ones every member has) go
into a new `[policies.<mode>-base]` table, placed right before the first member's table. Each
member then names that policy and keeps only its own rules in `may_extra` and `hold_extra`. Its
`mode` line goes, because the policy holds the mode. Its `notes` stay on the ritual. Rituals
that already name a policy are never touched. The names are placeholders (`report-base`,
`report-base-2`, ...): rename them by hand. Comments, key order, blank lines and every other table
stay byte for byte.

Before it prints anything, it parses the proposed file and compares every ritual with the
current one: every field, the mode, the sorted `may` and `hold`, and the notes. Any difference
exits 1 and writes nothing. It also exits 1, naming the ritual, for a layout it does not edit: a
table written in two places, a key set twice, or a comment inside or after a moved value. Nothing
to group prints `nothing to factor`. `--write` refuses (exit 2) a marker that is not v3, fails
`marker check`, or has uncommitted changes. After a write, check each ritual with
`darius marker check --resolved <slug>` and commit. The resolved lists keep their entries but may
change order, so the next reconcile can report a factored ritual once as updated.
`--json` prints `{ ok, groups: [{ policy, rituals, may, hold }], proposed, diff, written, file }`.

## One skill, many rituals

Keep the procedure in the skill and the differences in the ritual:

- Variation is `args`. Two rituals may name one skill with `args = "--site acme"` and
  `args = "--site other"`.
- Chaining is two rituals. Step B runs on its own schedule or by hand after step A.
- A wrapper skill is for the case where step B needs the output of step A in the same session.
  Then list the union of the `may` rules of both steps on the ritual, so review sees what the
  wrapper may do.

## How a v3 marker runs

The timer fires every 15 minutes at `*:05/15` (:05, :20, :35, :50). A ritual with `at = "07:00"`
starts at the first tick after 07:00 in its zone. A host that was off starts it at its first tick
after boot. Before it judges a project, `run-due` reconciles the checkout's marker into the store:
each `[rituals.<slug>]` becomes a store item that mirrors git. You can do the same by hand:

```bash
darius ritual reconcile             # mirror this checkout's marker into the store
darius ritual reconcile --dry-run   # say what would change, write nothing
```

In a v3 project the file owns the ritual. `ritual add` is refused. `ritual set` changes only
`--host`, `--owner`, `--agent`, `--tag` and `--due`. For any other flag it names the file and line
to edit. `ritual retire` is refused for a repo ritual: remove the table and commit, and the next
reconcile retires it. A retired slug stays retired. Use a new slug if you want it back.
A store ritual that the marker does not name is `unmanaged`: it never runs from the timer.

## Move a project to v3

`darius ritual export` builds a v3 marker from the store rituals of a v2 project. It never commits.

```bash
darius ritual export             # print the v3 marker to stdout
darius ritual export --write     # write .darius.toml and the skill files in the linked checkout
```

It keeps the root keys, `[profiles.*]` and `[defaults]` of the current marker as they are, sets
`v = 3`, and adds `tz` with this host's zone. It adds one `[rituals.<slug>]` per active or paused
ritual. It leaves out retired rituals and never writes `host`. A ritual with no skill gets
`skill = "<slug>"`, and its body becomes `.claude/skills/<slug>/SKILL.md`. Policies are written
inline; you can move them into `[policies.<name>]` by hand. If `.claude/skills/<slug>/SKILL.md`
already exists in the checkout, it stays, and the store body becomes the skill `<slug>-ritual`
instead, with a warning.

Export stops with exit 2 when a slug has a dot or is not a v3 slug,
or when a `may` or `hold` value would not pass `marker check`. `--write` also stops when
`.darius.toml` or a target skill file has uncommitted changes, when the marker is already v3, or
when a target skill file exists (including `<slug>-ritual` after a `<slug>` collision).

1. Run `darius ritual export` and read the result. Rename any slug it refuses.
2. Run `darius ritual export --write` in the linked checkout of `acme-web`.
3. Run `darius marker check`. Review the files, commit and push.
4. On each host that runs the timer, pull the commit and run `darius ritual reconcile`.

A ritual's `timeout` replaces the unit's `--timeout` for that run, and the lease follows it.
`run-due` skips a ritual, and says why in its report:

| Skip | Meaning | Fails the batch |
|---|---|---|
| `marker-invalid` | `.darius.toml` does not parse. Every ritual of the project skips. | yes |
| `marker-dirty` | `.darius.toml` has uncommitted changes. `run now` warns and runs instead. | yes |
| `skill-missing` | `.claude/skills/<skill>/SKILL.md` is not in the checkout. | yes |
| `skill-dirty` | `.claude/skills/<skill>/` has uncommitted or untracked files. Only that ritual skips. `run now` warns and runs instead. | yes |
| `not-in-marker` | A store ritual that a v3 marker does not name. | no |
| `lease-held` | Another host holds the ritual lease. Exit 0. | no |
