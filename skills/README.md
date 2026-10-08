# skills/

Static text of the Claude Code procedure skills that darius installs.

- `<name>.md` is the procedure skill `darius-<name>` (11 files: work, work-plan, work-verify, commit, sync, archive, wrap-up, enrich, dream, worklog, structural-review).

`darius skill install` copies each file to `~/.claude/skills/darius-<name>/SKILL.md` and adds a stamp as the last line. `darius setup` refreshes every stamped file, so `darius update` keeps every host current. The `darius` skill itself is generated from the command registry, not kept here. There is no darius agent since 0.71.0; install and setup remove a stamped `~/.claude/agents/darius.md`.

Edit the text here and ship it with a release. Never patch the installed copies by hand: `darius skill status` reports them as `edited`.

## Where the tracker lives

`kinds` in the project's `.darius.toml` says what the darius store owns. With `milestone` in it, the whole tracker tree lives in the store, and the checkout has no `.tracker` path (0.78.0). `darius root --json` prints `{mode, trackerRoot, project, linked}`. `mode` is `store`, `git` or `none`.

In these skills a path is tracker-relative (`M12-cart/01-api.md`, `worklog/<slug>.md`, `archive/<slug>.md`). darius verbs take it as it is. A skill that reads a file of the tree with a file tool takes the path from `trackerRoot`, or from `absPath` in `list specs --json`, `show --json` and `next --json`. Nothing of the tree is in git, and it is never staged. darius records file edits at the next darius verb or sync, so a skill that edits tracker files ends with a darius verb, for example `darius index --rebuild`.

Git mode (a real `.tracker/` folder in git) still works but is deprecated. `darius onboard` moves it into the store. A skill mentions it in one short line, only where its behaviour differs.

Keep the prose rules: short sentences, no em dashes.
