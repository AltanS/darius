/**
 * The hosts of the synced store as the pages show them (0.139.0): one probe
 * read per request, the words and tones of a host state, and the pure
 * helpers of the host strip, the Machines pages and the Topology page.
 */

import type { AppLoadContext } from "react-router";

import type { FleetLast, FleetView, PeerHost, PeerState, RitualRow } from "../../../src/web/api.ts";
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
  self: { tone: "ok", label: "this host" },
  online: { tone: "ok", label: "online" },
  unreachable: { tone: "late", label: "unreachable" },
  offline: { tone: "bad", label: "offline" },
} as const satisfies Record<PeerState, Badge>;

/** The word and tone of a host state. */
export function peerWord(state: PeerState): Badge {
  return STATE_WORDS[state];
}

/** What the state means, for a title and a screen reader. */
export function peerMeaning(peer: PeerHost): string {
  if (peer.state === "self") return "This host, the one that serves this page.";
  if (peer.state === "online") return "Online: its darius serve answered.";
  const why = peer.reason === null ? "" : ` (${peer.reason})`;
  if (peer.state === "unreachable") return `Unreachable: it syncs, but its darius serve did not answer${why}.`;
  return `Offline: no answer and no recent sync${why}.`;
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

/** The newest entry of an item, by project and item. */
export function lastOf(entries: readonly FleetLast[], project: string, item: string): FleetLast | undefined {
  return entries.find((entry) => entry.project === project && entry.item === item);
}

/** The hosts of the topology columns: every host the ledgers know but the retired ones, this host first, plus any peer the probe knows that they do not. */
export function columnsOf(fleet: FleetView, peers: readonly PeerHost[]): string[] {
  const hosts = fleet.hosts.filter((host) => !host.retired).map((host) => host.host);
  return [...hosts, ...peers.map((peer) => peer.host).filter((host) => !hosts.includes(host))];
}

/** Where a ritual may run: its pin, else "any". */
export function pinText(ritual: Pick<RitualRow, "host">): string {
  return ritual.host ?? "any";
}
