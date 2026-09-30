# Darius v2: concept

Status: architect decision record, 2026-09-27. Supersedes the earlier shape draft.

## Summary

Darius v2 is a small Bun/Node TypeScript CLI with no runtime dependencies. Each project has one local store outside its git repo. The store holds two things: **item files** (one markdown file per ritual, vigil, milestone, spec; frontmatter for facts, body for prose) and **ledgers** (append-only JSONL lines for everything that happens: runs, answers, evidence, notes, lifecycle changes). Status is never stored. It is computed from the ledger. Sync copies the store to one S3 bucket. Ledger chunks and body blobs are immutable objects created with `IfNoneMatch: "*"`. Item files are pushed under a short project lease. The same lease primitive stops two hosts from running the same ritual. A `run-due` command, called by a systemd timer, hands each due ritual to `claude -p` with a policy and records the run, including held questions the operator answers later in a minimal TUI. Claude Code skills talk to darius through the CLI only. Since 0.40.0 darius is also the one CLI for the legacy tracker verbs (decision 16).

I cut the draft's event log, HLC clocks, SQLite projection, snapshot compaction, ink TUI and compiled binary. The load is a handful of hosts, a few parallel agent sessions and one human. Per-host append-only ledgers plus one lease give the same guarantees with about a tenth of the code.

## Domain model

Store facts, compute status. Every item has: `id` (ULID), `kind`, `slug`, `title`, `created`, `updated`, `tags[]`, `links[]`.

| Kind | Stored (item file) | Stored (ledger lines) | Computed |
|---|---|---|---|
| Milestone | goal, non-goals, `specs` order | `archived` | progress, status |
| Spec | goal, ground truth, requirements, `depends_on`, `agent`, checks[] | claims (session, ttl) | done, blocked, claimed |
| Check | text, `command`, `expected` (today's grammar), `manual(owner, expires)` | | ticked = latest evidence for this check passed |
| Evidence | | `check`, `host`, `exit`, `outcome`, `output_sha`, `at`, `who`, `run?` | |
| Ritual | procedure body, `cadence`, `anchor` (due or completion), `policy` | `lifecycle` (active/paused/retired), runs | next due, overdue days, held run |
| Run | | `started`, `held(questions[])`, `answered(n, text)`, `resumed`, `completed(outcome, findings_sha, result_sha?, result?)`, `acknowledged(note?)` | state, result counts |
| Vigil | checks[], `from` spec, gates (`due` date and/or `until` event text), optional `gate_command`, `heavy` flag | `swept(outcome)`, `closed(verdict, by)` | armed, fired, due, closed |
| Note | | `target` item, `kind` (lesson, ruling, incident), body | |

Lifecycles:

```
Ritual:  active --pause--> paused --resume--> active ;  active|paused --retire--> retired (terminal)
Run:     running --> complete | failed | abandoned
         running --hold(questions)--> held --answer*--> held --resume--> running
Vigil:   armed --gate fires--> fired --sweep: all checks pass--> closed(held, by: sweep)
                                    fired --sweep: a check fails--> fired (flagged for the operator)
         armed|fired --operator close(held|failed)--> closed (terminal)
Check:   no state; "ticked" is a query over Evidence
Spec:    no state; done = all checks ticked; blocked = a depends_on spec is not done
```

Changes against today, from first-hand reads of `cli/lib/tracker-writer.ts` and `cli/lib/dates.ts`:

- `completeRun` rolls `due` from the completion date (`dates.ts:82`). A late run pushes the next one out. v2 defaults `anchor: due` (next due = previous due + cadence, then catch up to today). `anchor: completion` stays as an option.
- There is no retired state anywhere in the current CLI. A ritual nobody completes stays due forever (`cohort-assign`). v2 makes lifecycle a ledger fact and `due` honours it.
- Ticks are not stored. This deletes the `verified-not-executed` doctor class by construction.
- `fact-check-cycle/ritual.md` (143 KB) is one procedure head plus 28 dated findings entries. Import turns each dated entry into a completed Run with its findings blob, and each "Known Systematic Defects" or ruling paragraph into a Note. The item file keeps only the procedure.
- The unattended policy lives in ritual frontmatter:

```yaml
policy:
  mode: report          # off | report | act
  may:                  # Claude Code permission rules, passed to --allowedTools as-is
    - "Bash(app/scripts/db-query.sh *)"
    - "Bash(cd djinn && pnpm cli fc *)"
  hold:                 # regexes over the Bash command line, enforced by policy-check
    - 'git push'
    - 'deploy'
    - 'trellis'
    - 'pnpm cli .* --confirm'
  notes: >              # plain words for the prompt; never parsed
    Read-only against production. Proposed fixes go into the findings.
```

`may` and `hold` are machine patterns. Plain-language intent goes in `notes`, which only the prompt reads.

The three modes:

| Mode | The timer starts it? | What the unattended run may do |
|---|---|---|
| `off` (default) | no | nothing; the ritual runs only when a person starts it |
| `report` | yes | read, and write findings and proposed fixes into the run; every write verb is denied by the hook |
| `act` | yes | also run the commands in `may`, for example patch live content; anything in `hold` still stops the run and asks |

`act` is allowed from day one. It is opt-in per ritual and never a default (operator ruling, 2026-09-28). There is no probation gate. The guard rails are the `hold` list, the scoped credentials of the timer unit, and visibility: `darius doctor` and every batch report list the rituals in `act` mode.

## Storage and sync

### Local layout

```
~/.config/darius/config.toml            endpoint, bucket, host name, webhook, credentials path
~/.config/darius/links.toml             per host: project -> checkout dir, written by `darius link`
~/.local/share/darius/<project>/
  items/{rituals,vigils,milestones,specs}/<slug>.md     definitions, frontmatter + body
  ledger/<host>/<ulid>.jsonl            closed chunks, immutable once pushed
  ledger/<host>/open.jsonl              lines appended locally, becomes a chunk on sync
  blobs/<sha256>                        prior body versions, run findings, held outputs
  sync.json                             remote chunk list seen, item ETags, last sync
  .lock                                 O_EXCL lock for local writes (today's withLock pattern)
<repo>/.darius.toml                     committed: v = 1, project = "acme-web", max_mode (optional)
```

The store is outside the repo. Every worktree and every parallel session on one checkout share one store through the O_EXCL lock. Agents no longer find tracker markdown by walking the repo, which is the point.

### Remote bucket layout

```
s3://<bucket>/<project>/items/<kind>/<slug>.md      PUT under project lease
s3://<bucket>/<project>/ledger/<host>/<ulid>.jsonl  PUT IfNoneMatch:*  (immutable)
s3://<bucket>/<project>/blobs/<sha256>              PUT IfNoneMatch:*  (immutable)
s3://<bucket>/<project>/lease.json                  PUT IfNoneMatch:*, holder, expires (60 s)
s3://<bucket>/<project>/leases/ritual-<slug>.json   PUT IfNoneMatch:*, holder, expires (run budget)
s3://<bucket>/<project>/leases/sweep-<date>.json    PUT IfNoneMatch:*, marked done after the sweep, kept 2 days
s3://<bucket>/<project>/manifest.json               item list with sha and updated, written under lease
```

Only `IfNoneMatch: "*"` is required from the backend. A sibling project's state engine proved it against SeaweedFS 4.37. No bucket versioning, no `IfMatch`, no object lock. Immutability comes from never overwriting: a ledger chunk or blob is written once under a content or ULID key.

### Write path

1. A command takes the local `.lock`, edits one item file or appends one line to `open.jsonl`, releases. Fast, offline.
2. `darius sync` (run at the end of every mutating command in the background, and by the runner): pull first. List `ledger/*/` and `manifest.json`, fetch unseen chunks and changed items. Then push: close `open.jsonl` into a chunk keyed by ULID and PUT it with `IfNoneMatch: "*"`. Take `lease.json`. PUT changed items and `manifest.json`. Delete the lease.
3. A ritual runner takes `leases/ritual-<slug>.json` before starting. Renewal is a plain PUT by the holder. Takeover is allowed only after `expires`: delete, then conditional PUT. Two takers race on the conditional PUT and exactly one wins.
4. The timer's vigil sweep (`--daily`) takes `leases/sweep-<date>.json` per project, with the host's local date. The winner sweeps and then marks the lease `done` with a plain PUT. A done lease is never stale, so every later host that day skips the project. So every host can run the sweep timer, and no project is swept twice a day. A holder that dies leaves a lease that expires after 3 hours.

### Conflict rules

- Ledger lines never conflict. Each host writes its own chunks. Merge is a union ordered by ULID.
- Item files: item-level last writer wins by `updated`. The loser's body is kept as a blob and a `conflict` line is appended to the ledger. The TUI shows it. Bodies are definitions that one human edits rarely, so this is enough.
- Every state change that matters (run complete, vigil close, retire, evidence) is a ledger line, so it can never lose a merge.

### Offline and failure

All reads and writes work with no network. A failed push leaves `open.jsonl` in place and retries next sync. `run-due --unattended` refuses to start a ritual when it cannot take the ritual lease, and says so in the report. A stale host can show a stale due list; the runner syncs before it computes due.

### Git

Tracker state leaves git. `.darius.toml` is the only committed file. It holds identity and limits only: `v` (format version, refused when newer than darius knows), `project`, and an optional `max_mode`. Parsing is strict, so a typo such as `max-mode` is an error, not a silent no-op. No host name, path, key, webhook, schedule or status goes in it: those are per host or they are facts. Definitions (rituals, vigils and their Commands) stay in the bucket too; a second copy in git would give two writers with no merge rule, and agents add vigils through the CLI.

A checkout's path is per host. `darius link`, run inside a checkout, finds the marker and writes `<project> = "<dir>"` to `~/.config/darius/links.toml`, not to `config.toml`, because home-manager writes `config.toml` read-only. It refuses to move a project to a second checkout that still exists unless `--force`. It also appends one `project.linked{path}` ledger line per host and path, so every host learns that the project lives in a checkout. `import` takes the project from the source repo's marker and refuses a different one.

`darius export <dir>` writes a read-only markdown snapshot for people who want it in a repo or a docs site. Nothing reads that export back.

### Security

**Trust boundary.** The vigil sweep and the runner execute `Command:` lines that any host with a bucket key can write. A bucket key is therefore equivalent to shell access on every host that sweeps. Keys go only to the operator's own machines. The public README states this.

**`max_mode` is a review gate, not a trust boundary.** A bucket key already allows any Command, and anyone who can edit the checkout can edit the marker. What `max_mode` gives is that the step up to `act` goes through a reviewed commit with history, and that an accidental `ritual set --mode act` is refused. run-due never skips silently for it: the batch report lists `policy-capped`.

Private bucket on the tailnet, never public. Per-host access keys in `~/.config/darius/credentials` (mode 0600), one key per host so a lost laptop key can be rotated alone. HTTPS required unless `allow_http = true`, and `allow_http` is honoured only for loopback and tailnet addresses (`100.64.0.0/10`), checked in code. The tailnet is WireGuard, so plain HTTP inside it is not cleartext on the wire; TLS on the endpoint is deferred (decision 2026-09-28, `docs/plan-tonight.md`). SSE-S3 header on every PUT when the endpoint supports it. SeaweedFS returns 500 on SSE headers unless `[s3.sse] key` is configured (seen in a sibling project's test helper); `darius doctor` probes this and reports it. No secrets in items or ledgers, as today.

### Backup

Once state leaves git, the bucket is the only shared copy, on one host. Two layers cover it. First, every host that syncs holds a full local copy of every project it uses, so losing the bucket host loses nothing that any client has pulled. Second, `darius export` runs nightly from the timer into a private backup git repo (`AltanS/darius-state`, one directory per project) and pushes. That gives history and an off-host copy with tools the operator already uses. Phase 4 does not start until the nightly export has run clean for 7 days.

### Compaction

Not in v1. If chunk listing gets slow, a manual `darius compact` merges a host's chunks into one new object and deletes the old ones after a verified read-back. It is the only delete path.

## Claude Code sessions and skills

Agents never edit store files. They call `darius <verb> --json` and pass bodies over `--stdin`, the pattern `vigil add --stdin` and `worklog distill --stdin` already use. The plugin ships a `PreToolUse` hook that denies `Edit` and `Write` under `~/.local/share/darius/`. Two skills edit markdown today, from a first-hand read of `skills/*/SKILL.md`: `enrich` (spec checklist, `depends_on`) and `archive` (archive doc, `rm -rf` milestone dir). They get verbs: `spec check add|edit`, `spec set --depends-on`, `milestone archive`. The other 17 skills and `agents/darius.md` call the CLI only and keep working through `darius`.

The darius subagent keeps its Read Discipline: no `Read` on store files, CLI output only.

Since 0.38.0 a session learns darius from one generated skill file (decision 15). `darius skill` prints it, `darius skill install` puts it in the user's `~/.claude/skills/darius/`, and `darius setup` refreshes it when it carries a darius stamp. `darius skill hook` prints one opt-in SessionStart hook for the operator to paste: `darius due --brief`, one line or nothing, local store only. There are no other hooks before phase 5.

## Repository, packaging and compatibility

**Repository.** New repo `AltanS/darius`, public. It follows the standard of a sibling project: no build step, no compiled binary (`bun build --compile` gives 91 MB for 28 KB of code), source runs under Bun and Node >= 22.6 through `scripts/run.sh`, all runtime differences in `src/runtime.ts`, `erasableSyntaxOnly`, TS 7 strict with `noUncheckedIndexedAccess`, zero runtime dependencies, oxlint 1.78 with the vendored anti-slop rules at `--max-warnings 0`, `node:test` in a throwaway state dir run under both runtimes, SemVer checked by `scripts/check-version.sh` across manifest, `package.json` and CHANGELOG, annotated tag per release. Gates: `bun run lint && bun x tsc --noEmit && bun run test`.

**Zero runtime dependencies, so:**
- S3 client: hand-rolled SigV4 over `fetch` and WebCrypto (`PutObject`, `GetObject`, `DeleteObject`, `ListObjectsV2`, conditional headers). About 200 lines. A sibling project used the AWS SDK; here it would be the only dependency and it is the one we can write.
- Storage: markdown and JSONL files, no SQLite. 2064 files and a 2.7 MB ledger parse in tens of milliseconds. An index cache is a later optimisation, not a design element.
- TUI: dependency-free ANSI on raw stdin, no ink and no React. Three screens, number keys, no mouse.
- Config: TOML subset parser for flat tables, or JSON if that proves brittle.
- Web app (0.11.0): the one exception with packages, and only at build time. `web/` has React and React Router, bundled into the committed `web/build/`; the CLI never loads them, and `darius serve` loads only the bundle (see "Web status page").

**Layout.**

```
darius/
  bin/darius                      shim that execs scripts/run.sh cli
  scripts/run.sh test.sh check-version.sh
  src/cli.ts runtime.ts
  src/core/   model, store, ledger, due, policy, s3, sync, import, kinds
  src/legacy/ the vendored legacy CLI: frozen, run for every verb outside DARIUS_KINDS
  src/tui/    due, run detail, conflicts
  src/runner/ run-due, claude-p launcher, report
  plugin/     .claude-plugin/plugin.json, skills/, agents/darius.md, hooks/
  test/
```

One package, no workspaces. Directories, not packages, separate concerns.

**Install.** `bin/darius setup`: links `darius` into `~/.local/bin`, writes a config skeleton, prints `✓ / · / !` lines, safe to re-run. `--systemd` also writes and starts the user units.

**Install and update (0.17.0, operator ruling 2026-09-29: one install method on every host, pushed from a lead host).** Every host runs darius from `~/.local/opt/darius`: one shallow clone per release tag under `versions/vX.Y.Z/`, and a `current` link to the one in use. `~/.local/bin/darius` points at `current/bin/darius`, and the systemd units call `~/.local/bin/darius`, so an update moves one link and rewrites no unit. `bin/darius` resolves its physical root, so a running process keeps the version dir it started from.

- *First install:* `scripts/install.sh` clones the newest tag (or `--tag`), flips `current` and runs `setup --systemd`. It moves an old full clone at the app root to `darius.legacy-<time>` and deletes nothing. `darius update --hosts <host>` pipes it to a host that has no install yet.
- *Update:* `darius update [vX.Y.Z]` finds the newest tag over git (`--check` only reports), stages and checks it (the `package.json` version, `bin/darius --version`), flips `current`, runs the new version's `setup --systemd`, restarts the web page and checks `/healthz`. When a check or the setup fails, it flips back once and exits 1. It records `update.json`, holds `update.lock`, and keeps the previous version plus one more. A newer major version needs `--major`, because a major release needs the operator to change something. An older version is allowed, as a rollback by hand.
- *Push:* `darius update --hosts host-a,host-b` brings each host to the lead's version over the operator's SSH, one host after the other. A host with the app runs its own `darius update`; a host without it gets `install.sh`; a host that runs darius from the Nix store is refused with the remedy. An unreachable host is reported (exit 3) and does not stop the others.
- *Units per host:* `config.toml` `[setup] units` names the units `setup --systemd` turns on (`sync`, `vigil-sweep`, `run-due`, `web`; all four without the key), so a sync-only host stays sync-only across updates. setup turns off and removes the unit files it wrote for a unit that is not listed, and never touches `darius-seaweedfs.service`.
- *NixOS:* the host's configuration gives darius only what darius cannot make itself: the S3 key from sops, and a read-only `config.toml`. `setup --systemd` renders each unit's PATH from the login PATH plus the NixOS profile dirs, never a Nix store path (since 0.3.0). The Nix package and the home-manager module `services.darius` (0.3.0 to 0.16.x) go in 1.0.0; `flake.nix` keeps the dev shell, for work on darius on a NixOS host.
- *Rejected:* a flake input per NixOS host (a flake bump, a commit and a `sudo nixos-rebuild switch` per host and release); release archives, CI and checksums as collie has them (collie compiles a binary and its repo is public; darius has no build step, commits its web build, and a git tag fetched over SSH already is the release); an update timer on each host (the operator chose to push).

**Plugin.** The Claude Code plugin (skills, darius agent, hooks) moves into `darius/plugin/` so skills and CLI version together in one CHANGELOG. The marketplace manifest of the legacy tracker plugin points its `tracker` entry at the new repo. Whether a marketplace entry can reference a second GitHub repo with a subdirectory is UNVERIFIED; the fallback is a `plugins/tracker` in the marketplace repo that contains only the manifest and a `git subtree` of `darius/plugin/`. Skills call `darius` on PATH, never a plugin-relative path.

**Backward compatibility (0.40.0, decision 16).** There is no `tracker.mts` router. darius is the one CLI. The legacy CLI is vendored into `src/legacy/`, frozen, and `darius` hands it the whole argv for every verb outside `DARIUS_KINDS`, the constant in `src/core/kinds.ts`. The old `tracker` command is gone from the plugin, which ships no CLI. The carve-outs for the vendored tree are its own oxlint and tsconfig settings, its dev dependencies (kept out of the runtime), and `bun run test:legacy`, which is a gate next to `bun run check`. A `--json` field that the old CLI emitted is never renamed or removed; new fields may be added. Exit codes keep the probe contract. The legacy daily sweep keeps working through `darius vigil`, which writes `.tracker/vigils/` through the vendored code until phase 3 moves `vigil` into `DARIUS_KINDS`. A ritual or run verb in a repo that has `.tracker/` but no `.darius.toml` exits 1 with `this repo is not linked: run darius init`. `darius init` links a repo, fresh or legacy.

**One writer module per kind.** Each kind has one writer module. A kind in `DARIUS_KINDS` is written by the store code only. A kind outside it is written by `src/legacy/` only, and only under `.tracker/`. darius native code never writes `.tracker/` files, and the legacy tree never writes the store. One test checks the rule: a run through every native write verb in a fixture leaves `.tracker/` unchanged.

## Migration plan

Each phase ships alone and has a mechanical done check.

**Scope rule (operator ruling 2026-09-29, after a review of 0.11.0).** Until phase 5, work goes into the migration phases below, or it fixes something that real use found. No new surface ships before that: no further harness adapters, no herdr plugin actions, no central server, no new web features, no plain-command rituals. The web app, herdr surface and profiles (0.6.0 to 0.11.0) stay as they are. The order: prove the unattended djinn (five timer runs in a row), run the lead host from a pinned clone instead of the working tree, `run answer`/`run resume` and the TUI Due and Run screens (phase 2), the two-host test (phase 1), then the vigil import. Deferred ideas, spend caps among them, wait in [`docs/backlog.md`](backlog.md).

**Phase 0, bootstrap.** Repo, standards, `setup`, the model, local store, `import` that reads `.tracker/` read-only for rituals, runs, vigils and the verification ledger. Done when `darius import` on a project then `darius due --json` lists the same rituals and vigils as `tracker due --json`, except retired ones, and the imported ledger line count equals `wc -l .verification-log.jsonl` (the count on the day of the check).

**Phase 1, rituals canonical and synced.** Ritual, run, note verbs. The router maps `tracker ritual` and `tracker due`. Vigils stay canonical in `.tracker/vigils/` and on the legacy CLI until phase 3, because the legacy daily sweep reads those files; `darius due` reads them live and read-only. Sync to the bucket. TUI Due and Run screens. Done when: `run start` on one host then `darius due` on another shows the run after one sync; two concurrent `run complete` on one host give one completion and one refusal; a kill during sync leaves no partial chunk on the bucket.

**Phase 1 in practice (operator ask, 2026-09-29).** One project moved its rituals to darius before the router exists: one last `darius import` brought every run up to date, the operator's session rewrote the `tracker ritual complete` steps of the ritual bodies with `darius ritual set --stdin`, and it runs rituals with `darius run start` and `darius run complete`. Its CLAUDE.md says so. tracker 10.10.0 (the legacy tracker plugin, 2026-09-29) closes the double-run gap without the router: with a `.darius.toml` next to `.tracker/`, `tracker ritual add|run|complete` exit 1 and name the darius command, and `tracker due` leaves rituals out. A `status: retired` edit would not have helped: `tracker due` ignores it. After this cut-over, `darius import` must not run on that project again: it would write the old bodies back.

**Phase 1 done checks, 2026-09-29.** With both hosts on the app install (0.17.1): a run started on the lead host showed on the second host after one sync; two concurrent `run complete` on the second host gave one completion and one refusal (exit 1), and the lead saw the close after one sync. The kill during sync is proven against a real SeaweedFS container in `test/sync.test.ts` ("two hosts on one bucket"), not on the operator's bucket. The router shipped the same day as tracker 10.11.0, so phase 1 is done. It departs from the sketch in "Backward compatibility": the routing is one section of `tracker.mts` ("Rituals routed to darius", the kinds in one `DARIUS_KINDS` constant), not a 30-line file in front of a renamed `tracker-legacy.mts`, and it routes only in a repo whose `.darius.toml` sits next to `.tracker/`, so every other repo keeps the legacy CLI byte for byte. `tracker ritual run` starts a darius run, `complete` completes the open running run (and refuses a held one), `add` and `list` map to darius, and `tracker due` merges darius's due rituals with the legacy vigils in today's JSON shape. The 0.4.1 stash (sync around the daily sweep) waits until a second host runs the sweep; today only the lead does.

**Phase 2, scheduled runs.** `run-due`, policy, hook, webhook. One ritual (`stale-draft-sweep`, `mode: report`) on a systemd timer of the lead host. Done when five consecutive timer runs are recorded with reports, one run was held, answered in the TUI and resumed, and one hold-pattern Bash command was denied by the hook in the transcript.

**Phase 3 (0.41.0), vigils canonical and auto-executed.** `vigil` moves into `DARIUS_KINDS`. Import brings the vigils into the store, and the native vigil verbs become reachable. `darius vigil sweep` ports the legacy sweep rules (see "Vigil auto-execution") and runs daily from the lead host's timer. The daily sweep script switches to the store shape of `darius vigil list --json`, which keeps the eight legacy fields. Done when: the same-day `darius vigil sweep --classify-only` and the legacy sweep with `--classify-only` put every vigil in the same bucket (runnable, heavy, manual, event-gated, no command); one real sweep auto-closed a date-due vigil `held` and left a failing one armed and flagged.

**Phase 4, the legacy verbs re-homed when real use asks.** Delivery kinds (milestones, specs, worklogs) stay in `.tracker/` in git, written by the vendored code. A kind moves into `DARIUS_KINDS` only when real use shows a need. `enrich` and `archive` get native verbs then. Where a delivery kind is stored is a 1.0.0 decision (decision 5). Done when `darius doctor` is green on every linked project.

**Phase 5, the plugin holds no CLI.** The plugin (tracker 11.0.0) deletes its `cli/` and the skills that only wrapped it, and its skills and Stop hook call `darius`. The 8 project CLAUDE.md files name `darius`. There is no shim and no deprecation counter. Done when a session in a project with `.tracker/` runs the work-plan and wrap-up skills through darius, and no file under the plugin tree mentions `tracker.mts`. The plugin stays in the marketplace repo until 1.0.0.

## Risks

- SeaweedFS conditional PUT semantics are proven only for `IfNoneMatch: "*"` on the version a sibling project tested. `darius doctor` runs a two-client race test against the real endpoint before phase 1 is called done.
- Hand-rolled SigV4 has sharp edges (path encoding, payload hashing). Mitigation: test against SeaweedFS in a container in `scripts/test.sh`, as a sibling project does.
- Item-level LWW can lose a concurrent body edit. The loser is kept as a blob and surfaced.
- Harness flags and hook behaviour change between versions. Each harness is one adapter file, and `darius harness check` proves its gate per installed version (see "Harnesses, profiles and surfaces").
- A ritual whose procedure needs deploy credentials cannot run in `act` mode from the timer; it holds.
- Two stores stay alive by design: the darius store for operations, `.tracker/` for delivery. Each kind has one writer module (see "One writer module per kind"), so each kind has one writer at any time.
- The vendored legacy tree may not build under TypeScript 7. It has its own tsconfig and gate (`bun run test:legacy`), and may use a second, older TypeScript for that gate only.

## Non-goals

No multi-user permissions. No web editor: the read-only status page of `darius serve` is the only web surface; editing from a web UI waits for the central server, which is not decided. No event sourcing, CRDTs or vector clocks. No SQLite. No compiled binaries. No bucket versioning requirement. No hosted S3 dependency. No compaction in v1. No rewrite of the Work Loop skills beyond the two that edit markdown. No scheduler inside darius: systemd and a future central server own timing.

## Decision table

| # | Question | Decision | Why | Rejected |
|---|---|---|---|---|
| 1 | Event log vs files canonical; how agents write | Item files for definitions, append-only per-host ledgers for everything that happens. Agents write via CLI only, hook denies direct edits | Union-merge ledgers plus one lease give the needed guarantees with a tenth of the code | Event log with HLC and SQLite projection (over-built); markdown-only with ETag sync (status stays stored text) |
| 2 | Big bang vs strangler (amended 0.40.0) | Strangler by kind stays, but behind darius's own verbs, not behind the old path: darius dispatches a verb outside `DARIUS_KINDS` to the vendored legacy CLI | Every phase is testable against `tracker` output; the legacy sweep keeps working | One-shot import and switch (breaks 64 call sites and the daily sweep on one day) |
| 3 | Where the app lives (amended 0.40.0) | New repo `AltanS/darius`, the sibling project's standards. The plugin stays in the marketplace repo until 1.0.0; it ships skills, agent and hooks, and no CLI | CLI and skills version together; installable without the marketplace | Stay in the legacy tracker plugin (plugin-relative paths, no `setup`, Node-only) |
| 4 | Which bucket | Self-hosted SeaweedFS on the operator's workstation (the lead host) over the tailnet (operator ruling, 2026-09-28), reusing the rootless `seaweedfs.service` user unit of a sibling project | Already run and tested there; bodies hold internal notes; only `IfNoneMatch:*` needed; the lead host also runs the timer. Other hosts work offline when it is off and sync when it is back | Hosted S3 (third party holds internal notes); another agent's server (always on, but it is not the operator's box) |
| 5 | Git after the switch (amended 0.40.0) | Operations state (rituals, runs, evidence) leaves git; `.darius.toml` marker committed; opt-in `export`. Delivery state (milestones, specs, worklogs) stays in `.tracker/` in git until a 1.0.0 decision | Git was the collision source and a 33 MB repo tax | Keep `.tracker/` gitignored in the repo (worktrees diverge, shared checkout still collides) |
| 6 | v1 scope | Rituals, runs, vigils, notes, evidence, sync, runner, minimal TUI; milestones and specs in phase 4 | Scheduling is the trigger; the old CLI serves specs meanwhile | Everything at once (delays the timer by months) |
| 7 | Policy enforcement | Three layers: prompt, `PreToolUse` hook running `darius policy-check`, scoped credentials in the timer unit | A prompt alone is a request, not a gate | Prompt only; or a sandbox VM per run (later, not v1) |
| 8 | Vigil execution | darius runs vigil Commands itself on a daily timer, no LLM; auto-closes `held` only; event gates auto-fire only through a `gate_command` | A vigil check is a shell command, so it needs a sweep, not an agent. the legacy rules are measured, so they are ported, not reinvented | An agent per vigil (cost, no gain); auto-closing `failed` (a precondition miss would read as a broken guard) |
| 9 | What the repo holds vs the bucket (2026-09-28) | The repo holds `.darius.toml`: `v`, `project`, optional `max_mode`. The bucket holds definitions and facts. Checkout paths live per host in `links.toml` (`darius link`). Which host sweeps is decided by a daily lease per project, not by config | Identity and limits need review and history; facts and definitions need one writer and sync. A host name in the repo would tie a public repo to a machine and need a commit to change laptops | `runner = "<host>"` in the repo (host names in git, a commit per machine change); definitions or vigil Commands in git (two writers, no merge rule, agents could not add vigils); repo defaults for new rituals (an agent's `ritual add` would start on the timer unseen); links in `config.toml` (read-only under home-manager) |

| 10 | Harness independence (2026-09-28) | A harness adapter and a surface adapter behind one contract. One gate, `darius policy-check`, judges every tool call of every harness; harness allowlists are a second layer. Named profiles, resolved item, then repo `.darius.toml` (v2), then store-wide `_global`, then built in. `max_mode` still caps every profile | The operator wants any harness and a watchable run. Probes show all four harnesses have a pre-tool gate that holds with permissions skipped, and all four pass the env the run protocol needs | Translating the policy into each harness's own permission rules (four rule languages, Codex drops per-run hooks silently, opencode and pi have no pattern rules); a watched run as a separate mode (more code, no gain) |
| 11 | Subagents in unattended runs (2026-09-30) | A ritual opts in by naming `Agent` in `may`. The gate judges every subagent call by the same policy (scope `full`), denies nesting, `isolation` and a subagent's `run complete`. Granted per run only after the gate check of that harness version saw the gate judge a subagent on this host | The fact check's skill needs an independent second verification. The hook fires inside subagents, but a subagent ignores the parent's `--disallowedTools` when permissions are skipped, so the gate must be the judge | Always deny (the first unattended fact check could not verify its CRITICAL); allow in gated mode through the allowlist (no proof that subagents keep the parent's permissions) |
| 12 | Run results (2026-09-30) | Findings end with one fenced `darius-result` JSON block; darius checks it, stores it apart from the markdown, and keeps its counts on the ledger line. Required for every run darius launches; optional but checked for a by-hand run. A complete run with questions waits on the "needs you" lists until `run ack` records the decision | The web app and the TUI can draw a result, and a question for the operator no longer hides in prose | A second heredoc or a result file (refused by the gate, `Write` denied); JSON with the markdown inside (hard for a model); a schema per ritual (one generic shape first); an `answer` verb for complete runs (no session to resume) |
| 13 | Ritual handoff (2026-09-30) | A run's result may carry `handoff`, one line of at most 200 characters, refused when longer. darius keeps it on the ledger line and puts it, with the operator's `run ack` note and the questions it answers, at the top of the next run's prompt. The source is the latest run with a result | Carry-over by instruction ("read yesterday's run first") depends on the model doing it, and the operator's decisions on a complete run reached no run at all | A free-length note or a file per ritual (grows into a second findings); clipping (a cut note can lose its meaning); the model reading `run show` itself (not certain); a note the operator writes by hand (the ack note covers it) |
| 14 | Alerts (2026-09-30, Web Push since 0.31.0) | Phone notifications for held runs, questions, failures, failed gate checks and failing skips, by Web Push to the installed web app, encrypted per device with WebCrypto. The host that wrote the line or ran the batch sends; `alert.sent` and `alert.failed` in the ledger keep a key from going out twice and retry three times. VAPID keys per host in `push.json` (0600); devices as `push.*` lines in `_global` | The operator wants to hear only what needs them, on their phone, from both hosts, without duplicates, and a tap should open the run | Telegram (0.29.0: a third party stores the text, answers need a bot); a lease per alert (the origin host already makes each alert unique); the webhook digest (noisy, not a phone channel); the `web-push` package (a runtime dependency for two RFCs WebCrypto covers) |
| 15 | How sessions learn darius (2026-09-30, 0.38.0; amended 0.40.0) | Where the marketplace is installed, the plugin is the teacher and commits the generated file; `darius skill install` is for a machine without it. One generated skill file, `darius skill`: static rules plus a verb table from the registry (only commands marked `audience: "session"`; the legacy verbs as one line per group), under 6 KB, stamped with version and hash. User-level install (`darius skill install`, `~/.claude/skills/darius/`); `setup` refreshes only a stamped file. One opt-in SessionStart hook, `darius due --brief`, which the operator pastes from `darius skill hook`. No other hooks before phase 5 | A session must know which kinds darius owns today and must never edit store files; one short file keeps that true for every project on the host, and a generated table cannot drift from the CLI | A hand-written skill per project (drifts); a settings.json writer (edits the operator's config); more hooks now (the router still serves the other kinds) |

Decision 9 is amended by 10: the repo may also hold harness profiles and defaults. They choose how an agent runs, never whether it may run or how far, so the reason 9 rejected repo defaults (a ritual starting on the timer unseen) does not apply.

Operator rulings, 2026-09-28: SeaweedFS on the lead host. Public name `darius`. `act` mode allowed from day one, opt-in per ritual. Vigils are auto-executable.
| 16 | One CLI (2026-09-30, 0.40.0) | darius is the only CLI. The legacy CLI is vendored frozen into `src/legacy/` and reached through darius for every verb outside `DARIUS_KINDS`. `darius init` links a repo. One writer module per kind. No `tracker` shim on PATH, so no deprecation counter | Two CLIs with a router in front meant two installs, two version lines and a hardcoded marketplace path in callers. One binary makes the skill, the hooks and the daily sweep call one name | A kernel `onboard` command that re-implemented legacy verbs (a rewrite of measured code); porting the vendored tests to `node:test` (only if the tree stops being frozen); a `tracker` shim on PATH (there never was one; the CLAUDE.md sweep is enough) |
