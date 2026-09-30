/**
 * Profile resolution (docs/concept.md, "Harnesses, profiles and surfaces" >
 * "Profiles"). A profile is a named preset for starting a harness. Which one
 * a ritual uses, and what it sets, resolves field by field, highest first:
 *
 *   1. the ritual itself: `policy.profile` names the profile; `policy.model`
 *      and `policy.max_turns` override its fields, as they always did
 *   2. the repo's `.darius.toml`: `[profiles.<name>]` and `[defaults] ritual`
 *   3. the store-wide profiles in the reserved `_global` project
 *   4. the built-in default: claude, headless, permissions skipped (0.20.0)
 *
 * With no profile named anywhere, the profile called `default` is used when
 * the repo or the store defines one. With none at all a run is exactly what
 * it was before profiles existed. `max_mode` is never a profile field: a
 * profile chooses how a harness runs, never how far a ritual may go.
 */

import type { Policy, ProfileFields } from "../core/model.ts";
import type { HarnessAdapter, ResolvedProfile } from "./contract.ts";
import { HARNESS_IDS, harnessById } from "./registry.ts";

export const DEFAULT_PROFILE = "default";

/** What a repo's `.darius.toml` says about profiles. */
export interface RepoProfiles {
  profiles: Readonly<Record<string, ProfileFields>>;
  /** `[defaults] ritual`: the profile a ritual uses when it names none. */
  defaultRitual?: string;
  /** The marker file, for error messages. */
  file: string;
}

export interface ProfileSources {
  policy: Policy;
  repo: RepoProfiles | null;
  /** A store-wide profile by name, or undefined. */
  global: (name: string) => ProfileFields | undefined;
}

/** The profile resolved, plus the adapter of its harness. */
export interface Resolution {
  profile: ResolvedProfile;
  harness: HarnessAdapter;
}

/** Which profile name applies, and who named it. undefined: the built-in default. */
function chosenName(sources: ProfileSources): { name: string; explicit: boolean } | undefined {
  const { policy, repo } = sources;
  if (policy.profile !== undefined && policy.profile !== "") return { name: policy.profile, explicit: true };
  if (repo?.defaultRitual !== undefined) return { name: repo.defaultRitual, explicit: true };
  const hasDefault = repo?.profiles[DEFAULT_PROFILE] !== undefined || sources.global(DEFAULT_PROFILE) !== undefined;
  return hasDefault ? { name: DEFAULT_PROFILE, explicit: false } : undefined;
}

/** `upper` over `lower`, field by field; an absent field in `upper` keeps `lower`'s. */
function overlay(lower: ProfileFields, upper: ProfileFields | undefined): ProfileFields {
  if (upper === undefined) return lower;
  const merged: ProfileFields = { ...lower };
  for (const [key, value] of Object.entries(upper)) {
    if (value !== undefined) Object.assign(merged, { [key]: value });
  }
  return merged;
}

/** The flag a profile arg names: `--flag` of `--flag=value`. */
function flagOf(arg: string): string {
  const equals = arg.indexOf("=");
  return equals === -1 ? arg : arg.slice(0, equals);
}

/** The first arg the adapter reserves, or undefined. */
export function reservedArg(args: readonly string[], harness: HarnessAdapter): string | undefined {
  return args.find((arg) => harness.reservedArgs.includes(flagOf(arg)));
}

/**
 * Checks fields that depend on the harness: the harness exists, the effort
 * is one it takes, and no arg is reserved. Returns the adapter. Throws a
 * plain Error naming `where` otherwise.
 */
export function checkProfileFields(fields: ProfileFields, where: string): HarnessAdapter {
  const id = fields.harness ?? "claude";
  const harness = harnessById(id);
  if (harness === undefined) throw new Error(`${where}: unknown harness "${id}" (known: ${HARNESS_IDS.join(", ")})`);
  if (fields.effort !== undefined && !harness.efforts.includes(fields.effort)) {
    throw new Error(`${where}: ${id} takes effort ${harness.efforts.join(", ")}, not "${fields.effort}"`);
  }
  const reserved = reservedArg(fields.args ?? [], harness);
  if (reserved !== undefined) {
    throw new Error(`${where}: args may not contain ${reserved}; darius sets it, or it could bypass the gate`);
  }
  return harness;
}

/** Resolves the profile for one ritual. Throws a plain Error when it names a profile nobody defines, or an invalid one. */
export function resolveProfile(sources: ProfileSources): Resolution {
  const { policy, repo } = sources;
  const chosen = chosenName(sources);
  let fields: ProfileFields = {};
  if (chosen !== undefined) {
    const fromStore = sources.global(chosen.name);
    const fromRepo = repo?.profiles[chosen.name];
    if (chosen.explicit && fromStore === undefined && fromRepo === undefined) {
      const repoNote = repo === null ? "" : ` or ${repo.file}`;
      throw new Error(`profile "${chosen.name}" is not defined in the store${repoNote}; add it with darius profile add ${chosen.name}`);
    }
    fields = overlay(overlay(fields, fromStore), fromRepo);
  }
  const ritualFields: ProfileFields = {};
  if (policy.model !== undefined && policy.model !== "") ritualFields.model = policy.model;
  if (policy.max_turns !== undefined) ritualFields.max_turns = policy.max_turns;
  fields = overlay(fields, ritualFields);
  const where = chosen === undefined ? "the built-in profile" : `profile "${chosen.name}"`;
  const harness = checkProfileFields(fields, where);
  const profile: ResolvedProfile = {
    harness: harness.id,
    permissions: fields.permissions ?? "skip",
    surface: fields.surface ?? "headless",
    args: [...(fields.args ?? [])],
  };
  if (chosen !== undefined) profile.name = chosen.name;
  if (fields.model !== undefined) profile.model = fields.model;
  if (fields.effort !== undefined) profile.effort = fields.effort;
  if (fields.max_turns !== undefined) profile.maxTurns = fields.max_turns;
  return { profile, harness };
}
