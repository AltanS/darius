# Backups

A darius host keeps one backup of its store: a daily `tar.gz` file, called a snapshot. A snapshot
stays on the host. You can also copy each one to an S3 bucket on another machine. There is no git
backup: the old `darius export` is gone.

## Quick start

1. A host that runs `darius setup --systemd` or `darius update` already has the timer. Check it:
   `darius snapshot status` shows a `timer` line with the next run. It runs at 04:00 every day.
2. Make one now: `darius snapshot create`.
3. Look at it: `darius snapshot list`. You see the file name and its size.

That is a working local backup. It protects you from a mistake, such as a deleted ritual. It does not
protect you from a dead disk, because the folder sits on the same disk as the store. For that, add a
bucket on another machine (see "Add a bucket").

## What is in a backup, and what is not

| In the snapshot | Not in the snapshot |
|---|---|
| The store, `~/.local/share/darius`: rituals, vigils, runs, findings, the ledgers | The config folder `~/.config/darius`: `config.toml`, host keys, `credentials`, `snapshot-credentials`, `snapshot.env`, push keys |
| | Milestones, specs and worklogs: they live in each repo's `.tracker/`, in git |
| | Other hosts' stores: each host backs up its own |
| | The sync bucket's own data |

A host you rebuild from a snapshot needs its keys again. A run refuses when the store holds a file
named like a secret (`credentials`, `keys`, `*.pem`, `*.key`, `*.credentials`). It checks names, not
contents.

## Where the files are

- `~/.local/share/darius-snapshots/darius-<host>-<UTC time>.tar.gz`: the snapshot.
- `<same name>.json`: its manifest: host, time, darius version, file count, sizes and the SHA-256.
- `status.json` and `lock.json` in the same folder: what the last run did, and a note that a run is
  going. You never edit them.
- In the bucket: `<prefix>/<host>/<same name>` and its `.json`.

The newest 7 snapshots stay on the host and the newest 30 stay in the bucket. Older ones are
deleted after each run. A snapshot is smaller than the store, because it is gzipped. The settings page shows the real
sizes.

## Add a bucket

darius does not create the bucket. Make it first, on a machine other than the one that holds your
sync bucket, and make a key pair that may list, write and delete objects in it. Then:

1. Set the endpoint and the bucket (see "Settings"). Use the settings page, or
   `darius snapshot config set endpoint https://s3.example.com bucket darius-snapshots`.
2. Save the key pair (see "The key pair"). Use the settings page, or
   `printf %s "$SECRET" | darius snapshot credentials set --key-id <key id>`.
3. Run `darius snapshot check`. It lists the bucket, writes a small test object and deletes it. If it
   says `ok`, run `darius snapshot create`: the file is now in the bucket as well.

## Check that it works

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

## Settings

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

## The key pair

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

## Commands

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

## When something goes wrong

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

## Restore

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

## Moving off the git backup

Version 0.43.0 had `darius export` and a `[backup]` table. Both are gone. `darius update` removes
the old `darius-export` timer on its own. Two things stay for you to delete by hand: the old
local clone (`~/.local/share/darius-backup` by default) and the private git repo it pushed to. An
old `[backup]` table in `config.toml` does no harm. A `"export"` entry in `[setup] units` is an
error: remove it.
