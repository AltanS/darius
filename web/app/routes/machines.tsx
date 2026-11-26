/**
 * Machines (0.139.0, blocks since 0.141.1): every machine of the synced
 * store. One sentence with the states and the open runs, the versions
 * warning, then one block per machine, stacked at full width (the same
 * markup on a phone). A block says what lives on the machine: its state, its
 * name (the link to its page), the "this machine" mark, "n to check" when
 * its Needs attention list is not empty, the machine sentence, the
 * workspaces it runs and the copies it shows, the djinns that live there
 * (0.142.0: two tables, one under the other), and a muted row of facts. The live facts come from each machine's
 * own `darius serve`, the rest from the synced ledgers. A page in no
 * workspace. Read-only. `/hosts` redirects here.
 */

import { Link } from "react-router";

import type { Route } from "./+types/machines";
import { BoxWord, Unknown } from "../components/machines.tsx";
import { Sentence } from "../components/sentence.tsx";
import { ListHead } from "../components/list-table.tsx";
import { DjinnTable, RunsHereTable } from "../components/machine-lists.tsx";
import { Time } from "../components/ui.tsx";
import { uptimeText } from "../lib/format.ts";
import { machineBlock, machineNames, machineSentence, openRunsLine, SENTENCE_NAMES, stateLine, stateSplit, type MachineBlock } from "../lib/machines.ts";
import { href } from "../lib/paths.ts";
import { differentVersions, machineWord, peersOf } from "../lib/peers.ts";
import { statusOf, workspacesOf } from "../lib/status.ts";
import { askingRuns } from "../lib/view.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

export async function loader({ context }: Route.LoaderArgs) {
  const fleet = context.fleet();
  const peers = await peersOf(context);
  const workspaces = workspacesOf(context).workspaces;
  const selfVersion = peers.find((peer) => peer.self)?.version ?? fleet.hosts.find((host) => host.self)?.version ?? null;
  const asking = askingRuns(statusOf(context).projects);
  const blocks = machineNames(fleet.hosts, peers).map((name) => {
    const peer = peers.find((one) => one.host === name);
    const openRuns = peer?.live?.openRuns ?? fleet.openRuns.filter((run) => run.host === name);
    return machineBlock({ name, peer, host: fleet.hosts.find((host) => host.host === name), workspaces, selfVersion, lastRuns: fleet.lastRuns, openRuns, asking });
  });
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

/** "Also shows a copy of 12: a, b, c, d and 8 more": each name a link to its workspace. */
function CopiesNote({ copies, machine }: { copies: readonly string[]; machine: string }): React.ReactNode {
  if (copies.length === 0) return null;
  const shown = copies.slice(0, SENTENCE_NAMES);
  const more = copies.length - shown.length;
  return (
    <p className="mb-copies">
      {`Also shows a copy of ${String(copies.length)}: `}
      {shown.map((name, index) => (
        <span key={name}>
          {index === 0 ? null : index === shown.length - 1 && more === 0 ? " and " : ", "}
          <Link to={href({ to: "overview", ws: name })}>{name}</Link>
        </span>
      ))}
      {more === 0 ? null : (
        <>
          {" and "}
          <Link to={href({ to: "machine", host: machine, hash: "copies" })}>{`${String(more)} more`}</Link>
        </>
      )}
      .
    </p>
  );
}

/** The workspaces that run on the machine, worst first, at most six; then its copies in one muted line. */
function RunsGroup({ block }: { block: MachineBlock }): React.ReactNode {
  const total = block.runs.length + block.moreRuns;
  return (
    <div className="mb-group">
      <ListHead title="Workspaces it runs" count={total} order="worst first" />
      {total === 0 ? <p className="text-muted">It runs no workspace.</p> : <RunsHereTable rows={block.runs} caption={`Workspaces ${block.facts.name} runs, worst first`} />}
      {block.moreRuns === 0 ? null : (
        <p className="mb-more">
          <Link to={href({ to: "machine", host: block.facts.name, hash: "workspaces" })}>{`and ${String(block.moreRuns)} more`}</Link>
        </p>
      )}
      <CopiesNote copies={block.facts.copies} machine={block.facts.name} />
    </div>
  );
}

/** The djinns that live on the machine: the ones that need a look first, then by their last run; at most eight, then "and n more". */
function DjinnsGroup({ block }: { block: MachineBlock }): React.ReactNode {
  const total = block.djinns.length + block.moreDjinns;
  return (
    <div className="mb-group">
      <ListHead title="Djinns that live here" count={total} order="needs a look first, then last run, newest first" />
      {total === 0 ? <p className="text-muted">No djinn lives here.</p> : <DjinnTable djinns={block.djinns} caption={`Djinns that live on ${block.facts.name}`} />}
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
