/**
 * The machine and the store, for the status page (0.44.0): the strip of
 * small facts at the top, then the machine, the hosts that sync, and the
 * projects with their last sync. Read-only. Every row is a line, not a tile.
 */

import { Link } from "react-router";

import type { BackupsStatus, SystemDisk, SystemHost, SystemProject, SystemStatus } from "../../../src/web/api.ts";
import { useClock } from "../lib/clock.tsx";
import { href } from "../lib/paths.ts";
import { byteSize, momentText, relativeTime, uptimeText } from "../lib/format.ts";
import { backupWord } from "../lib/state-words.ts";
import type { Tone } from "../lib/tone.ts";
import { Section, Status, Time } from "./ui.tsx";

const DAY_MS = 86_400_000;

interface FactPillProps {
  /** The short value: a count, a size or an age. */
  value: string;
  /** One word, or two, after it. */
  label: string;
  tone: Tone;
  /** Makes the pill a link to the page that holds the fact. */
  to?: string;
}

/** One fact of the strip: the same square, number and word as the `Pill` of a project page, with text for a value. */
function FactPill({ value, label, tone, to }: FactPillProps): React.ReactNode {
  const inner = (
    <>
      <span className="pill-dot" aria-hidden="true" />
      <span className="pill-n">{value}</span>
      <span className="pill-l">{label}</span>
    </>
  );
  if (to === undefined) return <div className={`pill tone-${tone}`}>{inner}</div>;
  return (
    <Link to={to} className={`pill tone-${tone}`}>
      {inner}
    </Link>
  );
}

interface StripProps {
  system: SystemStatus;
  backups: BackupsStatus;
}

/** How long ago, in the words of `relativeTime` without "ago": "5 min", "3 h", "2 d". */
function since(iso: string, now: number): string {
  const text = relativeTime(iso, now);
  return text === "just now" ? "0 min" : text.replace(" ago", "");
}

function newestSync(projects: readonly SystemProject[]): string | null {
  const times = projects.flatMap((project) => (project.lastSync === null ? [] : [project.lastSync]));
  return times.toSorted((left, right) => right.localeCompare(left))[0] ?? null;
}

interface BackupFact {
  value: string;
  label: string;
  tone: Tone;
}

function backupFact(backups: BackupsStatus, now: number): BackupFact {
  if (backups.running !== null) return { value: "running", label: "backup", tone: "run" };
  if (backups.last === null) return { value: "none", label: "backup yet", tone: "idle" };
  if (!backups.last.ok) return { value: "failed", label: "backup", tone: "bad" };
  return { value: since(backups.last.at, now), label: "since backup", tone: "ok" };
}

/** The status strip: six small facts in one block. */
export function StatusStrip({ system, backups }: StripProps): React.ReactNode {
  const { now } = useClock();
  const sync = newestSync(system.projects);
  const backup = backupFact(backups, now);
  const syncTone: Tone = sync === null ? "idle" : now - Date.parse(sync) > DAY_MS ? "late" : "ok";
  return (
    <nav className="pulse pulse-home pulse-status stagger" aria-label="Summary">
      <FactPill value={String(system.hosts.length)} label={system.hosts.length === 1 ? "host" : "hosts"} tone="gold" />
      <FactPill value={String(system.store.rituals + system.store.vigils)} label="items" tone="gold" />
      <FactPill value={String(system.store.runs)} label="runs" tone="gold" />
      <FactPill value={byteSize(system.store.bytes)} label="store" tone="gold" />
      <FactPill value={sync === null ? "never" : since(sync, now)} label={sync === null ? "synced" : "since sync"} tone={syncTone} />
      <FactPill value={backup.value} label={backup.label} tone={backup.tone} to={href({ to: "host", page: "settings/backups" })} />
    </nav>
  );
}

// --- machine ------------------------------------------------------------------------------

interface BarProps {
  disk: SystemDisk;
}

function usedPercent(disk: SystemDisk): number {
  if (disk.totalBytes <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round(((disk.totalBytes - disk.freeBytes) / disk.totalBytes) * 100)));
}

/** A thin bar, drawn as an SVG so the page needs no inline style. */
function UsageBar({ disk }: BarProps): React.ReactNode {
  const used = usedPercent(disk);
  const tone: Tone = used >= 90 ? "bad" : used >= 75 ? "late" : "gold";
  return (
    <svg className={`sy-bar tone-${tone}`} viewBox="0 0 100 4" preserveAspectRatio="none" role="img" aria-label={`${used} percent used`}>
      <rect className="sy-bar-back" x="0" y="0" width="100" height="4" />
      <rect className="sy-bar-fill" x="0" y="0" width={used} height="4" />
    </svg>
  );
}

function DiskRow({ disk }: BarProps): React.ReactNode {
  return (
    <div className="sy-disk">
      <div className="sy-disk-head">
        <span className="sy-disk-label">{disk.label === "store" ? "Store disk" : disk.label === "backups" ? "Backups disk" : disk.label}</span>
        <span className="sy-disk-free">
          {byteSize(disk.freeBytes)} free of {byteSize(disk.totalBytes)}
        </span>
      </div>
      <UsageBar disk={disk} />
      <code className="sy-path">{disk.path}</code>
    </div>
  );
}

interface MachineProps {
  system: SystemStatus;
}

export function Machine({ system }: MachineProps): React.ReactNode {
  const used = system.memory.totalBytes - system.memory.freeBytes;
  const rows: ReadonlyArray<readonly [string, string]> = [
    ["Host", system.host],
    ["darius", system.version],
    ["Runtime", system.runtime],
    ["Platform", system.platform],
    ["Up for", uptimeText(system.uptimeSeconds)],
    ["Load 1, 5, 15 min", system.load.map((value) => value.toFixed(2)).join(", ")],
    ["Memory", `${byteSize(used)} used of ${byteSize(system.memory.totalBytes)}`],
  ];
  return (
    <Section title="Machine">
      <dl className="sy-rows panel">
        {rows.map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="sy-disks">
        {system.disks.map((disk) => (
          <DiskRow key={disk.label} disk={disk} />
        ))}
      </div>
    </Section>
  );
}

// --- hosts and projects ------------------------------------------------------------------

interface HostRowProps {
  host: SystemHost;
  /** True when the hosts name more than one snapshot bucket: each bucket shows in the late tone. */
  differ: boolean;
}

/** The last backup of a host: its state, when the last good snapshot was made, and why the newest run failed. */
function HostBackupLine({ host, differ }: HostRowProps): React.ReactNode {
  const { backup } = host;
  if (backup === null) {
    return (
      <p className="sy-meta">
        <span className="ink-idle">last backup: none</span>
      </p>
    );
  }
  const word = backupWord(backup.state);
  return (
    <p className="sy-meta">
      <span>last backup</span>
      <Status tone={word.tone} label={word.label} />
      {backup.lastOkAt === null ? <span className="ink-idle">no good snapshot yet</span> : <Time iso={backup.lastOkAt} />}
      {backup.reason === null ? null : <span className="ink-late">{backup.reason}</span>}
      {backup.error === null ? null : <span className="ink-bad">{backup.error}</span>}
      <span className={differ ? "ink-late" : "ink-idle"}>{backup.bucket ?? "no bucket"}</span>
    </p>
  );
}

function HostRow({ host, differ }: HostRowProps): React.ReactNode {
  return (
    <li className="sy-item">
      <p className="sy-item-head">
        <span className="sy-name">{host.host}</span>
        {host.self ? <span className="bk-mark tone-ok">this host</span> : null}
      </p>
      <p className="sy-meta">
        <span>
          last seen <Time iso={host.lastSeen} />
        </span>
        <span>
          {host.chunks} {host.chunks === 1 ? "chunk" : "chunks"}
        </span>
        <span>{host.projects.length === 0 ? "no projects" : host.projects.join(", ")}</span>
      </p>
      <HostBackupLine host={host} differ={differ} />
    </li>
  );
}

interface HostsProps {
  hosts: readonly SystemHost[];
  /** `SystemStatus.backupBucketsDiffer`. */
  bucketsDiffer: boolean;
}

export function Hosts({ hosts, bucketsDiffer }: HostsProps): React.ReactNode {
  return (
    <Section title="Hosts">
      {hosts.length === 0 ? (
        <p className="panel-empty panel">No host has written to this store yet.</p>
      ) : (
        <>
          <ul className="sy-list panel">
            {hosts.map((host) => (
              <HostRow key={host.host} host={host} differ={bucketsDiffer} />
            ))}
          </ul>
          {bucketsDiffer ? (
            <p className="page-warn tone-late" role="status">
              Hosts back up to different buckets.
            </p>
          ) : null}
        </>
      )}
    </Section>
  );
}

interface ProjectRowProps {
  project: SystemProject;
}

function ProjectRow({ project }: ProjectRowProps): React.ReactNode {
  const { today, offset } = useClock();
  return (
    <li className="sy-item">
      <p className="sy-item-head">
        <span className="sy-name">{project.project}</span>
        <span className="sy-size">{byteSize(project.bytes)}</span>
      </p>
      <p className="sy-meta">
        {project.lastSync === null ? (
          <span className="ink-idle">never synced</span>
        ) : (
          <span>
            synced <Time iso={project.lastSync} />, {momentText(project.lastSync, today, offset)}
          </span>
        )}
        <span>
          {project.rituals} {project.rituals === 1 ? "ritual" : "rituals"}
        </span>
        <span>
          {project.vigils} {project.vigils === 1 ? "vigil" : "vigils"}
        </span>
        <span>
          {project.runs} {project.runs === 1 ? "run" : "runs"}
        </span>
      </p>
    </li>
  );
}

interface ProjectsProps {
  system: SystemStatus;
}

export function Projects({ system }: ProjectsProps): React.ReactNode {
  return (
    <Section title="Projects and syncs">
      {system.projects.length === 0 ? (
        <p className="panel-empty panel">This store holds no project yet.</p>
      ) : (
        <ul className="sy-list panel">
          {system.projects.map((project) => (
            <ProjectRow key={project.project} project={project} />
          ))}
        </ul>
      )}
      <p className="sy-remote">
        {system.syncRemote === null ? (
          "This host has no sync bucket."
        ) : (
          <>
            Sync bucket: <code>{system.syncRemote.bucket}</code> at <code>{system.syncRemote.endpoint}</code>.
          </>
        )}
      </p>
    </Section>
  );
}
