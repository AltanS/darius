/**
 * The host strip (0.139.0): one chip per host of the synced store, in a
 * sticky one-line bar at the head of `<main>` (0.140.0). A chip has a
 * square in the state colour, the host name and the count of its open runs
 * when above 0, and links to the machine page. The state is in words for a
 * screen reader and in the title; this host has a gold edge. The version
 * lives on Machines: the strip only marks "versions differ". A chip name is
 * cut at about 10 characters. Below 480 px with more than 3 hosts the chips
 * are dots, with the name in their accessible label. While a page loads, a
 * desktop shows the loading text ("Opening Machines…") at the right, before
 * "versions differ"; a phone shows it in the top bar instead.
 */

import { Link } from "react-router";

import type { PeerHost } from "../../../src/web/api.ts";
import { href } from "../lib/paths.ts";
import { differentVersions, openRunCount, peerMeaning, peerWord } from "../lib/peers.ts";

interface ChipProps {
  peer: PeerHost;
}

function HostChip({ peer }: ChipProps): React.ReactNode {
  const word = peerWord(peer.state);
  const runs = openRunCount(peer) ?? 0;
  return (
    <li>
      <Link to={href({ to: "machine", host: peer.host })} className={`hs-chip tone-${word.tone}${peer.self ? " is-self" : ""}`} title={`${peer.host}: ${peerMeaning(peer)}`}>
        <span className={peer.state === "offline" || peer.state === "checking" ? "hs-dot is-hollow" : "hs-dot"} aria-hidden="true" />
        <span className="hs-name">{peer.host}</span>
        <span className="sr-only">{`, ${word.label}`}</span>
        {runs === 0 ? null : (
          <span className="hs-runs">
            <span aria-hidden="true">{runs}</span>
            <span className="sr-only">{runs === 1 ? ", 1 open run" : `, ${String(runs)} open runs`}</span>
          </span>
        )}
      </Link>
    </li>
  );
}

interface HostStripProps {
  peers: readonly PeerHost[];
  /** "Opening Fleet…" while a navigation is slow, else empty. */
  loading: string;
}

/** More hosts than this, and a phone under 480 px shows dots. */
const NAMED_CHIPS_MAX = 3;

export function HostStrip({ peers, loading }: HostStripProps): React.ReactNode {
  if (peers.length === 0 && loading === "") return null;
  const versions = differentVersions(peers);
  const className = `hs${peers.length > NAMED_CHIPS_MAX ? " hs-many" : ""}${loading === "" ? "" : " is-loading"}`;
  return (
    <nav aria-label="Hosts" className={className}>
      <ul className="hs-list">
        {peers.map((peer) => (
          <HostChip key={peer.host} peer={peer} />
        ))}
      </ul>
      <span className="busy-text hs-loading" aria-live="polite">
        {loading}
      </span>
      {versions.length === 0 ? null : (
        <Link to={href({ to: "host", page: "hosts" })} className="hs-warn tone-late" title={`The hosts run different darius versions: ${versions.join(", ")}.`}>
          <span className="hs-warn-mark" aria-hidden="true">
            ≠
          </span>
          <span className="hs-warn-text">versions differ</span>
        </Link>
      )}
    </nav>
  );
}
