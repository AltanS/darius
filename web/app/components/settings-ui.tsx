/**
 * The parts every settings tab is made of: a titled card, and rows inside it.
 * A row has its label and a one-line help on the left and the control on the
 * right; on a phone the control drops under the text. A switch row keeps its
 * switch on the right at every width.
 */

import { useId } from "react";

interface CardProps {
  title: string;
  /** One line under the title. */
  intro?: React.ReactNode;
  /** A control at the right end of the title line, such as Back up now. */
  action?: React.ReactNode;
  id?: string;
  children?: React.ReactNode;
}

/** A group of related rows under one title. */
export function SettingsCard({ title, intro, action, id, children }: CardProps): React.ReactNode {
  const titleId = useId();
  return (
    <section id={id} className="st-card" aria-labelledby={titleId}>
      <header className="st-card-head">
        <div className="st-card-text">
          <h2 id={titleId} className="st-card-title">
            {title}
          </h2>
          {intro === undefined ? null : <p className="st-card-intro">{intro}</p>}
        </div>
        {action === undefined ? null : <div className="st-card-action">{action}</div>}
      </header>
      {children}
    </section>
  );
}

interface RowProps {
  label: React.ReactNode;
  /** The id of the control the label names; the label is then a <label>. */
  htmlFor?: string;
  /** The id the label carries, for a control named by aria-labelledby (a switch, a group). */
  labelId?: string;
  help?: React.ReactNode;
  /** Where a value came from, when that is news. Under the help. */
  marker?: React.ReactNode;
  /** A switch: it stays on the right of the text on a phone too. */
  inline?: boolean;
  children: React.ReactNode;
}

/** One setting: what it is on the left, the control on the right. */
export function SettingRow({ label, htmlFor, labelId, help, marker, inline = false, children }: RowProps): React.ReactNode {
  return (
    <div className={inline ? "st-row st-row-inline" : "st-row"}>
      <div className="st-row-text">
        {htmlFor === undefined ? (
          <span id={labelId} className="st-label">
            {label}
          </span>
        ) : (
          <label id={labelId} htmlFor={htmlFor} className="st-label">
            {label}
          </label>
        )}
        {help === undefined ? null : <p className="st-help">{help}</p>}
        {marker}
      </div>
      <div className="st-row-control">{children}</div>
    </div>
  );
}

interface SwitchProps {
  on: boolean;
  /** The id of the text that names the switch. */
  labelledBy: string;
  disabled?: boolean;
  onFlip: () => void;
}

/** An on and off switch, square like the rest of the frame. */
export function Switch({ on, labelledBy, disabled = false, onFlip }: SwitchProps): React.ReactNode {
  return <button type="button" role="switch" aria-checked={on} aria-labelledby={labelledBy} disabled={disabled} className="st-switch" onClick={onFlip} />;
}

interface ChoiceProps<T extends string> {
  labelledBy: string;
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onPick: (value: T) => void;
}

/** One choice of a few words: a row of buttons, one pressed. */
export function Choice<T extends string>({ labelledBy, value, options, onPick }: ChoiceProps<T>): React.ReactNode {
  return (
    <div className="st-seg" role="radiogroup" aria-labelledby={labelledBy}>
      {options.map(([option, text]) => (
        <button key={option} type="button" role="radio" aria-checked={option === value} className={option === value ? "on" : undefined} onClick={() => onPick(option)}>
          {text}
        </button>
      ))}
    </div>
  );
}
