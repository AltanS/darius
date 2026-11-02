/**
 * `darius email status|set|test`: the email channel of flare notices
 * (src/core/email.ts; docs/concept.md, "Flares").
 *
 *   email status       set up or not, the host of the url and the recipient
 *                      count. Never the token, never an address. Exit 1 when
 *                      the file is refused, with the reason
 *   email set --stdin  reads the JSON settings, checks them, and writes
 *                      <config>/email.json with mode 0600. `since` becomes now
 *                      when it is absent. Only stdin: a token on the command
 *                      line would stand in the shell history
 *   email test         sends one test message, and writes no ledger line
 *
 * A run must not send mail or change the channel. Two walls hold that: `set` and
 * `test` refuse while DARIUS_RUN or DARIUS_RUN_POLICY is set, and
 * src/harness/gate.ts (writesEmail) denies the line. `status` passes.
 */

import { emailStatus, parseEmailInput, readEmailSettings, sendEmail, writeEmailSettings, type EmailSettings } from "../core/email.ts";
import { hostId } from "../core/ledger.ts";
import { endpointHost } from "../core/redact.ts";
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
  console.log(`✓ email is set up on ${hostId()}: ${found.host ?? "?"}, ${recipients(found.recipients)}`);
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
  if (args.json) printJson({ ok: true, host, recipients: settings.to.length, since: settings.since });
  else console.log(`✓ email is set up: ${host}, ${recipients(settings.to.length)}. Flares from before ${settings.since} send no mail.`);
  return 0;
}

async function sendTest(args: ParsedArgs): Promise<number> {
  try {
    const settings = readEmailSettings();
    if (settings === null) return refuse(args, "email is not set up on this host: darius email set --stdin");
    await sendEmail(settings, { key: `email-test:${new Date().toISOString()}`, title: "darius email test", body: `A test from ${hostId()}. Email works.`, url: "/" });
    const host = endpointHost(settings.url);
    if (args.json) printJson({ ok: true, host, recipients: settings.to.length });
    else console.log(`✓ ${host} took a test for ${recipients(settings.to.length)}`);
    return 0;
  } catch (cause) {
    return refuse(args, errorMessage(cause));
  }
}

export const emailCommand: Command = {
  name: "email",
  flags: [],
  summary: "the email channel of flare notices: status, set, test",
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
