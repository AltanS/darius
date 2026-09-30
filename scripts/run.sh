#!/usr/bin/env bash
# Entrypoint shim for every darius command.
#
# darius has no build step: this picks a JavaScript runtime and hands it the
# TypeScript source directly. Bun is preferred when present; otherwise Node,
# which executes TypeScript by stripping types (bare from 23.6, behind
# --experimental-strip-types from 22.6). darius is started by systemd timers and
# by Claude Code hooks, both of which run with a minimal environment, so neither
# runtime may be assumed to be on PATH. Both are looked for in the usual install
# locations too, then in the NixOS profile dirs, since NixOS keeps no runtime in
# /usr/bin.
#
# $DARIUS_BUN / $DARIUS_NODE override the search; $DARIUS_RUNTIME=node|bun forces
# one of the two.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

first_existing() {
  for candidate in "$@"; do
    [ -n "$candidate" ] && [ -x "$candidate" ] && { printf '%s' "$candidate"; return 0; }
  done
  return 1
}

# The NixOS per-user, user, and system profile dirs, in that order. USER may be
# unset under a bare systemd unit, hence the id fallback.
first_in_nix_profiles() {
  local user="${USER:-$(id -un 2>/dev/null || true)}"
  first_existing "/etc/profiles/per-user/$user/bin/$1" "$HOME/.nix-profile/bin/$1" \
    "$HOME/.local/state/nix/profile/bin/$1" "/nix/var/nix/profiles/default/bin/$1" \
    "/run/current-system/sw/bin/$1"
}

find_bun() {
  [ -n "${DARIUS_BUN:-}" ] && { printf '%s' "$DARIUS_BUN"; return 0; }
  command -v bun 2>/dev/null && return 0
  first_existing "$HOME/.bun/bin/bun" /usr/local/bin/bun /opt/homebrew/bin/bun || first_in_nix_profiles bun
}

find_node() {
  [ -n "${DARIUS_NODE:-}" ] && { printf '%s' "$DARIUS_NODE"; return 0; }
  command -v node 2>/dev/null && return 0
  first_existing /usr/local/bin/node /opt/homebrew/bin/node /usr/bin/node || first_in_nix_profiles node
}

# Node gained bare `node file.ts` in 23.6; 22.6 to 23.5 need the flag. --no-warnings
# keeps the experimental notice off stderr, where it would pollute --json callers.
node_ts_flags() {
  local version major minor
  version="$("$1" --version 2>/dev/null | sed 's/^v//')"
  major="${version%%.*}"
  minor="${version#*.}"; minor="${minor%%.*}"
  if [ "${major:-0}" -ge 24 ] || { [ "${major:-0}" -eq 23 ] && [ "${minor:-0}" -ge 6 ]; }; then
    printf '%s' "--no-warnings"
  elif [ "${major:-0}" -ge 23 ] || { [ "${major:-0}" -eq 22 ] && [ "${minor:-0}" -ge 6 ]; }; then
    printf '%s' "--no-warnings --experimental-strip-types"
  else
    return 1
  fi
}

entry="${1:?usage: run.sh <cli> [args...]}"
shift

case "$entry" in
  cli) ;;
  *) echo "darius: unknown entrypoint '$entry'" >&2; exit 2 ;;
esac

target="$ROOT/src/$entry.ts"
want="${DARIUS_RUNTIME:-any}"

if [ "$want" != "node" ] && BUN="$(find_bun)"; then
  exec "$BUN" "$target" "$@"
fi

if [ "$want" != "bun" ] && NODE="$(find_node)"; then
  if FLAGS="$(node_ts_flags "$NODE")"; then
    # shellcheck disable=SC2086 # FLAGS is a deliberate word list.
    exec "$NODE" $FLAGS "$target" "$@"
  fi
  echo "darius: $NODE is $("$NODE" --version), which cannot run TypeScript. Need Node 22.6+ or Bun." >&2
  exit 127
fi

echo "darius: no JavaScript runtime found. Install Node 22.6+ (https://nodejs.org) or Bun" >&2
echo "        (https://bun.sh), or point DARIUS_NODE / DARIUS_BUN at one." >&2
exit 127
