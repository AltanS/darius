/**
 * The parts of the Machines pages (0.139.0): a host's state, its live facts
 * from its own `darius serve`, and its facts from the synced ledgers. Since
 * 0.140.0 a machine is an equal card (`MachineCard`). Read-only.
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

interface CardProps {
  name: string;
  peer: PeerHost | undefined;
  host: FleetHost | undefined;
  /** This host's darius version: a card whose version differs shows it in amber. */
  selfVersion: string | null;
  /** The workspaces with a checkout on this host. */
  checkouts: readonly string[];
  /** The djinns pinned to this host. */
  pinnedDjinns: number;
  /** Link the name to the machine page (the list), or not (the machine page itself). */
  linked?: boolean;
}

/** One machine as an equal card: state, name, version, uptime, load, box check, last seen, and what it runs. */
export function MachineCard({ name, peer, host, selfVersion, checkouts, pinnedDjinns, linked = true }: CardProps): React.ReactNode {
  const live = peer?.live ?? null;
  const version = peer?.version ?? host?.version ?? null;
  const differs = version !== null && selfVersion !== null && version !== selfVersion;
  const box = boxWord(live?.boxCheck ?? host?.boxCheck ?? null);
  const self = peer?.self === true || host?.self === true;
  const running = live?.openRuns.length ?? null;
  return (
    <article className="mc panel">
      <header className="mc-head">
        {linked ? (
          <Link to={href({ to: "machine", host: name })} className="mc-name">
            {name}
          </Link>
        ) : (
          <span className="mc-name">{name}</span>
        )}
        {self ? <span className="bk-mark tone-ok">this host</span> : null}
        <HostState peer={peer} />
      </header>
      <dl className="mc-facts">
        <div>
          <dt>darius</dt>
          <dd className={differs ? "ink-late" : undefined}>{version === null ? "unknown" : differs ? `${version}, differs` : version}</dd>
        </div>
        <div>
          <dt>Up</dt>
          <dd>{live === null ? <span className="text-muted">unknown</span> : uptimeText(live.uptimeSeconds)}</dd>
        </div>
        <div>
          <dt>Load</dt>
          <dd className="mc-load">{live === null ? <span className="text-muted">unknown</span> : live.load.map((value) => value.toFixed(2)).join(" ")}</dd>
        </div>
        <div>
          <dt>Box check</dt>
          <dd>
            <Status tone={box.tone} label={box.label.replace(/^box check /u, "")} />
          </dd>
        </div>
        <div>
          <dt>Last seen</dt>
          <dd>
            <Time iso={host?.lastSeen ?? null} />
          </dd>
        </div>
        <div>
          <dt>Running now</dt>
          <dd>{running === null ? <span className="text-muted">unknown</span> : <Link to={href({ to: "machine", host: name, hash: "running" })}>{running}</Link>}</dd>
        </div>
        <div>
          <dt>Checkouts here</dt>
          <dd className="mc-trunc" title={checkouts.join(", ")}>
            {checkouts.length === 0 ? <span className="text-muted">none</span> : `${String(checkouts.length)}: ${checkouts.join(", ")}`}
          </dd>
        </div>
        <div>
          <dt>Pinned djinns</dt>
          <dd>
            <Link to={href({ to: "machine", host: name, hash: "djinns" })}>{pinnedDjinns}</Link>
          </dd>
        </div>
      </dl>
    </article>
  );
}
