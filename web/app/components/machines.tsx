/**
 * The parts of the machine pages (0.139.0, 0.141.0): the box check in
 * words, the muted dash of a value a machine did not give, its live facts
 * from its own `darius serve`, and its facts from the synced ledgers.
 * Read-only.
 */

import type { FleetHost, HostBoxCheck, HostLive } from "../../../src/web/api.ts";
import { uptimeText } from "../lib/format.ts";
import { backupWord } from "../lib/state-words.ts";
import type { Badge } from "../lib/tone.ts";
import { Status, Time } from "./ui.tsx";

/** The state of a host's newest box check, in words. */
export function boxWord(check: HostBoxCheck | null): Badge {
  if (check === null) return { tone: "idle", label: "no box check" };
  return check.outcome === "pass" ? { tone: "ok", label: "box check passed" } : { tone: "bad", label: `box check ${check.outcome}` };
}

/** The newest box check in a short word ("passed", "fail"), in its tone. */
export function BoxWord({ check }: { check: HostBoxCheck | null }): React.ReactNode {
  const box = boxWord(check);
  return <Status tone={box.tone} label={check === null ? "none" : box.label.replace(/^box check /u, "")} />;
}

/** A value the machine did not give: a muted dash, with the reason in the title. */
export function Unknown(): React.ReactNode {
  return (
    <span className="text-muted" title="did not answer">
      <span aria-hidden="true">–</span>
      <span className="sr-only">unknown, did not answer</span>
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
