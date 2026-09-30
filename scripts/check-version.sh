#!/usr/bin/env bash
# Version consistency gate for darius.
#
# The version lives in three places that MUST agree:
#   - package.json        (canonical)
#   - src/version.ts      (what `darius --version` prints; no JSON import at runtime)
#   - CHANGELOG.md        (newest numbered "## [x.y.z]" heading)
#
# Exits non-zero with a clear message on any mismatch. See CLAUDE.md, "Versioning".
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

pkg_v="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ROOT/package.json" | head -1)"
src_v="$(sed -n 's/^export const VERSION = "\([^"]*\)".*/\1/p' "$ROOT/src/version.ts" | head -1)"
log_v="$(sed -n 's/^##[[:space:]]*\[\([0-9][^]]*\)\].*/\1/p' "$ROOT/CHANGELOG.md" 2>/dev/null | head -1)"

note() { printf '  %-16s %s\n' "$1" "$2"; }

if [ -z "$pkg_v" ]; then
  echo "✗ could not read version from package.json" >&2
  exit 1
fi

if [ "$src_v" != "$pkg_v" ] || [ "$log_v" != "$pkg_v" ]; then
  echo "✗ version mismatch: all three must equal the canonical package.json version:" >&2
  note "package.json" "$pkg_v  (canonical)"
  note "src/version.ts" "${src_v:-<missing>}"
  note "CHANGELOG.md" "${log_v:-<missing>}"
  echo "  → bump all three to the same version and add a matching CHANGELOG entry." >&2
  exit 1
fi

echo "✓ version $pkg_v consistent across package.json, src/version.ts, CHANGELOG"
