/**
 * What the backup controls know about the snapshot settings: the eleven
 * fields, their names on the wire (snake case), the environment variable
 * that sets each one, and the words for where a value came from. Pure, so the
 * server render and the browser agree.
 */

import type { BackupSettings, SettingSource } from "../../../src/web/api.ts";

/** A field of the page, by its camelCase name in `BackupSettings`. */
export type SettingKey = keyof BackupSettings;

export type FieldKind = "toggle" | "text" | "number";

/** How wide the input is: short for a number, medium for a name, long for a path or an address. */
export type FieldWidth = "short" | "medium" | "long";

export interface FieldSpec {
  key: SettingKey;
  /** The key in the save request and the name behind `DARIUS_SNAPSHOT_`. */
  wire: string;
  kind: FieldKind;
  label: string;
  hint: string;
  width: FieldWidth;
}

export const LOCAL_FIELDS: readonly FieldSpec[] = [
  { key: "enabled", wire: "enabled", kind: "toggle", label: "Make snapshots", hint: "Off stops the timer from making new ones.", width: "short" },
  { key: "dir", wire: "dir", kind: "text", label: "Folder", hint: "Where this host keeps its snapshots. A leading ~ is the home folder.", width: "long" },
  { key: "keep", wire: "keep", kind: "number", label: "Keep on this host", hint: "How many of the newest snapshots stay here.", width: "short" },
];

export const REMOTE_FIELDS: readonly FieldSpec[] = [
  { key: "endpoint", wire: "endpoint", kind: "text", label: "Endpoint", hint: "The address of the S3 service, for example https://s3.example.com.", width: "long" },
  { key: "bucket", wire: "bucket", kind: "text", label: "Bucket", hint: "An empty endpoint and an empty bucket mean no remote copy.", width: "medium" },
  { key: "region", wire: "region", kind: "text", label: "Region", hint: "The region name the service expects.", width: "medium" },
  { key: "prefix", wire: "prefix", kind: "text", label: "Prefix", hint: "A folder inside the bucket. Empty uses the top.", width: "medium" },
  { key: "pathStyle", wire: "path_style", kind: "toggle", label: "Path style", hint: "Put the bucket in the path, not in the host name.", width: "short" },
  { key: "allowHttp", wire: "allow_http", kind: "toggle", label: "Allow plain http", hint: "Only for a service on a trusted network.", width: "short" },
  { key: "sse", wire: "sse", kind: "toggle", label: "Server side encryption", hint: "Ask the service to encrypt each object.", width: "short" },
  { key: "keepRemote", wire: "keep_remote", kind: "number", label: "Keep in the bucket", hint: "How many of the newest snapshots stay in the bucket.", width: "short" },
];

export const ALL_FIELDS: readonly FieldSpec[] = [...LOCAL_FIELDS, ...REMOTE_FIELDS];

/** The variable that sets a field: `DARIUS_SNAPSHOT_KEEP_REMOTE`. */
export function envName(wire: string): string {
  return `DARIUS_SNAPSHOT_${wire.toUpperCase()}`;
}

export const ENV_KEY_ID = "DARIUS_SNAPSHOT_ACCESS_KEY_ID";
export const ENV_SECRET = "DARIUS_SNAPSHOT_SECRET_ACCESS_KEY";

const SOURCE_WORDS = {
  env: "Set by the environment",
  file: "Saved here",
  config: "From config.toml",
  default: "Default",
} as const satisfies Record<SettingSource, string>;

export function sourceWord(source: SettingSource): string {
  return SOURCE_WORDS[source];
}

/** What the key pair is, in words. */
export function credentialsWord(source: "env" | "file" | "none"): string {
  if (source === "env") return "from the environment";
  return source === "file" ? "saved on this host" : "not set";
}

/** A short form of a sha256: the first 12 characters. */
export function shortSha(sha: string): string {
  return sha.slice(0, 12);
}
