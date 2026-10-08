/**
 * The snapshot settings and the key pair, from one host to another
 * (`darius snapshot config push --hosts` and `snapshot config receive`,
 * src/cli/snapshot-push.ts; docs/backups.md, "Set up every host at once").
 *
 * The sender builds one JSON document: every setting except the host-local
 * ones (`dir`, `enabled`, `ping_url`), the key pair, the sender's host id, and whether
 * the operator allowed an overwrite. The keys come from SNAPSHOT_KEYS, so a
 * new setting travels without a change here.
 *
 * The receiver plans before it writes (planReceive). It refuses:
 *   - a document from itself (the same host id: a push to the local host),
 *   - a setting it does not know (an older darius) or a bad value,
 *   - a setting or the key pair the environment sets to another value: the
 *     environment wins on that host, so a write would be silently ignored,
 *   - a value it holds in snapshot.json or config.toml that differs, or
 *     another saved key id, unless the document allows an overwrite. The
 *     answer then lists every change, so the operator sees it first.
 * Then it writes the settings (applySnapshotSettings) and after them the key
 * pair (saveSnapshotCredentials): a refused setting leaves the old key.
 *
 * The secret is never in a message, an answer or a log line here. A parse
 * error of the document gives a fixed text, since a JSON parser may quote
 * the input.
 */

import type { JsonValue } from "./model.ts";
import {
  applySnapshotSettings,
  coerceSnapshotValue,
  credentialsEnvLock,
  isSnapshotKey,
  resolveSnapshotSettings,
  saveSnapshotCredentials,
  snapshotEnvName,
  snapshotKeyId,
  SNAPSHOT_KEYS,
  type ResolvedSnapshotSettings,
  type SnapshotKey,
  type SnapshotValue,
} from "./snapshot-settings.ts";

/**
 * Settings that describe this host only. A push never sends them. `ping_url`
 * is one: each host needs its own check in the ping service, or one host's
 * ping would hide another's silence. It is also a capability.
 */
export const HOST_LOCAL_KEYS: ReadonlySet<string> = new Set(["dir", "enabled", "ping_url"]);

/** The most characters a document may hold. Settings and a key pair are far below it. */
export const MAX_DOCUMENT_BYTES = 64 * 1024;

export interface PushDocument {
  v: 1;
  /** The host id of the sender. A receiver with the same id refuses. */
  origin: string;
  /** True when the operator gave `--overwrite`. */
  overwrite: boolean;
  settings: Record<string, SnapshotValue>;
  key_id: string;
  secret: string;
}

/** The keys a push sends: every setting that is not host-local. */
export function pushedKeys(): SnapshotKey[] {
  return SNAPSHOT_KEYS.filter((key) => !HOST_LOCAL_KEYS.has(key));
}

/** The document for `resolved` and the key pair. Refuses what the spec refuses; the message names no key value. */
export function buildPushDocument(
  resolved: ResolvedSnapshotSettings,
  keyPair: { accessKeyId: string; secretAccessKey: string },
  origin: string,
  overwrite: boolean,
): { ok: true; document: PushDocument } | { ok: false; error: string } {
  if (resolved.problems.length > 0) return { ok: false, error: `fix the settings here first: ${resolved.problems.join("; ")}` };
  if (String(resolved.values.get("endpoint") ?? "") === "" && String(resolved.values.get("bucket") ?? "") === "") {
    return { ok: false, error: "nothing to push: set a bucket first (darius snapshot config set endpoint <url> bucket <name>)" };
  }
  const settings: Record<string, SnapshotValue> = {};
  for (const key of pushedKeys()) {
    const value = resolved.values.get(key);
    if (value !== undefined) settings[key] = value;
  }
  return { ok: true, document: { v: 1, origin, overwrite, settings, key_id: keyPair.accessKeyId, secret: keyPair.secretAccessKey } };
}

// --- the receiver -------------------------------------------------------------------------

function isRecord(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isRaw(value: JsonValue): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/** The document in `text`, or a message that quotes none of the text. */
export function parsePushDocument(text: string): { ok: true; document: PushDocument } | { ok: false; error: string } {
  const bad = { ok: false as const, error: "the input is not a snapshot settings document (v 1)" };
  if (text.length > MAX_DOCUMENT_BYTES) return bad;
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(text);
  } catch {
    // The parser's own message may quote the input, and the input holds the secret.
    return bad;
  }
  if (!isRecord(parsed) || parsed.v !== 1) return bad;
  const { origin, overwrite, settings, key_id: keyId, secret } = parsed;
  if (!isText(origin) || !isText(keyId) || !isText(secret) || !isRecord(settings)) return bad;
  const values: Record<string, SnapshotValue> = {};
  for (const [name, value] of Object.entries(settings)) {
    if (!isRaw(value)) return bad;
    values[name] = value;
  }
  return { ok: true, document: { v: 1, origin, overwrite: overwrite === true, settings: values, key_id: keyId, secret } };
}

/** One setting the receive changes. `source` is where the old value came from. */
export interface SettingChange {
  key: string;
  from: SnapshotValue | null;
  to: SnapshotValue;
  source: string;
}

export type CredentialsOutcome = "created" | "replaced" | "env";

/** The answer of `snapshot config receive`, one JSON object. It never holds the secret. */
export interface ReceiveAnswer {
  ok: boolean;
  outcome: "applied" | "refused" | "failed";
  /** The keys whose value changed here. */
  applied: string[];
  /** Every change, also when refused, so the sender can show it. */
  changes: SettingChange[];
  /** Keys the environment sets here to the same value: left as they are. */
  env: string[];
  /** The key pair: written new, written over a saved one, or set by the environment to the same key id. */
  credentials: CredentialsOutcome | null;
  /** The key id here before, when it differs from the pushed one. Not secret. */
  keyIdFrom: string | null;
  /** True when the receive was refused only because it would overwrite other values. */
  needsOverwrite: boolean;
  detail: string;
}

function answer(fields: Partial<ReceiveAnswer> & Pick<ReceiveAnswer, "outcome" | "detail">): ReceiveAnswer {
  return { ok: fields.outcome === "applied", applied: [], changes: [], env: [], credentials: null, keyIdFrom: null, needsOverwrite: false, ...fields };
}

interface Plan {
  patch: Map<SnapshotKey, SnapshotValue>;
  changes: SettingChange[];
  envSame: string[];
  envConflicts: string[];
  /** Changes of a value this host holds on purpose (snapshot.json or config.toml). */
  overwrites: number;
  errors: string[];
}

function planSettings(settings: Readonly<Record<string, SnapshotValue>>, current: ResolvedSnapshotSettings, env: NodeJS.ProcessEnv): Plan {
  const plan: Plan = { patch: new Map(), changes: [], envSame: [], envConflicts: [], overwrites: 0, errors: [] };
  for (const [name, raw] of Object.entries(settings)) {
    if (!isSnapshotKey(name)) {
      plan.errors.push(`this darius does not know the setting "${name}"; update darius on this host first`);
      continue;
    }
    if (HOST_LOCAL_KEYS.has(name)) {
      plan.errors.push(`${name} is host-local and is never pushed`);
      continue;
    }
    const checked = coerceSnapshotValue(name, raw);
    if (!checked.ok) {
      plan.errors.push(checked.error);
      continue;
    }
    const before = current.values.get(name) ?? null;
    const source = current.sources.get(name) ?? "default";
    const locked = env[snapshotEnvName(name)];
    if (locked !== undefined && locked !== "") {
      if (before === checked.value) plan.envSame.push(name);
      else plan.envConflicts.push(`${name} is set by ${snapshotEnvName(name)} here to another value; change it where the service starts`);
      continue;
    }
    plan.patch.set(name, checked.value);
    if (before === checked.value) continue;
    plan.changes.push({ key: name, from: before, to: checked.value, source });
    if (source !== "default") plan.overwrites += 1;
  }
  return plan;
}

interface KeyPlan {
  outcome: CredentialsOutcome;
  keyIdFrom: string | null;
  overwrite: boolean;
  error: string | null;
}

function planKeyPair(keyId: string, env: NodeJS.ProcessEnv): KeyPlan {
  const here = snapshotKeyId(env);
  const lock = credentialsEnvLock(env);
  if (lock !== null) {
    if (here.keyId === keyId) return { outcome: "env", keyIdFrom: null, overwrite: false, error: null };
    return { outcome: "env", keyIdFrom: here.keyId, overwrite: false, error: `the key pair is set by ${lock} here to another key id; change it where the service starts` };
  }
  if (here.source === "none") return { outcome: "created", keyIdFrom: null, overwrite: false, error: null };
  const differs = here.keyId !== keyId;
  return { outcome: "replaced", keyIdFrom: differs ? here.keyId : null, overwrite: differs, error: null };
}

/**
 * Applies a pushed document on this host: plans, refuses or writes. `hostId`
 * is this host's id. `env` is what the snapshot units see (snapshotUnitEnv).
 */
export function receivePushDocument(document: PushDocument, hostId: string, env: NodeJS.ProcessEnv): ReceiveAnswer {
  if (document.origin === hostId) return answer({ outcome: "refused", detail: `this is the sending host (${hostId}); a push goes to other hosts only` });
  const current = resolveSnapshotSettings({ env });
  const plan = planSettings(document.settings, current, env);
  if (plan.errors.length > 0) return answer({ outcome: "refused", detail: plan.errors.join("; ") });
  const keys = planKeyPair(document.key_id, env);
  const shared = { changes: plan.changes, env: plan.envSame, credentials: keys.outcome, keyIdFrom: keys.keyIdFrom };
  const locked = [...plan.envConflicts, ...(keys.error === null ? [] : [keys.error])];
  if (locked.length > 0) return answer({ ...shared, outcome: "refused", detail: locked.join("; ") });
  if ((plan.overwrites > 0 || keys.overwrite) && !document.overwrite) {
    return answer({ ...shared, outcome: "refused", needsOverwrite: true, detail: "this host has other values; run the push again with --overwrite to replace them" });
  }

  const applied = applySnapshotSettings(plan.patch, env);
  if (!applied.ok) return answer({ ...shared, outcome: applied.failed === "write" ? "failed" : "refused", detail: applied.errors.join("; ") });
  if (keys.outcome !== "env") {
    const saved = saveSnapshotCredentials(document.key_id, document.secret, env);
    // The settings are saved; the old key pair is left as it was.
    if (!saved.ok) return answer({ ...shared, outcome: "failed", applied: plan.changes.map((change) => change.key), detail: `the settings are saved, the key pair is not: ${saved.error}` });
  }
  return answer({ ...shared, outcome: "applied", applied: plan.changes.map((change) => change.key), detail: "" });
}
