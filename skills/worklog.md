---
name: darius-worklog
model: sonnet
description: Manage worklog threads in the tracker's worklog/ folder for persistent inter-agent context sharing
user-invocable: false
allowed-tools: Bash
---

# Worklog

Internal skill for reading and writing worklog threads. Referenced by darius-work, darius-wrap-up, and darius-archive.

A line that starts with `!darius ...` is a shell command. Run it with Bash and use its output. Worklog files live in the `worklog/` folder of the tracker tree. `darius root --json` prints the tree (`trackerRoot`). Paths in this skill are tracker-relative. In store mode the tree is not in the checkout and not in git.

### `open`, start a new thread
`!darius worklog open <milestone-slug> --spec <spec-path> [--message "<text>"]`
A worklog belongs to a milestone. `open` needs a slug that names an active milestone folder (`M68-framework-quality` or `framework-quality`) and refuses any other slug, and an archived milestone. Findings with no milestone go in a plain doc in the repo, not in the tracker tree.
**One thread per spec.** List the active threads first and reuse the one whose `specPath` matches. `specPath` is tracker-relative in store mode, whatever form you typed. In git mode it shows as stored, `M1-x/01-y.md` or `.tracker/M1-x/01-y.md`: both name one spec, so compare them without the `.tracker/` prefix.
`open --spec` refuses a spec another live session claimed. `--takeover` overrides it; use it only when the user says so. A `--session` that is not the env session id is refused. `--as-other-session` lets you act for it, and the CLI records that on the thread.
Returns the generated `thread-id`. The slug becomes the filename (`<slug>.md`) and the thread label; `--message` becomes the thread's first entry and is what the index shows as the file's hook, so make it describe the work. Slugs starting with `00-` are refused, see `index`.

### `append`, add an update to an existing thread
`!darius worklog append <thread-id> --section "<Updates|Artifacts|note|blocker>" --message "<text>"`
`--section Artifacts` records the files the work changed. Give repo-relative paths, separated by commas or by new lines. A glob, `.` or a path outside the project is refused. `set-stage committed` checks these paths.
A review is a note: `--section note --message "Review: pass, matches the spec intent"`. It starts with `Review:` and has at least 3 more words, or `set-stage reviewed` refuses it.

### `close`, complete or block a thread
`!darius worklog close <thread-id> --status <done|blocked|cancelled>`
Use `done` only for a thread already at stage `reviewed`. `close` does not check the stage, and it never replaces the evidence stages. Work you cannot finish is parked (`park --reason`), not closed `done`.

### `set-stage`, `dispatch`, `park`, move a thread through the Work Loop
`!darius worklog set-stage <thread-id> <planned|dispatched|verified|committed|reviewed>` moves a thread forward. Each evidence stage needs its proof: `verified` needs passing ledger lines, `committed` needs a commit that touches an artifact (`--commit <sha>`), or `--no-code "<reason>"` when no code changed. `reviewed` needs the `Review:` note. `--force --reason "<why>"` skips the proof and marks the stamp `forced`. Never use it to silence the exit gate.
`!darius worklog dispatch <thread-id> --agent <invocable> --reason "<why>"` stamps `dispatched`. With an empty agent roster use `--agent main`.
`!darius worklog park <thread-id> --reason "<why>"` closes a thread you will not finish.

### `list`, read threads
`!darius worklog list [--active] [--milestone <slug>] [--json]`

### `index`, `distill`
`!darius worklog index` rewrites the worklog index; never hand-edit it. `distill` belongs to `/darius-dream`.

**Security:** Worklog files are shared with other hosts and agents: synced through the darius store when the project owns the tracker tree (in git mode, committed). Never write API keys, tokens, passwords, connection strings with credentials, `.env` contents, session cookies, or any sensitive value. Scrub command output before pasting.
