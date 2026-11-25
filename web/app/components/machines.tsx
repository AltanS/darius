/**
 * The parts of the Machines pages (0.139.0): a host's state, its live facts
 * from its own `darius serve`, and its facts from the synced ledgers. Read-only.
 */

import { Link } from "react-router";

import type { FleetHost, HostBoxCheck, HostLive, PeerHost } from "../../../src/web/api.ts";
import { href } from "../lib/paths.ts";
import { peerMeaning, peerWord } from "../lib/peers.ts";
import { uptimeText } from "../lib/format.ts";
import { backupWord } from "../lib/state-words.ts";
import type { Badge } from "../lib/tone.ts";
import { Status, Time } from "./ui.tsx";

/** The state of a host's newest box check, in words. */
export function boxWord(check: HostBoxCheck | null): Badge {
  if (check === null) return { tone: "idle", label: "no box check" };
  return check.outcome === "pass" ? { tone: "ok", label: "box check passed" } : { tone: "bad", label: `box check ${check.outcome}` };
}

interface StateProps {
  peer: PeerHost | undefined;
}

/** The live state of a host, with the reason when the probe failed. */
export function HostState({ peer }: StateProps): React.ReactNode {
  if (peer === undefined) return <Status tone="idle" label="not probed" />;
  const word = peerWord(peer.state);
  return (
    <span className="mh-state" title={peerMeaning(peer)}>
      <Status tone={word.tone} label={word.label} />
      {peer.reason === null ? null : <span className="text-muted">{peer.reason}</span>}
    </span>
  );
}

interface LiveProps {
  live: HostLive;
}

/** The facts a host's serve gave: runtime, uptimes, load. */
export function LiveFacts({ live }: LiveProps): React.ReactNode {
  const rows: ReadonlyArray<readonly [string, React.ReactNode]> = [
    ["darius", live.version],
    ["Runtime", `${live.runtime} ${live.runtimeVersion}`],
    ["Machine up for", uptimeText(live.uptimeSeconds)],
    ["Serve started", live.serveStartedAt === null ? "no serve" : <Time iso={live.serveStartedAt} />],
    ["Load 1, 5, 15 min", live.load.map((value) => value.toFixed(2)).join(", ")],
    ["Open runs", String(live.openRuns.length)],
    ["Answered", <Time key="now" iso={live.now} />],
  ];
  return (
    <dl className="sy-rows panel">
      {rows.map(([name, value]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

interface LedgerProps {
  host: FleetHost;
}

/** What the synced ledgers say of a host: last seen, chunks, projects, backup, box check. */
export function LedgerFacts({ host }: LedgerProps): React.ReactNode {
  const box = boxWord(host.boxCheck);
  const backup = host.backup === null ? null : backupWord(host.backup.state);
  return (
    <p className="sy-meta">
      <span>
        last seen <Time iso={host.lastSeen} />
      </span>
      <span>
        {host.chunks} {host.chunks === 1 ? "chunk" : "chunks"}
      </span>
      <span>{host.projects.length === 0 ? "no projects" : host.projects.join(", ")}</span>
      {backup === null ? <span className="ink-idle">no backup line</span> : <Status tone={backup.tone} label={backup.label} />}
      <span>
        <Status tone={box.tone} label={box.label} />
        {host.boxCheck === null ? null : (
          <>
            {" "}
            <Time iso={host.boxCheck.at} />
          </>
        )}
      </span>
    </p>
  );
}

interface RowProps {
  name: string;
  peer: PeerHost | undefined;
  host: FleetHost | undefined;
}

/** One machine in the list: name, state, version, then the live and the ledger facts. */
export function MachineRow({ name, peer, host }: RowProps): React.ReactNode {
  const live = peer?.live ?? null;
  const version = peer?.version ?? host?.version ?? null;
  return (
    <li className="sy-item">
      <p className="sy-item-head">
        <Link to={href({ to: "machine", host: name })} className="sy-name">
          {name}
        </Link>
        {peer?.self === true || host?.self === true ? <span className="bk-mark tone-ok">this host</span> : null}
        <HostState peer={peer} />
        <span className="sy-size">{version === null ? "version unknown" : `darius ${version}`}</span>
      </p>
      {live === null ? null : (
        <p className="sy-meta">
          <span>{`${live.runtime} ${live.runtimeVersion}`}</span>
          <span>up {uptimeText(live.uptimeSeconds)}</span>
          <span>load {live.load[0].toFixed(2)}</span>
          <span>{live.openRuns.length === 1 ? "1 open run" : `${String(live.openRuns.length)} open runs`}</span>
        </p>
      )}
      {host === undefined ? <p className="sy-meta ink-idle">No ledger line of this host here.</p> : <LedgerFacts host={host} />}
    </li>
  );
}
