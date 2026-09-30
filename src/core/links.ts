/**
 * `<configDir>/links.toml`: which checkout on THIS host holds each project.
 * `darius link` writes it; run-due and the vigil sweep read it to know where
 * a project's claude sessions and vigil Commands run (src/core/workdir.ts).
 *
 *   [projects]
 *   acme-web = "/home/user/projects/acme-web"
 *
 * Paths are per host, so they never go in the repo's `.darius.toml`. They are
 * not in config.toml either: on NixOS home-manager writes config.toml as a
 * read-only link into the Nix store, and `darius link` must still work there.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { configDir } from "./paths.ts";
import { parseToml, tomlKey, tomlString, type TomlValue } from "./toml.ts";

const SECTION = "projects";
const HEADER = [
  "# darius links on this host: the checkout that holds each project.",
  "# Written by `darius link`. One line per project.",
];

function isText(value: TomlValue): value is string {
  return typeof value === "string";
}

export function linksFile(): string {
  return join(configDir(), "links.toml");
}

/** Project name to checkout dir. Empty when the file does not exist. A malformed file throws. */
export function readLinks(): Map<string, string> {
  const file = linksFile();
  if (!existsSync(file)) return new Map();
  const document = parseToml(readFileSync(file, "utf8"), file);
  const stray = Object.keys(document.root)[0] ?? Object.keys(document.sections).find((name) => name !== SECTION);
  if (stray !== undefined) throw new Error(`${file}: "${stray}" is outside [${SECTION}]; the file holds that table only`);
  const links = new Map<string, string>();
  for (const [project, dir] of Object.entries(document.sections[SECTION] ?? {})) {
    if (!isText(dir) || dir === "") {
      throw new Error(`${file}:${String(document.lines[`${SECTION}.${project}`])}: ${project} must be a directory path in quotes`);
    }
    links.set(project, dir);
  }
  return links;
}

/** The checkout dir linked for `project` on this host, or undefined. */
export function linkedDir(project: string): string | undefined {
  return readLinks().get(project);
}

/** Rewrites links.toml with `project` set to `dir`. Atomic: a crash leaves the old file or the new one. */
export function writeLink(project: string, dir: string): void {
  const links = readLinks();
  links.set(project, dir);
  const body = [...links.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([name, path]) => `${tomlKey(name)} = ${tomlString(path)}`);
  const file = linksFile();
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${String(process.pid)}.tmp`;
  writeFileSync(temp, [...HEADER, "", `[${SECTION}]`, ...body, ""].join("\n"));
  renameSync(temp, file);
}
