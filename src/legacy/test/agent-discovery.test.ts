/**
 * Tests for the agentDiscovery / discoverAgents function.
 *
 * pnpm vitest run agent-discovery
 *
 * Fixtures use the REAL installed_plugins.json schema:
 *   { version: 2, plugins: { "name@marketplace": [{ installPath, ... }] } }
 *
 * Key invariants tested:
 * - Enabled lookup uses the FULL key ("name@marketplace")
 * - Invocable prefix uses the SHORT name (before "@"): "shortname:agent-name"
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverAgents } from "../lib/agent-discovery.ts";
import { parseFrontmatter, FrontmatterParseError } from "../lib/markdown/frontmatter.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Write installed_plugins.json with the REAL nested schema.
 * @param plugins - map of fullKey ("name@marketplace") -> installPath
 */
function makeInstalledPlugins(
  dir: string,
  plugins: Record<string, string>,
): string {
  const filePath = join(dir, "installed_plugins.json");
  const data = {
    version: 2,
    plugins: Object.fromEntries(
      Object.entries(plugins).map(([fullKey, installPath]) => [
        fullKey,
        [
          {
            installPath,
            scope: "user",
            version: "1.0.0",
            installedAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
          },
        ],
      ]),
    ),
  };
  writeFileSync(filePath, JSON.stringify(data), "utf-8");
  return filePath;
}

function makeSettings(dir: string, filename: string, settings: object): string {
  const filePath = join(dir, filename);
  writeFileSync(filePath, JSON.stringify(settings), "utf-8");
  return filePath;
}

function makePluginDir(baseDir: string, pluginName: string): string {
  const pluginDir = join(baseDir, pluginName);
  const agentsDir = join(pluginDir, "agents");
  mkdirSync(agentsDir, { recursive: true });
  return pluginDir;
}

function writeAgentFile(agentsDir: string, filename: string, name: string, description: string): void {
  const content = `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\nAgent body.\n`;
  writeFileSync(join(agentsDir, filename), content, "utf-8");
}

function writeAgentFileRaw(agentsDir: string, filename: string, content: string): void {
  writeFileSync(join(agentsDir, filename), content, "utf-8");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("agentDiscovery", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-discovery-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when no plugins installed", () => {
    const installedPluginsPath = makeInstalledPlugins(tmpDir, {});
    const userSettingsPath = makeSettings(tmpDir, "user-settings.json", {});
    const projectSettingsPath = makeSettings(tmpDir, "project-settings.json", {});
    const userAgentsDir = join(tmpDir, "user-agents");
    const projectAgentsDir = join(tmpDir, "project-agents");

    const result = discoverAgents({
      installedPluginsJsonPath: installedPluginsPath,
      userSettingsPath,
      projectSettingsPath,
      userAgentsDir,
      projectAgentsDir,
    });

    expect(result).toEqual([]);
  });

  it("returns empty array when installed_plugins.json is missing", () => {
    const nonExistentPath = join(tmpDir, "does-not-exist", "installed_plugins.json");
    const userSettingsPath = makeSettings(tmpDir, "user-settings.json", {});
    const projectSettingsPath = makeSettings(tmpDir, "project-settings.json", {});
    const userAgentsDir = join(tmpDir, "user-agents");
    const projectAgentsDir = join(tmpDir, "project-agents");

    const result = discoverAgents({
      installedPluginsJsonPath: nonExistentPath,
      userSettingsPath,
      projectSettingsPath,
      userAgentsDir,
      projectAgentsDir,
    });

    expect(result).toEqual([]);
  });

  it("excludes tracker:darius unconditionally", () => {
    const pluginDir = makePluginDir(tmpDir, "tracker");
    writeAgentFile(join(pluginDir, "agents"), "darius.md", "darius", "The Darius agent");

    // Full key for installed_plugins and enabledPlugins
    const installedPluginsPath = makeInstalledPlugins(tmpDir, { "tracker@example-marketplace": pluginDir });
    const userSettingsPath = makeSettings(tmpDir, "user-settings.json", {
      enabledPlugins: { "tracker@example-marketplace": true },
    });
    const projectSettingsPath = makeSettings(tmpDir, "project-settings.json", {});

    const result = discoverAgents({
      installedPluginsJsonPath: installedPluginsPath,
      userSettingsPath,
      projectSettingsPath,
      userAgentsDir: join(tmpDir, "user-agents"),
      projectAgentsDir: join(tmpDir, "project-agents"),
    });

    expect(result.find((a) => a.invocable === "tracker:darius")).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Full-key enabled lookup / short-name invocable split
  // -------------------------------------------------------------------------

  it("uses full key for enabled lookup but short name for invocable prefix", () => {
    const pluginDir = makePluginDir(tmpDir, "someplugin");
    writeAgentFile(join(pluginDir, "agents"), "some-agent.md", "some-agent", "Does stuff");

    // installed_plugins uses "someplugin@some-marketplace" as the full key
    const installedPluginsPath = makeInstalledPlugins(tmpDir, { "someplugin@some-marketplace": pluginDir });
    // enabledPlugins uses the FULL key
    const userSettingsPath = makeSettings(tmpDir, "user-settings.json", {
      enabledPlugins: { "someplugin@some-marketplace": true },
    });
    const projectSettingsPath = makeSettings(tmpDir, "project-settings.json", {});

    const result = discoverAgents({
      installedPluginsJsonPath: installedPluginsPath,
      userSettingsPath,
      projectSettingsPath,
      userAgentsDir: join(tmpDir, "user-agents"),
      projectAgentsDir: join(tmpDir, "project-agents"),
    });

    // Invocable uses SHORT name "someplugin", not full key
    expect(result.filter((a) => a.source === "plugin")).toHaveLength(1);
    expect(result[0]?.invocable).toBe("someplugin:some-agent");
    // Must NOT include the "@marketplace" part in the invocable
    expect(result[0]?.invocable).not.toContain("@");
  });

  // -------------------------------------------------------------------------
  describe("disabled plugin — filtering by enabledPlugins", () => {
    it("excludes plugin when enabledPlugins value is false", () => {
      const pluginDir = makePluginDir(tmpDir, "myplugin");
      writeAgentFile(join(pluginDir, "agents"), "my-agent.md", "my-agent", "Does something");

      // Full key in installed_plugins
      const installedPluginsPath = makeInstalledPlugins(tmpDir, { "myplugin@test-marketplace": pluginDir });
      // Full key in enabledPlugins set to false
      const userSettingsPath = makeSettings(tmpDir, "user-settings.json", {
        enabledPlugins: { "myplugin@test-marketplace": false },
      });
      const projectSettingsPath = makeSettings(tmpDir, "project-settings.json", {});

      const result = discoverAgents({
        installedPluginsJsonPath: installedPluginsPath,
        userSettingsPath,
        projectSettingsPath,
        userAgentsDir: join(tmpDir, "user-agents"),
        projectAgentsDir: join(tmpDir, "project-agents"),
      });

      expect(result.filter((a) => a.source === "plugin")).toHaveLength(0);
    });

    it("excludes plugin when absent from enabledPlugins map", () => {
      const pluginDir = makePluginDir(tmpDir, "myplugin");
      writeAgentFile(join(pluginDir, "agents"), "my-agent.md", "my-agent", "Does something");

      const installedPluginsPath = makeInstalledPlugins(tmpDir, { "myplugin@test-marketplace": pluginDir });
      const userSettingsPath = makeSettings(tmpDir, "user-settings.json", {
        enabledPlugins: {},
      });
      const projectSettingsPath = makeSettings(tmpDir, "project-settings.json", {});

      const result = discoverAgents({
        installedPluginsJsonPath: installedPluginsPath,
        userSettingsPath,
        projectSettingsPath,
        userAgentsDir: join(tmpDir, "user-agents"),
        projectAgentsDir: join(tmpDir, "project-agents"),
      });

      expect(result.filter((a) => a.source === "plugin")).toHaveLength(0);
    });

    it("includes plugin when enabledPlugins value is explicitly true", () => {
      const pluginDir = makePluginDir(tmpDir, "myplugin");
      writeAgentFile(join(pluginDir, "agents"), "my-agent.md", "my-agent", "Does something");

      // Full key in installed_plugins and enabledPlugins
      const installedPluginsPath = makeInstalledPlugins(tmpDir, { "myplugin@test-marketplace": pluginDir });
      const userSettingsPath = makeSettings(tmpDir, "user-settings.json", {
        enabledPlugins: { "myplugin@test-marketplace": true },
      });
      const projectSettingsPath = makeSettings(tmpDir, "project-settings.json", {});

      const result = discoverAgents({
        installedPluginsJsonPath: installedPluginsPath,
        userSettingsPath,
        projectSettingsPath,
        userAgentsDir: join(tmpDir, "user-agents"),
        projectAgentsDir: join(tmpDir, "project-agents"),
      });

      const pluginAgents = result.filter((a) => a.source === "plugin");
      expect(pluginAgents).toHaveLength(1);
      // Invocable uses SHORT name prefix (before "@"), not full key
      expect(pluginAgents[0]?.invocable).toBe("myplugin:my-agent");
      expect(pluginAgents[0]?.source).toBe("plugin");
    });

    it("project settings override user settings — project true enables", () => {
      const pluginDir = makePluginDir(tmpDir, "myplugin");
      writeAgentFile(join(pluginDir, "agents"), "my-agent.md", "my-agent", "Does something");

      const installedPluginsPath = makeInstalledPlugins(tmpDir, { "myplugin@test-marketplace": pluginDir });
      // User settings: absent from map (disabled)
      const userSettingsPath = makeSettings(tmpDir, "user-settings.json", {
        enabledPlugins: {},
      });
      // Project settings: explicitly enabled with full key
      const projectSettingsPath = makeSettings(tmpDir, "project-settings.json", {
        enabledPlugins: { "myplugin@test-marketplace": true },
      });

      const result = discoverAgents({
        installedPluginsJsonPath: installedPluginsPath,
        userSettingsPath,
        projectSettingsPath,
        userAgentsDir: join(tmpDir, "user-agents"),
        projectAgentsDir: join(tmpDir, "project-agents"),
      });

      const pluginAgents = result.filter((a) => a.source === "plugin");
      expect(pluginAgents).toHaveLength(1);
    });

    it("project settings override user settings — project false disables", () => {
      const pluginDir = makePluginDir(tmpDir, "myplugin");
      writeAgentFile(join(pluginDir, "agents"), "my-agent.md", "my-agent", "Does something");

      const installedPluginsPath = makeInstalledPlugins(tmpDir, { "myplugin@test-marketplace": pluginDir });
      // User settings: enabled with full key
      const userSettingsPath = makeSettings(tmpDir, "user-settings.json", {
        enabledPlugins: { "myplugin@test-marketplace": true },
      });
      // Project settings: disabled (overrides user) with full key
      const projectSettingsPath = makeSettings(tmpDir, "project-settings.json", {
        enabledPlugins: { "myplugin@test-marketplace": false },
      });

      const result = discoverAgents({
        installedPluginsJsonPath: installedPluginsPath,
        userSettingsPath,
        projectSettingsPath,
        userAgentsDir: join(tmpDir, "user-agents"),
        projectAgentsDir: join(tmpDir, "project-agents"),
      });

      expect(result.filter((a) => a.source === "plugin")).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("bare name agents — from .claude/agents/", () => {
    it("returns bare name agents from project agents dir", () => {
      const projectAgentsDir = join(tmpDir, "project-agents");
      mkdirSync(projectAgentsDir, { recursive: true });
      writeAgentFile(projectAgentsDir, "helper.md", "helper", "Helps with things");

      const installedPluginsPath = makeInstalledPlugins(tmpDir, {});
      const userSettingsPath = makeSettings(tmpDir, "user-settings.json", {});
      const projectSettingsPath = makeSettings(tmpDir, "project-settings.json", {});

      const result = discoverAgents({
        installedPluginsJsonPath: installedPluginsPath,
        userSettingsPath,
        projectSettingsPath,
        userAgentsDir: join(tmpDir, "user-agents"),
        projectAgentsDir,
      });

      expect(result).toHaveLength(1);
      expect(result[0]?.invocable).toBe("helper");
      expect(result[0]?.description).toBe("Helps with things");
      expect(result[0]?.source).toBe("project-agents");
    });

    it("returns bare name agents from user agents dir", () => {
      const userAgentsDir = join(tmpDir, "user-agents");
      mkdirSync(userAgentsDir, { recursive: true });
      writeAgentFile(userAgentsDir, "my-tool.md", "my-tool", "A useful tool");

      const installedPluginsPath = makeInstalledPlugins(tmpDir, {});
      const userSettingsPath = makeSettings(tmpDir, "user-settings.json", {});
      const projectSettingsPath = makeSettings(tmpDir, "project-settings.json", {});

      const result = discoverAgents({
        installedPluginsJsonPath: installedPluginsPath,
        userSettingsPath,
        projectSettingsPath,
        userAgentsDir,
        projectAgentsDir: join(tmpDir, "project-agents"),
      });

      expect(result).toHaveLength(1);
      expect(result[0]?.invocable).toBe("my-tool");
      expect(result[0]?.source).toBe("user-agents");
    });

    it("bare name agent always included regardless of enabledPlugins", () => {
      const projectAgentsDir = join(tmpDir, "project-agents");
      mkdirSync(projectAgentsDir, { recursive: true });
      writeAgentFile(projectAgentsDir, "standalone.md", "standalone", "Always available");

      const installedPluginsPath = makeInstalledPlugins(tmpDir, {});
      // Empty enabledPlugins — nothing enabled
      const userSettingsPath = makeSettings(tmpDir, "user-settings.json", {
        enabledPlugins: {},
      });
      const projectSettingsPath = makeSettings(tmpDir, "project-settings.json", {});

      const result = discoverAgents({
        installedPluginsJsonPath: installedPluginsPath,
        userSettingsPath,
        projectSettingsPath,
        userAgentsDir: join(tmpDir, "user-agents"),
        projectAgentsDir,
      });

      expect(result).toHaveLength(1);
      expect(result[0]?.invocable).toBe("standalone");
    });
  });

  // -------------------------------------------------------------------------
  describe("malformed frontmatter — graceful handling", () => {
    it("skips malformed frontmatter file and returns others", () => {
      const pluginDir = makePluginDir(tmpDir, "myplugin");
      const agentsDir = join(pluginDir, "agents");

      // Valid agent
      writeAgentFile(agentsDir, "valid-agent.md", "valid-agent", "A valid agent");

      // Malformed: nested mapping triggers FrontmatterParseError
      const malformedContent = `---\nnested:\n  key: value\n---\nbody\n`;
      writeAgentFileRaw(agentsDir, "broken-agent.md", malformedContent);

      const installedPluginsPath = makeInstalledPlugins(tmpDir, { "myplugin@test-marketplace": pluginDir });
      const userSettingsPath = makeSettings(tmpDir, "user-settings.json", {
        enabledPlugins: { "myplugin@test-marketplace": true },
      });
      const projectSettingsPath = makeSettings(tmpDir, "project-settings.json", {});

      let result: ReturnType<typeof discoverAgents> | undefined;
      expect(() => {
        result = discoverAgents({
          installedPluginsJsonPath: installedPluginsPath,
          userSettingsPath,
          projectSettingsPath,
          userAgentsDir: join(tmpDir, "user-agents"),
          projectAgentsDir: join(tmpDir, "project-agents"),
        });
      }).not.toThrow();

      expect(result?.filter((a) => a.source === "plugin")).toHaveLength(1);
      expect(result?.[0]?.invocable).toBe("myplugin:valid-agent");
    });

    it("skips file with missing name field", () => {
      const pluginDir = makePluginDir(tmpDir, "myplugin");
      const agentsDir = join(pluginDir, "agents");

      // Only description, no name
      const content = `---\ndescription: An agent without a name\n---\n\n# No Name\n`;
      writeAgentFileRaw(agentsDir, "no-name.md", content);

      const installedPluginsPath = makeInstalledPlugins(tmpDir, { "myplugin@test-marketplace": pluginDir });
      const userSettingsPath = makeSettings(tmpDir, "user-settings.json", {
        enabledPlugins: { "myplugin@test-marketplace": true },
      });
      const projectSettingsPath = makeSettings(tmpDir, "project-settings.json", {});

      const result = discoverAgents({
        installedPluginsJsonPath: installedPluginsPath,
        userSettingsPath,
        projectSettingsPath,
        userAgentsDir: join(tmpDir, "user-agents"),
        projectAgentsDir: join(tmpDir, "project-agents"),
      });

      expect(result.filter((a) => a.source === "plugin")).toHaveLength(0);
    });

    it("skips file with missing description field", () => {
      const pluginDir = makePluginDir(tmpDir, "myplugin");
      const agentsDir = join(pluginDir, "agents");

      // Only name, no description
      const content = `---\nname: nameless-desc\n---\n\n# No Description\n`;
      writeAgentFileRaw(agentsDir, "no-desc.md", content);

      const installedPluginsPath = makeInstalledPlugins(tmpDir, { "myplugin@test-marketplace": pluginDir });
      const userSettingsPath = makeSettings(tmpDir, "user-settings.json", {
        enabledPlugins: { "myplugin@test-marketplace": true },
      });
      const projectSettingsPath = makeSettings(tmpDir, "project-settings.json", {});

      const result = discoverAgents({
        installedPluginsJsonPath: installedPluginsPath,
        userSettingsPath,
        projectSettingsPath,
        userAgentsDir: join(tmpDir, "user-agents"),
        projectAgentsDir: join(tmpDir, "project-agents"),
      });

      expect(result.filter((a) => a.source === "plugin")).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("regex fallback — recovers agents whose inline-array tools trip the strict parser", () => {
    it("discovers agent when frontmatter has inline-array tools field (strict parser throws, regex recovers)", () => {
      // Realistic fixture mirroring the real expert agents (typescript-expert,
      // wp-expert, design-expert) that use inline-array tools syntax.
      const agentContent = [
        "---",
        "name: ts-expert",
        "description: Use PROACTIVELY for ALL TypeScript development. MUST BE USED when editing .ts files.",
        'tools: ["Read", "Write", "Edit", "Grep", "Glob", "Bash(git *)", "mcp__ide__getDiagnostics"]',
        "model: sonnet",
        "---",
        "body text",
      ].join("\n");

      // Guard: confirm the strict parser alone rejects this input.
      // This proves the fallback is what recovers the agent, not the strict path.
      expect(() => parseFrontmatter(agentContent)).toThrow(FrontmatterParseError);

      // Core: set up a plugin with this fixture agent and enable the plugin.
      const pluginDir = makePluginDir(tmpDir, "myplugin");
      const agentsDir = join(pluginDir, "agents");
      writeAgentFileRaw(agentsDir, "ts-expert.md", agentContent);

      const installedPluginsPath = makeInstalledPlugins(tmpDir, { "myplugin@test-marketplace": pluginDir });
      const userSettingsPath = makeSettings(tmpDir, "user-settings.json", {
        enabledPlugins: { "myplugin@test-marketplace": true },
      });
      const projectSettingsPath = makeSettings(tmpDir, "project-settings.json", {});

      const result = discoverAgents({
        installedPluginsJsonPath: installedPluginsPath,
        userSettingsPath,
        projectSettingsPath,
        userAgentsDir: join(tmpDir, "user-agents"),
        projectAgentsDir: join(tmpDir, "project-agents"),
      });

      const pluginAgents = result.filter((a) => a.source === "plugin");
      expect(pluginAgents).toHaveLength(1);
      expect(pluginAgents[0]?.invocable).toBe("myplugin:ts-expert");
      expect(pluginAgents[0]?.description).toBe(
        "Use PROACTIVELY for ALL TypeScript development. MUST BE USED when editing .ts files.",
      );
    });
  });

  // -------------------------------------------------------------------------
  describe("project-root resolution — cwd-independence", () => {
    it("returns the same agents regardless of cwd when project root is passed explicitly", () => {
      // This test asserts the core invariant: discovery results are identical
      // when projectSettingsPath and projectAgentsDir are anchored to the project
      // root rather than to an arbitrary cwd.
      //
      // We simulate two invocations:
      //   1. Invocation A: opts derived from the project root (correct)
      //   2. Invocation B: opts derived from a subdirectory (incorrect — the bug)
      //
      // When the caller always passes the project-root-derived opts (as runAgents
      // now does via resolveAgentOptsFromTrackerRoot), both results match.

      const projectRoot = join(tmpDir, "project");
      const subdir = join(projectRoot, "packages", "cli");
      const projectSettingsDir = join(projectRoot, ".claude");
      mkdirSync(subdir, { recursive: true });
      mkdirSync(projectSettingsDir, { recursive: true });

      // Put a plugin agent under project root .claude/agents/
      const projectAgentsDir = join(projectSettingsDir, "agents");
      mkdirSync(projectAgentsDir, { recursive: true });
      writeAgentFile(projectAgentsDir, "project-agent.md", "project-agent", "A project-scoped agent");

      const installedPluginsPath = makeInstalledPlugins(tmpDir, {});
      const userSettingsPath = makeSettings(tmpDir, "user-settings.json", {});
      const projectSettingsPath = makeSettings(projectSettingsDir, "settings.json", {});

      // Invocation anchored to the project root — should find project-agent
      const resultFromProjectRoot = discoverAgents({
        installedPluginsJsonPath: installedPluginsPath,
        userSettingsPath,
        projectSettingsPath,
        userAgentsDir: join(tmpDir, "user-agents"),
        projectAgentsDir,
      });

      // Invocation anchored to a subdirectory — would miss project-agent in the
      // buggy implementation, but a caller that always passes project-root opts
      // (like the fixed runAgents) will produce the same result.
      const subdirSettingsPath = join(subdir, ".claude", "settings.json");
      const subdirAgentsDir = join(subdir, ".claude", "agents");
      // subdirSettingsPath and subdirAgentsDir do not exist — simulates the
      // subdir having no .claude/ of its own.
      const resultFromSubdir = discoverAgents({
        installedPluginsJsonPath: installedPluginsPath,
        userSettingsPath,
        projectSettingsPath: subdirSettingsPath,  // does not exist
        userAgentsDir: join(tmpDir, "user-agents"),
        projectAgentsDir: subdirAgentsDir,        // does not exist
      });

      // project-root result finds the agent; subdir result (wrong path) does not
      expect(resultFromProjectRoot.find((a) => a.invocable === "project-agent")).toBeDefined();
      expect(resultFromSubdir.find((a) => a.invocable === "project-agent")).toBeUndefined();

      // This demonstrates why resolveAgentOptsFromTrackerRoot must anchor to the
      // project root — cwd-based discovery silently misses project agents.
    });
  });
});
