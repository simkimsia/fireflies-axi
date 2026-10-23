export type ErrorCode =
  | "AUTH"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "FIREFLIES_NOT_INSTALLED"
  | "WRITE_FAILED"
  | "API_ERROR"
  | "RATE_LIMITED"
  | "UNKNOWN";

export class AxiError extends Error {
  readonly code: ErrorCode;
  readonly suggestions: string[];

  constructor(message: string, code: ErrorCode, suggestions: string[] = []) {
    super(message);
    this.name = "AxiError";
    this.code = code;
    this.suggestions = suggestions;
  }
}

export function exitCodeForError(error: { code: string }): number {
  return error.code === "VALIDATION_ERROR" ? 2 : 1;
}

export const ISSUES_URL = "https://github.com/simkimsia/fireflies-axi/issues";
export const INSTALL_COMMAND =
  "uv tool install git+https://github.com/simkimsia/fireflies-axi";

export const UNKNOWN_SUGGESTION = `Report the gap at ${ISSUES_URL}`;

/** Longest stretch of child text ever relayed in a message. */
const RELAY_MAX = 200;

export function firefliesNotInstalledError(): AxiError {
  return new AxiError(
    "The fireflies CLI is not installed or not on PATH",
    "FIREFLIES_NOT_INSTALLED",
    [
      `Install it: \`${INSTALL_COMMAND}\``,
      "Then check it: `fireflies --version`",
    ],
  );
}

export function unexpectedOutputError(): AxiError {
  // Never echo stdout here: it may be transcript content.
  return new AxiError("Unexpected output from the fireflies CLI", "UNKNOWN", [
    `Check that \`fireflies --version\` prints "fireflies <x.y.z>" from simkimsia/fireflies-axi; reinstall with \`uv tool install --force git+https://github.com/simkimsia/fireflies-axi\``,
  ]);
}

export function timeoutError(seconds: number): AxiError {
  return new AxiError(`fireflies timed out after ${seconds}s`, "API_ERROR", [
    "Retry once; use a smaller `--limit`",
  ]);
}

export interface MapContext {
  /** The transcript id the call was about, for NOT_FOUND. */
  id?: string;
}

/**
 * Translate a failed `fireflies` run into a structured AxiError.
 *
 * Maps by exit code, not by stderr regex: the codes are a documented contract
 * (README exit-code table, `src/fireflies_cli/api.py` EXIT_*). Messages are
 * authored here; only exit 1, 6 and unknown codes relay one line of child
 * stderr, which the caller must already have passed through scrubSecrets().
 */
export function mapFirefliesError(
  exitCode: number,
  stderr: string,
  ctx: MapContext = {},
): AxiError {
  const line = relayLine(stderr);
  switch (exitCode) {
    case 1: {
      const match = /Could not write (.+?): (.+)$/.exec(line);
      return new AxiError(
        match
          ? `Could not write ${match[1]}: ${match[2]}`
          : "Could not write the transcript file",
        "WRITE_FAILED",
        [
          "Check that `--dir` exists and is writable, or pass another `--dir <path>`",
        ],
      );
    }
    case 2:
      return new AxiError(
        "The fireflies CLI rejected arguments fireflies-axi forwarded",
        "VALIDATION_ERROR",
        [`Rerun with \`AXI_DEBUG=1\` to see the argv; report at ${ISSUES_URL}`],
      );
    case 3:
      return new AxiError(
        /whitespace, control or non-ASCII/.test(stderr)
          ? "FIREFLIES_API_KEY looks malformed (bad paste)"
          : "FIREFLIES_API_KEY is not set",
        "AUTH",
        [
          "Ask the user to export FIREFLIES_API_KEY in the shell that runs the agent (Fireflies → Settings → Developer settings). Do not ask them to paste the key into the chat",
        ],
      );
    case 4:
      return new AxiError("Fireflies rejected the API key", "AUTH", [
        "Ask the user to check or replace FIREFLIES_API_KEY (Fireflies → Settings → Developer settings)",
      ]);
    case 5:
      return new AxiError(
        ctx.id
          ? `No transcript with id ${ctx.id}, or no access to it`
          : "Transcript not found, or no access to it",
        "NOT_FOUND",
        ["Run `fireflies-axi transcripts` to list meeting ids"],
      );
    case 6:
      return new AxiError(line || "Fireflies API error", "API_ERROR", [
        "Retry the same command once; if it fails again, check https://status.fireflies.ai or report the gap",
      ]);
    case 7: {
      // api.py prints "Retry in about <n>s." for GraphQL errors and
      // "Retry in <n>s." for a bare HTTP 429, so accept both.
      const wait = /Retry in (?:about )?(\d+)s/.exec(stderr)?.[1];
      return new AxiError(
        `Rate limited by Fireflies${wait ? ` (retry in ~${wait}s)` : ""}`,
        "RATE_LIMITED",
        [`Wait ${wait ?? "60"}s, then rerun the same command`],
      );
    }
    default:
      return new AxiError(
        `fireflies exited with code ${exitCode}${line ? `: ${line}` : ""}`,
        "UNKNOWN",
        [UNKNOWN_SUGGESTION],
      );
  }
}

/** First non-empty stderr line, `fireflies: ` prefix stripped, capped. */
function relayLine(stderr: string): string {
  const first =
    stderr
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l !== "") ?? "";
  return first.replace(/^fireflies:\s*/, "").slice(0, RELAY_MAX);
}
