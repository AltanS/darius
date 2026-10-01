/**
 * The backups of one host (0.44.0), on the Backups tab of the settings. The
 * order follows what a reader needs first: what blocks backups, the status
 * with Back up now, the snapshot list, then the settings in three cards
 * (local, the remote copy, the key pair) and the environment help, folded.
 * Everything the person types goes out through `postJson` to the
 * `/api/snapshots/...` endpoints of `darius serve`; the page reads the answer
 * from the loader again after each write. There is no restore button on
 * purpose: a restore overwrites the store, so the page shows the `tar` line
 * and the person runs it by hand.
 *
 * The key pair is write-only. Its inputs start empty, are cleared after a
 * save, and the page never receives the secret. They sit in no <form>, so an
 * early Enter cannot send the secret anywhere but the JSON endpoint.
 */

import { useEffect, useId, useState } from "react";
import { useRevalidator } from "react-router";

import type { BackupRow, BackupsStatus, SettingSource } from "../../../src/web/api.ts";
import { useClock } from "../lib/clock.tsx";
import { ALL_FIELDS, credentialsWord, ENV_KEY_ID, ENV_SECRET, envName, LOCAL_FIELDS, REMOTE_FIELDS, shortSha, sourceWord, type FieldSpec } from "../lib/backup.ts";
import { byteSize, hostDate, momentText } from "../lib/format.ts";
import { postJson, type PostBody } from "../lib/post.ts";
import { NavIcon } from "./nav-icons.tsx";
import { SettingRow, SettingsCard, Switch } from "./settings-ui.tsx";
import { Fold, Status, Time } from "./ui.tsx";

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

interface StateProps {
  backups: BackupsStatus;
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

/** Three lines: the last run, whether one runs now, and the remote copy. */
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
              {last.name === null ? null : <code className="bk-file">{last.name}</code>}
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
        <dt>Remote copy</dt>
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
      <button type="button" className="st-btn st-btn-main" disabled={busy} onClick={() => void press()}>
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

/** Where a copy is: a square in the state colour and a word. Never a kind colour. */
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
      <time dateTime={row.at} title={row.at} className="bk-when">
        {hostDate(row.at, offset) === today ? `Today ${momentText(row.at, today, offset)}` : momentText(row.at, today, offset)}
      </time>
      <span className="bk-size">{byteSize(row.bytes)}</span>
      <span className="bk-files">{row.files === null ? <span className="bk-none">files not known</span> : `${row.files} ${row.files === 1 ? "file" : "files"}`}</span>
      <span className="bk-where">
        <Mark on={row.local} yes="this host" no="not on this host" />
        {row.remote || remoteConfigured ? <Mark on={row.remote} yes="bucket" no="not in the bucket" /> : null}
      </span>
      <p className="bk-meta">
        <code className="bk-name">{row.name}</code>
        {row.sha256 === null ? (
          <span className="bk-none">No checksum on record.</span>
        ) : (
          <span className="bk-sha">
            sha256{" "}
            <button type="button" className="bk-sha-btn" aria-expanded={showSha} onClick={() => setShowSha(!showSha)}>
              <code>{showSha ? row.sha256 : `${shortSha(row.sha256)}…`}</code>
            </button>
          </span>
        )}
      </p>
      <div className="bk-acts">
        {ask === null ? (
          <>
            {row.local ? (
              <button type="button" className="st-btn st-btn-small" disabled={busy} onClick={() => setAsk("local")}>
                Delete here
              </button>
            ) : null}
            {row.remote && remoteConfigured ? (
              <button type="button" className="st-btn st-btn-small" disabled={busy} onClick={() => setAsk("remote")}>
                Delete in bucket
              </button>
            ) : null}
          </>
        ) : (
          <span className="bk-ask" role="group" aria-label="Confirm the delete">
            <span className="bk-ask-q">{ask === "local" ? "Delete from this host?" : "Delete from the bucket?"}</span>
            <button type="button" className="st-btn st-btn-small st-btn-danger" disabled={busy} onClick={() => void remove(ask)}>
              Yes
            </button>
            <button type="button" className="st-btn st-btn-small" disabled={busy} onClick={() => setAsk(null)}>
              No
            </button>
          </span>
        )}
      </div>
      <Notice note={note} />
    </li>
  );
}

function SnapshotList({ backups }: StateProps): React.ReactNode {
  const { snapshots, remoteConfigured, storePath, localBytes } = backups;
  const intro = snapshots.length === 0 ? undefined : `${snapshots.length} ${snapshots.length === 1 ? "snapshot" : "snapshots"}, newest first. This host holds ${byteSize(localBytes)}.`;
  return (
    <SettingsCard title="Snapshots" intro={intro}>
      {snapshots.length === 0 ? (
        <p className="bk-empty">No snapshot yet. Press Back up now.</p>
      ) : (
        <div className="bk-table">
          <p className="bk-thead" aria-hidden="true">
            <span>Made</span>
            <span className="bk-num">Size</span>
            <span className="bk-num">Files</span>
            <span>Where</span>
          </p>
          <ul className="bk-list">
            {snapshots.map((row) => (
              <SnapshotRow key={row.name} row={row} remoteConfigured={remoteConfigured} />
            ))}
          </ul>
        </div>
      )}
      <p className="bk-restore">
        To restore by hand, stop the web service and the timers first. Then run <code className="inline-code">tar -xzf {"<file>"} -C {storePath}</code>. There is no restore button on purpose: a restore overwrites the store.
      </p>
    </SettingsCard>
  );
}

// --- settings ----------------------------------------------------------------------------

type Draft = ReadonlyMap<FieldSpec["key"], string | boolean>;

/** The value of a field as the page shows it: a boolean for a toggle, text otherwise. */
function shown(backups: BackupsStatus, field: FieldSpec): string | boolean {
  const value = backups.settings[field.key].value;
  return field.kind === "toggle" ? value === true : String(value);
}

interface MarkerProps {
  field: FieldSpec;
  source: SettingSource;
  changed: boolean;
  busy: boolean;
  onReset: (field: FieldSpec) => void;
}

/** Where a value came from, only when that is news: a default gets no marker. */
function SourceMark({ field, source, changed, busy, onReset }: MarkerProps): React.ReactNode {
  if (changed) return <p className="st-mark st-mark-draft">Changed, not saved yet.</p>;
  switch (source) {
    case "default":
      return null;
    case "env":
      return (
        <p className="st-mark st-mark-env">
          <NavIcon name="lock" size={14} className="st-mark-icon" />
          <span>
            {sourceWord(source)}: <code>{envName(field.wire)}</code>. Change it where the service starts.
          </span>
        </p>
      );
    case "config":
      return <p className="st-mark st-mark-config">{sourceWord(source)}.</p>;
    case "file":
      return (
        <p className="st-mark st-mark-file">
          {sourceWord(source)}.{" "}
          <button type="button" className="st-link" disabled={busy} onClick={() => onReset(field)}>
            Reset to default
          </button>
        </p>
      );
  }
}

interface FieldProps {
  field: FieldSpec;
  backups: BackupsStatus;
  draft: Draft;
  busy: boolean;
  onChange: (field: FieldSpec, value: string | boolean) => void;
  onReset: (field: FieldSpec) => void;
}

function SettingField({ field, backups, draft, busy, onChange, onReset }: FieldProps): React.ReactNode {
  const { source } = backups.settings[field.key];
  const locked = source === "env";
  const value = draft.get(field.key) ?? shown(backups, field);
  const id = `bk-set-${field.wire}`;
  const marker = <SourceMark field={field} source={source} changed={draft.has(field.key)} busy={busy} onReset={onReset} />;
  if (field.kind === "toggle") {
    return (
      <SettingRow label={field.label} labelId={id} help={field.hint} marker={marker} inline>
        <Switch on={value === true} labelledBy={id} disabled={locked} onFlip={() => onChange(field, value !== true)} />
      </SettingRow>
    );
  }
  return (
    <SettingRow label={field.label} htmlFor={id} help={field.hint} marker={marker}>
      <input
        id={id}
        className={`st-input st-input-${field.width}`}
        type={field.kind === "number" ? "number" : "text"}
        inputMode={field.kind === "number" ? "numeric" : undefined}
        min={field.kind === "number" ? 1 : undefined}
        step={field.kind === "number" ? 1 : undefined}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        disabled={locked}
        value={String(value)}
        onChange={(event) => onChange(field, event.currentTarget.value)}
      />
    </SettingRow>
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

/** The saved remote copy in one line, so a first look tells whether there is one. */
function RemoteSummary({ backups }: StateProps): React.ReactNode {
  const { settings, remoteConfigured } = backups;
  if (!remoteConfigured) return "No remote copy set up. Snapshots stay on this host only.";
  const prefix = settings.prefix.value;
  return (
    <>
      Copies go to bucket <strong className="bk-strong">{settings.bucket.value}</strong> at <code className="bk-code">{settings.endpoint.value}</code>
      {prefix === "" ? "." : (
        <>
          , in the folder <code className="bk-code">{prefix}</code>.
        </>
      )}
    </>
  );
}

function SettingsForm({ backups }: StateProps): React.ReactNode {
  const { revalidate } = useRevalidator();
  const [draft, setDraft] = useState<Draft>(new Map());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const remoteId = useId();

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

  const discard = (): void => {
    setDraft(new Map());
    setNote(null);
  };

  const rows = (fields: readonly FieldSpec[]): React.ReactNode =>
    fields.map((field) => <SettingField key={field.key} field={field} backups={backups} draft={draft} busy={busy} onChange={change} onReset={(target) => void reset(target)} />);

  const unsaved = ALL_FIELDS.filter((field) => draft.has(field.key)).map((field) => field.label);
  const remoteButton = (
    <button type="button" className={backups.remoteConfigured ? "st-btn" : "st-btn st-btn-main"} aria-expanded={remoteOpen} aria-controls={remoteId} onClick={() => setRemoteOpen(!remoteOpen)}>
      {remoteOpen ? "Hide the settings" : backups.remoteConfigured ? "Change" : "Set up a remote copy"}
    </button>
  );

  return (
    <div className="bk-settings">
      <SettingsCard title="Local">{rows(LOCAL_FIELDS)}</SettingsCard>
      <SettingsCard title="Remote copy (S3 bucket)" intro={<RemoteSummary backups={backups} />} action={remoteButton}>
        <div id={remoteId} hidden={!remoteOpen}>
          {rows(REMOTE_FIELDS)}
        </div>
        {backups.remoteConfigured ? <BucketTest /> : null}
      </SettingsCard>
      {unsaved.length === 0 ? (
        <Notice note={note} />
      ) : (
        <div className="bk-savebar" role="region" aria-label="Unsaved settings">
          <div className="bk-savebar-text">
            <p className="bk-savebar-head">
              {unsaved.length === 1 ? "1 change is not saved yet:" : `${unsaved.length} changes are not saved yet:`} {unsaved.join(", ")}.
            </p>
            <Notice note={note} />
          </div>
          <div className="bk-savebar-acts">
            <button type="button" className="st-btn" disabled={busy} onClick={discard}>
              Discard
            </button>
            <button type="button" className="st-btn st-btn-main" disabled={busy} onClick={() => void save()}>
              Save settings
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- the key pair and the test -----------------------------------------------------------

function Credentials({ backups }: StateProps): React.ReactNode {
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

  const intro = (
    <>
      The key pair is <strong className="bk-strong">{credentialsWord(credentials)}</strong>.
    </>
  );
  return (
    <SettingsCard title="Key pair for the bucket" intro={intro}>
      {credentials === "env" ? (
        <p className="st-card-note">
          The environment sets it, through <code className="bk-code">{ENV_KEY_ID}</code> and <code className="bk-code">{ENV_SECRET}</code>. This page cannot change it.
        </p>
      ) : (
        <div role="group" aria-label="Save a key pair">
          <SettingRow label="Access key id" htmlFor="bk-key-id">
            <input id="bk-key-id" className="st-input st-input-long" type="text" autoComplete="off" autoCapitalize="off" spellCheck={false} value={keyId} onChange={(event) => setKeyId(event.currentTarget.value)} />
          </SettingRow>
          <SettingRow label="Secret key" htmlFor="bk-secret" help="The page writes the pair to this host and never shows it again.">
            <input
              id="bk-secret"
              className="st-input st-input-long"
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
          </SettingRow>
          <div className="st-card-foot">
            {credentials === "file" ? (
              <button type="button" className="st-btn" disabled={busy} onClick={() => void send("/api/snapshots/credentials/clear", {}, "The saved key pair is removed.")}>
                Remove the saved key
              </button>
            ) : null}
            <button type="button" className="st-btn st-btn-main" disabled={busy} onClick={store}>
              Save the key pair
            </button>
          </div>
        </div>
      )}
      {note === null ? null : (
        <div className="st-card-foot">
          <Notice note={note} />
        </div>
      )}
    </SettingsCard>
  );
}

/** The bucket check, a row at the end of the remote card. It needs a remote copy set up. */
function BucketTest(): React.ReactNode {
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
    <SettingRow label="Bucket test" help="Lists the bucket, then writes and deletes one small test object. It uses the saved settings." marker={<Notice note={note} />}>
      <button type="button" className="st-btn" disabled={busy} onClick={() => void test()}>
        {busy ? "Testing…" : "Test the bucket"}
      </button>
    </SettingRow>
  );
}

function EnvHelp({ backups }: StateProps): React.ReactNode {
  return (
    <Fold summary="Set these with environment variables">
      <p className="bk-env-lede">
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

// --- the tab -----------------------------------------------------------------------------

export function Backups({ backups }: StateProps): React.ReactNode {
  return (
    <div className="st-body bk">
      <Problems problems={backups.problems} />
      <SettingsCard title="Status" action={<RunButton backups={backups} />}>
        <StateLines backups={backups} />
      </SettingsCard>
      <SnapshotList backups={backups} />
      <SettingsForm backups={backups} />
      <Credentials backups={backups} />
      <EnvHelp backups={backups} />
    </div>
  );
}
