/**
 * Shared domain types used across the tracker CLI and lib modules.
 */

/**
 * A discovered, dispatchable Claude Code agent.
 *
 * `invocable` is the string a user or tool passes to dispatch the agent:
 *   - Plugin agents:       "pluginName:agentName"  (e.g. "tracker:darius")
 *   - Project/user agents: bare name from frontmatter (e.g. "my-reviewer")
 *
 * `source` identifies where the descriptor was discovered:
 *   - "plugin"         — from an installed + enabled plugin's agents/ directory
 *   - "project-agents" — from <cwd>/.claude/agents/
 *   - "user-agents"    — from ~/.claude/agents/
 */
export type AgentDescriptor = {
  /** Dispatchable identifier (e.g. "tracker:darius", "my-reviewer"). */
  invocable: string;
  /** Human-readable summary from the agent's frontmatter description field. */
  description: string;
  /** Where the agent was discovered. */
  source: "plugin" | "project-agents" | "user-agents";
};
