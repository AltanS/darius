/**
 * Machines (0.139.0, blocks since 0.141.1): every machine of the synced
 * store. One sentence with the states and the open runs, the versions
 * warning, then one block per machine, stacked at full width (the same
 * markup on a phone). A block says what lives on the machine: its state, its
 * name (the link to its page), the "this machine" mark, "n to check" when
 * its Needs attention list is not empty, the machine sentence, the
 * workspaces it runs and the djinns that live there side by side from
 * 900 px, and a muted row of facts. The live facts come from each machine's
 * own `darius serve`, the rest from the synced ledgers. A page in no
 * workspace. Read-only. `/hosts` redirects here.
 */

import { Link } from "react-router";

import type { Route } from "./+types/machines";
import { BoxWord, Unknown } from "../components/machines.tsx";
import { Sentence } from "../components/sentence.tsx";
import { Status, Time } from "../components/ui.tsx";
import { copiesMark } from "../lib/fleet.ts";
import { uptimeText } from "../lib/format.ts";
import { machineBlock, machineNames, machineSentence, openRunsLine, stateLine, stateSplit, type MachineBlock } from "../lib/machines.ts";
import { href } from "../lib/paths.ts";
import { differentVersions, machineWord, peersOf } from "../lib/peers.ts";
import { workspacesOf } from "../lib/status.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

export async function loader({ context }: Route.LoaderArgs) {
  const fleet = context.fleet();
  const peers = await peersOf(context);
  const workspaces = workspacesOf(context).workspaces;
  const selfVersion = peers.find((peer) => peer.self)?.version ?? fleet.hosts.find((host) => host.self)?.version ?? null;
  const blocks = machineNames(fleet.hosts, peers).map((name) => machineBlock({ name, peer: peers.find((peer) => peer.host === name), host: fleet.hosts.find((host) => host.host === name), workspaces, selfVersion }));
  return { blocks, versions: differentVersions(peers) };
}

export const meta: Route.MetaFunction = () => [{ title: "Machines | darius" }];

function StateWord({ facts }: { facts: MachineBlock["facts"] }): React.ReactNode {
  const word = machineWord(facts.state);
  return (
    <span className={`fl-health tone-${word.tone}`}>
      <span className={facts.state === "offline" || facts.state === "checking" ? "fl-dot is-hollow" : "fl-dot"} aria-hidden="true" />
      <span className="fl-word">{word.label}</span>
    </span>
  );
}

/** The workspaces that run on the machine, each with its health; then "+n copies". */
function RunsGroup({ block }: { block: MachineBlock }): React.ReactNode {
  const mark = copiesMark(block.facts.copies);
  return (
    <div className="mb-group">
      <h3 className="label mb-label">Runs</h3>
      <ul className="mb-runs">
        {block.runs.length === 0 ? (
          <li className="text-muted">runs no workspace</li>
        ) : (
          block.runs.map((workspace) => (
            <li key={workspace.name}>
              <Link to={href({ to: "overview", ws: workspace.name })} className={`mb-ws tone-${workspace.health.tone}`} title={`${workspace.name}: ${workspace.health.label}`}>
                <span className="fl-dot" aria-hidden="true" />
                <span className="mb-ws-name">{workspace.name}</span>
                <span className="sr-only">{`, ${workspace.health.label}`}</span>
              </Link>
            </li>
          ))
        )}
        {mark === null ? null : (
          <li className="fl-copies" title={mark.title}>
            {mark.text}
          </li>
        )}
      </ul>
    </div>
  );
}

/** The djinns that live on the machine: the name as a link to its ritual, its state word, "and n more". */
function DjinnsGroup({ block }: { block: MachineBlock }): React.ReactNode {
  return (
    <div className="mb-group">
      <h3 className="label mb-label">Djinns that live here</h3>
      {block.djinns.length === 0 ? (
        <p className="text-muted">no djinn lives here</p>
      ) : (
        <ul className="mb-djinns">
          {block.djinns.map((djinn) => (
            <li key={`${djinn.workspace}/${djinn.slug}`}>
              <Link to={href({ to: "ritual", ws: djinn.workspace, slug: djinn.slug })} className="mb-djinn-name" title={`${djinn.title}, in ${djinn.workspace}`}>
                {djinn.title}
              </Link>
              <Status tone={djinn.word.tone} label={djinn.word.label} />
            </li>
          ))}
        </ul>
      )}
      {block.moreDjinns === 0 ? null : (
        <p className="mb-more">
          <Link to={href({ to: "machine", host: block.facts.name, hash: "djinns" })}>{`and ${String(block.moreDjinns)} more`}</Link>
        </p>
      )}
    </div>
  );
}

/** One muted row: darius, up, load, box check, the age of the last ledger line. */
function FactsRow({ facts }: { facts: MachineBlock["facts"] }): React.ReactNode {
  return (
    <dl className="mb-facts">
      <div>
        <dt>darius</dt>
        <dd>{facts.version === null ? <Unknown /> : <span className={facts.differs ? "ink-late" : undefined}>{facts.differs ? `${facts.version}, differs` : facts.version}</span>}</dd>
      </div>
      <div>
        <dt>Up</dt>
        <dd>{facts.uptimeSeconds === null ? <Unknown /> : uptimeText(facts.uptimeSeconds)}</dd>
      </div>
      <div>
        <dt>Load</dt>
        <dd>{facts.load === null ? <Unknown /> : facts.load.map((value) => value.toFixed(2)).join(" ")}</dd>
      </div>
      <div>
        <dt>Box check</dt>
        <dd>
          <BoxWord check={facts.boxCheck} />
        </dd>
      </div>
      <div>
        <dt>Last ledger line</dt>
        <dd>{facts.lastSeen === null ? <Unknown /> : <Time iso={facts.lastSeen} />}</dd>
      </div>
    </dl>
  );
}

function MachineBlockView({ block }: { block: MachineBlock }): React.ReactNode {
  const { facts, attention } = block;
  return (
    <li className="mb panel">
      <div className="mb-head">
        <StateWord facts={facts} />
        <h2 className="mb-name">
          <Link to={href({ to: "machine", host: facts.name })}>{facts.name}</Link>
        </h2>
        {facts.self ? <span className="mt-this">this machine</span> : null}
        {attention.length === 0 ? null : (
          <Link to={href({ to: "machine", host: facts.name, hash: "attention" })} className="mb-check">
            {`${String(attention.length)} to check`}
          </Link>
        )}
      </div>
      <Sentence className="mb-sentence" parts={machineSentence(facts)} />
      <div className="mb-groups">
        <RunsGroup block={block} />
        <DjinnsGroup block={block} />
      </div>
      <FactsRow facts={facts} />
    </li>
  );
}

export default function MachinesPage({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { blocks, versions } = loaderData;
  return (
    <div className="stack">
      <header className="page-head page-head-tight">
        <h1 className="page-title">Machines</h1>
        <p className="fl-headline">{`${stateLine(stateSplit(blocks.map((one) => one.facts.state)))} ${openRunsLine(blocks.map((one) => one.facts))}`}</p>
      </header>
      {versions.length === 0 ? null : (
        <p className="page-warn tone-late" role="status">
          The machines run different darius versions: {versions.join(", ")}. Run darius update --hosts to bring them level.
        </p>
      )}
      <ul className="mb-list">
        {blocks.map((block) => (
          <MachineBlockView key={block.facts.name} block={block} />
        ))}
      </ul>
    </div>
  );
}
