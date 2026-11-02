/**
 * `darius candle light|list|show|answer|accept|blow-out|relight`: the candles of a
 * project (docs/concept.md, "Candles"). A candle is derived from the ledger and
 * the result blobs (src/core/candle-index.ts); the only thing written is one
 * ledger line per verb, and the body blob of `light --stdin`.
 *
 *   candle light <key> --title T --severity S [--target X] [--deliver push,email|none]
 *                     [--source S] [--stdin] [--who W]
 *                  a report from a script or a person. Lights a new key or a
 *                  candle that is out, and raises a higher severity. At the same or a
 *                  lower severity it exits 0, says "already lit, seen again"
 *                  and still writes its line, so `lastSeen` moves. `--stdin`
 *                  stores the body as a blob.
 *   candle list [--all] [--status S] [--json]
 *                  default: the lit candles
 *   candle show <key> [--json]
 *   candle answer <key> --note N [--follow-up [--on HOST]] [--who W]
 *                  `--follow-up` needs a candle whose newest report came from a
 *                  run. It starts `run follow-up <run> --item <key> --note N`
 *                  first, and writes `candle.answered` only when the run started.
 *                  `--on HOST` runs this verb on HOST over ssh, the host of the
 *                  ritual (0.111.0), as `run follow-up --on` does. The answer is
 *                  then written there, and only when the run started there.
 *   candle accept <key> [--note N] [--who W]
 *                  on a candle whose newest report came from `vigil:<slug>` it
 *                  also closes that vigil as failed, when the vigil exists and
 *                  is open (0.110.0). The accept line comes first.
 *   candle blow-out <key> [--note N] [--who W]
 *   candle relight <key> [--note N] [--who W]
 *
 * A run never writes a candle by command. It reports one in its result block
 * with `"candle": true`. Two walls hold that: every write verb here refuses
 * while DARIUS_RUN or DARIUS_RUN_POLICY is set, and src/harness/gate.ts
 * (writesCandle) denies the line, because `env -u` would drop the first wall.
 *
 * An unknown key exits 1. A verb the candle's status does not allow exits 1,
 * and a mistake on the command line exits 2.
 */

import { flushAlerts } from "../core/alerts.ts";
import {
  collectCandles,
  CANDLE_ACCEPTED,
  CANDLE_ANSWERED,
  CANDLE_BLOWN_OUT,
  CANDLE_LIT,
  CANDLE_RELIT,
  CANDLE_STATUSES,
  candleSettleRefusal,
  FOLLOW_UP_NOT_STARTED,
  type Candle,
  type CandleSettle,
  type CandleStatus,
  type CandleStep,
} from "../core/candle-index.ts";
import { appendLine, defaultWho, hostId, readLedger, type LedgerLineInput } from "../core/ledger.ts";
import type { Ritual } from "../core/model.ts";
import { resolveProject } from "../core/paths.ts";
import { clean, KEY_MAX, normalizeKey, SEVERITIES, TEXT_LIMITS, type Severity } from "../core/result.ts";
import { sshDariusLine } from "../core/ssh.ts";
import { closeVigilForCandle } from "../core/sweep.ts";
import { vigilOfSource } from "../core/vigil-candle.ts";
import { getBlobText, openProject, putBlob, type Project } from "../core/store.ts";
import { ritualHost } from "../core/workdir.ts";
import { errorMessage } from "../runtime.ts";
import { NotFoundError, UsageError, type Command, type ParsedArgs } from "./registry.ts";
import { forwardOn, runFollowUp, verbArgv } from "./run-due.ts";

const VERBS = "light | list | show | answer | accept | blow-out | relight";
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
  if (/[\r\n]/u.test(raw)) throw new UsageError(`candle ${verb}: <key> must be one line`);
  const key = normalizeKey(raw);
  if (key === "") throw new UsageError(`candle ${verb}: missing <key>`);
  const length = [...key].length;
  if (length > KEY_MAX) throw new UsageError(`candle ${verb}: <key> is at most ${String(KEY_MAX)} characters, got ${String(length)}; make it shorter`);
  return key;
}

/** A required one-line text flag, control characters out and clipped to `max`. */
function requireText(args: ParsedArgs, name: string, max: number): string {
  const text = clean(stringFlag(args, name) ?? "", max);
  if (text === "") throw new UsageError(`candle light: missing --${name}`);
  return text;
}

function severityFlag(args: ParsedArgs): Severity {
  const raw = stringFlag(args, "severity");
  if (raw === undefined) throw new UsageError("candle light: missing --severity");
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

/** The one candle named by `key`, or NotFoundError. */
function lookup(project: Project, key: string): Candle {
  const candle = collectCandles(project, readLedger(project)).find((candidate) => candidate.key === key);
  if (candle === undefined) throw new NotFoundError(`no candle '${key}' in ${project.name}`);
  return candle;
}

// --- text -------------------------------------------------------------------------

function stamp(at: string): string {
  return at.slice(0, 10);
}

function candleLine(candle: Candle): string {
  const target = candle.target === undefined ? "" : ` [${candle.target}]`;
  const seen = candle.reports === 1 ? "seen once" : `seen ${String(candle.reports)} times`;
  const still = candle.stillReported ? " still reported" : "";
  return `${candle.status} ${candle.severity}: ${candle.title}${target} {${candle.key}} since ${stamp(candle.firstSeen.at)} ${seen} from ${candle.source}${still}`;
}

function historyLine(step: CandleStep): string {
  const run = step.run === undefined ? "" : ` run ${step.run}`;
  const by = step.who === undefined ? "" : ` by ${step.who}`;
  const note = step.note === undefined ? "" : `: ${step.note}`;
  return `${step.at} ${step.kind} ${step.severity}${run}${by}${note}`;
}

function closeLines(candle: Candle): string[] {
  const { answered, accepted, blownOut } = candle;
  const lines: string[] = [];
  if (answered !== undefined) {
    const run = answered.followUpRun === undefined ? "" : `, follow-up run ${answered.followUpRun}`;
    lines.push(`  answered by ${answered.who} at ${answered.at} at severity ${answered.severity}${run}: ${answered.note}`);
  }
  if (accepted !== undefined) lines.push(`  accepted by ${accepted.who} at ${accepted.at} at severity ${accepted.severity}${accepted.note === undefined ? "" : `: ${accepted.note}`}`);
  if (blownOut !== undefined) lines.push(`  blown out by ${blownOut.who} at ${blownOut.at}${blownOut.note === undefined ? "" : `: ${blownOut.note}`}`);
  return lines;
}

function deliverLine(candle: Candle): string[] {
  if (candle.deliver === undefined) return [];
  return [`  deliver: ${candle.deliver.length === 0 ? "none, the app only" : candle.deliver.join(", ")}`];
}

function bodyLines(candle: Candle, body: string | null): string[] {
  if (candle.bodySha === undefined) return [];
  if (body === null) return [`  body: ${candle.bodySha} is not on this host yet`];
  return ["  body:", ...clean(body, Number.MAX_SAFE_INTEGER, true).split("\n").map((line) => `    ${line}`)];
}

function describeCandle(candle: Candle, body: string | null): string[] {
  return [
    candleLine(candle),
    ...(candle.ritual === undefined ? [] : [`  ritual ${candle.ritual}, run ${candle.run ?? "unknown"}`]),
    ...deliverLine(candle),
    `  first seen ${candle.firstSeen.at}, last seen ${candle.lastSeen.at}`,
    ...closeLines(candle),
    ...bodyLines(candle, body),
    "  history, oldest first:",
    ...candle.history.map((step) => `    ${historyLine(step)}`),
  ];
}

// --- list and show ----------------------------------------------------------------

function shownStatuses(args: ParsedArgs): readonly CandleStatus[] {
  const raw = stringFlag(args, "status");
  if (raw !== undefined && args.flags.all === true) throw new UsageError("use --all or --status, not both");
  if (args.flags.all === true) return CANDLE_STATUSES;
  if (raw === undefined) return ["lit"];
  const status = CANDLE_STATUSES.find((candidate) => candidate === raw);
  if (status === undefined) throw new UsageError(`--status takes ${CANDLE_STATUSES.join(", ")}, got '${raw}'`);
  return [status];
}

function candleList(args: ParsedArgs): number {
  const statuses = shownStatuses(args);
  const project = currentProject(args);
  const candles = collectCandles(project, readLedger(project)).filter((candle) => statuses.includes(candle.status));
  if (args.json) {
    printJson({ project: project.name, candles });
    return 0;
  }
  if (candles.length === 0) console.log("no candles");
  for (const candle of candles) console.log(candleLine(candle));
  return 0;
}

/** What `candle show --json` prints. */
interface ShownCandle {
  project: string;
  candle: Candle;
  /** Absent when the candle has no body, or its blob is not on this host yet. */
  body?: string;
}

function candleShow(args: ParsedArgs): number {
  const key = requireKey(args, "show");
  const project = currentProject(args);
  const candle = lookup(project, key);
  const body = candle.bodySha === undefined ? null : getBlobText(project, candle.bodySha);
  if (args.json) {
    const shown: ShownCandle = { project: project.name, candle };
    if (body !== null) shown.body = body;
    printJson(shown);
    return 0;
  }
  for (const line of describeCandle(candle, body)) console.log(line);
  return 0;
}

// --- light ------------------------------------------------------------------------

/** The line of one report, with every flag checked. */
function litLine(args: ParsedArgs, project: Project, key: string): LedgerLineInput {
  const line: LedgerLineInput = {
    who: stringFlag(args, "who") ?? defaultWho(),
    type: CANDLE_LIT,
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
  if ((args.stdin ?? "").trim() === "") throw new UsageError("candle light: --stdin got an empty body");
  line.body_sha = putBlob(project, args.stdin ?? "");
  return line;
}

/**
 * The one place `candle light` sends alerts: it flushes this project's notices
 * before the verb exits, and no other project's. A notice that could not go
 * out is reported on stderr; the candle is lit either way, so the exit code
 * does not change.
 */
async function flushOwnAlerts(project: Project): Promise<void> {
  const delivery = await flushAlerts({ projects: [project.name] });
  for (const failure of delivery?.failed ?? []) console.error(`darius candle: alert: ${failure}`);
}

/** What the report did, in one sentence. */
function lightSentence(candle: Candle): string {
  const kind = candle.history.at(-1)?.kind;
  if (kind === "lit") return `✓ lit candle '${candle.key}' at ${candle.severity}`;
  if (kind === "raised") return `✓ raised candle '${candle.key}' to ${candle.severity}`;
  if (candle.status === "lit") return `✓ candle '${candle.key}' already lit, seen again`;
  return `✓ candle '${candle.key}' already ${candle.status}, seen again; it stays closed`;
}

async function candleLight(args: ParsedArgs): Promise<number> {
  const key = requireKey(args, "light");
  const project = currentProject(args);
  const line = litLine(args, project, key);
  const candle = project.withLock((): Candle => {
    appendLine(project, line);
    return lookup(project, key);
  });
  await flushOwnAlerts(project);
  if (args.json) printJson({ ok: true, project: project.name, key, status: candle.status, severity: candle.severity, reports: candle.reports });
  else console.log(lightSentence(candle));
  return 0;
}

// --- answer, accept, blow-out and relight ---------------------------------------------

const SETTLE = {
  answer: { type: CANDLE_ANSWERED, done: "answered" },
  accept: { type: CANDLE_ACCEPTED, done: "accepted" },
  "blow-out": { type: CANDLE_BLOWN_OUT, done: "blown out" },
  relight: { type: CANDLE_RELIT, done: "relit" },
} as const satisfies Record<CandleSettle, { type: string; done: string }>;

interface SettleInput {
  verb: CandleSettle;
  candle: Candle;
  who: string;
  note: string | undefined;
  followUpRun?: string;
}

/** An answer and an accept close the candle at the severity it has now, so they name it. */
function settleLine(input: SettleInput): LedgerLineInput {
  const { verb, candle, who, note, followUpRun } = input;
  const line: LedgerLineInput = { who, type: SETTLE[verb].type, key: candle.key };
  if (verb === "answer" || verb === "accept") line.severity = candle.severity;
  if (note !== undefined) line.note = note;
  if (followUpRun !== undefined) line.follow_up_run = followUpRun;
  return line;
}

/** What a settle verb prints with `--json`. */
interface SettledJson {
  ok: true;
  project: string;
  key: string;
  /** Only for an accepted candle of a vigil: the slug, and what happened to it. */
  vigil?: string;
  vigilClose?: string;
}

interface Settled {
  refused: string | undefined;
  candle: Candle;
}

/** What accepting a candle did to its vigil. `none`: the candle is not a vigil's. */
type VigilClose = { slug: string; done: "closed" | "already-closed" | "no-vigil" | "failed" } | { done: "none" };

/**
 * An accepted candle of a vigil closes that vigil as failed (0.110.0): nothing
 * is left to wait for. The accept line is already written when this runs, so a
 * failure here leaves the decision on record; it says so on stderr. A vigil
 * that is gone or already closed is fine. An answer leaves the vigil armed.
 */
function closeVigilOfAccept(project: Project, candle: Candle, who: string): VigilClose {
  const slug = vigilOfSource(candle.source);
  if (slug === undefined) return { done: "none" };
  try {
    return { slug, done: closeVigilForCandle(project, { slug, candleKey: candle.key, who }) };
  } catch (cause) {
    console.error(
      `darius candle accept: candle '${candle.key}' is accepted and stays accepted, but vigil '${slug}' was not closed: ${errorMessage(cause)}. ` +
        `Close it yourself: darius vigil close ${slug} --verdict failed --reason "candle accepted"`,
    );
    return { slug, done: "failed" };
  }
}

/** Writes one line under the project lock: the candle is read again inside it, so two operators cannot settle it twice. */
function candleSettle(args: ParsedArgs, verb: CandleSettle): number {
  const key = requireKey(args, verb);
  const note = noteFlag(args);
  if (verb === "answer" && note === undefined) throw new UsageError("candle answer: missing --note");
  const project = currentProject(args);
  const who = stringFlag(args, "who") ?? defaultWho();
  const { refused, candle } = project.withLock((): Settled => {
    const found = lookup(project, key);
    const reason = candleSettleRefusal(verb, found);
    if (reason === undefined) appendLine(project, settleLine({ verb, candle: found, who, note }));
    return { refused: reason, candle: found };
  });
  if (refused !== undefined) return refuse(args, refused);
  const vigil: VigilClose = verb === "accept" ? closeVigilOfAccept(project, candle, who) : { done: "none" };
  if (args.json) {
    const settled: SettledJson = { ok: true, project: project.name, key };
    if (vigil.done !== "none") {
      settled.vigil = vigil.slug;
      settled.vigilClose = vigil.done;
    }
    printJson(settled);
  } else {
    console.log(`✓ ${SETTLE[verb].done} candle '${key}'`);
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
  const command = sshDariusLine(right.host, ["candle", ...verbArgv(args, project.name).slice(1)]);
  return refuse(args, `candle '${key}' came from ritual '${ritual}', which runs on ${right.host}: ${command}`);
}

/**
 * Starts the follow-up first. `candle.answered` is written the moment the run
 * started, so a run that fixes the candle finds it answered, and a follow-up
 * that never started leaves no answer. This call waits for the run. Its report
 * goes to stderr: stdout holds this verb's answer. The exit code is the run's.
 */
async function candleAnswerFollowUp(args: ParsedArgs): Promise<number> {
  const key = requireKey(args, "answer");
  const note = noteFlag(args);
  if (note === undefined) throw new UsageError("candle answer: missing --note");
  const name = resolveProject(stringFlag(args, "project"));
  const forwarded = forwardOn(args, name, "answer", "candle");
  if (forwarded !== undefined) return forwarded;
  const project = openProject(name);
  const candle = lookup(project, key);
  const refused = candleSettleRefusal("answer", candle);
  if (refused !== undefined) return refuse(args, refused);
  const { run: parent, ritual } = candle;
  if (parent === undefined || ritual === undefined) {
    return refuse(args, `candle '${key}' has no run to follow up: its newest report came from ${candle.source}. Answer it without --follow-up, and act on it yourself.`);
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
      appendLine(project, settleLine({ verb: "answer", candle, who, note, followUpRun: run }));
      started.push(run);
    },
    print: (line) => {
      console.error(line);
    },
  });
  const [run] = started;
  if (run === undefined) {
    console.error(`${FOLLOW_UP_NOT_STARTED}, so candle '${key}' stays ${candle.status}`);
    return code === 0 ? 1 : code;
  }
  if (args.json) printJson({ ok: true, project: project.name, key, followUpRun: run, runExit: code });
  else console.log(`✓ answered candle '${key}', follow-up run ${run}${code === 0 ? "" : ` ended with exit ${String(code)}`}`);
  return code;
}

// --- dispatch ---------------------------------------------------------------------

/** The first wall against a run that writes a candle. The second is `writesCandle` in src/harness/gate.ts. */
function refuseInRun(args: ParsedArgs, verb: string): number | undefined {
  if (!isSet("DARIUS_RUN") && !isSet("DARIUS_RUN_POLICY")) return undefined;
  return refuse(args, `candle ${verb} is for a person or a script; a run reports a candle in its result block with "candle": true`);
}

async function candleWrite(args: ParsedArgs, verb: CandleSettle | "light"): Promise<number> {
  const refused = refuseInRun(args, verb);
  if (refused !== undefined) return refused;
  if (args.flags["follow-up"] === true && verb !== "answer") throw new UsageError(`candle ${verb} takes no --follow-up; candle answer does`);
  if (args.flags.on !== undefined && args.flags["follow-up"] !== true) throw new UsageError(`candle ${verb} takes no --on; only candle answer --follow-up does`);
  if (verb === "light") return candleLight(args);
  if (args.flags["follow-up"] === true) return candleAnswerFollowUp(args);
  return candleSettle(args, verb);
}

export const candleCommand: Command = {
  name: "candle",
  flags: ["all", "status", "who", "note", "title", "severity", "target", "deliver", "source", "follow-up", "on"],
  summary: "light, list, show and settle candles: problems that need the operator, kept by key",
  usage: `candle ${VERBS.replaceAll(" | ", "|")}`,
  async run(args: ParsedArgs): Promise<number> {
    const verb = args.positional[0];
    switch (verb) {
      case "list":
        return candleList(args);
      case "show":
        return candleShow(args);
      case "light":
      case "answer":
      case "accept":
      case "blow-out":
      case "relight":
        return candleWrite(args, verb);
      default:
        throw new UsageError(`candle needs a verb: ${VERBS}`);
    }
  },
};
