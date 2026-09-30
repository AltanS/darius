#!/usr/bin/env bash
# scripts/install.sh: install darius on this host as a versioned app, the one
# install method on every host (NixOS included). The layout is the one
# src/core/app.ts documents:
#
#   <app>/versions/vX.Y.Z/   a shallow clone of tag vX.Y.Z
#   <app>/current            -> versions/vX.Y.Z
#
# <app> is ~/.local/opt/darius, or $DARIUS_APP_DIR. After the flip this runs
# `<app>/current/bin/darius setup --systemd`: it links ~/.local/bin/darius to
# <app>/current/bin/darius and installs the units that config.toml's
# [setup] units lists. From then on `darius update` moves the host, and
# `darius update --hosts` on another host pushes to it.
#
# Usage:
#   scripts/install.sh [--tag vX.Y.Z] [--source URL]
#   ssh host bash -s -- --tag v0.17.0 < scripts/install.sh
#
# --tag defaults to the newest vX.Y.Z tag of the source. --source, else
# $DARIUS_SOURCE, else https://github.com/AltanS/darius.git. A tag fetched over
# git is the whole release: darius has no build step and commits web/build/.
#
# An old full clone at <app> itself (a host set up before 0.17.0) is moved aside to
# <app>.legacy-<UTC time>. Nothing is deleted.
#
# Idempotent: a second run with the same tag changes nothing.
# Exit codes: 0 ok, 1 failed, 2 usage, 3 the source could not be reached.
#
# The whole script is one function, called on the last line: piped into
# `bash -s`, bash has read all of it before anything runs. Every command that
# may read stdin gets </dev/null for the same reason: none may eat the script.
set -euo pipefail

usage() {
  echo "install.sh: $1" >&2
  echo "usage: install.sh [--tag vX.Y.Z] [--source URL]" >&2
  exit 2
}

fail() {
  echo "! $1" >&2
  exit 1
}

# The "version" in <dir>/package.json.
package_version() {
  sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*$/\1/p' "$1/package.json" 2>/dev/null </dev/null | head -n 1
}

# The release tags of a `git ls-remote --tags --refs` listing on stdin, newest last.
release_tags() {
  sed -n 's#^.*refs/tags/v\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)$#\1#p' | sort -t. -k1,1n -k2,2n -k3,3n | sed 's/^/v/'
}

main() {
  local app="${DARIUS_APP_DIR:-$HOME/.local/opt/darius}"
  local source="${DARIUS_SOURCE:-https://github.com/AltanS/darius.git}"
  local tag=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --tag) [ $# -ge 2 ] || usage "--tag needs a value"; tag="$2"; shift 2 ;;
      --tag=*) tag="${1#--tag=}"; shift ;;
      --source) [ $# -ge 2 ] || usage "--source needs a value"; source="$2"; shift 2 ;;
      --source=*) source="${1#--source=}"; shift ;;
      -h|--help) echo "usage: install.sh [--tag vX.Y.Z] [--source URL]"; exit 0 ;;
      *) usage "unknown option '$1'" ;;
    esac
  done
  if [ -n "$tag" ] && ! [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    usage "--tag must look like v0.17.0, got '$tag'"
  fi
  command -v git >/dev/null 2>&1 || fail "git is not on PATH"

  local listed
  if [ -z "$tag" ] || [ ! -d "$app/versions/$tag" ]; then
    if ! listed="$(git ls-remote --tags --refs "$source" </dev/null)"; then
      echo "! cannot reach $source" >&2
      exit 3
    fi
    if [ -z "$tag" ]; then
      tag="$(printf '%s\n' "$listed" | release_tags | tail -n 1)"
      [ -n "$tag" ] || fail "$source has no vX.Y.Z tag"
    elif ! printf '%s\n' "$listed" | release_tags | grep -qx "$tag"; then
      fail "$source has no tag $tag"
    fi
  fi
  local version="${tag#v}"
  local changed=0

  if [ -e "$app/.git" ]; then
    local legacy
    legacy="$app.legacy-$(date -u +%Y%m%dT%H%M%SZ)"
    mv "$app" "$legacy"
    echo "✓ moved the old clone at $app to $legacy (nothing deleted)"
    changed=1
  fi

  mkdir -p "$app/versions"
  local dir="$app/versions/$tag"
  if [ -d "$dir" ]; then
    echo "· $tag is already in $app/versions"
  else
    local tmp="$dir.tmp"
    rm -rf "$tmp"
    # git warns that an annotated tag "is not a commit" even with -q; its
    # output is shown only when the clone fails.
    local cloned
    if ! cloned="$(git -c advice.detachedHead=false clone -q --depth 1 --branch "$tag" "$source" "$tmp" </dev/null 2>&1)"; then
      rm -rf "$tmp"
      [ -z "$cloned" ] || echo "$cloned" >&2
      fail "could not clone $tag from $source"
    fi
    local found
    found="$(package_version "$tmp")"
    if [ "$found" != "$version" ]; then
      rm -rf "$tmp"
      fail "tag $tag carries package.json version ${found:-(none)}, not $version. Refused."
    fi
    mv "$tmp" "$dir"
    echo "✓ cloned $tag into $dir"
  fi

  local said
  said="$("$dir/bin/darius" --version </dev/null 2>&1 || true)"
  case "$said" in
    "darius $version" | "darius $version "*) ;;
    *) fail "$dir/bin/darius --version printed '$said', not darius $version. Nothing was switched." ;;
  esac

  if [ "$(readlink "$app/current" 2>/dev/null || true)" = "versions/$tag" ]; then
    echo "· current already points at versions/$tag"
  else
    ln -sfn "versions/$tag" "$app/current.new"
    # One rename, so nothing ever sees `current` missing. -T is GNU mv, -h BSD mv.
    mv -Tf "$app/current.new" "$app/current" 2>/dev/null || mv -hf "$app/current.new" "$app/current"
    echo "✓ current -> versions/$tag"
    changed=1
  fi

  "$app/current/bin/darius" setup --systemd </dev/null || fail "darius setup --systemd did not finish; see the lines above"

  # A web page started from the old clone or the old version keeps its code
  # until it restarts. try-restart leaves a stopped unit stopped.
  if [ "$changed" = 1 ] && command -v systemctl >/dev/null 2>&1; then
    systemctl --user try-restart darius-web.service </dev/null >/dev/null 2>&1 || true
  fi
  echo "✓ darius $version runs from $app/current"
}

main "$@"
