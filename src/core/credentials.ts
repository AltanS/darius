/**
 * AWS-ini credentials for the hand-rolled S3 client
 * (`~/.config/darius/credentials`, docs/plan-tonight.md "Config and paths").
 *
 * The file holds a live secret, so two rules are load-bearing here: the mode
 * check refuses a file that grants its group or others any access, and no
 * error message below ever includes a key VALUE, only the file path and key
 * NAMES. Owner-only modes all pass: 0600 from `chmod`, and 0400, which is how
 * sops-nix delivers a secret.
 */

import { readFileSync, statSync } from "node:fs";

import { errorMessage } from "../runtime.ts";

/** The group and other permission bits. A credentials file must have none of them set. */
const GROUP_OTHER_BITS = 0o077;
const SECTION_HEADER = /^\[([A-Za-z0-9_-]+)\]$/;
const KEY_VALUE = /^([A-Za-z0-9_]+)\s*=\s*(.*)$/;

function readDefaultSection(text: string, path: string) {
  const section: Record<string, string> = {};
  let inDefault = false;

  const lines = text.split("\n");
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.replace(/\r$/, "").trim();
    const lineNumber = index + 1;
    if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;

    const sectionMatch = SECTION_HEADER.exec(line);
    if (sectionMatch !== null) {
      inDefault = sectionMatch[1] === "default";
      continue;
    }
    if (!inDefault) continue;

    const keyValue = KEY_VALUE.exec(line);
    if (keyValue === null) {
      throw new Error(`${path}:${lineNumber}: cannot parse credentials line`);
    }
    const key = keyValue[1];
    const value = keyValue[2];
    if (key === undefined || value === undefined) {
      throw new Error(`${path}:${lineNumber}: cannot parse credentials line`);
    }
    section[key] = value.trim();
  }

  return section;
}

export interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * Reads the access key pair from an AWS-ini `[default]` section at `path`.
 * Accepts any owner-only mode (0600, 0400), refuses a file whose mode grants
 * group or other any access, and never puts a key value in a thrown message.
 */
export function loadCredentials(path: string): Credentials {
  let mode: number;
  try {
    mode = statSync(path).mode & 0o777;
  } catch (cause) {
    throw new Error(`${path}: cannot read credentials file, ${errorMessage(cause)}`, { cause });
  }
  if ((mode & GROUP_OTHER_BITS) !== 0) {
    throw new Error(
      `${path}: credentials file must be readable by its owner only (mode 0600 or 0400), ` +
        `found ${mode.toString(8).padStart(4, "0")}. Run: chmod 600 ${path}`,
    );
  }

  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    throw new Error(`${path}: cannot read credentials file, ${errorMessage(cause)}`, { cause });
  }

  const defaults = readDefaultSection(text, path);
  const accessKeyId = defaults.aws_access_key_id;
  const secretAccessKey = defaults.aws_secret_access_key;
  if (accessKeyId === undefined || accessKeyId === "") {
    throw new Error(`${path}: [default] is missing aws_access_key_id`);
  }
  if (secretAccessKey === undefined || secretAccessKey === "") {
    throw new Error(`${path}: [default] is missing aws_secret_access_key`);
  }
  return { accessKeyId, secretAccessKey };
}
