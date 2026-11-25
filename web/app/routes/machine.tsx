/**
 * One machine (0.139.0, reworked in 0.141.0). Top to bottom: the trail
 * "Machines / name"; the name with its state and the "this machine" mark;
 * one sentence built from variables (what it runs and shows, its open runs,
 * its djinns); what needs attention, only when something does; one line of
 * facts; the table of its workspaces; what runs there now; the djinns that
 * run there. The page of this machine adds "Store and disks" (what the
 * Status page showed up to 0.140.0; `/status` redirects here). Then the
 * details fold. Every list is grouped by workspace and shows at most five
 * rows per group, then "show all". A page in no workspace. Read-only.
 */

import { data, Link } from "react-router";

import type { BackupsStatus, FleetDjinn, HostOpenRun } from "../../../src/web/api.ts";
import type { Route } from "./+types/machine";
import { Crumbs } from "../components/crumbs.tsx";
import { HealthWord } from "../components/fleet.tsx";
import { BoxWord, LedgerFacts, LiveFacts, Unknown } from "../components/machines.tsx";
import { Sentence } from "../components/sentence.tsx";
import { Machine, Projects, StatusStrip } from "../components/system.tsx";
import { Empty, Fold, Section, Status, Time } from "../components/ui.tsx";
import { WorkspaceGlyph } from "../components/workspace-icon.tsx";
import { groupByWorkspace, LEGEND, type Group } from "../lib/fleet.ts";
import { uptimeText } from "../lib/format.ts";
import { machineAttention, machineFacts, machineSentence, machineWorkspaces, type MachineFacts, type MachineWorkspace } from "../lib/machines.ts";
import { href, itemTarget, machineCrumbs } from "../lib/paths.ts";
import { machineWord, peersOf } from "../lib/peers.ts";
import { backupWord } from "../lib/state-words.ts";
import { statusOf, workspacesOf } from "../lib/status.ts";
import { outcomeTone } from "../lib/tone.ts";
import { itemSlug } from "../lib/view.ts";

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
  const djinns = workspaces.flatMap((workspace) => workspace.djinns.filter((djinn) => djinn.host === name).map((djinn) => Object.assign({ workspace: workspace.name }, djinn)));
  const selfVersion = peers.find((entry) => entry.self)?.version ?? fleet.hosts.find((entry) => entry.self)?.version ?? null;
  const facts = machineFacts({ name, peer: peer ?? undefined, host: host ?? undefined, workspaces, selfVersion });
  return {
    name,
    host,
    peer,
    facts,
    selfVersion,
    rows: machineWorkspaces(name, workspaces, fleet.lastRuns, open),
    running: groupByWorkspace(running, (run) => run.project),
    runningFrom: peer?.live === undefined || peer.live === null ? "ledger" : "live",
    djinns: groupByWorkspace(djinns, (djinn) => djinn.workspace),
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
              <Status tone={run.phase === "held" ? "wait" : "run"} label={run.phase === "held" ? "Held" : "Running"} />
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

function DjinnGroups({ groups }: { groups: readonly Group<FleetDjinn & { workspace: string }>[] }): React.ReactNode {
  if (groups.length === 0) return <Empty>No djinn runs here.</Empty>;
  return groups.map((group) => (
    <div key={group.workspace} className="fl-group">
      <h3 className="fl-group-name">
        <Link to={href({ to: "overview", ws: group.workspace })}>{group.workspace}</Link>
      </h3>
      <ul className="sy-list panel">
        {group.rows.map((djinn) => (
          <li key={djinn.slug} className="sy-item">
            <p className="sy-item-head">
              <Link to={href({ to: "ritual", ws: group.workspace, slug: djinn.slug })} className="sy-name">
                {djinn.title}
              </Link>
              {djinn.why === "pinned" ? <span className="text-muted">pinned</span> : null}
              {djinn.lastOutcome === null ? (
                <span className="text-muted">no run yet</span>
              ) : (
                <span>
                  <Status tone={outcomeTone(djinn.lastOutcome)} label={djinn.lastOutcome} /> <Time iso={djinn.lastAt} />
                </span>
              )}
            </p>
          </li>
        ))}
      </ul>
      <ShowAll group={group} to={href({ to: "section", ws: group.workspace, section: "rituals" })} />
    </div>
  ));
}

/** What needs attention on the machine: a short list, each with its command when one fixes it. */
function Attention({ facts, selfVersion }: { facts: MachineFacts; selfVersion: string | null }): React.ReactNode {
  const items = machineAttention(facts, selfVersion);
  if (items.length === 0) return null;
  return (
    <Section title="Needs attention" id="attention">
      <ul className="mp-attention panel">
        {items.map((item) => (
          <li key={item.text}>
            <span>{item.text}</span>
            {item.command === null ? null : (
              <>
                {" Run "}
                <code>{item.command}</code>.
              </>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
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
        <dt>Last seen</dt>
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

/** The workspaces of the machine: the ones it runs first, then its copies; a row links to the workspace. */
function WorkspaceTable({ rows }: { rows: readonly MachineWorkspace[] }): React.ReactNode {
  if (rows.length === 0) return <Empty>This machine holds no workspace that this store knows.</Empty>;
  return (
    <div className="fl-table">
      <div className="mw-row fl-thead" aria-hidden="true">
        <span>Workspace</span>
        <span>Role</span>
        <span>Health</span>
        <span>Djinns here</span>
        <span>Open runs</span>
        <span>Last run here</span>
      </div>
      <ul className="fl-rows">
        {rows.map((row) => (
          <li key={row.name}>
            <Link to={href({ to: "overview", ws: row.name })} className="mw-row">
              <span className="fl-c fl-c-name mw-c-name">
                <WorkspaceGlyph icon={row.icon} className="fl-icon" />
                <span className="fl-name">{row.name}</span>
              </span>
              <span className={row.role === "copy" ? "fl-c mw-c-role text-muted" : "fl-c mw-c-role"}>{row.role}</span>
              <span className="fl-c mw-c-health">
                <HealthWord health={row.health} />
              </span>
              <span className="fl-c mw-c-num">
                <span className="fl-label">Djinns here</span>
                <span className={row.djinns === 0 ? "fl-n is-zero" : "fl-n"}>{row.djinns}</span>
                {row.djinnsLate === 0 ? null : <span className="fl-alarm ink-late">{`${String(row.djinnsLate)} late`}</span>}
              </span>
              <span className="fl-c mw-c-num">
                <span className="fl-label">Open runs</span>
                <span className={row.openRuns === 0 ? "fl-n is-zero" : "fl-n"}>{row.openRuns}</span>
              </span>
              <span className="fl-c mw-c-last">
                <span className="fl-label">Last run here</span>
                {row.lastRun === null ? (
                  <span className="text-muted">none</span>
                ) : (
                  <>
                    <Status tone={outcomeTone(row.lastRun.outcome)} label={row.lastRun.outcome ?? "open"} /> <Time iso={row.lastRun.at} />
                  </>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
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
        <Projects system={store.system} />
      </div>
    </Section>
  );
}

export default function MachinePage({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { name, host, peer, facts, selfVersion, rows, running, runningFrom, djinns, store } = loaderData;
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
      </header>
      <Attention facts={facts} selfVersion={selfVersion} />
      <FactsRow facts={facts} />
      <Section title="Workspaces on this machine" id="workspaces">
        <p className="fl-legend">{LEGEND}</p>
        <WorkspaceTable rows={rows} />
      </Section>
      <Section title={runningFrom === "live" ? "Running now" : "Running now, from the ledgers"} id="running">
        <RunGroups groups={running} />
      </Section>
      <Section title="Djinns that run here" id="djinns">
        <DjinnGroups groups={djinns} />
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
    </div>
  );
}
