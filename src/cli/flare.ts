/**
 * `darius flare light|list|show|answer|accept|clear|reopen`: the flares of a
 * project (docs/concept.md, "Flares"). A flare is derived from the ledger and
 * the result blobs (src/core/flare-index.ts); the only thing written is one
 * ledger line per verb, and the body blob of `light --stdin`.
 *
 *   flare light <key> --title T --severity S [--target X] [--deliver push,email|none]
 *                     [--source S] [--stdin] [--who W]
 *                  a report from a script or a person. Lights a new key or a
 *                  gone one, and raises a higher severity. At the same or a
 *                  lower severity it exits 0, says "already lit, seen again"
 *                  and still writes its line, so `lastSeen` moves. `--stdin`
 *                  stores the body as a blob.
 *   flare list [--all] [--status S] [--json]
 *                  default: the lit flares
 *   flare show <key> [--json]
 *   flare answer <key> --note N [--follow-up [--on HOST]] [--who W]
 *                  `--follow-up` needs a flare whose newest report came from a
 *                  run. It starts `run follow-up <run> --item <key> --note N`
 *                  first, and writes `flare.answered` only when the run started.
 *                  `--on HOST` runs this verb on HOST over ssh, the host of the
 *                  ritual (0.111.0), as `run follow-up --on` does. The answer is
 *                  then written there, and only when the run started there.
 *   flare accept <key> [--note N] [--who W]
 *                  on a flare whose newest report came from `vigil:<slug>` it
 *                  also closes that vigil as failed, when the vigil exists and
 *                  is open (0.110.0). The accept line comes first.
 *   flare clear <key> [--note N] [--who W]
 *   flare reopen <key> [--note N] [--who W]
 *
 * A run never writes a flare by command. It reports one in its result block
 * with `"flare": true`. Two walls hold that: every write verb here refuses
 * while DARIUS_RUN or DARIUS_RUN_POLICY is set, and src/harness/gate.ts
 * (writesFlare) denies the line, because `env -u` would clear the first wall.
 *
 * An unknown key exits 1. A verb the flare's status does not allow exits 1,
 * and a mistake on the command line exits 2.
 */

import { flushAlerts } from "../core/alerts.ts";
import {
  collectFlares,
  FLARE_ACCEPTED,
  FLARE_ANSWERED,
  FLARE_CLEARED,
  FLARE_LIT,
  FLARE_REOPENED,
  FLARE_STATUSES,
  flareSettleRefusal,
  FOLLOW_UP_NOT_STARTED,
  type Flare,
  type FlareSettle,
  type FlareStatus,
  type FlareStep,
} from "../core/flare-index.ts";
import { appendLine, defaultWho, hostId, readLedger, type LedgerLineInput } from "../core/ledger.ts";
import type { Ritual } from "../core/model.ts";
import { resolveProject } from "../core/paths.ts";
import { clean, KEY_MAX, normalizeKey, SEVERITIES, TEXT_LIMITS, type Severity } from "../core/result.ts";
import { sshDariusLine } from "../core/ssh.ts";
import { closeVigilForFlare } from "../core/sweep.ts";
import { vigilOfSource } from "../core/vigil-flare.ts";
import { getBlobText, openProject, putBlob, type Project } from "../core/store.ts";
import { ritualHost } from "../core/workdir.ts";
import { errorMessage } from "../runtime.ts";
import { NotFoundError, UsageError, type Command, type ParsedArgs } from "./registry.ts";
import { forwardOn, runFollowUp, verbArgv } from "./run-due.ts";

const VERBS = "light | list | show | answer | accept | clear | reopen";
const CHANNELS: ReadonlySet<string> = new Set(["push", "email"]);
/** The source of a report that names none. */
const DEFAULT_SOURCE = "cli";

// --- small readers ----------------------------------------------------------------

function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  if (value === undefined || value === false) return undefined;
  if (value === true) throw new UsageError(`--${name} needs a value`);
  return value;
}

function currentProject(args: ParsedArgs): Project {
  return openProject(resolveProject(stringFlag(args, "project")));
}

function printJson<T>(value: T): void {
  console.log(JSON.stringify(value));
}

/** The note, trimmed; none when it is blank. */
function noteFlag(args: ParsedArgs): string | undefined {
  const note = stringFlag(args, "note")?.trim();
  return note === "" ? undefined : note;
}

/** The key rules of a result item (src/core/result.ts): one line, at most KEY_MAX, refused and not clipped. */
function requireKey(args: ParsedArgs, verb: string): string {
  const raw = args.positional[1] ?? "";
  if (/[\r\n]/u.test(raw)) throw new UsageError(`flare ${verb}: <key> must be one line`);
  const key = normalizeKey(raw);
  if (key === "") throw new UsageError(`flare ${verb}: missing <key>`);
  const length = [...key].length;
  if (length > KEY_MAX) throw new UsageError(`flare ${verb}: <key> is at most ${String(KEY_MAX)} characters, got ${String(length)}; make it shorter`);
  return key;
}

/** A required one-line text flag, control characters out and clipped to `max`. */
function requireText(args: ParsedArgs, name: string, max: number): string {
  const text = clean(stringFlag(args, name) ?? "", max);
  if (text === "") throw new UsageError(`flare light: missing --${name}`);
  return text;
}

function severityFlag(args: ParsedArgs): Severity {
  const raw = stringFlag(args, "severity");
  if (raw === undefined) throw new UsageError("flare light: missing --severity");
  const severity = SEVERITIES.find((candidate) => candidate === raw);
  if (severity === undefined) throw new UsageError(`--severity takes ${SEVERITIES.join(", ")}, got '${raw}'`);
  return severity;
}

/** `--deliver`: the channels, an empty list for `none` (the app only), undefined when the flag is absent. */
function deliverFlag(args: ParsedArgs): string[] | undefined {
  const raw = stringFlag(args, "deliver");
  if (raw === undefined) return undefined;
  if (raw.trim() === "none") return [];
  const channels = raw.split(",").map((channel) => channel.trim());
  const wrong = channels.find((channel) => !CHANNELS.has(channel));
  if (wrong !== undefined) throw new UsageError(`--deliver takes push, email or none, got '${wrong}'`);
  return [...new Set(channels)];
}

function refuse(args: ParsedArgs, reason: string): number {
  if (args.json) printJson({ ok: false, error: reason });
  else console.log(`! ${reason}`);
  return 1;
}

function isSet(name: string): boolean {
  const value = process.env[name];
  return value !== undefined && value !== "";
}

/** The one flare named by `key`, or NotFoundError. */
function lookup(project: Project, key: string): Flare {
  const flare = collectFlares(project, readLedger(project)).find((candidate) => candidate.key === key);
  if (flare === undefined) throw new NotFoundError(`no flare '${key}' in ${project.name}`);
  return flare;
}

// --- text -------------------------------------------------------------------------

function stamp(at: string): string {
  return at.slice(0, 10);
}

function flareLine(flare: Flare): string {
  const target = flare.target === undefined ? "" : ` [${flare.target}]`;
  const seen = flare.reports === 1 ? "seen once" : `seen ${String(flare.reports)} times`;
  const still = flare.stillReported ? " still reported" : "";
  return `${flare.status} ${flare.severity}: ${flare.title}${target} {${flare.key}} since ${stamp(flare.firstSeen.at)} ${seen} from ${flare.source}${still}`;
}

function historyLine(step: FlareStep): string {
  const run = step.run === undefined ? "" : ` run ${step.run}`;
  const by = step.who === undefined ? "" : ` by ${step.who}`;
  const note = step.note === undefined ? "" : `: ${step.note}`;
  return `${step.at} ${step.kind} ${step.severity}${run}${by}${note}`;
}

function closeLines(flare: Flare): string[] {
  const { answered, accepted, cleared } = flare;
  const lines: string[] = [];
  if (answered !== undefined) {
    const run = answered.followUpRun === undefined ? "" : `, follow-up run ${answered.followUpRun}`;
    lines.push(`  answered by ${answered.who} at ${answered.at} at severity ${answered.severity}${run}: ${answered.note}`);
  }
  if (accepted !== undefined) lines.push(`  accepted by ${accepted.who} at ${accepted.at} at severity ${accepted.severity}${accepted.note === undefined ? "" : `: ${accepted.note}`}`);
  if (cleared !== undefined) lines.push(`  cleared by ${cleared.who} at ${cleared.at}${cleared.note === undefined ? "" : `: ${cleared.note}`}`);
  return lines;
}

function deliverLine(flare: Flare): string[] {
  if (flare.deliver === undefined) return [];
  return [`  deliver: ${flare.deliver.length === 0 ? "none, the app only" : flare.deliver.join(", ")}`];
}

function bodyLines(flare: Flare, body: string | null): string[] {
  if (flare.bodySha === undefined) return [];
  if (body === null) return [`  body: ${flare.bodySha} is not on this host yet`];
  return ["  body:", ...clean(body, Number.MAX_SAFE_INTEGER, true).split("\n").map((line) => `    ${line}`)];
}

function describeFlare(flare: Flare, body: string | null): string[] {
  return [
    flareLine(flare),
    ...(flare.ritual === undefined ? [] : [`  ritual ${flare.ritual}, run ${flare.run ?? "unknown"}`]),
    ...deliverLine(flare),
    `  first seen ${flare.firstSeen.at}, last seen ${flare.lastSeen.at}`,
    ...closeLines(flare),
    ...bodyLines(flare, body),
    "  history, oldest first:",
    ...flare.history.map((step) => `    ${historyLine(step)}`),
  ];
}

// --- list and show ----------------------------------------------------------------

function shownStatuses(args: ParsedArgs): readonly FlareStatus[] {
  const raw = stringFlag(args, "status");
  if (raw !== undefined && args.flags.all === true) throw new UsageError("use --all or --status, not both");
  if (args.flags.all === true) return FLARE_STATUSES;
  if (raw === undefined) return ["lit"];
  const status = FLARE_STATUSES.find((candidate) => candidate === raw);
  if (status === undefined) throw new UsageError(`--status takes ${FLARE_STATUSES.join(", ")}, got '${raw}'`);
  return [status];
}

function flareList(args: ParsedArgs): number {
  const statuses = shownStatuses(args);
  const project = currentProject(args);
  const flares = collectFlares(project, readLedger(project)).filter((flare) => statuses.includes(flare.status));
  if (args.json) {
    printJson({ project: project.name, flares });
    return 0;
  }
  if (flares.length === 0) console.log("no flares");
  for (const flare of flares) console.log(flareLine(flare));
  return 0;
}

/** What `flare show --json` prints. */
interface ShownFlare {
  project: string;
  flare: Flare;
  /** Absent when the flare has no body, or its blob is not on this host yet. */
  body?: string;
}

function flareShow(args: ParsedArgs): number {
  const key = requireKey(args, "show");
  const project = currentProject(args);
  const flare = lookup(project, key);
  const body = flare.bodySha === undefined ? null : getBlobText(project, flare.bodySha);
  if (args.json) {
    const shown: ShownFlare = { project: project.name, flare };
    if (body !== null) shown.body = body;
    printJson(shown);
    return 0;
  }
  for (const line of describeFlare(flare, body)) console.log(line);
  return 0;
}

// --- light ------------------------------------------------------------------------

/** The line of one report, with every flag checked. */
function litLine(args: ParsedArgs, project: Project, key: string): LedgerLineInput {
  const line: LedgerLineInput = {
    who: stringFlag(args, "who") ?? defaultWho(),
    type: FLARE_LIT,
    key,
    title: requireText(args, "title", TEXT_LIMITS.title),
    severity: severityFlag(args),
    source: clean(stringFlag(args, "source") ?? DEFAULT_SOURCE, TEXT_LIMITS.target) || DEFAULT_SOURCE,
  };
  const target = clean(stringFlag(args, "target") ?? "", TEXT_LIMITS.target);
  if (target !== "") line.target = target;
  const deliver = deliverFlag(args);
  if (deliver !== undefined) line.deliver = deliver;
  if (args.flags.stdin !== true) return line;
  if ((args.stdin ?? "").trim() === "") throw new UsageError("flare light: --stdin got an empty body");
  line.body_sha = putBlob(project, args.stdin ?? "");
  return line;
}

/**
 * The one place `flare light` sends alerts: it flushes this project's notices
 * before the verb exits, and no other project's. A notice that could not go
 * out is reported on stderr; the flare is lit either way, so the exit code
 * does not change.
 */
async function flushOwnAlerts(project: Project): Promise<void> {
  const delivery = await flushAlerts({ projects: [project.name] });
  for (const failure of delivery?.failed ?? []) console.error(`darius flare: alert: ${failure}`);
}

/** What the report did, in one sentence. */
function lightSentence(flare: Flare): string {
  const kind = flare.history.at(-1)?.kind;
  if (kind === "lit") return `✓ lit flare '${flare.key}' at ${flare.severity}`;
  if (kind === "raised") return `✓ raised flare '${flare.key}' to ${flare.severity}`;
  if (flare.status === "lit") return `✓ flare '${flare.key}' already lit, seen again`;
  return `✓ flare '${flare.key}' already ${flare.status}, seen again; it stays closed`;
}

async function flareLight(args: ParsedArgs): Promise<number> {
  const key = requireKey(args, "light");
  const project = currentProject(args);
  const line = litLine(args, project, key);
  const flare = project.withLock((): Flare => {
    appendLine(project, line);
    return lookup(project, key);
  });
  await flushOwnAlerts(project);
  if (args.json) printJson({ ok: true, project: project.name, key, status: flare.status, severity: flare.severity, reports: flare.reports });
  else console.log(lightSentence(flare));
  return 0;
}

// --- answer, accept, clear and reopen ---------------------------------------------

const SETTLE = {
  answer: { type: FLARE_ANSWERED, done: "answered" },
  accept: { type: FLARE_ACCEPTED, done: "accepted" },
  clear: { type: FLARE_CLEARED, done: "cleared" },
  reopen: { type: FLARE_REOPENED, done: "reopened" },
} as const satisfies Record<FlareSettle, { type: string; done: string }>;

interface SettleInput {
  verb: FlareSettle;
  flare: Flare;
  who: string;
  note: string | undefined;
  followUpRun?: string;
}

/** An answer and an accept close the flare at the severity it has now, so they name it. */
function settleLine(input: SettleInput): LedgerLineInput {
  const { verb, flare, who, note, followUpRun } = input;
  const line: LedgerLineInput = { who, type: SETTLE[verb].type, key: flare.key };
  if (verb === "answer" || verb === "accept") line.severity = flare.severity;
  if (note !== undefined) line.note = note;
  if (followUpRun !== undefined) line.follow_up_run = followUpRun;
  return line;
}

/** What a settle verb prints with `--json`. */
interface SettledJson {
  ok: true;
  project: string;
  key: string;
  /** Only for an accepted flare of a vigil: the slug, and what happened to it. */
  vigil?: string;
  vigilClose?: string;
}

interface Settled {
  refused: string | undefined;
  flare: Flare;
}

/** What accepting a flare did to its vigil. `none`: the flare is not a vigil's. */
type VigilClose = { slug: string; done: "closed" | "already-closed" | "no-vigil" | "failed" } | { done: "none" };

/**
 * An accepted flare of a vigil closes that vigil as failed (0.110.0): nothing
 * is left to wait for. The accept line is already written when this runs, so a
 * failure here leaves the decision on record; it says so on stderr. A vigil
 * that is gone or already closed is fine. An answer leaves the vigil armed.
 */
function closeVigilOfAccept(project: Project, flare: Flare, who: string): VigilClose {
  const slug = vigilOfSource(flare.source);
  if (slug === undefined) return { done: "none" };
  try {
    return { slug, done: closeVigilForFlare(project, { slug, flareKey: flare.key, who }) };
  } catch (cause) {
    console.error(
      `darius flare accept: flare '${flare.key}' is accepted and stays accepted, but vigil '${slug}' was not closed: ${errorMessage(cause)}. ` +
        `Close it yourself: darius vigil close ${slug} --verdict failed --reason "flare accepted"`,
    );
    return { slug, done: "failed" };
  }
}

/** Writes one line under the project lock: the flare is read again inside it, so two operators cannot settle it twice. */
function flareSettle(args: ParsedArgs, verb: FlareSettle): number {
  const key = requireKey(args, verb);
  const note = noteFlag(args);
  if (verb === "answer" && note === undefined) throw new UsageError("flare answer: missing --note");
  const project = currentProject(args);
  const who = stringFlag(args, "who") ?? defaultWho();
  const { refused, flare } = project.withLock((): Settled => {
    const found = lookup(project, key);
    const reason = flareSettleRefusal(verb, found);
    if (reason === undefined) appendLine(project, settleLine({ verb, flare: found, who, note }));
    return { refused: reason, flare: found };
  });
  if (refused !== undefined) return refuse(args, refused);
  const vigil: VigilClose = verb === "accept" ? closeVigilOfAccept(project, flare, who) : { done: "none" };
  if (args.json) {
    const settled: SettledJson = { ok: true, project: project.name, key };
    if (vigil.done !== "none") {
      settled.vigil = vigil.slug;
      settled.vigilClose = vigil.done;
    }
    printJson(settled);
  } else {
    console.log(`✓ ${SETTLE[verb].done} flare '${key}'`);
    if (vigil.done === "closed") console.log(`  closed vigil '${vigil.slug}' as failed`);
  }
  return vigil.done === "failed" ? 1 : 0;
}

/** Refuses a follow-up that belongs on another host, and prints this verb for that host, so the answer is written with it. */
function refuseOtherHost(args: ParsedArgs, target: { project: Project; ritual: string; key: string }): number | undefined {
  const { project, ritual, key } = target;
  const doc = project.readItem<Ritual>("ritual", ritual);
  const right = doc === null ? null : ritualHost(project, readLedger(project), doc);
  if (right === null || right.host === hostId()) return undefined;
  const command = sshDariusLine(right.host, ["flare", ...verbArgv(args, project.name).slice(1)]);
  return refuse(args, `flare '${key}' came from ritual '${ritual}', which runs on ${right.host}: ${command}`);
}

/**
 * Starts the follow-up first. `flare.answered` is written the moment the run
 * started, so a run that fixes the flare finds it answered, and a follow-up
 * that never started leaves no answer. This call waits for the run. Its report
 * goes to stderr: stdout holds this verb's answer. The exit code is the run's.
 */
async function flareAnswerFollowUp(args: ParsedArgs): Promise<number> {
  const key = requireKey(args, "answer");
  const note = noteFlag(args);
  if (note === undefined) throw new UsageError("flare answer: missing --note");
  const name = resolveProject(stringFlag(args, "project"));
  const forwarded = forwardOn(args, name, "answer", "flare");
  if (forwarded !== undefined) return forwarded;
  const project = openProject(name);
  const flare = lookup(project, key);
  const refused = flareSettleRefusal("answer", flare);
  if (refused !== undefined) return refuse(args, refused);
  const { run: parent, ritual } = flare;
  if (parent === undefined || ritual === undefined) {
    return refuse(args, `flare '${key}' has no run to follow up: its newest report came from ${flare.source}. Answer it without --follow-up, and act on it yourself.`);
  }
  const otherHost = refuseOtherHost(args, { project, ritual, key });
  if (otherHost !== undefined) return otherHost;
  const who = stringFlag(args, "who") ?? defaultWho();
  const followUp: ParsedArgs = {
    positional: ["follow-up", parent],
    flags: { project: project.name, who, note },
    json: args.json,
    repeated: { item: [key] },
  };
  const started: string[] = [];
  const code = await runFollowUp(followUp, {
    onStarted: (run) => {
      appendLine(project, settleLine({ verb: "answer", flare, who, note, followUpRun: run }));
      started.push(run);
    },
    print: (line) => {
      console.error(line);
    },
  });
  const [run] = started;
  if (run === undefined) {
    console.error(`${FOLLOW_UP_NOT_STARTED}, so flare '${key}' stays ${flare.status}`);
    return code === 0 ? 1 : code;
  }
  if (args.json) printJson({ ok: true, project: project.name, key, followUpRun: run, runExit: code });
  else console.log(`✓ answered flare '${key}', follow-up run ${run}${code === 0 ? "" : ` ended with exit ${String(code)}`}`);
  return code;
}

// --- dispatch ---------------------------------------------------------------------

/** The first wall against a run that writes a flare. The second is `writesFlare` in src/harness/gate.ts. */
function refuseInRun(args: ParsedArgs, verb: string): number | undefined {
  if (!isSet("DARIUS_RUN") && !isSet("DARIUS_RUN_POLICY")) return undefined;
  return refuse(args, `flare ${verb} is for a person or a script; a run reports a flare in its result block with "flare": true`);
}

async function flareWrite(args: ParsedArgs, verb: FlareSettle | "light"): Promise<number> {
  const refused = refuseInRun(args, verb);
  if (refused !== undefined) return refused;
  if (args.flags["follow-up"] === true && verb !== "answer") throw new UsageError(`flare ${verb} takes no --follow-up; flare answer does`);
  if (args.flags.on !== undefined && args.flags["follow-up"] !== true) throw new UsageError(`flare ${verb} takes no --on; only flare answer --follow-up does`);
  if (verb === "light") return flareLight(args);
  if (args.flags["follow-up"] === true) return flareAnswerFollowUp(args);
  return flareSettle(args, verb);
}

export const flareCommand: Command = {
  name: "flare",
  flags: ["all", "status", "who", "note", "title", "severity", "target", "deliver", "source", "follow-up", "on"],
  summary: "light, list, show and settle flares: problems that need the operator, kept by key",
  usage: `flare ${VERBS.replaceAll(" | ", "|")}`,
  async run(args: ParsedArgs): Promise<number> {
    const verb = args.positional[0];
    switch (verb) {
      case "list":
        return flareList(args);
      case "show":
        return flareShow(args);
      case "light":
      case "answer":
      case "accept":
      case "clear":
      case "reopen":
        return flareWrite(args, verb);
      default:
        throw new UsageError(`flare needs a verb: ${VERBS}`);
    }
  },
};
