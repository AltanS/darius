/**
 * The icons of the frame: the brand gem, the settings gear, the status pulse, the chevron and
 * check of the switcher, the two marks of its scopes, the milestone flag and the lock of a
 * setting the environment sets.
 * The eye and the two arrows of the vigil and ritual tabs are in `kind.tsx`.
 * Same 16 by 16 grid and round strokes as the kind icons; the colour comes
 * from the text colour around them.
 */

const GEAR = "M6.54 2.91L6.78 1.11L9.22 1.11L9.46 2.91L10.57 3.36L12.02 2.27L13.73 3.98L12.64 5.43L13.09 6.54L14.89 6.78L14.89 9.22L13.09 9.46L12.64 10.57L13.73 12.02L12.02 13.73L10.57 12.64L9.46 13.09L9.22 14.89L6.78 14.89L6.54 13.09L5.43 12.64L3.98 13.73L2.27 12.02L3.36 10.57L2.91 9.46L1.11 9.22L1.11 6.78L2.91 6.54L3.36 5.43L2.27 3.98L3.98 2.27L5.43 3.36Z";

const PATHS = {
  gear: [GEAR, "M8 5.9A2.1 2.1 0 1 0 8 10.1A2.1 2.1 0 1 0 8 5.9Z"],
  milestone: ["M3.5 14.6V1.8", "M3.5 2.8H12.4L10.2 5.6L12.4 8.4H3.5"],
  chevron: ["M3.5 6L8 10.5L12.5 6"],
  check: ["M3 8.6L6.5 12L13 4.6"],
  workspace: ["M2.4 3.4H13.6V12.6H2.4Z", "M2.4 6.4H13.6"],
  all: ["M8 2L14.4 5.4L8 8.8L1.6 5.4Z", "M1.6 8.4L8 11.8L14.4 8.4", "M1.6 11.2L8 14.6L14.4 11.2"],
  status: ["M1.6 8.4H4.4L6.2 3.2L9.4 13L11.2 8.4H14.4"],
  overview: ["M1.8 7.6L8 2.3L14.2 7.6", "M3.6 6.6V13.7H12.4V6.6", "M6.6 13.7V9.6H9.4V13.7"],
  lock: ["M3.4 7.2H12.6V14.2H3.4Z", "M5.4 7.2V4.9A2.6 2.6 0 0 1 10.6 4.9V7.2"],
} as const satisfies Record<string, readonly string[]>;

export type NavIconName = keyof typeof PATHS;

interface NavIconProps {
  name: NavIconName;
  /** Pixels; 16 by default. */
  size?: number;
  className?: string;
}

export function NavIcon({ name, size = 16, className }: NavIconProps): React.ReactNode {
  return (
    <svg className={className === undefined ? "nav-icon" : `nav-icon ${className}`} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" focusable="false" aria-hidden="true">
      {PATHS[name].map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}

interface GemProps {
  size?: number;
}

/** The brand mark: a cut gem, in four facets and a bright heart. The colours follow the theme. */
export function Gem({ size = 28 }: GemProps): React.ReactNode {
  return (
    <svg className="gem" width={size} height={size} viewBox="0 0 32 32" focusable="false" aria-hidden="true">
      <g strokeWidth="2" strokeLinejoin="miter" className="gem-g">
        <path d="M16 2 30 16 22 16 16 10Z" className="gem-a" />
        <path d="M30 16 16 30 16 22 22 16Z" className="gem-b" />
        <path d="M16 30 2 16 10 16 16 22Z" className="gem-c" />
        <path d="M2 16 16 2 16 10 10 16Z" className="gem-b" />
        <path d="M16 10 22 16 16 22 10 16Z" className="gem-d" />
      </g>
    </svg>
  );
}
