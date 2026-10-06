/**
 * darius over the operator's own ssh: `darius update --hosts` (src/cli/update.ts)
 * and `--on <host>` of `run now`, `run resume` and `run follow-up`
 * (src/cli/run-due.ts, 0.50.0).
 *
 * Every call is `<ssh> -o BatchMode=yes -o ConnectTimeout=10 <host> <words>`.
 * The program is `DARIUS_SSH`, else `ssh`. ssh joins the words with spaces
 * and hands the line to the host's login shell, so each word is quoted for
 * that shell first (shellWord).
 */

import { spawnSync } from "node:child_process";

import { errorMessage } from "../runtime.ts";

/** ssh exits 255 when it cannot connect, or the connection drops. */
export const SSH_FAILED = 255;

const SSH_OPTIONS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"] as const;

/** The ssh program: `DARIUS_SSH`, else `ssh`. */
export function sshProgram(): string {
  const program = process.env.DARIUS_SSH;
  return program === undefined || program === "" ? "ssh" : program;
}

/**
 * One word for a POSIX shell, bash, zsh or fish: ssh hands the command line
 * to the host's login shell. A word of safe characters stays as it is; any
 * other word goes in single quotes. Each `'` and each `\` in it closes the
 * quotes, is written escaped, and opens them again: `'\''` and `'\\'`.
 *
 * Inside single quotes a POSIX shell keeps a backslash as it is, but fish
 * reads `\'` and `\\` there as escapes (0.69.0). So a word that ends in a
 * backslash, quoted the POSIX way, left the quotes open in fish, and the
 * next word ran as code. Outside quotes `\'` and `\\` mean the same in all
 * four shells, so the word reads back the same in each.
 */
export function shellWord(word: string): string {
  return /^[A-Za-z0-9._/:@=+-]+$/u.test(word) ? word : `'${word.replaceAll(/['\\]/gu, (char) => `'\\${char}'`)}'`;
}

/** The words as one line a person can paste into a shell. */
export function shellLine(words: readonly string[]): string {
  return words.map(shellWord).join(" ");
}

/** The line a person types to run `darius <argv>` on `host`: `ssh <host> darius ...`. */
export function sshDariusLine(host: string, argv: readonly string[]): string {
  return shellLine(["ssh", host, "darius", ...argv]);
}

/** The argv for the ssh program: the options, the host, then every word quoted for the remote shell. */
export function sshArgv(host: string, words: readonly string[]): string[] {
  return [...SSH_OPTIONS, host, ...words.map(shellWord)];
}

/** What one captured ssh call gave back. */
export interface Ran {
  status: number | null;
  stdout: string;
  stderr: string;
  error: string | undefined;
}

/** Runs `words` on `host`, feeds `input` on stdin, and captures the output. */
export function ssh(program: string, host: string, words: readonly string[], input: string, timeoutMs: number): Ran {
  const ran = spawnSync(program, sshArgv(host, words), { encoding: "utf8", input, timeout: timeoutMs });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr, error: ran.error === undefined ? undefined : errorMessage(ran.error) };
}

/**
 * Runs `darius <argv>` on `host` in a login bash, so darius is on the host's
 * login PATH, with this terminal's stdin, stdout and stderr. Returns the
 * remote exit code; 255 when ssh could not run or the remote was killed.
 */
export function sshDarius(program: string, host: string, argv: readonly string[]): number {
  const ran = spawnSync(program, sshArgv(host, ["bash", "-l", "-c", 'exec darius "$@"', "darius", ...argv]), { stdio: "inherit" });
  if (ran.error !== undefined) {
    console.error(`darius: ssh ${host}: ${errorMessage(ran.error)}`);
    return SSH_FAILED;
  }
  return ran.status ?? SSH_FAILED;
}
