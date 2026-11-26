/**
 * The words of the machine pages (0.143.0): one word per thing, each with a
 * one-line plain definition. Headings, column names, help text and the
 * "What do these words mean?" list take their words from here, so a rename
 * is one edit. Pure.
 */

export interface Term {
  word: string;
  plural: string;
  definition: string;
}

export const TERMS = {
  machine: { word: "machine", plural: "machines", definition: "a computer that runs darius" },
  workspace: { word: "workspace", plural: "workspaces", definition: "a project that darius tracks" },
  ritual: { word: "ritual", plural: "rituals", definition: "recurring work that darius starts by itself, on a schedule" },
  djinn: { word: "djinn", plural: "djinns", definition: "the unattended session darius starts to perform a ritual" },
  run: { word: "run", plural: "runs", definition: "one execution of a ritual" },
  vigil: { word: "vigil", plural: "vigils", definition: "a one-time check that waits for a date or an event" },
  candle: { word: "candle", plural: "candles", definition: "a problem that needs your decision" },
  finding: { word: "finding", plural: "findings", definition: "an item a run reported, kept until it is fixed or closed" },
  copy: { word: "copy", plural: "copies", definition: "a workspace this machine can show but does not run" },
  sandboxCheck: { word: "sandbox check", plural: "sandbox checks", definition: "a test that the run sandbox on this machine works" },
  late: { word: "late", plural: "late", definition: "its due time has passed and it has not run" },
} as const satisfies Record<string, Term>;

export type TermKey = keyof typeof TERMS;

/** "1 ritual", "11 rituals". */
export function termCount(key: TermKey, count: number): string {
  const term = TERMS[key];
  return `${String(count)} ${count === 1 ? term.word : term.plural}`;
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A definition in three pieces, so a page can set the defined word apart: "A ", "vigil", " is a one-time check ...". */
export interface DefinitionPieces {
  lead: string;
  word: string;
  rest: string;
}

export function definitionPieces(key: TermKey): DefinitionPieces {
  const term = TERMS[key];
  return { lead: `${capital(/^[aeiou]/u.test(term.word) ? "an" : "a")} `, word: term.word, rest: ` is ${term.definition}.` };
}

/** "A vigil is a one-time check that waits for a date or an event." */
export function definitionLine(key: TermKey): string {
  const { lead, word, rest } = definitionPieces(key);
  return `${lead}${word}${rest}`;
}

/** The state words of the machine lists: one word per state, whatever the run page calls it. */
export const STATE_WORDS = {
  /** A held run, or a closed one that asks a question nobody answered: a person must answer. */
  waits: "waits for your answer",
  /** A ritual with nothing to say. */
  onSchedule: "on schedule",
  running: "running",
  late: TERMS.late.word,
  failed: "failed",
} as const;

/** The headings, column names and labels of the machine pages, built from the terms. */
export const LABELS = {
  needsLook: "Needs a look",
  ritualsLook: `${capital(TERMS.ritual.plural)} that need a look`,
  thisMachine: "The machine itself",
  nothingHere: "Nothing needs a look here.",
  workspacesItRuns: `${capital(TERMS.workspace.plural)} it runs`,
  runsHere: "Runs here",
  ritualsHere: `${capital(TERMS.ritual.plural)} that darius starts here`,
  onSchedule: capital(STATE_WORDS.onSchedule),
  /** The order note of the On schedule list. */
  onScheduleOrder: "next due first",
  columnHealth: "Health",
  columnWorkspace: capital(TERMS.workspace.word),
  columnWhy: "Why",
  columnRituals: capital(TERMS.ritual.plural),
  columnRitual: capital(TERMS.ritual.word),
  columnLastRun: "Last run",
  columnNext: "Next",
  columnOpenRuns: "Open runs",
  /** The rituals of a workspace header, and the column of the Workspaces page. */
  ritualsDarius: `${capital(TERMS.ritual.plural)} darius starts`,
  sandboxCheck: capital(TERMS.sandboxCheck.word),
  lastActivity: "Last activity",
  load: "Load (1, 5, 15 min)",
  loadTitle: "How many processes wait for the processor, on average over the last 1, 5 and 15 minutes. Above the number of cores, the machine is busy.",
  noRunYet: "no run yet",
  termsSummary: "What do these words mean?",
} as const;

/** The terms the Machines page and a machine page use, in reading order. */
export const MACHINE_PAGE_TERMS: readonly TermKey[] = ["machine", "workspace", "copy", "ritual", "djinn", "run", "late", "vigil", "candle", "finding", "sandboxCheck"];
