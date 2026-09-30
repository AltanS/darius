# Darius v2: concept

Status: architect decision record, 2026-09-27. Supersedes the earlier shape draft.

## Summary

Darius v2 is a small Bun/Node TypeScript CLI with no runtime dependencies. Each project has one local store outside its git repo. The store holds two things: **item files** (one markdown file per ritual, vigil, milestone, spec; frontmatter for facts, body for prose) and **ledgers** (append-only JSONL lines for everything that happens: runs, answers, evidence, notes, lifecycle changes). Status is never stored. It is computed from the ledger. Sync copies the store to one S3 bucket. Ledger chunks and body blobs are immutable objects created with `IfNoneMatch: "*"`. Item files are pushed under a short project lease. The same lease primitive stops two hosts from running the same ritual. A `run-due` command, called by a systemd timer, hands each due ritual to `claude -p` with a policy and records the run, including held questions the operator answers later in a minimal TUI. Claude Code skills talk to darius through the CLI only. The old `tracker.mts` path becomes a shim.

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

Agents never edit store files. They call `darius <verb> --json` and pass bodies over `--stdin`, the pattern `vigil add --stdin` and `worklog distill --stdin` already use. The plugin ships a `PreToolUse` hook that denies `Edit` and `Write` under `~/.local/share/darius/`. Two skills edit markdown today, from a first-hand read of `skills/*/SKILL.md`: `enrich` (spec checklist, `depends_on`) and `archive` (archive doc, `rm -rf` milestone dir). They get verbs: `spec check add|edit`, `spec set --depends-on`, `milestone archive`. The other 17 skills and `agents/darius.md` call the CLI only and keep working through the shim.

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
  bin/darius, bin/tracker         shims that exec scripts/run.sh cli (tracker prints a deprecation line)
  scripts/run.sh test.sh check-version.sh
  src/cli.ts runtime.ts
  src/core/   model, store, ledger, due, policy, s3, sync, import
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

**Backward compatibility.** The legacy CLI entry point, `tracker.mts`, becomes a 30-line router. For a verb whose kind has migrated, it maps the old verb to the new one (`ritual run` to `run start`, unchanged where possible), execs `darius`, and prints one deprecation line to stderr. For every other verb (specs, milestones, worklog, verify, mark, doctor until phase 4) it execs the old implementation, kept unchanged as `tracker-legacy.mts`. The set of migrated kinds is one constant in the router, extended per phase. The 64 plugin call sites, the Stop hook `lib/loop-gate.sh` and the 8 project CLAUDE.md files keep working without edits. `--json` output for `due`, `status`, `list`, `show`, `vigil list`, `ritual list` keeps today's field names; new fields are added, none removed, until the shim is retired. The legacy vigil sweep script hardcodes the marketplace path and parses `.tracker/vigils/*.md` itself. It keeps working through migration phases 0 to 2 because vigils stay in `.tracker/` until phase 3, when it switches to `darius vigil list --json` and `darius evidence record`.

## App design

**CLI.** Every command has `--json` and exits 0 ok, 1 refused or failed, 2 usage, 3 inconclusive environment, the probe contract the operator already uses.

```
darius                                  TUI
darius due [--project P] [--all]        rituals due, vigils due or armed, held runs, conflicts
darius status | list | show <ref>
darius ritual add|list|show|set|pause|resume|retire <slug>
darius run start <ritual> [--unattended] | hold <run> --question ... | answer <run> <n> <text>
darius run now <ritual> [--profile NAME]   start one ritual unattended now, due or not
darius run resume <run> | complete <run> --outcome ... --findings-stdin | list
darius run ack <run> [--note TEXT]      mark a failed or abandoned run as seen; display only
darius vigil add|list|set-body|close <slug> --verdict held|failed
darius evidence record <check-ref> --exit N --outcome ... [--output-stdin]
darius check run <ref>                  executes Command, records evidence
darius note add --to <ref> --kind lesson|ruling|incident --stdin
darius milestone|spec ...               phase 4
darius sync [--pull-only] | doctor | import <path/.tracker> | export <dir> | setup | compact
darius link [<dir>] [--force] | --list   record this host's checkout of the project named in .darius.toml
darius run-due --unattended [--dry-run] [--only <slug>]
darius policy-check [--harness ID] [--preflight]   the gate; used by the harness's pre-tool hook
darius serve [--bind auto|ADDR,...] [--port N]  this host's read-only status page, loopback and tailnet, port 4747
```

**TUI (0.16.0).** `darius tui`, and bare `darius` when stdin and stdout are a terminal; in a pipe, bare `darius` still prints help. Dependency-free ANSI, number keys, no mouse. Milestone progress is a table in `darius status`, not a screen.

- `Due`: one numbered list over every project. Held runs come first, because they are the only rows that wait for the operator (the first draft listed them after rituals and vigils). Then due rituals, vigils that are due, armed or flagged, and runs that failed today. An acknowledged failure is a Due row again, dimmed "failed today, acknowledged". A number or Enter opens a row.
- `Run`: the run's facts, its findings, then its questions, numbered, with their answers. A digit opens an answer prompt, which writes `run.answered` through the same function as `darius run answer`. `r` starts `darius run resume` detached, with its output in `runs/<run>/resume.log`, so the TUI stays free while the run goes on. On a failed or abandoned ritual run, a line under the phase says what comes next, and two keys act (0.18.0): `a` acknowledges the run through the same function as `darius run ack`, and `n` starts `darius run now` detached, once per run per session, with its output in `runs/<failed run>/rerun.log`. Both keys do nothing on any other run. On a complete run whose result asks questions (0.22.0), the screen starts with the result, and `a` opens a decision prompt whose text becomes the acknowledgement's note; the Due screen lists such runs under "Asks you".
- The screens read the store again on each key and every 5 s. Findings, questions and titles are untrusted text: every control character is removed before it is printed, so a finding cannot move the cursor or set the window title.
- Not built: the `Sync` screen (last push and pull per host, chunk counts), and conflicts in the Due list. A `conflict` line has no resolved state yet, so that list would only grow; `darius sync` reports conflicts.

**Unattended runner.** `darius run-due --unattended` is what the systemd timer calls (and a central server later).

1. `sync`, compute due, skip rituals with `policy.mode: off`, rituals pinned to another host (see "Host pin" below) and rituals whose latest run is `held`. Find the project's working dir on this host: its linked checkout, else the import's repo when it exists here, else the store dir for a project with no repo. A project that another host linked or imported, and that has no checkout here, is skipped as `no-workdir`. A mode above the checkout's `max_mode` is skipped as `policy-capped`. Both are decided before a run starts, so neither leaves an open run that would block the ritual on every host.
2. For each due ritual: take `leases/ritual-<slug>.json`, append `started`. claude runs in the working dir.
3. Write a per-run settings file and launch:

```
claude -p --output-format json --max-turns N --model <from policy> \
  --dangerously-skip-permissions --disallowedTools Write,Edit,NotebookEdit,Agent \
  --settings <run>/settings.json   # PreToolUse hook on every tool: darius policy-check
  --append-system-prompt-file <run>/policy.md  # procedure, may/hold, the hold protocol
```

That is the default since 0.20.0 (see "Profiles": the darius gate alone decides). A gated profile passes `--permission-mode dontAsk --permission-prompts none --allowedTools <policy.may + read-only defaults>` instead, and its hook sees shell calls only.

The prompt says: do the procedure, write findings with `darius run complete`, and for any action in `hold[]` call `darius run hold <run> --question "..."` and stop. The `PreToolUse` hook runs `darius policy-check`, which reads the run's `hold[]` patterns and returns deny for a matching Bash command, recording the question itself. So a held action is enforced twice: once by the prompt, once by the hook. `report` mode additionally disallows `Bash` write verbs via a stricter pattern set. Credentials are the third layer: the timer's unit runs with an environment that has no deploy SSH key and no `--confirm`-tier tokens (a dedicated system user on a server; `Environment=` scrubbing on the operator's host). A held run does not roll `due`.

4. Append `completed` or `failed` with the `claude -p` JSON result hash as a blob. Release the lease. Sync.
5. Post one report per batch to the configured webhook (Campfire room or Telegram, plain `fetch`): runs completed, failed, held with question count and the command to answer.

**Report rules (0.12.0).** The first unattended batch of each local day posts a *digest*: every notable entry, held runs and `failed-today` included, or one "all quiet" line. A missing digest therefore means a dead timer. Every later batch that day posts only *news*: started runs and failing skips. So an hourly timer does not repeat one held run 23 times. `run now` posts its report too: a person started it, but maybe in a tab or over ssh. A report a person asked for (`run now`, `run resume`, `--dry-run`) names every skip, mode `off` included (0.18.0): before, `run now` on a ritual with mode `off` said only "nothing due". The host notes the date of its last digest in `<state>/run-due-digest.json`; a failed post is tried again by the next batch.

**Run results (0.22.0, operator request 2026-09-30).** A run's findings stay markdown for people, and end with one fenced block whose info string is `darius-result`, holding JSON (`src/core/result.ts`): `v` 1, `status` (ok, attention, failed), a plain `summary`, and optional `metrics` (label, value, unit, tone), `items` (title, severity critical to info, state open, fixed, needs-decision or not-verified, `group` such as the market, `target`, `detail`), `questions` (text, recommendation) and `actions` (text, state, target). The operator asked for structured output the web app and the TUI can draw; the real pain was a fact check that put its questions for the operator at the top of its prose, where nothing surfaced them.

- *Why a fenced block.* One heredoc carries both: the gate allows the protocol heredoc and refuses every other `<<`, the `Write` tool is denied, and JSON with escaped markdown inside is hard for a model to write. The block stays readable anywhere.
- *Checked, not trusted.* `darius run complete` cuts the block out, checks every field, and lists every problem at once. Texts are plain: control characters go, long texts are clipped, and the app renders them as text, never as markdown, HTML or a link. Unknown keys are ignored; a wrong type, an unknown enum value, a missing field or too many entries is an error. `status` only goes up: a question, an open high or critical item, or an item not verified makes it `attention`.
- *Required for launched runs.* Every run darius starts writes `result: "required"` into its `policy.json`, and the prompt shows the format with one example. `run complete --outcome complete` then refuses findings without a valid block (exit 1), keeps what was sent in `<run>/findings-rejected.md`, and leaves the run open for the model to fix and send again. If the model then runs out of turns, the failure blob carries those findings, so they are not lost. `--outcome failed` and `abandoned` are recorded whatever the block says. A by-hand run (`run start`, and `tracker ritual complete` through the router) may hand in a block; if it does, the block must be valid.
- *Storage.* The findings blob holds the markdown without the block; the checked JSON is a blob of its own (`result_sha`), and the ledger line carries the counts (`result: {status, questions, open per severity, fixed}`), so a list needs no blob read. Older hosts ignore the new keys.
- *Questions reach the operator.* A complete run whose result has questions and no `run.acknowledged` line is on the "needs you" lists of the web app and the TUI, and in the batch report ("complete, asks N questions"). The operator decides and records it with `darius run ack <run> --note "<decision>"`: there is no session to resume after a complete run. Since 0.26.0 the decision goes to the next run of the ritual, with the handoff.
- *Reading a run (0.24.0).* `darius run show <run> [--json]` prints a run's facts, its result and its findings, and `run list --json` carries each run's counts (`result`). A later run reads earlier ones this way, for example to re-check yesterday's open items first.
- *Handoff (0.26.0, operator request 2026-09-30).* A run leaves the next run of the same ritual a note in its block: `handoff`, one line of at most 200 characters (what to check again, what waits for someone, what not to repeat). It is the one text darius does not clip, since a cut note can lose its meaning: a longer one is refused. `run complete` copies it onto the `run.completed` line. darius delivers it, so no model has to look for it: the next launched run gets a "Handoff from the previous run" section at the top of its prompt, and `darius run start` prints it for a run by hand. With it go the questions of that run and the operator's note from `run ack --note`, or "not answered yet: do not act on them". The source is the latest run of the ritual that handed in a result: a crashed run hands in none, so the last good note stays; a result without a note clears it. `ritual show`, the ritual page and the run views show it (`src/core/handoff.ts`). Rituals only: a vigil has no next run.
- *Not yet.* Vigils keep their structured sweep evidence and get no block until phase 3; no stable item ids across runs (a model cannot keep them stable).

**Alerts (0.29.0, by Web Push since 0.31.0; operator requests 2026-09-30).** The goal: unattended rituals work without the operator, and only what nobody else may decide reaches them, on their phone. The webhook report stays as it is (digest and news); alerts are separate and short. 0.29.0 sent them by Telegram; the operator then chose native notifications of the installed web app instead (no third party that stores the text, and a tap opens the run), so 0.31.0 replaced Telegram with Web Push (`src/core/push.ts`, `src/core/alerts.ts`, `darius push`).

- *What.* A held run (its questions), a complete run whose result asks questions (key `asks:<run>`, so a decider can send the same questions once when it escalates them), a failed or abandoned run, a gate check that did not pass (`_global`), and a failing skip of a batch (`skip:<host>:<ritual>:<day>:<reason>`, once a day per host). The payload is `{title, body, url, tag}`: plain text, clipped, `url` a path of the web app, `tag` the key, so a newer notice replaces an older one on the phone. An alert never carries a stderr tail, an exception text or a failure blob: those can hold environment text. For gate-broken and error it names the dry run that shows the detail.
- *The origin host sends.* Every alert comes from a ledger line or a batch report, and each has one host. Only that host sends, so two hosts never send the same alert, with no lease and no wait for a sync; "both hosts, no duplicates" is the operator's choice. `alert.sent{key, devices}` in the project ledger keeps a key from going out twice; when no device took a notice, `alert.failed{key, error, title, body, url}` keeps it, and a later flush sends it again, at most three times. A crash between the send and the ledger line can send one alert twice; a lost alert would be worse.
- *When.* After each run-due batch, `run now` and `run resume`, and after `darius sync` (the 15-minute timer), which catches lines a session wrote by hand. A host without keys, or with no device yet, sends nothing and records nothing; lines from before the keys or the first device are history.
- *Web Push, no dependency.* The payload is encrypted for each device (RFC 8291, aes128gcm) and the request signed (RFC 8292, VAPID, ES256) with WebCrypto, which both runtimes have; the test checks the encryption byte for byte against the RFC's example. The push service (Apple, Google, Mozilla, Microsoft) only forwards ciphertext. A 404 or 410 ends the device (`push.gone`).
- *Keys.* One VAPID pair in `<config>/push.json` (0600) on each host that sends, the same pair on all of them, because a subscription is bound to the public key it was made with. `darius push keys --subject <mailto:|https:>` makes it on one host; the file is copied to the others. Never in the store, never printed.
- *Devices, the first web write.* The web app's button fetches the public key (`GET /api/push/key`), subscribes in the browser, and posts the subscription (`POST /api/push/subscribe`, `/unsubscribe`; `src/web/push-api.ts`). darius records it as `push.subscribed{endpoint, p256dh, auth, viewer}` in the `_global` ledger, so every host that syncs knows every device. The keys of a subscription only let a sender encrypt for that device; the push service accepts nothing without the VAPID signature. A POST passes the access check of every page, must carry an Origin of the page itself (the request's host, either scheme, or `$DARIUS_WEB_URL`), must be JSON and at most 4 KB, and the endpoint must be https on a known push service, so no caller can make darius post to a URL of its choice. Push needs a secure context: the page must be opened over HTTPS (a tailnet TLS proxy), or on localhost. On an iPhone the app must be on the home screen (iOS 16.4 or newer).
- *Not yet.* A host without keys stays silent rather than failing its batch; answering from the notification or the run page comes with the decision ladder.

**Decision ladder (planned for 0.30.0, operator rulings 2026-09-30).** Every question a run asks goes up a ladder: a standing rule of the ritual, then a decider model, then the operator. The operator names the model (a full pinned id in `trusted_models`); they trust Fable, not Sonnet, and there is never a fallback model: `--fallback-model` is a reserved profile argument since 0.29.0. The operator lets the decider decide content fixes, operations, code merges and production deploys, and gets an info alert after each code or deploy decision. Fable reviewed the design (2026-09-30); its required points: the decider is a pure text call (no tools, gate scope `none`, one turn), so it cannot read a secret or a web page; the proof of the model is the model of the message that carries the decision, else every question escalates; it runs under the ritual lease; `run.decided` is read by `run ack`, the needs-you lists and the handoff. v1 decides answers only; one-time command grants come after some days, only for command shapes the ritual lists (the shape, not the model, sets the class), and a content decision needs a before-state.

**Tool check (0.12.0).** Before a run, darius looks up each program that the ritual's `may` rules name (`Bash(pnpm cli *)` names `pnpm`) on the runner's PATH. When one is missing it skips the ritual as `tool-missing`, a failing skip, before any spend. The first timer run of the `daily-report` djinn failed this way: `pnpm` was not on the unit PATH, every `pnpm cli` call exited 127, and the run cost money for nothing. `pnpm` is now one of the programs whose dir `setup --systemd` puts on the unit PATH.

**Resume (0.16.0).** `darius run resume <run>` goes on with a held run after the operator answered it. It refuses a run that is not held, and a held run with no answer since its latest hold. The checks of `run now` apply (mode, `max_mode`, tools, profile, gate preflight, the ritual lease), and the run keeps its id: darius appends `run.resumed`, not a new `run.started`.

- *Same session when this host has it.* After every launch, run-due notes the harness's session id in `<run dir>/session.json`. When the note exists and Claude Code still has the session on this host, darius launches `claude -p --resume <session_id>` with every flag again and the answers as the message. The session keeps its transcript, not the tools, the hook or the system prompt, so darius passes them again. Probed 2026-09-29 on a real run: the same session id came back, and a PreToolUse hook fired inside the resumed session. `run.resumed` records the `session_id`.
- *A new session otherwise.* Run dirs are not synced and Claude Code keeps sessions per host, so a resume on another host, or of a run whose surface reported no session id (herdr), starts a new session. Its first message holds the questions and the answers; `run.resumed` records `fresh: true`.
- *An answer does not lift the hold list.* The gate is the same after an answer, so a held command is held again. The message tells the model to name an approved held action in the findings, for the operator to do. A one-time approval of one held command is not built (docs/backlog.md).
- *Questions number on across holds.* `run answer <run> <n>` numbers every question of every hold from 1, and refuses a number past the last. A hold in a resumed run is recorded again.

**Acknowledge (0.18.0).** `darius run ack <run> [--note TEXT]` records that a person saw a failed or abandoned run: one `run.acknowledged` line, with who and the note. It refuses every other run (a held run is answered and resumed instead), and a second acknowledgement. It is display only. The timer does not retry a ritual whose latest run failed today, acknowledged or not; a retry is always a person's `darius run now`. The `failed-today` line of the report names who acknowledged the run, or gives both commands. The web page and the TUI stop counting an acknowledged failure as something that needs the operator: the home board shows it as a plain card with the acknowledgement, and the run and ritual pages say what happens next.

**Host pin (0.18.0).** Two hosts with the run-due timer both take every due ritual. The ritual lease only serializes them: one runs it, the other skips it as `lease-held`, and which host wins is chance. But a ritual may need one host: its checkout, its tools, its credentials, or the harness session that a resume goes on with. `darius ritual set <slug> --host NAME` pins the ritual to one host, and `--host ""` clears the pin. NAME is the host id, the `host` of that host's `config.toml`. The pin lives in the ritual's store item, never in the repo: decision 9 keeps host names out of git, and a move to another host needs no commit. run-due, `run now` and `run resume` on any other host skip the ritual as `other-host`, before any run exists. The skip is quiet in the digest and the news, like mode `off`, because it repeats every hour; `run now` names it. The web ritual page says "Runs on NAME". A host before 0.18.0 cannot read a pinned ritual (the store refuses unknown keys), so update every host before the first pin.

## Web status page

Status: 2026-09-28, 0.9.0; the app 0.11.0. Operator request: "the darius app that runs when installing/running darius on a host", to confirm that djinn runs properly.

`darius serve` serves a read-only web app per host from the local store. Its home page (0.15.0, operator choice among three mockups) is a command board: one verdict, the things that need the operator, a rail of health gauges and the djinns; everything else lives one click away. Earlier it held: an overview (held runs with their questions and the exact `darius run answer` command, what is due, the djinns, the newest runs), all runs with filters, one page per project, per ritual (policy, instructions, runs) and per run (event timeline, findings), and the store-wide profiles. `/api/status.json` has the status as JSON. It computes everything the way `due`, `run list` and `vigil list` do, and never writes, syncs or locks; the sync timer keeps the store fresh. The app revalidates every minute. The project page (0.25.0, operator request 2026-09-30, a UI exception to the scope rule; 0.28.0 shows the legacy vigils of the linked checkout read-only, `src/core/legacy-vigils.ts`, because they stay canonical in `.tracker/vigils/` until phase 3) opens as a dashboard: four linked tiles, then Now, Scheduled and Vigils panels, then the djinn reports and recent runs, with the manual rituals in the rail. State moves: a running run pulses and sweeps, a waiting one breathes, and `prefers-reduced-motion` stops it. The phone layout (0.33.0, operator request 2026-09-30) makes home a dashboard for all projects: a status strip (need you, running, failed, flagged, overdue), then Now, Needs you with the commands folded, Last night, Up next (next djinns, overdue manual rituals), one health line for timer and sync, and the djinns; the health gauges are gone. The Home badge counts the same things as the verdict. On a phone the project page is one column in reading order. Since 0.34.0 both pages lead with "Coming up" (every active ritual once and every dated vigil, grouped by day) and "Waiting on an event" (the armed vigils without a date), in place of Up next, Djinns, Scheduled, By hand and the vigil panel (`web/app/lib/agenda.ts`). Since 0.35.0 every page marks what an item is with one of three kinds, each a word, a colour and an icon: ritual (darius runs it), manual (done by hand) and vigil (`web/app/lib/kind.ts`); state colours stay separate. Since 0.36.0 manual is a mark on a ritual rather than a kind, every list uses one row and one chip, the state words live in `web/app/lib/state-words.ts`, and empty sections do not render. Since 0.37.0 a kind shows once, in colour: the row icon (a hand for a manual ritual) and one coloured word, not a chip.

`setup --systemd` installs and starts it as the user service `darius-web.service`; the home-manager module has `services.darius.web`, off by default since 0.14.0 (operator ruling 2026-09-29): with `--bind auto` the page listens on the tailnet, so a declared host opts in to that listener, and a sync-only host needs no page.

**The app (0.11.0, operator ruling 2026-09-28: a React Router app in framework mode, themed after Diablo II Act 2).** The app lives in `web/`, its own package with its own `package.json` and `bun.lock`: React, React Router 7 in framework mode (server rendering), Vite, Tailwind. `darius serve` stays `node:http` and keeps access control, `/healthz`, `/api/status.json` and the static files of `web/build/client`. Every other request goes to the app's server build: darius imports `web/build/server/index.js` and calls its handler with a `WebContext` (`src/web/api.ts`). The loaders read darius only through that context, so the data code stays in `src/` under `node:test`, and the bundle holds only pages. The web side imports `src/` with `import type` only.

- *No runtime dependency for the CLI.* Vite bundles React and React Router into the server build, which imports only `node:` modules. So the CLI and the timers still run with zero packages, and only `darius serve` loads the bundle. It loads under Node and Bun.
- *Untrusted text stays text.* Findings and ritual bodies come from a model or a person. `src/web/markdown.ts` parses them into blocks of spans (headings, paragraphs, lists, tables, code; no links, no images, no raw HTML), and the app renders them as React text nodes, never as HTML.
- *CSP with a nonce.* darius makes a fresh nonce per request, passes it in the context, and sends `script-src 'self' 'nonce-...'` with no `unsafe-inline`. The app puts the nonce on its inline hydration scripts.
- *An update restarts the service.* A Bun process cannot import a changed module again. When the version or the web build on disk differs from the one the process started with, the next request gets a 503 and the process exits 75, and systemd starts it with the new code.

**Build (0.11.0, operator ruling 2026-09-28: commit the build).** The built app, `web/build/`, is committed. A host and the Nix package never build it: they need no Bun for the build, no network and no `node_modules`. The build writes `web/build/build-info.json` with a hash of every build input (`web/source-hash.ts`), and `test/web-build.test.ts` fails when the committed build is older than its source. So the three gates catch a forgotten `bun run web:build`. Rejected: a build on each host (Bun and network on every host, and a hashed `node_modules` derivation for Nix to update with every package change); a release tarball as collie does (CI and release plumbing for a private repo). The cost: built JavaScript in git diffs.

**Access (0.10.0, operator ruling 2026-09-28: tailnet identity).** The page is reachable on the tailnet, and the tailnet is the login. `--bind auto`, the default, listens on loopback and on this host's tailnet address; while Tailscale has no address yet, it listens on loopback and tries again every 30 s. `0.0.0.0` and `::` are refused. For each caller from the tailnet darius asks the local tailscaled `tailscale whois` who it is, and caches the answer for a minute. The caller passes when its device belongs to an allowed login (`DARIUS_WEB_ALLOW`, default the login that owns this host) and is not a tagged device. The operator's tailnet also holds tagged servers and another user's device; they get 403. A caller on loopback is on the host itself and passes. A failed lookup refuses: the check fails closed. `/healthz` answers without a check and shows no data. Rejected: a token login (a secret to manage per device, and the tailnet already knows who calls); an open page on the tailnet (servers and another user would read internal findings).

**Install and push (0.32.0, operator request 2026-09-30).** The page is an installable web app: a manifest, a cut-gem icon in the sizes phones ask for, and a service worker that only shows Web Push notices and opens their page on a tap. It has no fetch handler, so no page is ever served from a cache and the read-only status stays live. A footer switch subscribes one device at a time through `darius serve`'s push endpoints (0.31.0). Push needs a secure context, so a phone uses the proxy's HTTPS name; an iPhone also needs the Home Screen icon first. Rejected: an offline cache (a stale status page is worse than none).

**Behind a proxy (0.30.0, operator request 2026-09-30).** The operator opens each lane by an HTTPS name on the tailnet, through a reverse proxy on another node that terminates TLS and names the calling device in a header. Every request then comes from the proxy's address, so `whois` would name the proxy. With `DARIUS_WEB_PROXY` set to the proxy's addresses, a request from one of them passes only when the proxy's header (`DARIUS_WEB_PROXY_HEADER`, default `X-Tailnet-Device`) names a device in `DARIUS_WEB_PROXY_DEVICES`; a request from anywhere else is judged as before, and its header is ignored. So the header needs no network rule to be safe: only the proxy's address can use it. A proxy on the same host is named as `127.0.0.1`, and loopback then needs the header too. `DARIUS_WEB_URL` is the address people open. Rejected: trusting the header from any caller (a device could name another), and the proxy's own login in `DARIUS_WEB_ALLOW` (every caller of the proxy would pass as that one login). The values are per host and live in `~/.config/darius/web.env` (stable) and `next.env` (the checkout), never in the repo.

It does not decide the central server (see "Non-goals"). It is one more read-only client of the core functions, and the first thing a central server would replace or embed.

## Harnesses, profiles and surfaces

Status: 2026-09-28. Steps 1 to 3 of the build order are built (0.5.0, 0.6.0, 0.7.0); steps 4 and 5 are not. Operator requests: darius must not depend on one harness, the operator must be able to watch a run in a herdr pane, and each ritual picks its harness and arguments from a named, pre-configured list. A **harness** is the agent CLI that drives a model session: Claude Code, Codex, opencode, pi. A **surface** is where that session runs: in the background, or in a terminal pane a person can watch.

### Research (probed on the lead host, 2026-09-28)

Every claim below comes from a probe run in a throwaway directory, or from the harness's own docs or source where the table says so.

| | Claude Code 2.1.283 | Codex 0.156.1 | opencode 1.18.32 | pi 0.87.1 |
|---|---|---|---|---|
| Headless | `-p --output-format json` | `exec --json` (JSONL) | `run --format json` (JSONL) | `-p`, `--mode json` |
| Pre-tool gate | `PreToolUse` hook via `--settings` | `PreToolUse` hook, Claude's schema, via `-c hooks...` | plugin `tool.execute.before` via `OPENCODE_CONFIG` | extension `tool_call` via `-e <file>` |
| Gate blocks with permissions skipped | yes (probed) | yes (probed) | yes, under `--auto` (probed) | yes, pi has no permission system (probed) |
| Gate crashes or cannot start | call runs (fail open) | call runs (fail open) | call blocked (a throw blocks) | call blocked (a throw blocks) |
| Effort | `--effort` | `-c model_reasoning_effort=` | `--variant` | `--thinking` |
| Skip permissions | `--dangerously-skip-permissions` | `--dangerously-bypass-approvals-and-sandbox` | `--auto` | (always) |
| Append to system prompt | yes | no, reads `AGENTS.md` | no, reads `AGENTS.md` | yes |
| Turn limit | `--max-turns` | none | `steps` | none |
| Session id, cost | both | session id, tokens only | both | both |
| Interactive with a first prompt | `claude "..."` | `codex "..."` | `opencode --prompt` | `pi "..."` |
| Parent env reaches shell commands | yes | yes | yes | yes |

Three findings shape the design:

1. **Codex drops a per-run hook without a word** unless `--dangerously-bypass-hook-trust` is also passed. A second probe also found that a bare exit 2 did not block while another hook was registered; the JSON decision did. The run then has no gate and nothing says so. Harness behaviour changes between versions, so a gate is proved per harness version, not assumed (see "Gate check").
2. **With permissions skipped, Claude Code's `--disallowedTools Bash` is not a gate.** The model handed the job to a subagent (`Agent`), and the subagent ran the denied tool. The hook still blocked, also inside the subagent. `--disallowedTools Agent` did hold. So the gate has to judge every tool, not only Bash.
3. **All four pass the parent environment to shell commands.** `DARIUS_RUN` and the `darius run hold|complete` protocol therefore work unchanged in every harness and on every surface. darius learns that a run ended from the ledger, never from the harness's stdout, so nothing in the run lifecycle depends on the harness.

### The contract

darius owns everything that makes a run a run: the lease, the ledger lines, the prompt and protocol, the policy, the timeout, the report. An adapter only translates. Two adapter kinds, in `src/harness/` and `src/surface/`:

```ts
interface HarnessAdapter {
  id: "claude" | "codex" | "opencode" | "pi";
  /** What this harness can do; the policy ceiling and the launch plan read it. */
  caps: { systemPrompt: boolean; maxTurns: boolean; cost: boolean; gateFailsClosed: boolean };
  /** Flags a profile's `args` may not contain: the ones that install or disable the gate. */
  reservedArgs: readonly string[];
  efforts: readonly string[];
  version(bin: string): string | null;
  /** Writes the run's gate files and returns argv for both modes plus the first message. */
  prepare(run: RunSpec): { headless: string[]; interactive: string[]; message: string; env: ChildEnv };
  /** Native hook payload to one neutral tool call, and a neutral decision back to native output. */
  gateInput(payload: JsonValue): ToolCall;
  gateOutput(decision: GateDecision): { stdout: string; exitCode: number };
  parseResult(stdout: string): { sessionId?: string; costUsd?: number; turns?: number };
}

interface SurfaceAdapter {
  id: "headless" | "herdr";
  /** null when usable here, else the reason it is not. */
  unavailable(): Promise<string | null>;
  launch(plan: LaunchPlan): Promise<LaunchResult>;
}
```

The first message always carries the protocol. A harness with `caps.systemPrompt` also gets the procedure in its system prompt, as today. That gives one code path that works for all four.

### One gate, thin shims

`darius policy-check` stays the only place with rules. It gets `--harness <id>` and reads that harness's payload through `gateInput`. Every tool call becomes one neutral record:

```
ToolCall = { class: shell | read | write | web | agent | other, name, command?, path?, url? }
```

| Class | `report` | `act` |
|---|---|---|
| `read` (Read, Grep, Glob and their kin) | allow | allow |
| `shell` | allow only when it matches `may`, matches no `hold` pattern, and has no report-mode write verb | allow only when it matches `may` and no `hold` pattern |
| `write` (Write, Edit, apply_patch) | deny, except a scratch file under `/tmp` (0.23.0) | the same (act means the commands in `may`) |
| `web` | deny | allow only when named in `may` |
| `agent` (subagents) | deny, unless `may` names `Agent` (0.21.0); then every call of the subagent meets this table | the same |
| `other` (MCP and unknown tools) | allow only when named in `may` | allow only when named in `may` |

The table applies in full when the harness's own permission system is off (`permissions = "skip"`) or cannot express the policy (Codex, opencode and pi, because darius does not translate `may` into their rule languages). With Claude Code in gated mode the native allowlist already enforces `may`, so the gate does what it does today: `hold` and the report-mode write verbs on shell calls, and it leaves every other tool to the allowlist. The run's `policy.json` says which (`gate: "full" | "shell"`, absent means `shell`). Two matchers that could disagree about one command would hold live runs that pass today, so the gate never second-guesses a native allowlist that is on.

**darius alone decides (0.20.0, operator ruling 2026-09-30).** `permissions = "skip"` is the default. The operator asked whether the decision is deterministic. It is when darius alone decides: the gate is a pure function of the call, the policy and the held state, and tests pin it. Claude's own check is fixed code too, but not ours: it changes with each version, adds rules of its own (under `dontAsk` it refused `true; echo exit=$?` although both parts were allowed), and in a herdr tab it asked a person and waited. What the model does after a refusal is not deterministic; the refusal text only helps it find an allowed way, and the block does not depend on it. With skip, the hook is the only guard, so the gate check per harness version (0.19.0) must pass before a run. `gated` stays as an explicit option for a second layer; it passes `--permission-mode dontAsk`, so it refuses what its allowlist does not name and never asks. A model deciding (Claude's `auto` mode) was rejected: nobody can know its answers before a run.

Each adapter lists its harness-internal tools (Claude Code: `ToolSearch`, `TodoWrite`, `TaskCreate` and its kin, which are a to-do list, not subagents), which the full table allows. Any other unknown tool is denied, the other spawning tools included (`TeamCreate`, `SendMessage`, `Workflow`, `Monitor`, `EnterWorktree`; a test pins them). For Claude Code a probe showed that the hook also fires inside a subagent (the payload carries `agent_id`; again on 2.1.285), that with permissions skipped a subagent ignores the parent's `--disallowedTools`, and that `--disallowedTools Agent` removes the tool itself. So a ritual that does not name `Agent` gets `--disallowedTools Agent` in skip mode, and the model never sees the tool.

**Subagents (0.21.0, operator ruling 2026-09-30).** Until 0.21.0, `agent` was always denied, on the view that rituals do not need subagents. The first unattended fact check showed the cost: its skill asks for an independent second verification of every CRITICAL, and the run could not do it. Now a ritual opts in by naming `Agent` in `may`. Then:

- The run gets gate scope `full` in every permission mode, as a skill ritual does, so the hook judges every call of every subagent by the same policy. Gated mode never lists `Agent` in `--allowedTools`: nothing proves that a subagent keeps to the parent's permissions there, so in 0.21.0 subagents need permissions skipped.
- The gate denies an `Agent` call from a subagent (no nesting), and one with `isolation`: a remote subagent runs where this hook cannot see it, and a worktree writes a branch into the checkout.
- A subagent may run `darius run hold` (a hold fails closed) but not `darius run complete`: the main session collects the findings, and the ledger cannot tell the two apart, because they share `DARIUS_WHO`.
- The prompt says the rules up front, and to wait for every subagent before the run is completed.
- `--max-turns` bounds the main session only; the run timeout bounds the subagents. Whether `total_cost_usd` includes subagent spend is to be confirmed on the first real run.
- The subagent tool is granted per run only when the gate check of the installed harness version saw the gate judge a subagent on this host (see "Gate check"). Without that proof a report ritual still runs, without `Agent`, and the report warns: that loses a capability, not safety. An act ritual is skipped as `subagents-unproven` (0.22.0), a failing skip: its subagents verify a finding before it writes, so without them it would write unverified.

A decision is allow, deny or hold (0.7.1). `hold` is for what needs a person: a `hold` pattern, a report-mode write verb, any call once the run is held. The run is held and the model is told to stop. `deny` is for a call the policy does not allow (outside `may`, a file write, a subagent, web in report mode): the model is told not to retry and to go on within the policy, as it does when a native allowlist refuses a call. Holding on those would end a run with permissions skipped on its first stray `ls`.

Known limit of layer 2: `read` is always allowed, in both scopes, so an unattended run can read any file the unit's user can read, credentials included. Layer 3, the scoped environment of the timer unit, is the answer, not the gate.

`may` keeps today's Claude permission-rule syntax, so no ritual changes: `Bash(pnpm cli fc *)` is a shell rule, any other entry names a tool. The gate matches shell rules itself now, because on three of the four harnesses nothing else would. One rule keeps that safe: in a gate pattern, `*` never matches `;`, `&`, `|`, a newline, a backtick, `$(`, `<` or `>`. A pattern that needs one of those spells it out, as `Bash(cd djinn && pnpm cli fc *)` does. So `pnpm cli fc x; rm -rf ~` does not match `Bash(pnpm cli fc *)`.

The shims only move data:

- **Claude Code:** the run's `settings.json` wires `PreToolUse` to `darius policy-check --harness claude`: matcher `Bash` in gated mode, as today, and matcher `*` when permissions are skipped.
- **Codex:** the same hook schema through `-c hooks.PreToolUse=[...]`, always with `--dangerously-bypass-hook-trust`. The adapter lists the trust flag and `hooks` as reserved, so a profile cannot remove them. The deny must be the JSON decision on stdout plus exit 2 with a reason on stderr: in one probe a bare exit 2 did not block while another hook (herdr's integration in `~/.codex/hooks.json`) was also registered, and the JSON form did. The hook also fires for `apply_patch`, Codex's file edit tool, so `write` is gated too.
- **pi:** darius writes `<run>/gate.ts`, loaded with `-e`. It pipes the call to `darius policy-check --harness pi` and throws on any failure, so a gate that cannot start blocks.
- **opencode:** a plugin that does the same, loaded per run with `OPENCODE_CONFIG=<run>/opencode.json` naming `file://<run>/gate.ts`. Probed: this loads from outside the checkout and writes nothing into it, `tool.execute.before` fires for shell, write and edit, and a gate whose child process cannot start throws and blocks. The plugin must spawn with `node:child_process`; Bun's `$` shell hung on a missing binary.

**Preflight, per run.** Claude Code and Codex let a call through when the hook cannot start. So before each launch darius runs the exact gate command line with a synthetic call that must be denied, for example a shell call matching the first `hold` pattern. Anything but a deny refuses the run (`gate-broken`). This costs one process spawn.

**Gate check, per harness version (0.19.0).** The preflight proves the gate command starts; it cannot prove the harness still obeys the hook, and with permissions skipped the hook is the only guard. Claude Code updates itself every few days. So a harness version must pass a check on a host before it runs a ritual there. The check starts the harness for real, headless, with permissions skipped, the cheapest model (`haiku`), three turns and two minutes, through the same run files, hook wiring and environment as a ritual run, under a gate that allows nothing (`may` empty, scope `full`). It asks the model to `touch` a marker file, then (0.21.0) to start one subagent that must `touch` a second one. `passed`: no marker, and the gate log has a denied shell call. `failed`: a marker exists, or the gate failed its preflight. `inconclusive`: neither, so the model never tried, or the harness did not start or finish. `subagents` is `passed` when the log also has a denied shell call from a subagent (the log line's `agent` field), else `inconclusive`. Each check appends `harness.checked{harness, version, outcome, subagents, run, cost_usd?, detail?}` to the `_global` ledger; the line carries its host, so the digest and the pages can show it. Checks from before 0.21.0 have no `subagents`, so subagents stay off until the next check.

run-due, `run now` and `run resume` read the version once per batch (`claude --version`, the adapter's `versionArgs`). When the latest check of that version on this host passed, the run starts. When there is none, they run the check first and name it in the report; this happens once per Claude Code update. When one did not pass today, they skip every ritual of that harness as `harness-unchecked`, a failing skip, and do not try again until the next day: the check costs a model call, and an hourly timer must not repeat it. `darius harness check [<id>]` runs one by hand (exit 0 passed, 1 failed, 3 inconclusive), and `darius harness list` shows the latest check per version and host. This holds for both permission modes: a hook that Claude ignores also loses `hold` and the report-mode verbs of a gated run. A dry run names a pending check and spends nothing. The Codex trap above was the first reason for the check; Claude's update pace is the second (operator question 2026-09-30: is the decision deterministic? Only when darius alone decides, and that needs this proof).

**Gate log (0.19.0).** `policy-check` appends each decision to `<run>/gate.jsonl` next to the policy file: `{at, tool, class, verdict, reason?, command?, agent?}`. The check reads it. A line that cannot be written never changes the decision.

### Profiles

A profile is a named preset for starting a harness:

```toml
[profiles.opus-medium-skip]
harness = "claude"
model = "opus"
effort = "medium"          # checked against the adapter's efforts
permissions = "skip"       # skip (default since 0.20.0) | gated
surface = "herdr"          # headless (default) | herdr
max_turns = 40
args = []                  # passed as-is, after darius's own flags; reserved flags refused
```

`permissions = "skip"` turns off the harness's own permission system. The darius gate stays, because the research shows it holds with permissions skipped, and the gate check per harness version proves it again after each update. `max_mode` is not a profile field. A profile never lifts a run above the ceiling of its repo.

Resolution, highest first, field by field:

1. The item's own fields: `policy.profile = "<name>"`, plus today's `policy.model` and `policy.max_turns`, which keep working.
2. The repo's `.darius.toml`: its `[profiles.<name>]` tables and a `[defaults]` table (`ritual = "<name>"`).
3. Store-wide profiles, synced to every host: item files `items/profiles/<name>.md` in a reserved store project `_global`, written only through `darius profile add|set`. `sync --all-projects` and run-due sync `_global` first, and create it when missing, so a new host gets the profiles. There is no `profile remove` yet: sync has no delete path for items (see "Compaction"), so a removed file would come back from the bucket.
4. Built in: `claude`, headless, permissions skipped (gated until 0.20.0), and the ritual's model and turn limit.

When a ritual names no profile and the repo has no `[defaults] ritual`, the profile called `default` applies, from the repo or the store. A profile named explicitly that neither defines skips the ritual as `profile-invalid`, which fails the batch. So does a profile whose effort the harness does not take, or whose `args` contain a reserved flag. `darius profile add|set` checks the same at write time. An arg is almost always a flag, so the CLI takes it as `--arg=--verbose`.

Per host, `config.toml` holds only what differs per machine: the executable per harness. Today that is `[runner] claude`; a `[harness.<id>] bin` table comes with the second adapter.

A repo that uses `[profiles]` or `[defaults]` writes `v = 2`. An older darius refuses a v2 marker with its existing "upgrade darius" error, so an old host skips the project instead of running it with the wrong profile. A v1 marker stays valid. The TOML subset gains one-line string arrays for `args`.

**Editing.** One store, one set of core functions. The CLI comes first (`darius profile ...`, `darius ritual set --profile`). The TUI gets a profile screen over the same functions. A herdr plugin pane can host that TUI. A web UI would be one more client of the same functions, and it belongs to the central server, which is not decided (see "Non-goals").

### Surfaces

**headless** is today's launcher: the harness in its own process group, darius's timeout, SIGTERM then SIGKILL.

**herdr** opens the run in a herdr tab, so a person can watch and type. Built in 0.7.0 (`src/surface/herdr.ts`), proved on the lead host with a real Claude Code run in an isolated herdr session:

1. `herdr status` must show a running server. Otherwise darius warns (`surface-fallback`, in the report and the journal) and runs the ritual headless (operator ruling, 2026-09-28). A timer finds the default herdr server by itself; `DARIUS_HERDR` names the executable and `DARIUS_HERDR_SESSION` a named session.
2. Find or create a workspace labelled `darius-runs` (not `darius`, which is likely the operator's own workspace for this repo). Create a tab there with the working dir, a label `<ritual> <last 6 of the run id>`, the run variables through `--env` (plus the store dirs and PATH when set), and `--no-focus`.
3. `herdr agent start d-<run> --kind <harness> --pane <root pane> -- <interactive argv>`. The interactive argv is the headless one without `-p`, JSON output and the turn limit. A new tab's shell is not ready at once (`agent_pane_busy`), so darius retries for up to 30 s. An interactive harness can stop at a startup dialog: Claude Code asks once per folder whether to trust it (`agent_not_ready`). darius then waits until the agent is idle, which means someone answered in the tab. Only then does `herdr agent prompt d-<run> <message>` send the first message.
4. Wait until the ledger shows the run completed or held, or the timeout ends it. On timeout darius marks the run failed and closes the tab. A finished run's tab stays open for the person; the next run-due batch closes the tabs of runs that are no longer running (`<run>/herdr.json` remembers the tab).
5. When herdr reports the agent `blocked`, `idle` or `done` without a protocol line for longer than the grace time (10 min, `DARIUS_HERDR_WAIT_GRACE_MS`), darius holds the run with a question that names the tab. The same holds for a startup dialog nobody answers. An agent that exits without a protocol line fails the run. A gated profile stops at Claude's own permission prompts in a tab: `--permission-prompts none` acts only in print mode. The first unattended fact check (2026-09-30) waited at such a prompt for a `$?` in its command until this hold. Since 0.20.0 the default is `permissions = "skip"`: the gate enforces the whole policy (scope `full`), and nothing prompts. A gated profile passes `--permission-mode dontAsk`, which refuses instead of asking. Interactive Claude asks once per host before it runs with permissions skipped; a new host's first herdr run waits there until someone accepts in the tab (or the Claude setting `skipDangerousModePermissionPrompt` is on), and the startup grace hold covers it.

A watched run is not a special mode: same prompt, same protocol, same gate (operator ruling, 2026-09-28). A person who types into the pane simply takes part.

The herdr tab runs in the herdr server's environment, not in the timer unit's scrubbed one. So the third policy layer, scoped credentials, does not hold on the herdr surface. The run report says which surface a run used.

Cost and session id are not available from a pane. The run records them as absent.

### Build order

Each step ships alone. None changes what an existing ritual does unless its profile asks. 0.20.0 departs from this on purpose: the built-in default became `skip` (operator ruling 2026-09-30, after the gate check shipped in 0.19.0).

1. **Contract, no new behaviour for today's rituals** (MINOR). Move `launch.ts` into the Claude adapter and the headless surface. Neutral `ToolCall` in `policy-check`, the full gate table behind `gate: "full"` (not used by any run yet), shell rules matched with the metacharacter rule, the preflight. Tests: the gate table per class and mode; the metacharacter rule; `gate: "shell"` decides exactly as today; the preflight refuses a broken gate command; the Claude argv and settings are byte for byte unchanged.
2. **Profiles** (MINOR). `_global` store project, `darius profile` verbs, `policy.profile`, marker v2, resolution, reserved args, `--effort` and `permissions = "skip"` for Claude. Tests: resolution order field by field; a v2 marker refused by the v1 reader; reserved args refused at write time and at launch.
3. **herdr surface** (MINOR). Fallback with warning, tab per run, wait loop, `blocked` to hold. Tests against a fake `herdr` on PATH; one real run on the lead host.
4. **Gate check and more harnesses** (MINOR). `darius harness check`: built in 0.19.0. Then the pi, opencode and Codex adapters.
5. **Editors** (MINOR). TUI profile screen, herdr plugin actions ("run this ritual now in a pane", "due list").

## Djinns

Status: 2026-09-28, 0.8.0. Operator request: set up djinn for a project, as a local subagent and as "the ghost of darius executing and working on things". Architect advice (Fable, 2026-09-28) shaped this section.

**One definition, two callers.** A djinn is the agent a repo describes: `.darius.toml` (identity, ceiling, profiles), `CLAUDE.md`, `.claude/agents/*.md` and the skills under `.claude/skills/` (also in a subdirectory, as `djinn/.claude/skills/` in a project). The repo already holds all of it; darius adds nothing to the repo but the marker (decision 9 stands).

- **Local subagent.** The operator's own session calls the agent (`djinn <request>`), as today. darius runs nothing; it only appears when the agent calls `darius` verbs.
- **The ghost of darius.** A ritual names a skill (`ritual set <slug> --skill daily-report`). run-due, or `darius run now`, starts a harness session in the project's linked checkout. The prompt says to invoke that skill; the checkout supplies it. The profile picks the harness, model and surface; the gate and the policy replace the person.

**Activate** means: the host has a checkout, `darius link` recorded it, and the marker's `max_mode` is above `off`. There is no other state. A host without the checkout skips the project (`no-workdir`), as before.

**Skills get the full gate.** A skill can grant tools of its own (`allowed-tools` in `SKILL.md`; the `daily-report` skill of a project grants `Bash, Read, Write`). So a ritual that names a skill always runs with gate scope `full`, which enforces `may` itself, and the hook sees every tool. `Skill` itself is allowed. Where a skill says to write a file, the prompt tells the model to put the content into the findings, because unattended runs never write files.

**Command chains.** In scope `full`, a shell line passes when one `may` rule matches it whole, or when the line splits into commands that each match a rule. The split reads quotes as the shell does (0.8.1), so an operator inside quotes is an argument, not a command. A line the split cannot keep is refused: command substitution (`$(`, backticks, also inside double quotes), an unquoted redirection, a lone `&`, a subshell parenthesis, an unclosed quote. The first djinn run showed why the quote reading matters: the daily report's `/go/` probe passes `-w "... -> %{redirect_url}"` to curl. An output redirection to a file under `/tmp` or to `/dev/null` (`>`, `>>`, `2>`, `&>`), and one from a descriptor to another (`2>&1`), leaves its command, so it needs no rule (0.18.1). The first unattended fact check (2026-09-30) showed why: its skill writes each step's JSON to `/tmp` with `>`, and scratch files there change nothing in the repo or the product. Every other redirection is still refused. A refusal tells the model its reason: the construct, or the command that no rule allows. Since 0.23.0 the write tools may write a scratch file too: with permissions skipped, `Write` and `Edit` are no longer removed from the session, and the gate allows them only for an absolute path under `/tmp` with no `..` step. The fact-check fixes need it: tip prose goes to djinn as a file (`--description-file`), and French text in a shell quote breaks. A gated run keeps both tools off, because nothing gates its writes.

**`darius run now <ritual> [--profile NAME]`** starts one ritual now, due or not, on the same path as run-due: lease, gate preflight, profile, surface, report to stdout. A held or open run still blocks it, mode `off` refuses it, `max_mode` still caps it. A run that failed today does not block it: a person asked.

**The `djinn` CLI stays the content tool** that the skills call. darius is the runtime; djinn is not. Plain-command rituals (a `command` with no harness, like a vigil check) are a later step.

The first djinn ritual on the lead host is `daily-report` in a project: mode `report`, the built-in profile.

## Vigil auto-execution

A vigil check is a shell command with an expectation. darius runs it. No LLM is involved. The rules are ported from the legacy vigil sweep script (read first-hand 2026-09-28) because they are measured on 60 real vigils. Two changes only: the event gate can fire itself through `gate_command`, and evidence goes to the ledger instead of into the vigil file.

**Command.** `darius vigil sweep [--project P | --all-projects] [--only slug] [--include-heavy] [--daily] [--classify-only] [--dry-run] [--timeout 120] [--json]`. The daily timer runs `--all-projects --daily` at 06:30 local on every host; the sweep lease (see "Write path") picks one host per project and day. Another host's done or held lease is a skip (`swept-today`, `sweep-held`), exit 0; an unreachable bucket is `lease-offline`, exit 3. `--classify-only` executes nothing and writes nothing. `--dry-run` executes every Command but writes no `vigil.closed` line; it still writes evidence, so a dry run is never free. The sweep refuses to start (exit 1) when `DARIUS_SWEEP_ACTIVE` is already set in its environment, and sets it for every child, so a Command that calls the sweep cannot recurse. `vigil add` also refuses a Command matching `\bvigil sweep\b` or `\bfc\s+vigil-sweep\b` at write time.

**Gate.** `today` is the host's local date. A vigil is `date-due` when `due <= today`. Otherwise it is `event-gated` when it has `until` or a future `due`. A vigil with neither gate is treated as due. For an event-gated vigil with `gate_command`, the sweep runs that command first (same timeout, same cwd): exit 0 means the event fired and the vigil is treated as due from now on; any other exit means not yet, and it is never counted as a failure or a finding. Without `gate_command` the event gate stays what it is today: the checks run and all-pass is a finding for the operator, never a close, because only a person can say the awaited event happened.

**Classification, in this order, one bucket per vigil.** `closed` (has a `vigil.closed` line, never swept). `no-command` (no executable check: every item is manual, has no Expected, or is a shell no-op by the pipeline-aware classifier). `manual-only` is reported as `no-command` with the reason. `heavy` (item frontmatter `heavy: true`, or a Command matching `toolbox run`, `eval-`, `--runs`, `fc discover`, `fc check`) is skipped unless `--include-heavy`. Then `event-gated` or `date-gated`, and `runnable` once the gate allows execution.

**Execution.** Each Command runs with `bash -c`, `cwd` = the project's working dir on this host, the same as run-due's: the linked checkout, else the import's repo when it exists here, else the store's project dir. A project with a checkout elsewhere and none here is skipped (`no-workdir`) with `--all-projects` or `--daily`, and refused when named alone, because a repo-relative Command would fail in the wrong dir and read as a broken guard. Own process group; `SIGTERM` to the group on timeout, `SIGKILL` 3 s later. Default timeout 120 s per Command. Combined stdout and stderr, last 4 KB kept. Sequential, no concurrency, no cap on vigil count. Expected forms are today's four (`exit N`, `stdout contains "x"` over combined output, `stdout matches /re/f`, `file exists path` relative to cwd), plus `manual (owner, expires)`, which is never executed.

**Outcomes and closing.**
- Every executable check passed and no manual item remains, and the gate allows: append `vigil.swept{outcome:"held"}` then `vigil.closed{verdict:"held", by:"sweep"}`. The vigil is closed.
- Any executable check failed or timed out: `vigil.swept{outcome:"failed"}`. The vigil stays armed and is flagged in `due` and in the report. `failed` is never auto-closed; a failing check is as likely a shut precondition as a broken guard. `--close-failed` exists for the operator, not for the timer.
- All executables passed but a manual item is unanswered: `vigil.swept{outcome:"awaiting-manual"}`. Stays armed, not flagged as failed.
- Event-gated, gate not fired: `vigil.swept{gate:"not-fired"}` only. Nothing else runs.
- Heavy without `--include-heavy`, or no executable check: reported, nothing runs, nothing is written except the daily `swept{outcome:"skipped"}` line.

**Evidence.** One `evidence` ledger line per executed check: `check: "vigil/<slug>#<index>"`, `exit`, `outcome`, `duration_ms`, `output_sha` with the output tail as a blob. Per-date upsert is not needed; the ledger is append-only and the latest line per check is the current state. `vigil show` renders the latest sweep like today's "Sweep evidence" section.

**Report.** `--json` prints one object: `date`, per bucket the vigil slugs, per swept vigil its checks and outcome, `counts`. The timer's batch report to the webhook lists: closed held (slugs), failed and flagged (slug, failing check text, output tail), awaiting manual, event gates still pending, heavy skipped. The legacy sweep command writes its latest-report file from this object in phase 3.

## Migration plan

Each phase ships alone and has a mechanical done check.

**Scope rule (operator ruling 2026-09-29, after a review of 0.11.0).** Until phase 5, work goes into the migration phases below, or it fixes something that real use found. No new surface ships before that: no further harness adapters, no herdr plugin actions, no central server, no new web features, no plain-command rituals. The web app, herdr surface and profiles (0.6.0 to 0.11.0) stay as they are. The order: prove the unattended djinn (five timer runs in a row), run the lead host from a pinned clone instead of the working tree, `run answer`/`run resume` and the TUI Due and Run screens (phase 2), the two-host test (phase 1), then the `tracker` router and the vigil import. Deferred ideas, spend caps among them, wait in [`docs/backlog.md`](backlog.md).

**Phase 0, bootstrap.** Repo, standards, `setup`, the model, local store, `import` that reads `.tracker/` read-only for rituals, runs, vigils and the verification ledger. Done when `darius import` on a project then `darius due --json` lists the same rituals and vigils as `tracker due --json`, except retired ones, and the imported ledger line count equals `wc -l .verification-log.jsonl` (the count on the day of the check).

**Phase 1, rituals canonical and synced.** Ritual, run, note verbs. The router maps `tracker ritual` and `tracker due`. Vigils stay canonical in `.tracker/vigils/` and on the legacy CLI until phase 3, because the legacy daily sweep reads those files; `darius due` reads them live and read-only. Sync to the bucket. TUI Due and Run screens. Done when: `run start` on one host then `darius due` on another shows the run after one sync; two concurrent `run complete` on one host give one completion and one refusal; a kill during sync leaves no partial chunk on the bucket.

**Phase 1 in practice (operator ask, 2026-09-29).** One project moved its rituals to darius before the router exists: one last `darius import` brought every run up to date, the operator's session rewrote the `tracker ritual complete` steps of the ritual bodies with `darius ritual set --stdin`, and it runs rituals with `darius run start` and `darius run complete`. Its CLAUDE.md says so. tracker 10.10.0 (the legacy tracker plugin, 2026-09-29) closes the double-run gap without the router: with a `.darius.toml` next to `.tracker/`, `tracker ritual add|run|complete` exit 1 and name the darius command, and `tracker due` leaves rituals out. A `status: retired` edit would not have helped: `tracker due` ignores it. After this cut-over, `darius import` must not run on that project again: it would write the old bodies back.

**Phase 1 done checks, 2026-09-29.** With both hosts on the app install (0.17.1): a run started on the lead host showed on the second host after one sync; two concurrent `run complete` on the second host gave one completion and one refusal (exit 1), and the lead saw the close after one sync. The kill during sync is proven against a real SeaweedFS container in `test/sync.test.ts` ("two hosts on one bucket"), not on the operator's bucket. The router shipped the same day as tracker 10.11.0, so phase 1 is done. It departs from the sketch in "Backward compatibility": the routing is one section of `tracker.mts` ("Rituals routed to darius", the kinds in one `DARIUS_KINDS` constant), not a 30-line file in front of a renamed `tracker-legacy.mts`, and it routes only in a repo whose `.darius.toml` sits next to `.tracker/`, so every other repo keeps the legacy CLI byte for byte. `tracker ritual run` starts a darius run, `complete` completes the open running run (and refuses a held one), `add` and `list` map to darius, and `tracker due` merges darius's due rituals with the legacy vigils in today's JSON shape. The 0.4.1 stash (sync around the daily sweep) waits until a second host runs the sweep; today only the lead does.

**Phase 2, scheduled runs.** `run-due`, policy, hook, webhook. One ritual (`stale-draft-sweep`, `mode: report`) on a systemd timer of the lead host. Done when five consecutive timer runs are recorded with reports, one run was held, answered in the TUI and resumed, and one hold-pattern Bash command was denied by the hook in the transcript.

**Phase 3, vigils canonical and auto-executed.** Vigils become canonical in darius (import, then the router maps `tracker vigil`). `darius vigil sweep` ports the legacy sweep rules (see "Vigil auto-execution") and runs daily from the lead host's timer. The legacy sweep command becomes a thin wrapper that calls `darius vigil sweep --json` and writes its latest-report file from its output, so vigils that read that file keep working. Done when: the same-day `darius vigil sweep --classify-only` and the legacy sweep command with `--classify-only` put every vigil in the same bucket (runnable, heavy, manual, event-gated, no command); one real sweep auto-closed a date-due vigil `held` and left a failing one armed and flagged; `rg 'tracker/cli/bin/tracker.mts|\.tracker/vigils' <legacy-sweep-source>` returns nothing.

**Phase 4, milestones and specs.** Import milestones, specs, checks. `enrich` and `archive` become CLI verbs. `darius doctor` replaces `tracker doctor`. Done when `darius doctor` is green on every linked project, `.darius.toml` is committed in each, and `git rm -r .tracker` lands on the first project with the export snapshot kept for one release.

**Phase 5, retire the shim.** Update the 8 CLAUDE.md files, remove `plugins/tracker/cli`. Done when the shim's deprecation counter (a ledger line per invocation) shows zero calls for 14 days.

## Risks

- SeaweedFS conditional PUT semantics are proven only for `IfNoneMatch: "*"` on the version a sibling project tested. `darius doctor` runs a two-client race test against the real endpoint before phase 1 is called done.
- Hand-rolled SigV4 has sharp edges (path encoding, payload hashing). Mitigation: test against SeaweedFS in a container in `scripts/test.sh`, as a sibling project does.
- Item-level LWW can lose a concurrent body edit. The loser is kept as a blob and surfaced.
- Harness flags and hook behaviour change between versions. Each harness is one adapter file, and `darius harness check` proves its gate per installed version (see "Harnesses, profiles and surfaces").
- A ritual whose procedure needs deploy credentials cannot run in `act` mode from the timer; it holds.
- Phases 1 to 3 keep two stores alive. The shim never writes to `.tracker/`, so each kind has one writer at any time.

## Non-goals

No multi-user permissions. No web editor: the read-only status page of `darius serve` is the only web surface; editing from a web UI waits for the central server, which is not decided. No event sourcing, CRDTs or vector clocks. No SQLite. No compiled binaries. No bucket versioning requirement. No hosted S3 dependency. No compaction in v1. No rewrite of the Work Loop skills beyond the two that edit markdown. No scheduler inside darius: systemd and a future central server own timing.

## Decision table

| # | Question | Decision | Why | Rejected |
|---|---|---|---|---|
| 1 | Event log vs files canonical; how agents write | Item files for definitions, append-only per-host ledgers for everything that happens. Agents write via CLI only, hook denies direct edits | Union-merge ledgers plus one lease give the needed guarantees with a tenth of the code | Event log with HLC and SQLite projection (over-built); markdown-only with ETag sync (status stays stored text) |
| 2 | Big bang vs strangler | Strangler by kind behind the old verbs, shim at the old path | Every phase is testable against `tracker` output; the legacy sweep keeps working | One-shot import and switch (breaks 64 call sites and the daily sweep on one day) |
| 3 | Where the app lives | New repo `AltanS/darius`, the sibling project's standards; plugin folder inside it; marketplace points there | CLI and skills version together; installable without the marketplace | Stay in the legacy tracker plugin (plugin-relative paths, no `setup`, Node-only) |
| 4 | Which bucket | Self-hosted SeaweedFS on the operator's workstation (the lead host) over the tailnet (operator ruling, 2026-09-28), reusing the rootless `seaweedfs.service` user unit of a sibling project | Already run and tested there; bodies hold internal notes; only `IfNoneMatch:*` needed; the lead host also runs the timer. Other hosts work offline when it is off and sync when it is back | Hosted S3 (third party holds internal notes); another agent's server (always on, but it is not the operator's box) |
| 5 | Git after the switch | State leaves git; `.darius.toml` marker committed; opt-in `export` | Git was the collision source and a 33 MB repo tax | Keep `.tracker/` gitignored in the repo (worktrees diverge, shared checkout still collides) |
| 6 | v1 scope | Rituals, runs, vigils, notes, evidence, sync, runner, minimal TUI; milestones and specs in phase 4 | Scheduling is the trigger; the old CLI serves specs meanwhile | Everything at once (delays the timer by months) |
| 7 | Policy enforcement | Three layers: prompt, `PreToolUse` hook running `darius policy-check`, scoped credentials in the timer unit | A prompt alone is a request, not a gate | Prompt only; or a sandbox VM per run (later, not v1) |
| 8 | Vigil execution | darius runs vigil Commands itself on a daily timer, no LLM; auto-closes `held` only; event gates auto-fire only through a `gate_command` | A vigil check is a shell command, so it needs a sweep, not an agent. the legacy rules are measured, so they are ported, not reinvented | An agent per vigil (cost, no gain); auto-closing `failed` (a precondition miss would read as a broken guard) |
| 9 | What the repo holds vs the bucket (2026-09-28) | The repo holds `.darius.toml`: `v`, `project`, optional `max_mode`. The bucket holds definitions and facts. Checkout paths live per host in `links.toml` (`darius link`). Which host sweeps is decided by a daily lease per project, not by config | Identity and limits need review and history; facts and definitions need one writer and sync. A host name in the repo would tie a public repo to a machine and need a commit to change laptops | `runner = "<host>"` in the repo (host names in git, a commit per machine change); definitions or vigil Commands in git (two writers, no merge rule, agents could not add vigils); repo defaults for new rituals (an agent's `ritual add` would start on the timer unseen); links in `config.toml` (read-only under home-manager) |

| 10 | Harness independence (2026-09-28) | A harness adapter and a surface adapter behind one contract. One gate, `darius policy-check`, judges every tool call of every harness; harness allowlists are a second layer. Named profiles, resolved item, then repo `.darius.toml` (v2), then store-wide `_global`, then built in. `max_mode` still caps every profile | The operator wants any harness and a watchable run. Probes show all four harnesses have a pre-tool gate that holds with permissions skipped, and all four pass the env the run protocol needs | Translating the policy into each harness's own permission rules (four rule languages, Codex drops per-run hooks silently, opencode and pi have no pattern rules); a watched run as a separate mode (more code, no gain) |
| 11 | Subagents in unattended runs (2026-09-30) | A ritual opts in by naming `Agent` in `may`. The gate judges every subagent call by the same policy (scope `full`), denies nesting, `isolation` and a subagent's `run complete`. Granted per run only after the gate check of that harness version saw the gate judge a subagent on this host | The fact check's skill needs an independent second verification. The hook fires inside subagents, but a subagent ignores the parent's `--disallowedTools` when permissions are skipped, so the gate must be the judge | Always deny (the first unattended fact check could not verify its CRITICAL); allow in gated mode through the allowlist (no proof that subagents keep the parent's permissions) |
| 12 | Run results (2026-09-30) | Findings end with one fenced `darius-result` JSON block; darius checks it, stores it apart from the markdown, and keeps its counts on the ledger line. Required for every run darius launches; optional but checked for a by-hand run. A complete run with questions waits on the "needs you" lists until `run ack` records the decision | The web app and the TUI can draw a result, and a question for the operator no longer hides in prose | A second heredoc or a result file (refused by the gate, `Write` denied); JSON with the markdown inside (hard for a model); a schema per ritual (one generic shape first); an `answer` verb for complete runs (no session to resume) |
| 13 | Ritual handoff (2026-09-30) | A run's result may carry `handoff`, one line of at most 200 characters, refused when longer. darius keeps it on the ledger line and puts it, with the operator's `run ack` note and the questions it answers, at the top of the next run's prompt. The source is the latest run with a result | Carry-over by instruction ("read yesterday's run first") depends on the model doing it, and the operator's decisions on a complete run reached no run at all | A free-length note or a file per ritual (grows into a second findings); clipping (a cut note can lose its meaning); the model reading `run show` itself (not certain); a note the operator writes by hand (the ack note covers it) |
| 14 | Alerts (2026-09-30, Web Push since 0.31.0) | Phone notifications for held runs, questions, failures, failed gate checks and failing skips, by Web Push to the installed web app, encrypted per device with WebCrypto. The host that wrote the line or ran the batch sends; `alert.sent` and `alert.failed` in the ledger keep a key from going out twice and retry three times. VAPID keys per host in `push.json` (0600); devices as `push.*` lines in `_global` | The operator wants to hear only what needs them, on their phone, from both hosts, without duplicates, and a tap should open the run | Telegram (0.29.0: a third party stores the text, answers need a bot); a lease per alert (the origin host already makes each alert unique); the webhook digest (noisy, not a phone channel); the `web-push` package (a runtime dependency for two RFCs WebCrypto covers) |
| 15 | How sessions learn darius (2026-09-30, 0.38.0) | One generated skill file, `darius skill`: static rules plus a verb table from the registry (only commands marked `audience: "session"`), under 4 KB, stamped with version and hash. User-level install (`darius skill install`, `~/.claude/skills/darius/`); `setup` refreshes only a stamped file. One opt-in SessionStart hook, `darius due --brief`, which the operator pastes from `darius skill hook`. No other hooks before phase 5 | A session must know which kinds darius owns today and must never edit store files; one short file keeps that true for every project on the host, and a generated table cannot drift from the CLI | A hand-written skill per project (drifts); a settings.json writer (edits the operator's config); more hooks now (the router still serves the other kinds) |

Decision 9 is amended by 10: the repo may also hold harness profiles and defaults. They choose how an agent runs, never whether it may run or how far, so the reason 9 rejected repo defaults (a ritual starting on the timer unseen) does not apply.

Operator rulings, 2026-09-28: SeaweedFS on the lead host. Public name `darius`. `act` mode allowed from day one, opt-in per ritual. Vigils are auto-executable.
