---
name: darius-structural-review
model: sonnet
description: Dead code, unused exports, incomplete refactors, deep structural analysis
user-invocable: false
allowed-tools: Read, Glob, Grep, Bash
---

# Structural Review

**Before anything else**, run this line with Bash. If it prints a message, show the message to the user and stop.

```bash
command -v darius >/dev/null || { echo "darius is not installed. Install it: bash <(curl -fsSL https://raw.githubusercontent.com/AltanS/darius/main/scripts/install.sh)"; exit 1; }
```

Deep structural analysis for dead code, unused exports, and incomplete refactors. Called by `/work` (spec/milestone completion) and `/archive` (gate check).

A line that starts with `!darius ...` is a shell command. Run it with Bash and use its output.

$ARGUMENTS

If no explicit file list is provided, enumerate artifact paths from the current focus milestone:

`!darius list specs --json`

Extract `path` fields (tracker-relative); for each spec use `darius show <path> --json` to get the artifact list. Do not read `currentFocus` from `status`; `darius next --json` names the active milestone.

## Per-file analysis

1. **Unused imports**: imported symbols not referenced in the file
2. **Unused exports**: exported symbols not imported by any other file (grep across codebase)
3. **Unused functions/variables**: declared but never called/read
4. **Deprecated aliases**: imports from `@deprecated` targets, empty wrapper classes, backwards-compat shims

## Cross-file analysis

5. **Incomplete refactors**: old file replaced but not deleted, interface changed but consumers not updated, route removed but handler still exists, config key renamed but old key still referenced
6. **Orphaned files**: files created but not imported/referenced anywhere
7. **Dependency drift**: types/interfaces changed in one file but consumers still use old shape

## Output format

```yaml
passed: true|false
summary: "{N} files reviewed, {findings count} findings"
findings:
  - severity: critical|warning|suggestion
    category: unused-import|unused-export|dead-code|incomplete-refactor|deprecated-alias|orphaned-file
    file: path/to/file.ts
    line: 42
    message: "Description of the issue"
```

| Severity | Meaning | Action |
|----------|---------|--------|
| **Critical** | Build failures, runtime errors, orphaned files | Blocks promotion |
| **Warning** | Dead code, incomplete cleanup, deprecated aliases | Logged, does not block |
| **Suggestion** | Naming, structure, alternative patterns | Logged if significant |

Skip binary files, lock files, and `node_modules`. Do NOT write to the worklog, the calling skill handles that. Return findings only, the calling skill decides what to do with them.
