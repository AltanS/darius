/**
 * The machines of the synced store as the pages show them (0.139.0): one
 * probe read per request, the words and tones of a machine state, and the
 * pure helpers of the machine bar.
 */

import type { AppLoadContext } from "react-router";

import type { PeerHost, PeerState } from "../../../src/web/api.ts";
import { machineOfPath } from "./paths.ts";
import type { Badge } from "./tone.ts";

const cache = new WeakMap<AppLoadContext, Promise<PeerHost[]>>();

/** The hosts with their live state, read once per request. A probe that throws gives no hosts, so a page still renders. */
export function peersOf(context: AppLoadContext): Promise<PeerHost[]> {
  let peers = cache.get(context);
  if (peers === undefined) {
    peers = context.peers().catch(() => []);
    cache.set(context, peers);
  }
  return peers;
}

const STATE_WORDS = {
  self: { tone: "ok", label: "online" },
  online: { tone: "ok", label: "online" },
  unreachable: { tone: "late", label: "unreachable" },
  offline: { tone: "bad", label: "unreachable" },
  checking: { tone: "idle", label: "checking" },
} as const satisfies Record<PeerState, Badge>;

/** The word and tone of a host state. `offline` shows as "unreachable", in its own tone: the page cannot tell a down machine from one whose serve is down. */
export function peerWord(state: PeerState): Badge {
  return STATE_WORDS[state];
}

/** The word of a machine state, or "not asked" for a machine the probe does not know. */
export function machineWord(state: PeerState | null): Badge {
  return state === null ? { tone: "idle", label: "not asked" } : STATE_WORDS[state];
}

/** What the state means, for a title and a screen reader. */
export function peerMeaning(peer: PeerHost): string {
  if (peer.state === "self") return "Online: this machine, the one that serves this page.";
  if (peer.state === "online") return "Online: its darius serve answered.";
  if (peer.state === "checking") return "Checking: the first probe is still running. The next page shows the answer.";
  const why = peer.reason === null ? "" : ` (${peer.reason})`;
  return `Unreachable: its darius serve did not answer${why}.`;
}

/** The darius versions the hosts run, when they differ; empty when all known versions agree. */
export function differentVersions(peers: readonly PeerHost[]): string[] {
  const versions = [...new Set(peers.flatMap((peer) => (peer.version === null ? [] : [peer.version])))];
  return versions.length > 1 ? versions.toSorted() : [];
}

/** The open runs of a host: running and held. Unknown (null) when the host did not answer. */
export function openRunCount(peer: PeerHost): number | null {
  return peer.live === null ? null : peer.live.openRuns.length;
}

/** A chip of the machine bar is lit only while the page of its machine is open (`/machines/<name>`). */
export function chipLit(pathname: string, host: string): boolean {
  return machineOfPath(pathname) === host;
}
