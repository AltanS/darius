/**
 * The machine bar (0.139.0, labelled in 0.141.0, lit by the page in
 * 0.141.1): the label "Machines", then one chip per machine of the synced
 * store, in a sticky one-line bar at the head of `<main>`. A chip has a
 * square in the state colour, the machine name, "n running" when it has open
 * runs, and links to the machine page. The state is in words for a screen
 * reader and in the title. A chip is lit (a gold edge, `aria-current`) only
 * while the page of its machine is open; on every other page no chip is lit.
 * This machine carries a small muted "this" mark and nothing else. A machine
 * with something to check shows a small amber "!" after its name (title and
 * screen reader text "something to check"), never a number: the bar reads
 * only the probe data, so a count could disagree with Machines. The version lives on
 * Machines: the bar only marks "versions differ". A chip name is cut at about
 * 10 characters. On a phone a chip shows the run count without the word,
 * and below 480 px with more than 3 machines the chips are dots, with the
 * name in their accessible label. While a page loads, a desktop shows the
 * loading text ("Opening Machines…") at the right, before "versions
 * differ"; a phone shows it in the top bar instead. Below 640 px the label
 * is visually hidden (screen readers keep it), so the chips get the room.
 */

import { Link } from "react-router";

import type { PeerHost } from "../../../src/web/api.ts";
import { href } from "../lib/paths.ts";
import { peerNeedsCheck } from "../lib/machines.ts";
import { chipLit, differentVersions, openRunCount, peerMeaning, peerWord } from "../lib/peers.ts";

interface ChipProps {
  peer: PeerHost;
  /** The page on screen (or the page a tap opens): its machine is the one lit chip. */
  pathname: string;
  /** The darius of this machine, for the version check. */
  selfVersion: string | null;
}

function MachineChip({ peer, pathname, selfVersion }: ChipProps): React.ReactNode {
  const word = peerWord(peer.state);
  const runs = openRunCount(peer) ?? 0;
  const check = peerNeedsCheck(peer, selfVersion);
  const lit = chipLit(pathname, peer.host);
  return (
    <li>
      <Link to={href({ to: "machine", host: peer.host })} className={`hs-chip tone-${word.tone}${lit ? " is-lit" : ""}`} aria-current={lit ? "page" : undefined} title={`${peer.host}: ${peerMeaning(peer)}`}>
        <span className={peer.state === "offline" || peer.state === "checking" ? "hs-dot is-hollow" : "hs-dot"} aria-hidden="true" />
        <span className="hs-name">{peer.host}</span>
        {peer.self ? (
          <span className="hs-this" aria-hidden="true">
            this
          </span>
        ) : null}
        <span className="sr-only">{`, ${word.label}${peer.self ? ", this machine" : ""}`}</span>
        {check ? (
          <span className="hs-check" title="something to check">
            <span aria-hidden="true">!</span>
            <span className="sr-only">, something to check</span>
          </span>
        ) : null}
        {runs === 0 ? null : (
          <span className="hs-runs">
            <span aria-hidden="true">{runs}</span>
            <span className="hs-runs-word" aria-hidden="true">
              {" running"}
            </span>
            <span className="sr-only">{runs === 1 ? ", 1 open run" : `, ${String(runs)} open runs`}</span>
          </span>
        )}
      </Link>
    </li>
  );
}

interface HostStripProps {
  peers: readonly PeerHost[];
  /** The path of the page on screen, or of the page a tap opens. */
  pathname: string;
  /** "Opening Workspaces…" while a navigation is slow, else empty. */
  loading: string;
}

/** More machines than this, and a phone under 480 px shows dots. */
const NAMED_CHIPS_MAX = 3;

export function HostStrip({ peers, pathname, loading }: HostStripProps): React.ReactNode {
  if (peers.length === 0 && loading === "") return null;
  const versions = differentVersions(peers);
  const selfVersion = peers.find((peer) => peer.self)?.version ?? null;
  const className = `hs${peers.length > NAMED_CHIPS_MAX ? " hs-many" : ""}${loading === "" ? "" : " is-loading"}`;
  return (
    <nav aria-label="Machines" className={className}>
      {peers.length === 0 ? null : <span className="hs-label">Machines</span>}
      <ul className="hs-list">
        {peers.map((peer) => (
          <MachineChip key={peer.host} peer={peer} pathname={pathname} selfVersion={selfVersion} />
        ))}
      </ul>
      <span className="busy-text hs-loading" aria-live="polite">
        {loading}
      </span>
      {versions.length === 0 ? null : (
        <Link to={href({ to: "host", page: "machines" })} className="hs-warn tone-late" title={`The machines run different darius versions: ${versions.join(", ")}.`}>
          <span className="hs-warn-mark" aria-hidden="true">
            ≠
          </span>
          <span className="hs-warn-text">versions differ</span>
        </Link>
      )}
    </nav>
  );
}
