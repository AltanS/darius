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

**Status: early.** Rituals, vigils, runs, sync, import of a legacy `.tracker/`, and the unattended
runner work. The TUI, milestones, and specs do not exist yet. The design is in
[`docs/concept.md`](docs/concept.md).

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

A darius host keeps one backup of its store: a daily `tar.gz` file, called a snapshot. A snapshot
stays on the host. You can also copy each one to an S3 bucket on another machine. There is no git
backup: the old `darius export` is gone.

#### Quick start

1. A host that runs `darius setup --systemd` or `darius update` already has the timer. Check it:
   `darius snapshot status` shows a `timer` line with the next run. It runs at 04:00 every day.
2. Make one now: `darius snapshot create`.
3. Look at it: `darius snapshot list`. You see the file name and its size.

That is a working local backup. It protects you from a mistake, such as a deleted ritual. It does not
protect you from a dead disk, because the folder sits on the same disk as the store. For that, add a
bucket on another machine (see "Add a bucket").

#### What is in a backup, and what is not

| In the snapshot | Not in the snapshot |
|---|---|
| The store, `~/.local/share/darius`: rituals, vigils, runs, findings, the ledgers | The config folder `~/.config/darius`: `config.toml`, host keys, `credentials`, `snapshot-credentials`, `snapshot.env`, push keys |
| | Milestones, specs and worklogs: they live in each repo's `.tracker/`, in git |
| | Other hosts' stores: each host backs up its own |
| | The sync bucket's own data |

A host you rebuild from a snapshot needs its keys again. A run refuses when the store holds a file
named like a secret (`credentials`, `keys`, `*.pem`, `*.key`, `*.credentials`). It checks names, not
contents.

#### Where the files are

- `~/.local/share/darius-snapshots/darius-<host>-<UTC time>.tar.gz`: the snapshot.
- `<same name>.json`: its manifest: host, time, darius version, file count, sizes and the SHA-256.
- `status.json` and `lock.json` in the same folder: what the last run did, and a note that a run is
  going. You never edit them.
- In the bucket: `<prefix>/<host>/<same name>` and its `.json`.

The newest 7 snapshots stay on the host and the newest 30 stay in the bucket. Older ones are
deleted after each run. A snapshot is smaller than the store, because it is gzipped. The settings page shows the real
sizes.

#### Add a bucket

darius does not create the bucket. Make it first, on a machine other than the one that holds your
sync bucket, and make a key pair that may list, write and delete objects in it. Then:

1. Set the endpoint and the bucket (see "Settings"). Use the settings page, or
   `darius snapshot config set endpoint https://s3.example.com bucket darius-snapshots`.
2. Save the key pair (see "The key pair"). Use the settings page, or
   `printf %s "$SECRET" | darius snapshot credentials set --key-id <key id>`.
3. Run `darius snapshot check`. It lists the bucket, writes a small test object and deletes it. If it
   says `ok`, run `darius snapshot create`: the file is now in the bucket as well.

#### Check that it works

Do this once after you set it up, and again after you change anything:

```bash
darius snapshot status                   # settings, the last run, the last bucket contact, any problems
darius snapshot check                    # the bucket answers, and you may write and delete
darius snapshot list --remote            # the snapshots in the bucket, and which are also here
f=$(darius snapshot list | head -1 | cut -d' ' -f1)
sha256sum ~/.local/share/darius-snapshots/$f      # must equal "sha256" in $f.json
mkdir /tmp/try && tar -xzf ~/.local/share/darius-snapshots/$f -C /tmp/try && diff -rq /tmp/try ~/.local/share/darius
```

The last line restores into a scratch folder and compares it with the live store. Only files that
changed since the snapshot show up. Remove `/tmp/try` afterwards.

#### Settings

Open `/settings/backups` on the status page to change them, or use the CLI. A setting that an
environment variable sets is locked on the page, and the page names the variable. The page never
shows the secret key.

```bash
darius snapshot config                    # every key, its value, and where the value comes from
darius snapshot config set keep 14        # save one value
darius snapshot config set endpoint https://s3.example.com bucket darius-snapshots   # these two go together
darius snapshot config unset keep         # back to config.toml or the default
```

The page and the CLI save to the same file and check values with the same rules. A bad value exits
`1` with the same message the page shows. A key that an environment variable sets exits `1`, and the
message names the variable. An unknown key exits `2` and lists the keys.

Four places can set a value. The first one that has a valid value wins:

1. the environment, `DARIUS_SNAPSHOT_<KEY>`
2. the settings page, which saves to `~/.config/darius/snapshot.json`
3. `[snapshot]` in `config.toml`
4. the default

| Key | Environment variable | Default | Meaning |
|---|---|---|---|
| `enabled` | `DARIUS_SNAPSHOT_ENABLED` | `true` | `false` turns snapshots off. The timer still fires and does nothing |
| `dir` | `DARIUS_SNAPSHOT_DIR` | `~/.local/share/darius-snapshots` | the local folder. It must lie outside the store and the config folder |
| `keep` | `DARIUS_SNAPSHOT_KEEP` | `7` | snapshots to keep on this host (1 to 3650) |
| `endpoint` | `DARIUS_SNAPSHOT_ENDPOINT` | empty | the S3 address, for example `https://s3.example.com` |
| `bucket` | `DARIUS_SNAPSHOT_BUCKET` | empty | the bucket name. With `endpoint`, it turns the bucket copy on |
| `region` | `DARIUS_SNAPSHOT_REGION` | `us-east-1` | the region the service expects |
| `prefix` | `DARIUS_SNAPSHOT_PREFIX` | `darius` | a folder inside the bucket |
| `keep_remote` | `DARIUS_SNAPSHOT_KEEP_REMOTE` | `30` | snapshots to keep in the bucket |
| `path_style` | `DARIUS_SNAPSHOT_PATH_STYLE` | `true` | put the bucket name in the path, not in the host name |
| `allow_http` | `DARIUS_SNAPSHOT_ALLOW_HTTP` | `false` | allow plain HTTP. Only for loopback and the tailnet |
| `sse` | `DARIUS_SNAPSHOT_SSE` | `false` | ask the service to encrypt each object |

**Environment variables reach only the units.** Put them in `~/.config/darius/snapshot.env`, one
`NAME=value` per line. The snapshot timer and the web service read that file. A command you type
in a shell does not, so `darius snapshot create` by hand ignores it unless you export the variables
there. `darius snapshot config` and `darius snapshot credentials` do read the file, so they show
and refuse what the timer and the page see. After you edit the file, restart the page:
`systemctl --user restart darius-web`.

```toml
# ~/.config/darius/config.toml, the same keys without the prefix
[snapshot]
keep = 7
endpoint = "https://s3.example.com"
bucket = "darius-snapshots"
prefix = "darius"
keep_remote = 30
```

#### The key pair

An S3 key pair is a key id and a secret key. It is not a setting, so it never goes in `config.toml`
or `snapshot.json`. darius takes it from the first of these:

1. `DARIUS_SNAPSHOT_ACCESS_KEY_ID` and `DARIUS_SNAPSHOT_SECRET_ACCESS_KEY`
2. the file `~/.config/darius/snapshot-credentials`, with mode 0600:

   ```ini
   [default]
   aws_access_key_id = <key id>
   aws_secret_access_key = <secret key>
   ```

The settings page can write this file, and so can the CLI. Neither reads the secret back.

```bash
read -rs SECRET                                                    # type the secret, it is not shown
printf %s "$SECRET" | darius snapshot credentials set --key-id <key id>
darius snapshot credentials                                        # which pair is used, and its key id
darius snapshot credentials clear                                  # remove the saved pair
```

The secret comes on stdin only. Never put it in an argument, a flag, or a file in a repo: a command
line shows up in the process list and in the shell history. Without a pipe, `set` exits `2` and
shows the line above. When the environment sets the pair, `set` and `clear` exit `1` and name the
variables.

#### Commands

```bash
darius snapshot create [--no-upload]       # make a snapshot, copy it to the bucket, delete the old ones
darius snapshot list [--remote]            # the snapshots on this host, newest first; --remote: the bucket's too
darius snapshot status                     # the settings summary, the timer, the last run, problems
darius snapshot check                      # list the bucket, then write and delete a small test object
darius snapshot delete <name> [--remote]   # delete one snapshot, here or in the bucket
darius snapshot config [set <key> <value> | unset <key>]   # show or change the settings
darius snapshot credentials [set --key-id <id> | clear]    # the key pair; the secret on stdin
```

Each verb acts on the host you type it on. Every action on the settings page has a verb here.

Exit codes: `0` done (also when snapshots are off). `1` refused or failed. `2` wrong usage. `3` the
snapshot is saved on the host, but the bucket could not be reached. The next run makes a new
snapshot and sends that one. It does not send the missed one again. A run that exits `3` still
counts as a good local backup, so `status` shows the last run as `ok`. Read its bucket line too.
`list --remote` exits `1` when no bucket is set up, and `3` when it cannot reach the bucket.

#### When something goes wrong

| What you see | Why | What to do |
|---|---|---|
| Exit `3`, or a failed bucket line | the bucket could not be reached | Fix the network or the endpoint. Run `darius snapshot check` |
| "no access key" | no key pair on this host | Save the key pair |
| `timer: not installed` in `status` | the timer unit is missing | Run the command the line names |
| `status` lists problems | a setting has a bad value | Fix the value where `status` says it comes from |
| "the store holds a name that looks like a secret" | a file named like a secret is in the store | Remove it from `~/.local/share/darius` |
| "a snapshot is already running" | another run holds the lock | Wait. A lock of a dead process, or one over 12 hours old, is taken over by itself |
| A run was killed half way | the host restarted, or the page service restarted | Nothing. The next run removes the half-written file and runs normally |

The settings page shows the same state: the last backup, the bucket, and any problems.

#### Restore

Restoring overwrites the store, so darius has no restore command. Do it by hand. If the snapshot
is in the bucket only, first fetch the `.tar.gz` and its `.json` with any S3 tool, for example
`aws s3 cp s3://<bucket>/<prefix>/<host>/<name> . --endpoint-url <endpoint>`.

```bash
# 1. stop everything that touches the store, the snapshot timer too
systemctl --user stop darius-web darius-snapshot.timer darius-sync.timer darius-run-due.timer darius-vigil-sweep.timer
# 2. check the file
sha256sum <name>                       # must equal "sha256" in <name>.json
# 3. move the old store aside and unpack
mv ~/.local/share/darius ~/.local/share/darius.before-restore
mkdir ~/.local/share/darius
tar -xzf <name> -C ~/.local/share/darius
# 4. start again
systemctl --user start darius-web darius-snapshot.timer darius-sync.timer darius-run-due.timer darius-vigil-sweep.timer
```

If you set `DARIUS_STATE_DIR`, use that folder instead of `~/.local/share/darius`. Run
`darius ritual list` to see that the store reads. Delete `darius.before-restore` when you are sure.

#### Moving off the git backup

Version 0.43.0 had `darius export` and a `[backup]` table. Both are gone. `darius update` removes
the old `darius-export` timer on its own. Two things stay for you to delete by hand: the old
local clone (`~/.local/share/darius-backup` by default) and the private git repo it pushed to. An
old `[backup]` table in `config.toml` does no harm. A `"export"` entry in `[setup] units` is an
error: remove it.

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

A marker with `v = 3` can define rituals and policies. This release reads and checks them
(`darius marker check`). The runner does not start a git ritual yet; that comes with the next release.
Root `tz` is required. Hosts need 0.53.0 or later before a v3 marker is committed.

```toml
# .darius.toml
v = 3
project = "acme-web"
max_mode = "act"
tz = "Europe/Berlin"

[profiles.watch]
surface = "herdr"
permissions = "skip"

[defaults]
ritual = "watch"
follow_up = "watch"

[policies.read-only]
mode = "report"
may = [
  "Bash(cd tools)",
  "Bash(pnpm cli *)",
  "Bash(date *)",
]
hold = ['\bdeploy\b', '--confirm\b']

[rituals.daily-report]
title = "Daily site report"
cadence = "1d"
at = "07:00"
skill = "daily-report"
policy = "read-only"
timeout = "30m"

[rituals.weekly-audit]
title = "Weekly audit"
cadence = "1w"
from = "2026-10-05"
at = "09:05"
tz = "UTC"
skill = "weekly-audit"
mode = "act"
may = ["Bash(cd tools)", "Bash(pnpm cli *)"]
hold = ['\bdeploy\b']
notes = "Never push. Hand in a diff."
model = "opus"
max_turns = 200
```

Arrays may span lines. `'...'` is a literal string: nothing is escaped, so a regex keeps its
backslashes. A `'` inside one is not allowed.

Root keys:

| Key | Rule |
|---|---|
| `v` | 1, 2 or 3. `tz`, `[rituals.*]` and `[policies.*]` need 3. `[profiles.*]` and `[defaults]` need 2 or 3. |
| `project` | The project name. |
| `max_mode` | `off`, `report` or `act`. The ceiling for every ritual. A ritual with `mode = "act"` needs `max_mode = "act"`. |
| `tz` | Required when `v = 3`. An IANA zone name, such as `Europe/Berlin`. |

`[rituals.<slug>]` takes a slug of lowercase letters, digits, `-` and `_` (at most 64, no dots):

| Key | Required | Rule |
|---|---|---|
| `title` | yes | Non-empty text. |
| `cadence` | no | `Nd`, `Nw` or `Nm`, such as `1d` or `2w`. Without it the ritual is on demand: only `run now` starts it. `at` and `from` need it. |
| `skill` | yes | The name of a skill in `.claude/skills/<skill>/SKILL.md`. The procedure is the skill; git holds no body. |
| `anchor` | no | `due` (default) or `completion`. |
| `at` | no | `HH:MM`, 24 hour. In the ritual's `tz`, else the root `tz`. |
| `tz` | no | An IANA zone name. Overrides the root. |
| `from` | no | `YYYY-MM-DD`. The first date of the cadence grid. |
| `timeout` | no | `<N>m` or `<N>h`, from `1m` to `12h`. The budget of one run. |
| `profile`, `model`, `max_turns` | no | As on a v2 ritual. |
| `policy` | no | Names a `[policies.<name>]` table. Do not combine it with `mode`, `may`, `hold` or `notes`. |
| `mode` | no | `off` (default), `report` or `act`. Not above `max_mode`. |
| `may` | no | A list of Claude Code permission rules, such as `Bash(date *)`. |
| `hold` | no | A list of regular expressions. Each must compile with the `u` flag. |
| `notes` | no | Plain text. |

`[policies.<name>]` takes `mode` (required), `may`, `hold` and `notes`, with the same rules.
Unknown keys and sections are errors that name the file and line.

Check a marker before you commit it:

```bash
darius marker check          # the marker at or above the working directory
darius marker check ../repo  # the marker in another checkout
```

It prints `ok: v3, 2 rituals, 1 policies`, or the first error as `file:line: message` and exit 1.
Warnings do not change the exit code: a skill file missing in this checkout, a policy no ritual
uses, a v3 marker with no rituals. `darius link --list` adds `v3 (N rituals)` to a linked v3 checkout.

### How a v3 marker runs

The timer fires every 15 minutes at `*:05/15` (:05, :20, :35, :50). A ritual with `at = "07:00"`
starts at the first tick after 07:00 in its zone. A host that was off starts it at its first tick
after boot. Before it judges a project, `run-due` reconciles the checkout's marker into the store:
each `[rituals.<slug>]` becomes a store item that mirrors git. You can do the same by hand:

```bash
darius ritual reconcile             # mirror this checkout's marker into the store
darius ritual reconcile --dry-run   # say what would change, write nothing
```

In a v3 project the file owns the ritual. `ritual add` is refused. `ritual set` changes only
`--host`, `--owner`, `--agent`, `--tag` and `--due`. For any other flag it names the file and line
to edit. `ritual retire` is refused for a repo ritual: remove the table and commit, and the next
reconcile retires it. A retired slug stays retired. Use a new slug if you want it back.
A store ritual that the marker does not name is `unmanaged`: it never runs from the timer.

### Move a project to v3

`darius ritual export` builds a v3 marker from the store rituals of a v2 project. It never commits.

```bash
darius ritual export             # print the v3 marker to stdout
darius ritual export --write     # write .darius.toml and the skill files in the linked checkout
```

It keeps the root keys, `[profiles.*]` and `[defaults]` of the current marker as they are, sets
`v = 3`, and adds `tz` with this host's zone. It adds one `[rituals.<slug>]` per active or paused
ritual. It leaves out retired rituals and never writes `host`. A ritual with no skill gets
`skill = "<slug>"`, and its body becomes `.claude/skills/<slug>/SKILL.md`. Policies are written
inline; you can move them into `[policies.<name>]` by hand. If `.claude/skills/<slug>/SKILL.md`
already exists in the checkout, it stays, and the store body becomes the skill `<slug>-ritual`
instead, with a warning.

Export stops with exit 2 when a slug has a dot or is not a v3 slug,
or when a `may` or `hold` value would not pass `marker check`. `--write` also stops when
`.darius.toml` or a target skill file has uncommitted changes, when the marker is already v3, or
when a target skill file exists (including `<slug>-ritual` after a `<slug>` collision).

1. Run `darius ritual export` and read the result. Rename any slug it refuses.
2. Run `darius ritual export --write` in the linked checkout of `acme-web`.
3. Run `darius marker check`. Review the files, commit and push.
4. On each host that runs the timer, pull the commit and run `darius ritual reconcile`.

A ritual's `timeout` replaces the unit's `--timeout` for that run, and the lease follows it.
`run-due` skips a ritual, and says why in its report:

| Skip | Meaning | Fails the batch |
|---|---|---|
| `marker-invalid` | `.darius.toml` does not parse. Every ritual of the project skips. | yes |
| `marker-dirty` | `.darius.toml` has uncommitted changes. `run now` warns and runs instead. | yes |
| `skill-missing` | `.claude/skills/<skill>/SKILL.md` is not in the checkout. | yes |
| `not-in-marker` | A store ritual that a v3 marker does not name. | no |
| `lease-held` | Another host holds the ritual lease. Exit 0. | no |

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
`~/.config/darius/config.toml`, and configures the four timers (sync, vigil sweep, run-due, snapshot) with the same schedules as above:

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
- `darius skill [install|uninstall|status|hook]`: print, install or remove the Claude Code skill for darius, say where sessions learn it, or print its SessionStart hook.
- `darius vigil add|list|show|close|sweep`: one-shot checks that wait for a date or an event.
- `darius run-due --unattended`: start each due ritual in a headless `claude -p` session.
- `darius sync [--all-projects]`: pull from and push to the bucket.
- `darius snapshot create|list|status|check|delete|config|credentials`: dated archives of this host's store, local and in an S3 bucket, and their settings and key pair.
- `darius init [--project P] [--no-import]`: set up a repo: `.darius.toml`, the link, and `.tracker/` or an import of its rituals.
- `darius link [--force] | --list`: record which checkout on this host holds a project.
- `darius marker check [dir]`: parse a repo's `.darius.toml` as the runner does, and list warnings.
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
