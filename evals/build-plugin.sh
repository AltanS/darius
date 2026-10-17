#!/usr/bin/env bash
# Build the throwaway plugin that `claude plugin eval` loads.
#
#   usage: build-plugin.sh [<out-dir>]   (default: /tmp/darius-evals-plugin)
#
# It must live outside $HOME: the Bash sandbox in the eval child cannot read the
# home directory, so a wrapper or a source tree under it would be invisible.
#
#   .claude-plugin/plugin.json   a manifest, so the directory resolves as a plugin
#   skills/<name>/SKILL.md       written by `darius skill install` (the repo's own text)
#   darius/                      a copy of the CLI source, so the sandboxed child can read it
#   bin/darius                   the wrapper on PATH (lib/darius-wrapper.sh)
#   cases/                       a copy of evals/cases, the plugin's eval dir
#   lib/                         a copy of evals/lib, sourced by the scaffold scripts
#   agents/demo-builder.md       a small plugin agent, for the delegation cases
#
# DARIUS_EVAL_SRC_REPO picks the darius checkout to test (default: this repo).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO="${DARIUS_EVAL_SRC_REPO:-$(cd "$HERE/.." && pwd -P)}"
OUT="${1:-${TMPDIR:-/tmp}/darius-evals-plugin}"

rm -rf "$OUT"
mkdir -p "$OUT/.claude-plugin" "$OUT/bin" "$OUT/darius"

version="$(sed -n 's/.*VERSION = "\(.*\)".*/\1/p' "$REPO/src/version.ts")"
printf '{\n  "name": "darius",\n  "version": "%s",\n  "description": "darius skills under eval (generated, do not commit)"\n}\n' \
  "$version" > "$OUT/.claude-plugin/plugin.json"

# The CLI source. Tests, the web app and docs are not needed to run a verb.
cp -R "$REPO/bin" "$REPO/scripts" "$REPO/src" "$REPO/skills" "$REPO/package.json" "$OUT/darius/"
find "$OUT/darius/src" -name '*.test.ts' -delete
find "$OUT/darius/src" -type d -name test -prune -exec rm -rf {} +

# The skills, exactly as `darius skill install` writes them.
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
CLAUDE_CONFIG_DIR="$stage/claude" DARIUS_STATE_DIR="$stage/state" DARIUS_CONFIG_DIR="$stage/config" \
  DARIUS_RUNTIME=node bash "$OUT/darius/scripts/run.sh" cli skill install >/dev/null
cp -R "$stage/claude/skills" "$OUT/skills"

install -m 0755 "$HERE/lib/darius-wrapper.sh" "$OUT/bin/darius"

# A private copy of git. The eval sandbox denies /usr/bin/git on hosts where the git-credential-*
# helpers are links to it (Fedora Atomic), and masks it with /dev/null. The copy lives in the
# plugin dir, which the child may read and run. See evals/README.md.
real_git="$(readlink -f "$(command -v git)")"
[ -f "$real_git" ] || { echo "build-plugin.sh: no git binary on PATH" >&2; exit 1; }
install -m 0755 "$real_git" "$OUT/bin/git"
cp -R "$HERE/cases" "$OUT/cases"
cp -R "$HERE/lib" "$OUT/lib"

# A plugin agent for the delegation cases. Claude Code names it darius:demo-builder. The roster
# (`darius agents --json`) reads installed plugins, which this one is not: see seed_plugin_roster.
cp -R "$HERE/agents" "$OUT/agents"

echo "built $OUT (darius $version, $(find "$OUT/skills" -name SKILL.md | wc -l) skills)"
