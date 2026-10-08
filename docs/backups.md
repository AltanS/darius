# Backups

A darius host keeps one backup of its store: a daily `tar.gz` file, called a snapshot. A snapshot
stays on the host. You can also copy each one to an S3 bucket on another machine. There is no git
backup: the old `darius export` is gone.

This page is the whole guide. Read the first section to see what each layer covers. Set up one
host, then the others. Read the recovery playbooks before you need them.

## What a backup is, and what protects against what

A snapshot is an archive of one host's store: rituals, vigils, runs, findings and the ledgers.
Each host backs up its own store. The bucket copy of a snapshot is optional. It must sit on a
machine other than the one that holds your sync bucket.

| What goes wrong | What protects you | Where to read |
|---|---|---|
| A mistake, such as a deleted ritual | The local snapshots (the newest 7). For one tracker file in the store, `darius tree restore` | "Restore" |
| A dead disk | The bucket copy of the snapshots. The local folder sits on the same disk as the store | "Add a bucket" |
| A lost host | The bucket copy, plus the other hosts: each holds a full copy of every project it syncs | "One host lost" |
| A lost or corrupt sync bucket, or a lost bucket host | Every host's store, plus `darius sync --reseed` | "When the sync bucket is lost" |
| Every host lost | The snapshot bucket, which lives on another machine | "The whole mesh lost" |
| A bad or stolen key | A key that cannot delete, bucket versioning and a lifecycle rule | "A key that cannot delete", "The key threat model" |
| A host that silently stops | The hosts list, a push alert and an optional dead-man ping | "See every host and the alarms" |

Two limits matter. A local snapshot does not protect you from a dead disk. And a backup does not
hold the keys: a rebuilt host needs them again (see the next section).

### What is in a backup, and what is not

| In the snapshot | Not in the snapshot |
|---|---|
| The store, `~/.local/share/darius`: rituals, vigils, runs, findings, the ledgers | The config folder `~/.config/darius`: `config.toml`, host keys, `credentials`, `snapshot-credentials`, `snapshot.env`, push keys |
| | Milestones, specs and worklogs: they live in each repo's `.tracker/`, in git |
| | Other hosts' stores: each host backs up its own |
| | The sync bucket's own data |

A host you rebuild from a snapshot needs its keys again. A run refuses when the store holds a file
named like a secret (`credentials`, `keys`, `*.pem`, `*.key`, `*.credentials`). It checks names, not
contents.

### Where the files are

- `~/.local/share/darius-snapshots/darius-<host>-<UTC time>.tar.gz`: the snapshot.
- `<same name>.json`: its manifest: host, time, darius version, file count, sizes and the SHA-256.
- `status.json` and `lock.json` in the same folder: what the last run did, and a note that a run is
  going. You never edit them.
- In the bucket: `<prefix>/<host>/<same name>` and its `.json`.

The newest 7 snapshots stay on the host and the newest 30 stay in the bucket. Older ones are
deleted after each run. With `remote_prune = false`, darius deletes nothing in the bucket, and the
bucket's own lifecycle rule removes old ones (see "A key that cannot delete"). A snapshot is
smaller than the store, because it is gzipped. The settings page shows the real sizes.

## Quick start

1. A host that runs `darius setup --systemd` or `darius update` already has the timer. Check it:
   `darius snapshot status` shows a `timer` line with the next run. It runs at 04:00 every day.
2. Make one now: `darius snapshot create`.
3. Look at it: `darius snapshot list`. You see the file name and its size.

That is a working local backup. It protects you from a mistake. It does not protect you from a dead
disk, because the folder sits on the same disk as the store. For that, add a bucket.

### Add a bucket

darius does not create the bucket. Make it first, on a machine other than the one that holds your
sync bucket. Make a key pair that may list and write objects in it, and either delete them or rely
on a lifecycle rule. A key that cannot delete is the safer choice: see "A key that cannot delete".
Then:

1. Set the endpoint and the bucket (see "Settings"). Use the settings page, or
   `darius snapshot config set endpoint https://s3.example.com bucket example-darius-snapshots`.
2. Save the key pair (see "The key pair"). Use the settings page, or
   `printf %s "$SECRET" | darius snapshot credentials set --key-id <key id>`.
3. Run `darius snapshot check`. It lists the bucket, writes a small test object, tries to delete it,
   and asks whether the bucket keeps old versions. A key that may delete removes the test object
   again. If the last line starts with `ok`, run `darius snapshot create`: the file is now in the
   bucket as well.

### Check that it works

Do this once after you set it up, and again after you change anything:

```bash
darius snapshot status                   # settings, the last run, the last bucket contact, any problems
darius snapshot check                    # the bucket answers, you may write, and whether you may delete
darius snapshot list --remote            # the snapshots of this host in the bucket, and which are also here
f=$(darius snapshot list | head -1 | cut -d' ' -f1)
sha256sum ~/.local/share/darius-snapshots/$f      # must equal "sha256" in $f.json
mkdir /tmp/try && tar -xzf ~/.local/share/darius-snapshots/$f -C /tmp/try && diff -rq /tmp/try ~/.local/share/darius
```

The last line unpacks into a scratch folder and compares it with the live store. Only files that
changed since the snapshot show up. Remove `/tmp/try` afterwards. `darius restore <name> --dry-run`
runs more checks without writing, but it refuses while a darius unit is active (see "Restore").

## Set up every host at once

Set the bucket, the settings and the key pair on one host. Then copy them to the others over your
own ssh:

```bash
darius snapshot config push --hosts host-b,host-c               # copy the settings and the key pair
darius snapshot config push --hosts host-b,host-c --overwrite   # also replace other values there
```

Each name in `--hosts` is a name that `ssh` accepts, as in `darius update --hosts`. darius must be
installed there as an app (`~/.local/opt/darius`, or `$DARIUS_APP_DIR`). The push needs a bucket and
a key pair on this host, and exits `1` without them.

What travels: every setting except `dir`, `enabled` and `ping_url`, and the key pair. A new setting
in a later release travels too. What does not travel: `dir`, `enabled` and `ping_url`, which belong
to each host, and the other files of the config folder (`config.toml`, `snapshot.env`, other keys).

The secret goes over ssh stdin and nowhere else. It is never in a command line, an environment
variable, a temp file, or the output. darius on the other host gets it from the same stdin
(`darius snapshot config receive`, a verb for `push` only) and saves it with mode 0600.

Each host gets one ssh call (`ssh -o BatchMode=yes`), one after another. Before it writes, a host
checks what would change:

- A host that holds other values in `snapshot.json` or `config.toml`, or another saved key id,
  writes nothing. The push shows each change, and `--overwrite` replaces them.
- A host whose environment sets a key to another value refuses and names the variable. Change it
  where the service starts. The same value is left as it is and reported.
- A push to this host itself is refused.
- A host whose darius is older names the fix: `darius update --hosts <host>` first.

The settings are saved first, the key pair second. A refused setting leaves the old key pair.
Exit codes: `0` every host done, `1` a host refused, failed or timed out, `2` wrong usage, `3` only
unreachable hosts. A host that timed out may have applied the settings: run `darius snapshot config`
on it.

## A key that cannot delete

Every unattended agent run on a host runs as your Unix user. The run that makes the backup must
read the key, so every other run can read it too. A run that goes wrong, or that a prompt talks
into it, could delete every snapshot in the bucket with that key. The fix has two parts:

1. The key cannot delete. darius then must never try to: set `remote_prune = false`.
2. The bucket keeps history on its own: versioning on, and a lifecycle rule that removes old data.

A key that can write can still overwrite a snapshot. With versioning on, the old copy stays as an
older version, and only the lifecycle rule removes it, after the days you choose.

See "The key threat model" for what this key stops and what it does not.

With `remote_prune = false`:

- A run never deletes in the bucket. `keep_remote` is ignored, and `status` says so.
- `darius snapshot delete <name> --remote` exits `1`. Delete by hand with an admin key, or let the
  lifecycle rule do it.
- A failed upload still aborts its incomplete parts (`s3:AbortMultipartUpload`). That removes no
  snapshot. If the key may not do it, the run warns, and the lifecycle rule cleans up the parts.

### The key's policy

A sample AWS IAM policy for a bucket named `example-darius-snapshots` and the default prefix
`darius`. It has no Delete action. Replace both names with yours.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListAndReadTheBucketState",
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketVersioning", "s3:ListBucketMultipartUploads"],
      "Resource": "arn:aws:s3:::example-darius-snapshots"
    },
    {
      "Sid": "WriteAndReadSnapshots",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:AbortMultipartUpload"],
      "Resource": "arn:aws:s3:::example-darius-snapshots/darius/*"
    }
  ]
}
```

Attach it to a user of its own, for example `arn:aws:iam::123456789012:user/darius-snapshots`, and
give that user nothing else. Keep the admin key, the one that may change versioning and the
lifecycle rule, off the host.

### Versioning and the lifecycle rule

Turn versioning on once, with the admin key:

```bash
aws s3api put-bucket-versioning --bucket example-darius-snapshots \
  --versioning-configuration Status=Enabled
```

Then pick the lifecycle rule that fits the mode. Save it as `lifecycle.json` and apply it:

```bash
aws s3api put-bucket-lifecycle-configuration --bucket example-darius-snapshots \
  --lifecycle-configuration file://lifecycle.json
```

For another S3 service, add `--endpoint-url https://s3.example.com` to both lines.

With `remote_prune = false`, the rule is the only retention in the bucket:

```json
{
  "Rules": [
    {
      "ID": "darius-snapshots",
      "Status": "Enabled",
      "Filter": { "Prefix": "darius/" },
      "Expiration": { "Days": 35 },
      "NoncurrentVersionExpiration": { "NoncurrentDays": 35 },
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 2 }
    }
  ]
}
```

A rule on `darius/` also covers `darius/<host>/monthly/`, so it would expire the monthly copies
after 35 days too. S3 honors the shortest of two overlapping expirations, and a prefix filter is
plain text with no wildcard, so you cannot add a longer rule for "every host's `monthly/`" on top.
With `keep_monthly` above 0, write two rules for each host instead: the daily archives and their
manifests all start with `darius-`, and the monthly copies sit under `monthly/`. For a host named
`host-a`, replace the rule above with these two (and the same pair for every other host):

```json
{
  "Rules": [
    {
      "ID": "darius-snapshots-host-a",
      "Status": "Enabled",
      "Filter": { "Prefix": "darius/host-a/darius-" },
      "Expiration": { "Days": 35 },
      "NoncurrentVersionExpiration": { "NoncurrentDays": 35 },
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 2 }
    },
    {
      "ID": "darius-snapshots-host-a-monthly",
      "Status": "Enabled",
      "Filter": { "Prefix": "darius/host-a/monthly/" },
      "Expiration": { "Days": 400 },
      "NoncurrentVersionExpiration": { "NoncurrentDays": 35 },
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 2 }
    }
  ]
}
```

`Days = 400` keeps about twelve monthly copies. Keep it above `keep_monthly` times 31. The probe
object `darius/.darius-check` then has no rule, so its old versions stay: add a third rule with
`Filter` `{ "Prefix": "darius/.darius-check" }` and only `NoncurrentVersionExpiration`.

`Expiration` removes snapshots older than 35 days, and `NoncurrentVersionExpiration` removes the old
versions 35 days later. Keep `Days` well above the snapshot cadence: a daily snapshot and 35 days
keep about a month. Know the cost: `Expiration` counts days, not snapshots. A host that stops
making snapshots loses its last good ones after `Days`, and a host you stopped for six weeks
returns to an empty folder in the bucket. Watch `darius snapshot status`, and raise `Days` if a
host may stay off for long. AWS does not allow `ExpiredObjectDeleteMarker` next to `Days` in one
`Expiration`, so this rule leaves it out.

With `remote_prune = true`, darius already keeps the newest `keep_remote`. Do not expire current
objects then: a stopped host would lose its last good snapshots for no gain. Remove only old
versions, empty delete markers and incomplete uploads. This rule leaves the monthly copies alone,
because it never expires a current object, so it needs no change for `keep_monthly`:

```json
{
  "Rules": [
    {
      "ID": "darius-snapshots",
      "Status": "Enabled",
      "Filter": { "Prefix": "darius/" },
      "Expiration": { "ExpiredObjectDeleteMarker": true },
      "NoncurrentVersionExpiration": { "NoncurrentDays": 35 },
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 2 }
    }
  ]
}
```

### Prove it

```bash
darius snapshot config set remote_prune false
darius snapshot check
```

`check` prints one line per fact, then a verdict. The good result:

```text
✓ the bucket answers, 12 snapshots of this host
· write: ok (probe darius/.darius-check)
· delete: refused (HTTP 403). The probe darius/.darius-check stays; the next check overwrites it
· versioning: enabled
· remote_prune: off, darius never deletes in the bucket
ok: the key cannot delete, the bucket keeps history
```

A key that cannot delete cannot remove the test object either. So the object stays, under one
fixed name, `<prefix>/.darius-check`. Each check overwrites it, so checks never pile up objects.
With versioning on, each check adds one small old version, and the lifecycle rule removes it.

Warnings still exit `0`. They go into `status.json`, so `darius snapshot status` and the settings
page show them until the next check. `darius snapshot check --json` adds `delete`
(`deleted` or `refused`), `versioning` (`enabled`, `suspended`, `off` or `unknown`) and `warnings`.
Only a list or write that fails, a delete or a versioning read that fails with any status but 403,
exits `1`.

The versioning warning appears only with `remote_prune = false`. With `remote_prune = true` and a key
that may delete, the verdict is `ok: the key may delete, and darius prunes the bucket (remote_prune on)`.

`versioning: unknown` means the service did not say. SeaweedFS has versioning per bucket in recent
releases, and answers. A service without the feature answers with an error code, and `check` then
prints `unknown` and warns in the no-delete mode.

## See every host and the alarms

### See every host

Every `darius snapshot create` leaves one line in the `_global` ledger. The sync timer carries that
ledger to every host. So any host can list the last backup of every host, offline:

```bash
darius snapshot status --hosts          # one row per host, newest good snapshot first
darius snapshot status --hosts --json   # {hosts: [...], stale_after_ms}
```

Each row shows the host, its state, the age of its last good snapshot, the snapshot name and size,
and what the bucket copy did (`bucket ok`, `bucket failed: <why>` or `no bucket copy`), followed by
the bucket as `<endpoint host>/<bucket>`. The prefix is added (`/<prefix>`) only when it is not
`darius`. A host with no bucket shows `no bucket`. The state is one of five words:

| State | Meaning |
|---|---|
| `ok` | the last good snapshot is younger than 36 hours |
| `stale` | the last good snapshot is older than 36 hours, or there is none. With a bucket, the bucket copy counts: no upload that worked in 36 hours is stale, even when the local archives are fresh |
| `failed` | the newest run failed, but the last good snapshot is younger than 36 hours |
| `off` | the host turned snapshots off on purpose (`enabled = false`) |
| `silent` | the host wrote no ledger line of any kind for 30 days: gone, not late. It does not count as stale and raises no alarm |

`--json` is the full record of each host. Among other fields it holds `bucket`: the endpoint host
name, the bucket and the prefix of the last good snapshot. If the hosts that back up (`ok`, `stale`
or `failed`) name more than one bucket, the text output prints `! hosts back up to different
buckets` under the rows. Hosts with no bucket take no part. The text output names `silent` hosts in
one last line and lists no row for them.

A host with a bucket is judged on its offsite copy. If the uploads fail every day (an expired key, a
deleted bucket), its local archives stay fresh, but the host turns `stale` once 36 hours pass with no
upload that worked. The row and `--json` (`reason`) say why, for example `no upload for 40 h`. A host
with no bucket is judged on its local archive, as before. A run with `--no-upload` is not an upload.

The three line types are `snapshot.ok`, `snapshot.failed` and `snapshot.off`. A run that made a
local archive is `snapshot.ok`, also when the bucket copy failed: read the bucket column too. A line
names the endpoint by its host name only, then the bucket and the prefix. It never holds the key pair or a full endpoint URL. If the
line cannot be written, the run prints a warning and keeps its exit code. A run that finds another
run holding the lock writes no line.

### Alarms

Three things tell you that a backup failed or stopped.

**The page.** On `/status`, each host in the Hosts list has a "last backup" line: a state word, the
age of its last good snapshot, and "none" for a host that wrote no snapshot line. The states are the
five of "See every host", and for a stale host the reason ("no upload for 40 h"). It also shows the
bucket of the host (`no bucket` when it has none). When hosts name different buckets, the card says
so in one line.
`/api/status.json` carries the same under `hosts[].backup` (`state`, `lastOkAt`, `ageMs`, `name`,
`error`, `reason`, `bucket`). Both read the synced `_global` ledger and never reach a bucket.

**Push.** If a host has push keys and a subscribed device (see `darius push`), two alerts exist:

- *Backup failed on host-a.* The host that failed sends this one, from its own `snapshot.failed`
  line. The body is the error. It goes out once per line.
- *No backup from host-b for 50 hours.* A stale host leaves no line, so one other host must watch.
  The watcher is the host with the smallest host id among the hosts that wrote any `_global` line in
  the last 36 hours. Every host computes this from the same synced ledger, so there is no lease. The
  watcher sends one notice per stale host per UTC day, with the reason in the text. A host whose
  uploads fail is stale too, so a dead key or bucket raises the alarm. A host that is `off` or
  `silent` gets none. If the smallest host goes quiet, the next one takes over and may repeat one
  notice that day.

The watcher needs push on its own host. A mesh where the watcher has no device sends no stale alert.
This is why the ping below exists.

**Dead-man ping.** Set `ping_url` to an address from a service such as healthchecks.io. After a run,
darius sends one GET. After a good run (a local archive, and the bucket copy done or not asked for)
it calls the address. After any other result it calls the address with `/fail` added. It never sends
`/start`. The wait is 10 seconds. A ping that fails is a warning in the run's output and never changes
the exit code. A run that finds another run holding the lock sends nothing, and neither does a host
with `enabled = false`. A run with `--no-upload` on a host with a bucket sends nothing either. Make one check per host in the service: `ping_url` stays on each host and is
not copied by `config push`.

```bash
darius snapshot config set ping_url https://ping.example.com/your-check-id   # or the page, or snapshot.env
```

Use `https`. Plain `http` works only with `allow_http` and a loopback or tailnet address. The address
lets anyone fake a ping, so treat it like a key. `snapshot config`, `snapshot status`, the page and
every warning show only the scheme and host. No ledger line holds it. A command typed in a shell stays
in the shell history; the page or `snapshot.env` does not.

## Settings and the key pair

### Settings

Open `/settings/backups` on the status page to change them, or use the CLI. A setting that an
environment variable sets is locked on the page, and the page names the variable. The page never
shows the secret key.

```bash
darius snapshot config                    # every key, its value, and where the value comes from
darius snapshot config set keep 14        # save one value
darius snapshot config set endpoint https://s3.example.com bucket example-darius-snapshots   # these two go together
darius snapshot config unset keep         # back to config.toml or the default
```

The page and the CLI save to the same file and check values with the same rules. A bad value exits
`1` with the same message the page shows. A key that an environment variable sets exits `1`, and the
message names the variable. An unknown key exits `2` and lists the keys. `snapshot config` itself
exits `1` while any setting has a problem.

Four places can set a value. The first one that has a valid value wins:

1. the environment, `DARIUS_SNAPSHOT_<KEY>`
2. the settings page, which saves to `~/.config/darius/snapshot.json`
3. `[snapshot]` in `config.toml`
4. the default

| Key | Environment variable | Default | Meaning |
|---|---|---|---|
| `enabled` | `DARIUS_SNAPSHOT_ENABLED` | `true` | `false` turns snapshots off. The timer still fires, does nothing and leaves a `snapshot.off` line |
| `dir` | `DARIUS_SNAPSHOT_DIR` | `~/.local/share/darius-snapshots` | the local folder. It must lie outside the store and the config folder |
| `keep` | `DARIUS_SNAPSHOT_KEEP` | `7` | snapshots to keep on this host (1 to 3650) |
| `endpoint` | `DARIUS_SNAPSHOT_ENDPOINT` | empty | the S3 address, for example `https://s3.example.com` |
| `bucket` | `DARIUS_SNAPSHOT_BUCKET` | empty | the bucket name. With `endpoint`, it turns the bucket copy on |
| `region` | `DARIUS_SNAPSHOT_REGION` | `us-east-1` | the region the service expects |
| `prefix` | `DARIUS_SNAPSHOT_PREFIX` | `darius` | a folder inside the bucket |
| `keep_remote` | `DARIUS_SNAPSHOT_KEEP_REMOTE` | `30` | snapshots to keep in the bucket. Ignored when `remote_prune` is `false` |
| `keep_monthly` | `DARIUS_SNAPSHOT_KEEP_MONTHLY` | `0` | monthly copies to keep in the bucket (0 to 120). `0` is off. See "Monthly copies". Pruned only when `remote_prune` is `true` |
| `remote_prune` | `DARIUS_SNAPSHOT_REMOTE_PRUNE` | `true` | `false`: darius never deletes in the bucket. Use it with a key that cannot delete |
| `path_style` | `DARIUS_SNAPSHOT_PATH_STYLE` | `true` | put the bucket name in the path, not in the host name |
| `allow_http` | `DARIUS_SNAPSHOT_ALLOW_HTTP` | `false` | allow plain HTTP. Only for loopback and the tailnet |
| `sse` | `DARIUS_SNAPSHOT_SSE` | `false` | ask the service to encrypt each object |
| `ping_url` | `DARIUS_SNAPSHOT_PING_URL` | empty | the dead-man ping address (see "Alarms"). It is a secret, so every output shows only `https://host/...`. A push to other hosts never sends it |

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
bucket = "example-darius-snapshots"
prefix = "darius"
keep_remote = 30
```

### The key pair

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

### Monthly copies

The daily copies in the bucket last `keep_remote` days. A mistake you find after that has no copy
to go back to. Set `keep_monthly` above 0 and the first good snapshot of each UTC month is also
kept as `<prefix>/<host>/monthly/<name>`, with its manifest. The bucket makes the copy itself
(CopyObject), so the archive is not sent again. An archive over 5 GB, or a service that answers
400 to the copy, gets a normal upload from the local file. A run that fails to reach the bucket
makes no monthly copy, and a monthly copy that fails is a warning, not a failed run. The next run
of that month tries again. `list --remote` tags monthly copies `monthly`, `status` shows the
newest, and `darius snapshot fetch monthly/<name>` brings one back. With `remote_prune = true`,
darius keeps the newest `keep_monthly` there and touches only the `monthly/` folder. With
`remote_prune = false`, darius deletes nothing, so `keep_monthly` is not a limit: the bucket's
lifecycle rule governs the monthly copies too. See "Versioning and the lifecycle rule" for a
longer rule by prefix.

## Commands

```bash
darius snapshot create [--no-upload]       # make a snapshot, copy it to the bucket, delete the old ones
darius snapshot list [--remote]            # the snapshots on this host, newest first; --remote: the bucket's too
darius snapshot status                     # the settings summary, the timer, the last run, problems
darius snapshot status --hosts             # the last snapshot line of every host, from the synced ledger
darius snapshot check                      # list the bucket, write a test object, try to delete it, ask for versioning
darius snapshot fetch <name> [--host <host>]   # copy a snapshot and its manifest from the bucket (GET only); monthly/<name> for a monthly copy
darius snapshot delete <name> [--remote]   # delete one snapshot, here or in the bucket (--remote needs remote_prune on)
darius snapshot config [set <key> <value> | unset <key>]   # show or change the settings
darius snapshot config push --hosts <a,b> [--overwrite]    # copy settings and key pair to other hosts
darius snapshot credentials [status | set --key-id <id> | clear]   # the key pair; the secret on stdin
darius restore <name> [--runs-only] [--from-host <host>] [--dry-run] [--yes]   # bring the store back from a snapshot
darius sync --reseed (--project <name> | --all-projects)  # refill an empty sync bucket from this host
```

Each verb acts on the host you type it on. Every action on the settings page has a verb here, except
that the page has no restore. `--json` works on all of them.

Exit codes of `darius snapshot`: `0` done (also when snapshots are off, and for `check` with
warnings). `1` refused or failed. `2` wrong usage. `3` the snapshot is saved on the host, but the
bucket could not be reached. The next run makes a new snapshot and sends that one. It does not send
the missed one again. A run that exits `3` still counts as a good local backup, so `status` shows
the last run as `ok`. Read its bucket line too. `list --remote` exits `1` when no bucket is set up,
and `3` when it cannot reach the bucket. `fetch` does the same. `status` exits `1` while a setting
has a problem. `status --hosts` always exits `0`.

Exit codes of `darius restore`: `0` done, or a dry run that passed. `1` refused or failed. `2` wrong
usage. Exit codes of `darius sync`: `0` done, `1` a project failed or no `[remote]` is set, `2` wrong
usage (`--reseed` without a project selection, or with `--pull-only`), `3` the bucket could not be
reached.

## Recovery playbooks

Read these before you need them. Each playbook says what you lose. The first part is the reference
for `darius restore`. The playbooks after it use it.

### Restore

`darius restore` brings a store back from a snapshot. Only you run it, never a ritual run, and
the web page has no restore button.

```bash
darius snapshot list --remote                  # the snapshots of this host in the bucket
darius snapshot fetch <name>                   # only when the snapshot is not on this host
systemctl --user stop darius-web darius-sync.timer darius-run-due.timer darius-vigil-sweep.timer darius-snapshot.timer darius-sync.service darius-run-due.service darius-vigil-sweep.service darius-snapshot.service
darius restore <name> --dry-run                # every check, the file counts, nothing written
darius restore <name> --yes                    # the restore
```

`<name>` is a snapshot name in the snapshot folder, or a path to a `.tar.gz` file. The manifest
`<name>.json` must lie next to it. `fetch` brings both, checks the size and the SHA-256, and uses
GET only, so it works with a key that cannot write.

The verb refuses, with exit `1`, and changes nothing, when:

- the call comes from a ritual run (`DARIUS_RUN` is set);
- the archive or the manifest is missing, or the file's size or SHA-256 differs from the manifest;
- the snapshot is of another host. Add `--from-host <host>` if you mean it. The other host's
  ledger lines then stay under its name and are never pushed from here;
- one of the units above is active. A timer's service counts too, since it keeps running after its
  timer stops. It prints the stop line;
- the store folder is a symlink or a mount point. Restore it by hand (see "By hand");
- a snapshot run or a darius command holds a lock. These checks run again after you confirm;
- an entry in the archive has an absolute path, holds `..`, or is not a plain file or folder;
- you give no `--yes` and stdin is not a terminal. On a terminal it asks you to type `yes`.

`--dry-run` runs the same checks, so it refuses while a unit is active too.

A full restore unpacks the archive next to the store and checks every ledger file. Tar can catch
a file in the middle of an append. So the verb trims one cut last line from an `open.jsonl` or a
run's `gate.jsonl`, and it names each file it trims. Any other bad ledger line means a damaged
archive, and the verb stops. A bad line inside a run's `gate.jsonl` is a warning only. Then the verb
renames the store to `darius.before-restore-<stamp>`, puts the new one in its place, and writes a
`store.restored` line to `_global`. It never deletes the old store. Delete it by hand when you are
sure.

The snapshot's `sync.json` comes back too. The next sync pulls every change the bucket got after
the snapshot. Changes this host made after the snapshot and never synced are lost. A `sync.json`
that does not parse is removed with a notice, and the next sync pulls everything again. The lock
files of the snapshot belong to dead processes, and the verb drops them.

After a full restore:

```bash
darius sync --all-projects                     # pull what the bucket got after the snapshot
systemctl --user start darius-web darius-sync.timer darius-run-due.timer darius-vigil-sweep.timer darius-snapshot.timer
darius snapshot status --hosts
darius ritual list                             # the store reads
```

If the sync bucket was lost as well, use `darius sync --reseed --all-projects` instead of the first
line (see "When the sync bucket is lost").

`--runs-only` restores only run folders (`<project>/runs/<run>`) into the live store. It skips a run
folder that exists, and a project this host does not have yet. It needs a store, so sync first. It
writes nothing outside `runs/`. Only `darius-run-due.timer` and `darius-run-due.service` must be stopped for it.

### One host lost

A host is gone, but the other hosts, the sync bucket and the snapshot bucket are fine. You lose
the lines the host wrote after its last sync (the sync timer runs every 15 minutes), the run folders
it made after its last snapshot (up to a day), and its config folder. You bring back the rest.

1. On the new machine, install darius (see the README, "Install"). Run `darius setup` with no
   `--systemd`. It writes the config skeleton and the state dir and starts no unit.
2. In `~/.config/darius/config.toml`, set `host = "host-a"`, the id of the lost host. Add the
   `[remote]` table of the sync bucket and its `credentials` file by hand. No backup holds them.
3. On a healthy host, copy the snapshot settings and the key pair:
   `darius snapshot config push --hosts <new machine>`. If you cannot push, run
   `darius snapshot config set` and `darius snapshot credentials set` on the new machine.
4. Pull the projects. Run `darius sync --project <name>` for each project the host had, then
   `darius sync --all-projects`.
5. Fetch the newest snapshot of the lost host: `darius snapshot list --remote`, then
   `darius snapshot fetch <name>`.
6. Run `darius restore <name> --runs-only --dry-run`, then `darius restore <name> --runs-only --yes`.
   Nothing from the snapshot overwrites what sync pulled.
7. Run `darius init` in each checkout. Then `darius setup --systemd` to install and start the units,
   and `darius snapshot create` to make the first snapshot of the new host.

If the new machine must have another id, skip the id in step 2. `list --remote` then shows nothing,
because it lists the snapshots of this host only. Read the name of the lost host's newest snapshot
with `darius snapshot status --hosts` on a healthy host, fetch it with that name, and add
`--from-host host-a` to both `restore` calls.

### The whole mesh lost

Every host is gone, and so is the sync bucket. The snapshot bucket survives, because it lives on
another machine. You lose, on each host, what it wrote after its newest snapshot, except what a
newer snapshot of another host already holds. The sync bucket is rebuilt from the stores.

1. Start with the host whose newest snapshot is the latest. Look at the folders `<prefix>/<host>/`
   of the snapshot bucket with any S3 tool. Install darius, run `darius setup` with no `--systemd`,
   and set `host` in `config.toml` as in step 2 of "One host lost". Add the new `[remote]` table and
   its credentials.
2. No healthy host can push the snapshot settings. Run
   `darius snapshot config set endpoint https://s3.example.com bucket example-darius-snapshots`
   and `printf %s "$SECRET" | darius snapshot credentials set --key-id <key id>`.
3. `darius snapshot fetch <newest snapshot of this host>`, then `darius restore <name> --dry-run`,
   then `darius restore <name> --yes`. This is a full restore. There is no unit to stop yet.
4. Make the sync bucket exist again, with `darius setup --remote` or by hand. Run
   `darius sync --reseed --all-projects`. Plain `sync` cannot refill an empty bucket.
5. Start the units: `darius setup --systemd`.
6. On every other host, repeat steps 1 to 3 with its own newest snapshot. You can now copy the
   snapshot settings from the first host with `darius snapshot config push --hosts <host>`. Then run
   `darius sync --reseed --all-projects` there too, and `darius setup --systemd`. A plain sync would
   skip chunks that this host's restored `sync.json` marks as sent, and the bucket may not hold them.
   The reseed is safe on a bucket that is not empty.
7. Run `darius snapshot status --hosts` on any host. Every host should show `ok` after its first
   new snapshot.

If the snapshot bucket is gone too, only the local snapshots on a surviving disk help. Restore
from one of them with the same verbs.

### When the sync bucket is lost

The sync bucket holds no copy that a host lacks. Every host keeps a full copy of each project it
syncs. If the bucket is empty, deleted or corrupt, one host can fill it again. A plain
`darius sync` cannot do this: it pushes only its own chunks, and only those it has not pushed
before. The hosts' stores are fine, so you lose nothing in them. The lines in a host's `open.jsonl`
that never reached the bucket go out on its next plain sync.

1. Stop the timers on every host, so that no host syncs while the bucket is rebuilt:
   `systemctl --user stop darius-sync.timer darius-run-due.timer darius-vigil-sweep.timer darius-sync.service darius-run-due.service darius-vigil-sweep.service`.
2. Pick the host with the most complete store. Look at `last_sync` in `sync.json` of each project
   (under `~/.local/share/darius/<project>/`). The host that synced last is usually the one. Any
   host that holds every chunk of every host will do.
3. If the bucket holds a corrupt object, delete that object, or empty the bucket. `--reseed` never
   rewrites an object that exists. Then, on the chosen host, make the bucket exist again: run
   `darius setup --remote`, or create the bucket by hand.
4. On that host, run `darius sync --reseed --all-projects`.
5. Start the timers again on that host. Then, on every other host, run
   `darius sync --reseed --all-projects` and start the timers. A plain
   `darius sync --all-projects` is enough when the chosen host held every chunk. The reseed also
   covers a chunk that only the host that wrote it still has, and it is safe to repeat.

`--reseed` first pulls what the bucket still has. Then it puts back every chunk of every host in
the local store, and every blob in the store, even a blob that no line names. Every put is
`If-None-Match`, so an object that is already in the bucket is never rewritten. Items and the
manifest follow the normal sync rule. The report says `reseed: true`. A second `--reseed` reports
`0` chunks and `0` blobs out. That is how you know the bucket is whole.

A reseed does not bring back the lines in another host's `open.jsonl`, because they never reached
the bucket. That host sends them on its next plain sync. A reseed does not touch `lease.json` and
does not rebuild `leases/`, apart from the lease that every sync takes and releases. It is safe on a
bucket that is not empty. `--reseed` needs `--project` or `--all-projects`, and it cannot be
combined with `--pull-only`.

### By hand

The hand recipe is the fallback. The archive is a plain `tar.gz`, so it also restores without
darius. Do the checks yourself:

```bash
systemctl --user stop darius-web darius-snapshot.timer darius-sync.timer darius-run-due.timer darius-vigil-sweep.timer darius-snapshot.service darius-sync.service darius-run-due.service darius-vigil-sweep.service
sha256sum <name>                       # must equal "sha256" in <name>.json
mv ~/.local/share/darius ~/.local/share/darius.before-restore
mkdir ~/.local/share/darius
tar -xzf <name> -C ~/.local/share/darius
systemctl --user start darius-web darius-snapshot.timer darius-sync.timer darius-run-due.timer darius-vigil-sweep.timer
```

If you set `DARIUS_STATE_DIR`, use that folder instead of `~/.local/share/darius`. This recipe does
not trim a cut last line and does not check the ledger files. Prefer `darius restore`.

## The key threat model

**The risk.** Every unattended agent run on a host is a process of your Unix user. The run that
makes the backup must read the key pair, so any other run on that host can read it too. A run can
also run `darius` verbs, so it can change the snapshot settings on that host. Prompt injection, a
bad tool call or a plain mistake can turn a run into the attacker. This section says what the
no-delete key stops in that case, and what it does not.

**What the no-delete key stops.** A key without `s3:DeleteObject` and `s3:DeleteObjectVersion`
cannot remove a snapshot or an old version in the bucket, in any mode. With versioning on, an
overwrite keeps the older copy, and only the lifecycle rule removes it, after the days you set. The admin key, which may change versioning and the lifecycle rule, stays off the
host. `remote_prune = false` makes darius itself never try to delete. The key policy is the real
guard: a run that sets `remote_prune = true` again only makes the next prune fail with a 403 and
delete nothing.

**What it does not stop.**

| A run can still | Why | What you can do |
|---|---|---|
| Read every snapshot in the bucket | The key reads objects (`s3:GetObject`), and a restore needs that. A snapshot holds the whole store. `sse` encrypts at rest on the server only | Keep the bucket private. Rotate the key if you think it leaked (below) |
| Overwrite a snapshot with junk | The key writes objects | Keep versioning on. Set `Days` in the lifecycle rule above the time you need to notice |
| Fill the bucket | The key writes objects | Watch the bucket's size at the service |
| Delete the local snapshots and the store on this host | They are files of the same Unix user, on the same disk | This is why the bucket copy exists |
| Change the settings on this host and point the next snapshot at another bucket | `darius snapshot config set` or an edit of `snapshot.json` is allowed to the user. The new endpoint must pass the `allow_http` rule, nothing more | See below |
| Push that change to other hosts | `snapshot config push --overwrite` uses your ssh. It works if the user's ssh keys log in without a prompt | Protect the ssh keys of that user as you protect the bucket key |

**The settings change.** After it, the old bucket gets no new snapshot. Nothing alarms by itself,
because the upload to the new bucket works, so the host stays `ok`. The change leaves a trace. The
`snapshot.ok` line that every run writes holds the bucket: the endpoint host name, the bucket name
and the prefix. The sync timer carries that line to every host. So on any host:

```bash
darius snapshot status --hosts
```

Each row ends with the bucket of that host. Compare the rows with the buckets you expect. If the
hosts name different buckets, a line under the rows says so, and the hosts card on `/status` shows
the same line. The signal is a difference, so it stays quiet if you switch every host. `--json` has
the full record (`hosts[].bucket`) for a script. A key never appears in a line, and a line names the
endpoint by its host name only. Settings never travel
through the sync bucket, so a bad object in that bucket cannot point a host elsewhere.

**If the key leaks.** Disable the key at the service. Make a new pair with the same policy. Save it
on one host with `printf %s "$SECRET" | darius snapshot credentials set --key-id <new key id>`, then
copy it with `darius snapshot config push --hosts host-b,host-c --overwrite`. Then run
`darius snapshot check` on every host. Look at the bucket's versions for objects you did not write.

**What stays outside this model.** A run with root, a stolen admin key, and the service itself are
not covered. The model also assumes that you read the alarms: a snapshot that stops is only a
backup problem if nobody sees it.

## Troubleshooting and the retired git backup

### When something goes wrong

| What you see | Why | What to do |
|---|---|---|
| Exit `3`, or a failed bucket line | the bucket could not be reached | Fix the network or the endpoint. Run `darius snapshot check` |
| "no access key" | no key pair on this host | Save the key pair |
| `timer: not installed` in `status` | the timer unit is missing | Run the command the line names |
| `status` lists problems | a setting has a bad value | Fix the value where `status` says it comes from |
| "the store holds a name that looks like a secret" | a file named like a secret is in the store | Remove it from `~/.local/share/darius` |
| "a snapshot is already running" | another run holds the lock | Wait. A lock of a dead process, or one over 12 hours old, is taken over by itself |
| A run was killed half way | the host restarted, or the page service restarted | Nothing. The next run removes the half-written file and runs normally |
| `check` warns "the key cannot delete, but remote_prune is on" | the key has no delete right, so pruning fails | `darius snapshot config set remote_prune false`, and add a lifecycle rule |
| `check` warns "the key may delete objects" | `remote_prune` is off, but the key still has a delete right | Make a key without `s3:DeleteObject` and `s3:DeleteObjectVersion` |
| `check` warns "versioning is off" (or `suspended`, `unknown`) | `remote_prune` is off and the bucket does not keep old versions | Turn versioning on (see "A key that cannot delete") |
| "remote_prune is off: delete in the bucket by hand" | `delete --remote` with `remote_prune = false` | Delete it with an admin key and any S3 tool, or let the lifecycle rule do it |
| `restore` names an active unit, a held lock or a host mismatch | a check failed before anything was written | Run the stop line it prints, wait for the lock, or add `--from-host` (see "Restore") |
| `config push` says "this host has other values" | the other host holds its own settings or key id | Read the changes it shows, then add `--overwrite` |
| A warning names `s3:AbortMultipartUpload` | a failed upload could not be cleaned up | Give the key that right, or let the lifecycle rule remove incomplete uploads |

The settings page shows the same state: the last backup, the bucket, and any problems.

### Moving off the git backup

Version 0.43.0 had `darius export` and a `[backup]` table. Both are gone. `darius update` removes
the old `darius-export` timer on its own. Two things stay for you to delete by hand: the old
local clone (`~/.local/share/darius-backup` by default) and the private git repo it pushed to. An
old `[backup]` table in `config.toml` does no harm. A `"export"` entry in `[setup] units` is an
error: remove it.
