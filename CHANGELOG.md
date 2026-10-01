# Changelog

All notable changes to darius. SemVer; see CLAUDE.md, "Versioning".

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
