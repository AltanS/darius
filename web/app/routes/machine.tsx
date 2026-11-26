/**
 * One machine (0.139.0, reworked in 0.141.0 and 0.143.0). Top to bottom:
 * the trail "Machines / name"; the name with its state and the "this
 * machine" mark; short sentences on what it runs and starts and what runs
 * now; the line that defines ritual and workspace; Needs a look (the
 * rituals, then the machine itself, one button each); one line of facts;
 * the workspaces it runs (Why starts with the need-you count of Places) and
 * the copies it keeps; the rituals on schedule; what runs there now; its
 * recent runs. The page of this machine adds "Store and disks" (`/status`
 * redirects here). Then the details fold, the time note and the words of
 * the page. A page in no workspace. Read-only.
 */

import { data, Link } from "react-router";

import type { BackupsStatus, HostOpenRun } from "../../../src/web/api.ts";
import type { Route } from "./+types/machine";
import { Crumbs } from "../components/crumbs.tsx";
import { BoxWord, LedgerFacts, LiveFacts, Unknown } from "../components/machines.tsx";
import { ListHead, OrderNote } from "../components/list-table.tsx";
import { CopiesLine, Definitions, LookList, OnScheduleTable, ProjectsTable, RunsHereTable, TableGloss, TermsHelp, TimeNote } from "../components/machine-lists.tsx";
import { RunTable } from "../components/runs.tsx";
import { Sentence } from "../components/sentence.tsx";
import { Machine, StatusStrip, SyncRemote } from "../components/system.tsx";
import { Empty, Fold, Section, Status, Time } from "../components/ui.tsx";
import { groupByWorkspace, LEGEND, type Group } from "../lib/fleet.ts";
import { uptimeText } from "../lib/format.ts";
import { copyRows, onSchedule, onScheduleTitle, runsHereRows } from "../lib/lists.ts";
import { lookItems } from "../lib/look.ts";
import { machineAttention, machineFacts, machineRituals, machineSentence, type MachineFacts } from "../lib/machines.ts";
import { needCounts } from "../lib/home.ts";
import { href, itemTarget, machineCrumbs } from "../lib/paths.ts";
import { machineWord, peersOf } from "../lib/peers.ts";
import { backupWord } from "../lib/state-words.ts";
import { statusOf, workspacesOf } from "../lib/status.ts";
import { LABELS, MACHINE_PAGE_TERMS, STATE_WORDS, TERMS } from "../lib/terms.ts";
import { activityRun, itemSlug, openAsks } from "../lib/view.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

interface TitledRun extends HostOpenRun {
  title: string;
}

export async function loader({ context, params }: Route.LoaderArgs) {
  const name = params.host;
  const fleet = context.fleet();
  const peers = await peersOf(context);
  const host = fleet.hosts.find((entry) => entry.host === name) ?? null;
  const peer = peers.find((entry) => entry.host === name) ?? null;
  if (host === null && peer === null) throw data(`No machine named ${name} in this store.`, { status: 404 });
  const workspaces = workspacesOf(context).workspaces;
  const projects = statusOf(context).projects;
  const titleOf = (project: string, item: string): string => {
    const status = projects.find((entry) => entry.name === project);
    const slug = itemSlug(item);
    const found = item.startsWith("ritual/") ? status?.rituals.find((ritual) => ritual.slug === slug) : status?.vigils.find((vigil) => vigil.slug === slug);
    return found?.title ?? slug;
  };
  // Its own word when it answered; else what the ledgers here say.
  const open = peer?.live?.openRuns ?? fleet.openRuns.filter((run) => run.host === name).map(({ host: _host, ...run }) => run);
  const running: TitledRun[] = open.map((run) => Object.assign({ title: titleOf(run.project, run.item) }, run));
  const selfVersion = peers.find((entry) => entry.self)?.version ?? fleet.hosts.find((entry) => entry.self)?.version ?? null;
  const facts = machineFacts({ name, peer: peer ?? undefined, host: host ?? undefined, workspaces, selfVersion });
  const asks = openAsks(projects);
  const rituals = machineRituals(name, workspaces, asks);
  return {
    name,
    host,
    peer,
    facts,
    // The need-you count of each workspace from the source of the badges in Places: one number on both.
    runsHere: runsHereRows(name, workspaces, fleet.lastRuns, open, asks, needCounts(statusOf(context)).partsByProject),
    copies: copyRows(name, workspaces),
    running: groupByWorkspace(running, (run) => run.project),
    runningFrom: peer?.live === undefined || peer.live === null ? "ledger" : "live",
    // What needs a look here (0.143.0), and the rituals on schedule: a ritual is in one of the two, never both.
    look: lookItems({ machine: name, rituals, attention: machineAttention(facts, selfVersion), page: "machine" }),
    onSchedule: onSchedule(rituals),
    // The newest runs that ran here, from the fleet view: no second ledger scan.
    recent: fleet.recentRuns.filter((run) => run.host === name).map((run) => activityRun(run.project, projects.find((one) => one.name === run.project), run)),
    // The store and the disks: only on the page of this machine, which is the one that can read them.
    store: facts.self ? { system: context.system(), backups: context.backups() } : null,
  };
}

export const meta: Route.MetaFunction = ({ params }) => [{ title: `${params.host} | Machines | darius` }];

function ShowAll({ group, to }: { group: Group<unknown>; to: string }): React.ReactNode {
  if (group.total <= group.rows.length) return null;
  return (
    <p className="fl-show-all">
      <Link to={to}>{`Show all ${String(group.total)}`}</Link>
    </p>
  );
}

function RunGroups({ groups }: { groups: readonly Group<TitledRun>[] }): React.ReactNode {
  if (groups.length === 0) return <Empty>No run is open here.</Empty>;
  return groups.map((group) => (
    <div key={group.workspace} className="fl-group">
      <h3 className="fl-group-name">
        <Link to={href({ to: "overview", ws: group.workspace })}>{group.workspace}</Link>
      </h3>
      <ul className="sy-list panel">
        {group.rows.map((run) => (
          <li key={run.run} className="sy-item">
            <p className="sy-item-head">
              <Link to={href(itemTarget(run.project, run.item))} className="sy-name">
                {run.title}
              </Link>
              <Status tone={run.phase === "held" ? "wait" : "run"} label={run.phase === "held" ? STATE_WORDS.waits : "Running"} />
              <span className="text-muted">
                started <Time iso={run.startedAt} />
              </span>
              <Link to={href({ to: "run", ws: run.project, run: run.run })}>Open the run</Link>
            </p>
          </li>
        ))}
      </ul>
      <ShowAll group={group} to={href({ to: "section", ws: group.workspace, section: "runs", query: { state: "running" } })} />
    </div>
  ));
}

/** One line of labelled values: darius, up, load, box check, last seen, last backup. */
function FactsRow({ facts }: { facts: MachineFacts }): React.ReactNode {
  const backup = facts.backup === null ? null : backupWord(facts.backup.state);
  return (
    <dl className="mp-facts">
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
        <dd>
          <Time iso={facts.lastSeen} />
        </dd>
      </div>
      <div>
        <dt>Last backup</dt>
        <dd>
          {facts.backup === null || backup === null ? (
            <span className="text-muted">no backup line</span>
          ) : (
            <>
              <Status tone={backup.tone} label={backup.label} /> <Time iso={facts.backup.lastOkAt} />
            </>
          )}
        </dd>
      </div>
    </dl>
  );
}

/** What is wrong with the backups of this machine, in one short sentence; null when nothing is. */
function backupTrouble(backups: BackupsStatus): string | null {
  if (backups.problems.length > 0) return backups.problems.length === 1 ? "One thing blocks backups." : `${backups.problems.length} things block backups.`;
  if (backups.last !== null && !backups.last.ok) return "The last backup failed.";
  return null;
}

/** The store and the disks of this machine: the strip of facts, the backups line, the machine facts with the disk bars, the projects. */
function StoreAndDisks({ store }: { store: NonNullable<Route.ComponentProps["loaderData"]["store"]> }): React.ReactNode {
  const trouble = backupTrouble(store.backups);
  return (
    <Section title="Store and disks" id="store">
      <div className="stack">
        <StatusStrip system={store.system} backups={store.backups} />
        <p className={trouble === null ? "text-muted" : "page-warn tone-late"} role={trouble === null ? undefined : "status"}>
          {trouble ?? "The backups of this machine have no problem."} <Link to={href({ to: "host", page: "settings/backups" })}>Open the backups</Link>
          {store.system.backupBucketsDiffer ? " The machines back up to more than one bucket." : null}
        </p>
        <Machine system={store.system} />
        <div className="stack">
          <h3 className="lt-head">
            <span className="lt-head-title">Projects and syncs</span>
            <OrderNote>the largest first</OrderNote>
          </h3>
          {store.system.projects.length === 0 ? <p className="panel-empty panel">This store holds no project yet.</p> : <ProjectsTable projects={store.system.projects} />}
          <SyncRemote system={store.system} />
        </div>
      </div>
    </Section>
  );
}

export default function MachinePage({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { name, host, peer, facts, runsHere, copies, running, runningFrom, look, onSchedule: quiet, recent, store } = loaderData;
  const word = machineWord(facts.state);
  return (
    <div className="stack">
      <header className="page-head page-head-tight">
        <Crumbs trail={machineCrumbs(name)} />
        <h1 className="page-title mp-title">
          <span className="mp-name">{name}</span>
          <Status tone={word.tone} label={word.label} />
          {facts.self ? <span className="mt-this">this machine</span> : null}
        </h1>
        <Sentence className="mp-sentence" parts={machineSentence(facts)} />
        <Definitions terms={["ritual", "workspace"]} className="def-line" />
      </header>
      <Section title={LABELS.needsLook} id="look">
        <LookList items={look} />
      </Section>
      <FactsRow facts={facts} />
      <Section title="Workspaces on this machine" id="workspaces">
        <div className="stack">
          <p className="fl-legend">{LEGEND}</p>
          <ListHead title={LABELS.runsHere} count={runsHere.length} order="worst first" />
          <TableGloss rows={runsHere} />
          {runsHere.length === 0 ? <Empty>This machine runs no workspace.</Empty> : <RunsHereTable rows={runsHere} openRuns caption={`Workspaces ${name} runs, worst first`} />}
          <div id="copies" className="mp-copies">
            <ListHead title="Copies" count={copies.length} order="by name; they run on other machines" />
            <CopiesLine copies={copies} />
          </div>
        </div>
      </Section>
      <Section title={`${LABELS.ritualsHere} (${String(facts.rituals)})`} id="rituals">
        {facts.rituals === 0 ? (
          <Empty>{`darius starts no ${TERMS.ritual.word} here.`}</Empty>
        ) : (
          <div className="stack">
            <ListHead title={onScheduleTitle(quiet.length, facts.rituals)} order={LABELS.onScheduleOrder} />
            {quiet.length === 0 ? <Empty>{`None: every ${TERMS.ritual.word} here is under ${LABELS.needsLook}.`}</Empty> : <OnScheduleTable rituals={quiet} caption={`Rituals on schedule on ${name}, next due first`} />}
          </div>
        )}
      </Section>
      <Section title={runningFrom === "live" ? "Running now" : "Running now, from the ledgers"} id="running">
        <RunGroups groups={running} />
      </Section>
      <Section title="Recent runs here" id="recent" aside={<OrderNote>newest first</OrderNote>}>
        <RunTable runs={recent} showProject className="lt-capped" caption={`Recent runs on ${name}, newest first`} empty="No run ran here yet." answerWord />
      </Section>
      {store === null ? null : <StoreAndDisks store={store} />}
      <Fold summary="Details: live facts, ledgers, versions">
        <div className="stack">
          {peer?.live === undefined || peer.live === null ? <Empty>{peer === null ? "darius did not ask this machine." : `Its darius serve did not answer${peer.reason === null ? "" : `: ${peer.reason}`}.`}</Empty> : <LiveFacts live={peer.live} />}
          {host === null ? <Empty>No ledger line of this machine here.</Empty> : <LedgerFacts host={host} />}
          {host === null || host.versions.length === 0 ? (
            <Empty>No host.version line of this machine here (before 0.126.0).</Empty>
          ) : (
            <ul className="sy-list panel">
              {host.versions.slice(0, 10).map((step) => (
                <li key={`${step.version}/${step.at}`} className="sy-item">
                  <p className="sy-item-head">
                    <span className="sy-name">{step.version}</span>
                    <Time iso={step.at} />
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Fold>
      <TimeNote />
      <TermsHelp terms={MACHINE_PAGE_TERMS} />
    </div>
  );
}
