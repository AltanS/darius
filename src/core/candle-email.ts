/**
 * The candle mail (0.130.0; docs/concept.md, "Candles", "Email"). One mail per
 * ledger line that opened or raised candles, sent on the email channel by
 * src/core/alerts.ts. This file says what the mail holds; alerts.ts decides
 * when it goes and records the send.
 *
 * WHAT IT HOLDS. Per candle: title, severity, target, and whether it was
 * raised. Per mail: the project, the source (the ritual, or the `source` of a
 * `candle.lit` line), the links when `web_url` is set, and a footer that says
 * why the reader gets it. Never a candle body and never a `detail`. Push keeps
 * its own short wording in alerts.ts: a phone notice must stay short.
 *
 * LAYOUT. A header line, one lead line with the count and the project, then
 * one group per severity that has candles, worst first (SEVERITIES), with
 * the items of a group sorted by key. At most CANDLE_MAIL_MAX items; the rest
 * is one line "and N more in darius". The HTML has the same content, with a
 * link per item to its candle page; the text leaves those out.
 *
 * STABLE BYTES. A provider may answer 409 when the same Idempotency-Key comes
 * with another body. The mail is built from the facts of the ledger line and
 * the host's settings only. Nothing reads the clock, and every order is fixed
 * with plain code-unit comparison, never a locale.
 *
 * THE SCRUB. Every text passes `scrubReportText` (src/core/report-email.ts):
 * the token, the settings' addresses and the resolved recipients (in any
 * case, also with `%40`) and the provider's url. Then it is one line of at most
 * LINE_MAX characters, the cut the old text mail had.
 *
 * THE HTML. Inline styles only. No image, no script, no web font, no remote
 * resource. Square corners everywhere, and no left accent border. Every text
 * is escaped, and an href is built only from `web_url` and an encoded path.
 */

import { webLink, type EmailMessage, type EmailSettings } from "./email.ts";
import { escapeHtml, scrubReportText } from "./report-email.ts";
import { SEVERITIES, type Severity } from "./result.ts";

/** Most candles a mail lists; the rest is a count. A digest of a big scan stays readable and bounded. */
export const CANDLE_MAIL_MAX = 50;
const SUBJECT_MAX = 200;
/** The cut of one line, as the old text mail had it (src/core/redact.ts). */
const LINE_MAX = 300;

/** One candle of the mail. */
export interface CandleMailItem {
  key: string;
  title: string;
  severity: Severity;
  target?: string;
  /** The line raised it to a higher severity; otherwise it is new or lit again. */
  isRaised: boolean;
}

/** The facts of one candle mail, all fixed once the ledger line is written. */
export interface CandleMailFacts {
  project: string;
  /** The ritual slug, or the `source` of a `candle.lit` line. */
  source: string;
  /** The footer line that says where to turn the mail off. */
  turnOff: string;
  items: CandleMailItem[];
}

/** The web app path of a project's candle list, or of one candle. The app builds the same shape (web/app/lib/paths.ts). */
export function candlePath(project: string, key?: string): string {
  const base = `/w/${encodeURIComponent(project)}/candles`;
  return key === undefined ? base : `${base}/${encodeURIComponent(key)}`;
}

/** The footer line that says where a candle notice of `source` is turned off. */
export function turnOffText(source: string, ritual: string | undefined): string {
  if (ritual !== undefined) return `Turn it off: candle_deliver on the ritual ${ritual}.`;
  if (source.startsWith("vigil:")) return `Turn it off: candle_deliver on the vigil ${source.slice("vigil:".length)}.`;
  return "Turn it off: the --deliver list of the darius candle light call that lit it.";
}

// --- the order -------------------------------------------------------------------------

function byKey(a: CandleMailItem, b: CandleMailItem): number {
  if (a.key === b.key) return 0;
  return a.key < b.key ? -1 : 1;
}

interface Group {
  severity: Severity;
  /** Every candle of this severity. */
  total: number;
  /** The ones the mail lists, after the cap. */
  shown: CandleMailItem[];
}

interface Layout {
  groups: Group[];
  /** Candles past the cap. */
  more: number;
}

/** The groups, worst first, items by key, at most CANDLE_MAIL_MAX items in all. An empty group is left out. */
function layoutOf(items: readonly CandleMailItem[]): Layout {
  let room = CANDLE_MAIL_MAX;
  const groups: Group[] = [];
  for (const severity of SEVERITIES) {
    const all = items.filter((item) => item.severity === severity).toSorted(byKey);
    if (all.length === 0) continue;
    const shown = all.slice(0, Math.max(room, 0));
    room -= shown.length;
    groups.push({ severity, total: all.length, shown });
  }
  const listed = groups.reduce((sum, group) => sum + group.shown.length, 0);
  return { groups: groups.filter((group) => group.shown.length > 0), more: items.length - listed };
}

// --- the words -------------------------------------------------------------------------

function capitalized(word: string): string {
  return `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`;
}

function plural(count: number, word: string): string {
  return `${String(count)} ${word}${count === 1 ? "" : "s"}`;
}

/** The count of each severity present, worst first: "3 critical, 5 high". */
function countsText(items: readonly CandleMailItem[]): string {
  return SEVERITIES.flatMap((severity) => {
    const count = items.filter((item) => item.severity === severity).length;
    return count === 0 ? [] : [`${String(count)} ${severity}`];
  }).join(", ");
}

/** The worst severity present, with its count: "3 critical". */
function worstText(items: readonly CandleMailItem[]): string {
  const worst = SEVERITIES.find((severity) => items.some((item) => item.severity === severity));
  return worst === undefined ? "" : `${String(items.filter((item) => item.severity === worst).length)} ${worst}`;
}

/**
 * The subject before the scrub: `[<project>] <source>: 12 candles, 3 critical`,
 * or for one candle `[<project>] <severity>: <title>` (`, raised` after the
 * severity when it was raised). Also the title of the alert, so a failed line
 * names the mail.
 */
export function candleMailSubject(facts: CandleMailFacts): string {
  const [only] = facts.items;
  if (facts.items.length === 1 && only !== undefined) return `[${facts.project}] ${only.severity}${only.isRaised ? ", raised" : ""}: ${only.title}`;
  return `[${facts.project}] ${facts.source}: ${plural(facts.items.length, "candle")}, ${worstText(facts.items)}`;
}

/** The lead line before the scrub: the count and the project. Also the body of the alert. */
export function candleMailLead(facts: CandleMailFacts): string {
  const [only] = facts.items;
  if (facts.items.length === 1 && only !== undefined) {
    if (only.isRaised) return `A candle in ${facts.project} was raised to ${only.severity}, from ${facts.source}.`;
    return `A ${only.severity} candle was lit in ${facts.project}, from ${facts.source}.`;
  }
  return `${plural(facts.items.length, "candle")} in ${facts.project}, from ${facts.source}: ${countsText(facts.items)}.`;
}

const WHY = (project: string): string => `You get this because ${project} names you in its .darius.toml, or this host's email.json does.`;

// --- the clean texts -------------------------------------------------------------------

/** One text as it goes out: scrubbed, one line, capped. */
function cleaner(settings: EmailSettings, recipients: readonly string[]): (text: string, max?: number) => string {
  return (text, max = LINE_MAX) => {
    const line = scrubReportText(text, settings, recipients).replaceAll(/[\p{Cc}\s]+/gu, " ").trim();
    return line.length > max ? `${line.slice(0, max - 3)}...` : line;
  };
}

interface CleanItem {
  title: string;
  target?: string;
  isRaised: boolean;
  link?: string;
}

interface CleanGroup {
  severity: Severity;
  heading: string;
  items: CleanItem[];
}

/** Every text of the mail after the scrub, and the links. Both bodies render from this, so they cannot drift. */
interface CleanMail {
  subject: string;
  header: string;
  lead: string;
  groups: CleanGroup[];
  more: string | null;
  listLink?: string;
  listLabel: string;
  why: string;
  turnOff: string;
}

function cleanMail(settings: EmailSettings, facts: CandleMailFacts, recipients: readonly string[]): CleanMail {
  const clean = cleaner(settings, recipients);
  const layout = layoutOf(facts.items);
  const groups = layout.groups.map((group) => ({
    severity: group.severity,
    heading: `${capitalized(group.severity)} (${String(group.total)})`,
    items: group.shown.map((item) => {
      const out: CleanItem = { title: clean(item.title), isRaised: item.isRaised };
      if (item.target !== undefined) out.target = clean(item.target);
      const link = webLink(settings, candlePath(facts.project, item.key));
      if (link !== undefined) out.link = link;
      return out;
    }),
  }));
  const mail: CleanMail = {
    subject: clean(candleMailSubject(facts), SUBJECT_MAX),
    header: clean(`darius, ${facts.project}`),
    lead: clean(candleMailLead(facts)),
    groups,
    more: layout.more > 0 ? `and ${String(layout.more)} more in darius` : null,
    listLabel: clean(`All candles in ${facts.project}`),
    why: clean(WHY(facts.project)),
    turnOff: clean(facts.turnOff),
  };
  const listLink = webLink(settings, candlePath(facts.project));
  if (listLink !== undefined) mail.listLink = listLink;
  return mail;
}

// --- the text body ---------------------------------------------------------------------

function candleText(mail: CleanMail): string {
  const lines = [mail.header, "", mail.lead];
  for (const group of mail.groups) {
    lines.push("", group.heading);
    for (const item of group.items) {
      lines.push(`- ${item.title}${item.isRaised ? " (raised)" : ""}`);
      if (item.target !== undefined) lines.push(`    ${item.target}`);
    }
  }
  if (mail.more !== null) lines.push("", mail.more);
  if (mail.listLink !== undefined) lines.push("", `${mail.listLabel}: ${mail.listLink}`);
  lines.push("", "-- ", mail.why, mail.turnOff);
  return `${lines.join("\n")}\n`;
}

// --- the HTML body ---------------------------------------------------------------------

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const INK = "#1f2328";
const QUIET = "#59636e";
const RULE = "#d0d7de";
const LINK = "#0969da";

/** One colour per severity, dark enough on white and still readable when a client inverts the mail. */
const SEVERITY_COLOR = {
  critical: "#b42318",
  high: "#c2410c",
  medium: "#9a6700",
  low: "#0969da",
  info: "#59636e",
} as const satisfies Record<Severity, string>;

const STYLE = {
  body: "margin:0;padding:0;background-color:#f6f8fa;",
  outer: "background-color:#f6f8fa;padding:16px 8px;",
  card: `max-width:640px;margin:0 auto;background-color:#ffffff;border:1px solid ${RULE};padding:20px;font-family:${FONT};font-size:15px;line-height:1.5;color:${INK};`,
  header: `margin:0 0 4px 0;font-size:13px;color:${QUIET};`,
  lead: `margin:0 0 8px 0;font-size:17px;font-weight:600;line-height:1.35;color:${INK};`,
  item: "padding:8px 0;border-top:1px solid #e6e8eb;",
  title: "font-weight:600;word-break:break-word;",
  link: `color:${LINK};text-decoration:underline;`,
  target: `font-family:${MONO};font-size:13px;color:${QUIET};word-break:break-all;margin-top:2px;`,
  raised: `display:inline-block;margin-left:6px;padding:0 5px;border:1px solid ${QUIET};font-size:11px;font-weight:600;line-height:1.6;color:${QUIET};vertical-align:1px;`,
  more: `margin:16px 0 0 0;color:${QUIET};`,
  footer: `margin-top:20px;padding-top:12px;border-top:1px solid ${RULE};font-size:13px;color:${QUIET};`,
} as const;

function headingStyle(severity: Severity): string {
  return `margin:20px 0 4px 0;font-size:14px;font-weight:700;color:${SEVERITY_COLOR[severity]};`;
}

function anchor(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="${STYLE.link}">${escapeHtml(label)}</a>`;
}

function itemHtml(item: CleanItem): string {
  const title = item.link === undefined ? escapeHtml(item.title) : anchor(item.link, item.title);
  const raised = item.isRaised ? `<span style="${STYLE.raised}">raised</span>` : "";
  const target = item.target === undefined ? "" : `<div style="${STYLE.target}">${escapeHtml(item.target)}</div>`;
  return `<div style="${STYLE.item}"><div style="${STYLE.title}">${title}${raised}</div>${target}</div>`;
}

function candleHtml(mail: CleanMail): string {
  const parts = [`<p style="${STYLE.header}">${escapeHtml(mail.header)}</p>`, `<p style="${STYLE.lead}">${escapeHtml(mail.lead)}</p>`];
  for (const group of mail.groups) {
    parts.push(`<h2 style="${headingStyle(group.severity)}">${escapeHtml(group.heading)}</h2>`, ...group.items.map((item) => itemHtml(item)));
  }
  if (mail.more !== null) parts.push(`<p style="${STYLE.more}">${mail.listLink === undefined ? escapeHtml(mail.more) : anchor(mail.listLink, mail.more)}</p>`);
  const list = mail.listLink === undefined ? [] : [anchor(mail.listLink, mail.listLabel)];
  parts.push(`<div style="${STYLE.footer}">${[...list, escapeHtml(mail.why), escapeHtml(mail.turnOff)].join("<br>")}</div>`);
  const head = `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(mail.subject)}</title></head>`;
  return `<!doctype html><html>${head}<body style="${STYLE.body}"><div style="${STYLE.outer}"><div style="${STYLE.card}">\n${parts.join("\n")}\n</div></div></body></html>`;
}

// --- the message -----------------------------------------------------------------------

/**
 * The mail of one candle notice, the same bytes for the same facts, settings
 * and recipients. `html` only when the settings allow it. `recipients` are the
 * resolved list, taken out of the text as the settings' addresses are.
 */
export function candleMessage(settings: EmailSettings, facts: CandleMailFacts, key: string, recipients: readonly string[] = []): EmailMessage {
  const mail = cleanMail(settings, facts, recipients);
  const message: EmailMessage = { key, subject: mail.subject, text: candleText(mail) };
  if (settings.html !== false) message.html = candleHtml(mail);
  return message;
}

// --- the sample ------------------------------------------------------------------------

const SAMPLE_ITEMS: readonly CandleMailItem[] = [
  { key: "cve-2026-0001", title: "CVE-2026-0001 in shop: example-lib 2.8.0, fix 2.9.1", severity: "critical", target: "shop/composer.lock", isRaised: false },
  { key: "cve-2026-0002", title: "CVE-2026-0002 in api: form-parser 4.0.0, fix 4.0.4", severity: "critical", target: "api/pnpm-lock.yaml", isRaised: false },
  { key: "cert-www", title: "The TLS certificate of www.example.com expires in 9 days", severity: "high", target: "www.example.com", isRaised: true },
  { key: "cve-2026-0003", title: "CVE-2026-0003 in worker: xml-reader 4.2.5, fix 5.3.5", severity: "high", target: "worker/pnpm-lock.yaml", isRaised: false },
  { key: "backup-db", title: "The newest backup of the example database is 3 days old", severity: "high", isRaised: false },
  { key: "runtime-worker", title: "worker runs on a runtime version that is out of support", severity: "medium", target: "worker/package.json", isRaised: false },
  { key: "cve-2026-0004", title: "CVE-2026-0004 in docs: md-render 1.1.0, fix 1.1.2", severity: "medium", target: "docs/package-lock.json", isRaised: false },
];

/** The facts of `darius email test`: generic sample candles across three severities. */
export function sampleCandleFacts(host: string): CandleMailFacts {
  return { project: "example", source: `email test on ${host}`, turnOff: "This is a sample. darius email test sent it once.", items: [...SAMPLE_ITEMS] };
}
