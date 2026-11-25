/**
 * Topology (0.139.0): what is where, as a matrix with one column per host.
 * Projects: which host holds a checkout or writes chunks. Rituals and
 * djinns: the pin, the host of the last run, and the lifecycle. Vigils:
 * the host of the last sweep. On top, each host's state, darius version
 * and box check. The table scrolls sideways on a phone; its first column
 * stays. A host page, in no workspace. Read-only.
 */

import { Link } from "react-router";

import type { FleetView, PeerHost, ProjectStatus, RitualRow } from "../../../src/web/api.ts";
import type { Route } from "./+types/topology";
import { boxWord } from "../components/machines.tsx";
import { Section, Status } from "../components/ui.tsx";
import { href } from "../lib/paths.ts";
import { columnsOf, lastOf, peerWord, pinText, peersOf } from "../lib/peers.ts";
import { scopeOfRequest } from "../lib/scope.ts";
import { statusOf } from "../lib/status.ts";
import { outcomeTone } from "../lib/tone.ts";
import { isDjinn, isScheduledCheck } from "../lib/view.ts";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

export async function loader({ context, request }: Route.LoaderArgs) {
  const fleet = context.fleet();
  const peers = await peersOf(context);
  // All workspaces, as the settings show them: the self-test workspace only when the operator shows it.
  return { fleet, peers, projects: scopeOfRequest(statusOf(context), request, undefined).projects };
}

export const meta: Route.MetaFunction = () => [{ title: "Topology | darius" }];

interface MatrixProps {
  hosts: readonly string[];
  fleet: FleetView;
  peers: readonly PeerHost[];
  projects: readonly ProjectStatus[];
}

function HostHead({ hosts, self }: { hosts: readonly string[]; self: string }): React.ReactNode {
  return (
    <thead>
      <tr>
        <th scope="col" className="tp-first">
          <span className="sr-only">Item</span>
        </th>
        <th scope="col">Pin</th>
        {hosts.map((host) => (
          <th key={host} scope="col">
            <Link to={href({ to: "machine", host })}>{host}</Link>
            {host === self ? <span className="tp-self">this host</span> : null}
          </th>
        ))}
      </tr>
    </thead>
  );
}

/** A cell that is empty for the eye and says so to a screen reader. */
function NoCell(): React.ReactNode {
  return (
    <td className="tp-none">
      <span className="sr-only">none</span>
    </td>
  );
}

/** The top rows: each host's state, darius version and box check. */
function HostRows({ hosts, fleet, peers }: Omit<MatrixProps, "projects">): React.ReactNode {
  const peerOf = (host: string): PeerHost | undefined => peers.find((peer) => peer.host === host);
  const fleetOf = (host: string) => fleet.hosts.find((entry) => entry.host === host);
  return (
    <tbody>
      <tr>
        <th scope="row" className="tp-first">
          State
        </th>
        <td className="tp-none" />
        {hosts.map((host) => {
          const peer = peerOf(host);
          const word = peer === undefined ? { tone: "idle" as const, label: "not probed" } : peerWord(peer.state);
          return (
            <td key={host}>
              <Status tone={word.tone} label={word.label} />
            </td>
          );
        })}
      </tr>
      <tr>
        <th scope="row" className="tp-first">
          darius
        </th>
        <td className="tp-none" />
        {hosts.map((host) => (
          <td key={host} className="font-mono">
            {peerOf(host)?.version ?? fleetOf(host)?.version ?? "unknown"}
          </td>
        ))}
      </tr>
      <tr>
        <th scope="row" className="tp-first">
          Box check
        </th>
        <td className="tp-none" />
        {hosts.map((host) => {
          const word = boxWord(peerOf(host)?.live?.boxCheck ?? fleetOf(host)?.boxCheck ?? null);
          return (
            <td key={host}>
              <Status tone={word.tone} label={word.label.replace("box check ", "")} />
            </td>
          );
        })}
      </tr>
    </tbody>
  );
}

function ProjectRows({ hosts, fleet, projects }: Omit<MatrixProps, "peers">): React.ReactNode {
  const names = [...new Set([...projects.map((project) => project.name), ...fleet.hosts.flatMap((host) => host.projects)])].toSorted();
  return (
    <tbody>
      {names.map((name) => {
        const checkout = projects.find((project) => project.name === name)?.checkout ?? null;
        return (
          <tr key={name}>
            <th scope="row" className="tp-first">
              {projects.some((project) => project.name === name) ? <Link to={href({ to: "overview", ws: name })}>{name}</Link> : name}
            </th>
            <td className="tp-none" />
            {hosts.map((host) => {
              const writes = fleet.hosts.find((entry) => entry.host === host)?.projects.includes(name) === true;
              const here = host === fleet.self && checkout !== null;
              if (!writes && !here) return <NoCell key={host} />;
              return <td key={host}>{here ? "checkout" : "writes chunks"}</td>;
            })}
          </tr>
        );
      })}
    </tbody>
  );
}

function kindOf(ritual: RitualRow): string {
  if (isDjinn(ritual)) return "djinn";
  if (isScheduledCheck(ritual)) return "check";
  return "by hand";
}

function RitualRows({ hosts, fleet, projects }: Omit<MatrixProps, "peers">): React.ReactNode {
  const rows = projects.flatMap((project) => project.rituals.filter((ritual) => ritual.lifecycle !== "retired").map((ritual) => ({ project: project.name, ritual })));
  return (
    <tbody>
      {rows.map(({ project, ritual }) => {
        const item = `ritual/${ritual.slug}`;
        const last = lastOf(fleet.lastRuns, project, item);
        const open = fleet.openRuns.find((run) => run.project === project && run.item === item);
        return (
          <tr key={`${project}/${ritual.slug}`}>
            <th scope="row" className="tp-first">
              <Link to={href({ to: "ritual", ws: project, slug: ritual.slug })}>{ritual.title}</Link>
              <span className="tp-sub">
                {project}, {kindOf(ritual)}
                {ritual.lifecycle === "active" ? "" : `, ${ritual.lifecycle}`}
              </span>
            </th>
            <td className={ritual.host === null ? "tp-any" : "font-mono"}>{pinText(ritual)}</td>
            {hosts.map((host) => {
              const parts: React.ReactNode[] = [];
              if (ritual.host === host) parts.push(<span key="pin">pinned</span>);
              if (open?.host === host) parts.push(<Status key="open" tone={open.phase === "held" ? "wait" : "run"} label={open.phase === "held" ? "held" : "running"} />);
              else if (last?.host === host) parts.push(<Status key="last" tone={outcomeTone(last.outcome)} label={`last run ${last.outcome ?? "open"}`} />);
              if (parts.length === 0) return <NoCell key={host} />;
              return (
                <td key={host}>
                  <span className="tp-cell">{parts}</span>
                </td>
              );
            })}
          </tr>
        );
      })}
    </tbody>
  );
}

function VigilRows({ hosts, fleet, projects }: Omit<MatrixProps, "peers">): React.ReactNode {
  const rows = projects.flatMap((project) => project.vigils.filter((vigil) => vigil.state !== "closed").map((vigil) => ({ project: project.name, vigil })));
  return (
    <tbody>
      {rows.map(({ project, vigil }) => {
        const last = lastOf(fleet.lastSweeps, project, `vigil/${vigil.slug}`);
        return (
          <tr key={`${project}/${vigil.slug}`}>
            <th scope="row" className="tp-first">
              <Link to={href({ to: "vigil", ws: project, slug: vigil.slug })}>{vigil.title}</Link>
              <span className="tp-sub">{project}</span>
            </th>
            <td className="tp-any">any</td>
            {hosts.map((host) =>
              last?.host === host ? (
                <td key={host}>
                  <Status tone={outcomeTone(last.outcome)} label={`last sweep ${last.outcome ?? ""}`.trim()} />
                </td>
              ) : (
                <NoCell key={host} />
              ),
            )}
          </tr>
        );
      })}
    </tbody>
  );
}

function Matrix({ title, hosts, self, children }: { title: string; hosts: readonly string[]; self: string; children: React.ReactNode }): React.ReactNode {
  return (
    <Section title={title}>
      <div className="tp-wrap panel">
        <table className="tp">
          <caption className="sr-only">{title}, one column per host</caption>
          <HostHead hosts={hosts} self={self} />
          {children}
        </table>
      </div>
    </Section>
  );
}

export default function TopologyPage({ loaderData }: Route.ComponentProps): React.ReactNode {
  const { fleet, peers, projects } = loaderData;
  const hosts = columnsOf(fleet, peers);
  return (
    <div className="stack">
      <header className="page-head page-head-tight">
        <h1 className="page-title">Topology</h1>
        <p className="lede">
          What is installed where, one column per host. A pin names the one host that runs a ritual; any means every host may. <Link to={href({ to: "host", page: "hosts" })}>See the machines</Link>.
        </p>
      </header>
      <Matrix title="Hosts" hosts={hosts} self={fleet.self}>
        <HostRows hosts={hosts} fleet={fleet} peers={peers} />
      </Matrix>
      <Matrix title="Projects" hosts={hosts} self={fleet.self}>
        <ProjectRows hosts={hosts} fleet={fleet} projects={projects} />
      </Matrix>
      <Matrix title="Rituals and djinns" hosts={hosts} self={fleet.self}>
        <RitualRows hosts={hosts} fleet={fleet} projects={projects} />
      </Matrix>
      <Matrix title="Vigils" hosts={hosts} self={fleet.self}>
        <VigilRows hosts={hosts} fleet={fleet} projects={projects} />
      </Matrix>
    </div>
  );
}
