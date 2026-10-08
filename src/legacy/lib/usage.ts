/**
 * Usage text of the legacy verbs: what `darius <verb> --help` prints.
 *
 * `--help` or `-h` anywhere in a verb's arguments prints the usage on stdout
 * and exits 0; nothing else runs (docs/concept.md, "CLI contract"). The
 * lines are the ones the verbs print on a usage error. A key with a
 * sub-verb ("worklog set-stage") is more specific than the verb alone.
 */

const TEMPLATES = "generic|api-endpoint|ui-component|library";

const USAGE: Record<string, string[]> = {
  root: ["Usage: darius root"],
  show: ["Usage: darius show <spec-path> [--json]"],
  status: ["Usage: darius status [--detailed] [--json]"],
  list: ["Usage: darius list milestones [--json]", "       darius list specs [--milestone <slug>] [--session <id>] [--json]"],
  next: ["Usage: darius next [--session <id>] [--force]"],
  add: [
    "Usage: darius add milestone --name <name> --slug <slug> --owner <email> [--target <date>] [--number N]",
    `       darius add spec --milestone <slug> --name <name> --template <${TEMPLATES}> [--depends-on <path>...] [--agent <name>] [--manual --owner <who> --expires <YYYY-MM-DD>]`,
    "  Scaffolded Commands fail on purpose. Replace them with real checks.",
  ],
  "add milestone": ["Usage: darius add milestone --name <name> --slug <slug> --owner <email> [--target <date>] [--number N]"],
  "add spec": [
    `Usage: darius add spec --milestone <slug> --name <name> --template <${TEMPLATES}> [--depends-on <path>...] [--agent <name>] [--manual --owner <who> --expires <YYYY-MM-DD>]`,
    "  Scaffolded Commands fail on purpose. Replace them with real checks.",
    "  --manual scaffolds operator decisions instead, and needs a named owner and an expiry.",
  ],
  mark: [
    'Usage: darius mark <spec-path> <task-idx> --verified|--in-progress|--blocked|--skipped|--pending [--evidence "..."] [--override "<why the check cannot run>"]',
    "  Task indexes start at 0. --verified on a no-op Command needs --evidence.",
  ],
  "set-status": [
    "Usage: darius set-status <spec-path|milestone-folder> <status>",
    "  Spec statuses: Not Started | In Progress | Complete | Blocked | Archived",
    "  Milestone-only statuses: Skipped | Deferred | Closed",
  ],
  index: ["Usage: darius index --rebuild"],
  verify: ["Usage: darius verify <spec-path> [--dry-run] [--recheck] [--timeout <seconds>]"],
  "verify-item": ["Usage: darius verify-item <spec-path> <task-idx> [--dry-run] [--recheck] [--timeout <seconds>]", "  Task indexes start at 0. A passing item is ticked."],
  "archive-check": ["Usage: darius archive-check <milestone-folder|slug> [--json]"],
  worklog: [
    "Usage: darius worklog <open|append|close|list|set-stage|dispatch|park|distill|index> [options]",
    '  open <milestone-slug> --spec <path> [--message "..."] [--session <id>]',
    '  append <thread-id> --section "<s>" --message "..."',
    "  close <thread-id> --status <done|blocked|cancelled>",
    "  list [--active] [--milestone <slug>] [--json]",
    '  set-stage <thread-id> <planned|dispatched|verified|committed|reviewed> [--commit <sha>] [--no-git] [--no-code "..."] [--force --reason "..."]',
    '  dispatch <thread-id> --agent <invocable> [--reason "<one-line>"]',
    '  park <thread-id> --reason "<why>"',
    "  distill <file> (--content <path> | --stdin) | --check | --list [--json] [--force] [--min-age-days N]",
    "  index",
  ],
  "worklog open": ['Usage: darius worklog open <milestone-slug> [--spec <path>] [--message "..."] [--session <id>] [--takeover] [--as-other-session]'],
  "worklog append": ['Usage: darius worklog append <thread-id> --section "<section>" --message "..."'],
  "worklog set-stage": ['Usage: darius worklog set-stage <thread-id> <planned|dispatched|verified|committed|reviewed> [--commit <sha>] [--no-git] [--no-code "<why>"] [--force --reason "<why>"] [--session <id>]'],
  "worklog dispatch": ['Usage: darius worklog dispatch <thread-id> --agent <invocable> [--reason "<one-line>"] [--force] [--session <id>] [--as-other-session]'],
  "worklog close": ["Usage: darius worklog close <thread-id> --status <done|blocked|cancelled>"],
  "worklog list": ["Usage: darius worklog list [--active] [--milestone <slug>] [--json]"],
  "worklog park": ['Usage: darius worklog park <thread-id> --reason "<why this work is being deferred>"'],
  "worklog index": ["Usage: darius worklog index"],
  "worklog distill": ["Usage: darius worklog distill <file> (--content <path> | --stdin) | --check | --list [--json] [--force] [--min-age-days N]"],
  doctor: ["Usage: darius doctor [--fix] [--quick] [--json]"],
  scan: ["Usage: darius scan <artifacts|stubs> <path>"],
  "scan artifacts": ["Usage: darius scan artifacts <path>"],
  "scan stubs": ["Usage: darius scan stubs <path>"],
  due: ["Usage: darius due [--json]"],
  ritual: [
    "Usage: darius ritual <add|run|complete|list> [options]",
    "  add --name <name> --slug <slug> [--cadence <1d|2w|1m>] [--due <YYYY-MM-DD>] [--agent <name>] [--owner <email>]",
    "  run <slug> [--date <YYYY-MM-DD>]",
    "  complete <slug> [--today <YYYY-MM-DD>]",
    "  list [--json]",
  ],
  vigil: [
    "Usage: darius vigil <add|list|set-body|close> [options]",
    '  add <slug> [--name "Title"] [--due <YYYY-MM-DD>] [--until "<event>"] [--from <ref>] [--agent <name>] [--stdin | --content <path>]',
    "  set-body <slug> (--stdin | --content <path>)",
    "  list [--all] [--json]",
    "  close <slug> --verdict <held|failed> [--date <YYYY-MM-DD>]",
  ],
  "vigil add": ['Usage: darius vigil add <slug> [--name "Title"] [--due <YYYY-MM-DD>] [--until "<event>"] [--from <ref>] [--agent <name>] [--stdin | --content <path>]', "  --stdin reads the vigil body (its `## Verification Checklist`) from stdin."],
  "vigil set-body": ["Usage: darius vigil set-body <slug> (--stdin | --content <path>)"],
  "vigil list": ["Usage: darius vigil list [--all] [--json]"],
  "vigil close": ["Usage: darius vigil close <slug> --verdict <held|failed> [--date <YYYY-MM-DD>]"],
  "hook-stop": ["Usage: darius hook-stop", "  A Stop hook. It reads the hook JSON on stdin."],
  "hook-drift": ["Usage: darius hook-drift", "  A PostToolUse hook. It reads the hook JSON on stdin."],
  delegation: ["Usage: darius delegation <validate|return-validate> '<json>'"],
  "counsel-gate": ["Usage: darius counsel-gate <transcript-path> [--spec <spec-path>] [--threshold N] [--max-rounds N] [--single-dissent surface|confirm|ignore] [--ack-dissent] [--json]", "       darius counsel-gate --spec <spec-path> --override \"<reason>\""],
  "uncommitted-verified": ["Usage: darius uncommitted-verified [--json]"],
  claim: ["Usage: darius claim <spec-ref> [--session <id>] [--ttl 8h] [--takeover] [--json]", "       darius claim --list [--json]"],
  release: ["Usage: darius release <spec-ref> [--session <id>] [--force] [--json]"],
  "loop-check": ["Usage: darius loop-check [--json] [--session <id>] [--bounce <id>] [--max-bounces N]"],
  agents: ["Usage: darius agents [--json]"],
  migrate: ["Usage: darius migrate [--from v1|v8|auto] [--dry-run|--apply]"],
};

/** True when `--help` or `-h` is among `args`, before a bare `--`. */
export function wantsHelp(args: readonly string[]): boolean {
  for (const token of args) {
    if (token === "--") return false;
    if (token === "--help" || token === "-h") return true;
  }
  return false;
}

/** The usage lines for the verb and its first words in `argv`, or null when none is known. */
export function usageFor(argv: readonly string[]): string[] | null {
  const words = argv.filter((word) => !word.startsWith("-"));
  for (let count = Math.min(2, words.length); count >= 1; count -= 1) {
    const found = USAGE[words.slice(0, count).join(" ")];
    if (found !== undefined) return found;
  }
  return null;
}
