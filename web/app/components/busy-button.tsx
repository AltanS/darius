/**
 * A button that shows the busy gem (0.98.0) while its action waits. It is
 * `st-btn` or `st-link` with a 14 px emblem loader before the label; the
 * label text stays ("Sending…"), so the words and the gem say the same
 * thing. The gem is decoration: a screen reader reads the label.
 */

import { Gem } from "./nav-icons.tsx";

interface BusyButtonProps {
  busy: boolean;
  type?: "button" | "submit";
  className: string;
  disabled?: boolean;
  onClick?: () => void;
  "aria-label"?: string;
  children: React.ReactNode;
}

export function BusyButton({ busy, type = "button", className, disabled, onClick, children, ...rest }: BusyButtonProps): React.ReactNode {
  return (
    <button type={type === "submit" ? "submit" : "button"} className={className} disabled={disabled} onClick={onClick} aria-label={rest["aria-label"]}>
      {busy ? <Gem size={14} busy /> : null}
      {children}
    </button>
  );
}
