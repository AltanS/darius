# skills/

Static text of the Claude Code skills and the agent that darius installs.

- `<name>.md` is the procedure skill `darius-<name>` (11 files: work, work-plan, work-verify, commit, sync, archive, wrap-up, enrich, dream, worklog, structural-review).
- `agent-darius.md` is the darius agent.

`darius skill install` copies each file to `~/.claude/skills/darius-<name>/SKILL.md` (the agent to `~/.claude/agents/darius.md`) and adds a stamp as the last line. `darius setup` refreshes every stamped file, so `darius update` keeps every host current. The `darius` skill itself is generated from the command registry, not kept here.

Edit the text here and ship it with a release. Never patch the installed copies by hand: `darius skill status` reports them as `edited`.

## Where the tracker lives

`kinds` in the project's `.darius.toml` says what the darius store owns. With `milestone` in it, the whole tracker tree lives in the store and `.tracker` in the checkout is a link to it. Every path such as `.tracker/M12-cart/01-api.md` stays valid, nothing under it is in git, and it is never staged. darius records file edits at the next darius verb or sync, so a skill that edits tracker files ends with a darius verb, for example `darius index --rebuild`. A repo with a real `.tracker/` folder in git works as before until `darius onboard` moves it.

Keep the prose rules: short sentences, no em dashes.
