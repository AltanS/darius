/**
 * Run reports by email (0.127.0; docs/concept.md, "Ritual reports by email").
 * A ritual with `report_deliver = ["email"]` in its marker gets one mail per
 * complete run: the findings text as written, a short footer, and the same
 * content as minimal HTML. src/core/alerts.ts decides when it goes and records
 * the send; this file says what the mail holds.
 *
 * STABLE BYTES. A provider may answer 409 when the same Idempotency-Key comes
 * with another body, so every try of one report must send the same bytes. The
 * mail is built only from the findings blob and the result blob (both
 * immutable, by hash), the facts of the `run.completed` line and the host's
 * settings. Nothing reads the clock.
 *
 * THE SCRUB. Before anything is rendered, the settings' token (also URL
 * encoded), the settings' addresses (in any case, also with `%40`) and the
 * provider's url (cut to its host name, its path to `/...`) are taken out of
 * the findings, the summary and the footer. The findings and the summary also
 * pass `maskSecrets` (src/core/mask-secrets.ts), which masks obvious key
 * shapes. That is a second line, not a guarantee: a secret in another shape,
 * or another address, stays in the text.
 *
 * THE HTML. The findings go through the web app's markdown parser
 * (src/web/markdown.ts), and each block becomes a few tags with inline styles.
 * Every text is escaped. There are no images, no scripts and no raw HTML. A
 * link is `[label](url)` with an http or https url, and becomes a plain
 * `<a href>`; any other link keeps its label as text and drops the url.
 */

import type { MdBlock, MdLine, MdList } from "../web/api.ts";
import { parseMarkdown } from "../web/markdown.ts";
import { emailStatus, webLink, type EmailMessage, type EmailSettings } from "./email.ts";
import { findMarker } from "./marker.ts";
import { maskSecrets } from "./mask-secrets.ts";
import type { JsonValue, LedgerLine } from "./model.ts";
import { hideUrls } from "./redact.ts";
import { parseResult } from "./result.ts";
import { getBlobText, type Project } from "./store.ts";

/** The facts of one report, all fixed once the run completed. */
export interface ReportFacts {
  project: string;
  slug: string;
  /** The ritual's title, or its slug when it has none. */
  title: string;
  run: string;
  /** The `at` of the `run.completed` line. */
  finished: string;
  /** The findings text as the run wrote it; null when it left none. */
  findings: string | null;
  /** The `summary` of the run's result block; null when there is none. */
  summary: string | null;
  /** A blob the line names is not on this host. The send fails with a reason and no text. */
  isMissing: boolean;
  /** The web app path of the run page. */
  url: string;
}

const SUBJECT_MAX = 200;
const OUTCOME_MAX = 120;
/** A complete run's findings are at most 4000 characters (src/core/result.ts); this only bounds an odd line. */
const FINDINGS_MAX = 16_000;
const NO_FINDINGS = "The run left no findings text.";
const CUT_NOTE = "[cut: the full findings are on the run page]";
/** What `sendAlerts` records when a blob is not here. Quotes no text. */
export const REPORT_MISSING = "the findings or the result of the run are not on this host";
/** What `sendAlerts` records when the mail cannot be built. Quotes no text. */
export const REPORT_UNRENDERED = "the report could not be built";

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

/** The alert key of a run's report: the run id and the word report. */
export function reportKey(run: string): string {
  return `report:${run}`;
}

/** True for the key of a report, `report:<run>`. No other alert key has that shape. */
export function isReportKey(key: string): boolean {
  return /^report:[^:]+$/u.test(key);
}

export function runPagePath(project: string, run: string): string {
  return `/w/${encodeURIComponent(project)}/runs/${encodeURIComponent(run)}`;
}

/**
 * The facts of the report of `line`, a `run.completed` line with outcome
 * complete of a ritual. Null for any other line. `title` comes from the store
 * item when the caller read it.
 */
export function reportFacts(project: Project, line: LedgerLine, title: string | undefined): ReportFacts | null {
  const { run, item } = line;
  if (line.type !== "run.completed" || line.outcome !== "complete" || !isText(run) || !isText(item) || !item.startsWith("ritual/")) return null;
  const slug = item.slice("ritual/".length);
  let isMissing = false;
  let findings: string | null = null;
  if (isText(line.findings_sha)) {
    findings = getBlobText(project, line.findings_sha);
    if (findings === null) isMissing = true;
  }
  let summary: string | null = null;
  if (isText(line.result_sha)) {
    const blob = getBlobText(project, line.result_sha);
    const parsed = blob === null ? null : parseResult(blob);
    if (blob === null) isMissing = true;
    if (parsed !== null && "result" in parsed && parsed.result.summary.trim() !== "") summary = parsed.result.summary;
  }
  return { project: project.name, slug, title: title ?? slug, run, finished: line.at, findings, summary, isMissing, url: runPagePath(project.name, run) };
}

// --- the scrub ---------------------------------------------------------------------------

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Each address of the settings as written, the bare part of a named one, and both with `%40`. */
function settingsAddresses(settings: EmailSettings): string[] {
  const found = new Set<string>();
  for (const entry of [settings.from, ...settings.to]) {
    const bare = /<([^<>]+)>/u.exec(entry)?.[1];
    for (const address of bare === undefined ? [entry] : [entry, bare]) {
      found.add(address);
      found.add(address.replace("@", "%40"));
    }
  }
  // The longest first, so a named address goes whole before its bare part.
  return [...found].toSorted((a, b) => b.length - a.length);
}

/** `text` with the settings' token, addresses and provider url taken out. Keeps lines and length. */
export function scrubReportText(text: string, settings: EmailSettings): string {
  let out = text;
  for (const token of [settings.token, encodeURIComponent(settings.token)]) out = out.replaceAll(token, "[token]");
  for (const address of settingsAddresses(settings)) out = out.replace(new RegExp(escapeRegExp(address), "giu"), "[address]");
  return hideUrls(out, [settings.url]);
}

/** One line: control characters and runs of blanks become one space, then capped. */
function capLine(text: string, max: number): string {
  const line = text.replaceAll(/[\p{Cc}\s]+/gu, " ").trim();
  return line.length > max ? `${line.slice(0, max - 3)}...` : line;
}

// --- the message --------------------------------------------------------------------------

function ritualName(facts: ReportFacts): string {
  return facts.title === facts.slug ? facts.slug : `${facts.title} (${facts.slug})`;
}

/** The findings as they go out: scrubbed, masked, line ends unified, trailing blanks off, capped. Null for none. */
function cleanFindings(facts: ReportFacts, settings: EmailSettings): string | null {
  if (facts.findings === null || facts.findings.trim() === "") return null;
  const text = maskSecrets(scrubReportText(facts.findings.replaceAll(/\r\n?/gu, "\n"), settings)).trimEnd();
  return text.length > FINDINGS_MAX ? `${text.slice(0, FINDINGS_MAX)}\n\n${CUT_NOTE}` : text;
}

/** The subject: `[<project>] <ritual>: <outcome>`, where the outcome is the result's summary or "complete". */
export function reportSubject(facts: ReportFacts, settings: EmailSettings): string {
  const summary = facts.summary === null ? "" : capLine(maskSecrets(scrubReportText(facts.summary, settings)), OUTCOME_MAX);
  const outcome = summary === "" ? "complete" : summary;
  return capLine(scrubReportText(`[${facts.project}] ${facts.title}: ${outcome}`, settings), SUBJECT_MAX);
}

interface Footer {
  lines: string[];
  link?: string;
}

function footerOf(facts: ReportFacts, settings: EmailSettings): Footer {
  const lines = [`Project: ${facts.project}`, `Ritual: ${ritualName(facts)}`, `Run: ${facts.run}`, `Finished: ${facts.finished}`].map((line) => capLine(scrubReportText(line, settings), SUBJECT_MAX));
  const link = webLink(settings, facts.url);
  return link === undefined ? { lines } : { lines, link };
}

/**
 * The mail of one report, the same bytes for the same facts and settings.
 * Throws REPORT_MISSING when a blob the line names is not on this host.
 */
export function reportMessage(settings: EmailSettings, facts: ReportFacts, key: string): EmailMessage {
  if (facts.isMissing) throw new Error(REPORT_MISSING);
  const findings = cleanFindings(facts, settings);
  const footer = footerOf(facts, settings);
  const footerText = [...footer.lines, ...(footer.link === undefined ? [] : [`Link: ${footer.link}`])].join("\n");
  const text = `${findings ?? NO_FINDINGS}\n\n-- \n${footerText}\n`;
  const message: EmailMessage = { key, subject: reportSubject(facts, settings), text };
  if (settings.html !== false) message.html = reportHtml(findings, footer);
  return message;
}

// --- the HTML -----------------------------------------------------------------------------

const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const STYLE = {
  body: "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1f2328;margin:0;padding:16px;",
  p: "margin:0 0 12px 0;",
  list: "margin:0 0 12px 0;padding-left:24px;",
  nested: "margin-left:20px;",
  code: `font-family:${MONO};font-size:13px;background:#f3f4f6;padding:1px 4px;`,
  pre: `font-family:${MONO};font-size:13px;background:#f3f4f6;padding:12px;margin:0 0 12px 0;white-space:pre-wrap;word-break:break-word;`,
  table: "border-collapse:collapse;margin:0 0 12px 0;",
  cell: "border:1px solid #d0d7de;padding:4px 8px;text-align:left;vertical-align:top;",
  link: "color:#0969da;",
  footer: "margin-top:24px;padding-top:12px;border-top:1px solid #d0d7de;font-size:13px;color:#59636e;",
} as const;
const HEADING_SIZES = [22, 19, 17, 15, 15, 15] as const;
const CHECK_TEXT = { done: "[x]", open: "[ ]", doing: "[~]", blocked: "[!]", skipped: "[-]" } as const;
const LINK = /\[([^\]\n]+)\]\(([^()\s]+)\)/gu;

export function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function isWebUrl(text: string): boolean {
  try {
    const { protocol } = new URL(text);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

function anchor(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="${STYLE.link}">${escapeHtml(label)}</a>`;
}

/** Plain text with `[label](url)` links: an http or https url becomes an anchor, any other keeps the label only. */
function textHtml(text: string): string {
  let out = "";
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    out += escapeHtml(text.slice(last, match.index));
    const label = match[1] ?? "";
    const target = match[2] ?? "";
    out += isWebUrl(target) ? anchor(target, label) : escapeHtml(label);
    last = match.index + match[0].length;
  }
  return out + escapeHtml(text.slice(last));
}

function lineHtml(line: MdLine): string {
  return line
    .map((span) => {
      if (span.kind === "code") return `<code style="${STYLE.code}">${escapeHtml(span.text)}</code>`;
      if (span.kind === "bold") return `<strong>${textHtml(span.text)}</strong>`;
      if (span.kind === "italic") return `<em>${textHtml(span.text)}</em>`;
      return textHtml(span.text);
    })
    .join("");
}

function listHtml(block: MdList): string {
  const tag = block.ordered ? "ol" : "ul";
  const start = block.ordered && block.start !== 1 ? ` start="${String(block.start)}"` : "";
  const items = block.items.map((item, index) => {
    const check = block.checks?.[index];
    const box = check === undefined || check === null ? "" : `${CHECK_TEXT[check]} `;
    const style = block.nested?.[index] === true ? ` style="${STYLE.nested}"` : "";
    return `<li${style}>${escapeHtml(box)}${lineHtml(item)}</li>`;
  });
  return `<${tag}${start} style="${STYLE.list}">${items.join("")}</${tag}>`;
}

function blockHtml(block: MdBlock): string {
  switch (block.kind) {
    case "heading": {
      const level = Math.min(Math.max(block.level, 1), 6);
      const size = HEADING_SIZES[level - 1] ?? 15;
      return `<h${String(level)} style="margin:16px 0 8px 0;font-size:${String(size)}px;line-height:1.3;">${lineHtml(block.content)}</h${String(level)}>`;
    }
    case "paragraph":
      return `<p style="${STYLE.p}">${block.lines.map((line) => lineHtml(line)).join("<br>")}</p>`;
    case "list":
      return listHtml(block);
    case "table": {
      const head = `<tr>${block.head.map((cell) => `<th style="${STYLE.cell}">${lineHtml(cell)}</th>`).join("")}</tr>`;
      const rows = block.rows.map((row) => `<tr>${row.map((cell) => `<td style="${STYLE.cell}">${lineHtml(cell)}</td>`).join("")}</tr>`);
      return `<table style="${STYLE.table}">${head}${rows.join("")}</table>`;
    }
    case "code":
      return `<pre style="${STYLE.pre}">${escapeHtml(block.text)}</pre>`;
  }
}

/** Markdown to minimal, inline-styled HTML. Every text is escaped. Exported for tests. */
export function markdownHtml(markdown: string): string {
  return parseMarkdown(markdown)
    .map((block) => blockHtml(block))
    .join("\n");
}

function reportHtml(findings: string | null, footer: Footer): string {
  const content = findings === null ? `<p style="${STYLE.p}">${escapeHtml(NO_FINDINGS)}</p>` : markdownHtml(findings);
  const link = footer.link === undefined ? [] : [anchor(footer.link, "Open the run")];
  const foot = [...footer.lines.map((line) => escapeHtml(line)), ...link].join("<br>");
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="${STYLE.body}">${content}\n<div style="${STYLE.footer}">${foot}</div></body></html>`;
}

// --- the sample and the doctor note --------------------------------------------------------

const SAMPLE_FINDINGS = `# Sample report

darius sends this mail to check that your provider takes a report with **text** and *html*.

## What a report holds

- The findings text of a complete run, as written
- [x] A checked box
  - A nested item

| Check | Result |
|---|---|
| Text body | sent |
| HTML body | sent unless \`html\` is false |

\`\`\`
darius email test --report
\`\`\`

[An example link](https://example.com)
`;

/** The facts of `darius email test --report`. The link, when there is one, opens the app. */
export function sampleReportFacts(host: string, now: Date): ReportFacts {
  return {
    project: "example",
    slug: "sample-report",
    title: "Sample report",
    run: "sample",
    finished: now.toISOString(),
    findings: SAMPLE_FINDINGS,
    summary: `a sample report from ${host}`,
    isMissing: false,
    url: "/",
  };
}

/**
 * One line for `darius doctor` when the marker at or above `cwd` asks for
 * report mail and this host has no email channel; null otherwise. Never throws.
 */
export function reportChannelNote(cwd: string): string | null {
  let slugs: string[];
  try {
    slugs = (findMarker(cwd)?.rituals ?? []).filter((ritual) => ritual.reportDeliver?.includes("email") === true).map((ritual) => ritual.slug);
  } catch {
    return null;
  }
  if (slugs.length === 0 || emailStatus().isSetUp) return null;
  const who = slugs.length === 1 ? `ritual ${slugs[0] ?? ""} asks` : `rituals ${slugs.join(", ")} ask`;
  return `${who} for report mail (report_deliver), and this host has no email channel: a run here sends no report. Set it up: darius email set --stdin`;
}
