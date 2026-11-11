/**
 * The mail shell (0.131.0): the one frame of every HTML mail darius sends,
 * candle mails (src/core/candle-email.ts) and report mails
 * (src/core/report-email.ts). A header with the logo, the wordmark and the
 * project, the content, and a footer. It also holds the subject prefix.
 *
 * THE THEME is the web app's dark theme (web/app/app.css, `@theme`): the night
 * page, the surface card, parchment text, gold for the wordmark, headings and
 * links, and the app's state tones for the severities (`severityTone` in
 * web/app/lib/result.ts). Every text colour passes WCAG AA on the card. Square
 * corners everywhere, and no left accent border. The app's display font is a
 * web font, so headings use a serif stack that echoes it.
 *
 * MAIL CLIENTS. Tables with `role="presentation"` for the frame, inline styles
 * only, `bgcolor` next to each background, an explicit colour on every text,
 * and the dark colour scheme declared. No flex, grid, position, transform,
 * custom property, web font, background image, script or `<style>`.
 *
 * THE LOGO is the app's emblem as a PNG (web/scripts/mail-logo.ts), on
 * raw.githubusercontent.com, pinned to the tag of this darius version. A mail
 * client renders no inline SVG, Gmail blocks `data:` images, and the provider
 * takes no attachments, so a hosted PNG is the one form that shows. The tag
 * makes the bytes immutable, and the URL depends on VERSION alone, so the
 * mail stays byte-stable. `"logo": false` in `email.json` sends no `<img>`:
 * then no mail client fetches anything. The wordmark is live text either way.
 *
 * THE KIND MARK (0.134.0). The project line under the wordmark starts with the
 * mark of what the mail is about: the candle for a candle mail, the two arrows
 * of a ritual for a run report. The app draws the same strokes
 * (web/app/lib/glyphs.ts), in the same colours; web/scripts/mail-logo.ts
 * renders them as PNGs next to the logo, and they travel the same way. The
 * mark is decoration: `alt=""`, so a client that blocks images shows the
 * words alone, and fixed width and height keep the line in place. It follows
 * the logo setting: `"logo": false` sends neither.
 */

import { VERSION } from "../version.ts";
import type { Severity } from "./result.ts";

/** The public repo that holds the logo. The one place its slug is written. */
export const MAIL_REPO = "AltanS/darius";
/** Every subject darius sends starts with this. */
export const SUBJECT_PREFIX = "[darius] ";
const LOGO_FILE = "assets/email/gem-96.png";
/** The logo is 96 pixels, shown at 48 (2x). */
const LOGO_SIZE = 48;

/** The kind marks a mail can carry. Darius sends no mail of its own for a vigil: a vigil's candles come as a candle mail. */
export type MailMark = "candle" | "ritual";
/** The marks are 16 unit glyphs, rendered at 40 pixels, shown at 20 (2x). */
const MARK_SIZE = 20;
/** The pixels of a mark's PNG. */
export const MARK_PIXELS = MARK_SIZE * 2;
/** The PNG the renderer writes for a mark (web/scripts/mail-logo.ts). */
export function markFile(mark: MailMark): string {
  return `assets/email/${mark}-${String(MARK_PIXELS)}.png`;
}

/** The colour of each mark, as the app draws it: candle `--color-late`, ritual `--color-ritual`. */
export const MARK_COLOR = {
  candle: "#d98b3a",
  ritual: "#4cc0c8",
} as const satisfies Record<MailMark, string>;

function assetUrl(file: string, version: string): string {
  return `https://raw.githubusercontent.com/${MAIL_REPO}/v${version}/${file}`;
}

/** The address of the logo for a darius version: the tag `v<version>` of the public repo. */
export function logoUrl(version: string = VERSION): string {
  return assetUrl(LOGO_FILE, version);
}

/** The address of a kind mark, pinned like the logo. */
export function markUrl(mark: MailMark, version: string = VERSION): string {
  return assetUrl(markFile(mark), version);
}

/** `[darius] <rest>`. The caller caps and scrubs the whole. */
export function prefixedSubject(rest: string): string {
  return `${SUBJECT_PREFIX}${rest}`;
}

export function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

// --- the theme -------------------------------------------------------------------------

/**
 * The colours, each with its token in web/app/app.css and its contrast on the
 * card (`card`, #1f1811).
 */
export const THEME = {
  /** --color-night. */
  page: "#15100b",
  /** --color-surface. */
  card: "#1f1811",
  /** --color-raised: the ground of inline code. */
  raised: "#2a2117",
  /** --color-deep: the ground of a code block. */
  deep: "#100c08",
  /** --color-sand: the border of the card, the dividers, the table cells. */
  rule: "#4a3a27",
  /** --color-parchment, 11.8:1. */
  text: "#e2d3ae",
  /** --color-muted, 5.6:1: targets, the footer, the project line. */
  quiet: "#a38f6b",
  /** --color-gold, 7.3:1: the wordmark, headings, links, the header hairline. */
  gold: "#c8a24e",
  /** --color-gold-hi, 9.8:1: the outlined button. */
  goldHi: "#e2bd66",
} as const;

/** One tone per severity, as the app's `severityTone`: bad, late, gold, idle, and muted for info. */
export const SEVERITY_COLOR = {
  /** --color-bad, 5.4:1. */
  critical: "#e8665a",
  /** --color-late, 6.4:1. */
  high: "#d98b3a",
  /** --color-gold, 7.3:1. */
  medium: "#c8a24e",
  /** --color-idle, 5.3:1. */
  low: "#958d7d",
  /** --color-muted, 5.6:1. */
  info: "#a38f6b",
} as const satisfies Record<Severity, string>;

export const FONT = {
  sans: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
  serif: "Georgia,'Times New Roman',Times,serif",
  mono: "ui-monospace,SFMono-Regular,Menlo,Consolas,'DejaVu Sans Mono',monospace",
} as const;

/** The styles both builders use. */
export const SHELL_STYLE = {
  text: `font-family:${FONT.sans};font-size:15px;line-height:1.5;color:${THEME.text};`,
  link: `color:${THEME.gold};text-decoration:underline;`,
  quiet: `font-family:${FONT.sans};font-size:13px;line-height:1.5;color:${THEME.quiet};`,
  lead: `margin:0 0 4px 0;font-family:${FONT.sans};font-size:18px;font-weight:600;line-height:1.35;color:${THEME.text};`,
} as const;

/** A link in the theme's link colour, underlined. */
export function anchor(href: string, label: string, style: string = SHELL_STYLE.link): string {
  return `<a href="${escapeHtml(href)}" style="${style}">${escapeHtml(label)}</a>`;
}

/** A link drawn as an outlined button: a uniform border on all four sides, square corners. */
export function buttonLink(href: string, label: string): string {
  const cell = `border:1px solid ${THEME.gold};`;
  const link = `display:inline-block;padding:9px 16px;font-family:${FONT.serif};font-size:13px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;line-height:1.2;color:${THEME.goldHi};text-decoration:none;`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 14px 0;"><tr><td style="${cell}">${anchor(href, label, link)}</td></tr></table>`;
}

// --- the frame -------------------------------------------------------------------------

export interface ShellParts {
  /** The subject, for the `<title>`. Already clean. */
  subject: string;
  /** The quiet line under the wordmark. Already clean. */
  project: string;
  /** Hidden text that an inbox shows as the preview. Already clean. */
  preview: string;
  /** The content, as HTML. */
  content: string;
  /** The footer, as HTML. */
  footer: string;
  /** False: no `<img>`, only the wordmark. */
  hasLogo: boolean;
  /** What the mail is about: its mark starts the project line. */
  mark: MailMark;
}

function markHtml(mark: MailMark): string {
  const size = String(MARK_SIZE);
  return `<img src="${escapeHtml(markUrl(mark))}" width="${size}" height="${size}" alt="" style="display:inline-block;vertical-align:middle;margin:0 7px 0 0;border:0;outline:none;text-decoration:none;width:${size}px;height:${size}px;">`;
}

function header(parts: ShellParts): string {
  const wordmark = `<div style="font-family:${FONT.serif};font-size:20px;font-weight:700;line-height:1.1;letter-spacing:0.22em;text-transform:uppercase;color:${THEME.gold};">darius</div>`;
  const mark = parts.hasLogo ? markHtml(parts.mark) : "";
  const project = `<div style="margin-top:4px;${SHELL_STYLE.quiet}">${mark}${escapeHtml(parts.project)}</div>`;
  const logo = parts.hasLogo
    ? `<td width="${String(LOGO_SIZE + 14)}" valign="middle" style="width:${String(LOGO_SIZE + 14)}px;padding:0;"><img src="${escapeHtml(logoUrl())}" width="${String(LOGO_SIZE)}" height="${String(LOGO_SIZE)}" alt="darius" style="display:block;border:0;outline:none;text-decoration:none;width:${String(LOGO_SIZE)}px;height:${String(LOGO_SIZE)}px;"></td>`
    : "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>${logo}<td valign="middle" style="padding:0;">${wordmark}${project}</td></tr></table>`;
}

/**
 * The whole HTML document of a mail: the page, the card at most 640 px wide
 * and fluid below, the header with a gold hairline under it, the content and
 * the footer.
 */
export function mailHtml(parts: ShellParts): string {
  const head = `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${escapeHtml(parts.subject)}</title></head>`;
  const preview = `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${THEME.page};">${escapeHtml(parts.preview)}</div>`;
  const rows = [
    `<tr><td bgcolor="${THEME.card}" style="background-color:${THEME.card};padding:20px 22px 16px 22px;border-bottom:1px solid ${THEME.gold};">${header(parts)}</td></tr>`,
    `<tr><td bgcolor="${THEME.card}" style="background-color:${THEME.card};padding:20px 22px 8px 22px;${SHELL_STYLE.text}">\n${parts.content}\n</td></tr>`,
    `<tr><td bgcolor="${THEME.card}" style="background-color:${THEME.card};padding:8px 22px 22px 22px;"><div style="padding-top:16px;border-top:1px solid ${THEME.rule};${SHELL_STYLE.quiet}">${parts.footer}</div></td></tr>`,
  ];
  const card = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${THEME.card}" style="width:100%;max-width:640px;background-color:${THEME.card};border:1px solid ${THEME.rule};border-collapse:separate;">${rows.join("\n")}</table>`;
  const page = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${THEME.page}" style="width:100%;background-color:${THEME.page};"><tr><td align="center" bgcolor="${THEME.page}" style="background-color:${THEME.page};padding:16px 8px;">${card}</td></tr></table>`;
  return `<!doctype html><html lang="en">${head}<body bgcolor="${THEME.page}" style="margin:0;padding:0;background-color:${THEME.page};color:${THEME.text};">${preview}${page}</body></html>`;
}
