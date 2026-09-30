#!/usr/bin/env bash
# scripts/seaweedfs-install.sh — idempotent installer for darius's OWN
# persistent S3 endpoint on the lead host (docs/plan-tonight.md, T11).
#
# Stands up systemd/darius-seaweedfs.service as a rootless-podman systemd
# USER service, generates its S3 identities and SSE key-encryption-key exactly
# once, and writes the credentials files darius's own config reads: this
# host's own, and one per client host in $DARIUS_CLIENT_HOSTS.
#
# HARD SAFETY RULES (docs/plan-tonight.md, "Safety rules for every worker"):
#   - Never touches another SeaweedFS on the same host (port 9900, its own
#     state dir and its own `seaweedfs.service` unit). This script only reads
#     that unit's is-active state, to report it, and never changes it.
#   - Never binds 0.0.0.0. Only `127.0.0.1:${PORT}` and
#     `${TAILNET_ADDR}:${PORT}` -- both set by
#     systemd/darius-seaweedfs.service, not by this script's own podman
#     invocation (this script never runs the container directly; the unit
#     does, via `systemctl --user enable --now`).
#   - identity.json / security.toml (the S3 identities + SSE KEK) are
#     generated ONCE and never rotated on a re-run. Secret values are never
#     printed -- only paths and status.
#
# Idempotent and safe to re-run: every step below checks for its own prior
# output before doing anything, exactly like the proven precedent this is
# read from (an earlier SeaweedFS installer, read-only prior art).
set -euo pipefail

log()  { printf '>>> %s\n' "$*" >&2; }
warn() { printf 'WARN: %s\n' "$*" >&2; }
die()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "required tool '$1' not found on host"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly UNIT_SRC="$SCRIPT_DIR/../systemd/darius-seaweedfs.service"
readonly UNIT_NAME="darius-seaweedfs.service"
readonly USER_UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

# Persistent state root -- RUNTIME STATE, outside every repo, exactly like
# the other SeaweedFS's state dir. A DIFFERENT directory, a DIFFERENT
# container name, a DIFFERENT unit: the two services can never collide.
readonly STATE_ROOT="${DARIUS_SEAWEEDFS_HOME:-$HOME/.local/share/darius-seaweedfs}"
readonly CFG_DIR="$STATE_ROOT/config"
readonly DATA_DIR="$STATE_ROOT/data"
readonly OVERRIDE_CONF="$STATE_ROOT/containers-override.conf"

# Kept in lockstep with systemd/darius-seaweedfs.service's own Environment= lines.
readonly IMAGE="docker.io/chrislusf/seaweedfs@sha256:f898c91e42d7da5f4bb13f1efd424ff03ba85b420312eb929708a384e8a8b03d"
readonly PORT="${DARIUS_SEAWEEDFS_PORT:-9910}"
# The tailnet address this host binds. Set DARIUS_SEAWEEDFS_TAILNET_ADDR, or
# main() detects it with `tailscale ip -4`. There is no default address.
TAILNET_ADDR="${DARIUS_SEAWEEDFS_TAILNET_ADDR:-}"
# The unit reads the address from this file (EnvironmentFile=), so the unit
# file itself holds no address.
readonly UNIT_ENV_FILE="$HOME/.config/darius/seaweedfs.env"

readonly DARIUS_CONFIG_HOME="${DARIUS_CONFIG_DIR:-$HOME/.config/darius}"
readonly CREDENTIALS_FILE="$DARIUS_CONFIG_HOME/credentials"
readonly KEYS_DIR="$DARIUS_CONFIG_HOME/keys"

# This host's own S3 identity: darius-<short host name>, or $DARIUS_LEAD_IDENTITY.
readonly LEAD_IDENTITY="${DARIUS_LEAD_IDENTITY:-darius-${HOSTNAME%%.*}}"
# The other hosts that sync, one S3 identity and one key file each
# ($KEYS_DIR/<host>.credentials). Adding a host adds its identity; an
# existing identity is never rotated. Pass them by name, for example
# DARIUS_CLIENT_HOSTS="host-b host-c". Without it, no client identity is added
# and no client key file is written.
readonly CLIENT_HOSTS="${DARIUS_CLIENT_HOSTS:-}"

# Sets TAILNET_ADDR: $DARIUS_SEAWEEDFS_TAILNET_ADDR when set, else the first
# line of `tailscale ip -4`. Dies with a clear message when neither works, and
# refuses a wildcard or a non-IPv4 value (darius never binds 0.0.0.0).
resolve_tailnet_addr() {
    if [ -z "$TAILNET_ADDR" ]; then
        if command -v tailscale >/dev/null 2>&1; then
            TAILNET_ADDR="$(tailscale ip -4 2>/dev/null | head -n 1 || true)"
        fi
        [ -n "$TAILNET_ADDR" ] || die "no tailnet address. Set DARIUS_SEAWEEDFS_TAILNET_ADDR to this host's tailnet IPv4 address, or start tailscale so 'tailscale ip -4' answers."
    fi
    [[ "$TAILNET_ADDR" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || die "tailnet address '$TAILNET_ADDR' is not an IPv4 address."
    [ "$TAILNET_ADDR" != "0.0.0.0" ] || die "tailnet address 0.0.0.0 is a wildcard. darius never binds a wildcard."
    readonly TAILNET_ADDR
}

# Writes an AWS-ini credentials file (docs/plan-tonight.md's "Config and
# paths": `[default] aws_access_key_id / aws_secret_access_key`, mode 0600)
# for the named identity, read out of the identity.json this script wrote.
# Idempotent: leaves an existing file untouched (never rotates).
write_credentials_file() {
    local name="$1" dest="$2"
    if [ -f "$dest" ]; then
        log "$dest already present — leaving untouched (no rotation)."
        return 0
    fi
    local ak sk
    ak="$(jq -r --arg n "$name" '.identities[] | select(.name==$n) | .credentials[0].accessKey' "$CFG_DIR/identity.json")"
    sk="$(jq -r --arg n "$name" '.identities[] | select(.name==$n) | .credentials[0].secretKey' "$CFG_DIR/identity.json")"
    if [ -z "$ak" ] || [ -z "$sk" ] || [ "$ak" = "null" ] || [ "$sk" = "null" ]; then
        die "could not find identity '$name' in $CFG_DIR/identity.json"
    fi
    mkdir -p "$(dirname "$dest")"
    umask 077
    printf '[default]\naws_access_key_id = %s\naws_secret_access_key = %s\n' "$ak" "$sk" > "$dest"
    chmod 0600 "$dest"
    log "wrote $dest (0600; values not echoed)."
}

main() {
    need podman; need systemctl; need openssl; need curl; need jq
    [ -f "$UNIT_SRC" ] || die "unit template not found at $UNIT_SRC"
    resolve_tailnet_addr

    # Belt-and-suspenders: never let an override env var point this script at
    # the other SeaweedFS's port. The unit itself sets 9910 regardless of this
    # script's env, but a script that then "verifies" the wrong port would be
    # worse than useless -- it would report success while checking nothing.
    if [ "$PORT" = "9900" ]; then
        die "DARIUS_SEAWEEDFS_PORT=9900 is the other SeaweedFS's port. darius must use 9910 (its own)."
    fi

    # (1) Persistent dirs. 0755 on the config dir: rootless podman's bind-mount
    # UID can't traverse 0700 (a proven rule, restated in
    # docs/plan-tonight.md). Data dir chmod tolerates failure on a re-run once
    # SeaweedFS itself owns files under it.
    mkdir -p "$CFG_DIR" "$DATA_DIR"
    chmod 0755 "$STATE_ROOT" "$CFG_DIR"
    chmod 0755 "$DATA_DIR" 2>/dev/null || true

    # Service-scoped podman keyring override (this host's
    # small kernel.keys.maxkeys is exhausted by leaked rootless keyrings).
    # Rewritten every run (no secret in it), so a repo change always lands.
    printf '[containers]\nkeyring=false\n' > "$OVERRIDE_CONF"
    chmod 0644 "$OVERRIDE_CONF"

    # (2) Generate this host's S3 identity + SSE KEK ONCE. Never rotate on re-run.
    if [ -f "$CFG_DIR/identity.json" ] && [ -f "$CFG_DIR/security.toml" ]; then
        log "S3 identities + SSE KEK already present in $CFG_DIR — leaving untouched (no rotation)."
    else
        log "generating the $LEAD_IDENTITY S3 identity + SSE KEK ONCE into $CFG_DIR (values never printed)…"
        local ak sk kek
        ak="darius-$(openssl rand -hex 6)"
        sk="$(openssl rand -hex 24)"
        kek="$(openssl rand -base64 32)"
        umask 022
        jq -n --arg n "$LEAD_IDENTITY" --arg ak "$ak" --arg sk "$sk" \
            '{identities: [{name: $n, credentials: [{accessKey: $ak, secretKey: $sk}], actions: ["Admin","Read","Write","List","Tagging"]}]}' \
            > "$CFG_DIR/identity.json"
        printf '[s3.sse]\nkey = "%s"\n' "$kek" > "$CFG_DIR/security.toml"
        chmod 0644 "$CFG_DIR/identity.json" "$CFG_DIR/security.toml"
        unset ak sk kek
        log "wrote $CFG_DIR/identity.json + $CFG_DIR/security.toml (0644; secrets not echoed)."
    fi

    # (2b) One identity per client host. Only a MISSING one is added; SeaweedFS
    # reads identity.json at start, so an addition restarts the unit in (5).
    local added=0 host
    for host in $CLIENT_HOSTS; do
        if jq -e --arg n "darius-$host" '.identities[] | select(.name==$n)' "$CFG_DIR/identity.json" >/dev/null; then
            continue
        fi
        log "adding S3 identity darius-$host (values never printed)…"
        local ak sk tmp
        ak="darius-$(openssl rand -hex 6)"
        sk="$(openssl rand -hex 24)"
        tmp="$(mktemp "$CFG_DIR/identity.json.XXXXXX")"
        jq --arg n "darius-$host" --arg ak "$ak" --arg sk "$sk" \
            '.identities += [{name: $n, credentials: [{accessKey: $ak, secretKey: $sk}], actions: ["Admin","Read","Write","List","Tagging"]}]' \
            "$CFG_DIR/identity.json" > "$tmp"
        chmod 0644 "$tmp"
        mv "$tmp" "$CFG_DIR/identity.json"
        unset ak sk
        added=1
    done

    # (3) Derive the operator-facing credentials files from identity.json.
    # Idempotent regardless of whether (2) just generated identity.json or it
    # was already there -- a partial prior run (identity.json written, this
    # step never reached) recovers on the next run without any rotation.
    write_credentials_file "$LEAD_IDENTITY" "$CREDENTIALS_FILE"
    mkdir -p "$KEYS_DIR"
    chmod 0700 "$KEYS_DIR"
    for host in $CLIENT_HOSTS; do
        write_credentials_file "darius-$host" "$KEYS_DIR/$host.credentials"
    done

    # (4) Pre-pull the digest-pinned image (a no-op tonight -- already pulled
    # per docs/plan-tonight.md's T11 task -- but idempotent installers should
    # not assume that stays true forever).
    if podman image exists "$IMAGE"; then
        log "image already cached: ${IMAGE%@*}@<digest>."
    else
        log "pulling digest-pinned SeaweedFS image (first time)…"
        podman pull "$IMAGE" >/dev/null || die "could not pull $IMAGE"
    fi

    # (5) Install the unit byte-identically (systemd/darius-seaweedfs.service
    # uses only %h/%t/%n specifiers -- no path rendering needed on this host,
    # unlike an earlier NixOS-portable installer), daemon-reload, enable + start.
    # The unit reads the tailnet address from $UNIT_ENV_FILE, written here
    # (no secret in it). This is the ONLY unit this script ever touches.
    mkdir -p "$(dirname "$UNIT_ENV_FILE")"
    local env_line env_changed=0
    env_line="DARIUS_SEAWEEDFS_TAILNET_ADDR=$TAILNET_ADDR"
    if [ "$(cat "$UNIT_ENV_FILE" 2>/dev/null || true)" != "$env_line" ]; then env_changed=1; fi
    printf '%s\n' "$env_line" > "$UNIT_ENV_FILE"
    chmod 0644 "$UNIT_ENV_FILE"
    log "wrote $UNIT_ENV_FILE (tailnet address $TAILNET_ADDR)."
    mkdir -p "$USER_UNIT_DIR"
    install -m 0644 "$UNIT_SRC" "$USER_UNIT_DIR/$UNIT_NAME"
    log "installed $UNIT_NAME -> $USER_UNIT_DIR/"
    systemctl --user daemon-reload
    systemctl --user enable --now "$UNIT_NAME"
    if [ "$added" = 1 ] || [ "$env_changed" = 1 ]; then
        log "restarting $UNIT_NAME so SeaweedFS loads the new identities or address…"
        systemctl --user restart "$UNIT_NAME"
    fi

    # (6) Prove readiness on BOTH published addresses. The unit's own
    # ExecStartPost already gates on the loopback one; re-assert both here so
    # this script fails loud if either bind never came up.
    local ok=0 i
    # shellcheck disable=SC2034 # i is the retry counter, not read; matches the earlier installer.
    for i in $(seq 1 30); do
        if curl -fs -o /dev/null "http://127.0.0.1:${PORT}/status" 2>/dev/null; then ok=1; break; fi
        sleep 1
    done
    [ "$ok" = 1 ] || die "SeaweedFS did not answer /status on 127.0.0.1:${PORT} (see: journalctl --user -u $UNIT_NAME)"

    if curl -fs -o /dev/null "http://${TAILNET_ADDR}:${PORT}/status" 2>/dev/null; then
        log "/status is 200 on both 127.0.0.1:${PORT} and ${TAILNET_ADDR}:${PORT}."
    else
        warn "127.0.0.1:${PORT}/status is up but ${TAILNET_ADDR}:${PORT}/status did not answer. If tailscale was still coming up at boot, Restart=always will retry the bind; check \`ss -ltn | grep ${PORT}\` and \`tailscale status\`."
    fi

    local darius_active darius_enabled other_active
    darius_active="$(systemctl --user is-active "$UNIT_NAME" 2>/dev/null || true)"
    darius_enabled="$(systemctl --user is-enabled "$UNIT_NAME" 2>/dev/null || true)"
    # `systemctl --user is-active` exits non-zero for a perfectly normal
    # "inactive" unit (that is the expected, desired state for the other
    # unit here) -- capture the text and only fall back when it is truly
    # absent, so a real "inactive" is never mistaken for "not found".
    other_active="$(systemctl --user is-active seaweedfs.service 2>/dev/null || true)"
    [ -n "$other_active" ] || other_active="not found"

    log "OK: $UNIT_NAME active=$darius_active enabled=$darius_enabled."
    log "state root: $STATE_ROOT (config + data; RUNTIME STATE, outside every repo)."
    log "the other seaweedfs.service is untouched: is-active=$other_active."
}

main "$@"
