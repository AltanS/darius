/**
 * The host strip (0.139.0): one chip per host of the synced store, in a
 * sticky one-line bar at the head of `<main>` (0.140.0). A chip has a
 * square in the state colour, the host name and the count of its open runs
 * when above 0, and links to the machine page. The state is in words for a
 * screen reader and in the title; this host has a gold edge. The version
 * lives on Machines: the strip only marks "versions differ". On a narrow
 * phone the chips are dots, with the name in their accessible label.
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
}

export function HostStrip({ peers }: HostStripProps): React.ReactNode {
  if (peers.length === 0) return null;
  const versions = differentVersions(peers);
  return (
    <nav aria-label="Hosts" className="hs">
      <ul className="hs-list">
        {peers.map((peer) => (
          <HostChip key={peer.host} peer={peer} />
        ))}
      </ul>
      {versions.length === 0 ? null : (
        <Link to={href({ to: "host", page: "hosts" })} className="hs-warn tone-late" title={`The hosts run different darius versions: ${versions.join(", ")}.`}>
          versions differ
        </Link>
      )}
    </nav>
  );
}
