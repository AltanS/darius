# CLAUDE.md: working agreement for this repo

**darius** (repo `AltanS/darius`) is a project tracker for
agent-driven work: milestones, specs, recurring rituals, one-shot vigils, and the evidence that
checks passed. It replaces the legacy `tracker` plugin, and must stay backwards compatible with it
during migration. Bun + TypeScript, no build step, zero runtime dependencies.

**Deferred features live in [`docs/backlog.md`](docs/backlog.md)** (spend caps, more harness adapters,
the central server). Do not build them before the migration is done; when one is
picked up, it moves into the concept.

**Read [`docs/concept.md`](docs/concept.md) before any design change.** It is the decision record:
domain model, storage and sync, the unattended runner, the compatibility router, and the migration
phases with their done checks. If you are about to argue *why not* rather than *how*, the answer is
probably in its decision table. Change the concept in the same commit as the code that departs
from it.

## Status

darius is at phase 2 of the migration in `docs/concept.md`, with parts of later phases built. The
per-release history is in [`CHANGELOG.md`](CHANGELOG.md). `docs/plan-tonight.md` records what the
first build produced and why; `scripts/acceptance.sh` proves an install.

**Scope rule** (operator ruling 2026-09-29): until phase 5, only migration-phase work and fixes from
real use; see `docs/concept.md`, "Migration plan".

## Build / run

- **No build step and no compiled binary.** `bin/darius` resolves its symlink chain and execs
  `scripts/run.sh cli`, which runs `src/cli.ts` directly. `bun build --compile` staples the whole
  runtime onto the bundle (91 MB for kilobytes of code); do not ship one.
- **Both runtimes are supported and both must keep working.** Bun is preferred, Node >= 22.6
  otherwise. Two rules keep that true: (1) every runtime difference goes in `src/runtime.ts`; no
  `Bun.*` or Node-only global may appear anywhere else in `src/`. (2) `erasableSyntaxOnly` is on,
  because Node strips types rather than compiling them: no enums, namespaces, or constructor
  parameter properties. Check both: `DARIUS_RUNTIME=node ./bin/darius --version` and
  `DARIUS_RUNTIME=bun ...`.
- **Zero runtime dependencies.** The S3 client is hand-rolled SigV4 over `fetch`, storage is
  markdown and JSONL files, the TUI is plain ANSI. Adding a runtime dependency needs a concept change first. The web app's
  packages are build-time only: they are bundled into `web/build/`, and the CLI never loads them.
- **Nix is additive.** `flake.nix` and `nix/` package the same source: no build step there either.
  Since 0.17.0 hosts install the app (`scripts/install.sh`, `darius update`), not the Nix package;
  the package, the module and the VM test go in 1.0.0, the dev shell stays.
  A change to `nix/`, `systemd/`, `scripts/run.sh` or `src/cli/setup.ts` also needs
  `nix flake check` on a Nix host. It runs the suite in the build sandbox (no
  `/usr/bin/env`, multi-call coreutils: write test shebangs with a full path) and a NixOS VM test
  that runs every timer unit for a home-manager install and for a checkout.
- **Never write a `/nix/store` path into anything that outlives a process** (a unit file, a link,
  config): garbage collection deletes it. Use a profile path; `src/core/unit-path.ts` drops store
  paths for this reason.
- **The web app is the one build step, and it runs on the dev machine only.** `web/` has its own
  `package.json`, `bun.lock` and `node_modules` (`cd web && bun install`). After any change to a
  build input (`web/app`, `web/server`, `web/public`, the web configs, `src/web/api.ts`; the list is
  `WEB_INPUTS` in `web/source-hash.ts`), run `bun run web:build` and commit `web/build/` with the
  source. The build typechecks the app first. `test/web-build.test.ts` fails on a stale build.
  The two web lanes (stable on port 4747, next on 4748) and their make targets live in the private
  workspace repo, not here. Host-specific values (public URL, proxy, devices) live in
  `~/.config/darius/{web,next}.env`, never in the repo: the repo is public. `bun run web:dev` runs
  the dev server in the foreground (port 5747).
  The app reads darius only through the `WebContext`, imports `src/` with `import type` only, and
  never renders store text as HTML (`dangerouslySetInnerHTML` is banned).
- **Three gates, all must pass:** `bun run lint && bun x tsc --noEmit && bun run test` (`bun run check`).
  Lint is oxlint 1.78 plus the vendored anti-slop rules in `tools/oxlint/` at `--max-warnings 0`.
  Typecheck is TypeScript 7 strict with `noUncheckedIndexedAccess` and `noUnused*`.
- **The suite is Node's built-in runner** (`node:test`). `scripts/test.sh` points
  `DARIUS_STATE_DIR` and `DARIUS_CONFIG_DIR` at a throwaway directory. A test must never read or
  write the operator's real store under `~/.local/share/darius` or a real bucket, and never reach
  the operator's live herdr (the script points `DARIUS_HERDR` at a missing file; herdr tests use a
  fake, real proofs use `herdr --session <name>`), nor the real tailnet (`DARIUS_TAILSCALE` points
  at a missing file). The script then runs the CLI under both runtimes.

## Backwards compatibility: MANDATORY

The old `tracker` CLI is called from many Claude Code skills and hooks, from an unattended daily
sweep script, and from project CLAUDE.md files.
Rules for the legacy verbs:

- A `--json` field that the old CLI emits is never renamed or removed. New fields may be added.
- Exit codes follow the probe contract: 0 ok, 1 refused or failed, 2 usage, 3 inconclusive
  environment.
- Each kind has one writer module, per project. The marker's `kinds` says which kinds the store
  owns (default `["ritual"]`). A kind it lists is written by the store code only. A kind outside it
  is written by `src/legacy/` only, and only under `.tracker/` in the checkout. In a project whose
  marker lists `milestone`, the legacy engine writes only the store's working copy, which the
  router hands it in `DARIUS_TRACKER_ROOT` (the checkout in `DARIUS_CHECKOUT_ROOT`), native code
  records and applies the file versions, and nothing is written to git. Otherwise darius native
  code never writes `.tracker/` files, and the legacy tree never writes the store.
- **Store mode has no `.tracker` link** (0.78.0, operator ruling 2026-10-08). darius never creates
  or reads a `.tracker` path in a store-mode checkout. One resolver finds the tree from the marker:
  `src/core/tracker-root.ts` for native code, `src/legacy/lib/tracker-root.ts` for the engine.
  Never add code that walks up for `.tracker` in store mode or derives the checkout as "the parent
  of `.tracker`". The next verb removes an old link into this project's own store tree (never a
  real folder, never a foreign link); darius does not edit `.gitignore`.
- `src/legacy/` is the vendored legacy CLI, frozen. It has carve-outs (its own oxlint and tsconfig
  settings, dev dependencies only), and `bun run test:legacy` is a gate next to `bun run check`.
  Milestones, specs and worklogs stay in `.tracker/` in git, unless the project's marker lists
  `milestone` in `kinds` (0.67.0, operator ruling 2026-10-05): then the store owns the tree and the
  checkout has no `.tracker` path (0.78.0). `darius onboard` moves a repo; git mode is deprecated.

## Versioning: MANDATORY

SemVer, enforced. The version lives in `package.json` (canonical), `src/version.ts`, and the newest
numbered `## [x.y.z]` heading in `CHANGELOG.md`. Before committing any functional change (anything
under `src/`, `scripts/`, `bin/`, `plugin/`):

1. Bump all three to the same number. PATCH: the code now does what it was meant to do. MINOR:
   something new, existing setups untouched. MAJOR: the operator must change something (a flag,
   a config key, the store format).
2. Add a `CHANGELOG.md` entry under `## [x.y.z] - YYYY-MM-DD` (Added / Changed / Fixed), one line
   per change, real date.
3. Run `scripts/check-version.sh`; it must print `✓`.

Doc-only changes do not need a bump. Tag each shipped version:
`git tag -a vX.Y.Z -m "darius X.Y.Z" && git push --follow-tags`.

## Prose

User-facing strings and docs: plain, direct, short sentences, active voice, no em dashes, no
marketing words.
