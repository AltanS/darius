/**
 * Machines (0.139.0, a table since 0.141.0): every machine of the synced
 * store. One sentence with the states and the open runs, the versions
 * warning, then one row per machine (a card on a phone), the whole row a
 * link: state, name, the workspaces it runs and shows, running now, djinns,
 * darius, up, box check, last seen. The live facts come from each machine's
 * own `darius serve`, the rest from the synced ledgers. A page in no
 * workspace. Read-only. `/hosts` redirects here.
 */

import { Link } from "react-router";

import type { Route } from "./+types/machines";
import { BoxWord, Unknown } from "../components/machines.tsx";
import { Time } from "../components/ui.tsx";
import { copiesMark } from "../lib/fleet.ts";
import { uptimeText } from "../lib/format.ts";
import { machineFacts, machineNames, openRunsLine, stateLine, stateSplit, type MachineFacts } from "../lib/machines.ts";
import { href } from "../lib/paths.ts";
import { differentVersions, machineWord, peersOf } from "../lib/peers.ts";
import { workspacesOf } from "../lib/status.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

export async function loader({ context }: Route.LoaderArgs) {
  const fleet = context.fleet();
  const peers = await peersOf(context);
  const workspaces = workspacesOf(context).workspaces;
  const selfVersion = peers.find((peer) => peer.self)?.version ?? fleet.hosts.find((host) => host.self)?.version ?? null;
  const machines = machineNames(fleet.hosts, peers).map((name) => machineFacts({ name, peer: peers.find((peer) => peer.host === name), host: fleet.hosts.find((host) => host.host === name), workspaces, selfVersion }));
  return { machines, versions: differentVersions(peers) };
}

export const meta: Route.MetaFunction = () => [{ title: "Machines | darius" }];

function StateCell({ facts }: { facts: MachineFacts }): React.ReactNode {
  const word = machineWord(facts.state);
  return (
    <span className={`fl-health tone-${word.tone}`}>
      <span className={facts.state === "offline" || facts.state === "checking" ? "fl-dot is-hollow" : "fl-dot"} aria-hidden="true" />
      <span className="fl-word">{word.label}</span>
    </span>
  );
}

function RunsCell({ facts }: { facts: MachineFacts }): React.ReactNode {
  const mark = copiesMark(facts.copies);
  return (
    <>
      <span className={facts.runs.length === 0 ? "text-muted" : undefined}>{facts.runs.length === 1 ? "1 workspace" : `${String(facts.runs.length)} workspaces`}</span>
      {mark === null ? null : (
        <span className="fl-copies" title={mark.title}>
          {` ${mark.text}`}
        </span>
      )}
    </>
  );
}

function MachineRow({ facts }: { facts: MachineFacts }): React.ReactNode {
  return (
    <li>
      <Link to={href({ to: "machine", host: facts.name })} className="mt-row">
        <span className="fl-c mt-c-state">
          <StateCell facts={facts} />
        </span>
        <span className="fl-c mt-c-name">
          <span className="fl-name">{facts.name}</span>
          {facts.self ? <span className="mt-this">this machine</span> : null}
        </span>
        <span className="fl-c mt-c-runs">
          <span className="fl-label">Runs</span>
          <RunsCell facts={facts} />
        </span>
        <span className="fl-c mt-c-num">
          <span className="fl-label">Running now</span>
          {facts.openRuns === null ? <Unknown /> : <span className={facts.openRuns.length === 0 ? "fl-n is-zero" : "fl-n"}>{facts.openRuns.length}</span>}
        </span>
        <span className="fl-c mt-c-num">
          <span className="fl-label">Djinns</span>
          <span className={facts.djinns === 0 ? "fl-n is-zero" : "fl-n"}>{facts.djinns}</span>
          {facts.djinnsLate === 0 ? null : <span className="fl-alarm ink-late">{`${String(facts.djinnsLate)} late`}</span>}
        </span>
        <span className="fl-c mt-c-ver">
          <span className="fl-label">darius</span>
          {facts.version === null ? <Unknown /> : <span className={facts.differs ? "ink-late" : undefined}>{facts.differs ? `${facts.version}, differs` : facts.version}</span>}
        </span>
        <span className="fl-c mt-c-up">
          <span className="fl-label">Up</span>
          {facts.uptimeSeconds === null ? <Unknown /> : uptimeText(facts.uptimeSeconds)}
        </span>
        <span className="fl-c mt-c-box">
          <span className="fl-label">Box check</span>
          <BoxWord check={facts.boxCheck} />
        </span>
        <span className="fl-c mt-c-seen">
          <span className="fl-label">Last seen</span>
          <Time iso={facts.lastSeen} />
        </span>
      </Link>
    </li>
  );
}

export default function MachinesPage({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { machines, versions } = loaderData;
  return (
    <div className="stack">
      <header className="page-head page-head-tight">
        <h1 className="page-title">Machines</h1>
        <p className="fl-headline">{`${stateLine(stateSplit(machines.map((one) => one.state)))} ${openRunsLine(machines)}`}</p>
      </header>
      {versions.length === 0 ? null : (
        <p className="page-warn tone-late" role="status">
          The machines run different darius versions: {versions.join(", ")}. Run darius update --hosts to bring them level.
        </p>
      )}
      <div className="fl-table">
        <div className="mt-row fl-thead" aria-hidden="true">
          <span>State</span>
          <span>Machine</span>
          <span>Runs</span>
          <span>Running now</span>
          <span>Djinns</span>
          <span>darius</span>
          <span>Up</span>
          <span>Box check</span>
          <span>Last seen</span>
        </div>
        <ul className="fl-rows">
          {machines.map((facts) => (
            <MachineRow key={facts.name} facts={facts} />
          ))}
        </ul>
      </div>
    </div>
  );
}
