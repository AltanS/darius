/**
 * Machines (0.139.0, blocks since 0.141.1, "what needs me?" first since
 * 0.143.0): every machine of the synced store. The headline counts what
 * needs a look, each count a link to its item, then the machine states. Then
 * one block per machine, stacked at full width (the same markup on a
 * phone): its state, its name (the link to its page), the "this machine"
 * mark, the machine sentence, Needs a look, the workspaces it runs and the
 * copies it keeps, the rituals on schedule there, and a muted row of facts.
 * The live facts come from each machine's own `darius serve`, the rest from
 * the synced ledgers. A page in no workspace. Read-only. `/hosts` redirects
 * here.
 */

import { Link } from "react-router";

import type { Route } from "./+types/machines";
import { BoxWord, Unknown } from "../components/machines.tsx";
import { Sentence } from "../components/sentence.tsx";
import { ListHead } from "../components/list-table.tsx";
import { Definitions, LookList, OnScheduleTable, RunsHereTable, TableGloss, TermsHelp, TimeNote } from "../components/machine-lists.tsx";
import { Time } from "../components/ui.tsx";
import { uptimeText } from "../lib/format.ts";
import { machinesHeadline } from "../lib/look.ts";
import { machineBlock, machineNames, machineSentence, SENTENCE_NAMES, type MachineBlock } from "../lib/machines.ts";
import { href } from "../lib/paths.ts";
import { differentVersions, machineWord, peersOf } from "../lib/peers.ts";
import { statusOf, workspacesOf } from "../lib/status.ts";
import { LABELS, MACHINE_PAGE_TERMS, TERMS } from "../lib/terms.ts";
import { needCounts } from "../lib/home.ts";
import { onScheduleTitle } from "../lib/lists.ts";
import { openAsks } from "../lib/view.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

export async function loader({ context }: Route.LoaderArgs) {
  const fleet = context.fleet();
  const peers = await peersOf(context);
  const workspaces = workspacesOf(context).workspaces;
  const selfVersion = peers.find((peer) => peer.self)?.version ?? fleet.hosts.find((host) => host.self)?.version ?? null;
  const status = statusOf(context);
  const asks = openAsks(status.projects);
  // The need-you count of each workspace from the source of the badges in Places: one number on both.
  const needs = needCounts(status).partsByProject;
  const blocks = machineNames(fleet.hosts, peers).map((name) => {
    const peer = peers.find((one) => one.host === name);
    const openRuns = peer?.live?.openRuns ?? fleet.openRuns.filter((run) => run.host === name);
    return machineBlock({ name, peer, host: fleet.hosts.find((host) => host.host === name), workspaces, selfVersion, lastRuns: fleet.lastRuns, openRuns, asks, needs });
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

/** "Also keeps a copy of 12 workspaces that run on other machines: a, b, c, d and 8 more": each name a link to its workspace. */
function CopiesNote({ copies, machine }: { copies: readonly string[]; machine: string }): React.ReactNode {
  if (copies.length === 0) return null;
  const shown = copies.slice(0, SENTENCE_NAMES);
  const more = copies.length - shown.length;
  const what = copies.length === 1 ? `1 ${TERMS.workspace.word} that runs` : `${String(copies.length)} ${TERMS.workspace.plural} that run`;
  return (
    <p className="mb-copies">
      {`Also keeps a ${TERMS.copy.word} of ${what} on other machines: `}
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
      <ListHead title={LABELS.workspacesItRuns} count={total} order="worst first" />
      <TableGloss rows={block.runs} />
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

/** The rituals on schedule here, next due first: at most five, then "and n more". The ones with a problem are under Needs a look, never twice. */
function OnScheduleGroup({ block }: { block: MachineBlock }): React.ReactNode {
  const { facts, onSchedule, onScheduleTotal } = block;
  if (facts.rituals === 0) return null;
  const more = onScheduleTotal - onSchedule.length;
  return (
    <div className="mb-group">
      <ListHead title={onScheduleTitle(onScheduleTotal, facts.rituals)} order={LABELS.onScheduleOrder} />
      {onScheduleTotal === 0 ? <p className="text-muted">None: every ritual here is under Needs a look.</p> : <OnScheduleTable rituals={onSchedule} caption={`Rituals on schedule on ${facts.name}, next due first`} />}
      {more <= 0 ? null : (
        <p className="mb-more">
          <Link to={href({ to: "machine", host: facts.name, hash: "rituals" })}>{`and ${String(more)} more`}</Link>
        </p>
      )}
    </div>
  );
}

/** One muted row: darius, up, load, sandbox check, last activity. */
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
      <div title={LABELS.loadTitle}>
        <dt>{LABELS.load}</dt>
        <dd>{facts.load === null ? <Unknown /> : facts.load.map((value) => value.toFixed(2)).join(" ")}</dd>
      </div>
      <div>
        <dt>{LABELS.sandboxCheck}</dt>
        <dd>
          <BoxWord check={facts.boxCheck} />
        </dd>
      </div>
      <div>
        <dt>{LABELS.lastActivity}</dt>
        <dd>{facts.lastSeen === null ? <Unknown /> : <Time iso={facts.lastSeen} />}</dd>
      </div>
    </dl>
  );
}

function MachineBlockView({ block }: { block: MachineBlock }): React.ReactNode {
  const { facts, look } = block;
  return (
    <li className="mb panel" id={`machine-${facts.name}`}>
      <div className="mb-head">
        <StateWord facts={facts} />
        <h2 className="mb-name">
          <Link to={href({ to: "machine", host: facts.name })}>{facts.name}</Link>
        </h2>
        {facts.self ? <span className="mt-this">this machine</span> : null}
      </div>
      <Sentence className="mb-sentence" parts={machineSentence(facts)} />
      <LookList items={look} />
      <div className="mb-groups">
        <RunsGroup block={block} />
        <OnScheduleGroup block={block} />
      </div>
      <FactsRow facts={facts} />
    </li>
  );
}

export default function MachinesPage({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { blocks, versions } = loaderData;
  const headline = machinesHeadline({ items: blocks.flatMap((one) => one.look), states: blocks.map((one) => one.facts.state), onSchedule: blocks.reduce((sum, one) => sum + one.onScheduleTotal, 0) });
  return (
    <div className="stack">
      <header className="page-head page-head-tight">
        <h1 className="page-title">Machines</h1>
        <Sentence className="fl-headline" parts={headline} />
        <Definitions terms={["ritual", "workspace"]} className="def-line" />
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
      <TimeNote />
      <TermsHelp terms={MACHINE_PAGE_TERMS} />
    </div>
  );
}
