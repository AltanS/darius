#!/usr/bin/env bash
# The two web lanes on a dev machine (see the Makefile, `make help`).
#
#   stable  the installed app (~/.local/opt/darius/current), systemd unit
#           darius-web.service, port 4747. `darius update` moves it.
#   next    this checkout, as a transient systemd unit darius-next: the web
#           dev server with hot reload (default), the demo data (--demo), or
#           `bin/darius serve` over the committed build (--serve). Port 4748.
#
# Both read the same store, read-only. Host-specific values never go in the
# repo: stable reads ~/.config/darius/web.env (the EnvironmentFile of its
# unit), next reads ~/.config/darius/next.env. Both take the same names:
#   DARIUS_WEB_URL            the address people open, e.g. a proxy's HTTPS name
#   DARIUS_WEB_PORT           stable's port; next uses DARIUS_WEB_DEV_PORT
#   DARIUS_WEB_BIND           serve's listen addresses (default auto)
#   DARIUS_WEB_ALLOW          tailnet logins allowed in directly
#   DARIUS_WEB_PROXY          a reverse proxy's addresses, and with it
#   DARIUS_WEB_PROXY_DEVICES  the devices it may vouch for
#   DARIUS_WEB_PROXY_HEADER   (default X-Tailnet-Device)
#
# usage: scripts/lane.sh up [--demo|--serve] | down | status | logs [stable|next]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${DARIUS_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/darius}"
STABLE_ENV="$CONFIG/web.env"
NEXT_ENV="$CONFIG/next.env"
NEXT_UNIT="darius-next"
STABLE_UNIT="darius-web"

die() {
  echo "lane: $*" >&2
  exit 1
}

# One variable from an env file, without running the rest of it in this shell.
env_value() {
  local file="$1" name="$2"
  [[ -f "$file" ]] || return 0
  (set -a && . "$file" && printf '%s' "${!name:-}")
}

# This host's tailnet name, for URLs; loopback without Tailscale.
host_name() {
  local name
  name="$(tailscale status --self 2>/dev/null | awk 'NR == 1 { print $2 }')" || true
  printf '%s' "${name:-127.0.0.1}"
}

next_port() {
  local port
  port="$(env_value "$NEXT_ENV" DARIUS_WEB_DEV_PORT)"
  printf '%s' "${port:-4748}"
}

stable_port() {
  local port
  port="$(env_value "$STABLE_ENV" DARIUS_WEB_PORT)"
  printf '%s' "${port:-4747}"
}

# The URL of a lane: DARIUS_WEB_URL when set, else the tailnet name and port.
lane_url() {
  local file="$1" port="$2" url
  url="$(env_value "$file" DARIUS_WEB_URL)"
  printf '%s' "${url:-http://$(host_name):$port/}"
}

up() {
  local mode="dev" port bun
  case "${1:-}" in
    "") ;;
    --demo) mode="demo" ;;
    --serve) mode="serve" ;;
    *) die "up takes --demo or --serve, not $1" ;;
  esac
  command -v systemd-run >/dev/null || die "needs systemd-run (a systemd user session)"
  port="$(next_port)"
  [[ "$port" != "$(stable_port)" ]] || die "next and stable would share port $port; set DARIUS_WEB_DEV_PORT in $NEXT_ENV"
  bun="$(command -v bun)" || die "needs bun on PATH"
  [[ -d "$ROOT/web/node_modules" ]] || die "run 'bun install' in $ROOT/web first"
  systemctl --user stop "$NEXT_UNIT" 2>/dev/null || true
  systemctl --user reset-failed "$NEXT_UNIT" 2>/dev/null || true
  local run=(systemd-run --user --quiet --collect --unit="$NEXT_UNIT"
    --description="darius next lane ($mode) from $ROOT"
    -p "EnvironmentFile=-$NEXT_ENV"
    --setenv=PATH="$PATH"
    --setenv=DARIUS_WEB_DEV_PORT="$port"
    --setenv=DARIUS_WEB_PORT="$port")
  case "$mode" in
    dev) "${run[@]}" --working-directory="$ROOT/web" "$bun" server/dev.ts ;;
    demo) "${run[@]}" --working-directory="$ROOT/web" "$bun" server/dev.ts --demo ;;
    serve) "${run[@]}" --working-directory="$ROOT" "$ROOT/bin/darius" serve --port "$port" ;;
  esac
  # The dev server needs a few seconds for Vite; wait for the port, not for a fixed time.
  local tries=0
  until ss -ltnH "sport = :$port" | grep -q .; do
    tries=$((tries + 1))
    if ((tries > 40)) || ! systemctl --user is-active --quiet "$NEXT_UNIT"; then
      journalctl --user -u "$NEXT_UNIT" -n 20 --no-pager >&2 || true
      die "next did not come up on port $port"
    fi
    sleep 0.5
  done
  echo "next ($mode) from $ROOT: $(lane_url "$NEXT_ENV" "$port")"
  echo "  logs: make logs, stop: make down"
}

down() {
  if systemctl --user is-active --quiet "$NEXT_UNIT"; then
    systemctl --user stop "$NEXT_UNIT"
    echo "next stopped"
  else
    echo "next was not running"
  fi
  systemctl --user reset-failed "$NEXT_UNIT" 2>/dev/null || true
  echo "stable is not touched: systemctl --user stop $STABLE_UNIT stops it"
}

status() {
  local port state version code
  port="$(stable_port)"
  state="$(systemctl --user is-active "$STABLE_UNIT" 2>/dev/null || true)"
  version="$(darius --version 2>/dev/null || echo "not installed")"
  code="$(curl -s -o /dev/null -m 3 -w '%{http_code}' "http://127.0.0.1:$port/healthz" || true)"
  printf '%-7s %-9s %-24s %s  (healthz %s)\n' stable "${state:-inactive}" "$version" "$(lane_url "$STABLE_ENV" "$port")" "${code:-none}"
  port="$(next_port)"
  state="$(systemctl --user is-active "$NEXT_UNIT" 2>/dev/null || true)"
  if [[ "$state" == "active" ]]; then
    local what
    what="$(systemctl --user show -p Description --value "$NEXT_UNIT")"
    printf '%-7s %-9s %s  %s\n' next active "$(lane_url "$NEXT_ENV" "$port")" "${what#darius next lane }"
  else
    printf '%-7s %-9s %s\n' next "${state:-inactive}" "make next starts it on port $port"
  fi
}

logs() {
  case "${1:-next}" in
    next) journalctl --user -u "$NEXT_UNIT" -f ;;
    stable) journalctl --user -u "$STABLE_UNIT" -f ;;
    *) die "logs takes stable or next" ;;
  esac
}

case "${1:-}" in
  up) up "${2:-}" ;;
  down) down ;;
  status) status ;;
  logs) logs "${2:-}" ;;
  *) die "usage: scripts/lane.sh up [--demo|--serve] | down | status | logs [stable|next]" ;;
esac
