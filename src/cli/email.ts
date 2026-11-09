/**
 * `darius email status|set|test`: the email channel of candle notices
 * (src/core/email.ts; docs/concept.md, "Candles") and of run reports
 * (src/core/report-email.ts, 0.127.0).
 *
 *   email status       set up or not, the host of the url and the recipient
 *                      count. Never the token, never an address. Exit 1 when
 *                      the file is refused, with the reason
 *   email set --stdin  reads the JSON settings, checks them, and writes
 *                      <config>/email.json with mode 0600. `since` becomes now
 *                      when it is absent. Only stdin: a token on the command
 *                      line would stand in the shell history. It adds a line
 *                      when open candles asked for email and were not sent
 *                      (a count, and it writes nothing)
 *   email test         sends one test message, and writes no ledger line
 *   email test --report
 *                      sends one sample report, with text and html (only
 *                      text when `html` is false), and writes no ledger line
 *
 * A run must not send mail or change the channel. Two walls hold that: `set` and
 * `test` refuse while DARIUS_RUN or DARIUS_RUN_POLICY is set, and
 * src/harness/gate.ts (writesEmail) denies the line. `status` passes.
 */

import { unsentEmailCandles } from "../core/alerts.ts";
import { emailStatus, parseEmailInput, postEmail, readEmailSettings, sendEmail, writeEmailSettings, type EmailSettings } from "../core/email.ts";
import { hostId } from "../core/ledger.ts";
import { endpointHost } from "../core/redact.ts";
import { reportMessage, sampleReportFacts } from "../core/report-email.ts";
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

function status(args: ParsedArgs): number {
  const found = emailStatus();
  const code = found.problem === null ? 0 : 1;
  if (args.json) {
    printJson({ ok: code === 0, ...found });
    return code;
  }
  if (found.problem !== null) {
    console.log(`! email is not set up on ${hostId()}: ${found.problem}`);
    return code;
  }
  if (!found.isSetUp) {
    console.log(`· email is not set up on ${hostId()}: darius email set --stdin`);
    return code;
  }
  console.log(`✓ email is set up on ${hostId()}: ${found.host ?? "?"}, ${recipients(found.recipients)}${found.html === false ? ", reports as text only" : ""}`);
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
  console.log(`✓ email is set up: ${host}, ${recipients(settings.to.length)}. Candles from before ${settings.since} send no mail.`);
  if (unsent > 0) console.log(unsent === 1 ? "1 open candle was not sent on email. It stays in the app." : `${String(unsent)} open candles were not sent on email. They stay in the app.`);
  return 0;
}

/** One sample report through the same build as a real one, so the operator sees what a provider does with it. */
async function sendSampleReport(settings: EmailSettings): Promise<void> {
  const now = new Date();
  await postEmail(settings, reportMessage(settings, sampleReportFacts(hostId(), now), `email-test-report:${now.toISOString()}`));
}

async function sendTest(args: ParsedArgs): Promise<number> {
  const isReport = args.flags.report === true;
  try {
    const settings = readEmailSettings();
    if (settings === null) return refuse(args, "email is not set up on this host: darius email set --stdin");
    if (isReport) await sendSampleReport(settings);
    else await sendEmail(settings, { key: `email-test:${new Date().toISOString()}`, title: "darius email test", body: `A test from ${hostId()}. Email works.`, url: "/" });
    const host = endpointHost(settings.url);
    const html = isReport && settings.html !== false;
    if (args.json) printJson(isReport ? { ok: true, host, recipients: settings.to.length, report: true, html } : { ok: true, host, recipients: settings.to.length });
    else if (isReport) console.log(`✓ ${host} took a sample report for ${recipients(settings.to.length)}, ${html ? "text and html" : "text only"}`);
    else console.log(`✓ ${host} took a test for ${recipients(settings.to.length)}`);
    return 0;
  } catch (cause) {
    return refuse(args, errorMessage(cause));
  }
}

export const emailCommand: Command = {
  name: "email",
  flags: ["report"],
  summary: "the email channel of candle notices and run reports: status, set, test [--report]",
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
