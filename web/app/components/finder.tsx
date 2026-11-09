/**
 * The milestone finder (0.125.0): a dialog over any page of a workspace that
 * finds one of its milestones by id, title or slug. The shell opens it from a
 * button (the top bar of a phone, the sidebar of a desktop), from `/` outside
 * a text field, and from Ctrl+K or Cmd+K. Escape or a tap beside it closes
 * it, and focus goes back to what opened it.
 *
 * It is a native modal `<dialog>`: the page behind it is inert. The input is
 * a combobox over a listbox; the arrows move the selection, Enter opens it.
 * The rows are links, so a tap, a middle click or a long press works as on
 * any other link. The data (`finderOf` in lib/finder.ts) comes with the root
 * loader, so the finder opens at once and works offline from a saved page.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";

import { NavIcon } from "./nav-icons.tsx";
import { StateWord } from "./row.tsx";
import { TitleText } from "./ui.tsx";
import { useClock } from "../lib/clock.tsx";
import { finderSections, opensFinder, type FinderRow } from "../lib/finder.ts";
import { relativeTime } from "../lib/format.ts";
import { milestoneStatusWord } from "../lib/milestones.ts";
import { href } from "../lib/paths.ts";

/** Focus is in a field that takes text: `/` types there and does not open the finder. */
function inTextField(target: Element | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (!(target instanceof HTMLInputElement)) return false;
  return !["button", "checkbox", "radio", "submit", "reset", "range", "color", "file", "image"].includes(target.type);
}

export interface FinderState {
  open: boolean;
  /** Opens the finder; focus comes back to `opener` (else to what had it) on close. */
  show: (opener?: HTMLElement | null) => void;
  hide: () => void;
}

/** The open state of the finder and its keys. `enabled` is false outside a workspace: no key opens it there. */
export function useFinder(enabled: boolean): FinderState {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const show = useCallback((from?: HTMLElement | null) => {
    const active = document.activeElement;
    opener.current = from ?? (active instanceof HTMLElement ? active : null);
    setOpen(true);
  }, []);
  const hide = useCallback(() => {
    setOpen(false);
    const back = opener.current;
    opener.current = null;
    // After the dialog has left the page, or the browser puts focus on the body.
    requestAnimationFrame(() => {
      if (back !== null && back.isConnected) back.focus();
    });
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) return;
      if (!opensFinder(event, inTextField(document.activeElement))) return;
      event.preventDefault();
      if (!open) show();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled, open, show]);
  // Leaving the workspace closes it.
  useEffect(() => {
    if (!enabled) setOpen(false);
  }, [enabled]);
  return { open, show, hide };
}

interface FinderButtonProps {
  finder: FinderState;
  className: string;
  /** The words beside the icon; without them the button is the icon alone and the words are for screen readers. */
  label?: string;
}

/** The button that opens the finder. */
export function FinderButton({ finder, className, label }: FinderButtonProps): React.ReactNode {
  return (
    <button type="button" className={className} aria-haspopup="dialog" aria-expanded={finder.open} onClick={(event) => finder.show(event.currentTarget)}>
      <NavIcon name="search" size={label === undefined ? 20 : 18} className="finder-btn-ico" />
      {label === undefined ? <span className="sr-only">Find a milestone</span> : <span className="finder-btn-text">{label}</span>}
      {label === undefined ? null : (
        <kbd className="finder-btn-key" aria-hidden="true">
          /
        </kbd>
      )}
    </button>
  );
}

interface FinderDialogProps {
  ws: string;
  rows: readonly FinderRow[];
  onClose: () => void;
}

/** The dialog itself; the shell mounts it while the finder is open. */
export function FinderDialog({ ws, rows, onClose }: FinderDialogProps): React.ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const { now } = useClock();
  const ids = useId();
  const sections = useMemo(() => finderSections(rows, query), [rows, query]);
  // One row may be in both short lists; the selection walks the rows as they show.
  const flat = sections.flatMap((section) => section.rows);
  const selected = flat[Math.min(active, flat.length - 1)];
  const optionId = (index: number): string => `${ids}-o${index}`;

  useEffect(() => {
    const node = dialog.current;
    if (node !== null && !node.open) node.showModal();
    input.current?.focus();
  }, []);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, query]);

  const go = (row: FinderRow): void => {
    onClose();
    void navigate(href({ to: "milestone", ws, ref: row.ref }));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (flat.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((Math.min(active, flat.length - 1) + step + flat.length) % flat.length);
      return;
    }
    if (event.key === "Enter" && selected !== undefined) {
      event.preventDefault();
      go(selected);
    }
  };

  let index = -1;
  const listId = `${ids}-list`;
  const inputId = `${ids}-input`;
  const empty = rows.length === 0 ? "This workspace has no open milestones." : `No milestone matches “${query.trim()}”.`;
  return (
    <dialog
      ref={dialog}
      className="finder"
      aria-labelledby={`${ids}-title`}
      onClose={onClose}
      onClick={(event) => {
        // A tap on the backdrop lands on the dialog element itself.
        if (event.target === event.currentTarget) dialog.current?.close();
      }}
    >
      <div className="finder-box">
        <h2 id={`${ids}-title`} className="sr-only">{`Find a milestone in ${ws}`}</h2>
        <div className="finder-field">
          <NavIcon name="search" size={18} className="finder-field-ico" />
          <label htmlFor={inputId} className="sr-only">{`Find a milestone in ${ws}`}</label>
          <input
            ref={input}
            id={inputId}
            className="finder-input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={selected === undefined ? undefined : optionId(Math.min(active, flat.length - 1))}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="go"
            placeholder="Find a milestone"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <button type="button" className="finder-close" onClick={() => dialog.current?.close()}>
            <NavIcon name="close" size={18} />
            <span className="sr-only">Close</span>
          </button>
        </div>
        <div ref={list} id={listId} role="listbox" aria-label="Milestones" className="finder-list">
          {flat.length === 0 ? <p className="finder-empty">{empty}</p> : null}
          {sections.map((section) => {
            const groupId = `${ids}-g-${section.title ?? "hits"}`;
            return (
              <div key={section.title ?? "hits"} role="group" aria-labelledby={section.title === null ? undefined : groupId} aria-label={section.title === null ? "Matches" : undefined} className="finder-group">
                {section.title === null ? null : (
                  <p id={groupId} className="finder-group-title" role="presentation">
                    {section.title}
                  </p>
                )}
                {section.rows.map((row) => {
                  index += 1;
                  const at = index;
                  const on = selected !== undefined && at === Math.min(active, flat.length - 1);
                  return (
                    <Link
                      key={`${section.title ?? "hits"}-${row.ref}`}
                      id={optionId(at)}
                      role="option"
                      aria-selected={on}
                      tabIndex={-1}
                      to={href({ to: "milestone", ws, ref: row.ref })}
                      className={on ? "finder-row on" : "finder-row"}
                      onMouseMove={() => {
                        if (!on) setActive(at);
                      }}
                      onClick={onClose}
                    >
                      <span className="finder-row-id">{row.id}</span>
                      <span className="finder-row-main">
                        <span className="finder-row-title">
                          <TitleText text={row.title} />
                        </span>
                        <span className="finder-row-meta">
                          <StateWord state={milestoneStatusWord(row.status)} />
                          {row.lastActivity === null ? null : <span>{`worked on ${relativeTime(row.lastActivity, now)}`}</span>}
                        </span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>
        <p className="finder-hint" aria-hidden="true">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> to move
          </span>
          <span>
            <kbd>Enter</kbd> to open
          </span>
          <span>
            <kbd>Esc</kbd> to close
          </span>
        </p>
      </div>
    </dialog>
  );
}
