/** Small shared pieces: sections, status words, times, folds, chips. */

import { useClock } from "../lib/clock.tsx";
import { relativeDate, relativeTime } from "../lib/format.ts";
import type { Tone } from "../lib/tone.ts";

interface StatusProps {
  tone: Tone;
  label: string;
}

/**
 * Uppercase Cinzel with its numbers in the body face: the Cinzel 1 reads as
 * an I, so "overdue 1 d" would read "OVERDUE I D".
 */
interface WordProps {
  text: string;
}

export function Word({ text }: WordProps): React.ReactNode {
  return text.split(/(\d+)/u).map((part, index) => (/^\d+$/u.test(part) ? <span key={`${index}`} className="num">{part}</span> : part));
}

/** A square in the state colour and the state in words: the state of a run or a ritual. */
export function Status({ tone, label }: StatusProps): React.ReactNode {
  return (
    <span className={`status tone-${tone}`}>
      <span className="status-dot" aria-hidden="true" />
      <Word text={label} />
    </span>
  );
}

interface TimeProps {
  iso: string | null;
}

/** A relative time with the absolute ISO time on hover. */
export function Time({ iso }: TimeProps): React.ReactNode {
  const { now } = useClock();
  if (iso === null) return <span className="text-muted">never</span>;
  return (
    <time dateTime={iso} title={iso}>
      {relativeTime(iso, now)}
    </time>
  );
}

/** A YYYY-MM-DD date relative to the host's today. */
export function DateLabel({ iso }: TimeProps): React.ReactNode {
  const { today } = useClock();
  if (iso === null) return <span className="text-muted">none</span>;
  return (
    <time dateTime={iso} title={iso}>
      {relativeDate(iso, today)}
    </time>
  );
}

interface SectionProps {
  title: string;
  id?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}

interface SectHeadProps {
  title: string;
  aside?: React.ReactNode;
}

/** A section label between two rules that end in the small square tick of a D2 panel. */
export function SectHead({ title, aside }: SectHeadProps): React.ReactNode {
  return (
    <header className="sect">
      <span className="sect-rule sect-rule-start" aria-hidden="true" />
      <h2 className="label">{title}</h2>
      <span className="sect-rule" aria-hidden="true" />
      {aside === undefined ? null : <div className="sect-aside">{aside}</div>}
    </header>
  );
}

/** A titled part of a page: the section label, then its content. */
export function Section({ title, id, aside, children }: SectionProps): React.ReactNode {
  return (
    <section id={id} className="section">
      <SectHead title={title} aside={aside} />
      {children}
    </section>
  );
}

interface FoldProps {
  summary: React.ReactNode;
  id?: string;
  /** Open on the first render, for a link that points into the fold. */
  open?: boolean;
  children: React.ReactNode;
}

/** Detail that most visits do not need, closed until asked for. */
export function Fold({ summary, id, open = false, children }: FoldProps): React.ReactNode {
  return (
    <details id={id} className="fold scroll-mt-20" open={open}>
      <summary>{summary}</summary>
      <div className="fold-body">{children}</div>
    </details>
  );
}

interface EmptyProps {
  children: React.ReactNode;
}

export function Empty({ children }: EmptyProps): React.ReactNode {
  return <p className="empty">{children}</p>;
}

interface ChipsProps {
  items: readonly string[];
  none: string;
}

export function Chips({ items, none }: ChipsProps): React.ReactNode {
  if (items.length === 0) return <span className="text-muted">{none}</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <code key={item} className="chip">
          {item}
        </code>
      ))}
    </span>
  );
}

export interface Fact {
  label: string;
  value: React.ReactNode;
}

interface FactsProps {
  facts: readonly Fact[];
}

export function Facts({ facts }: FactsProps): React.ReactNode {
  return (
    <dl className="facts">
      {facts.map((fact) => (
        <div key={fact.label} className="contents">
          <dt>{fact.label}</dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

interface CrumbsProps {
  children: React.ReactNode;
}

/** The path back up, above a page title. */
export function Crumbs({ children }: CrumbsProps): React.ReactNode {
  return <p className="crumbs">{children}</p>;
}
