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
`.tracker/`, the unattended runner, the terminal UI (the Due and Run screens), and a web
status page (it reads the store; a few buttons call CLI verbs) work. Milestones and specs still run through a vendored copy of the older `tracker`
CLI, which darius calls for you. They are not native to darius yet. Since 0.67.0 a project can keep
its whole tracker tree in the darius store, and `darius onboard` moves a repo there. The design is in
[`docs/concept.md`](docs/concept.md).

## The words darius uses

- **Project**: one tracked repo. Its name comes from `.darius.toml`.
- **Ritual**: recurring work with a schedule, such as "write the daily report at 07:00". A skill
  holds the steps. darius starts a headless Claude Code session to follow them. This is a **run**.
- **Vigil**: a one-shot check that waits for a date or an event, such as "check the logs after the
  first real batch". You close it with a verdict.
- **Held question**: a run stops when it reaches something the ritual's `hold` list names. It asks
  you. You answer in the terminal UI, and the run goes on.
- **Candle**: a problem that needs you, such as a vulnerable dependency. A run or a script lights it by
  key. It stays open until you answer it, accept it or it goes out.
- **Policy**: the limits of a ritual. It sets the mode (`off`, `report` or `act`), the commands the
  run may use (`may`), and the patterns that stop it (`hold`).
- **Store**: darius's own state. It lives outside your repo, in `~/.local/share/darius`.
- **Bucket**: an S3-compatible bucket that you run. The store of every host syncs through it.
- **Host**: one machine that runs darius. Each host has its own copy of the store.

## What it looks like in use

The example below is one project, `acme-web`, on one host, `host-a`. It shows what you commit and
what stays on the machine.

### In the repo

```text
~/projects/acme-web/
├── .darius.toml                 # committed: project name, time zone, kinds, rituals, policies
├── .claude/skills/              # committed: one folder per ritual procedure
│   ├── daily-report/SKILL.md    #   the steps of one ritual
│   └── weekly-audit/SKILL.md
└── src/ ...                     # your own code
```

Git holds the definition of the work. A ritual is a table in `.darius.toml`. Its procedure is the
skill file. Review both like code, in a pull request.

Where the tracker lives depends on `kinds` in `.darius.toml`. The block above is a project with
`kinds = ["ritual", "vigil", "milestone"]`: the milestones, specs, worklogs and archive are in the
darius store, and the checkout has no `.tracker` path at all. `darius root` prints where the tree
is. Verbs take a spec path as `M12-checkout-redesign/01-cart-page.md`, as the old
`.tracker/M12-checkout-redesign/01-cart-page.md`, or as the absolute path in the store. Nothing of
the tree is in git. A repo without that `kinds` line keeps a real `.tracker/` folder in git, which
the vendored code reads and writes. That mode is deprecated.
`darius onboard` moves such a repo (see [Move a repo's tracker into the store](#move-a-repos-tracker-into-the-store)).
The `/darius-*` skills and the `darius` command do the work that the old `tracker` plugin did.

### On the host (never in git)

```text
# The app: one clone per release
~/.local/
├── bin/darius                      # link to the installed release
└── opt/darius/
    ├── current -> versions/v0.61.0 # the live release
    └── versions/                   # one shallow clone per release

# The store: this host's state, synced through the bucket
~/.local/share/darius/
└── acme-web/                       # one folder per project
    ├── items/
    │   ├── rituals/                # each ritual, mirrored from .darius.toml
    │   └── vigils/
    ├── tracker/                    # the tracker tree, when kinds lists milestone
    ├── runs/<id>/                  # per run: prompt, policy, findings
    ├── ledger/host-a/              # the log of what happened, in chunks
    ├── blobs/                      # older versions and large outputs
    └── sync.json                   # what this host pulled from the bucket

# The daily backup of the store
~/.local/share/darius-snapshots/
└── darius-host-a-<time>.tar.gz

# Host settings
~/.config/darius/
├── config.toml                     # host name, [remote] bucket, timers
├── credentials                     # this host's bucket key (mode 0600)
└── links.toml                      # project -> checkout, from `darius link`

# Claude Code files, written by `darius skill install`
~/.claude/
├── skills/
│   ├── darius/SKILL.md             # teaches a session the darius commands
│   └── darius-work/SKILL.md        # one of 12 procedure skills
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
darius init                 # writes .darius.toml, links this checkout, makes the tracker tree in the store
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
- [Link a repo](#link-a-repo), [Move a repo's tracker into the store](#move-a-repos-tracker-into-the-store)
- [Milestones, specs and tasks](#milestones-specs-and-tasks), [Vigils](#vigils), [Runs](#runs), [Candles](#candles), [Worktrees](#worktrees), [Exit codes](#exit-codes)
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

### Unattended runs: the mask

A host starts each unattended run through bubblewrap, which hides darius secret files from the run's
whole process tree: every file directly in the config dir but `config.toml` and `links.toml`, `keys/`,
and `remote.credentials`. Without bwrap a run still starts, unmasked, and `darius doctor` warns. To turn
it off on a host:

```toml
[run]
sandbox = "mask"   # "off" is the default; the mask breaks ssh in a run
```

Inside the mask no_new_privs is on, so `sudo` and rootless podman fail. `darius sync` fails there too,
because it needs `credentials`. The mask is not a full boundary: a run is your own Unix user, and
`systemd-run --user` or ssh to the same host starts a process outside it. See "What the gate does not
stop" in `docs/concept.md`.

### Unattended runs: the box

The box is a stronger sandbox for unattended runs, built on bubblewrap. It is off by default. A run in
the box has a read-only store and config, no host sockets, and no network of its own: its only way out
is a proxy that darius runs outside, and it finishes or holds itself through a small broker. The
work dir's `.git`, `.claude` and `.darius.toml` are read-only, so a run in the box cannot commit.
Unlike the mask, the box fails closed: a box that cannot be built skips the ritual as `box-broken`.
It is not tied to one harness. Claude Code is the first adapter.

```toml
[run]
sandbox = "box"        # "off" (default), "mask" or "box"

[box]
ssh_agent = false      # true: every boxed run gets the ssh agent
writable = []          # extra folders every boxed run may write; empty by default
slice = "agents.slice" # optional: start each boxed run in a systemd user scope of this slice
```

`[box] slice` keeps the resource limits of a slice for boxed runs. Inside the box there is no session
bus, so a wrapper that puts each session in its own scope cannot do it there. With `slice` set, darius
starts bwrap in a scope of that slice itself, outside the box (`systemd-run --user --scope`). The name
must end in `.slice`. Resource limits are not a security boundary: when `systemd-run` is missing or the
scope does not start, the run goes on without it, and its `run.log` says so. `darius box check` shows
whether a run lands in the slice.

`[box] writable` is empty on purpose: a shared cache holds code that later runs and shells load. Inside
the box the cache is per run. To share one, name a folder, such as `["~/.cache/acme-tool"]`. Darius
refuses `~/.cache` itself, the store, `~/.claude`, `~/.ssh` and other paths that start code later. An
unknown key or a refused path is an error that names it. A ritual sets its own network and paths in
`.darius.toml` with `net`, `reach`, `writable`, `ssh_agent` and `tools` (see `docs/marker.md`). A ritual
that cannot run in the box at all opts out with `sandbox = "off"` in the committed marker; on a box host
it then runs with no box and no mask.

Before the first boxed run of a darius version, `darius box check` must pass on the host. It proves the
box with a fake harness and no paid call. `run-due` runs it by itself when there is no passing check.

```bash
darius box check [--json]    # prove the box on this host; exit 0 pass, 1 fail
darius box status [--json]   # the newest check per host and darius version
```

The box needs bwrap and a kernel with `dev.tty.legacy_tiocsti = 0` (for a herdr tab). `darius doctor`
warns when the box is set and bwrap fails its probe. The box does not stop public exfiltration under
the default `net = "public"`, a host you list in `reach`, or files in the work dir that you run later.
See "The box" and "What the box does not stop" in `docs/concept.md`.

### Backups

A darius host keeps one backup of its store: a daily `tar.gz` file, called a snapshot. It stays on
the host. You can also copy each one to an S3 bucket on another machine. A host that ran
`darius setup --systemd` or `darius update` already has the timer (04:00 every day).

```bash
darius snapshot status    # the timer, the last run, any problems
darius snapshot create    # make one now
darius snapshot list      # the snapshots on this host
```

To set up every host once, `darius snapshot config push --hosts host-b,host-c` copies the settings
and the key pair over your ssh. `darius snapshot status --hosts` lists the last backup of every host
and marks a host that stopped.

If a host or the sync bucket is lost, `darius restore` brings a store back from a snapshot, and
`darius sync --reseed` refills an empty sync bucket. The full guide covers the bucket, the settings,
the key pair, a key that cannot delete, the recovery playbooks and troubleshooting:
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

- In a new repo it writes `.darius.toml` with `kinds = ["ritual", "vigil", "milestone"]`, links the
  checkout on this host, and creates the tracker tree in the darius store. Commit `.darius.toml`.
  Nothing else is written in the checkout: no `.tracker` path, no `.gitignore` line.
- In a repo that still has a `.tracker/` folder it works as before: it imports the rituals, runs and
  verification log into the darius store, writes `.darius.toml` and links the checkout.
  `.tracker/` stays as it is, in git, and init prints a hint to run `darius onboard`. It refuses the
  import when the store already holds rituals for the project; `darius init --no-import` then links
  without it.
- In a repo with a committed `.darius.toml` (a clone on another host) it links the checkout. When
  `kinds` lists `milestone`, it also brings the tree up to date in the store. A second run says
  `already linked`.

A checkout from before 0.78.0 has a `.tracker` link into the store. The next darius verb removes it
and prints one line on stderr. It removes only a link into this project's own store tree, never a
real folder and never a link that points elsewhere. darius does not edit `.gitignore`; `darius
doctor` notes a `/.tracker` line you can remove.

`--project <name>` names the project; the default is the directory name.

A repo defines its project in one committed file at its root. The bucket holds all other state.

```toml
# .darius.toml
v = 3                               # format version; darius init writes 3
project = "acme-web"                 # the project this repo belongs to
tz = "Europe/Berlin"                # required in v3; init writes this host's zone
max_mode = "report"                 # optional: the highest ritual mode the timer may run here
kinds = ["ritual", "vigil", "milestone"]   # optional: what the store owns; see the marker reference
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

### Move a repo's tracker into the store

A repo with a real `.tracker/` folder in git moves to the store with `darius onboard`. Every host
must run 0.67.0 or later first, because an older darius refuses the `kinds` key.

```bash
darius onboard scan             # read-only: what would move, and what blocks it
darius onboard --dry-run        # show the plan
darius onboard                  # do it
darius onboard --only vigil     # move the vigils only, leave the rest in git
```

`darius onboard` refuses a `.tracker/` with uncommitted changes. It imports `.tracker/vigils` into
the store, copies the rest of `.tracker/` into the store and checks every file by sha256, writes a
`project.cutover` ledger line, adds the `kinds` line to `.darius.toml`, runs `git rm -r .tracker`,
removes the folder, and writes the store vigils under `vigils/` in the tree. It makes no link and
does not touch `.gitignore`. It never commits. Review the change and commit `.darius.toml` and the
staged removal yourself.

An imported open vigil is heavy: the daily sweep skips it. `darius onboard` says how many there
are. To let the sweep run one, use `darius vigil set <slug> --no-heavy`.

On every other host: update darius, `git pull`, then run `darius sync`. darius captures tracker
changes after each tracker verb and at each sync, and applies other hosts' changes before each
tracker verb and after a pull. The last writer wins per file. When two hosts edit one file, darius
reports the blob id of the version that lost. A `.jsonl` file is append-only, so there darius
merges: it writes the lines of both versions and records the result, and no line is lost.
Host-local files (`00-INDEX.md`, `.pending-sync` and similar) do not sync. darius rebuilds a missing
`00-INDEX.md` before a tracker verb and after a sync.

To go back, revert the cut-over commit (git still has every file) and copy newer files back from
the store's working copy, `~/.local/share/darius/<project>/tracker/`.

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

## Milestones, specs and tasks

The tracker verbs plan work. They act on the tracker tree: in the store when `kinds` lists
`milestone`, else in `.tracker/` in git.

```bash
darius add milestone --name "Checkout" --slug checkout --owner dev@example.com
darius add spec --milestone checkout --name "Cart totals" --template generic
darius next                               # the first open task
darius mark M1-checkout/01-cart-totals.md 0 --verified --evidence "ran the suite"
darius verify-item M1-checkout/01-cart-totals.md 1
```

A spec is a markdown file with a `## Verification Checklist`. Each item is a `- [ ]` line. It can
carry one check under it:

```markdown
- [ ] The totals add up
  - Command: `bun test cart`
  - Expected: `exit 0`
- [ ] The page looks right
  - Manual: a person looks at it on a phone
```

`Command:` is a shell command. `Expected:` says what a pass is (`exit 0`, `stdout contains ...`).
A `Manual:` item has no command. A new spec holds placeholder Commands that fail on purpose. Replace
each one with a real check.

Item indexes are 0-based: the first item is `0`.
`mark <spec> <index> --verified|--in-progress|--blocked|--skipped|--pending` sets a state by hand,
and a tick on a no-op Command needs `--evidence`. `verify-item <spec> <index>` runs the item's
Command and ticks the item when it passes. `verify <spec>` does this for every item.
`darius spec check <spec>` checks the spec itself, with no model.

## Vigils

A vigil is a one-shot check that waits for a date or an event.

```bash
darius vigil add cache-soak --due 2026-11-01 --stdin < body.md
darius vigil add first-batch --until "the first real batch ran"
darius vigil set-body cache-soak --stdin < body.md
darius vigil close cache-soak --verdict held
```

`--due` waits for a date. `--in 7d` (or `2w`, `1m`) is a due date counted from today. darius stores the
date, not the phrase. `--due` and `--in` exclude each other. `--until` waits for an event that you name. The body has a
`## Verification Checklist` with items that carry a `Command:`. `set-body --stdin` replaces the body
and keeps the header.

The daily sweep runs the Commands of every vigil that is due. What it reports:

- `held`: every check passed. The sweep closes the vigil.
- `failed`: a check failed. The vigil stays open and is flagged. A person must look, because a
  machine cannot tell a broken guard from a closed precondition.
- `finding`: an event-gated vigil passed before the event was confirmed. Nothing closes.
- `pending`: not every check passed yet. This is not a failure.
- `awaiting-manual`: the checks passed but a manual item is still open.
- `skipped`: nothing ran. The vigil is heavy, has no Command, or is not due.

### A vigil that lights a candle

"Check this in 7 days. If it holds, close it. If it fails, tell me."

```bash
darius vigil add xyz --in 7d --candle high --stdin < body.md
darius vigil add xyz --in 7d --candle high --candle-deliver push,email --stdin < body.md
darius vigil set xyz --candle medium        # change it; --candle-deliver none means the app only
darius vigil set xyz --no-candle            # remove both keys
```

- A sweep that reads `failed` lights the candle `vigil:<slug>` with the vigil title, your severity, and
  a target that names the kind of failure and the failing step. The vigil stays armed, so the next
  daily sweep checks again. A repeat at the same severity is one more report and sends no notice.
- A sweep that closes the vigil as `held` blows out the candle. So does `vigil close --verdict held`.
  `vigil close --verdict failed` leaves the candle open.
- `candle accept` on that candle also closes the vigil as `failed`: nothing is left to wait for. If the
  close fails, the accept stays on record and darius says so on stderr. `candle answer` leaves the
  vigil armed. It keeps watching, and a passing check closes it and blows out the candle.
- A sweep that reports `skipped`, `pending`, `finding` or `awaiting-manual`, a dry run, and a classify
  run light nothing. The sweep sends the notice of a candle it lit before it exits, for its own project
  only. A failed send never fails the sweep.
- `--candle` needs a date (`--due` or `--in`) or a `--gate-command`. A vigil with only `--until` never
  reads as failed, so darius refuses the flag and says why.
- The check must be a Command. A check that needs judgment stays a ritual.
- Two edges. `candle blow-out` on a vigil that is still armed lights the candle again at the next sweep.
  `candle relight` after an accept leaves a candle that only a person can end, because the vigil is closed.
- **Update every host before a vigil uses `candle`.** An older host refuses a vigil item that holds an
  unknown key. Only vigils that the store owns take these flags; the legacy route refuses them.

## Runs

`darius run start <ritual>` and `darius run-due --unattended` start a headless `claude -p` session,
so `claude` must be on `PATH`. Before the first unattended run on a host, prove that the harness
blocks what the policy says it blocks with `darius harness check` (exit 0 passed, 1 failed, 3
inconclusive).

## Candles

A candle is a problem that needs you. The ritual does the check, and the candle is only the result.
A candle has no schedule and does no work. It is kept by project and key, so a problem that is reported
again stays one candle.

A script or a CI job lights one with the CLI:

```bash
darius candle light dep/cve-2026-0001 --title "Vulnerable dependency" --severity high \
  --target web/package.json --source ci:nightly --deliver push,email
darius candle list                 # the lit candles; --all or --status answered|accepted|out for more
darius candle show dep/cve-2026-0001
darius candle answer dep/cve-2026-0001 --note "Update it this week"
darius candle accept dep/cve-2026-0001 --note "Not reachable from outside"
darius candle blow-out dep/cve-2026-0001  # the problem is gone
darius candle relight dep/cve-2026-0001    # take back an answer or an accept
```

- `light` on a lit key at the same or a lower severity exits `0` and says "already lit, seen again".
  A higher severity raises the candle, and a report after it is out lights it again. `--stdin` stores
  a body. The key is one line of at most 120 characters. A longer key is refused, not cut.
- A ritual that lights candles can set `candle_deliver = ["push", "email"]` in `.darius.toml`: `[]` means the
  app only, and no key means `push`. A run cannot choose its channel. `darius email set` must have run on a host
  that sends email.
- A run lights a candle only through its result: an item with `"candle": true`, a `key` and the state
  `needs-decision`. The state `fixed` puts it out. A confused run cannot run the write verbs: the CLI refuses
  them inside a run, and the gate denies them. It can run `candle list` and `candle show`.
- An answer or an accept closes the candle at the severity it has. A later report at the same or a lower
  severity leaves it closed. A higher severity lights it again.
- A candle from a run goes out after two complete runs of that ritual that do not report it. A candle
  from a script waits for `candle blow-out`. `candle blow-out` also ends a candle from a deleted ritual.
- A vigil can light a candle when its check fails; see [A vigil that lights a candle](#a-vigil-that-lights-a-candle).
  Accepting such a candle closes the vigil.
- `answer --follow-up` starts a follow-up of the run that made the newest report, and carries out that
  item's proposal. It writes the answer only when the run started. It waits for the run, and it exits
  with the run's code. A candle from outside has no run, so it refuses that with exit `1`. On another
  host's ritual it prints the ssh command; `--on <host>` runs the verb there.

### Candles over HTTP

`darius serve` has the same actions for the app and for a caller on your tailnet:

```bash
curl -s "http://host-a:4747/api/candles?project=acme&status=lit"
curl -s "http://host-a:4747/api/candle?project=acme&key=dep/cve-2026-0001"
curl -s http://host-a:4747/api/candle/light -H 'content-type: application/json' -d '{
  "project": "acme", "key": "dep/cve-2026-0001", "title": "Vulnerable dependency",
  "severity": "high", "target": "web/package.json", "source": "ci:nightly", "deliver": "push,email"
}'
```

- Both reads answer JSON for any viewer that passes the access check. A candle's text is untrusted.
- `POST /api/candle/light` needs a tailnet identity. A browser page of another site cannot call it. It also
  takes `body`, which goes to the CLI on stdin. `deliver` is `push`, `email`, `push,email` or `none`. The whole
  request is at most 4096 bytes. A local script uses the CLI: the loopback caller is refused.
- `POST /api/candle/answer` `{project, key, note, followUp?}` and `POST /api/candle/accept` `{project, key, note?}`
  come from the page only: they need its `Origin`. With `followUp` a follow-up that cannot start is a `409`
  with a sentence, and the candle stays as it was.

### Candles by email

A host can email its candle notices through an HTTP mail API. There is no SMTP. Write the settings to a
file that only you can read (run `umask 077` first):

```json
{
  "url": "https://mail.example.com/v1/send",
  "token": "your-token-here",
  "from": "darius@example.com",
  "to": ["you@example.com"],
  "web_url": "https://darius.example.com"
}
```

Then feed the file to darius on stdin, and delete it:

```bash
darius email set --stdin < email-settings.json && rm email-settings.json
darius email status               # set up or not, the host of the url, the recipient count
darius email test                 # sends one message
```

- Each host has its own `<config>/email.json`. darius writes it with mode 0600, and refuses a file that
  its group or others can read. It is never synced and never in a snapshot.
- `url` must be https, or http on loopback or the tailnet. It may not hold a user, a password or a
  query. `web_url` is optional, and adds a link to each message.
- darius sends `POST <url>` with `Authorization: Bearer <token>`, an `Idempotency-Key`, and the JSON
  `{from, to, subject, text}`. Any 2xx is success. A request stops after 15 seconds, and darius tries one
  notice at most three times.
- A message holds the title, severity, project, target and link. It never holds a candle body or a detail.
- Candles from before `set` send no mail. Add `since` to the JSON to choose another start.
- The token and the addresses stay in that file: not in the store, the ledger, a log or an error.
- A run cannot use `email set` or `email test`. It can use `email status`.

To use the channel, name it: `candle light --deliver email`, or `candle_deliver = ["email"]` on a ritual.

## Cadence and the first due date

`cadence` takes `Nd`, `Nw` or `Nm`: `1d` is every day, `1w` every week, `2w` every two weeks, `1m`
every month. A new ritual is due at once: its first due date is today. Set `from` to start later.
With the default `anchor = "due"` the schedule is a grid, so a late run does not move the next one.
With `anchor = "completion"` the next due date counts from the day the run finished.

## Worktrees

All worktrees of one checkout use the same tracker tree. With `milestone` in `kinds` there is one
tree per project in the store, so a spec added on a branch shows on main and in every other
worktree at once. `darius root --json` prints `{ mode, trackerRoot, project, linked }` and changes
nothing: `mode` is `store`, `git` or `none`, and `trackerRoot` is the absolute path of the tree. In
`git` mode each branch has its own copy of `.tracker/`, as git says.

## Exit codes

- `0`: it worked.
- `1`: refused or failed. A named item that is not there (`ritual show nope`) is also `1`.
- `2`: usage. A missing argument, an unknown option, a bad value, an unknown verb.
- `3`: the environment gave no answer (no bucket, no `bash`, no harness).

`--help` or `-h` anywhere in a command prints its usage and exits `0`; nothing else runs. `-h` right after a flag that takes a value (`--note -h`) is ambiguous: it exits `2` and runs nothing. Write `--note=-h` for the value. With
`--json`, stdout holds JSON only, also on an error: `{"ok":false,"error":"...","code":2}`.

## Commands

Every command accepts `--json` (writes one JSON object to stdout) and `--project P`. Run `darius help` for
the full reference.

- `darius setup [--systemd] [--remote]`: link the CLI, write the config, install the timers, create the bucket.
- `darius update [vX.Y.Z] [--check] [--major] [--hosts h1,h2]`: move this host, or other hosts, to a release.
- `darius ritual add|list|show|set|pause|resume|retire|reconcile|export`: recurring work with a cadence and a policy. In a v3 project the marker defines it, and `reconcile` mirrors it into the store. `export [--write]` builds a v3 marker from a v2 project's rituals.
- `darius run start|hold|answer|complete|list`: one pass through a ritual.
- `darius run ack <run> [--answer N=TEXT ...] [--note TEXT]`: answer a run's questions, one `--answer` per question, or dismiss a run with no answer. The answers reach the next run of the ritual and stay until a run that read them completes.
- `darius run ack-earlier <run>`: dismiss every older open ask of the same ritual in one call.
- `darius candle light|list|show|answer|accept|blow-out|relight`: problems that need you, kept by key. See [Candles](#candles).
- `darius email status|set|test`: the email channel of candle notices. See [Candles by email](#candles-by-email).
- `darius box check [--json] | status [--json]`: prove the run sandbox on this host with a fake harness and no paid call, or list the newest box check per host and darius version. See [Unattended runs: the box](#unattended-runs-the-box).
- `darius due [--all-projects] [--brief]`: what is due now: rituals, and the vigils of a project with `vigil` in `kinds`. `--brief` prints one line or nothing, for a session start hook.
- `darius skill [install|uninstall|status|hook]`: print, install or remove the Claude Code skill for darius, say where sessions learn it, check whether the three hooks are in `settings.json`, or print the hooks to paste. darius only reads `settings.json`; it never writes it. When the skill is installed and stamped, `darius setup` refreshes its files and also installs any file a new release adds. With no skill installed, setup installs nothing. Setup also says which hooks are missing.
- `darius vigil add|set-body|set|list|show|close|pause|resume|sweep`: one-shot checks that wait for a date or an event. With `vigil` in `kinds` they are store items, and the daily sweep runs the Commands of one whose date is due. It skips a heavy vigil; an imported open vigil is heavy until `vigil set <slug> --no-heavy`.
- `darius run-due --unattended`: start each due ritual in a headless `claude -p` session.
- `darius sync [--all-projects]`: pull from and push to the bucket.
- `darius snapshot create|list|status|check|fetch|delete|config|credentials`: dated archives of this host's store, local and in an S3 bucket, and their settings and key pair. `fetch <name>` copies one from the bucket.
- `darius root [--json]`: print the tracker tree path; `--json` reports the mode (`store`, `git`, `none`).
- `darius restore <name> [--runs-only] [--from-host <host>] [--dry-run] [--yes]`: bring this host's store back from a snapshot. It checks the SHA-256, refuses while a darius unit runs, and moves the old store aside. `--runs-only` adds only the missing run folders.
- `darius init [--project P] [--no-import]`: set up a repo: `.darius.toml`, the link, and the tracker tree in the store, or an import of its rituals when a `.tracker/` folder exists.
- `darius onboard [scan] [--dry-run] [--only vigil]`: move a repo's `.tracker/` into the store. Never commits.
- `darius milestone archive <milestone> [--dry-run] [--keep] [--incomplete "<reason>"]`: remove an archived milestone's folder. It refuses without the archive document, while an item is neither done nor skipped (`--incomplete "<reason>"` archives anyway and records the reason), or while a worklog thread is open before stage `reviewed`. It closes the `reviewed` threads as done. In the store it removes the folder and prints the line that undoes it; in a git tracker it removes nothing and prints the `git rm` command to run.
- `darius tree log|restore <path> [--at <sha|ledger-id>] [--dry-run] [--force]`: list the versions of a tracker file or folder in the store, and bring a past version back. Only when `kinds` lists `milestone`; git has the history otherwise.
- `darius tree resolve <path>`: keep the current version of a file with an open tree conflict, so `doctor` and `due` stop showing it. The lost version stays a blob.
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

The proxy must send the host of `DARIUS_WEB_URL`, or this host's own name or address, as the
Host header. darius answers 421 to any other Host, which stops DNS rebinding. To allow one more
name, list it in `DARIUS_WEB_HOSTS` (comma separated, for example
`DARIUS_WEB_HOSTS=darius.example.com,darius-alt.example.com`) and restart `darius serve`. The
journal of `darius serve` names each refused Host.

## License

MIT. `tools/oxlint/anti-slop/` is a vendored copy of
[dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) under its own MIT license.
