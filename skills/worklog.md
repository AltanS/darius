---
name: darius-worklog
model: sonnet
description: Manage worklog threads in the tracker's worklog/ folder for persistent inter-agent context sharing
user-invocable: false
allowed-tools: Bash
---

# Worklog

**Before anything else**, run this line with Bash. If it prints a message, show the message to the user and stop.

```bash
command -v darius >/dev/null || { echo "darius is not installed. Install it: bash <(curl -fsSL https://raw.githubusercontent.com/AltanS/darius/main/scripts/install.sh)"; exit 1; }
```

Internal skill for reading and writing worklog threads. Referenced by darius-work, darius-wrap-up, and darius-archive.

A line that starts with `!darius ...` is a shell command. Run it with Bash and use its output. Worklog files live in the `worklog/` folder of the tracker tree. `darius root --json` prints the tree (`trackerRoot`). Paths in this skill are tracker-relative. In store mode the tree is not in the checkout and not in git.

### `open`, start a new thread
`!darius worklog open <milestone-slug> --spec <spec-path> [--message "<text>"]`
A worklog belongs to a milestone. `open` needs a slug that names an active milestone folder (`M68-framework-quality` or `framework-quality`) and refuses any other slug, and an archived milestone. Findings with no milestone go in a plain doc in the repo, not in the tracker tree.
**One thread per spec.** List the active threads first and reuse the one whose `specPath` matches. `specPath` is tracker-relative in store mode, whatever form you typed.
`open --spec` refuses a spec another live session claimed. `--takeover` overrides it; use it only when the user says so. A `--session` that is not the env session id is refused. `--as-other-session` lets you act for it, and the CLI records that on the thread.
Returns the generated `thread-id`. The slug becomes the filename (`<slug>.md`) and the thread label; `--message` becomes the thread's first entry and is what the index shows as the file's hook, so make it describe the work. Slugs starting with `00-` are refused, see `index`.

### `append`, add an update to an existing thread
`!darius worklog append <thread-id> --section "<Updates|Artifacts|note|blocker>" --message "<text>"`
`--section Artifacts` records the files the work changed. Give repo-relative paths, separated by commas or by new lines. A glob, `.` or a path outside the project is refused. `set-stage committed` checks these paths.
A review is a note: `--section note --message "Review: pass, matches the spec intent"`. It starts with `Review:` and has at least 3 more words, or `set-stage reviewed` refuses it.

### `close`, complete or block a thread
`!darius worklog close <thread-id> --status <done|blocked|cancelled>`

### `set-stage`, `dispatch`, `park`, move a thread through the Work Loop
`!darius worklog set-stage <thread-id> <planned|dispatched|verified|committed|reviewed>` moves a thread forward. Each evidence stage needs its proof: `verified` needs passing ledger lines, `committed` needs a commit that touches an artifact (`--commit <sha>`), or `--no-code "<reason>"` when no code changed. `reviewed` needs the `Review:` note. `--force --reason "<why>"` skips the proof and marks the stamp `forced`. Never use it to silence the exit gate.
`!darius worklog dispatch <thread-id> --agent <invocable> --reason "<why>"` stamps `dispatched`. With an empty agent roster use `--agent main`.
`!darius worklog park <thread-id> --reason "<why>"` closes a thread you will not finish.

### `list`, read threads
`!darius worklog list [--active] [--milestone <slug>] [--json]`

`--json` emits `{ threads, files }`. A `## ` heading is only a thread when it carries an `<!-- opened: ... -->` marker, so a pre-CLI freeform worklog lists as zero threads and shows up in `files` with `legacy: true` (tagged `(legacy)` in text output) instead of shredding into fake open threads. Each file row also carries `state`: `clean`, `legacy`, or `distilled`, a distilled stub is thread-less prose too, so its stamp takes precedence over the legacy verdict.

`00-`-prefixed files are **excluded** from this listing, they are generated docs *about* the directory, not worklogs in it. The same exclusion applies to `distill --list` and to thread lookup, which is why `open` refuses a `00-` slug: the thread would be written and then be unreachable.

### `index`, regenerate the worklog directory's own index
`!darius worklog index`

Rewrites `worklog/00-INDEX.md` in the tracker tree: one row per worklog file with its milestone, state (`active` / `closed` / `legacy` / `distilled`), open/total thread counts, last activity and a hook. Read this instead of opening every worklog to find the one you need. The CLI is the sole author, never hand-edit it; it also rides `darius index --rebuild`. Output is a pure function of file *content* (no mtimes), so re-running it, or running it in a fresh clone, writes identical bytes. Files with no dated content, pre-CLI prose, show `, ` rather than a date and sort to the tail by filename.

### `distill`, replace a dead worklog with an anchor stub
`!darius worklog distill <file> (--content <path> | --stdin) [--force] [--min-age-days N]`

A **sanctioned lossy whole-file replace**: the stub content comes from the caller, the CLI supplies the safety. Before writing it copies the raw file to `archive/worklog-raw/<file>` in the tracker tree and prepends its own provenance stamp, `<!-- distilled: <ISO> source-sha256: <sha256> raw: <path> -->`. Never write that stamp yourself. Nothing is distilled until every gate passes, in this order:

1. the file exists under `worklog/` and is not a generated `00-` index (`not-found` / `index-file`)
2. zero open threads (`open-threads`)
3. milestone-named files (`M<N>-…`): the milestone directory is gone **and** `archive/<slug>.md` exists (`milestone-active` / `not-archived`)
4. cross-cutting files: last activity older than `--min-age-days` (default 14) (`too-recent`)
5. not already stamped, unless `--force` (`already-distilled`)

A stub over 4 KB warns but still writes. If the raw copy already exists and differs from the file, distill refuses, there is no override; reconcile by hand.

- `... worklog distill <file> --check [--min-age-days N]`: prints the reason on stdout, exits 0 when eligible, 1 otherwise. The scriptable single-file gate.
- `... worklog distill --list [--json] [--min-age-days N]`: every worklog file with `eligible` and its `reason`. Surveys the whole directory, so it cannot be combined with `--check` or a `<file>` argument.

**Security:** Worklog files are shared with other hosts and agents: synced through the darius store when the project owns the tracker tree (in git mode, committed). Never write API keys, tokens, passwords, connection strings with credentials, `.env` contents, session cookies, or any sensitive value. Scrub command output before pasting.
