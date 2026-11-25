/**
 * The host strip (0.139.0): one chip per host of the synced store, at the
 * head of every page. A chip has a square in the state colour, the host
 * name, its darius version and its open runs, and links to the machine
 * page. The state is in words for a screen reader and in the title. This
 * host is marked. When the hosts run different darius versions, a short
 * warning ends the strip. It scrolls sideways on a phone.
 */

import { Link } from "react-router";

import type { PeerHost } from "../../../src/web/api.ts";
import { href } from "../lib/paths.ts";
import { differentVersions, openRunCount, peerMeaning, peerWord } from "../lib/peers.ts";

interface ChipProps {
  peer: PeerHost;
}

function runsText(count: number | null): string | null {
  if (count === null || count === 0) return null;
  return count === 1 ? "1 run" : `${String(count)} runs`;
}

function HostChip({ peer }: ChipProps): React.ReactNode {
  const word = peerWord(peer.state);
  const runs = runsText(openRunCount(peer));
  return (
    <li>
      <Link to={href({ to: "machine", host: peer.host })} className={`hs-chip tone-${word.tone}${peer.self ? " is-self" : ""}`} title={peerMeaning(peer)}>
        <span className={peer.state === "offline" ? "hs-dot is-hollow" : "hs-dot"} aria-hidden="true" />
        <span className="hs-name">{peer.host}</span>
        <span className="sr-only">{`, ${word.label}`}</span>
        {peer.self ? <span className="hs-self">this host</span> : null}
        {peer.version === null ? null : <span className="hs-ver">{peer.version}</span>}
        {runs === null ? null : <span className="hs-runs">{runs}</span>}
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
