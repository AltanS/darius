#!/usr/bin/env bash
# Shared helpers for the scaffold scripts. Source this file; it needs `darius`
# on PATH (run.sh puts the wrapper there). Everything lands in the current
# directory, the run's throwaway workspace, and in its .eval-state/ store.
set -euo pipefail

# Put `darius` where the child's Bash finds it. The child shell rebuilds PATH
# from its profile (on NixOS it drops what the parent passed), but the profile
# dirs under the run's own HOME stay on it. So link the wrapper there, and
# keep the PATH from run.sh as the fallback for hosts that pass PATH through.
seed_darius_on_path() {
  local wrapper dir real_home
  # Never write into a real home. `claude plugin eval` gives the scaffold a
  # throwaway HOME; a hand run must do the same (HOME=$(mktemp -d)).
  real_home="$(getent passwd "$(id -u)" | cut -d: -f6)"
  if [ "$HOME" = "$real_home" ]; then
    echo "seed.sh: HOME is the real home ($HOME). Run the scaffold with HOME=\$(mktemp -d)." >&2
    return 1
  fi
  wrapper="$(command -v darius)"
  dir="$HOME/.local/state/nix/profile/bin"
  mkdir -p "$dir"
  ln -sf "$wrapper" "$dir/darius"
}

# A scratch git repo in store mode: .darius.toml with kinds = ["ritual",
# "vigil", "milestone"], and .tracker as a git-ignored link into the store.
seed_repo() {
  seed_darius_on_path
  git init -q -b main
  git config user.email "eval@example.invalid"
  git config user.name "Eval"
  git config commit.gpgsign false
  mkdir -p .eval-state
  printf '/.eval-state/\n' >> .git/info/exclude
  printf '# Demo app\n' > README.md
  mkdir -p src
  git add -A
  git commit -q -m "chore: initial commit"
  darius init --project eval-demo --no-import >/dev/null
  git add .darius.toml .gitignore
  git commit -q -m "chore: darius init"
}

# seed_milestone <slug> <name>
seed_milestone() {
  darius add milestone --name "$2" --slug "$1" --owner eval >/dev/null
}

# seed_spec <milestone-slug> <name> <check-file> : one spec with one real task.
# The task passes when <check-file> exists. Prints the spec path (repo-relative).
seed_spec() {
  local out path
  out="$(darius add spec --milestone "$1" --name "$2" --template generic)"
  path="$(printf '%s\n' "$out" | sed -n 's/^tracker add spec: created \(.*\.md\)$/\1/p' | head -n1)"
  path="${path#"$PWD"/}"
  cat > "$path" <<SPEC
---
updated: 2026-10-08
depends_on: []
agent: unassigned
template: generic
---

# $2

## Goal

Create the file \`$3\` with one line of text.

## Ground Truth

The repo is a demo. It has \`README.md\` and an empty \`src/\` folder. Nothing else exists.

## Overview

A tiny change that lets the Work Loop run end to end.

## Requirements

- \`$3\` exists and holds one line.

## Verification Checklist

### Implementation

- [ ] Create \`$3\`
  - Command: \`test -f $3\`
  - Expected: \`exit 0\`
SPEC
  darius index --rebuild >/dev/null
  printf '%s\n' "$path"
}

# seed_thread <milestone-slug> <spec-path> <code-file> <stage>
# Opens a worklog thread on the spec and walks it to <stage> (dispatched,
# verified or committed) with real evidence, through darius verbs only:
# dispatch, the implementation file, an Artifacts entry, a passing verify-item,
# and for committed a real git commit. Prints the thread id.
seed_thread() {
  local ms="$1" spec="$2" file="$3" stage="$4" id sha
  id="$(darius worklog open "$ms" --spec "$spec" --message "Create $file" --stage planned | head -n1)"
  darius worklog dispatch "$id" --agent general-purpose --reason "eval seed" >/dev/null
  [ "$stage" = "dispatched" ] && { printf '%s\n' "$id"; return 0; }
  mkdir -p "$(dirname "$file")"
  printf 'hello from the eval seed\n' > "$file"
  darius worklog append "$id" --section Artifacts --message "$file" >/dev/null
  darius verify-item "$spec" 0 >/dev/null
  darius worklog set-stage "$id" verified >/dev/null
  if [ "$stage" = "committed" ]; then
    git add "$file"
    git commit -q -m "feat: add $file"
    sha="$(git rev-parse HEAD)"
    darius worklog set-stage "$id" committed --commit "$sha" >/dev/null
  fi
  printf '%s\n' "$id"
}
