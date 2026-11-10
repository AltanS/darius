/**
 * `darius email status|set|test`: the email channel of candle notices
 * (src/core/email.ts; docs/concept.md, "Candles") and of run reports
 * (src/core/report-email.ts, 0.127.0).
 *
 *   email status       set up or not, the host of the url and the count of
 *                      the host's default recipients. Inside a project folder
 *                      also the count its `.darius.toml` names in
 *                      `[email] to` (0.128.0). Never the token, never an
 *                      address. Exit 1 when the file is refused, with the reason
 *   email set --stdin  reads the JSON settings, checks them, and writes
 *                      <config>/email.json with mode 0600. `since` becomes now
 *                      when it is absent. Only stdin: a token on the command
 *                      line would stand in the shell history. It adds a line
 *                      when open candles asked for email and were not sent
 *                      (a count, and it writes nothing)
 *   email test         sends one sample candle mail to the host's default
 *                      `to`, with generic candles across three severities,
 *                      text and html (only text when `html` is false), and
 *                      writes no ledger line. Exit 1 when `to` is empty
 *   email test --report
 *                      sends one sample report, with text and html (only
 *                      text when `html` is false), and writes no ledger line
 *   email test --project <name> [--report]
 *                      the same, to that project's resolved list
 *                      (src/core/email-recipients.ts). Exit 1 with "no
 *                      recipients for <name>" when the list is empty
 *
 * A run must not send mail or change the channel. Two walls hold that: `set` and
 * `test` refuse while DARIUS_RUN or DARIUS_RUN_POLICY is set, and
 * src/harness/gate.ts (writesEmail) denies the line. `status` passes.
 */

import { unsentEmailCandles } from "../core/alerts.ts";
import { candleMessage, sampleCandleFacts } from "../core/candle-email.ts";
import { emailStatus, parseEmailInput, postEmail, readEmailSettings, writeEmailSettings, type EmailSettings } from "../core/email.ts";
import { projectRecipients } from "../core/email-recipients.ts";
import { hostId } from "../core/ledger.ts";
import { findMarker, MARKER_FILE } from "../core/marker.ts";
import { endpointHost } from "../core/redact.ts";
import { reportMessage, sampleReportFacts } from "../core/report-email.ts";
import { openProject } from "../core/store.ts";
import { errorMessage } from "../runtime.ts";
import { UsageError, type Command, type ParsedArgs } from "./registry.ts";

const VERBS = "status | set | test";

function printJson<T>(value: T): void {
  console.log(JSON.stringify(value));
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

/** The first wall against a run that sends mail or changes the channel. The second is `writesEmail` in src/harness/gate.ts. */
function refuseInRun(args: ParsedArgs, verb: string): number | undefined {
  if (!isSet("DARIUS_RUN") && !isSet("DARIUS_RUN_POLICY")) return undefined;
  return refuse(args, `email ${verb} is for a person; a run does not send mail or change the channel`);
}

function recipients(count: number): string {
  return `${String(count)} recipient${count === 1 ? "" : "s"}`;
}

/** What the marker of the project folder says about its recipients: a count only, never an address. */
interface ProjectRecipients {
  name: string;
  /** The count in `[email] to`; null when the marker has no such key, so the host's default applies. */
  recipients: number | null;
}

/** The project of the folder the command runs in, or why its marker cannot be read. */
interface FolderProject {
  project?: ProjectRecipients;
  problem?: string;
}

/** The project of the folder the command runs in, when there is one and its marker parses. Never throws. */
function folderProject(): FolderProject {
  try {
    const marker = findMarker(process.cwd());
    if (marker === null) return {};
    return { project: { name: marker.project, recipients: marker.emailTo?.length ?? null } };
  } catch {
    // The parse error can quote a line of the file, and a line can hold an address.
    return { problem: `the ${MARKER_FILE} here does not parse: darius marker check` };
  }
}

function projectLine(project: ProjectRecipients): string {
  if (project.recipients === null) return `· ${project.name}: its ${MARKER_FILE} names no recipients, so this host's default applies`;
  if (project.recipients === 0) return `· ${project.name}: its ${MARKER_FILE} sets [email] to = [], so it gets no mail`;
  return `· ${project.name}: its ${MARKER_FILE} sets ${recipients(project.recipients)}`;
}

function status(args: ParsedArgs): number {
  const found = emailStatus();
  const here = folderProject();
  const code = found.problem === null ? 0 : 1;
  if (args.json) {
    printJson({ ok: code === 0, ...found, ...here });
    return code;
  }
  if (found.problem !== null) console.log(`! email is not set up on ${hostId()}: ${found.problem}`);
  else if (!found.isSetUp) console.log(`· email is not set up on ${hostId()}: darius email set --stdin`);
  else console.log(`✓ email is set up on ${hostId()}: ${found.host ?? "?"}, ${recipients(found.recipients)} by default${found.html === false ? ", mail as text only" : ""}`);
  if (here.project !== undefined) console.log(projectLine(here.project));
  if (here.problem !== undefined) console.log(`! ${here.problem}`);
  return code;
}

function set(args: ParsedArgs): number {
  if (args.flags.stdin !== true) throw new UsageError("email set needs --stdin, so the token never stands on the command line");
  let settings: EmailSettings;
  try {
    settings = parseEmailInput(args.stdin ?? "");
  } catch (cause) {
    throw new UsageError(`email set: ${errorMessage(cause)}`);
  }
  writeEmailSettings(settings);
  const host = endpointHost(settings.url);
  if (args.json) {
    printJson({ ok: true, host, recipients: settings.to.length, since: settings.since });
    return 0;
  }
  const unsent = unsentEmailCandles();
  console.log(`✓ email is set up: ${host}, ${recipients(settings.to.length)} by default. Candles from before ${settings.since} send no mail.`);
  if (settings.to.length === 0) console.log(`Only a project whose ${MARKER_FILE} names recipients in [email] to gets mail.`);
  if (unsent > 0) console.log(unsent === 1 ? "1 open candle was not sent on email. It stays in the app." : `${String(unsent)} open candles were not sent on email. They stay in the app.`);
  return 0;
}

/** One sample report through the same build as a real one, so the operator sees what a provider does with it. */
async function sendSampleReport(settings: EmailSettings, to: readonly string[]): Promise<void> {
  const now = new Date();
  await postEmail(settings, reportMessage(settings, sampleReportFacts(hostId(), now), `email-test-report:${now.toISOString()}`), { to });
}

/** One sample candle mail through the same build as a real one (0.130.0), so the operator sees the layout in a real mail client. */
async function sendSampleCandles(settings: EmailSettings, to: readonly string[]): Promise<void> {
  await postEmail(settings, candleMessage(settings, sampleCandleFacts(hostId()), `email-test:${new Date().toISOString()}`, to), { to });
}

function projectFlag(args: ParsedArgs): string | undefined {
  const value = args.flags.project;
  if (value === undefined || value === false) return undefined;
  if (value === true) throw new UsageError("--project needs a value");
  return value;
}

/** The list a test goes to: the project's resolved list with `--project`, else the host's default. A refusal text quotes no address. */
function testRecipients(settings: EmailSettings, project: string | undefined): { to: readonly string[] } | { refusal: string } {
  if (project === undefined) {
    if (settings.to.length === 0) return { refusal: `email.json has no default recipients (to) on this host: test a project's list with --project <name>` };
    return { to: settings.to };
  }
  const found = projectRecipients(openProject(project), settings);
  if ("problem" in found) return { refusal: `no recipients for ${project}: ${found.problem}` };
  if (found.to.length === 0) return { refusal: `no recipients for ${project}` };
  return { to: found.to };
}

async function sendTest(args: ParsedArgs): Promise<number> {
  const isReport = args.flags.report === true;
  const project = projectFlag(args);
  try {
    const settings = readEmailSettings();
    if (settings === null) return refuse(args, "email is not set up on this host: darius email set --stdin");
    const list = testRecipients(settings, project);
    if ("refusal" in list) return refuse(args, list.refusal);
    const { to } = list;
    if (isReport) await sendSampleReport(settings, to);
    else await sendSampleCandles(settings, to);
    const host = endpointHost(settings.url);
    const html = settings.html !== false;
    const where = project === undefined ? {} : { project };
    const forWhom = `${recipients(to.length)}${project === undefined ? "" : ` of ${project}`}`;
    const parts = html ? "text and html" : "text only";
    if (args.json) printJson(isReport ? { ok: true, host, recipients: to.length, ...where, report: true, html } : { ok: true, host, recipients: to.length, ...where, html });
    else if (isReport) console.log(`✓ ${host} took a sample report for ${forWhom}, ${parts}`);
    else console.log(`✓ ${host} took a test for ${forWhom}: a sample candle mail, ${parts}`);
    return 0;
  } catch (cause) {
    return refuse(args, errorMessage(cause));
  }
}

export const emailCommand: Command = {
  name: "email",
  flags: ["report"],
  summary: "the email channel of candle notices and run reports: status, set, test [--report] [--project <name>]",
  usage: `email ${VERBS.replaceAll(" | ", "|")}`,
  async run(args: ParsedArgs): Promise<number> {
    const verb = args.positional[0];
    switch (verb) {
      case "status":
        return status(args);
      case "set":
        return refuseInRun(args, verb) ?? set(args);
      case "test":
        return refuseInRun(args, verb) ?? sendTest(args);
      default:
        throw new UsageError(`email needs a verb: ${VERBS}`);
    }
  },
};
