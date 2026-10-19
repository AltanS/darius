/**
 * What the follow-up card of a run page shows while its readiness loads (0.98.0).
 * The page renders at once and the card asks `GET /api/run/follow-up/ready`
 * after it mounts, because the check can take seconds over ssh. The loader
 * says only whether a card is certain to show (the run lists commands or
 * proposes changes) or may show (a plain followable run, which gets a card
 * only when the check passes). A certain card holds its place with a gem line;
 * a possible one draws nothing until the answer, so no card shows and then
 * vanishes. Pure functions: the component and the tests share them.
 */

import type { FollowUpItem, FollowUpQuestion, FollowUpReadiness } from "../../../src/web/api.ts";

/** What the loader knows without the check. */
export interface FollowUpPlan {
  /** Where the follow-up would run: the ritual's host when it is pinned, else the host of this page. */
  host: string;
  /** True when the card shows whatever the check says: the run lists commands or proposes changes. */
  certain: boolean;
}

export type Loaded = { state: "loading" } | { state: "failed"; message: string } | { state: "done"; readiness: FollowUpReadiness };

export type CardView = { view: "waiting" } | { view: "none" } | { view: "card"; readiness: FollowUpReadiness };

/** What the card shows for the plan and the state of the check. */
export function cardView(plan: FollowUpPlan, loaded: Loaded): CardView {
  if (loaded.state === "loading") return plan.certain ? { view: "waiting" } : { view: "none" };
  if (loaded.state === "failed") return plan.certain ? { view: "card", readiness: { ready: false, host: plan.host, reason: loaded.message } } : { view: "none" };
  return plan.certain || loaded.readiness.ready ? { view: "card", readiness: loaded.readiness } : { view: "none" };
}

/** The line a certain card shows while the check runs. */
export function checkingText(host: string): string {
  return `Checking whether a follow-up can start on ${host}…`;
}

/** The wait line shows only after the POST has waited this long. */
export const WAIT_LINE_AFTER_MS = 2000;

/** What a button asks a host to start. */
export type WaitKind = "run" | "check";

/** The line under a button that waits for a host. It says what happens, once, and nothing about the page. */
export function waitingText(host: string, what: WaitKind): string {
  return `Asking ${host} to start the ${what}.`;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function isRecord(value: Json | undefined): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: Json | undefined): value is string {
  return typeof value === "string";
}

function isCount(value: Json | undefined): value is number {
  return typeof value === "number";
}

function questionsOf(value: Json | undefined): FollowUpQuestion[] | null {
  if (!Array.isArray(value)) return null;
  const out: FollowUpQuestion[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !isCount(entry.n) || !Array.isArray(entry.commands)) return null;
    const commands = entry.commands.filter((line) => isText(line));
    if (commands.length !== entry.commands.length) return null;
    out.push({ n: entry.n, commands });
  }
  return out;
}

function itemsOf(value: Json | undefined): FollowUpItem[] | null {
  if (!Array.isArray(value)) return null;
  const out: FollowUpItem[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !isText(entry.key) || !isText(entry.title)) return null;
    out.push({ key: entry.key, title: entry.title });
  }
  return out;
}

/** The text of an optional string field. */
function textOf(value: Json | undefined): string | undefined {
  return isText(value) && value !== "" ? value : undefined;
}

/** Reads the answer of the readiness endpoint: the readiness, or why there is none. */
export function readReadiness(status: number, text: string): Loaded {
  let parsed: Json;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { state: "failed", message: `The host answered ${String(status)} with text that is not JSON.` };
  }
  if (!isRecord(parsed)) return { state: "failed", message: `The host answered ${String(status)} with an unexpected body.` };
  if (parsed.ok !== true) return { state: "failed", message: textOf(parsed.error) ?? `The host answered ${String(status)}.` };
  const host = textOf(parsed.host) ?? "this host";
  if (parsed.ready === false) {
    const off: FollowUpReadiness = { ready: false, host, reason: textOf(parsed.reason) ?? "a follow-up cannot start now" };
    const rightHost = textOf(parsed.rightHost);
    if (rightHost !== undefined) off.rightHost = rightHost;
    const command = textOf(parsed.command);
    if (command !== undefined) off.command = command;
    return { state: "done", readiness: off };
  }
  const questions = questionsOf(parsed.questions);
  const items = itemsOf(parsed.items);
  const profile = textOf(parsed.profile);
  if (parsed.ready !== true || questions === null || items === null || profile === undefined) return { state: "failed", message: "The host sent a follow-up check that this page cannot read." };
  const ready: FollowUpReadiness = { ready: true, host, profile, surface: parsed.surface === "headless" ? "headless" : "herdr", questions, items };
  const via = textOf(parsed.via);
  if (via !== undefined) ready.via = via;
  return { state: "done", readiness: ready };
}

/** Asks the host whether the follow-up can start. Never throws: a network error is a `failed` state. */
export async function fetchReadiness(project: string, run: string, signal: AbortSignal): Promise<Loaded> {
  const query = new URLSearchParams({ project, run });
  try {
    const response = await fetch(`/api/run/follow-up/ready?${query.toString()}`, { headers: { accept: "application/json" }, cache: "no-store", signal });
    return readReadiness(response.status, await response.text());
  } catch {
    return { state: "failed", message: "The host did not answer. Check the connection and open the page again." };
  }
}
