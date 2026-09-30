# Plan for the unattended build night, 2026-09-28

Architect: Fable. Coordinator executes through workers and verifies. Read `docs/concept.md` first;
this plan only decides what the concept left open for tonight and cuts the work into tasks that
never share a file.

## Goal by morning

The operator wakes up to: repo with green gates, `darius setup` done on host-a, SeaweedFS running
on `127.0.0.1:9910` and `100.64.1.10:9910`, sync round-trip proven, acme-web rituals
imported read-only, a test project with rituals and vigils swept and run once through `run-due`,
timers enabled. `scripts/acceptance.sh` proves all of it in one run.

## Safety rules for every worker

- Never write under any project's `.tracker/`. `darius import` opens those files read-only.
- Never touch the other SeaweedFS on this host (its `~/.config/systemd/user/seaweedfs.service` and port 9900).
- Never bind `0.0.0.0`. Bind `127.0.0.1` and `100.64.1.10` only.
- Tests run with `DARIUS_STATE_DIR` and `DARIUS_CONFIG_DIR` set to a throwaway dir (`scripts/test.sh` does this). A test that needs S3 starts its own SeaweedFS container on a free port and removes it, like a sibling project's S3 test helper.
- No production system is touched. The only `claude -p` run tonight is the selftest heartbeat: model `haiku`, `--max-turns 6`, `report` mode.
- Every worker runs the three gates on its own files before reporting: `bun run lint && bun x tsc --noEmit && bun run test`.

## Decisions that block the build (final for tonight)

### Data formats

**Item file.** Markdown. Frontmatter is a YAML subset: `key: scalar`, `key:` followed by `- item` lines, one level of nested map (`policy:`), double-quoted strings, ISO dates as plain scalars. Anything else is a parse error that names the file. Body sections keep today's grammar byte for byte so import does not rewrite bodies.

Ritual frontmatter keys: `id, kind: ritual, slug, title, created, updated, cadence, anchor, agent, owner, tags, imported_from, policy.{mode,may,hold,notes,model,max_turns}`.
Vigil frontmatter keys: `id, kind: vigil, slug, title, created, updated, from, due, until, gate_command, heavy, agent, tags, imported_from`.
Checklist grammar in bodies: `- [ ] text`, then indented `- Command: \`...\`` and `- Expected: \`...\``. Expected forms: `exit N`, `stdout contains "x"`, `stdout matches /re/f`, `file exists path`, `manual (owner: X, expires: YYYY-MM-DD)`. Same as the old CLI (`cli/lib/verification/grammar.ts`).

**Ledger line.** One JSON object per line:

```json
{"v":1,"id":"01J...ULID","at":"2026-09-28T03:14:15.000Z","host":"host-a","who":"owner|timer|claude:<session>|import","project":"darius-selftest","type":"run.completed","item":"ritual/heartbeat", "...":"payload"}
```

`id` is a ULID whose time part equals `at`. Sort by `id`. Types tonight:
`ritual.lifecycle{state}`, `ritual.rescheduled{due}`, `run.started{run}`, `run.held{run,questions[]}`, `run.answered{run,n,text}`, `run.resumed{run}`, `run.completed{run,outcome,findings_sha,session_id?}`, `vigil.swept{outcome,checks[],gate}`, `vigil.closed{verdict,by}`, `evidence{check,exit,outcome,output_sha,duration_ms,run?}`, `item.changed{sha_before}`, `conflict{sha_lost}`, `import{source,count}`.

**Host id.** `host` in config, default the short `os.hostname()`.

**ULID.** Own implementation over `crypto.getRandomValues`, monotonic inside one process.

**Due computation.** `nextDue = max(lastCompleted + cadence anchored per `anchor`, latest ritual.rescheduled.due after lastCompleted)`. Lifecycle from the latest `ritual.lifecycle` line, default `active`. `paused` and `retired` are never due. A ritual whose latest run is `held` is shown as held, not due.

### Config and paths

```
~/.config/darius/config.toml
host = "host-a"

[remote]
endpoint = "http://127.0.0.1:9910"      # other hosts: http://100.64.1.10:9910
bucket = "darius"
region = "us-east-1"
path_style = true
allow_http = true                        # loopback or tailnet (100.64.0.0/10) only; refused elsewhere
sse = true
credentials = "~/.config/darius/credentials"

[notify]
webhook = ""                             # empty: report goes to stdout (the journal)

~/.config/darius/credentials             # 0600, AWS ini shape: [default] aws_access_key_id / aws_secret_access_key
~/.local/share/darius/<project>/         # store, layout per concept
```

TOML parser: flat tables, strings, booleans, integers. Nothing else. Env overrides `DARIUS_CONFIG_DIR`, `DARIUS_STATE_DIR`, `DARIUS_PROJECT`. Project resolution: `--project`, else `DARIUS_PROJECT`, else walk up for `.darius.toml`, else refuse with exit 2. No `.darius.toml` is written into any repo tonight.

TLS is deferred. The tailnet is WireGuard; `allow_http` is limited to loopback and `100.64.0.0/10` by code, not by convention. This amends the concept's "HTTPS unless loopback" line.

### SeaweedFS on the lead host

- User unit `darius-seaweedfs.service`, rootless podman, same digest-pinned image as the other SeaweedFS unit on this host, `Type=notify`, `Restart=always`, `-config_dir=/etc/sw` before `server`, `ExecStartPost` curl on `/status`. Copy that unit's shape, change names, paths and ports.
- Publish `-p 127.0.0.1:9910:8333 -p 100.64.1.10:9910:8333`. Nothing else.
- State under `~/.local/share/darius-seaweedfs/{config,data}`, config dir 0755, files 0644 (rootless bind-mount rule). Its own `containers-override.conf` with `keyring=false`.
- `identity.json` with two admin identities `darius-host-a` and `darius-host-b`, keys from `openssl rand`. `security.toml` with an SSE KEK. Generated once, never rotated by re-run, never printed.
- host-a's key goes to `~/.config/darius/credentials` (0600). host-b's key goes to `~/.config/darius/keys/host-b.credentials` (0600) for the operator to copy. Prefix-scoped identities are deferred.
- Bucket `darius`, created by `darius setup --remote` via `CreateBucket` if `HeadBucket` fails.

### S3 client operations

`PutObject` (headers: `If-None-Match: *` optional, `x-amz-server-side-encryption: AES256` when `sse`, signed payload sha256), `GetObject`, `HeadObject`, `DeleteObject`, `ListObjectsV2` (prefix, continuation token, XML picked out with a small tag scanner, no XML library), `HeadBucket`, `CreateBucket`. Path-style URLs. A `412` on a conditional put returns `{conflict: true}`, never throws. Every other non-2xx throws with status and the first 300 bytes of body.

### Sync (v1, as small as it gets)

1. Pull. List `<project>/ledger/`; fetch every chunk key not in `sync.json.seen`; write it under `ledger/<remote-host>/`; record it. Fetch `<project>/manifest.json`. For each item: if remote sha equals local, skip. If only remote changed since `sync.json.base[item]`, write it locally. If both changed, the newer `updated` wins; the loser's body goes to `blobs/<sha>` and a `conflict` line is appended.
2. Push. Rename `ledger/<host>/open.jsonl` to `<ulid>.jsonl` and `PutObject` with `If-None-Match: *`. On failure the file stays and is retried next time. Take `<project>/lease.json` (`If-None-Match: *`, `{holder, expires: now+60s}`). If it exists and is expired, delete and retry once. If still held, stop with exit 3 and a message. Put changed items, put `manifest.json`, delete the lease.
3. `sync --all-projects` loops over the store directory. Exit 0 when every project synced, 3 when any was skipped for the network or lease, 1 on a real error.

### Import (read-only)

Source `<repo>/.tracker/`. Target project name from `--project`. Mapping:

| Source | Target |
|---|---|
| `rituals/<slug>/ritual.md` frontmatter `name, cadence, agent, owner, started` | item `rituals/<slug>.md` with `title, cadence, agent, owner, created`; `anchor: due`; `policy.mode: off`; `imported_from` path |
| `last_run` | synthetic `run.started` + `run.completed{outcome:"complete"}` at that date, `who: import` |
| `due` when it is not `last_run + cadence` | `ritual.rescheduled{due}` |
| `status: retired` or `paused` in frontmatter | `ritual.lifecycle{state}` |
| body | kept whole except `## Findings` section; the 143 KB `fact-check-cycle` body is kept whole tonight, splitting into runs and notes is deferred |
| `rituals/<slug>/runs/<date>.md` | `run.started` + `run.completed`, findings body as blob |
| `.verification-log.jsonl` (5041 lines) | one `evidence` line each, `check: "<spec>#<index>"`, `at` from the source, `who: import` |
| `vigils/*.md` | not imported tonight; vigils stay legacy until phase 3 (concept). `--include-vigils` is a later flag |

Import is idempotent: a second run on the same source writes nothing new (it keys on `imported_from` plus source date). Import writes one `import{source,count}` line.

### Sweep, runner, timers

- `darius vigil sweep` rules are in the concept section "Vigil auto-execution". It runs on the selftest project tonight and on nothing else.
- `darius run-due --unattended` launches `claude -p` per the concept. The hook `darius policy-check` is included tonight in its minimal form: read the PreToolUse JSON on stdin, deny a `Bash` command that matches a `hold` regex from the run's policy file at `$DARIUS_RUN_POLICY`, record `run.held`. `report` mode passes `--allowedTools` from `policy.may` plus `Read,Grep,Glob` and `--disallowedTools Write,Edit,NotebookEdit,WebFetch,WebSearch`.
- Systemd user units, installed by `darius setup --systemd` from templates in `systemd/`:

| Unit | Schedule | Command |
|---|---|---|
| `darius-seaweedfs.service` | always | podman, per above |
| `darius-sync.timer` | `*:0/15` | `darius sync --all-projects --json` |
| `darius-vigil-sweep.timer` | `06:30` local, `Persistent=true` | `darius vigil sweep --all-projects --json` |
| `darius-run-due.timer` | `*:05` hourly, `Persistent=true` | `darius run-due --unattended --json` |

Service units are `Type=oneshot` with `Environment=PATH=%h/.local/bin:%h/.bun/bin:/usr/local/bin:/usr/bin`. No secrets in units.

### Test project `darius-selftest`

Created by `darius selftest seed` (idempotent). Contents:

| Item | Purpose | Expected tonight |
|---|---|---|
| ritual `heartbeat`, cadence `1d`, `policy.mode: report`, `model: haiku`, `max_turns: 6`, `may: ["Bash(darius *)", "Bash(date)"]`, `hold: ["git push", "rm -rf"]`, procedure: run `darius --version` and `date`, then `darius run complete <run> --outcome complete --findings-stdin` | proves `run-due` and `claude -p` | one `run.completed` line, `who: timer` or the acceptance caller |
| vigil `date-held`, `due` yesterday, check `true` / `exit 0` | auto-close path | `vigil.closed{verdict:"held", by:"sweep"}` |
| vigil `date-failed`, `due` yesterday, check `test -f /nonexistent` / `exit 0` | failure stays armed | `vigil.swept{outcome:"failed"}`, no `vigil.closed`, listed as flagged |
| vigil `event-gated`, `until: "selftest marker exists"`, `gate_command: test -f $DARIUS_STATE_DIR/darius-selftest/fired.marker`, check `true` / `exit 0` | gate semantics | first sweep: `gate: "not-fired"`, nothing else; after the marker: `vigil.closed held` |
| vigil `heavy-one`, `heavy: true`, check `sleep 1` / `exit 0` | heavy opt-in | default sweep: bucket `heavy`, no execution; `--include-heavy`: closes `held` |
| vigil `mixed-manual`, one exec `true` / `exit 0` plus one `manual (owner: owner, expires: 2027-01-01)` | mixed rule | `vigil.swept{outcome:"awaiting-manual"}`, stays armed, not flagged as failed |

### Deferred past tonight

TUI (all screens). The `tracker.mts` router and `tracker-legacy.mts`. Plugin move to `plugin/`. `note add`. `export` and the nightly `darius-state` backup. Compaction. Splitting `fact-check-cycle` into runs and notes. TLS on the endpoint. Prefix-scoped S3 identities. host-b install (the acceptance run prints the three commands). `run resume` through `--resume`. Import of vigils and of milestones and specs.

## Module contracts

Workers code to these. A change to a contract goes through the coordinator and lands in this file first.

```ts
// src/core/model.ts (T1)
export type Kind = "ritual" | "vigil";
export interface ItemHeader { id: string; kind: Kind; slug: string; title: string; created: string; updated: string; tags: string[]; imported_from?: string }
export interface Policy { mode: "off" | "report" | "act"; may: string[]; hold: string[]; notes?: string; model?: string; max_turns?: number }
export interface Ritual extends ItemHeader { kind: "ritual"; cadence?: string; anchor: "due" | "completion"; agent?: string; owner?: string; policy: Policy }
export interface Vigil extends ItemHeader { kind: "vigil"; from?: string; due?: string; until?: string; gate_command?: string; heavy: boolean; agent?: string }
export type Item = Ritual | Vigil;
export interface Document<T extends Item = Item> { header: T; body: string }
export interface LedgerLine { v: 1; id: string; at: string; host: string; who: string; project: string; type: string; item?: string; [k: string]: unknown }

// src/core/frontmatter.ts (T1)
export function parseDocument(text: string, file: string): { header: Record<string, unknown>; body: string }
export function serializeDocument(header: Record<string, unknown>, body: string): string

// src/core/ulid.ts (T1)
export function ulid(now?: number): string; export function ulidTime(id: string): number

// src/core/paths.ts (T1)
export function configDir(): string; export function stateDir(): string; export function projectDir(project: string): string
export function resolveProject(flag?: string, cwd?: string): string   // throws UsageError

// src/core/config.ts, credentials.ts (T2)
export interface Config { host: string; remote?: { endpoint: string; bucket: string; region: string; path_style: boolean; allow_http: boolean; sse: boolean; credentials: string }; notify: { webhook: string } }
export function loadConfig(): Config; export function writeConfigSkeleton(): "written" | "exists"
export function loadCredentials(path: string): { accessKeyId: string; secretAccessKey: string }

// src/core/store.ts (T3)
export interface Project { name: string; root: string; listItems(kind: Kind): string[]; readItem<T extends Item>(kind: Kind, slug: string): Document<T> | null; writeItem(doc: Document, opts?: { who: string }): void; withLock<R>(fn: () => R): R }
export function openProject(name: string, opts?: { create?: boolean }): Project; export function listProjects(): string[]

// src/core/ledger.ts (T3)
export function appendLine(project: Project, line: Omit<LedgerLine, "v" | "id" | "at" | "host" | "project">): LedgerLine
export function readLedger(project: Project): LedgerLine[]            // all hosts, all chunks, sorted by id
export function linesFor(ledger: LedgerLine[], item: string): LedgerLine[]

// src/core/s3.ts (T4)
export interface S3 { put(key: string, body: Uint8Array | string, o?: { ifNoneMatch?: boolean; contentType?: string }): Promise<{ etag: string } | { conflict: true }>; get(key: string): Promise<{ body: Uint8Array; etag: string } | null>; head(key: string): Promise<{ etag: string; size: number } | null>; del(key: string): Promise<void>; list(prefix: string): Promise<{ key: string; etag: string; size: number }[]>; ensureBucket(): Promise<"exists" | "created"> }
export function createS3(cfg: NonNullable<Config["remote"]>, creds: { accessKeyId: string; secretAccessKey: string }): S3

// src/core/sync.ts (T5)
export interface SyncReport { project: string; pulledChunks: number; pushedChunks: number; itemsPulled: number; itemsPushed: number; conflicts: string[]; skipped?: "offline" | "lease-held" }
export function syncProject(project: Project, s3: S3, cfg: Config): Promise<SyncReport>

// src/core/due.ts (T6a)
export interface RitualState { slug: string; lifecycle: "active" | "paused" | "retired"; lastCompleted?: string; nextDue?: string; isDue: boolean; overdueDays: number; heldRun?: string; openRun?: string }
export function ritualState(doc: Document<Ritual>, ledger: LedgerLine[], today: string): RitualState
export function rollCadence(from: string, cadence: string): string   // "1d" | "2d" | "7d" | "1w" | "2w" | "1m"

// src/core/checks.ts (T8)
export interface Check { index: number; text: string; command?: string; expected?: string; manual?: { owner: string; expires: string } }
export function parseChecklist(body: string): Check[]
export function classifyCommand(cmd: string | undefined): "none" | "noop" | "exec"
export type Expectation = { kind: "exit"; code: number } | { kind: "stdout-contains"; needle: string } | { kind: "stdout-matches"; pattern: RegExp } | { kind: "file-exists"; path: string }
export function parseExpectation(raw: string): Expectation | { error: string }
export function runCheck(check: Check, o: { cwd: string; timeoutMs: number; env?: Record<string, string> }): Promise<{ exit: number | null; outcome: "pass" | "fail" | "timeout"; output: string; durationMs: number }>

// src/core/sweep.ts (T9)
export interface SweepResult { project: string; date: string; vigils: { slug: string; bucket: "closed" | "no-command" | "manual-only" | "mixed" | "heavy" | "event-gated" | "date-gated" | "runnable"; gate: "n/a" | "fired" | "not-fired"; outcome?: "held" | "failed" | "awaiting-manual" | "skipped"; closed: boolean; checks: { index: number; outcome: string; exit: number | null }[] }[] }
export function sweepProject(project: Project, o: { includeHeavy: boolean; classifyOnly: boolean; dryRun: boolean; today: string }): Promise<SweepResult>

// src/cli/registry.ts (T13)
export interface Command { name: string; summary: string; run(args: ParsedArgs): Promise<number> }
export interface ParsedArgs { positional: string[]; flags: Record<string, string | boolean>; json: boolean; stdin?: string }
export function register(cmd: Command): void
```

Every command prints one JSON object on stdout when `--json` is set and nothing else on stdout. Human text goes to stdout without `--json`, errors to stderr in both modes.

## Coordinator notes (added during the build, binding for later tasks)

- **Command modules export, never register.** `src/cli/<name>.ts` exports its `Command` objects. Only `src/cli/commands.ts` imports and registers them; the coordinator wires new ones there. A worker never edits `commands.ts`.
- **Boolean flags.** `src/cli/args.ts` has a `BOOLEAN_FLAGS` set: a listed flag never takes the next token as its value. A task that introduces a new boolean flag reports it; the coordinator adds it.
- **`UsageError`** lives in `src/core/model.ts`; `src/cli/registry.ts` re-exports it. Throw it for exit 2.
- **`ParsedArgs.repeated`** holds every value of a repeated string flag (`--question a --question b`).
- **`JsonValue`**: `LedgerLine`'s index signature is `JsonValue | undefined`, not `unknown` (anti-slop `no-unsafe-dictionary-type`).
- **Local dates.** Any `at` written for a date-only source (import) is local noon of that date, so its local date never shifts in a zone west of UTC (T6a finding).
- **Retry cap.** A failed run keeps a ritual due (T6a). The hourly `run-due` must not relaunch a ritual whose latest run failed today; it waits for the next due date or an operator (T10).
- **S3** (`src/core/s3.ts`): `S3Error{status}` for non-2xx, `S3NetworkError` for no response (maps to `skipped: "offline"`), 412 on `If-None-Match:*` verified on the pinned image. `RemoteConfig`/`Credentials` types are exported from `s3.ts`.
- **Checks** (`src/core/checks.ts`): `runCheck` throws for a check with no Command, a manual item, or an unparsable Expected; classify first. `bash -lc` costs about 0.5 s per check.
- **No-op checks never close a vigil.** `true`, `:` and `echo` classify as no-ops (T8), so a selftest check that must pass uses `test 1 = 1`, never `true` (T9 finding, binding for T12). A check whose last stage is `| head`/`| wc` under `Expected: exit N` is `masked` and never runs.
- **Real host state now:** `darius-seaweedfs.service` active, bucket `darius` created, `~/.config/darius/config.toml` has the `[remote]` block, `~/.local/bin/darius` linked. Timers are NOT enabled yet.

## Tasks

Tier: **opus** for judgment-heavy, **sonnet** for mechanical. "Parallel group" tasks share no files and can start together. A task lists every file it owns; a worker that needs a change elsewhere reports it to the coordinator instead of editing.

### Group A (start now, all parallel)

**T1 model, frontmatter, ulid, paths.** sonnet. Owns `src/core/model.ts`, `src/core/frontmatter.ts`, `src/core/ulid.ts`, `src/core/paths.ts`, `test/frontmatter.test.ts`, `test/ulid.test.ts`, `test/paths.test.ts`. Done when: `bun test/frontmatter.test.ts` round-trips a ritual and a vigil header byte for byte, rejects a nested list with the file name in the error, and 10 000 ULIDs from one process sort strictly ascending.

**T2 config and credentials.** sonnet. Owns `src/core/config.ts`, `src/core/credentials.ts`, `test/config.test.ts`. Done when: the config above loads, `allow_http` with `endpoint = "http://1.2.3.4:9910"` is refused with the message naming the rule, and a credentials file with mode 0644 is refused.

**T4 S3 SigV4 client.** opus. Owns `src/core/s3.ts`, `test/s3.test.ts`, `test/helpers/seaweedfs.ts` (podman helper on a free port, no AWS SDK). Done when: against the container, put with `ifNoneMatch` succeeds once and returns `{conflict:true}` the second time, `list` pages over 1200 keys, SSE header is accepted with the KEK configured, and `head` on a missing key returns null. Skips loudly with exit 3 text when podman is missing.

**T8 checks: checklist grammar, no-op classifier, executor.** opus. Owns `src/core/checks.ts`, `test/checks.test.ts`. Port `parseExpectation` from the legacy tracker plugin's verification grammar and the pipeline-aware no-op classifier described in the concept (split at `|`, `||`, `&&`, `;`, newline, honouring quotes, `$( )` and backticks; drop `cd` stages; no-op only when every stage is a no-op). Executor: `bash -lc`, own process group, kill the group on timeout, capture the last 4 KB of combined output. Done when: the four Expected forms evaluate, `echo x | real-cmd` is `exec`, `cd . && echo todo` is `noop`, and a `sleep 30` check with a 500 ms timeout returns `timeout` in under 2 s with no orphan process (`pgrep -f` shows none).

**T11 SeaweedFS unit, systemd templates, setup command.** sonnet. Owns `scripts/seaweedfs-install.sh`, `systemd/darius-seaweedfs.service`, `systemd/darius-sync.{service,timer}`, `systemd/darius-vigil-sweep.{service,timer}`, `systemd/darius-run-due.{service,timer}`, `src/cli/setup.ts`, `test/setup.test.ts`. `setup` steps: symlink `~/.local/bin/darius`, create `~/.config/darius/config.toml` skeleton if missing, create the state dir, `--systemd` copies units and `daemon-reload` + `enable --now` the timers (not the seaweedfs unit; the install script does that), `--remote` runs `ensureBucket` through T4 (stub the call behind an interface until T4 lands). Prints `✓ / · / !` lines, re-runnable. Done when: `scripts/seaweedfs-install.sh` on host-a leaves `systemctl --user is-active darius-seaweedfs.service` = `active`, `curl -fsS http://127.0.0.1:9910/status` and `curl -fsS http://100.64.1.10:9910/status` return 200, `ss -ltn | grep 9910` shows exactly those two binds, and `systemctl --user is-active seaweedfs.service` is still `inactive`.

**T13 CLI registry and dispatcher.** sonnet. Owns `src/cli.ts`, `src/cli/registry.ts`, `src/cli/args.ts`, `test/cli.test.ts`. Parses `--json`, `--project`, `--stdin`, `--flag value`, `--bool`. Registers commands by importing `src/cli/*.ts` modules that call `register`. Exit codes per the probe contract. Done when: `darius help` lists registered commands, an unknown command exits 2, `--json` on `help` prints one JSON object.

### Group B (after T1 and T13)

**T3 store and ledger.** opus. Owns `src/core/store.ts`, `src/core/ledger.ts`, `test/store.test.ts`, `test/ledger.test.ts`. O_EXCL lock with retry and stale-lock takeover after 30 s. `writeItem` stores the previous body under `blobs/` and appends `item.changed`. Done when: 20 concurrent `appendLine` calls from separate processes (spawned in the test) leave 20 well-formed lines, and `readLedger` returns them sorted with no duplicates when the same chunk exists under two host dirs.

**T6a due computation.** opus. Owns `src/core/due.ts`, `test/due.test.ts`. Done when: `anchor: due` with a late completion yields the schedule date not the completion date; `retired` is never due; a `rescheduled` line after the last completion wins; a `held` run suppresses `isDue`; cadences `1d 2d 7d 1w 2w 1m` roll correctly over a month boundary.

### Group C (after T3; T6b also after T6a)

**T6b ritual, run and due commands.** sonnet. Owns `src/cli/ritual.ts`, `src/cli/run.ts`, `src/cli/due.ts`, `test/ritual-cli.test.ts`. Verbs: `ritual add <slug> --title --cadence [--anchor] [--stdin]`, `ritual list|show|set|pause|resume|retire`, `run start <ritual> [--who]`, `run hold <run> --question ... (repeatable)`, `run answer <run> <n> <text>`, `run complete <run> --outcome complete|failed|abandoned [--findings-stdin]`, `run list [--open]`, `due [--all-projects]`. `run start` refuses when an open run exists (exit 1); `run complete` refuses a run that is not open (exit 1). Done when: two concurrent `run complete` on one run give exactly one exit 0 and one exit 1, and `due --json` on a seeded project shows the ritual with `isDue: true`.

**T7 import.** opus. Owns `src/core/import.ts`, `src/cli/import.ts`, `test/import.test.ts` (fixture: a small synthetic `.tracker/` under `test/fixtures/`). Read-only on the source, per the mapping table. Done when: `darius import ~/projects/acme-web/.tracker --project acme-web --json` reports 10 rituals and 5041 evidence lines, `git -C ~/projects/acme-web status --porcelain .tracker` is empty, a second import reports 0 new, and `darius due --project acme-web --json` lists the same ritual slugs as `tracker due --json` minus `cohort-assign`.

**T9 vigil commands and sweep.** opus. Owns `src/core/sweep.ts`, `src/cli/vigil.ts`, `test/sweep.test.ts`. Depends on T8. Verbs: `vigil add <slug> --title [--due] [--until] [--gate-command] [--heavy] [--from] --stdin`, `vigil list|show`, `vigil close <slug> --verdict held|failed`, `vigil sweep [--all-projects] [--include-heavy] [--classify-only] [--dry-run]`. Rules per the concept section "Vigil auto-execution". Done when: the six selftest vigils land in the buckets and outcomes of the table above, and a sweep with `DARIUS_SWEEP_ACTIVE=1` in the environment refuses with exit 1.

### Group D (after T4 and T3)

**T5 sync.** opus. Owns `src/core/sync.ts`, `src/cli/sync.ts`, `test/sync.test.ts` (uses T4's container helper). Done when: two store dirs pointing at one bucket, host A appends and syncs, host B syncs and reads the line; both edit one item, the newer `updated` wins and the loser is in `blobs/` with a `conflict` line; a held fresh lease makes sync exit 3; killing the process between chunk put and manifest put leaves no partial object (re-sync completes).

### Group E (after T5, T6b)

**T10 runner and policy hook.** opus. Owns `src/runner/run-due.ts`, `src/runner/launch.ts`, `src/runner/report.ts`, `src/cli/run-due.ts`, `src/cli/policy-check.ts`, `test/runner.test.ts` (fake `claude` binary on PATH that records its argv and prints a result JSON). Ritual lease via T4 when a remote is configured, local lock otherwise. Report to webhook or stdout. Done when: with the fake binary, `run-due --unattended --json` on the seeded selftest project starts one run, passes `--model haiku --max-turns 6 --allowedTools "Bash(darius *)" "Bash(date)"`, writes `run.completed`, and a `policy-check` invocation with a `git push` Bash command prints a deny decision and appends `run.held`.

**T12 selftest seed.** sonnet. Owns `src/cli/selftest.ts`, `test/selftest.test.ts`. `darius selftest seed [--project darius-selftest]` creates the items of the table above through the same code paths the CLI uses, idempotent. Done when: two seeds leave 1 ritual and 5 vigils, and `vigil sweep --classify-only --json` shows the expected buckets.

### Final

**T14 acceptance script and docs.** opus. Owns `scripts/acceptance.sh`, `README.md` (install section only). The script runs on host-a against the real store and bucket, in this order, and stops at the first failure with the step name:

1. `bun run lint && bun x tsc --noEmit && bun run test`
2. `darius setup --systemd --remote --json` twice; second run reports nothing new
3. `systemctl --user is-active darius-seaweedfs.service`; `curl -fsS` on both `/status` URLs; `ss -ltn` shows 9910 only on `127.0.0.1` and `100.64.1.10`; the other `seaweedfs.service` still `inactive`
4. Sync round-trip: `darius selftest seed`; `darius sync --project darius-selftest --json`; a second store dir (`DARIUS_STATE_DIR=$(mktemp -d)`) with the same config pulls and `darius due --project darius-selftest --json` shows the heartbeat ritual
5. `darius import <project>/.tracker --project acme-web --json`; compare ritual slugs with `node --experimental-strip-types --no-warnings <legacy-tracker-plugin>/cli/bin/tracker.mts due --json` run from the project root; `git status --porcelain .tracker` empty
6. `darius vigil sweep --project darius-selftest --json`: `date-held` closed held, `date-failed` failed and open, `event-gated` not-fired, `heavy-one` bucket heavy, `mixed-manual` awaiting-manual; touch the marker; sweep again: `event-gated` closed held; `--include-heavy`: `heavy-one` closed held
7. `darius run-due --unattended --project darius-selftest --json` with the real `claude`: one `run.completed` for `heartbeat` within 5 minutes; the report printed
8. `systemctl --user list-timers` shows the three darius timers enabled
9. Print the three commands for host-b: copy `keys/host-b.credentials`, write its config with `endpoint = "http://100.64.1.10:9910"`, run `darius setup --systemd`

Done when: `scripts/acceptance.sh` exits 0 on host-a.

**T15 version and changelog.** sonnet, coordinator-owned, last. Bump to `0.2.0` in `package.json`, `src/version.ts`, `CHANGELOG.md`; `scripts/check-version.sh` prints `✓`; annotated tag `v0.2.0`.

## Dependency graph

```
A: T1 T2 T4 T8 T11 T13        (parallel)
B: T3(T1,T13) T6a(T1)          (parallel)
C: T6b(T3,T6a,T13) T7(T3) T9(T3,T8)   (parallel)
D: T5(T3,T4)
E: T10(T5,T6b) T12(T6b,T9)     (parallel)
F: T14(all) then T15
```

## What the coordinator verifies, not the workers

Each task's "done when" command, run by the coordinator after the worker reports. The three gates on the whole repo after each group. The acceptance script once at the end, and its output committed as evidence.
