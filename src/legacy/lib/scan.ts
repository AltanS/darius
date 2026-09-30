/**
 * tracker scan — artifact and stub scanner.
 *
 * scan artifacts: finds debug artifacts (console.log, debugger, TODO:, etc.)
 * scan stubs:     finds stubbed implementations (empty bodies, throw "not implemented", etc.)
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScanMatch = {
  file: string;
  line: number;
  pattern: string;
  text: string;
};

// ---------------------------------------------------------------------------
// Artifact patterns
// ---------------------------------------------------------------------------

const ARTIFACT_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "console.log", regex: /\bconsole\.log\s*\(/ },
  { name: "console.debug", regex: /\bconsole\.debug\s*\(/ },
  { name: "console.warn", regex: /\bconsole\.warn\s*\(/ },
  { name: "console.error", regex: /\bconsole\.error\s*\(/ },
  { name: "console.info", regex: /\bconsole\.info\s*\(/ },
  { name: "console.trace", regex: /\bconsole\.trace\s*\(/ },
  { name: "debugger", regex: /\bdebugger\b/ },
  { name: "TODO:", regex: /\bTODO:/ },
  { name: "FIXME:", regex: /\bFIXME:/ },
  { name: "XXX:", regex: /\bXXX:/ },
  { name: "HACK:", regex: /\bHACK:/ },
  { name: "print()", regex: /\bprint\s*\(/ },
  { name: "var_dump()", regex: /\bvar_dump\s*\(/ },
  { name: "dd()", regex: /\bdd\s*\(/ },
  { name: "dump()", regex: /\bdump\s*\(/ },
];

// ---------------------------------------------------------------------------
// Stub patterns — match against full function body heuristics
// ---------------------------------------------------------------------------

const STUB_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  // throw new Error("not implemented") variants
  {
    name: 'throw new Error("not implemented")',
    regex: /throw\s+new\s+Error\s*\(\s*["'`](not implemented|TODO|todo|Not implemented|NOT IMPLEMENTED)["'`]\s*\)/,
  },
  // Empty function bodies: function foo() {} or () => {}
  {
    name: "empty function body",
    regex: /(?:function\s+\w+\s*\([^)]*\)|(?:\([^)]*\)|[\w]+)\s*=>)\s*\{\s*\}/,
  },
  // return null; as sole return (with optional whitespace around it)
  {
    name: "return null (stub)",
    regex: /^\s*return\s+null\s*;\s*$/,
  },
  // return undefined; as sole return
  {
    name: "return undefined (stub)",
    regex: /^\s*return\s+undefined\s*;\s*$/,
  },
  // Trivial assertions: expect(true).toBe(true)
  {
    name: "trivial assertion",
    regex: /expect\s*\(\s*true\s*\)\s*\.\s*toBe\s*\(\s*true\s*\)/,
  },
  // expect(1).toBe(1) etc.
  {
    name: "trivial assertion",
    regex: /expect\s*\(\s*\d+\s*\)\s*\.\s*toBe\s*\(\s*\d+\s*\)/,
  },
  // TODO placeholder comments inside function body
  {
    name: "TODO placeholder",
    regex: /\/\/\s*TODO\s*$/,
  },
];

// ---------------------------------------------------------------------------
// File extensions to scan
// ---------------------------------------------------------------------------

const SCANNABLE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".mjs",
  ".cts",
  ".cjs",
]);

// ---------------------------------------------------------------------------
// Main scan functions
// ---------------------------------------------------------------------------

/**
 * Scan a directory or file for debug artifacts.
 * Returns a list of matches.
 */
export function scanArtifacts(opts: {
  path: string;
  extensions?: Set<string>;
}): ScanMatch[] {
  const { path, extensions = SCANNABLE_EXTENSIONS } = opts;
  const files = collectFiles(path, extensions);
  const matches: ScanMatch[] = [];

  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      for (const pattern of ARTIFACT_PATTERNS) {
        if (pattern.regex.test(line)) {
          matches.push({
            file,
            line: i + 1,
            pattern: pattern.name,
            text: line.trim(),
          });
          break; // Only report first matching pattern per line
        }
      }
    }
  }

  return matches;
}

/**
 * Scan a directory or file for stubbed implementations.
 * Returns a list of matches.
 */
export function scanStubs(opts: {
  path: string;
  extensions?: Set<string>;
}): ScanMatch[] {
  const { path, extensions = SCANNABLE_EXTENSIONS } = opts;
  const files = collectFiles(path, extensions);
  const matches: ScanMatch[] = [];

  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      for (const pattern of STUB_PATTERNS) {
        if (pattern.regex.test(line)) {
          matches.push({
            file,
            line: i + 1,
            pattern: pattern.name,
            text: line.trim(),
          });
          break;
        }
      }
    }
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

/**
 * Format scan matches into the `<file>:<line>: <pattern>` output format.
 */
export function formatScanMatches(matches: ScanMatch[]): string {
  return matches.map((m) => `${m.file}:${m.line}: ${m.pattern}`).join("\n");
}

// ---------------------------------------------------------------------------
// File collection
// ---------------------------------------------------------------------------

/**
 * Collect all files from a path (file or directory, recursive).
 * Skips node_modules and .git directories.
 */
function collectFiles(rootPath: string, extensions: Set<string>): string[] {
  if (!existsSync(rootPath)) {
    return [];
  }

  const stat = statSync(rootPath);

  if (stat.isFile()) {
    const ext = extname(rootPath);
    if (extensions.has(ext)) {
      return [rootPath];
    }
    return [];
  }

  if (stat.isDirectory()) {
    return collectFilesRecursive(rootPath, extensions);
  }

  return [];
}

function collectFilesRecursive(dir: string, extensions: Set<string>): string[] {
  const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".cache"]);

  const result: string[] = [];
  const entries = readdirSync(dir).sort();

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;

    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      result.push(...collectFilesRecursive(fullPath, extensions));
    } else if (stat.isFile()) {
      const ext = extname(entry);
      if (extensions.has(ext)) {
        result.push(fullPath);
      }
    }
  }

  return result;
}
