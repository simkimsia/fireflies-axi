import { execFile } from "node:child_process";
import {
  AxiError,
  firefliesNotInstalledError,
  mapFirefliesError,
  timeoutError,
  unexpectedOutputError,
  UNKNOWN_SUGGESTION,
  type MapContext,
} from "./errors.js";
import { scrubSecrets } from "./scrub.js";

// `--format json` of a long meeting carries `text` plus `raw_text` per sentence.
const MAX_BUFFER_BYTES = 50 * 1024 * 1024; // 50 MB
// Covers list paging (50 rows per request), the 30 s per-request timeout and
// one 30 s rate-limit retry inside the Python CLI.
const TIMEOUT_SECONDS = 120;

type Outcome =
  | { kind: "ok"; stdout: string }
  | { kind: "exit"; exitCode: number; stderr: string }
  | { kind: "not-installed" }
  | { kind: "timeout" }
  | { kind: "overflow" }
  | { kind: "signal"; signal: string };

/** Quote one argv token for a copy-pasteable shell line. */
export function shellQuote(token: string): string {
  if (/^[\w@%+=:,./-]+$/.test(token)) return token;
  return `'${token.replace(/'/g, `'\\''`)}'`;
}

/**
 * With `AXI_DEBUG=1`, the exact argv sent to fireflies, printed on stderr so a
 * gap can be reproduced against the plain CLI. argv never holds the key (it
 * comes only from the environment), so nothing is redacted. stdout stays TOON.
 */
export function debugLine(args: string[]): string {
  return `[axi-debug] fireflies ${args.map(shellQuote).join(" ")}`;
}

function run(args: string[]): Promise<Outcome> {
  if (process.env.AXI_DEBUG === "1") {
    process.stderr.write(`${debugLine(args)}\n`);
  }
  return new Promise((resolve) => {
    // No `env` option: the child inherits process.env, so the key reaches
    // fireflies without this process ever reading it.
    execFile(
      "fireflies",
      args,
      { maxBuffer: MAX_BUFFER_BYTES, timeout: TIMEOUT_SECONDS * 1000 },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ kind: "ok", stdout: String(stdout ?? "") });
          return;
        }
        const err = error as Error & {
          code?: string | number;
          killed?: boolean;
          signal?: string | null;
        };
        if (err.code === "ENOENT") {
          resolve({ kind: "not-installed" });
        } else if (err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
          resolve({ kind: "overflow" });
        } else if (err.killed) {
          resolve({ kind: "timeout" });
        } else if (typeof err.code === "number") {
          resolve({
            kind: "exit",
            exitCode: err.code,
            stderr: String(stderr ?? ""),
          });
        } else if (err.signal) {
          resolve({ kind: "signal", signal: err.signal });
        } else {
          resolve({ kind: "exit", exitCode: 1, stderr: String(stderr ?? "") });
        }
      },
    );
  });
}

async function runChecked(args: string[], ctx: MapContext): Promise<string> {
  const outcome = await run(args);
  switch (outcome.kind) {
    case "ok":
      return outcome.stdout;
    case "not-installed":
      throw firefliesNotInstalledError();
    case "timeout":
      throw timeoutError(TIMEOUT_SECONDS);
    case "overflow":
      throw new AxiError(
        "fireflies output exceeded 50 MB, more than fireflies-axi buffers",
        "UNKNOWN",
        [UNKNOWN_SUGGESTION],
      );
    case "signal":
      throw new AxiError(
        `fireflies was terminated by ${outcome.signal}`,
        "UNKNOWN",
        ["Rerun the same command once"],
      );
    case "exit":
      // Never relay stdout in an error: it may be transcript content.
      throw mapFirefliesError(
        outcome.exitCode,
        scrubSecrets(outcome.stderr),
        ctx,
      );
  }
}

/** Execute fireflies and return parsed JSON stdout. */
export async function firefliesJson<T = unknown>(
  args: string[],
  ctx: MapContext = {},
): Promise<T> {
  const stdout = await runChecked(args, ctx);
  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw unexpectedOutputError();
  }
}

/** Execute fireflies and return raw stdout. */
export async function firefliesExec(
  args: string[],
  ctx: MapContext = {},
): Promise<string> {
  return runChecked(args, ctx);
}
