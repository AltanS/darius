# darius

> **Warning: darius is highly experimental. Use it at your own risk.**
>
> - A lot will change. Commands, config keys, file formats, and the store layout can break
>   between releases, with little or no notice.
> - Expect bugs and missing parts. Some features are half built.
> - darius runs agents without a human present. Those agents can change files and run commands.
>   Read what a ritual does before you let it run unattended.
> - Back up your data. Do not depend on darius for anything you cannot afford to lose.
> - The software comes with no warranty. See [License](#license).

A project tracker for agent-driven work. It tracks milestones, specs, recurring rituals, and one-shot
vigils, and it records the evidence that each check passed. State lives outside your git repo and syncs
to an S3-compatible bucket that you run. A scheduler hands due rituals to a headless Claude Code
session, and you answer held questions in a terminal UI.

**Status: experimental.** Rituals, vigils, runs, sync, snapshot backups, import of a legacy
`.tracker/`, the unattended runner, the terminal UI (the Due and Run screens), and a read-only web
status page work. Milestones and specs still run through a vendored copy of the older `tracker`
CLI, which darius calls for you. They are not native to darius yet. The design is in
[`docs/concept.md`](docs/concept.md).

## The words darius uses

- **Project**: one tracked repo. Its name comes from `.darius.toml`.
- **Ritual**: recurring work with a schedule, such as "write the daily report at 07:00". A skill
  holds the steps. darius starts a headless Claude Code session to follow them. This is a **run**.
- **Vigil**: a one-shot check that waits for a date or an event, such as "check the logs after the
  first real batch". You close it with a verdict.
- **Held question**: a run stops when it reaches something the ritual's `hold` list names. It asks
  you. You answer in the terminal UI, and the run goes on.
- **Policy**: the limits of a ritual. It sets the mode (`off`, `report` or `act`), the commands the
  run may use (`may`), and the patterns that stop it (`hold`).
- **Store**: darius's own state. It lives outside your repo, in `~/.local/share/darius`.
- **Bucket**: an S3-compatible bucket that you run. The store of every host syncs through it.
- **Host**: one machine that runs darius. Each host has its own copy of the store.

## What it looks like in use

The example below is one project, `acme-web`, on one host, `host-a`. It shows what you commit and
what stays on the machine.

### In the repo (committed to git)

```
~/projects/acme-web/
├── .darius.toml                    project name, time zone, rituals and policies
├── .claude/
│   └── skills/
│       ├── daily-report/
│       │   └── SKILL.md            the steps of one ritual
│       └── weekly-audit/
│           └── SKILL.md
├── .tracker/                       milestones, specs, worklogs and vigils
│   ├── 00-INDEX.md
│   ├── M12-checkout-redesign/
│   │   ├── 00-README.md            the milestone
│   │   └── 01-cart-page.md         one spec
│   ├── vigils/
│   │   └── guard-soak.md           a one-shot check that waits for an event
│   └── worklog/
└── src/ ...                        your own code
```

Git holds the definition of the work. A ritual is a table in `.darius.toml`. Its procedure is the
skill file. Review both like code, in a pull request.

The old `tracker` plugin is gone, but the `.tracker/` folder stays. It is the format darius still
reads and writes for milestones, specs, worklogs and vigils, and it stays in git. The `/darius-*`
skills and the `darius` command now do the work that the plugin did.

### On the host (never in git)

```
~/.local/
├── bin/
│   └── darius                      link to the installed release
├── opt/darius/
│   ├── current -> versions/v0.61.0 the live release
│   └── versions/                   one shallow clone per release
└── share/
    ├── darius/                     the store
    │   └── acme-web/
    │       ├── items/
    │       │   ├── rituals/        each ritual, mirrored from .darius.toml
    │       │   └── vigils/
    │       ├── runs/<id>/          one folder per run: prompt, policy, findings
    │       ├── ledger/host-a/      the log of what happened, in chunks
    │       ├── blobs/              older versions and large outputs
    │       └── sync.json           what this host has pulled from the bucket
    └── darius-snapshots/
        └── darius-host-a-<time>.tar.gz   the daily backup of the store

~/.config/darius/
├── config.toml                     host name, [remote] bucket, which timers run
├── credentials                     this host's bucket key (mode 0600)
└── links.toml                      project -> checkout on this host, written by `darius link`

~/.claude/                          written by `darius skill install`
├── skills/
│   ├── darius/SKILL.md             teaches a session the darius commands
│   └── darius-work/SKILL.md        one of 11 procedure skills, called /darius-work
└── agents/
    └── darius.md
```

### A normal day

1. You write a ritual in `.darius.toml` and its skill in `.claude/skills/`. You run
   `darius marker check`, then commit and push.
2. On each host, pull the commit. The run-due timer fires every 15 minutes. Each time, it copies
   the marker's rituals into the store first. You can do that by hand with
   `darius ritual reconcile`.
3. At 07:00 the timer finds `daily-report` due. It starts a headless Claude Code session in
   `~/projects/acme-web`, and the session follows the skill.
4. The run writes its findings to `runs/<id>/`. If it reaches a `hold` pattern, it stops and
   waits for you.
5. You open the terminal UI (`darius`) or the web page, read the findings, and answer held
   questions. `darius due` shows what is due now.
6. The sync timer pushes the result to the bucket, so `host-b` sees it too.

## Quick start (one host, no bucket)

You need darius installed (step 1 of [Install](#install)) and a git repo. Sync needs a bucket, but
everything below works without one.

```bash
cd ~/projects/acme-web
darius init                 # writes .darius.toml, links this checkout, creates .tracker/
mkdir -p .claude/skills/daily-report   # then write the steps in SKILL.md inside it
```

Add a ritual to `.darius.toml`:

```toml
[rituals.daily-report]
title = "Daily site report"
cadence = "1d"
at = "07:00"
skill = "daily-report"
mode = "report"
```

```bash
darius marker check                    # prints ok, or the first error with its line
git add .darius.toml .claude && git commit -m "add the daily report ritual"
darius run now daily-report --dry-run  # show what a run would do
darius run now daily-report            # run it once, now, in a headless Claude Code session
darius due                             # what is due now
```

From here the run-due timer starts the ritual every day at 07:00. Add a bucket later to share the
store between hosts (steps 2 and 3 of [Install](#install)).

## Contents

- [The words darius uses](#the-words-darius-uses)
- [What it looks like in use](#what-it-looks-like-in-use)
- [Quick start](#quick-start-one-host-no-bucket)
- [Install](#install), [Update](#update), [NixOS and Nix](#nixos-and-nix)
- [Link a repo](#link-a-repo)
- [Commands](#commands)
- [Develop](#develop)
- More: [Backups](docs/backups.md), [Marker reference](docs/marker.md), [Design](docs/concept.md)

## Requirements

Node 22.6+ or [Bun](https://bun.sh), and git. No build step and no runtime dependencies. On Nix,
the flake supplies its own runtime (see [NixOS and Nix](#nixos-and-nix)).

## Install

One host runs the bucket. Every host runs the CLI and the timers. Each tracked repo gets a
small committed `.darius.toml`, and each host links its checkout once (see
[Link a repo](#link-a-repo)).

darius installs the same way on every host, including NixOS: as an app in `~/.local/opt/darius`.
A release is a git tag. Each installed release is a shallow clone in `versions/vX.Y.Z/`, and the
symlink `current` names the live one. `~/.local/bin/darius` points to `current/bin/darius`.

1. Install the newest release. `scripts/install.sh` clones it, links `~/.local/bin/darius`,
   writes a config skeleton to `~/.config/darius/config.toml`, creates the store dir
   `~/.local/share/darius`, and enables the units: sync every 15 minutes, the vigil sweep daily
   at 06:30, run-due every 15 minutes at :05/15, and the web page. Its last lines say what to do next:
   `darius init` in each repo, and `darius skill install` when no Claude Code plugin teaches
   darius yet.

   ```bash
   bash <(curl -fsSL https://raw.githubusercontent.com/AltanS/darius/main/scripts/install.sh)
   ```

2. On the bucket host only, start SeaweedFS. It runs as the user unit `darius-seaweedfs.service`
   (rootless podman) and listens on `127.0.0.1:9910` and the tailnet address, never on `0.0.0.0`.
   It creates one key per host. This host's key goes to `~/.config/darius/credentials` (mode 0600).
   Name other hosts in `DARIUS_CLIENT_HOSTS`. Their keys go to
   `~/.config/darius/keys/<host>.credentials`. A rerun never rotates a key.

   ```bash
   DARIUS_CLIENT_HOSTS="host-b host-c" ~/.local/opt/darius/current/scripts/seaweedfs-install.sh
   ```

3. Add a `[remote]` table to `config.toml`. Then create the bucket:

   ```toml
   [remote]
   endpoint = "http://127.0.0.1:9910"   # other hosts: http://<bucket host tailnet ip>:9910
   bucket = "darius"
   region = "us-east-1"
   path_style = true
   allow_http = true                     # only for loopback or 100.64.0.0/10
   sse = true
   credentials = "~/.config/darius/credentials"
   ```

   ```bash
   darius setup --remote
   ```

Another host (here `host-b`, with `host-a` as bucket host) needs its key and config.
Then push the install from a host that runs darius. On `host-b`:

```bash
# 1. copy its key from the bucket host
mkdir -p ~/.config/darius && scp host-a:.config/darius/keys/host-b.credentials ~/.config/darius/credentials && chmod 600 ~/.config/darius/credentials
# 2. write its config, pointing at the bucket over the tailnet
printf '%s\n' 'host = "host-b"' '' '[notify]' 'webhook = ""' '' '[remote]' 'endpoint = "http://100.64.1.10:9910"' 'bucket = "darius"' 'region = "us-east-1"' 'path_style = true' 'allow_http = true' 'sse = true' 'credentials = "~/.config/darius/credentials"' > ~/.config/darius/config.toml
```

Then, on `host-a`:

```bash
darius update --hosts host-b   # installs host-a's version on host-b, over your SSH
```

### Units per host

`[setup] units` in `config.toml` selects the units a host runs. Without this key it runs all of
them. A sync-only host sets one:

```toml
[setup]
units = ["sync"]   # any of "sync", "vigil-sweep", "run-due", "web", "snapshot"
```

`darius setup --systemd` enables the listed units. It disables and removes the others, but
touches only the unit files it wrote. `darius update` reruns it, preserving your choices.

### Backups

A darius host keeps one backup of its store: a daily `tar.gz` file, called a snapshot. It stays on
the host. You can also copy each one to an S3 bucket on another machine. A host that ran
`darius setup --systemd` or `darius update` already has the timer (04:00 every day).

```bash
darius snapshot status    # the timer, the last run, any problems
darius snapshot create    # make one now
darius snapshot list      # the snapshots on this host
```

The full guide covers the bucket, the settings, the key pair, restore and troubleshooting:
[`docs/backups.md`](docs/backups.md).

## Update

```bash
darius update --check                # this host's version and the newest release; changes nothing
darius update                        # move this host to the newest release
darius update v0.16.0                # move to a given release; an older one is a rollback by hand
darius update --major                # cross into a new major; read its CHANGELOG.md first
darius update --hosts host-b,host-c  # bring other hosts to this host's version, over your SSH
```

`darius update` clones the release alongside the live one and verifies that it starts. Then it
switches `current`, runs `darius setup --systemd --keep-stopped` from the new version, and restarts
the web page. A timer that you stopped stays stopped, and update prints a line for it.
Finally, it checks that `darius --version` reports the new version and that
`http://127.0.0.1:4747/healthz` responds. If a check fails, it rolls back once and exits with 1.
`~/.local/opt/darius/update.json` records the last update. The live version and two backups stay
on disk; pruning removes the rest.

`--hosts` updates hosts sequentially over `ssh -o BatchMode=yes`. A host with an app
install runs its own `darius update`. A host without one runs `scripts/install.sh` over SSH.
Hosts running darius from the Nix store are rejected: remove the home-manager module there first.
Exit codes: 0 for success, 1 if a host failed, 3 when the only failures were unreachable hosts.

A host from before 0.17.0 has a full clone at `~/.local/opt/darius`. Run `install.sh` there once:
it moves the old clone to `~/.local/opt/darius.legacy-<time>`, deletes nothing, and installs the
app in place.

## Link a repo

Run `darius init` once in each repo, on each host. It prints what it did and what to run next.

- In a new repo it writes `.darius.toml`, links the checkout on this host, and creates
  `.tracker/`. Commit both.
- In a repo with a `.tracker/` from the old tracker plugin it imports the rituals, runs and
  verification log into the darius store, writes `.darius.toml` and links the checkout.
  `.tracker/` stays as it is. It refuses the import when the store already holds rituals for the
  project; `darius init --no-import` then links without it.
- In a repo with a committed `.darius.toml` (a clone on another host) it links the checkout.
  A second run says `already linked`.

`--project <name>` names the project; the default is the directory name.

A repo defines its project in one committed file at its root. The bucket holds all other state.

```toml
# .darius.toml
v = 3                               # format version; darius init writes 3
project = "acme-web"                 # the project this repo belongs to
tz = "Europe/Berlin"                # required in v3; init writes this host's zone
max_mode = "report"                 # optional: the highest ritual mode the timer may run here
```

### Marker v3: rituals in git

A marker with `v = 3` can also define rituals and policies. The procedure of a ritual is a skill in
`.claude/skills/<skill>/SKILL.md`. Git holds the definition, so you review it like code.

```toml
# .darius.toml
v = 3
project = "acme-web"
tz = "Europe/Berlin"
max_mode = "report"

[rituals.daily-report]
title = "Daily site report"
cadence = "1d"
at = "07:00"
skill = "daily-report"
mode = "report"
may = ["Bash(date *)"]
hold = ['\bdeploy\b']
```

```bash
darius marker check    # check the marker before you commit it
```

The full reference covers every key, policies, how the timer runs a v3 marker, skip reasons, and
how to move a v2 project: [`docs/marker.md`](docs/marker.md).

`darius init` links through `darius link`, which you can also run by hand:

```bash
darius link          # writes <project> = "<checkout>" to ~/.config/darius/links.toml
darius link --list   # every link on this host, and whether its dir still exists
```

Vigil Commands and unattended claude sessions run in the linked checkout, allowing commands
like `cd app && ...`. A host without a checkout of a linked project skips that work
(`no-workdir`) rather than running it in the wrong directory.

`max_mode` is a review gate, not a lock: anyone with a bucket key can write Commands
that darius executes. Raising a ritual to `act` takes a reviewed commit. `ritual add|set --mode`
rejects modes above it, and run-due skips those rituals as `policy-capped` and reports them.

`scripts/acceptance.sh` validates the complete install on the bucket host, end to end. It runs one real
`claude -p` session.

## NixOS and Nix

These steps also work on NixOS: `setup --systemd` derives the unit PATH from your login PATH and
the NixOS profile directories. The repo is also a flake for declarative setups.
Pick one method per host. `darius update` will not update a Nix store install: the flake input and
`nixos-rebuild switch` manage that version. To convert a host to the app install, remove the
module, rebuild, then push to it with `darius update --hosts`.

```bash
nix run github:AltanS/darius -- --version
nix develop            # Bun and Node for work on darius
nix flake check        # the suite in the sandbox, and a NixOS VM test of every timer unit
```

With home-manager, add the input and enable the module. It installs darius, writes
`~/.config/darius/config.toml`, configures the four timers (sync, vigil sweep, run-due, snapshot) with the same schedules as above, and runs `darius skill install` on each activation:

```nix
# flake.nix
inputs.darius = {
  url = "github:AltanS/darius";
  inputs.nixpkgs.follows = "nixpkgs";
  inputs.home-manager.follows = "home-manager";
};

# a home-manager module
{ inputs, ... }: {
  imports = [ inputs.darius.homeManagerModules.default ];
  services.darius = {
    enable = true;
    settings.remote = {
      endpoint = "http://100.64.1.10:9910";
      allow_http = true;
      credentials = "~/.config/darius/credentials";
    };
  };
}
```

- Keep key files out of the Nix store. Copy the key (step 1 above), or point `credentials` to a
  sops-nix or agenix secret. darius accepts any owner-only permissions, including 0400.
- The sync timer runs only when `settings.remote` is set. `settings = null` leaves
  `config.toml` unmanaged. `package = darius.packages.${system}.darius-node` selects Node instead
  of Bun. `settings.runner.claude` sets a Claude Code wrapper for run-due, and `runDue.slice`
  assigns the process to a systemd slice.
- The run-due timer fires every 15 minutes by default (`runDue.onCalendar = "*:05/15"`: :05, :20, :35, :50),
  offset from the sync timer. Set `runDue.onCalendar` to change it.
- `services.darius.skills.enable` (default true) installs and refreshes the Claude Code skills and
  agent under `~/.claude` on each activation. A failure, such as an unstamped file in the way,
  prints a warning and never fails the activation. It never writes `settings.json`. Set it to
  `false` to manage the skills yourself.
- Timers require systemd lingering to fire without an active login: `users.users.<name>.linger = true`.
- Vigil `Command:` lines run in a login shell, where `/etc/profile` resets PATH on NixOS.
  Checks search your login PATH first, matching interactive shells, then the unit directories; `darius`
  remains directly callable. Because nixpkgs combines coreutils into a single multicall binary,
  `exec -a name sleep` fails within NixOS checks.
- Every host can run every timer. The sweep timer runs `vigil sweep --daily`, acquiring a daily
  per-project lease in the bucket: the first host sweeps the project, and other hosts skip it
  (`swept-today`). run-due acquires leases per ritual. A host lacking a project checkout skips
  the job (`no-workdir`), so run `darius link` in each checkout first.

## Commands

Every command accepts `--json` (writes one JSON object to stdout) and `--project P`. Run `darius help` for
the full reference.

- `darius setup [--systemd] [--remote]`: link the CLI, write the config, install the timers, create the bucket.
- `darius update [vX.Y.Z] [--check] [--major] [--hosts h1,h2]`: move this host, or other hosts, to a release.
- `darius ritual add|list|show|set|pause|resume|retire|reconcile|export`: recurring work with a cadence and a policy. In a v3 project the marker defines it, and `reconcile` mirrors it into the store. `export [--write]` builds a v3 marker from a v2 project's rituals.
- `darius run start|hold|answer|complete|list`: one pass through a ritual.
- `darius due [--all-projects] [--brief]`: what is due now. `--brief` prints one line or nothing, for a session start hook.
- `darius skill [install|uninstall|status|hook]`: print, install or remove the Claude Code skill for darius, say where sessions learn it, check whether the three hooks are in `settings.json`, or print the hooks to paste. darius only reads `settings.json`; it never writes it. When the skill is installed and stamped, `darius setup` refreshes its files and also installs any file a new release adds. With no skill installed, setup installs nothing. Setup also says which hooks are missing.
- `darius vigil add|list|show|close|sweep`: one-shot checks that wait for a date or an event.
- `darius run-due --unattended`: start each due ritual in a headless `claude -p` session.
- `darius sync [--all-projects]`: pull from and push to the bucket.
- `darius snapshot create|list|status|check|delete|config|credentials`: dated archives of this host's store, local and in an S3 bucket, and their settings and key pair.
- `darius init [--project P] [--no-import]`: set up a repo: `.darius.toml`, the link, and `.tracker/` or an import of its rituals.
- `darius link [--force] | --list`: record which checkout on this host holds a project.
- `darius marker check [dir] [--resolved <slug>]`: parse a repo's `.darius.toml` as the runner does. A missing skill file is an error; other findings are warnings. `--resolved` prints the effective policy of one ritual.
- `darius marker factor [dir] [--write]`: move the `may` and `hold` rules that inline rituals share into new `[policies.*]` tables. Prints a diff; `--write` writes the file and never runs git.
- `darius import <path/.tracker> --project P`: copy a legacy tracker's rituals and evidence, read-only.
- `darius selftest seed|fire|status`: the `darius-selftest` project the acceptance run uses.
- `darius policy-check`: the PreToolUse hook that unattended runs use. You do not call it.

## Develop

```bash
bun install          # dev tools only: oxlint, TypeScript
(cd web && bun install)
./bin/darius --version
bun run check       # lint, typecheck, tests under Node and Bun
```

### Two lanes on one machine

Run the installed release as **stable** and your checkout as **next**, side by side. Both read
the same store without modifying it.

| Lane | Runs | Port | Unit | Config |
| --- | --- | --- | --- | --- |
| stable | `~/.local/opt/darius/current` | 4747 | `darius-web.service` | `~/.config/darius/web.env` |
| next | this checkout | 4748 | `darius-next` (transient) | `~/.config/darius/next.env` |

The make targets that start and stop the lanes live in the private workspace repo, not in this
one. `bun run web:dev` runs the web dev server in the foreground (port 5747).

### Behind a reverse proxy

To expose a lane over HTTPS, place a reverse proxy in front that forwards the client
device identity in a header. Configure darius in the lane's env file:

```bash
DARIUS_WEB_URL=https://darius.example.com   # the address people open
DARIUS_WEB_PROXY=100.x.y.z                  # the proxy's own address(es)
DARIUS_WEB_PROXY_DEVICES=my-phone,my-laptop # devices the proxy may vouch for
# DARIUS_WEB_PROXY_HEADER=X-Tailnet-Device  # the default
```

darius trusts the header only when sent from the designated proxy address. Other callers are
verified via `tailscale whois`, preventing client spoofing. If the proxy runs on the same
host, set `DARIUS_WEB_PROXY=127.0.0.1`: loopback connections then require the header as well.

## License

MIT. `tools/oxlint/anti-slop/` is a vendored copy of
[dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) under its own MIT license.
