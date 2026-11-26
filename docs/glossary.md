# Glossary

This file is the one source for the words darius uses. It says what each term means. It says which
word to use on which surface. It lists the words not to use.

The rule: **one thing, one word per surface.** A surface is a place where a person reads darius
words: the command line (CLI), the config files, the ledger, or the web app. When two surfaces use
two words for one thing, this file maps them. A word never means two things on one surface.

## The model in one paragraph

A **machine** is a computer that runs darius. A **workspace** is one tracked project. A machine
**runs** a workspace when the project folder is linked there. Otherwise it only shows a **copy**.
A workspace holds **rituals**: recurring work that darius starts by itself, on a schedule. When a
ritual is due, darius starts a **djinn**: an unattended session that performs that one ritual. The
work of one djinn is one **run**. A run may stop and ask a question. Then it is **held** until you
answer. A **vigil** is a one-time check that waits for a date or an event. A **candle** is a
problem that needs your decision. A run can report **findings**: items for the record, tracked
from run to run by key.

```text
machine ---runs---> workspace ---holds---> ritual ---is performed by---> djinn
   |                    |                     |                            |
   |                    |                     +-- each execution --------> run
   |                    |                                                    |
   +--shows a copy of---+                                                    +--> findings
                        +---holds---> vigil  --(its check fails)--> flagged
                        +---holds---> candle (lit by a run, a script or a vigil)
```

## Web words and CLI words

The CLI, the config files and the ledger say **project** and **host**. The web app says
**workspace** and **machine**. They are the same things. The web app never shows the words host or
project in visible text. The CLI never says workspace or machine.

| Web word | CLI and config word | Meaning |
|---|---|---|
| machine | host | A computer that runs darius. |
| workspace | project | One tracked repo, named in its `.darius.toml`. |
| a machine runs a workspace | checkout (internal), `darius link` | The project folder is linked on that machine. |
| copy | mirrored project (`[sync] mirror = true`) | A workspace a machine shows but does not run. |
| late | overdue | The due time has passed and the work has not run. |
| waits for your answer | held (a run) | A run stopped to ask you, or finished with an open question. |
| sandbox check | `darius box check` | The test that the run sandbox works on a machine. |
| activity, last activity | ledger | The record of what happened. |
| backed up, backup stale, backup failed | snapshot (file), `darius snapshot` | The daily copy of a machine's store. |
| needs you | needs-decision, needs-you | An item that waits for a person. |
| unreachable | offline, unreachable | A machine that did not answer. |

## Places

**Machine** (web) or **host** (CLI, config). One computer that runs darius. Each host keeps its own
copy of the store and syncs through the bucket.
- Web: Machines place. CLI: `host` in config and ledger lines.
- Do not say: node, server, box (the box is the sandbox).

**Workspace** (web) or **project** (CLI, config). One tracked repo. Its name comes from the
`project` key in `.darius.toml`. It holds rituals, vigils, candles and findings.
- Web: Workspaces place. CLI: `--project`.
- Do not say: repo, when you mean the tracked thing. The repo is only its git folder.

**Store.** The state of darius on one host. It lives outside your git repo, in
`~/.local/share/darius`. It holds item files and ledgers.
- Do not say: database, cache.

**Bucket.** An S3-compatible bucket that you run. The stores of all hosts sync through it.
- Do not say: cloud, remote store.

**Ledger.** The append-only record of what happened: runs, answers, evidence, notes and changes.
Status is never stored. darius computes it from the ledger.
- Web: "activity" and "last activity". CLI and docs: ledger.
- Do not say: log, history (for the ledger itself).

**Marker.** The `.darius.toml` file at the root of a repo. It names the project and, in version 3,
holds the rituals and policies. It is committed to git. `darius marker check` checks it.
- Do not say: config (config is `config.toml`, one per host).

**Link.** `darius link` records which folder holds a project on this host. The folder is the
project's **checkout**. A host with a link runs the project. This is `links.toml`.
- Web: "a machine runs a workspace". Do not say: attach, bind.

**Copy.** A workspace a machine can show but does not run, because no folder is linked there.
- Web: copy. CLI: a mirrored project. Do not say: replica, clone.

**Mirror.** The setting `[sync] mirror = true` and the act of pulling every bucket project onto a
host. "Mirror" names the setting and the act. "Copy" names the result.
- A mirrored copy never runs work until `darius link` names a folder. Its runs skip as `no-workdir`.

**Sync.** `darius sync` copies the store to the bucket and back. A timer runs it every 15 minutes.

## Work

**Ritual.** Recurring work that darius starts by itself, on a schedule. A skill holds its steps. A
ritual is the thing you list, count and open. It is a table in `.darius.toml`.
- Web and CLI: ritual. Say "11 rituals".
- Do not say: djinn (for the ritual), job, task, cron.

**Djinn.** The unattended session that darius starts to perform one ritual. It exists only while it
runs. A djinn performs a ritual. It is never a row, a column or a count.
- The Machines pages do not use the word; they say "starts 11 rituals". Never say "11 djinns".
- Do not say: agent, bot, worker, daemon, for a ritual.

**Skill.** A folder `.claude/skills/<name>/SKILL.md` in the repo. It holds the steps of one
ritual. A ritual names its skill with `skill = "..."`.
- Do not say: script, prompt, playbook.

**Policy.** The limits of a ritual: its mode, the commands it may use (`may`) and the patterns that
stop it (`hold`). A policy may have a name in `[policies.*]`.
- Do not say: permissions (a profile has a `permissions` key, a different thing).

**Mode.** The `mode` of a policy. `off`: the timer never starts the ritual, and only a person does.
`report`: the timer starts it and it may read and write findings. `act`: it may also run the
commands in `may`. `max_mode` in the marker caps every ritual.
- Do not say: level, tier.

**Cadence.** How often a ritual is due, such as `1d` or `1w`. With `at = "07:00"` it names a time.
- Do not say: frequency, interval.

**Due.** A ritual is due when its next due time has come and no run has met it. `darius due` lists
due work.

**Late** (web) or **overdue** (CLI). The same state. The due time has passed and the work has not
run. The web app says "3 days late". The CLI says overdue.
- Do not say: missed, expired.

**Pinned.** A ritual pinned to one host runs only there. Without a pin, the host with the link runs
it.
- Do not say: assigned.

**Run.** One execution of a ritual, by a djinn or by hand. It ends with one outcome. The ledger
records it from `run.started` to `run.completed`.
- Do not say: job, task, execution, session (the session is the djinn).

**Held.** A run is held when it stops to ask you a question. It waits until you answer. Then it
resumes with the same run id. The web app says "waits for your answer".
- A vigil also has a verdict "held". It means the check passed. See "Words with more than one
  meaning".
- Do not say: paused (a ritual or vigil is paused, a run is held), blocked, stuck.

**Question.** A thing a run asks in its result block. It may list the exact commands a yes would
run. A held run has questions. A complete run may end with an open question too.

**Answer.** Your reply to a question. `darius run answer`, or the web form. A reply to a candle is
also an answer, but it is a different act (see Candle).

**Ack.** `darius run ack` marks a failed or abandoned run, or a complete run with an open
question, as seen. It then stops asking for you. It can carry one answer per question and a note to
the next run of the ritual. It refuses a held run: answer and resume that one. It refuses a second
ack. The web app shows "Failed, seen".
- Do not say: dismiss, for an ack. The web button "Dismiss all earlier asks" is another action.

**Follow-up.** A run you start by hand after you approve a question. It may run the approved
commands as written, and nothing else is new. It never counts as a completion of the schedule.
`darius run follow-up`.

**Outcome.** How a run ended. Only three exist: `complete`, `failed`, `abandoned`. A run that
stops to ask is held, and it has no outcome yet.
- Do not say: result (the result is the block of findings a run hands in), status.

**Skip reason.** Why the runner did not start a due ritual. Examples: `policy-off`, `other-host`,
`held`, `open-run`, `failed-today`, `lease-held`, `no-workdir`, `box-broken`, `checkout-behind`,
`marker-dirty`, `skill-missing`. A skip is not a run and has no outcome. The full list is the
`SkipReason` type in `src/runner/report.ts`.
- Do not say: failure, for a skip.

## Checks and problems

**Vigil.** A one-time check that waits for a date or an event, such as "check the logs after the
first real batch". It has a due date, an event gate, or both. You close it with a verdict.
- Do not say: reminder, monitor, alert.

**Sweep.** The timer job that runs due vigil checks. It runs daily at 06:30 local time on every
host. One host wins per project and day. `darius vigil sweep`.
- Do not say: scan, cron (for the sweep).

**Flagged.** A vigil whose check failed and needs a look. It stays open. The web app adds why:
"Pending" when the failure is the expected one, "Check broken" when the check itself broke.
- Do not say: failing (that is a health word), red.

**Verdict.** How a vigil closed: `held` (the check passed) or `failed`. A sweep closes a vigil as
held when every check passes.

**Candle.** A problem that needs the operator's decision. A run, a script or a failed vigil lights
it, by project and key. It has no schedule and does no work. It has four states: lit, answered,
accepted, out.
- Do not say: alert, ticket, issue, incident.

**Lit, answered, accepted, out.** The candle states. Lit: open and waiting for you. Answered: you
replied. Accepted: you took the risk. Out: the cause is fixed, or you blew it out.
- Do not say: open, closed, resolved, for a candle.

**Finding.** An item that a run reports for the record. It has a key, so darius tracks it from run
to run. It is not a decision request. If it needs a decision, light a candle.
- States: open, needs-you, closed, lapsed, fixed.
- Do not say: issue, bug, alert.

**Key.** The stable name of a finding or a candle. One line, at most 120 characters. The same
problem carries the same key in every report.

**Severity.** How bad an item is: `critical`, `high`, `medium`, `low`, `info`. Findings and
candles carry one.
- Do not say: priority, level.

## Health

The web app gives each workspace one health word. The first rule that matches wins. The rules are
in `src/web/health.ts`. A short counted reason, such as "2 candles lit", always comes with the
word.

**Unreadable.** The store or the marker cannot be read.

**Failing.** One of these holds: a lit candle of severity high or critical, a flagged vigil, or an
active ritual whose last two runs failed.

**Needs you.** None of the above, and one of these holds: a lit candle below high; a finding that
needs a decision; a held run; a late ritual; a vigil that is due or late; an active ritual whose
last run failed once; a copy this machine last synced over 45 minutes ago; a tree conflict; a
ritual that cannot start here (the box is broken, or the checkout is behind).

**Quiet.** None of the above, and no ledger line in 14 days, and nothing active: no active ritual
and no open vigil. Version, alert and sync lines do not count as activity.

**OK.** None of the above.

**Needs you** (the word, outside health). Anything that waits for a person: a held run, a run with
an open question, a lit candle, a finding in needs-you. The web app shows these on Overview.
- Do not say: action required, attention, pending (Pending is a flagged-vigil word).

## Tracker

**Milestone.** A goal with an ordered list of specs. It is open until its specs are done.

**Spec.** A unit of work with a goal, requirements and checks. A spec is done when all its checks
are ticked.

**Worklog.** A thread of notes that agents share across sessions.

Milestones, specs and worklogs live in the darius store, never in a `.tracker/` folder, in a
project whose marker lists `milestone` in `kinds`. A `.tracker/` folder in git is the deprecated
mode.
- Do not say: ticket, task, epic.

## Safety and upkeep

**Box** (CLI, config) and **sandbox** (plain word). The run sandbox, built on bubblewrap. A run in
the box cannot write the store, reach the web API, or settle its own hold. It is on by default.
`[run] sandbox = "box" | "off" | "mask"`.
- Do not say: container, jail, VM.

**Sandbox check** (web) or **`darius box check`** (CLI). The test that the box works on this
machine. A broken box makes rituals skip as `box-broken`.

**Snapshot** and **backup.** A snapshot is the file: a daily `tar.gz` of one host's store. A backup
is the act of making it, and the state of that act. Say "the newest snapshot" and "the backup
failed".
- Do not say: dump, export (the old `darius export` is gone), archive.

**Profile.** A named preset for starting a harness: the harness, model, surface and permissions.
`[profiles.<name>]` in the marker.
- Do not say: persona, template.

**Harness.** The agent program darius starts for a run, such as Claude Code. The **surface** is how
its session shows: headless, or in a herdr pane.

**Timer.** A systemd timer that darius installs. `run-due` every 15 minutes (at :05, :20, :35
and :50), `sync` every 15 minutes (at :00, :15, :30 and :45), the vigil sweep daily at 06:30, the
snapshot daily at 04:00.
- Do not say: cron, scheduler job.

**Run-due.** The command `darius run-due`. The timer calls it. It starts each due ritual that may
start here, and prints a report with the skip reasons.

**Self-test.** `darius selftest`. It seeds a test project, `darius-selftest`, to prove that the
runner, the sweep and sync work end to end.

**Heartbeat.** The ritual that the self-test seeds. It runs `darius --version` and `date` and
reports them. It proves that an unattended run can start, act and report.

## State words

Each list gives the web word, the CLI word and the meaning. Where the CLI has no separate word,
the cell says "same".

**Ritual state**

| Web word | CLI word | Meaning |
|---|---|---|
| Running | open run | A run is in progress. |
| waits for your answer | held | A held run waits for you. |
| N days late | overdue | The due time has passed. |
| Due today | due | It is due today, not yet late. |
| a date ("Fri 2 Oct") | next due | It waits for its next date. |
| No schedule | no cadence | It has no cadence. |
| Paused | paused | The ritual is paused. The timer skips it. |
| Retired | retired | The ritual is retired. This is final. |

**Run state**

| Web word | CLI word | Meaning |
|---|---|---|
| Running | running | The run is working. |
| waits for your answer | held | The run asked a question and stopped. |
| waits for your answer | complete, with an open question | The run finished with a question nobody answered. |
| Complete | complete | The run finished. This is an outcome. |
| Failed | failed | The run failed. This is an outcome. |
| Failed, seen | failed, acknowledged | You marked the failure as seen. |
| Abandoned | abandoned | The run was given up. This is an outcome. |
| Starting, Not started | none | The web asked for a start. No run shows yet, or the CLI refused it. |

**Vigil state**

| Web word | CLI word | Meaning |
|---|---|---|
| (no badge) | armed | It waits for its gate. |
| Due today, N days late | fired, due | Its date has come, or its event fired. |
| Checking | none | The web asked for a check and it has not ended. |
| Flagged | flagged | The last check failed. |
| Pending | flagged, `fail_kind` pending | The failure is the expected one. The event is still ahead. |
| Check broken | flagged, `fail_kind` broken | The check itself failed. |
| Paused until a date | paused | The sweep skips it until then. |
| Held | closed, verdict held | The check passed. This is a verdict, not a run state. |
| Failed | closed, verdict failed | You closed it as failed. |

**Candle state**

| Web word | CLI word | Meaning |
|---|---|---|
| Lit | lit | Open. It waits for you. |
| Answered | answered | You replied. |
| Accepted | accepted | You accepted the risk. |
| Out | out | Put out: fixed, or blown out. |

**Finding state**

| Web word | CLI word | Meaning |
|---|---|---|
| needs you | needs-you | The newest run confirmed it, and it needs a decision, or it is high or critical. |
| open | open | Reported, and nothing more is asked. |
| closed | closed | You closed it. A higher severity reopens it. |
| fixed | fixed | The newest report says it is fixed. |
| lapsed | lapsed | Two full runs in a row left it out. It leaves the default list. |

The state of one item in a run's result is another list: `open`, `fixed`, `needs-decision`,
`needs-code`, `not-verified`.

**Machine state**

| Web word | CLI word | Meaning |
|---|---|---|
| online | self, online | The machine answers, or it is the one that serves the page. |
| unreachable | unreachable, offline | It did not answer. The web app cannot tell a stopped machine from a stopped web server. |
| checking | checking | The first probe has no answer yet. |
| not asked | none | The probe does not know this machine. |

**Backup state**

| Web word | CLI word | Meaning |
|---|---|---|
| Backed up | ok | The newest snapshot is recent. |
| Backup stale | stale | No good snapshot or upload for too long. |
| Backup failed | failed | The newest backup run failed. |
| Backups off | off | Backups are off on purpose. |
| Silent | silent | No line of any kind for 30 days. The machine is gone, not late. |

## Words with more than one meaning

- **held.** A run is held when it asks you. A vigil closes with the verdict "held" when its check
  passed. The first waits for you. The second is done and good. Say "held run" and "closed as
  held". The web app says "waits for your answer" for the run.
- **check.** A vigil check is one step of a vigil. `darius box check` is the sandbox check.
  `darius marker check` validates a marker. `darius snapshot check` tests the bucket. The gate check
  proves the run gate. Always name the object.
- **mirror.** The setting and the act of pulling projects onto a host (`[sync] mirror`). Also what
  reconcile does with a marker: it mirrors the rituals into the store. Say "mirror" for the first.
  Say "reconcile" for the second.
- **skill.** The `SKILL.md` folder that holds a ritual's steps. A skill may also grant tools with
  `allowed-tools`. It is never the ritual itself.
- **kind.** An item kind: ritual, vigil, milestone, spec. The marker key `kinds` lists the kinds
  the store owns. A vigil's `fail_kind` is a different thing. A web place has a `kind` of checkout
  or copy.
- **outcome.** The outcome of a run is complete, failed or abandoned. A sweep also writes an
  outcome per vigil check, such as held, failed or skipped. Say "run outcome" and "sweep outcome".
- **manual.** A manual ritual is one in mode `off`: only a person starts it. A manual item in a
  vigil is a step a person must confirm. Say "manual ritual" and "manual step".
- **answer.** You answer a held run's question. You also answer a candle. The first resumes a run.
  The second closes a candle.
- **late and due.** Due means the time has come. Late means the time has passed and nothing ran.

## How to keep this file true

- When a term or a visible word changes, the same commit changes this file.
- A term that the web app shows must have an entry here.
- The web app takes its short definitions from `web/app/lib/terms.ts`. That file must agree with
  this file. A test checks the list of terms.
- A word in the web app and a word in the CLI for one thing go in "Web words and CLI words".
- When this file and the code disagree, fix the code or fix this file in the same commit. Do not
  leave both.
