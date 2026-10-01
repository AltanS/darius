/**
 * The backups of one host (0.44.0): the state of the last run, the snapshot
 * list with its delete control, the settings, the key pair of the bucket and
 * a test of the bucket. Everything the person types goes out through
 * `postJson` to the `/api/snapshots/...` endpoints of `darius serve`; the page
 * reads the answer from the loader again after each write. There is no
 * restore button on purpose: a restore overwrites the store, so the page
 * shows the `tar` line and the person runs it by hand.
 *
 * The key pair is write-only. Its inputs start empty, are cleared after a
 * save, and the page never receives the secret.
 */

import { useEffect, useState } from "react";
import { useRevalidator } from "react-router";

import type { BackupRow, BackupsStatus } from "../../../src/web/api.ts";
import { useClock } from "../lib/clock.tsx";
import { ALL_FIELDS, credentialsWord, ENV_KEY_ID, ENV_SECRET, envName, LOCAL_FIELDS, REMOTE_FIELDS, shortSha, sourceWord, type FieldSpec } from "../lib/backup.ts";
import { byteSize, momentText } from "../lib/format.ts";
import { postJson, type PostBody } from "../lib/post.ts";
import { Fold, Section, Status, Time } from "./ui.tsx";

const POLL_MS = 3_000;
const GIVE_UP_MS = 120_000;

/** A line of feedback under a control. */
interface Note {
  tone: "ok" | "bad";
  text: string;
}

interface NoticeProps {
  note: Note | null;
}

function Notice({ note }: NoticeProps): React.ReactNode {
  if (note === null) return null;
  return (
    <p className={`bk-note tone-${note.tone}`} role={note.tone === "bad" ? "alert" : "status"}>
      {note.text}
    </p>
  );
}

// --- problems and state ------------------------------------------------------------------

interface ProblemsProps {
  problems: readonly string[];
}

function Problems({ problems }: ProblemsProps): React.ReactNode {
  if (problems.length === 0) return null;
  return (
    <div className="page-warn bk-problems tone-late" role="alert">
      <p className="bk-problems-head">{problems.length === 1 ? "One thing blocks backups." : `${problems.length} things block backups.`}</p>
      <ul>
        {problems.map((problem) => (
          <li key={problem}>{problem}</li>
        ))}
      </ul>
    </div>
  );
}

interface StateProps {
  backups: BackupsStatus;
}

/** Three lines: the last run, whether one runs now, and the bucket. */
function StateLines({ backups }: StateProps): React.ReactNode {
  const { today, offset } = useClock();
  const { last, running, remote, remoteConfigured } = backups;
  return (
    <dl className="bk-state">
      <div>
        <dt>Last backup</dt>
        <dd>
          {last === null ? (
            "No backup has run yet."
          ) : (
            <>
              <Status tone={last.ok ? "ok" : "bad"} label={last.ok ? "ok" : "failed"} /> <Time iso={last.at} />, {momentText(last.at, today, offset)}
              {last.name === null ? null : (
                <>
                  <br />
                  <code className="bk-file">{last.name}</code>
                </>
              )}
              {last.error === null ? null : <span className="bk-err ink-bad">{last.error}</span>}
            </>
          )}
        </dd>
      </div>
      <div>
        <dt>Now</dt>
        <dd>
          {running === null ? (
            "No backup runs."
          ) : (
            <>
              <Status tone="run" label="running" /> since {momentText(running.startedAt, today, offset)}
            </>
          )}
        </dd>
      </div>
      <div>
        <dt>Bucket</dt>
        <dd>
          {!remoteConfigured ? (
            "No remote copy set up."
          ) : remote === null ? (
            "Not contacted yet."
          ) : (
            <>
              <Status tone={remote.ok ? "ok" : "bad"} label={remote.ok ? "ok" : "error"} /> last contact <Time iso={remote.at} />, {remote.ok ? `it held ${remote.count} ${remote.count === 1 ? "snapshot" : "snapshots"}` : "the last try failed"}
              {remote.error === null ? null : <span className="bk-err ink-bad">{remote.error}</span>}
            </>
          )}
        </dd>
      </div>
    </dl>
  );
}

// --- back up now -------------------------------------------------------------------------

/** One press of Back up now: what the last run was before, to see when a new one lands. */
interface Attempt {
  since: number;
  baseline: string | null;
  expired: boolean;
}

function RunButton({ backups }: StateProps): React.ReactNode {
  const { revalidate } = useRevalidator();
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [posting, setPosting] = useState(false);
  const [note, setNote] = useState<Note | null>(null);

  const arrived = attempt !== null && backups.running === null && (backups.last?.at ?? null) !== attempt.baseline;
  const waiting = attempt !== null && !attempt.expired && !arrived;
  const polling = waiting || backups.running !== null;

  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => {
      void revalidate();
      if (attempt !== null && !attempt.expired && Date.now() - attempt.since > GIVE_UP_MS) {
        setAttempt({ ...attempt, expired: true });
        setNote({ tone: "bad", text: "No result after 2 minutes. Open this page later to see how the run ended." });
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [polling, attempt, revalidate]);

  const press = async (): Promise<void> => {
    setPosting(true);
    setNote(null);
    const result = await postJson("/api/snapshots/run", {});
    setPosting(false);
    if (result.ok) {
      setAttempt({ since: Date.now(), baseline: backups.last?.at ?? null, expired: false });
      void revalidate();
      return;
    }
    setNote({ tone: "bad", text: result.status === 409 ? "A backup is already running." : result.error });
    if (result.status === 409) void revalidate();
  };

  const busy = posting || waiting || backups.running !== null;
  const label = posting || (waiting && backups.running === null) ? "Starting…" : busy ? "Backup is running…" : "Back up now";
  return (
    <div className="bk-run">
      <button type="button" className="bk-btn bk-btn-main" disabled={busy} onClick={() => void press()}>
        {label}
      </button>
      <Notice note={note} />
    </div>
  );
}

// --- the snapshot list -------------------------------------------------------------------

type Where = "local" | "remote";

interface MarkProps {
  on: boolean;
  yes: string;
  no: string;
}

function Mark({ on, yes, no }: MarkProps): React.ReactNode {
  return <span className={on ? "bk-mark tone-ok" : "bk-mark bk-mark-off tone-idle"}>{on ? yes : no}</span>;
}

interface SnapshotRowProps {
  row: BackupRow;
  remoteConfigured: boolean;
}

function SnapshotRow({ row, remoteConfigured }: SnapshotRowProps): React.ReactNode {
  const { today, offset } = useClock();
  const { revalidate } = useRevalidator();
  const [showSha, setShowSha] = useState(false);
  const [ask, setAsk] = useState<Where | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);

  const remove = async (where: Where): Promise<void> => {
    setBusy(true);
    setNote(null);
    const result = await postJson("/api/snapshots/delete", { name: row.name, where });
    setBusy(false);
    setAsk(null);
    if (result.ok) void revalidate();
    else setNote({ tone: "bad", text: result.error });
  };

  return (
    <li className="bk-snap">
      <p className="bk-snap-head">
        <time dateTime={row.at} title={row.at} className="bk-when">
          {momentText(row.at, today, offset)}
        </time>
        <span className="bk-size">{byteSize(row.bytes)}</span>
        <span className="bk-files">{row.files === null ? "files not known" : `${row.files} ${row.files === 1 ? "file" : "files"}`}</span>
      </p>
      <p className="bk-marks">
        <Mark on={row.local} yes="on this host" no="not on this host" />
        <Mark on={row.remote} yes="in the bucket" no="not in the bucket" />
      </p>
      <p className="bk-name">
        <code>{row.name}</code>
      </p>
      <p className="bk-sha">
        {row.sha256 === null ? (
          <span className="text-muted">No checksum on record.</span>
        ) : (
          <>
            <span className="bk-sha-label">sha256</span>{" "}
            <button type="button" className="bk-sha-btn" aria-expanded={showSha} onClick={() => setShowSha(!showSha)}>
              <code>{showSha ? row.sha256 : `${shortSha(row.sha256)}…`}</code>
            </button>
          </>
        )}
      </p>
      <div className="bk-acts">
        {ask === null ? (
          <>
            {row.local ? (
              <button type="button" className="bk-btn bk-btn-quiet" disabled={busy} onClick={() => setAsk("local")}>
                Delete here
              </button>
            ) : null}
            {row.remote && remoteConfigured ? (
              <button type="button" className="bk-btn bk-btn-quiet" disabled={busy} onClick={() => setAsk("remote")}>
                Delete in bucket
              </button>
            ) : null}
          </>
        ) : (
          <span className="bk-ask" role="group" aria-label="Confirm the delete">
            <span className="bk-ask-q">{ask === "local" ? "Delete from this host?" : "Delete from the bucket?"}</span>
            <button type="button" className="bk-btn bk-btn-danger" disabled={busy} onClick={() => void remove(ask)}>
              Yes
            </button>
            <button type="button" className="bk-btn bk-btn-quiet" disabled={busy} onClick={() => setAsk(null)}>
              No
            </button>
          </span>
        )}
      </div>
      <Notice note={note} />
    </li>
  );
}

interface ListProps {
  backups: BackupsStatus;
}

function SnapshotList({ backups }: ListProps): React.ReactNode {
  const { snapshots, remoteConfigured, storePath, localBytes } = backups;
  return (
    <div className="bk-block">
      <h3 className="bk-h">Snapshots</h3>
      {snapshots.length === 0 ? (
        <p className="panel-empty bk-empty">No snapshot yet. Press Back up now.</p>
      ) : (
        <>
          <p className="bk-sum">
            {snapshots.length} {snapshots.length === 1 ? "snapshot" : "snapshots"}, newest first. This host holds {byteSize(localBytes)}.
          </p>
          <ul className="bk-list">
            {snapshots.map((row) => (
              <SnapshotRow key={row.name} row={row} remoteConfigured={remoteConfigured} />
            ))}
          </ul>
        </>
      )}
      <p className="bk-restore">
        To restore by hand, stop the web service and the timers first. Then run <code className="inline-code">tar -xzf {"<file>"} -C {storePath}</code>. There is no restore button on purpose: a restore overwrites the store.
      </p>
    </div>
  );
}

// --- settings ----------------------------------------------------------------------------

type Draft = ReadonlyMap<FieldSpec["key"], string | boolean>;

interface SettingsProps {
  backups: BackupsStatus;
}

/** The value of a field as the page shows it: a boolean for a toggle, text otherwise. */
function shown(backups: BackupsStatus, field: FieldSpec): string | boolean {
  const value = backups.settings[field.key].value;
  return field.kind === "toggle" ? value === true : String(value);
}

interface FieldProps {
  field: FieldSpec;
  backups: BackupsStatus;
  draft: Draft;
  busy: boolean;
  onChange: (field: FieldSpec, value: string | boolean) => void;
  onReset: (field: FieldSpec) => void;
}

function Source({ field, backups, busy, onReset }: Pick<FieldProps, "field" | "backups" | "busy" | "onReset">): React.ReactNode {
  const { source } = backups.settings[field.key];
  return (
    <p className="st-hint bk-src">
      <span className={`bk-source bk-source-${source}`}>{sourceWord(source)}</span>
      {source === "env" ? ` by ${envName(field.wire)}. Change it where the service starts.` : ""}
      {source === "file" ? (
        <>
          {" "}
          <button type="button" className="bk-link" disabled={busy} onClick={() => onReset(field)}>
            Reset to default
          </button>
        </>
      ) : null}
    </p>
  );
}

function SettingField({ field, backups, draft, busy, onChange, onReset }: FieldProps): React.ReactNode {
  const locked = backups.settings[field.key].source === "env";
  const value = draft.get(field.key) ?? shown(backups, field);
  const id = `bk-set-${field.wire}`;
  if (field.kind === "toggle") {
    return (
      <div className="st-field bk-field">
        <div className="st-toggle">
          <div className="st-toggle-text">
            <span id={id} className="st-label">
              {field.label}
            </span>
            <span className="st-hint">{field.hint}</span>
          </div>
          <button type="button" role="switch" aria-checked={value === true} aria-labelledby={id} disabled={locked} className="st-switch" onClick={() => onChange(field, value !== true)} />
        </div>
        <Source field={field} backups={backups} busy={busy} onReset={onReset} />
      </div>
    );
  }
  return (
    <div className="st-field bk-field">
      <label htmlFor={id} className="st-label">
        {field.label}
      </label>
      <input
        id={id}
        className="bk-input"
        type={field.kind === "number" ? "number" : "text"}
        inputMode={field.kind === "number" ? "numeric" : undefined}
        min={field.kind === "number" ? 0 : undefined}
        step={field.kind === "number" ? 1 : undefined}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        disabled={locked}
        value={String(value)}
        onChange={(event) => onChange(field, event.currentTarget.value)}
      />
      <p className="st-hint">{field.hint}</p>
      <Source field={field} backups={backups} busy={busy} onReset={onReset} />
    </div>
  );
}

/** The request value of a changed field, or the sentence that says why it cannot go. */
function requestValue(field: FieldSpec, value: string | boolean): { ok: true; value: string | number | boolean } | { ok: false; error: string } {
  if (field.kind === "toggle") return { ok: true, value: value === true };
  const text = String(value).trim();
  if (field.kind === "text") return { ok: true, value: text };
  const number = Number(text);
  if (text === "" || !Number.isInteger(number) || number < 0) return { ok: false, error: `${field.label} must be a whole number, 0 or more.` };
  return { ok: true, value: number };
}

function SettingsForm({ backups }: SettingsProps): React.ReactNode {
  const { revalidate } = useRevalidator();
  const [draft, setDraft] = useState<Draft>(new Map());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);

  const change = (field: FieldSpec, value: string | boolean): void => {
    const next = new Map(draft);
    if (value === shown(backups, field)) next.delete(field.key);
    else next.set(field.key, value);
    setDraft(next);
    setNote(null);
  };

  const finish = (text: string): void => {
    setNote({ tone: "ok", text });
    void revalidate();
  };

  const reset = async (field: FieldSpec): Promise<void> => {
    setBusy(true);
    setNote(null);
    const result = await postJson("/api/snapshots/settings", { values: { [field.wire]: null } });
    setBusy(false);
    if (!result.ok) {
      setNote({ tone: "bad", text: result.error });
      return;
    }
    const next = new Map(draft);
    next.delete(field.key);
    setDraft(next);
    finish(`${field.label} is back to its default.`);
  };

  const save = async (): Promise<void> => {
    const values = new Map<string, string | number | boolean>();
    for (const field of ALL_FIELDS) {
      const value = draft.get(field.key);
      if (value === undefined || backups.settings[field.key].source === "env") continue;
      const checked = requestValue(field, value);
      if (!checked.ok) {
        setNote({ tone: "bad", text: checked.error });
        return;
      }
      values.set(field.wire, checked.value);
    }
    setBusy(true);
    setNote(null);
    const result = await postJson("/api/snapshots/settings", { values: Object.fromEntries(values) });
    setBusy(false);
    if (!result.ok) {
      setNote({ tone: "bad", text: result.error });
      return;
    }
    setDraft(new Map());
    finish("Saved.");
  };

  const group = (title: string, fields: readonly FieldSpec[]): React.ReactNode => (
    <fieldset className="bk-group">
      <legend className="bk-legend">{title}</legend>
      {fields.map((field) => (
        <SettingField key={field.key} field={field} backups={backups} draft={draft} busy={busy} onChange={change} onReset={(target) => void reset(target)} />
      ))}
    </fieldset>
  );

  return (
    <div className="bk-block">
      <h3 className="bk-h">Settings</h3>
      <div className="panel panel-pad bk-panel">
        {group("Local", LOCAL_FIELDS)}
        {group("Remote copy (S3 bucket)", REMOTE_FIELDS)}
        <div className="bk-save">
          <button type="button" className="bk-btn bk-btn-main" disabled={busy || draft.size === 0} onClick={() => void save()}>
            Save settings
          </button>
          <span className="st-hint">{draft.size === 0 ? "Nothing changed." : `${draft.size} ${draft.size === 1 ? "change" : "changes"} to save.`}</span>
        </div>
        <Notice note={note} />
      </div>
    </div>
  );
}

// --- the key pair and the test -----------------------------------------------------------

interface CredentialsProps {
  backups: BackupsStatus;
}

function Credentials({ backups }: CredentialsProps): React.ReactNode {
  const { revalidate } = useRevalidator();
  const [keyId, setKeyId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const { credentials } = backups;

  const send = async (path: string, body: PostBody, done: string): Promise<void> => {
    setBusy(true);
    setNote(null);
    const result = await postJson(path, body);
    setBusy(false);
    // The secret leaves the page whatever the answer was.
    setSecret("");
    if (!result.ok) {
      setNote({ tone: "bad", text: result.error });
      return;
    }
    setKeyId("");
    setNote({ tone: "ok", text: done });
    void revalidate();
  };

  const store = (): void => {
    if (keyId.trim() === "" || secret === "") {
      setNote({ tone: "bad", text: "Fill in both the access key id and the secret key." });
      return;
    }
    void send("/api/snapshots/credentials", { accessKeyId: keyId.trim(), secretAccessKey: secret }, "The key pair is saved on this host.");
  };

  return (
    <div className="bk-block">
      <h3 className="bk-h">Key pair for the bucket</h3>
      <div className="panel panel-pad bk-panel">
        <p className="bk-cred-line">
          The key pair is <strong>{credentialsWord(credentials)}</strong>.
        </p>
        {credentials === "env" ? (
          <p className="st-hint">
            The environment sets it, through {ENV_KEY_ID} and {ENV_SECRET}. This page cannot change it.
          </p>
        ) : (
          <div className="bk-cred" role="group" aria-label="Save a key pair">
            <div className="st-field bk-field">
              <label htmlFor="bk-key-id" className="st-label">
                Access key id
              </label>
              <input id="bk-key-id" className="bk-input" type="text" autoComplete="off" autoCapitalize="off" spellCheck={false} value={keyId} onChange={(event) => setKeyId(event.currentTarget.value)} />
            </div>
            <div className="st-field bk-field">
              <label htmlFor="bk-secret" className="st-label">
                Secret key
              </label>
              <input
                id="bk-secret"
                className="bk-input"
                type="password"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                value={secret}
                onChange={(event) => setSecret(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") store();
                }}
              />
              <p className="st-hint">The page writes the pair to this host and never shows it again.</p>
            </div>
            <div className="bk-save">
              <button type="button" className="bk-btn bk-btn-main" disabled={busy} onClick={store}>
                Save the key pair
              </button>
              {credentials === "file" ? (
                <button type="button" className="bk-btn bk-btn-quiet" disabled={busy} onClick={() => void send("/api/snapshots/credentials/clear", {}, "The saved key pair is removed.")}>
                  Remove the saved key
                </button>
              ) : null}
            </div>
          </div>
        )}
        <Notice note={note} />
      </div>
    </div>
  );
}

function BucketTest({ backups }: StateProps): React.ReactNode {
  const { revalidate } = useRevalidator();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);

  const test = async (): Promise<void> => {
    setBusy(true);
    setNote(null);
    const result = await postJson("/api/snapshots/check", {});
    setBusy(false);
    if (!result.ok) {
      setNote({ tone: "bad", text: result.error });
      return;
    }
    void revalidate();
    setNote({ tone: "ok", text: result.count === null ? "The bucket works." : `The bucket works. It lists ${result.count} ${result.count === 1 ? "object" : "objects"}.` });
  };

  return (
    <div className="bk-block">
      <h3 className="bk-h">Test the bucket</h3>
      <div className="panel panel-pad bk-panel">
        <p className="st-hint">Lists the bucket, then writes and deletes one small test object. It uses the saved settings.</p>
        <div className="bk-save">
          <button type="button" className="bk-btn bk-btn-quiet" disabled={busy || !backups.remoteConfigured} onClick={() => void test()}>
            {busy ? "Testing…" : "Test the bucket"}
          </button>
          {backups.remoteConfigured ? null : <span className="st-hint">Set the endpoint and the bucket first.</span>}
        </div>
        <Notice note={note} />
      </div>
    </div>
  );
}

function EnvHelp({ backups }: StateProps): React.ReactNode {
  return (
    <Fold summary="Set these with environment variables">
      <p className="st-hint">
        Put the lines in <code className="inline-code">{backups.envFile}</code>. The timer and this page read that file. Restart the web service after a change. An environment value wins over this page.
      </p>
      <dl className="bk-env">
        {ALL_FIELDS.map((field) => (
          <div key={field.wire}>
            <dt>
              <code>{envName(field.wire)}</code>
            </dt>
            <dd>{field.hint}</dd>
          </div>
        ))}
        <div>
          <dt>
            <code>{ENV_KEY_ID}</code>
          </dt>
          <dd>The access key id of the bucket.</dd>
        </div>
        <div>
          <dt>
            <code>{ENV_SECRET}</code>
          </dt>
          <dd>The secret key of the bucket.</dd>
        </div>
      </dl>
    </Fold>
  );
}

// --- the section -------------------------------------------------------------------------

export function Backups({ backups }: StateProps): React.ReactNode {
  return (
    <Section title="Backups" id="backups">
      <div className="bk">
        <Problems problems={backups.problems} />
        <div className="bk-grid">
          <div className="bk-col">
            <div className="bk-block">
              <h3 className="bk-h">State</h3>
              <div className="panel panel-pad bk-panel">
                <StateLines backups={backups} />
                <RunButton backups={backups} />
              </div>
            </div>
            <SnapshotList backups={backups} />
            <BucketTest backups={backups} />
            <EnvHelp backups={backups} />
          </div>
          <div className="bk-col">
            <SettingsForm backups={backups} />
            <Credentials backups={backups} />
          </div>
        </div>
      </div>
    </Section>
  );
}
