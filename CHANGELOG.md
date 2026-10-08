# Changelog

All notable changes to darius. SemVer; see CLAUDE.md, "Versioning".

## [0.77.0] - 2026-10-08

### Added

- `--help` and `-h` anywhere in a command print its usage on stdout and exit 0. Nothing else runs: `init --help`, `link --help`, `onboard --help`, `due --help` and `skill --help` no longer act. It covers sub-verbs and the vendored verbs. `darius help <command>` prints the same text.
- With `--json`, a failure that printed no JSON prints `{"ok":false,"error":"...","code":N}` on stdout and exits with N. Success shapes are unchanged.
- `darius root --json` reports `{ mode: "store"|"git"|"none", trackerRoot, project, linked }`. It changes nothing on disk. Skills use it to detect the mode.
- `darius doctor --json` reports `{ ok, healthy, findings, warnings }`.
- An unknown verb prints `unknown command: X. Did you mean: Y?`, exit 2.
- `darius milestone archive` checks the items: it refuses while an item is neither done nor skipped and lists them. `--incomplete "<reason>"` archives anyway and records the reason. It closes threads at stage `reviewed` as done (a dry run lists them as "will close").
- `darius tree restore` of a milestone folder warns about an archive document and a distilled worklog stub, with the commands that end each. The JSON adds `follow_up`.
- `onboard scan` and `onboard --dry-run` on an onboarded repo print `already onboarded` and exit 0 (JSON: `status: "already-onboarded"`).
- README: sections for milestones and specs, vigils, runs, cadence, worktrees and exit codes. `docs/concept.md` has a "CLI contract" section.
- A ready counsel-gate stamp records `counsel_spec_sha256`, the hash of the spec body without its frontmatter and with all checklist box states read alike. The log line holds it as `spec_sha256`.
- `darius doctor` prints an info line for a review stamp without `counsel_spec_sha256`. The stamp stays valid.

### Changed

- A usage mistake exits 2 in every verb, including the vendored ones (`list`, `add`, `set-status`, `index`, `verify`, `worklog`, `scan`, `vigil`, `ritual`, `doctor`, `loop-check`, `mark`, `claim`, `release` and the rest): a missing argument, an unknown option, a bad value. `hook-stop` and `root` refuse an unknown option with exit 2.
- A named item that is not there (`ritual show`, `run show`, `profile show`, `finding show`, `spec check`, `tree log`) exits 1, not 2.
- `due --bogus` and `tree restore --bogus` say `unknown option --bogus`, not `needs a value`.
- Human messages, usage lines, the index header and the status title say `darius`, not `tracker`. The generated index reads `darius index --rebuild`; an index with the old header still counts as current. `--json` fields and values are unchanged.
- Progress is the exact percent: 3 of 4 is 75%, not 80%.
- `doctor` no longer warns on `agent: unassigned`. `darius agents` with no agents prints a hint; its JSON is still `[]`.
- A git-mode `milestone archive` on a folder that git does not track says so, prints `rm -r`, and gives no `git checkout` line.
- `tree restore --force` on a file that is live again reads `restore version <sha>`, not `undo the removal`.
- Spec templates say tracker files are shared with other hosts and sessions (not that `.tracker/` is committed). Every `*_CMD` slot of the library, api-endpoint and ui-component templates is the failing placeholder Command, like the generic one.
- `worklog dispatch` and `set-stage dispatched` refuse a spec whose text changed since its review. Ticking a box does not count as a change. Run the review again, or use `counsel-gate --override`.

### Fixed

- `spec check` no longer reports `grep -q "/api/v1" src/routes.ts` as an absolute path. Only an unquoted word with two segments that starts with a common root (`/home/`, `/tmp/`, `/etc/` and the like) or `~/` counts.
- The runner preflight no longer reports "the gate did not run: EPIPE" when a gate exits without reading stdin. It reads the gate's exit code and output, as it does for any other gate.

## [0.76.0] - 2026-10-08

### Added

- `darius counsel-gate --spec <spec> --override "<reason>"` skips the review on the record. It stamps `counsel: overridden` and `counsel_override`, and logs the reason.
- `darius doctor` flags a worklog thread whose stage markers the CLI did not write (kind `worklog-stage-unstamped`): a stage without a stamp, a stamp that skips an evidence stage, or a `committed` stamp with no commit.
- `darius next --json` prints the task, and `skippedClaimed` lists the specs it skipped.

### Changed

- `worklog dispatch` and `set-stage dispatched` refuse a spec that needs a review unless counsel-gate stamped it. The transcript must exist, its sha256 must match, and `.counsel-log.jsonl` must hold the run. A hand-written `counsel:` line or `counsel: addressed` fails. `counsel: overridden` passes only with a logged override. `review_gate: off` skips the check.
- A ready counsel-gate stamp now records `counsel_transcript` and `counsel_sha256`. Every gate run appends a line to `.tracker/.counsel-log.jsonl`.
- The round budget counts the rounds in `.counsel-log.jsonl`, never fewer than `counsel_rounds:`. `--max-rounds` can only lower the configured budget.
- `mark --verified` refuses an item with a runnable check. `--override "<reason>"` with `--evidence` marks it anyway, and the ledger line has outcome `manual-override` and an `override` field.
- `verified` needs a passing latest ledger line, written after dispatch, for every checklist item that is not skipped. A failure on an item that is now skipped or gone is ignored.
- `set-stage committed` refuses a thread with no artifacts unless `--no-code "<reason>"` is given. `--no-code` is refused when the thread has artifacts, and its reason goes on the stamp.
- `set-stage committed` refuses when the commits since dispatch touch none of the artifacts, or when there is no commit since dispatch.
- A `Review:` note needs at least three words after the prefix before `reviewed` accepts it.
- Claims are keyed by the tracker-relative spec path (`M1-x/02-y.md`), whatever form is passed. Old keys read through the same rule. `claim` refuses a spec that does not exist.
- `worklog open --spec` refuses a spec another live session claimed. `--takeover` overrides.
- `next` skips specs another live session claimed and offers the next free one. It exits 1 only when every ready spec is claimed.
- `worklog open` and `dispatch` refuse a `--session` that differs from the env session id, unless `--as-other-session` is given. The acting session is recorded.
- A Command that runs a repo script makes a spec high risk (`opaque-script`). Common test runners are exempt.

### Fixed

- Text written into a worklog can no longer forge structure. A line of a message, reason or note that starts with `<!--` or `#` gets a backslash in front. Readers remove it again, so the text reads back as written.
- A `spec:` or `session:` value with a line break or `-->` is refused.
- Artifact paths are normalised when recorded and when checked. Lists split on commas and newlines only. An empty path, `.`, a glob or a path outside the project is refused (exit 1).
- `uncommitted-verified --json` lists dirty artifacts again when an entry holds a comma-separated list or the project sits below the git top level.
- counsel-gate exits 2 on two or more `darius-review` blocks, and on a near miss: a `~~~` fence, another case, or another fenced block that holds review items.
- counsel-gate exits 2 on an old advisor transcript for a high-risk spec.
- `claim --json` and `release --json` print only JSON on stdout. The human lines go to stderr.
- `spec check` reads rm flags in any order and case, joins backslash-continued lines, and knows more destructive commands.
- Constant-pass, placeholder and absolute-path Commands are spec check problems, and verify refuses constant-pass Commands.
- Prose words such as "login page" or "deploy the docs" no longer make a spec high risk. Rollback accepts any heading level from 2, and checklist items in a fenced block are not spec check items.

## [0.75.0] - 2026-10-08

### Added

- A worklog file merges by thread when two hosts change it before they sync. Threads, notes and stage stamps of both hosts stay. The stage is the furthest one, and closed beats open. A distilled stub or a changed preamble still falls back to last-writer-wins.
- A spec merges when two hosts only ticked items. Each item takes the further state, and `verified`, `status`, `updated` and `verification_passed` follow. Any other change keeps last-writer-wins.
- `.session-claims.json` syncs with the tree and merges per spec, newest claim wins. A claim records its `host`, and a claim from another host blocks like another session's claim until its TTL ends. `claim --list --json`, `list specs --json` and a refused `claim --json` show the host. A release leaves a tombstone in `released`.
- A concurrent edit that no merge can join writes a `tree.conflict` ledger line once. `darius doctor` lists open conflicts with the restore line, and `darius due` shows one line per project (`treeConflicts` in `--json`).
- `darius tree resolve <path>` keeps the current version and closes the conflict.

### Changed

- `.session-claims.json` is no longer host-local. A leftover claims file in a git `.tracker/` folder moves into the store with the link.
- A concurrent edit whose other version adds nothing is no longer reported.

### Fixed

- A host that changed a tree file twice before it synced no longer hides the other host's concurrent version of it. Apply now looks past the winner's own run of lines, so the edit is merged or recorded as a conflict.

## [0.74.0] - 2026-10-08

### Added

- `darius spec check <spec> [--json]` checks a spec with no model. It fails (exit 1) when an item has no `Command:` or no `Expected:` in the verify grammar, when a manual item has no `- Manual: <reason>` line, when a `depends_on` target does not exist, or when a high-risk spec has no `## Rollback` section with text. JSON: `{ ok, risk, riskReasons, problems, reviewGate, reviewRequired, counsel }`.
- Risk comes from a fixed pattern list (`RISK_PATTERNS`): destructive file ops, data ops, external writes, and concrete auth and secret terms (not bare words such as "author" or "token"). Each match names its pattern and line. Frontmatter `risk: high` raises the risk; `risk: low` never lowers it.
- `darius counsel-gate` reads a one-reviewer transcript: a fenced `darius-review` JSON block with the items `data-loss`, `irreversible`, `hidden-scope`, `missing-test` and `rollback`, each `ok`, `concern` or `blocker`. Any blocker blocks, any concern needs an ack, else ready. A missing item or bad JSON exits 2. `--json` adds `format`, `reviewer` and `items`.
- `.tracker/config.yml` takes `review_gate: auto | off` (default `auto`). `off` skips the reviewer, never the spec check.

### Changed

- The counsel gate is replaced (operator ruling 2026-10-08: four advisors produced zero blocks in two milestones). `darius-work-plan` runs `darius spec check` on every candidate and returns `spec_invalid` or `review_required`; `darius-work` spawns one opus reviewer for a high-risk spec only. `/dev-tools:counsel --four` is no longer used.
- The old `counsel_gate:` key, `on` or `off`, now reads as `review_gate: auto`. Old four-advisor transcripts still parse as before.
- The review transcript at `_counsel/<spec-slug>.md` is a plain copy of its `.objects/` file, not a symlink, because the tree sync keeps regular files only.
- `darius-enrich` and `darius-archive` read the new transcript format.

## [0.73.0] - 2026-10-08

### Added

- `darius tree log <path>` lists the versions of a tracker file or folder in the store, newest first: ledger id, time, host and who, type, sha and size. Only when `kinds` lists `milestone`; in a git tracker it refuses, because git has the history.
- `darius tree restore <path> [--at <sha|ledger-id>] [--dry-run] [--force]` brings a past version back. Without `--at` it undoes the newest removal; for a folder, every file of that one delete. It records a normal `tree.put`, so sync carries it. It refuses when the working copy holds another version, unless `--force`.
- `darius milestone archive <milestone> [--dry-run] [--keep]` removes an archived milestone's folder and rebuilds the index. It refuses without a non-empty `.tracker/archive/<folder>.md` or while a worklog thread of the milestone is open, and reports whether the worklog still needs its stub. In the store the removal is one delete, and the verb prints `darius tree restore .tracker/<folder>/` to undo it. In a git tracker it writes nothing and prints `git rm -r -q .tracker/<folder>/` for you to run and commit (`"action": "print"` and `"command"` in `--json`).

### Changed

- A capture gives all its `tree.*` lines one time, so `tree restore` can undo a deleted folder as one delete.
- The `darius-archive` skill uses `darius milestone archive` (a dry run, then the real call) in place of `rm -rf`, and reports the undo line.
- The `darius-archive`, `darius-wrap-up` and `darius-sync` skills run forked on sonnet and end with a compact `STATUS` block. They no longer ask the user: `archive` needs the milestone as an argument and returns `needs_decision` or `needs_lessons`, and `sync` returns the categories first and marks the chosen items on a second call with `--apply`.

## [0.72.0] - 2026-10-08

### Added

- Every Work Loop stage change writes a stamp with the git HEAD (`none` outside git), the host and the time. `worklog list --json` shows the new fields `stamps`, `stageStamp`, `forced`, `session`, `artifacts` and `reviewNotes`. An older reader keeps the stage and carries the stamp as prose.
- New stage `reviewed`, after `committed`. `worklog set-stage <id> reviewed` needs a note that starts with `Review:`, written after the commit stamp.
- `worklog set-stage` takes `--commit <sha>`, `--no-git`, `--force --reason "<why>"` and `--session <id>`. A forced stamp records `forced` and the reason, and the thread gets a note.
- `worklog open` and `worklog dispatch` record the acting session (`--session`, else `CLAUDE_CODE_SESSION_ID`, else `CLAUDE_SESSION_ID`) as the thread owner.
- Verification ledger lines carry `head` and `host`. Older lines without them still parse.
- `loop-check` takes `--session <id>`; `--bounce` is the older name for it. The JSON result can hold `others` and `exhausted`, and each thread can hold `session` and `bounces`.

### Changed

- `worklog set-stage <id> verified` refuses (exit 1) unless the ledger has a passing line for the thread's spec since the dispatch and no item whose latest result failed.
- `worklog set-stage <id> committed` refuses (exit 1) unless the commit is an ancestor of HEAD and no artifact of the thread is dirty or untracked. Outside git it exits 3 unless `--no-git` is passed.
- A forward stage move may not skip `verified` or `committed`. `park` still works from any stage.
- The Stop hook blocks only on threads owned by the stopping session. Threads of another session, or of none, show in one notice line and never block. A Stop payload without `session_id` never blocks.
- The bounce budget is per thread: 2 blocks per thread per 24 h. A thread over budget is reported and the other threads still block. Old per-session entries in `.loop-bounces.json` are dropped.
- `committed` with a stamp is no longer terminal for the exit gate; `reviewed` is. A `committed` thread from before 0.72.0 has no stamp and stays terminal.
- `worklog append --section Artifacts` files an artifact entry, as `--section artifact` does. Before it filed a note.
- The `darius-work`, `darius-commit`, `darius-work-verify` and `darius-work-plan` skills describe the `reviewed` stage, `set-stage committed --commit <sha>`, the ledger rule for `verified`, and the owner-only exit gate.

## [0.71.0] - 2026-10-08

### Changed

- The generated `darius` skill now holds the rules that only the darius agent had: the CLI is the only read interface for tracker state, arm a vigil with its checklist in one call, dream rules (distill, never delete or `--force`), no secrets in worklogs, and the main thread drives the Work Loop and writes specs itself.
- The size cap of the generated skill is 7168 bytes (was 6144), to hold those rules.
- `darius skill install` writes 12 files (the generated skill and 11 procedure skills). `darius setup` and `darius skill uninstall` handle the same 12.

### Removed

- The darius subagent, `skills/agent-darius.md` and the installed `agents/darius.md`. It could not write or start agents, its report was hidden from the user, and its long prompt repeated the skills. `darius skill install`, `darius setup` and `darius skill uninstall` remove a darius-stamped `agents/darius.md`. A file there without a stamp is left alone. `darius skill status` no longer lists the agent.

## [0.70.1] - 2026-10-08

### Fixed

- `darius claim`, `next` and `worklog dispatch` now read the session id from `--session`, else `CLAUDE_CODE_SESSION_ID` (the variable Claude Code sets), else the older `CLAUDE_SESSION_ID`. Before, a claim without `--session` was always refused.
- `darius uncommitted-verified` works in store mode (`milestone` in `kinds`). It lists each open worklog thread at stage `verified`, with the new fields `source`, `threadId` and `dirtyArtifacts`; `gitStatus` is `verified-uncommitted`. Before, the list was always empty, so the commit-first gate never fired. A repo with `.tracker/` in git is unchanged.
- The `darius-commit` skill describes store mode: code-only commits, the verify check reads thread stages, the index rebuild runs when no code changed, the progress trailer comes from `darius show --json`, and `.pending-sync` drift warns and never blocks.

## [0.70.0] - 2026-10-06

### Added

- `icon` in a v3 `.darius.toml`, the workspace icon. It is one emoji (`icon = "🎯"`) or a relative path to a `.svg`, `.png` or `.webp` file in the repo (`icon = "assets/logo.svg"`). Any other value is a marker error. Update every host before a marker uses it: an older darius refuses the unknown key.
- The web app shows the workspace icon in the Places rows, the Workspaces list and the phone top bar. A workspace without an icon looks as before.
- `GET /api/workspace-icon/<project>` serves the image the marker names. The file must be inside the checkout, a regular file of at most 64 KB, and a real PNG, WebP or SVG whose content matches its extension. Anything else gets a plain 404 that names no path.
- `darius marker check` prints the icon. It warns when an image icon is missing or not a valid image in the checkout.

### Changed

- The status JSON has an `icon` field for each project.
- `darius marker factor` keeps the `icon` line, and its check names an icon that it lost or changed.

## [0.69.0] - 2026-10-06

### Added

- A `needs-decision` item of a run result may carry `proposal: {current?, proposed, why?, effect?}`, the exact change it proposes. `current` and `proposed` take at most 1500 characters, `why` and `effect` at most 400; newlines stay. A longer text is refused, not clipped. A proposal on an item in any other state is refused. The run prompt teaches the field.
- `darius run follow-up <run> --item KEY` (repeatable) approves the proposal of the parent's needs-decision item with that key. It combines with `--approve`, `--grant` and `--note`. An unknown key, a key of an item in another state, a key two items share and a key given twice are usage errors. `run.started` records the keys as `items`, and the parent's acknowledgement note names them.
- The follow-up prompt prints each approved proposal in full under "Approved proposals" and keeps every other open item to one line. The rule: carry out exactly the approved proposals within the policy, act on nothing else, verify, report each key once and list each write as an action.
- `follow_up_may` on a v3 ritual or a `[policies.*]` table, and `follow_up_may_extra` on a ritual: rules only a follow-up run may use, on top of `may`. A scheduled run never gets them, and `hold` still wins. Next to `policy`, `follow_up_may` is an error.
- `follow_up = "headless" | "attended"` on a v3 ritual. With `headless`, follow-ups of the ritual run headless without herdr, from the CLI and the web.
- `run follow-up` prints `darius run follow-up: started run <id> on <host>` on stderr right after the run starts.
- `darius run proposal <run> <key> [--field proposed|current|why|effect]` prints one field of an item's proposal (default `proposed`) to stdout byte for byte, with no newline added. A missing run, key or field is exit 1 with a sentence on stderr. The follow-up prompt tells the run to pipe it into the write, so the page gets exactly the approved text. A ritual allows it with `Bash(darius run proposal *)`; the gate judges each side of the pipe by `may`.
- `POST /api/run/follow-up` takes `items: [KEY]`. Each key must name a needs-decision item of the parent, else 400 with a sentence.
- The run page lists each proposal with a checkbox, its target and key, and the proposal in a fold: current and proposed as two labelled text blocks, then why and the expected effect. Select all proposals, one note field, and one button, "Start follow-up with N approved".
- The parent run page shows each follow-up with its state, who started it, what was approved, its summary, its actions and its items. `RunDetail` gains `children`.
- The ritual page shows what a follow-up may also run and how follow-ups run.

### Changed

- On a host that is not the ritual's, the web page now forwards the follow-up: readiness runs `run follow-up --dry-run --json --on <host>`, and the start adds `--on <host>`. A refusal there or an ssh failure shows on the card as its reason, not as a command to copy. `FollowUpReadiness` gains `surface`, `items` and `via`.
- The follow-up POST waits up to 10 s for the run to start or the CLI to end: 202 with the new run id, 409 with the CLI's sentence, 503 when ssh did not connect, or 202 `pending` with a message. It was a silent 202.
- A press on the card posts at once. Only command lines still get the confirm box that lists them.
- The nothing-to-do rule of a follow-up counts questions, items or a note.
- `marker check --resolved` lists `follow_up_may` lines, and its JSON adds `follow_up_may`. `marker factor` leaves a ritual with `follow_up_may` alone.

### Fixed

- The follow-up card now shows for a complete run that proposes changes and asks no question. It was drawn only next to questions.
- `shellWord` quoted a word for POSIX shells only. In fish a word that ended in a backslash left the quote open, so with two such words the text between them ran as code on the other host of `--on`. Each `'` and `\` is now written outside the quotes, which reads the same in sh, bash, zsh and fish.

### Upgrade note

- Every host must run 0.69.0 before a marker uses `follow_up_may`, `follow_up_may_extra` or `follow_up`: an older host refuses the unknown key and cannot read the mirrored item. A ritual without them keeps its definition hash.

## [0.68.1] - 2026-10-06

### Fixed

- A viewer who opens the page from this host (loopback) saw no Acknowledge button and no reason. A short line now takes its place: the page was opened from this host, and the card can be dismissed by the tailnet name or with the command. A page reached through the configured proxy is not loopback and still gets the button.

## [0.68.0] - 2026-10-06

### Added

- The web page has an Acknowledge button. It is on a question card ("Asks you") and a failed card of the Overview, and in the "Record your decision" card and the "What happens next" card of the run page and the ritual page. One click marks the run as seen and the card moves to Last night. A note sits behind a small fold and is empty by default. A refusal of the CLI (held, already acknowledged, wrong outcome) shows as its own sentence and the card stays. The terminal command stays under the button.
- `POST /api/run/ack` with `{ project, run, note? }`. It runs `darius run ack` and waits, with the guards of `POST /api/finding/close`: the page's Origin, JSON, a size cap, a tailnet identity, a known project and run, no other body key and a plain one-line note of at most 500 characters. A refusal of the CLI is 409 with its sentence. It adds no ledger line type.
- `WebContext.canWrite` is false for the loopback viewer, whose POSTs the server refuses. The page hides the Acknowledge button for it and keeps the command.

### Changed

- `POST /api/run/*` dispatches by path: `follow-up` and `ack`. `ActionDeps` gains `run`, the CLI runner, as `FindingDeps` has.
- A bare acknowledgement (no note) of a run that asked questions is a dismissal. The handoff of its ritual says: "The operator saw these questions and chose not to act on them. Do not act on them, and do not ask them again unless the facts changed." An acknowledgement with a note is still the operator's answer, and a run with no questions is unchanged. `Handoff` and `RitualHandoff` gain `dismissed`, and the ritual page says so.
- The web dev server answers `POST /api/run/ack` with a stub: ok in the demo, a plain refusal on real data. The demo shows the button to every viewer.

## [0.67.0] - 2026-10-05

### Added

- `kinds`, a root key of the `v = 3` marker, says what the darius store owns in a project. Valid lists are exactly `["ritual"]` (the default when the key is absent, the old behaviour), `["ritual", "vigil"]` and `["ritual", "vigil", "milestone"]`. Verbs route by this list, per project. `marker check` shows it. An older darius refuses the unknown key, so every host must run 0.67.0 before the first marker with `kinds` is pulled.
- With `vigil` in `kinds`, the project's vigils are store items and never live in git. `darius vigil add|set-body|set|list|show|close` are native and take the same command-line forms as before. `vigil set-body` replaces the checklist of a vigil. `vigil set <slug>` changes `--heavy` or `--no-heavy`, `--due`, `--until` and `--gate-command`. `vigil list --json` keeps its fields and adds `state`, `flagged`, `heavy` and `lastOutcome`. `vigil close --verdict held|failed` is safe to repeat.
- The daily `darius vigil sweep` sees store vigils. It runs the Commands of a vigil whose date is due, closes it `held` when all pass, and leaves it armed and flagged when one fails. It skips a heavy vigil. An imported open vigil is heavy, so the sweep runs none of them until `darius vigil set <slug> --no-heavy` allows one.
- `darius due` lists the vigils of a project that owns them: a date-due one as due, one that waits on an event as armed. `--json` adds `vigils: {due, armed}`.
- With `milestone` in `kinds`, the store owns the whole tracker tree: milestones, specs, worklogs and the archive, byte for byte. The working copy on a host is `<state dir>/<project>/tracker/`. In a checkout `.tracker` is a symlink to it, listed as `/.tracker` in `.gitignore`, so every path under `.tracker/`, every tracker verb, every skill and both hooks work unchanged.
- Every file version of the tree is a blob in the store, and every change is a ledger line (`tree.put`, `tree.removed`). darius captures changes after each tracker verb and at each `darius sync`, and applies other hosts' changes before each tracker verb and after a sync pull. The last writer wins per file. A concurrent edit from two hosts is reported with the blob id of the version that lost. A `.jsonl` file is the exception: it is append-only, so on a concurrent edit darius writes the lines of both versions (the winner's lines, then the other's missing lines) and records the merged file at once, so no line is lost and both hosts end with the same file. `00-INDEX.md`, `worklog/00-INDEX.md`, `.session-claims.json`, `.pending-sync`, `.loop-bounces.json` and the `vigils/` view are host-local and do not sync. darius rebuilds a missing `00-INDEX.md` before a tracker verb and after a sync, so a host that got the tree by sync has one. `darius snapshot` covers the tree.
- `darius onboard` moves a legacy repo into the store. `darius onboard scan` is a read-only report with blockers. `darius onboard --dry-run` shows the plan. `darius onboard` imports `.tracker/vigils`, copies the rest of `.tracker/` and checks every file by sha256, writes a `project.cutover` ledger line, adds the `kinds` line to the marker, runs `git rm -r .tracker`, creates the link, adds `/.tracker` to `.gitignore`, and writes the store vigils under `.tracker/vigils/`. It never commits. It says how many imported open vigils are heavy (`--json`: `heavy_vigils`). It refuses a `.tracker/` with uncommitted changes. `darius onboard --only vigil` moves the vigils only.

### Changed

- `darius init` in a fresh repo writes `kinds = ["ritual", "vigil", "milestone"]`, creates the tree in the store and the link, and adds `/.tracker` to `.gitignore`. No tracker folder lands in git. In a repo that still has a `.tracker/` folder it works as before and prints a hint to run `darius onboard`.
- The web page reads the store's tracker tree, `<state dir>/<project>/tracker/`, when it exists, and the linked checkout's `.tracker` otherwise. A host with no checkout still shows the milestones, specs and vigils of an onboarded project. A legacy vigil still shows under a store vigil of the same slug.
- In a project that lists `milestone`, the legacy engine writes only the store's working copy through the link, and nothing is written to git. The checks of a spec stay in the spec text; they are not ledger lines.
- The generated skill says what `kinds` means, that `.tracker` is a link in a store-owned project and is never staged, when to run `darius onboard`, that imported open vigils are heavy, and lists `vigil set`. The procedure skills and the darius agent do the same: `/darius-commit` and `/darius-wrap-up` commit code only in such a project, and the skills that edit tracker files end with a darius verb, which records the change. The skill set README has a short section on where the tracker lives.
- `docs/concept.md` amends the Git and Marker v3 sections, one writer per kind, migration phases 3 and 4, decisions 5 and 6, the risks line and the local layout. The README and CLAUDE.md follow.

## [0.66.1] - 2026-10-04

### Changed

- A ritual whose mode is `off` is never late. The timer never starts it, so it left the Overdue group, the late tile of the Overview and the Rituals badge. When its date is past, it shows in a quiet group named Off, after the other groups of the Rituals page. An `off` ritual with a date today or later keeps its day group.
- The vigil tile of the Overview reads "N vigils due" and counts the vigils that are late or due today, the number of the Vigils badge. It was "N vigils armed" and counted every open vigil. The tile is left out at zero. The Vigils page still lists every armed vigil, also those that wait on an event.
- A question card goes away once a newer run of the same ritual in the same project closed complete. Before, the card stayed until someone answered it with `darius run ack`. A newer run counts by its start time, and a follow-up run is such a run. A newer run that failed, is held, is still running, or belongs to another ritual or project leaves the card. The need-you tile, the verdict, the badges, the state word of the run and the ritual row follow the same rule.

## [0.66.0] - 2026-10-03

### Added

- `on_hold = "stop" | "deny"` on a v3 ritual or a `[policies.*]` table. `stop` is the default and holds the run as before. With `deny`, a hold-list match or a report-mode write verb refuses that one call and the run goes on. The reason reads `outside this run's scope (hold rule: <pattern>)` or `(report mode: <verb>)` and tells the model to record the exact command as a needs-decision item. The command never runs either way. Only the run's own `darius run hold` can then hold the run. Next to `policy = "<name>"` the key is an error; a ritual takes its policy's value. Every host must run 0.66.0 before a marker uses it.
- The gate log row of a hold, and of the deny in its place, names the pattern in `hold_pattern` and the cause in `hold_cause` (`hold-rule` or `report-mode`).
- `on_hold` shows in `ritual show`, `ritual show --json`, `marker check --resolved` (text and JSON), `ritual export`, `marker factor`, the run prompt and the web ritual page (row "On a match").
- `darius finding reset [--ritual R] [--note TEXT]` writes one `finding.reset` ledger line. Findings then ignore every run result that completed before it, for that ritual or for all. The verb prints how many findings it hid. The line syncs like any ledger line.
- A run with the full gate gets a `## Shell commands` section in its prompt. It lists the shell forms the gate refuses, says to quote the heredoc delimiter of `darius run complete` (`<<'FINDINGS'`), and says not to try another form of a denied call.
- `marker check` warns about a hold pattern with a literal `\|`, `;` or `&&` outside a character class. Such a pattern can no longer span commands, see below.

### Changed

- A hold pattern matches each command of a line apart, never across `|`, `;`, `&&` or `||`. So `curl URL | tr -d x` no longer matches a `curl ... -d` pattern. A match in any command holds as before.
- A line where any command may run code from its arguments is read whole and as written, and a match holds: a program or an unquoted word such as `bash`, `sh`, `eval`, `xargs`, `ssh` or `sudo`, also after `{`, `do` or `coproc`. So `echo '...' | bash`, `curl URL | sh` and `{ bash; } <<'EOF'` hold. A line the shell split refuses is read whole too. Only a `.` that is not the program does not count, so `find . -name x | jq '.a // .b'` keeps the quoted-text relief.
- The deny for a hold rule that matched only inside quoted text no longer suggests another form of the command. It says to record a needs-decision item when the command is needed, and to read data such as a search text or a jq filter from a file under /tmp.
- A finding that two full runs in a row left out is `lapsed`. It leaves the default list, the needs-you count, the run prompt and the web. `finding list --all` shows it. A new report of its key opens it again.
- A `may` rule `Bash(prog *)` also allows the bare `prog`, as `Bash(prog:*)` does. Rules with more words, such as `Bash(pnpm cli *)`, do not change.

### Fixed

- The tool check before a run looked up a relative `may` path such as `./tools/x.sh` in the process dir. The timer runs in `$HOME`, so the ritual was skipped as `tool-missing`. The path now resolves against the checkout.
- The run's own `darius run hold` and `darius run complete` calls are never held for their text. Operators inside quotes are text. An absolute path counts only when it is, as written, the path of the darius binary the hook runs from, or its `<app>/current/bin/darius` form. A symlink to it does not count.
- The heredoc body of the protocol now ends at its first delimiter line, as the shell reads it. Before, a second delimiter line could hide a command after the body. Only a quoted delimiter (`<<'FINDINGS'`) is the protocol.
- The legacy rule form `Bash(git:*)` allowed `git`, a newline and a second command. It now takes a blank or a tab after the prefix, never a newline.
- An unquoted backslash in a program name (`w\p`) slipped past a hold pattern such as `\bwp\b`. The hold check now reads it as `wp`.
- A resumed run on the herdr surface failed with `agent_name_taken` while the old pane was open. Each launch now gets its own agent name (`d-<run>`, then `d-<run>-r2`), and `herdr.json` keeps every tab of the run, so all of them close later.
- `darius run resume --dry-run` started a real run. It is now a usage error.
- `doctor` without `--fix` stamped an unstamped index. It now writes nothing and warns that the index needs a rebuild with `--fix`.
- A `may` tool name may hold `-` after its first character, so an MCP tool such as `mcp__some-server__get_thing` validates.

## [0.65.0] - 2026-10-03

### Added

- Decision follow-up: `darius run follow-up <run> --note TEXT` starts a follow-up that carries only the operator's decision, with no granted line. The run follows its own `may` and `hold`. With no `--approve`, `--grant` or `--note`, the verb exits 2 with `nothing to do: pass --approve N, --grant LINE or --note TEXT`.
- The follow-up prompt of a decision follow-up prints `Operator decision: <note>` and a rule to carry it out within the run's policy, instead of the granted lines.
- The web endpoint `POST /api/run/follow-up` accepts `approve: []` when `note` is not empty. The run page shows the follow-up card for any closed complete ritual run that passes the readiness checks, with or without command questions. The note field is `Operator decision for the follow-up`.

## [0.64.1] - 2026-10-03

### Fixed

- `cd <dir> && darius run complete <run> ...` was not seen as the run's protocol, so the hold list read its findings text. A real run was held because its findings named "gate overrides". A leading `cd <dir> &&` now keeps the line the protocol.
- The body of a quoted heredoc (`<<'EOF'`) counts as quoted text for the hold check: a hold word only in the body denies the call instead of holding the run. `bash <<'EOF'` and an unquoted heredoc still hold.

## [0.64.0] - 2026-10-03

### Changed

- A `hold` pattern or a report-mode write verb that matches only inside quoted text with a blank in it (a jq filter, a commit message, a search text) now denies the call instead of holding the run. The model gets the reason and goes on. A real run was held for a `.wp ` inside a jq filter, which matched `\bwp\s`.
- A line that names a program that runs its arguments (`bash -c`, `sh -c`, `ssh`, `eval`, `xargs`, `sudo`, `timeout` and the like) is still read as written, so a quoted command there still holds.

### Fixed

- A program name in quotes (`"wp" plugin list`, `w'p' plugin list`) slipped past a hold pattern such as `\bwp\s`. The hold check now also reads the line with those quotes removed, and holds.

## [0.63.1] - 2026-10-03

### Fixed

- The Findings and Rituals pages did not load on a host and kept reloading. The ignore rule `result-*` (for Nix build links) also hid the build chunk `web/build/client/assets/result-<hash>.js` from the commit, so 0.63.0 shipped without it. The rule now matches the repo root only.
- A test fails when a `.gitignore` rule hides a file of `web/build/`.

## [0.63.0] - 2026-10-03

### Added

- Workspace-first navigation. A scope is one workspace or all workspaces, and it is always in the address. Each scope has six places: Overview, Vigils, Rituals, Findings, Milestones and Runs.
- A Places sidebar on a desktop and a drawer on a phone. It lists All workspaces, each workspace with what needs you, the six places of the current scope, and a This host group (Status, Profiles, Settings). The host line at its end shows the host, the version, the update time, the viewer and the self-test.
- A bar of five tabs on a phone: Overview, Vigils, Rituals, Findings and Milestones. The top bar is one button that names the scope and opens the drawer. A dot shows when another workspace needs you.
- Breadcrumbs on the ritual, run, milestone and runs pages, and a back row to the parent on a phone.
- New addresses under `/w/<workspace>/`: `/w/<workspace>/runs`, `/w/<workspace>/rituals/<slug>` and `/w/<workspace>/runs/<run>`. The old `/p/...`, `/runs/<project>/<run>`, `/runs?project=` and `/findings?project=` addresses redirect with a 301, and the other query parts stay. Old push notices still open.
- A Workspaces list on the All workspaces Overview: each workspace with what needs you and what is due next.
- A `finding` icon (a shield with a mark) for the Findings tab. The Next due time on the ritual page shows as a clock time.
- One link builder, `web/app/lib/paths.ts`. A test fails on a link written by hand, and a crawl test follows every link of the main pages.

### Changed

- `/` is a redirect only: to the default workspace when one is set, else to `/all`.
- The Project chips of the all-workspaces Findings and Runs pages are Workspace chips. A chip changes the scope.
- Status, Profiles and Settings show no workspace controls. Their tabs and Places point at the last workspace you visited (cookie `darius_scope`).
- An error page offers Back to the last scope, not Back home. A workspace Overview ends its rail with the workspace facts, and its All runs link opens the runs of that workspace.
- Push notices link to `/w/<project>/runs/<run>`.

### Fixed

- The findings link no longer loses its workspace.
- A run page lights a tab: Rituals for a ritual run, Vigils for a vigil run.
- The Runs page no longer lights the Rituals tab.
- Pages of the host no longer fall back to the default workspace after you leave a workspace.

### Removed

- The footer, the workspace switcher, the section tabs under the top bar, the status and gear icons in the top bar, and unused code and styles of the old frame.

## [0.62.0] - 2026-10-02

### Added

- A result item may carry a `key`: a stable id for the finding, plain text, at most 120 characters. A longer key is refused, not clipped. The run prompt tells the run to reuse the key when it re-checks a finding. `darius run show` prints the key as `{key}` at the end of the item line.
- A new item state, `needs-code`: the item needs a code or mapping fix and is not a question. It counts as open, so a high or critical one still raises the result to attention.
- A findings index (`src/core/finding-index.ts`). darius derives one finding per (ritual, key) from the ledger and the result blobs that already sync: newest report, first and last sighting, run count, the last 10 steps, `stale`, `reopened` and a status (`needs-you`, `open`, `closed`, `fixed`). An item without a key gets the key `auto:group|target|title`. Nothing new is stored for a finding.
- `darius finding list [--ritual SLUG] [--open | --all]`, `finding show <key>`, `finding close <key> [--note TEXT]` and `finding reopen <key>`. The list shows needs-you findings by default. A close writes a `finding.closed` ledger line; it holds while later reports keep the same or a lower severity, and a worse report ends it. `finding reopen` writes `finding.reopened`. The skill lists the verbs.
- A findings page in the web app, `/findings` and `/w/<workspace>/findings`, with a Findings tab (its badge counts the findings that need you) and a `findings` pill in the status strip. The default view shows what needs you; chips pick `needs you`, `open` or `all`, a project, a ritual and a severity, all in the address. A row shows the severity, the state, the title, group and target, the ritual, the first sighting, a `stale` or `reopened` mark and a link to the last report; a fold holds the detail, the key and the history. A `Close` button, with an optional note, posts to `POST /api/finding/close`, which runs `darius finding close` with the same guards as the follow-up button (Origin, JSON, body limit, a tailnet identity, a finding that exists and is neither fixed nor closed). The run page shows an item's key and the `needs-code` state.
- The run prompt gets an `## Open findings` section, after the handoff, for a normal run of a ritual: the needs-you and open findings (at most 40 lines), then the keys the operator closed (at most 20). `darius run start` prints it for a run by hand. No findings, no section.

### Changed

- A follow-up run no longer gets the open findings. Its prompt shows each open item of the parent with its key, and tells the run to report only the items it changed or re-checked, with the parent's key, and not to repeat the parent's other items. This stops a follow-up asking the operator the same question twice.
- The result prompt says what goes in `questions`: only what needs a decision. A fix the run made, or an item that needs code, is never a question.
- `--all` is a boolean flag in the argument parser.

## [0.61.0] - 2026-10-02

### Added

- `darius skill status` checks the three hooks in `settings.json` after the file lines: `ok`, `differs`, `missing` or `unreadable`. When one is not ok, it says to paste the output of `darius skill hook`. It only reads `settings.json`. The exit code still depends on the generated skill only. `--json` adds the hook entries to the same array.
- The home-manager module has `services.darius.skills.enable` (default true). Activation runs `darius skill install`. A failure prints a warning and never fails the activation.

### Changed

- `darius setup` (and so `darius update`) installs a file of the skill set that is missing, such as a skill a new release adds, when the generated skill is installed and stamped at user level. With no such skill it installs nothing, as before. On such a host it also names the hooks that are not ok.
- `darius worklog open` needs a slug that names an active milestone folder (`M68-framework-quality` or `framework-quality`). It refuses no slug, an unknown slug and an archived milestone, so it no longer writes `default.md`. Findings with no milestone belong in a plain doc. The `darius-worklog` skill says so.

### Fixed

- The Nix test derivation and the VM test checkout include `skills/`. Since 0.60.0 the skill tests and the VM test failed in `nix flake check`.

## [0.60.0] - 2026-10-01

### Added

- `darius skill install` now writes 13 stamped files under the Claude config dir: the generated `skills/darius/SKILL.md`, the 11 procedure skills of the tracker plugin as `skills/darius-<name>/SKILL.md` (work, work-plan, work-verify, commit, sync, archive, wrap-up, enrich, dream, worklog, structural-review), and `agents/darius.md`. Their static text lives in `skills/` of this repo. A skill is called `/darius-<name>` now, not `/tracker:<name>`.
- `darius hook-stop`: the Work Loop exit gate, ported from the plugin's `loop-gate.sh`. It reads the Stop hook JSON on stdin, asks `loop-check` in process, prints the block decision (or the budget-spent notice), and exits 0 with no output on any failure. `TRACKER_LOOP_DEBUG` and `TRACKER_LOOP_DEBUG_FILE` work as before.
- `darius hook-drift`: the PostToolUse check, ported from `drift-check.sh`. It appends an edited file that a spec names to `.tracker/.pending-sync` once, and writes nothing else. It also fails open.
- `darius delegation validate|return-validate '<json>'`: the plugin's `delegation.mts`, now in `src/legacy/lib/delegation.ts`. Same output and exit codes (0 valid, 1 invalid, 2 usage).
- The new verbs are legacy verbs and have a "Hooks" line in the generated skill.

### Changed

- `darius skill status` prints one line per file (`ok`, `outdated`, `edited`, `unstamped` or `missing`). `--json` prints an array of `{name, path, state, version, source}` where it printed one object. The exit code is unchanged: 0 when the generated skill teaches sessions here.
- `darius skill install` and `uninstall` act on all 13 files. An unstamped file is refused (install) or left alone (uninstall), exit 1, and the others are still handled. `--json` keeps `ok`, `path` and `result` for the generated skill and adds `files`. `uninstall` never removes the `agents` dir.
- `darius setup` refreshes every stamped file of the set and installs nothing new.
- `darius skill hook` prints three hooks: SessionStart (`darius due --brief`), Stop (`darius hook-stop`, 15 s) and PostToolUse on `Edit|Write|MultiEdit` (`darius hook-drift`, 10 s).
- The next-action lines of `loop-check` name `darius worklog ...`, `/darius-work-verify` and `/darius-commit`, and have no em dash.
- The Nix package ships `skills/`.

## [0.59.0] - 2026-10-02

### Added

- `darius marker factor [dir] [--write] [--json]` finds rituals with an inline policy that share most of their rules and moves the shared `may` and `hold` rules into new `[policies.<mode>-base]` tables. Each ritual then names the policy and keeps only its own rules in `may_extra` and `hold_extra`. It prints a summary and a diff and writes nothing, unless you pass `--write`. `--write` never runs git and refuses a dirty or non-v3 marker. The edit is textual: comments, key order and untouched tables stay byte for byte. Before it prints or writes, a proof gate parses the proposed file and compares every ritual with the current one (every field, the mode, the sorted `may` and `hold`, the notes). Any difference exits 1 and writes nothing. A layout it cannot edit safely exits 1 and names the ritual.
- The web run detail shows the skill hash of a run in a "Skill hash" row (the first 12 characters, the full value on hover). The web API returns `skillHash`, `null` for a run that recorded none.

### Changed

- The overlap rule of the 0.57.0 warning now lives in one shared function that `marker check` and `marker factor` both use.
- The factored marker can list its `may` and `hold` entries in another order. The definition hash follows the list order, so the next reconcile reports a factored ritual once as updated. `marker check --resolved` prints the same lines before and after.

## [0.58.0] - 2026-10-01

### Changed

- A ritual that names a `policy` may carry its own `notes`. The effective notes are the policy's notes, a blank line, then the ritual's. `mode`, `may` and `hold` still cannot be combined with `policy`. The joined text feeds the run prompt, the definition hash, the store mirror, export and the web, as the policy's notes did. `marker check --resolved` still leaves notes out.
- The `marker check` notes warning (over 300 characters) counts a ritual's own notes and its policy's notes apart, not the joined text.

### Upgrade note

- Run 0.58.0 on every host before a marker combines `policy` with `notes`. An older host refuses such a marker, so it skips the whole project.

## [0.57.0] - 2026-10-01

### Added

- `args` on a v3 ritual: input for the skill, one string of at most 256 characters with no newline. The run prompt has a `## Arguments` section right after `## Skill`, with the text and a sentence that says it is input, not instructions. `args` is part of the definition hash and of the store mirror. `ritual show` prints it, `ritual show --json` and `ritual list --json` carry it, `ritual export` writes it, and the web ritual page has a read-only "Arguments" row.
- Multi-line strings (`"""..."""`) in `.darius.toml`, as in the TOML spec: the newline after the opening quotes is dropped, a line-ending backslash trims the newline and the white space after it, one or two quotes may sit inside. An unterminated one is an error that names its first line. The parser also reads `\uXXXX`, `\UXXXXXXXX`, `\r`, `\b` and `\f` in every double-quoted string.
- `ritual export` writes a `notes` value that holds a newline in the `"""` form.
- `darius marker check` warns when two rituals share most of their resolved `hold` patterns (the shorter list has at least 5 entries and at least 80 percent of it is in the other; rituals that name the same policy are skipped), and when a `notes` text is over 300 characters. Warnings do not change the exit code.

### Changed

- A newline in a quoted value of a store item file is now written as the escape `\n` and read back. Before, the store refused an item whose `notes` held a newline.
- Wrapping a `notes` value as a single line or as a `"""` string gives the same definition hash.
- `darius skill` names `args`.

### Upgrade note

- Run 0.57.0 on every host before a marker uses `args` or a `"""` string. An older host refuses the unknown ritual key, so it skips the whole project. It also cannot read a store item that holds `args` or a note with a newline.

## [0.56.0] - 2026-10-01

### Added

- Skip reason `skill-dirty`: an unattended run skips one ritual when `git status --porcelain` lists a modified or untracked file in `.claude/skills/<skill>/`. The other rituals of the project still run. `run now` warns `.claude/skills/<skill>/ has uncommitted changes; this run uses them` and goes on. It is a failing skip, like `skill-missing`.
- `may_extra` and `hold_extra` on a v3 ritual. They add rules and patterns to the `may` and `hold` of the named policy, or of the ritual's own lists. They never remove one, so a ritual never has fewer `hold` patterns than its base.
- `darius marker check --resolved <slug> [--json]` prints the effective policy of one ritual: the mode, then the `may` and `hold` lists, each sorted.
- `skill_hash` on `run.started`: the sha256 of the ritual skill's `SKILL.md` at launch. `darius run show` prints its first 12 characters (`--json` carries all of it). If the file cannot be read, the run starts without it.

### Changed

- `darius marker check` exits 1 when a ritual's skill file is missing in the checkout, with an `error:` line per ritual. Before it was a warning. `run-due` already skipped such a ritual as `skill-missing`. Other warnings stay warnings.
- Duplicate rules inside one `may` or `hold` list are now removed. A marker that repeated a rule gets one new definition hash, and the next reconcile reports that ritual once as updated.
- `darius skill` names `may_extra`, `hold_extra` and `marker check --resolved`.

### Upgrade note

- Run 0.56.0 on every host before a marker uses `may_extra` or `hold_extra`. An older host refuses unknown ritual keys, so it skips the whole project.

## [0.55.1] - 2026-10-01

### Fixed

- `darius ritual export` no longer refuses when a ritual has a store body, no skill, and `.claude/skills/<slug>/SKILL.md` already exists. The existing skill is the domain procedure and stays. The store body becomes `.claude/skills/<slug>-ritual/SKILL.md`, the marker says `skill = "<slug>-ritual"`, and a warning names both. If `<slug>-ritual` also exists, export refuses before it writes anything. The stdout form gives the same marker when a checkout is linked.

## [0.55.0] - 2026-10-01

### Added

- `darius ritual export [--write] [--json]` moves a v2 project to v3. It prints a v3 marker from the store, or with `--write` writes `.darius.toml` and a `.claude/skills/<slug>/SKILL.md` for each ritual that had a body and no skill. It copies the existing root keys, profiles and defaults, sets `v = 3`, adds `tz` from the host, and adds `max_mode` when a ritual needs it. It never writes `host` and never commits. It refuses a dirty marker, an existing skill file, a marker that is already v3, and rituals that would fail `marker check`.
- The web shows where a ritual is defined: "Defined in .darius.toml at commit X, host Y", with a note when the marker had uncommitted changes, or "Not in .darius.toml" for an unmanaged ritual. A Schedule section shows the cadence, `at` with its zone, the next due time and the timeout. Rows say `git` or `not in .darius.toml`. The web stays read-only for git-owned fields and points to the file.
- The web shows the same warnings as `ritual list`: a stale mirror and a retired slug named again.
- In a v3 marker `cadence` is optional. A ritual without it is on demand: only `run now` starts it.

### Changed

- README: a "Move a project to v3" section with the migration steps. `docs/concept.md` covers migration and the web. `docs/backlog.md` lists the marker v3 follow-ups.

## [0.54.0] - 2026-10-01

### Added

- A v3 project's rituals come from git. Every run-due batch reconciles each linked v3 checkout into the store: new tables are adopted, changed ones updated, removed ones retired. The item records the definition hash, commit, host, time and whether the marker was dirty. A `ritual.defined` ledger line keeps the history.
- `darius ritual reconcile [--dry-run] [--json]` does the same by hand.
- A ritual's `at` time is honoured: run-due starts it at the first tick at or after that time in its zone, not before.
- The marker's `timeout` replaces `--timeout` for that run. The lease TTL follows it.
- New skip reasons: `marker-dirty` (the `.darius.toml` file has uncommitted changes), `marker-invalid`, `skill-missing` (no `.claude/skills/<skill>/SKILL.md` in the checkout), `not-in-marker` (a store ritual in a v3 project that the marker does not name).
- A retired ritual whose slug comes back in the marker stays retired. Reconcile warns: use a new slug.

### Changed

- The run-due timer fires every 15 minutes (`*:05/15`), not hourly. darius decides from the marker what is due. The NixOS module default follows. A host with its own drop-in keeps it until the operator removes it.
- In a v3 project `ritual add` and `ritual retire` are refused, and `ritual set` accepts only store-owned flags (host, owner, tags, due). A git-owned flag names the file and line to edit.
- `darius run now` reconciles first. A dirty marker is a warning there, not a skip.
- `darius init` writes `v = 3` with the host's `tz`.
- `darius import` refuses a v3 project.
- `lease-held` is a quiet skip with exit 0.

## [0.53.0] - 2026-10-01

### Added

- Marker v3 can be read. A `.darius.toml` with `v = 3` may hold `[rituals.<slug>]` and `[policies.<name>]` tables and a required root `tz` (an IANA zone). A ritual names a skill, a cadence, and optionally `at = "HH:MM"`, its own `tz`, `from` (the start date of its grid), `timeout`, a profile, a model, `max_turns`, and either `policy = "<name>"` or its own `mode`, `may`, `hold` and `notes`. Hosts do not act on these tables yet; 0.54.0 does.
- `darius marker check [dir] [--json]` validates the marker and names the file and line of an error.
- `darius link --list` adds `v3 (N rituals)` to the ok line of a v3 checkout.
- The TOML reader takes arrays over several lines and single-quoted literal strings, so `hold` regexes need no escapes.
- Due math knows instants: an occurrence is the grid date at `at` in the ritual's zone. A completion satisfies every occurrence at or before it. Clock changes follow the usual rule: in an overlap the earlier instant wins, in a gap the time moves forward. v1 and v2 rituals behave as before.
- Store ritual items accept the new keys (`source`, `at`, `tz`, `from`, `timeout`, `def_*`). Every host must run 0.53.0 or later before 0.54.0 writes them.

## [0.52.0] - 2026-10-01

### Added

- A darius-started session ends with a sign-off: a small ASCII ghost leaving a castle, the ritual, the run, the result line, and when it ended and how long it took. A held run shows the ghost waiting at the gate with the question count and the answer command. A glance at the herdr panes in the morning shows that things went as expected.
- `darius run complete` and `darius run hold` print the sign-off after their output when `DARIUS_RUN` is the run. A person gets it only with `--banner`. `--json` never has it.
- The run prompt has a rule: after `run complete` or `run hold` succeeds, the last message is the sign-off block, copied exactly inside a code block. The resume message says the same.

### Changed

- A finished run's herdr tab now stays until a newer run of the same ritual has started, or until the run ended more than 48 hours ago. Before, the next batch closed every finished tab. A held run's tab is never closed this way.

## [0.51.0] - 2026-10-01

### Added

- `darius snapshot config [--json]` prints every snapshot setting with its value and source (env, file, config, default).
- `darius snapshot config set <key> <value> [<key> <value> ...]` and `config unset <key> [...]` save to `snapshot.json` with the page's rules. A key the environment sets exits 1 and names the variable. A bad value exits 1 with the page's message. An unknown key exits 2 and lists the keys. `endpoint` and `bucket` go in one call. `--json` gives `{ok, key, value, source}`.
- `darius snapshot credentials set --key-id <id>` reads the secret from stdin only. A terminal, a secret in argv and a `--secret` flag exit 2. The file stays mode 0600. `credentials clear` removes it. `credentials [status]` names the source and the key id, never the secret. When the environment sets the pair, set and clear exit 1.
- `darius snapshot status` has a timer line and a `timer` object in `--json`: installed, enabled, active, the next run, and the fix when it is missing or stopped. No systemd user session prints `timer: unknown` and keeps the exit code.
- `darius snapshot list --remote` lists the bucket's snapshots of this host, newest first, with size and whether each is also here. `--json` gives `{ok, local, remote}`. Exit 1 without a bucket, 3 when the bucket cannot be reached.
- The darius skill has a Backups section: the verbs, the exit codes, and the rule that the secret goes on stdin only.
- `DARIUS_SYSTEMCTL` names the systemctl program for `snapshot status`. The test script points it at a missing file.

### Changed

- The settings page and the CLI save through shared core functions in `src/core/snapshot-settings.ts`: `applySnapshotSettings`, `saveSnapshotCredentials` and `removeSnapshotCredentials`. Each refuses what the environment sets, with one message.
- The page's key pair endpoints (`/api/snapshots/credentials` and `credentials/clear`) now refuse with 400 when the environment sets the pair. Before, they wrote or removed a file that was never used.
- `snapshot config` and `snapshot credentials` read `~/.config/darius/snapshot.env` under the shell's variables, so a key the units get from that file is shown as env and refused.
- The README backups guide gives the CLI route next to each page step. The concept doc records the shared core.

## [0.50.1] - 2026-10-01

### Changed

- The settings pages are redesigned for reading. Every setting is one row: the label and a one-line help on the left, the control on the right. On a phone the control drops under the text.
- Related rows sit in titled cards. A marker shows only where a value is not the default: "Saved here", or "Set by the environment" with a lock and the variable name.
- The backups tab folds the remote fields behind one button and says at once whether a remote copy is set up. Unsaved changes show a sticky save bar with Save and Discard.
- The key pair sits in no form, so an early Enter cannot send the secret in a URL. Inputs are short, medium or long by what they hold.
- Settings buttons and the run page's follow-up card share one button style.

## [0.50.0] - 2026-10-01

### Changed

- `run now`, `run resume` and `run follow-up` typed on the wrong host refuse with exit 1, also with `--dry-run`. The right host is per ritual: its pin, else the host that linked its checkout. One line names it and the command to type: `! heartbeat runs on host-b (pinned): ssh host-b darius run now heartbeat --project acme-web`, or `(its checkout is linked there)`. `--json` gives `{ok: false, ritual, host, why, command}`.
- A by-hand `run now` or `run resume` that finds no checkout on this host (`no-workdir`) exits 1 too. The timer and the vigil sweep keep their quiet skips.
- On a host without the checkout, the run page's follow-up card is off and says "This ritual runs on <host>. Open this page on <host>, or run:" with the ssh command in a copy box. The readiness reason carries the host and the command. The page never forwards.

### Added

- `--on <host>` on `run now`, `run resume` and `run follow-up` runs the same verb on that host over ssh: `BatchMode`, a 10 second connect timeout, `DARIUS_SSH` for the program, a login bash for the PATH. Every word is shell-quoted. The output streams back and the exit code passes through. The host applies every check itself. `--who` becomes `<login>@<this host> via ssh` unless given. `--on` naming this host runs here.
- `--on` is refused when `DARIUS_RUN` or `DARIUS_RUN_POLICY` is set, and the gate denies `darius run now|resume|follow-up ... --on` in every run, since ssh drops those variables.
- `ritualHost(project, ledger, ritual)` in `src/core/workdir.ts` says where a ritual runs and why. The ssh helper moved from `src/cli/update.ts` to `src/core/ssh.ts`.

## [0.48.2] - 2026-10-01

### Fixed

- A run's `policy.json` is now a blob in the store. Since 0.47.1, `run.started` and `run.resumed` name it as `policy_sha`, and sync pushes every blob a ledger line names. The blob was missing, so the sync after a launched run failed with "names blob ..., which is not in the local store".

## [0.48.1] - 2026-10-01

### Changed

- The README backups guide is rewritten for a first-time reader: quick start, what is and is not backed up, adding a bucket, checking that a backup works, a failure table, and a restore that also stops the snapshot timer. The concept doc says what the bucket check compares (size only) and what an exit 3 means for the next run.
- `darius snapshot status` prints the last bucket contact on its own line, so a run that made its local snapshot but missed the bucket is visible.

### Fixed

- `darius snapshot create` with `enabled = false` does nothing and exits 0. It exited 1, so the timer unit showed as failed every night.
- The number fields on the backups page no longer accept 0 (`keep` and `keep_remote` start at 1).
- Stale comments about the retired git export are gone.
- The home-manager module `services.darius` declares `darius-snapshot.service` and its timer (04:00, `snapshot.env`), as `setup --systemd` does for a checkout. Before, a Nix host had no snapshot timer.
- The NixOS VM test runs the snapshot unit for both installs. It adds its two test vigils to the store directly, because `darius vigil add` is a legacy verb that writes `.tracker/vigils/`, which `vigil sweep` does not read.

## [0.48.0] - 2026-10-01

### Added

- A follow-up button on the run page. When a question lists commands and this host can start the follow-up (checkout, profile with permissions skip, herdr running), the card offers the questions to approve, a note, and `Start follow-up on <host>`. The first press shows every line the run will be granted; the second starts it. Otherwise the card names the reason, such as `gated profile` or `no herdr`, and gives the CLI command.
- `POST /api/run/follow-up` takes `{project, run, approve, note?}`, never grant lines. Same Origin, JSON and size cap as the other write endpoints. It checks readiness again, starts `darius run follow-up ... --who "web:<who>"` detached with its output in `runs/<run>/follow-up.log`, and answers `{ok: true, pending: true}`.
- `WebContext.followUp(project, run)` says whether this host can start a follow-up now, from a dry run of the verb. It writes nothing.
- The run page shows each question's command lines as written, links a follow-up to its parent, and lists a parent's follow-ups. The run data carries `followUpOf` and `followUps`.

### Security

- The follow-up button needs a tailnet identity. A request from loopback ("this host") gets 403, since any process here, a run with `curl` too, is that viewer and may set its own Origin. The run page viewed over loopback says so instead of offering the button.
- A follow-up waits while any run of the project is running: "run <id> of <ritual> is running; a follow-up starts when no run is open". A held run does not stop it. The CLI and the page check this the same way.
- The gate reads `$'...'` and `$"..."` quoting as plain words, so `darius run $'follow-up' X` is denied like the plain line.
- The gate catches `env -i` and `env -u` inside a cluster of flags, such as `env -iu X`.
- A grant line may not start with a shell or a loader: `bash`, `sh`, `zsh`, `dash`, `fish`, `eval`, `source`, `.`, `exec`, `env`, `xargs`, `nohup`, `setsid`, `sudo`, `time`, `command` or `builtin`. Such a line runs code the operator does not see; grant the command itself. `pnpm`, `node` and `python` lines stay grantable.
- The TUI's Failed today list leaves follow-ups out, as the timer does.

## [0.47.1] - 2026-10-01

### Fixed

- A follow-up run no longer moves the ritual's due date when it completes, and its failure no longer counts as failed today. The next scheduled run gets the parent's handoff, not the follow-up's.
- A granted line passes only in the run's working dir. A follow-up's `policy.json` carries `cwd`, and the gate compares it with the hook payload's `cwd`, symlinks resolved. Elsewhere the hold list applies. The follow-up prompt says not to cd.
- `run.started` and `run.resumed` record `policy_sha`, the sha256 of `policy.json`. A `policy.json` with grants that no longer matches denies every call: "policy.json changed since the run started".
- The gate denies `darius run follow-up` in every run, whatever `may` says, under prefixes such as `env -u DARIUS_RUN`, `FOO=1`, `sudo`, `nohup`, `setsid` and `bash -c`. It also denies a line that clears `DARIUS_RUN` or `DARIUS_RUN_POLICY`.
- `run follow-up` with a gated profile names `permissions = "skip"` and `[defaults] follow_up`. With nothing granted, it says that is `run now` with a note, and gives both commands.

## [0.47.0] - 2026-10-01

### Added

- `darius run follow-up <run> [--approve N ...] [--grant LINE ...] [--note TEXT] [--headless] [--timeout S] [--dry-run] [--json] [--who W]`. It starts a new run of the ritual of a complete run, in a herdr tab, and the gate passes the command lines of the approved questions and the `--grant` lines as written. It takes the path of `run now`: lease, `max_mode`, profile, preflight, report and alerts.
- `run.started` of a follow-up carries `follow_up_of`, `approved` and `grants`; its `policy.json` carries `grants` and `follow_up_of`. The prompt gets a `## Follow-up` section after the handoff: the parent's summary, the approved questions, the operator's note, the granted lines, the parent's open items and actions.
- When the parent waits for the operator's decision, starting the follow-up acknowledges it, with the note `follow-up <run>, approved N`.
- `[defaults] follow_up` in `.darius.toml` names the profile of a follow-up; without it the ritual's profile applies.
- `run list` and `run show` mark a follow-up and its parent; the JSON rows carry `followUpOf` and `followUps`.
- `run follow-up` refuses, each with one line: a parent that is not a closed, complete ritual run; a question with no commands (use `--grant`); a line that is not one plain command; a ritual not in mode act; a mode above `max_mode`; a ritual pinned to another host; no linked checkout on this host; an open or held run of the ritual; an open follow-up of the same parent; a profile with permissions gated; herdr not running (pass `--headless`); a call from inside a run. `--dry-run` prints the grants and the tab it would open, and writes nothing.

## [0.46.0] - 2026-10-01

### Added

- Command grants in the gate. A run's `policy.json` may carry `grants`, exact command lines an operator approved, and `follow_up_of`. A shell line that equals a grant, with spaces and tabs outside quotes collapsed, passes the hold list, `may` and the report-mode verbs, as often as the run needs. Only the main session gets grants; a subagent call never does. A chain that holds a granted line is decided as before. A held run stays held.
- A grant is one plain command: one line of at most 300 characters, one part in the shell split, no redirection, no `$` or backticks, no glob, brace or `~` outside quotes, no assignment to a name like `PATH`. `policy-check` denies every call when `policy.json` holds a grant that is not.
- Result questions may list `commands`: up to 20 exact lines a yes would run, each one plain command. `run complete --outcome complete` refuses a block with a line that is not. The Result prompt explains the field and says to use a dir flag such as `pnpm -C tools`, not `cd tools && ...`.
- `run show` prints each question's command lines under it. The web run data carries them.

## [0.45.0] - 2026-10-01

### Changed

- `run complete --outcome complete` refuses findings markdown over 4000 characters, counted with the `darius-result` block cut out. The run stays open and the refused text goes to `runs/<run>/findings-rejected.md`. Failed and abandoned outcomes are unchanged.
- Result text limits are tighter: summary 240, detail 400, question 300, recommendation 200, action 200. Clipping stays silent. The Result prompt names the numbers.

### Added

- `STYLE_PROMPT`: a Style section in the run prompt, before Result. Short sentences, facts, one line per item, and no re-listing of items. The resume message points to it.
- A `## Prose` block in the darius skill, with the same rules for worklog entries, findings, handoff and vigil bodies.

## [0.44.0] - 2026-10-01

### Added

- `darius snapshot create|list|status|check|delete`: a dated `.tar.gz` of this host's store in a local folder (`~/.local/share/darius-snapshots`), with a manifest and SHA-256, and an optional copy in an S3 bucket. Retention keeps the newest 7 locally and 30 in the bucket. Large files go up in parts (multipart upload), and a failed upload is aborted.
- Snapshot settings come from the environment (`DARIUS_SNAPSHOT_*`), the status page (`snapshot.json`), `[snapshot]` in `config.toml`, and defaults, in that order. The key pair comes from `DARIUS_SNAPSHOT_ACCESS_KEY_ID` and `DARIUS_SNAPSHOT_SECRET_ACCESS_KEY`, or `snapshot-credentials` (mode 0600).
- `darius-snapshot.timer` runs the snapshot daily at 04:00. `snapshot` is a new name for `[setup] units`, installed by default. Both it and the web service read `~/.config/darius/snapshot.env`.
- The status page `/status`: the machine, the hosts that sync, and every project's last sync and counts.
- The settings page is now tabs: General, Notifications, Backups, About. `/settings/backups` holds the backup controls: run now, the snapshot list, delete, the settings with their sources (a value set by the environment is locked), the write-only key pair, and a bucket check.
- `/api/snapshots/...` on `darius serve`: the page's writes. Each request needs the page's own Origin, JSON, at most 4 KB, and passes the access check; no answer ever holds the key pair.

### Removed

- `darius export`, the `[backup]` table of `config.toml`, `darius-export.service` and `darius-export.timer`, and `export` as a name for `[setup] units`: the snapshot replaces the git backup. `setup --systemd` removes an export unit that darius wrote. An old `[backup]` table is ignored; `export` in `[setup] units` is an error. The old clone and the private repo it pushed to stay on disk and on the remote until you delete them.

### Changed

- `darius serve` is no longer read-only: the push and snapshot endpoints are its only writes.
- The S3 client has `upload(key, source)` for multipart uploads. Its other calls are unchanged.

## [0.43.0] - 2026-10-01

### Added

- `darius export [--dry-run]` mirrors this host's store into `<host>/` of a private backup git repo, writes `<host>/EXPORT.json`, commits when something changed, and pushes. Offline, the commit stays local and the verb exits 3.
- `[backup]` in `config.toml`: `repo` (required to export) and `dir` (the local clone, default `~/.local/share/darius-backup`). Without it, `darius export` exits 2.
- The export refuses when the store holds a name that looks like a secret, when the store and the config dir overlap, and when `[backup] dir` is a clone of another repo. It never copies the config dir.
- `darius-export.timer` runs `darius export` daily at 03:30 with up to 10 minutes of random delay. `setup --systemd` installs it only when `[backup] repo` is set; `export` is a new name for `[setup] units`.
## [0.42.3] - 2026-10-01

### Fixed

- In gate scope `full`, a bare shell assignment such as `NAME="value"` passes without a `may` rule, and an assignment prefix on a command is matched by the rules on that command; command substitution and assignments to names like `PATH` are still refused.
- An option that takes a value takes the next token even when it starts with `--`, and a missing value is a usage error that names the option, instead of a silent drop.
- `darius update` leaves a timer that was stopped before the update stopped, prints one line for each, and restarts the active ones; `setup --systemd --keep-stopped` does the same for setup.

## [0.42.2] - 2026-10-01

### Fixed

- The run prompt points at the skills in `.claude/skills/` at the repo root only, with no hint of a subdirectory.
- The concept doc defines a djinn as the unattended session darius starts, a runtime role, not a thing in the repo.

## [0.42.1] - 2026-09-30

### Fixed

- Markdown on the web pages joins a hard-wrapped paragraph into flowing text, as any markdown viewer does, so specs, worklogs and run findings no longer break at every source line on a phone. Two trailing spaces or a trailing backslash keep a break.

## [0.42.0] - 2026-09-30

### Added

- Each milestone has its own page, `/w/<workspace>/milestones/<id>`, read-only: its state, dates, bar and check count, a status strip of spec counts, the README, every spec with its full text, its worklogs, and every other file in its folder.
- On that page a short spec starts open; a long spec, each worklog and each file start folded, with a status line.
- A worklog belongs to a milestone when its name starts with the milestone id (`M12-...md`, the rule of the tracker's worklog index), or when one of its threads names a spec of the milestone (`<!-- spec: ... -->`).
- The open row of a milestone in the list links to its page.
- Markdown in the app shows checklist boxes (`[x]`, `[ ]`, `[~]`, `[!]`, `[-]`) and indented items.

### Changed

- Markdown in the app leaves out HTML comments on lines of their own, and an indented line that starts no item continues the list item above it.
## [0.41.2] - 2026-09-30

### Fixed

- The desktop tabs show their icons, bigger text and a gold underline on the active tab, so the nav is easy to see.

## [0.41.1] - 2026-09-30

### Fixed

- `darius sync` exits 0 when another host holds a project's lease, as `vigil sweep` does. The skip is still in the report. Both hosts' sync timers fire on the same quarter hour, so the old exit 3 marked the sync unit failed several times a day. An unreachable bucket still exits 3.

## [0.41.0] - 2026-09-30

### Added

- The web app is organised by workspace. The top bar holds the brand mark (the Overview), a workspace switcher (Overview, All workspaces, each workspace with its needs-you count, a red mark when another workspace needs you) and a settings gear. Three tabs, a bar at the bottom of a phone and a row under the top bar on a desktop: Vigils, Rituals, Milestones, with counts of what is due or late.
- Milestones, read-only from the legacy tracker: each workspace lists its milestones (In progress, Not started, Complete, Closed) with a progress bar and "103 of 143 checks done", the same numbers as the tracker index; a milestone opens in place to its specs, with a tick when all checks are done and what each depends on. A past target shows as late.
- A Settings page: theme (dark, light, follow the system), density (comfortable, compact), default workspace, show the self-test workspace, reduce motion, the notification switch (moved from the footer), and host and version. The choices live in one cookie in the browser.
- A light theme, with every text colour at 4.5:1 contrast or more on its ground; the browser's theme colour follows it.

### Changed

- URLs: `/w/<workspace>` and `/w/<workspace>/vigils|rituals|milestones`, `/vigils|rituals|milestones` and `/all` for all workspaces; `/` opens the default workspace. `/p/<project>` redirects to `/w/<project>`; ritual and run pages keep their URLs.
- The project page is now the workspace Overview. Coming up and Waiting on an event moved into the Rituals and Vigils sections.
- `darius serve` forwards the `darius-settings` cookie, and no other, to the web app, so a page renders in the chosen theme.
- Page titles read "Section · workspace | darius"; ritual and run pages show their own title again.

### Fixed

- The runs filter no longer lists the self-test workspace when it is hidden.

## [0.40.0] - 2026-09-30

### Added

- One CLI: `darius` runs every legacy tracker verb through the vendored, frozen `src/legacy/`, and `DARIUS_KINDS` decides which verbs use the store.
- `darius init` links a repo, fresh or legacy, and the install script prints the lines that lead to a working repo.
- The generated skill teaches the absorbed verbs, and its size cap is 6 KB.

### Changed

- The tests remove their temp dirs, and `scripts/test.sh` runs the suite in one temp dir it deletes.
- `darius context` is a plain unknown-command usage error, since the legacy CLI has no such verb.

### Fixed

- A run that cannot start because `claude` is not on PATH now says so and names the fix.

## [0.38.1] - 2026-09-30

### Changed

- The Makefile and `scripts/lane.sh` moved to the private workspace repo; `bun run check` runs the three gates.

## [0.38.0] - 2026-09-30

### Added

- `darius skill` prints one generated Claude Code skill for darius, and `darius --skill` is the same. It lists only the verbs a working session needs and stays under 4 KB.
- `darius skill install` writes the skill to `~/.claude/skills/darius/SKILL.md` (or under `CLAUDE_CONFIG_DIR`) and prints the path. It refuses a file there that darius did not write.
- `darius skill uninstall` removes the skill file darius wrote.
- `darius skill hook` prints a SessionStart hook to paste into Claude Code's `settings.json`. It runs `darius due --brief`.
- `darius due --brief` prints at most one line for the project in the current directory: the due and held rituals and the next command. It reads the local store only and always exits 0.
- `darius setup`, and so `darius update`, refreshes an installed skill file that darius wrote.

## [0.37.0] - 2026-09-30

### Changed

- A row says what it is once, in colour: the icon at its start (circling arrows for a ritual, a hand for a manual ritual, an eye for a vigil) and one coloured word under the title ("ritual", "manual ritual", "vigil"), with no boxes. Ritual and run pages show the same icon and word next to the state.

## [0.36.0] - 2026-09-30

### Added

- A "Next" line under the home verdict names the next ritual or vigil and when it is due, and links to it.
- A manual ritual's page explains that darius does not start it and how to give it a policy, and shows its instructions open.

### Changed

- Kinds are ritual and vigil; manual is a mark on a ritual, so a manual ritual shows both "ritual" and "manual".
- One set of state words on every page ("13 days late", "Waiting for you", "Asks you", "Failed, seen", "Complete"), in plain sans type instead of spaced capitals.
- Every list uses one row: the full title, then the chips, the state and the details, with the time at the end. Only rows that need attention get a coloured edge. Result counts are small chips.
- Empty parts do not show: zero counts in the status strips, an empty Needs you, an empty Now. The home strip says "late" instead of "overdue".
- Ritual and run titles use the sans face, so long titles stay readable. The project page's "Djinns" section is now "Latest reports", as rows.
- Imported runs in a ritual's history carry an "imported" chip.

## [0.35.0] - 2026-09-30

### Added

- Three kinds, each with a word, a colour and an icon, on every page: ritual (darius runs it, turquoise, circling arrows), manual (done by hand, rose, a hand) and vigil (a one-shot check, amethyst, an eye). The state colours keep their meaning.
- Runs carry the icon of what they belong to, in Now, Last night, Recent runs and the runs list, and the ritual and run pages show the kind next to the title.

### Changed

- The tags in Coming up read "ritual" and "manual" instead of "djinn" and "by hand", and a row shows its state as a thin rail in the state colour.
- The "vigils armed" part of the status strip carries the vigil icon.
- Titles in Coming up show in full, so two rituals that differ only at the end stay apart. The "Next:" title in the home sub line ends at a word.

## [0.34.0] - 2026-09-30

### Added

- "Coming up" on the home page and the project page: one list of every active ritual and every dated vigil, grouped by day (Overdue, Today, Tomorrow, the next 14 days, Later, No schedule). Each row says who runs it (djinn or by hand), how often, when it was last done, and its state.
- "Waiting on an event" lists the armed vigils without a due date, flagged first.
- The home sub line names what is next ("6 overdue. Next: Daily site report, tomorrow."), and the home strip counts what is due today and the armed vigils.

### Changed

- Home drops "Up next" and "Djinns": every djinn is now a row of Coming up. On a phone, Last night shows no report excerpt.
- The project page shows Coming up and Waiting on an event in place of Scheduled, By hand and Vigils. Its overdue count includes dated vigils past due.

### Fixed

- A legacy vigil whose title is in single quotes no longer shows the quotes.

## [0.33.0] - 2026-09-30

### Changed

- The home page is a phone-first dashboard for all projects. A status strip counts what needs you, what runs, what failed, what is flagged and what is overdue, and each part links to its section. "Now" lists the running runs with their live bar, and "Up next" lists the next djinns and the manual rituals that are overdue or due today.
- Needs you cards are compact: the questions show as text, and the answer and ack commands wait in a closed "Answer from a terminal" fold.
- The Home badge counts the things that need you, the same number as the home headline, not the open questions.
- The Watch gauges are gone. Timer and sync health is one line, still coloured when stale or failing.
- On a phone the project page is one column in reading order: Now, Scheduled, By hand, Vigils, Djinns, Recent runs. Rows put the state and time under the title, djinn cards drop their report excerpt, and long lists fold behind "Show more". Overdue manual rituals read "overdue 9 days".
- The runs filter is two scrolling chip rows on a phone, so the first run shows without scrolling.
- The project sheet on a phone has a backdrop, a header and a close button, and the project name in the top bar links to the project.
- A run that asks you shows its questions and the ack command before its numbers, and the numbers are a compact list.
- Page titles are smaller on a phone, and every link and button there is at least 44 px tall.

### Fixed

- The footer no longer hides behind the phone tab bar.
- The runs filter chips no longer take the styles of the status strip.
- Dates in page titles and project names in commands no longer break at their hyphens.

## [0.32.0] - 2026-09-30

### Added

- The web app can go on a phone's home screen and show push notices. It has a manifest, a new icon (a cut gem) in every size a phone asks for, and a service worker that shows a notice and opens its page on a tap. The worker has no fetch handler, so a page is never served from a cache.
- A switch in the footer turns notices on and off for each device. It registers the service worker, subscribes with the host's key and posts the subscription to `darius serve`. When push cannot work, it says why: not HTTPS, an iPhone without the Home Screen icon, notices blocked, a server without the push endpoints, or no push keys on the host (`darius push keys`).

## [0.31.0] - 2026-09-30

### Added

- Phone notifications by Web Push. `darius push keys --subject <mailto:|https:>` makes the VAPID key pair in `push.json` (0600; copy it to every host that sends), and `push status`, `push devices`, `push forget <n>`, `push test` and `push flush [--dry-run]` manage the rest. The encryption (RFC 8291) and the signature (RFC 8292) use WebCrypto; no dependency.
- `darius serve` takes the web app's subscriptions: `GET /api/push/key`, `POST /api/push/subscribe` and `/unsubscribe`. A POST must come from the page itself, as JSON, and name an https endpoint of a known push service. Devices are kept in the store, so every host can send to them.

### Changed

- Alerts (held runs, questions, failed runs, failed gate checks, failing skips) go to the subscribed devices instead of Telegram. A tap opens the run. A host without push keys or without a device sends nothing and keeps no backlog.

### Removed

- `darius alert` and the Telegram channel.

### Fixed

- The NixOS VM test runs again: its fake Claude Code prints a version, passes the gate check per harness version, and ends its run with a result block.

## [0.30.0] - 2026-09-30

### Added

- `darius serve` and the web dev server work behind a reverse proxy. `DARIUS_WEB_PROXY` names the proxy's addresses, and a request from it passes when the proxy's device header (`DARIUS_WEB_PROXY_HEADER`, default `X-Tailnet-Device`) names a device in `DARIUS_WEB_PROXY_DEVICES`. The header counts only from the proxy. `DARIUS_WEB_URL` is the address people open.
- A `Makefile` for the dev machine: `make next` runs the checkout as the next lane on port 4748 (hot reload, `demo=1`, `serve=1`) beside the installed stable lane on 4747, and `make status`, `logs`, `down`, `check`, `build`, `wt`, `release` and `update` cover the rest. Host values live in `~/.config/darius/web.env` and `next.env`.

### Changed

- The repo is public. Its examples, tests and docs use generic names (host-a, acme-web, 100.64.1.10) instead of real hosts, devices, people and projects. Private notes for a checkout go in `CLAUDE.local.md`, which git ignores.
- `scripts/install.sh` and `darius update` default to `https://github.com/AltanS/darius.git`, so an install needs no GitHub SSH key. A host keeps the source of its current clone.
- `scripts/seaweedfs-install.sh` no longer has a built-in tailnet address: it takes `DARIUS_SEAWEEDFS_TAILNET_ADDR`, else `tailscale ip -4`, and writes it to `~/.config/darius/seaweedfs.env`, which `darius-seaweedfs.service` reads. Re-run the script once on the bucket host before that unit restarts.
- `scripts/acceptance.sh` takes the legacy checkout from `DARIUS_ACCEPTANCE_REPO` and skips that step without it.

## [0.29.0] - 2026-09-30

### Added

- Telegram alerts: `darius alert setup telegram` (bot token on stdin, finds your chat, sends a test), `alert status`, `alert test`, `alert flush [--dry-run]`, `alert off`. The token stays on the host in `alerts.json` (0600) and is never printed.
- darius sends an alert when a run is held, when a complete run asks questions, when a run fails, when a gate check does not pass, and when a ritual cannot start for a failing reason. The host that wrote the event sends it, one time. A failed send is tried again up to three times.
- Alerts go out after each run-due batch, `run now` and `run resume`, and after each `darius sync`.

### Changed

- A profile may not pass `--fallback-model` to Claude Code: darius runs the model you name, or none.

## [0.28.0] - 2026-09-30

### Added

- The web page shows the vigils that only the legacy tracker holds (`<checkout>/.tracker/vigils/`), read-only and never over a vigil of the store. Before, a project with only legacy vigils showed none, although some were armed. Vigils that are due today or late come first, the rest sit behind "more armed", and closed ones show the newest ten. Operator request; the scope rule (docs/concept.md) allowed it as a fix from real use.
- A project menu in the top bar lists every project with its open questions. On a phone the tabs (Home, Runs, Projects) sit in a bar at the bottom, where a thumb reaches them.

### Changed

- The four big number blocks of the project page are one slim status strip: running, need you, vigils armed, overdue by hand. Each segment still opens what it counts.
- Vigils get their own full-width panel under Now and Scheduled. An armed vigil says Overdue or Due today when it is.

### Fixed

- The run result's metric tiles no longer inherit the style of the removed summary tiles (both used the class `tile`).

## [0.27.0] - 2026-09-30

### Added

- Home: the Running, Held and Flagged numbers of the Watch panel open what they count, and a djinn row opens its ritual anywhere you press it.
- `bun run web:dev --demo` shows demo data with every state, and `bun run web:dev` listens on the tailnet, so a phone follows each edit live (same login check as `darius serve`).

### Changed

- Project page: a Scheduled row names the state of its latest run (Complete, Failed, Running) instead of a bare square. The Vigils panel hides when no vigil is armed, and its tile then stops being a link.

## [0.26.0] - 2026-09-30

### Added

- Ritual handoff: a run's result block may carry `handoff`, a note of at most 200 characters for the next run of the same ritual. A longer note is refused, not cut. `run complete` keeps it on the ledger line.
- The next launched run of the ritual gets the note at the top of its prompt, with the questions of that run and the operator's `darius run ack --note`. Before, that note was display only and no run saw it.
- `darius run start` prints the handoff for a run by hand (`--json`: `handoff`). `ritual show`, `run show`, the ritual page, the run page and the TUI run view show it.

## [0.25.0] - 2026-09-30

### Added

- The project page opens with a dashboard head: four tiles (running, needs you, vigils, overdue), then panels for what runs now, what is scheduled and which vigils are armed. Each tile, row and djinn card opens what it shows.
- Motion for state: a running run sends out a ring and sweeps a light along its top edge, a run that waits for you breathes, and new rows rise in. `prefers-reduced-motion` turns all of it off.

### Changed

- Phone layout: a row puts its state and time on their own line under the title, so a long state no longer squeezes the title. The tiles form a two by two grid.
- The page reserves room for the scrollbar (`scrollbar-gutter: stable`), so moving between a short page and a long one no longer shifts the layout sideways.
- Manual rituals move to a "By hand" list in the rail (six shown, the rest in a fold). Scheduled checks and open vigils moved from the rail to the head of the page.

## [0.24.0] - 2026-09-30

### Added

- `darius run show <run> [--json]` prints a run's facts, its result block and its findings. A run, a session or a person can read an earlier run without looking up blob paths.
- `darius run list --json` carries each run's result counts (`result`).

## [0.23.0] - 2026-09-30

### Added

- With permissions skipped, a run may write a scratch file under `/tmp` with the Write or Edit tool, as it may with `>`. The gate refuses every other path. A gated run still has no write tools.

## [0.22.0] - 2026-09-30

### Added

- Run results. A run's findings end with one fenced `darius-result` block of JSON: status, summary, metrics, items (severity, state, group, target), questions for the operator, and actions. `darius run complete` checks it, lists every problem, and stores it apart from the markdown; the ledger line gets its counts. The run prompt shows the format with an example.
- Every run darius launches must hand in a valid result to complete. A refused hand-in keeps the run open and is kept in `findings-rejected.md`; if the run then fails, the failure keeps it. A by-hand run may hand in a result, which must then be valid.
- A complete run with questions for the operator waits on the "needs you" lists and in the batch report until `darius run ack <run> --note "<decision>"` records the decision.
- The web run page draws the result: a status banner, metric tiles, a questions card, items grouped by market and sorted by severity, and actions. Run lists show open critical and high counts and questions. The TUI shows the result on the Run screen, lists runs that ask you something under "Asks you", and `a` there records your decision.

### Changed

- An act ritual that names `Agent` is skipped as `subagents-unproven` (a failing skip) when the gate check did not prove subagents on this host. A report ritual still runs without them.

### Fixed

- `darius run complete --findings-stdin` reads the input a caller in the same process hands in, as `policy-check` does.

## [0.21.0] - 2026-09-30

### Added

- Rituals can use subagents. A ritual opts in by naming `Agent` in its `may` (`darius ritual set <slug> --may ... --may Agent`). Every tool call of a subagent then passes the darius gate with the same policy. The gate refuses a subagent that starts another subagent, a subagent with `isolation` (a remote or worktree subagent), and `darius run complete` from a subagent.
- The gate check per harness version also starts a subagent and proves that the gate judges its calls (`subagents: passed` on `harness.checked`). A ritual gets subagents only on a version whose check proved them on this host. Without that proof, the ritual runs without subagents, and the report says why.
- The run prompt says the subagent rules, and to wait for every subagent before the run is completed.
- The gate log records the subagent that made a call (`agent`).

### Upgrade note

- Checks from before 0.21.0 do not prove subagents. Run `darius harness check claude` on each runner host, or a ritual with `Agent` runs without subagents until the next Claude Code version is checked.

## [0.20.1] - 2026-09-30

### Fixed

- The text of a dry run names its warnings, such as a pending gate check ("would check claude 2.1.285 first") or a surface fallback. Before, only `--json` showed them.

## [0.20.0] - 2026-09-30

### Changed

- darius alone decides for unattended runs. A profile without `permissions`, and a ritual with no profile, now run with permissions skipped: Claude's own permission system is off, and the darius gate enforces the whole policy. The gate check per harness version (0.19.0) proves that Claude obeys the gate.
- A gated profile now passes `--permission-mode dontAsk`, so Claude refuses a call that its allowlist does not name, also in a herdr tab. Before, a gated run in a tab stopped at Claude's prompt and waited for a person.

### Upgrade note

- To keep Claude's allowlist as a second layer, set `permissions = "gated"` on a profile (`darius profile set <name> --permissions gated`).

## [0.19.0] - 2026-09-30

### Added

- A gate check per harness version. Before the first run of a new Claude Code version on a host, run-due, `run now` and `run resume` start it for real with `haiku` and permissions skipped, and prove that the darius hook blocks a `touch`. A version that did not pass skips its rituals as `harness-unchecked` (a failing skip) and is not tried again that day. The report names each check it ran.
- `darius harness check [<id>]` runs the check by hand; `darius harness list` shows the latest check per version and host. The ledger line is `harness.checked` in `_global`.
- `darius policy-check` writes each decision to `gate.jsonl` in the run dir.

### Changed

- The web pages show `harness-unchecked` and `tool-missing` skips in red, like the other failing skips.

### Upgrade note

- The first run-due after this update spends one short `haiku` call per host, to check the installed Claude Code version.

## [0.18.1] - 2026-09-30

### Fixed

- In gate scope `full` (a profile with `permissions = "skip"`, or a ritual with a skill), an output redirection to a file under `/tmp` or to `/dev/null`, and `2>&1`, no longer refuses the command. A skill that writes its step output to `/tmp` can now run unattended. Every other redirection is still refused.
- A refusal from the `may` rules names its reason, the construct or the command that no rule allows. Before, the model saw only "not allowed by the policy's may rules".

## [0.18.0] - 2026-09-29

### Added

- `darius run ack <run> [--note TEXT]` marks a failed or abandoned run as seen. It is display only: the timer still does not retry the ritual that day, and `darius run now` still re-runs it. A held, running or complete run cannot be acknowledged.
- The web pages and the TUI say what comes next for a failed run: no retry today, when the timer tries again, and the commands to re-run it or acknowledge it. Every page shows an acknowledged failure as "Failed, acknowledged" in grey.
- The TUI Run screen of a failed run has two keys: `a` acknowledges it, `n` re-runs it now in the background.
- `darius ritual set <slug> --host NAME` pins a ritual to one host. run-due and `run now` on any other host skip it as `other-host`. `--host ""` clears the pin. The pin lives in the store, not in the repo.

### Changed

- The failed-today skip in a report names the acknowledgement, or the commands to acknowledge or re-run.
- `run now`, `--dry-run` and `run resume` report every skip, so `run now` on a ritual that is off or pinned elsewhere no longer prints "nothing due".

### Upgrade note

- Update every host before you pin a ritual. A darius older than 0.18.0 cannot read a ritual with `host`, and its run-due fails for that project.

## [0.17.1] - 2026-09-29

### Changed

- `scripts/seaweedfs-install.sh` names this host's S3 identity after the host (`darius-<short name>`, or `DARIUS_LEAD_IDENTITY`), and adds client keys only for the hosts in `DARIUS_CLIENT_HOSTS`. It has no built-in host names any more. An existing identity is kept as before.
- `scripts/acceptance.sh` step 9 prints the steps to add another host (`DARIUS_SECOND_HOST`) with `darius update --hosts`, not with a clone and `setup`.

## [0.17.0] - 2026-09-29

### Added

- `scripts/install.sh` installs darius as an app in `~/.local/opt/darius`: one shallow clone per release tag in `versions/`, and a `current` link. It moves an old clone at that path to `darius.legacy-<time>` and deletes nothing.
- `darius update [vX.Y.Z] [--check] [--major]` moves this host to a release. It checks the new version, flips `current`, reruns `setup --systemd` and restarts the web page. If a check fails, it rolls back once. It records `update.json` and keeps two old versions.
- `darius update --hosts h1,h2` pushes this host's version to other hosts over your SSH. A host with the app runs its own update, and a host without it gets `install.sh`. A host that runs darius from the Nix store is refused.
- `[setup] units` in config.toml picks the units `setup --systemd` installs. setup turns off and removes the unit files it wrote for units you do not list.
- `darius ritual set <slug> --due YYYY-MM-DD` re-arms a ritual without a cadence, or pushes a cadenced one out.

### Changed

- On an app install, `setup` links `~/.local/bin/darius` to `<app>/current/bin/darius`. It replaces a link to any darius `bin/darius`, and leaves a link to anything else alone.
- `bin/darius` finds its real root, so a running process keeps its version dir when `current` flips.

### Fixed

- The status page reports a UTC offset of 0, not -0, on a host in UTC. The test failed in the Nix build sandbox.

## [0.16.1] - 2026-09-29

### Fixed

- `darius import` no longer imports a pruned run twice. When the tracker moves a run file into `_ledger.md`, the row is the same run, so it is skipped when its run file is in the source or was imported before.

## [0.16.0] - 2026-09-29

### Added
- `darius run resume <run>` goes on with a held run after the operator answered it, with the same run id and a `run.resumed` line. When this host still has the harness session, it runs `claude -p --resume <session>` with every flag again and the answers as the message; otherwise a new session gets the questions and the answers. It refuses a run that is not held, or held with no answer since the hold. The report goes to the webhook, as for `run now`.
- run-due notes each run's harness session id in `runs/<run>/session.json`, for a later resume on this host.
- `darius tui`, the Due and Run screens. Bare `darius` opens them when stdin and stdout are a terminal; in a pipe it still prints help.
- The Due screen: one numbered list over every project, held runs first, then due rituals, vigils that are due, armed or flagged, and runs that failed today.
- The Run screen: the run's facts, its findings (wrapped, scrollable) and its numbered questions with their answers. A digit answers a question of a held run, and `r` resumes it in the background, with the log in `runs/<run>/resume.log`.
- The TUI removes every control character from store text before it prints it, reads the store again on each key and every 5 s, handles resize, honours `NO_COLOR`, and restores the terminal on q, Ctrl-C, SIGTERM, SIGHUP and errors.
- The web run page shows a `run.resumed` event as "in the same session" or "in a new session".

### Changed
- `darius run answer` refuses a question number past the run's last question. Questions number on across holds.
- A profile's `args` may not carry `--resume`, `-r`, `--continue`, `-c`, `--session-id` or `--fork-session`: darius sets the session itself.

### Fixed
- A hold in a resumed run is recorded again. The gate and the herdr surface recorded only the first hold of a run.

## [0.15.0] - 2026-09-29

### Changed
- The home page is the "command board" the operator chose from three mockups (a Fable design brief, Opus mockups, Sonnet QA). One verdict in the state colour answers "does anything need me", the wide column holds only what needs you (held questions with their answer commands, a failed djinn with its report, a stuck run, a flagged vigil), and a right rail shows the Watch gauges (timer, running, held, flagged, sync) and the djinns. Each run appears once; manual rituals and the recent-runs list are gone from home, and `darius-selftest` is one footer line whose deliberate flagged vigil does not count.
- Every page uses the same frame: a 12-column grid up to 1600 px, the detail pages in an 8+4 layout with run details, rules and filters on the right, and report text at a reading width. On a phone the project links fold into a Projects menu.
- A run counts as stuck after 2 h (was 1 h).
- The status gains `utcOffset`, so clock times on the page are in the host's zone.

## [0.14.0] - 2026-09-29

### Changed
- The home-manager module no longer runs the web page unless asked: `services.darius.web.enable` defaults to `false`. With `bind = "auto"` the page listens on the tailnet, so a host now opts in to that listener, and a sync-only host needs no page. Set `services.darius.web.enable = true` on the host you look at. `darius setup --systemd` on a checkout still installs the page.

## [0.13.0] - 2026-09-29

### Changed
- The web app has a new layout, built for the questions the page must answer: does anything need me, did my djinns run and what did they find, is anything broken.
  - **Frame:** a slim top bar replaces the sidebar. Home and Runs always stay in view, and the project links scroll.
  - **Home:** one status line on top, "Needs you" only while a run is held, and a card per djinn with the headline of its latest report. Attention lists flagged vigils and runs that may be stuck. Manual rituals get one quiet line.
  - **Run page:** the report is the page. The run id and the event timeline fold away.
  - **Ritual page:** one sentence says how darius runs the ritual, then the latest report and the history. The rules fold away.
  - **Project page:** djinns, scheduled checks, vigils with anchors, recent runs. Manual rituals and closed vigils fold away.
- A run that has run for more than an hour shows as "may be stuck".
- The Home badge counts open questions, not held runs.
- On a phone: wide tables show a scroll shadow, titles wrap to two lines, and the Copy button is 44 px tall.

## [0.12.0] - 2026-09-29

### Added
- A tool check before each run: a ritual whose `may` rules name a program that the runner's PATH lacks is skipped as `tool-missing` (a failing skip), before any spend.
- The daily digest: the first unattended batch of each local day posts every notable entry, or one "all quiet" line, so a dead timer shows as a missing digest.

### Changed
- Later batches of the same day post only news (started runs and failures), not the same held run or `failed-today` skip every hour.
- `darius run now` posts its report to the webhook too (before: stdout only).

### Fixed
- `setup --systemd` puts the dir of `pnpm` on the unit PATH. The first timer run of a djinn failed because `pnpm cli` was not found.

## [0.11.0] - 2026-09-28

### Added
- The web app: a React Router app in framework mode in `web/`, with a Diablo II Act 2 theme. It has a sidebar to move between the overview, all runs, each project, each ritual (policy, instructions, runs) and each run (event timeline, findings), plus the profiles. Held runs show a copy button for the answer command.
- `darius serve` hands every page request to the app's committed server build with a `WebContext` (`src/web/api.ts`), and serves the app's static files itself. Each page gets a fresh CSP nonce, with no `unsafe-inline`.
- When a `git pull` puts another version or web build on disk, the running `darius serve` answers 503 once and exits 75, so systemd restarts it with the new code.
- `bun run web:dev` and `bun run web:build`. A test fails when the committed `web/build/` is older than its source.

### Changed
- Findings and ritual instructions are parsed into blocks (`src/web/markdown.ts`), and the app renders them as text nodes. The server-rendered HTML page is gone.
- The old run URL `/runs/<project>/<run>` redirects to `/p/<project>/runs/<run>`.
- The Nix package ships `web/build/`; the VM test renders the app.

## [0.10.0] - 2026-09-28

### Added
- The web page is reachable on the tailnet, and the tailnet is its login. For each caller darius asks `tailscale whois` who it is: only devices of an allowed login pass (`DARIUS_WEB_ALLOW`, default the owner of this host). Tagged devices and other users get 403; a failed lookup refuses. Callers on the host itself always pass. The page names who is looking.
- `--bind auto`, the new default: loopback plus this host's tailnet address, retried every 30 s until Tailscale has one. `--bind` also takes a comma list.
- The home-manager module has `services.darius.web.allow`; `services.darius.web.bind` defaults to `auto`.

### Changed
- `darius-web.service` now also listens on the tailnet address (before: 127.0.0.1 only). Set `DARIUS_WEB_BIND=127.0.0.1` in `~/.config/darius/web.env` to keep it on loopback.
- The test suite points `DARIUS_TAILSCALE` at a missing file, so no test reaches the real tailnet.

## [0.9.1] - 2026-09-28

### Fixed
- A numbered list in run findings that is broken up by sub-bullets goes on with its own numbers instead of starting at 1 again.

## [0.9.0] - 2026-09-28

### Added
- `darius serve`: this host's read-only status web page (`node:http`, no dependency). It shows the djinns (rituals that invoke a repo skill) with their last run, held runs with the exact answer command, per project the rituals, the last 20 runs with their findings, and the open vigils; `/api/status.json` has the same data. It binds 127.0.0.1:4747 by default (`--bind`, `--port`, `DARIUS_WEB_BIND`, `DARIUS_WEB_PORT`) and refuses 0.0.0.0 and `::`.
- Run findings render as markdown (headings, tables, lists, code). The text is escaped first; no raw HTML and no links reach the page.
- `setup --systemd` installs and starts `darius-web.service`, which reads `~/.config/darius/web.env`, and restarts it when its unit changed. The home-manager module has `services.darius.web` (enable, bind, port). After a code update in a checkout, restart it with `systemctl --user restart darius-web`.

## [0.8.1] - 2026-09-28

### Fixed
- The full gate splits a shell line the way the shell reads quotes: an operator inside quotes is an argument. The first djinn run had its `curl -w "... -> %{redirect_url}"` probes refused. Command substitution, redirection, a lone `&` and subshells are still refused.

## [0.8.0] - 2026-09-28

### Added
- Djinns (docs/concept.md, "Djinns"): a ritual can name a skill of its project's repo (`ritual add|set --skill NAME`). The prompt tells the harness to invoke it in the linked checkout; a skill that writes a file hands the content in as the findings.
- `darius run now <ritual> [--profile NAME]`: start one ritual unattended now, due or not, on run-due's path. A held or open run still blocks it, mode `off` refuses it, `max_mode` still caps it. The report goes to stdout.

### Changed
- A ritual that names a skill runs with the full gate and the hook on every tool, because a skill can grant tools of its own.
- In the full gate, a plain command chain (`a && b | c`) passes when a `may` rule matches every part. Lines with quotes, `$`, backticks, redirection or a lone `&` must still match one rule whole.

## [0.7.1] - 2026-09-28

### Fixed
- The gate now tells deny from hold. A call outside the policy (a command outside `may`, a file write, a subagent) is refused and the model goes on within the policy; only a `hold` pattern, a report-mode write verb, or a call after a hold holds the run. Before, with permissions skipped, the first stray command held the whole run and failed the batch.
- A herdr tab no longer gets the timer's narrowed PATH; its login shell sets its own.

## [0.7.0] - 2026-09-28

### Added
- The herdr surface: a profile with `surface = "herdr"` runs the ritual's harness in a new tab of the herdr workspace `darius-runs`, so you can watch the run and type into it. The run ends through the same protocol as a headless one.
- A harness that stops at a startup dialog (Claude Code's folder trust question) waits until someone answers it in the tab, then gets its first message. An agent that waits for input past the grace time (10 minutes) holds the run with a question naming the tab. A run past its timeout fails and its tab is closed.
- A finished run's tab stays open; the next run-due batch closes it.
- `DARIUS_HERDR` (the herdr executable) and `DARIUS_HERDR_SESSION` (a named herdr session).

### Changed
- Without a running herdr server, a herdr profile runs headless with the warning `surface-fallback: no herdr server is running` (before: always headless, as the surface was not built).
- The test suite points `DARIUS_HERDR` at a missing file, so no test can reach a live herdr.

## [0.6.0] - 2026-09-28

### Added
- Harness profiles: named presets for how a ritual's harness starts (harness, model, effort, permissions, surface, max_turns, args). `darius profile add|set|list|show` keeps them store-wide in the reserved `_global` project; a ritual picks one with `ritual add|set --profile NAME`, and a profile called `default` applies to every ritual that names none.
- `.darius.toml` `v = 2`: `[profiles.<name>]` tables override store profiles field by field, and `[defaults] ritual = "<name>"` picks the repo's default. A v1 file reads as before; an older darius refuses a v2 file, so it skips the project instead of running it with the wrong profile.
- `permissions = "skip"` for Claude Code: `--dangerously-skip-permissions`, the hook on every tool, `--disallowedTools Agent`, and the gate in `full` scope, which enforces `may` itself.
- `effort` for Claude Code (`--effort`). `args` pass extra flags; the flags darius sets or that could bypass the gate are refused.
- run-due reports each run's `profile`, `harness` and `surface`, and skips a ritual whose profile is missing or invalid as `profile-invalid` (fails the batch). A profile asking for the herdr surface runs headless with a `surface-fallback` warning until that surface ships.
- The TOML reader takes one-line string arrays and `[section.name]` headers.

### Changed
- `sync --all-projects` and run-due also sync `_global`, and create it when missing.
- run-due's dry-run text names the harness, profile and surface a ritual would start with.

## [0.5.0] - 2026-09-28

### Added
- A harness contract: run-due talks to Claude Code through an adapter (`src/harness/`) and starts it through a surface (`src/surface/`). Nothing changes for existing rituals: the claude argv and `settings.json` are the same as in 0.4.0.
- A gate preflight: before each run, run-due runs the exact hook command once with a synthetic call. A gate that does not deny it, or a policy the gate cannot read (a hold regex that does not compile), skips the ritual as `gate-broken`, before any run exists, and fails the batch. Claude Code lets a tool call through when its hook cannot start.
- `policy-check --harness <id>` (default `claude`) and `--preflight`. An unknown harness is denied.
- `policy.json` takes `gate = "full"`: the gate then enforces the whole policy for every tool call (`may` for shell and other tools, no file writes, no subagents, web only in `act` and only when named). No run uses it yet; it is for harnesses without an allowlist and for skipped permissions. In a gate shell rule, `*` never matches `;`, `&`, `|`, a newline, a backtick, `$(`, `<` or `>`.

## [0.4.0] - 2026-09-28

### Added
- `darius link`: run inside a checkout to record which dir holds its project on this host, in `~/.config/darius/links.toml`. `--list` shows every link. Moving a project to a second checkout that still exists needs `--force`.
- `.darius.toml` takes `v = 1` and an optional `max_mode = "off" | "report" | "act"`. `ritual add|set --mode` refuses a mode above it, and run-due skips such a ritual as `policy-capped` and reports it.
- `vigil sweep --daily`: each project is swept at most once per local day across every host that shares the bucket, through a lease per project and day. The sweep timer runs it, so every host may run every timer.

### Changed
- Vigil Commands run in the project's checkout on this host (the linked one, else the import's repo when it exists here), not in the store dir. A host without the checkout skips the project (`no-workdir`).
- run-due uses the same working dir for every ritual of a project. The `/home` and `/var/home` path mapping from 0.3.1 is gone: run `darius link` on a host whose checkout sits at another path.
- `.darius.toml` is parsed strictly: an unknown key, a section or a newer `v` is an error that names the file and line.
- `import` takes the project from the source repo's `.darius.toml` and refuses a different one.
- TOML keys may contain `-` or be quoted.

## [0.3.1] - 2026-09-28

### Fixed
- `setup --systemd` no longer copies the whole login PATH into the units: only the dirs that hold bash, bun, node or claude, then the usual profile and system dirs. On one host the login PATH had put a uutils coreutils dir ahead of `/usr/bin`.
- Vigil checks get the unit's PATH dirs back after the login profile, at the end. On NixOS `/etc/profile` replaces PATH, so a check could not call `darius` from a plain checkout.
- `run-due` finds a ritual's working dir before it starts a run. A dir recorded under `/var/home/<user>` is found under `/home/<user>` and the other way round. A host without the dir skips the ritual (`no-workdir`) instead of leaving an open run that blocked it on every host.

## [0.3.0] - 2026-09-28

### Added
- `flake.nix`: the darius package (Bun, or Node as `darius-node`), a dev shell, an overlay, and the home-manager module `services.darius` that declares the sync, vigil-sweep and run-due timers.
- `nix flake check`: the unit suite in the build sandbox, and a NixOS VM test that runs every unit for a home-manager install and for a checkout installed with `setup --systemd`.

### Changed
- `setup --systemd` renders the unit templates: the unit PATH comes from the login PATH plus the NixOS profile dirs, never a Nix store path; ExecStart names darius by full path.
- `setup` run from the Nix store writes no `~/.local/bin` link, and leaves unit files that home-manager manages alone.
- The credentials file may be any owner-only mode, so 0400 from sops-nix works. Group or other access is still refused.
- `scripts/run.sh` also finds Bun and Node in the NixOS profile dirs.

### Fixed
- The timers failed on NixOS: the unit PATH was a fixed Fedora PATH with no bash, node or claude (`env: 'bash': No such file or directory`, exit 127).

## [0.2.0] - 2026-09-28

### Added
- Store and ledger: item files, per-host append-only JSONL chunks, content-addressed blobs, project lock.
- Rituals, runs and due: `ritual`, `run`, `due`; due computed from the ledger, anchored to the schedule; policy flags (`--mode off|report|act`, `--may`, `--hold`, `--model`, `--max-turns`).
- Vigils that run themselves: `vigil add|list|show|close|sweep`, held-only auto-close, `gate_command`, heavy opt-in, nested-sweep guard.
- Sync to an S3-compatible bucket with a hand-rolled SigV4 client, conditional puts and a project lease.
- `import`: read-only mirror of a legacy `.tracker/` (rituals, runs, verification log).
- Unattended runner `run-due` with `claude -p` and the `policy-check` PreToolUse hook; `DARIUS_WHO` names the session in the ledger.
- `setup` (CLI link, config, systemd timers, bucket), `scripts/seaweedfs-install.sh`, `selftest` project, `scripts/acceptance.sh`.

## [0.1.0] - 2026-09-28

### Added
- Repository scaffold: `bin/darius` shim, `scripts/run.sh` (Bun or Node 22.6+), `--version` and `help`.
- Gates: oxlint with vendored anti-slop rules, TypeScript 7 strict, `node:test` suite under both runtimes.
- `docs/concept.md`: the v2 architecture and migration plan.
