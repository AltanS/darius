/**
 * agent-discovery — read live Claude Code plugin state and return a roster of
 * all dispatchable agents.
 *
 * No external dependencies. All I/O errors are graceful: missing files are
 * treated as empty, malformed entries are skipped with a stderr warning.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parseFrontmatter } from "./markdown/frontmatter.ts";
import type { AgentDescriptor } from "./types.mts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AgentDiscoveryOptions = {
  /** Path to installed_plugins.json. Default: ~/.claude/plugins/installed_plugins.json */
  installedPluginsJsonPath?: string;
  /** Path to user-level settings.json. Default: ~/.claude/settings.json */
  userSettingsPath?: string;
  /** Path to project-level settings.json. Default: <cwd>/.claude/settings.json */
  projectSettingsPath?: string;
  /** Path to user agents directory. Default: ~/.claude/agents/ */
  userAgentsDir?: string;
  /** Path to project agents directory. Default: <cwd>/.claude/agents/ */
  projectAgentsDir?: string;
};

// ---------------------------------------------------------------------------
// Internal types for the real installed_plugins.json schema
// ---------------------------------------------------------------------------

type InstallRecord = {
  installPath: string;
  version?: string;
  scope?: string;
  installedAt?: string;
  lastUpdated?: string;
  gitCommitSha?: string;
};

type InstalledPluginsFile = {
  version?: number;
  plugins?: Record<string, InstallRecord[]>;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Discover all dispatchable agents from installed plugins and local agent dirs.
 *
 * Never throws — all errors produce stderr warnings and graceful fallbacks.
 */
export function discoverAgents(opts?: AgentDiscoveryOptions): AgentDescriptor[] {
  const home = homedir();
  const cwd = process.cwd();

  const paths = resolvePaths(home, cwd, opts);
  const installedPlugins = readInstalledPlugins(paths.installedPluginsJsonPath);
  const enabledPlugins = readEnabledPlugins(paths.userSettingsPath, paths.projectSettingsPath);

  const pluginAgents = collectPluginAgents(installedPlugins, enabledPlugins);
  const projectAgents = collectBareAgents(paths.projectAgentsDir, "project-agents");
  const userAgents = collectBareAgents(paths.userAgentsDir, "user-agents");

  return [...pluginAgents, ...projectAgents, ...userAgents].filter(
    (a) => a.invocable !== "tracker:darius",
  );
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

type ResolvedPaths = {
  installedPluginsJsonPath: string;
  userSettingsPath: string;
  projectSettingsPath: string;
  userAgentsDir: string;
  projectAgentsDir: string;
};

function resolvePaths(
  home: string,
  cwd: string,
  opts: AgentDiscoveryOptions = {},
): ResolvedPaths {
  return {
    installedPluginsJsonPath:
      opts.installedPluginsJsonPath ?? join(home, ".claude", "plugins", "installed_plugins.json"),
    userSettingsPath: opts.userSettingsPath ?? join(home, ".claude", "settings.json"),
    projectSettingsPath: opts.projectSettingsPath ?? join(cwd, ".claude", "settings.json"),
    userAgentsDir: opts.userAgentsDir ?? join(home, ".claude", "agents"),
    projectAgentsDir: opts.projectAgentsDir ?? join(cwd, ".claude", "agents"),
  };
}

// ---------------------------------------------------------------------------
// JSON readers
// ---------------------------------------------------------------------------

/**
 * Read installed_plugins.json and extract a map of fullKey -> installPath.
 *
 * Real schema (Claude Code v2):
 *   { "version": 2, "plugins": { "name@marketplace": [{ "installPath": "...", ... }] } }
 *
 * Each plugin value is an array of install records; we use the last (latest).
 * Returns map of full key (e.g. "typescript@example-marketplace") -> installPath.
 */
function readInstalledPlugins(filePath: string): Record<string, string> {
  const raw = tryReadJson(filePath);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};

  const parsed = raw as InstalledPluginsFile;

  // Real schema: data is nested under .plugins
  if (typeof parsed.plugins !== "object" || parsed.plugins === null) return {};

  const result: Record<string, string> = {};
  for (const [fullKey, records] of Object.entries(parsed.plugins)) {
    if (!Array.isArray(records) || records.length === 0) continue;
    // Use last record — most recently installed version
    const lastRecord = records[records.length - 1];
    if (typeof lastRecord?.installPath !== "string") continue;
    result[fullKey] = lastRecord.installPath;
  }
  return result;
}

function readEnabledPlugins(
  userSettingsPath: string,
  projectSettingsPath: string,
): Record<string, boolean> {
  const userEnabled = extractEnabledPlugins(tryReadJson(userSettingsPath));
  const projectEnabled = extractEnabledPlugins(tryReadJson(projectSettingsPath));
  return { ...userEnabled, ...projectEnabled };
}

function extractEnabledPlugins(settings: unknown): Record<string, boolean> {
  if (settings === null || typeof settings !== "object" || Array.isArray(settings)) return {};
  const s = settings as Record<string, unknown>;
  if (typeof s["enabledPlugins"] !== "object" || s["enabledPlugins"] === null) return {};
  return s["enabledPlugins"] as Record<string, boolean>;
}

function tryReadJson(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Plugin agent collection
// ---------------------------------------------------------------------------

/**
 * Collect agents from installed plugins.
 *
 * Enabled lookup uses the FULL key: enabled["typescript@example-marketplace"] === true
 * Invocable prefix uses the SHORT name (before "@"): "typescript:typescript-expert"
 */
function collectPluginAgents(
  installed: Record<string, string>,
  enabled: Record<string, boolean>,
): AgentDescriptor[] {
  const results: AgentDescriptor[] = [];

  for (const [fullKey, installDir] of Object.entries(installed)) {
    // Enabled lookup uses FULL key: "typescript@example-marketplace"
    if (enabled[fullKey] !== true) continue;
    if (typeof installDir !== "string") continue;

    // Invocable prefix uses SHORT name (substring before "@")
    // e.g. "typescript@example-marketplace" -> "typescript"
    const shortName = fullKey.includes("@") ? fullKey.split("@")[0]! : fullKey;

    const agentsDir = join(installDir, "agents");
    const mdFiles = listMarkdownFiles(agentsDir);

    for (const file of mdFiles) {
      const descriptor = parsePluginAgent(file, shortName);
      if (descriptor !== null) results.push(descriptor);
    }
  }

  return results;
}

/**
 * Extract name and description from a markdown agent file's frontmatter.
 *
 * Primary path: use the strict YAML parser (parseFrontmatter).
 * Fallback path: regex extraction from the raw frontmatter block.
 *
 * Agent files from real Claude Code plugins may contain inline array syntax
 * (e.g. `tools: ["Read", "Write"]`) that the strict parser rejects. We fall
 * back to regex for name/description only — all we need for routing.
 */
function extractAgentFields(raw: string): { name: string; description: string } | null {
  // Try strict parser first
  try {
    const parsed = parseFrontmatter(raw);
    const name = parsed.data["name"];
    const description = parsed.data["description"];
    if (
      typeof name === "string" && name.trim() !== "" &&
      typeof description === "string" && description.trim() !== ""
    ) {
      return { name: name.trim(), description: description.trim() };
    }
    // Valid parse but missing required fields
    return null;
  } catch {
    // Strict parser failed (e.g. inline array syntax in tools/skills fields).
    // Fall back to regex extraction of name and description only.
  }

  // Regex fallback: extract frontmatter block, then regex out name and description
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(raw);
  if (!fmMatch) return null;

  const yamlBlock = fmMatch[1]!;

  // Match bare scalar: `name: some-value`
  // Match quoted: `name: "some value"` or `name: 'some value'`
  const nameMatch =
    /^name:\s+"([^"]+)"\s*$/m.exec(yamlBlock) ||
    /^name:\s+'([^']+)'\s*$/m.exec(yamlBlock) ||
    /^name:\s+([^\r\n"'\[{]+?)\s*$/m.exec(yamlBlock);

  const descMatch =
    /^description:\s+"([^"]+)"\s*$/m.exec(yamlBlock) ||
    /^description:\s+'([^']+)'\s*$/m.exec(yamlBlock) ||
    /^description:\s+([^\r\n"'\[{]+?)\s*$/m.exec(yamlBlock);

  const name = nameMatch?.[1]?.trim();
  const description = descMatch?.[1]?.trim();

  if (!name || name === "" || !description || description === "") return null;
  return { name, description };
}

function parsePluginAgent(filePath: string, pluginName: string): AgentDescriptor | null {
  const raw = tryReadFile(filePath);
  if (raw === null) return null;

  const fields = extractAgentFields(raw);
  if (fields === null) {
    warn(`agent-discovery: missing or invalid name/description in ${filePath} — skipping`);
    return null;
  }

  return {
    invocable: `${pluginName}:${fields.name}`,
    description: fields.description,
    source: "plugin",
  };
}

// ---------------------------------------------------------------------------
// Bare agent collection (project-agents / user-agents)
// ---------------------------------------------------------------------------

function collectBareAgents(
  agentsDir: string,
  source: "project-agents" | "user-agents",
): AgentDescriptor[] {
  const mdFiles = listMarkdownFiles(agentsDir);
  return mdFiles.flatMap((file) => {
    const descriptor = parseBareAgent(file, source);
    return descriptor !== null ? [descriptor] : [];
  });
}

function parseBareAgent(
  filePath: string,
  source: "project-agents" | "user-agents",
): AgentDescriptor | null {
  const raw = tryReadFile(filePath);
  if (raw === null) return null;

  const fields = extractAgentFields(raw);
  if (fields === null) {
    warn(`agent-discovery: missing or invalid name/description in ${filePath} — skipping`);
    return null;
  }

  return {
    invocable: fields.name,
    description: fields.description,
    source,
  };
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

function listMarkdownFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

function tryReadFile(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function warn(message: string): void {
  process.stderr.write(`${message}\n`);
}
