# skills/

Static text of the Claude Code skills and the agent that darius installs.

- `<name>.md` is the procedure skill `darius-<name>` (11 files: work, work-plan, work-verify, commit, sync, archive, wrap-up, enrich, dream, worklog, structural-review).
- `agent-darius.md` is the darius agent.

`darius skill install` copies each file to `~/.claude/skills/darius-<name>/SKILL.md` (the agent to `~/.claude/agents/darius.md`) and adds a stamp as the last line. `darius setup` refreshes every stamped file, so `darius update` keeps every host current. The `darius` skill itself is generated from the command registry, not kept here.

Edit the text here and ship it with a release. Never patch the installed copies by hand: `darius skill status` reports them as `edited`.

Keep the prose rules: short sentences, no em dashes.
