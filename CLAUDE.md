# CLAUDE.md: working agreement for this repo

**darius** (repo `AltanS/darius`) is a project tracker for
agent-driven work: milestones, specs, recurring rituals, one-shot vigils, and the evidence that
checks passed. It replaces the legacy `tracker` plugin, and must stay backwards compatible with it
during migration. Bun + TypeScript, no build step, zero runtime dependencies.

**Deferred features live in [`docs/backlog.md`](docs/backlog.md)** (spend caps, more harness adapters,
web writes, the central server). Do not build them before the migration is done; when one is
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
  `make next` runs this checkout as the next lane on port 4748 (hot reload, the real store,
  read-only; `demo=1` for demo data with every state, `serve=1` for `bin/darius serve`), next to
  the installed stable lane on 4747. `make status` shows both, `make down` stops next only.
  Host-specific values (public URL, proxy, devices) live in `~/.config/darius/{web,next}.env`,
  never in the repo: the repo is public. `bun run web:dev` still runs the dev server in the
  foreground (port 5747).
  The app reads darius only through the `WebContext`, imports `src/` with `import type` only, and
  never renders store text as HTML (`dangerouslySetInnerHTML` is banned).
- **Three gates, all must pass:** `bun run lint && bun x tsc --noEmit && bun run test` (`make check`).
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
Until phase 5 retires the router:

- A `--json` field that the old CLI emits is never renamed or removed. New fields may be added.
- Exit codes follow the probe contract: 0 ok, 1 refused or failed, 2 usage, 3 inconclusive
  environment.
- darius never writes to a project's `.tracker/` directory. Each kind has exactly one writer at a
  time: the legacy CLI until its phase, darius after.

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
