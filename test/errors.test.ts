import { describe, expect, it } from "vitest";
import { exitCodeForError, mapFirefliesError } from "../src/errors.js";

// stderr strings are copied from the Python CLI: cli.py main() prints
// `fireflies: <message>`; messages come from api.py and cli.py._write.
const cases: Array<{
  exit: number;
  stderr: string;
  code: string;
  message: string;
  help: string;
}> = [
  {
    // cli.py _write
    exit: 1,
    stderr:
      "fireflies: Could not write /ro/2024-04-22_weekly-sync_abc123.md: Permission denied\n",
    code: "WRITE_FAILED",
    message:
      "Could not write /ro/2024-04-22_weekly-sync_abc123.md: Permission denied",
    help: "Check that `--dir` exists and is writable, or pass another `--dir <path>`",
  },
  {
    // argparse usage error
    exit: 2,
    stderr:
      "usage: fireflies transcripts list [-h] [--limit LIMIT]\nfireflies transcripts list: error: unrecognized arguments: --x\n",
    code: "VALIDATION_ERROR",
    message: "The fireflies CLI rejected arguments fireflies-axi forwarded",
    help: "Rerun with `AXI_DEBUG=1` to see the argv; report at https://github.com/simkimsia/fireflies-axi/issues",
  },
  {
    // api.py MissingKeyError
    exit: 3,
    stderr:
      "fireflies: FIREFLIES_API_KEY is not set.\nGet an API key in Fireflies: Settings -> Developer settings, then run:\n  export FIREFLIES_API_KEY=<your key>\n",
    code: "AUTH",
    message: "FIREFLIES_API_KEY is not set",
    help: "Ask the user to export FIREFLIES_API_KEY in the shell that runs the agent (Fireflies → Settings → Developer settings). Do not ask them to paste the key into the chat",
  },
  {
    // api.py _error_from_graphql auth branch
    exit: 4,
    stderr:
      "fireflies: Authentication failed: Invalid API key (auth_failed). Check that FIREFLIES_API_KEY holds a valid key (Fireflies -> Settings -> Developer settings).\n",
    code: "AUTH",
    message: "Fireflies rejected the API key",
    help: "Ask the user to check or replace FIREFLIES_API_KEY (Fireflies → Settings → Developer settings)",
  },
  {
    // api.py get_transcript
    exit: 5,
    stderr: "fireflies: Not found: no transcript with id 'abc123'\n",
    code: "NOT_FOUND",
    message: "No transcript with id abc123, or no access to it",
    help: "Run `fireflies-axi transcripts` to list meeting ids",
  },
  {
    // api.py network branch
    exit: 6,
    stderr:
      "fireflies: Network error talking to Fireflies: [Errno 8] nodename nor servname provided\n",
    code: "API_ERROR",
    message:
      "Network error talking to Fireflies: [Errno 8] nodename nor servname provided",
    help: "Retry the same command once; if it fails again, check https://status.fireflies.ai or report the gap",
  },
  {
    // api.py _error_from_graphql rate-limit branch
    exit: 7,
    stderr:
      "fireflies: Rate limited by Fireflies: Too many requests (too_many_requests). Retry in about 12s.\n",
    code: "RATE_LIMITED",
    message: "Rate limited by Fireflies (retry in ~12s)",
    help: "Wait 12s, then rerun the same command",
  },
  {
    // KeyboardInterrupt
    exit: 130,
    stderr: "",
    code: "UNKNOWN",
    message: "fireflies exited with code 130",
    help: "Report the gap at https://github.com/simkimsia/fireflies-axi/issues",
  },
  {
    exit: 99,
    stderr: "fireflies: something new\nsecond line\n",
    code: "UNKNOWN",
    message: "fireflies exited with code 99: something new",
    help: "Report the gap at https://github.com/simkimsia/fireflies-axi/issues",
  },
];

describe("mapFirefliesError", () => {
  it.each(cases)(
    "exit $exit -> $code",
    ({ exit, stderr, code, message, help }) => {
      const error = mapFirefliesError(exit, stderr, { id: "abc123" });
      expect(error.code).toBe(code);
      expect(error.message).toBe(message);
      expect(error.suggestions).toEqual([help]);
      expect(exitCodeForError(error)).toBe(code === "VALIDATION_ERROR" ? 2 : 1);
    },
  );

  it("parses the bare HTTP 429 retry form too", () => {
    // api.py: "Rate limited by Fireflies (HTTP 429). Retry in 12s."
    const error = mapFirefliesError(
      7,
      "fireflies: Rate limited by Fireflies (HTTP 429). Retry in 12s.\n",
    );
    expect(error.message).toBe("Rate limited by Fireflies (retry in ~12s)");
  });

  it("falls back to 60s when the wait is unknown", () => {
    const error = mapFirefliesError(
      7,
      "fireflies: Rate limited by Fireflies (HTTP 429).\n",
    );
    expect(error.message).toBe("Rate limited by Fireflies");
    expect(error.suggestions).toEqual([
      "Wait 60s, then rerun the same command",
    ]);
  });

  it("names a malformed key on exit 3", () => {
    // api.py get_api_key non-ASCII branch
    const error = mapFirefliesError(
      3,
      "fireflies: FIREFLIES_API_KEY contains whitespace, control or non-ASCII characters (often a bad paste). Re-copy the key and export it again.\n",
    );
    expect(error.code).toBe("AUTH");
    expect(error.message).toBe("FIREFLIES_API_KEY looks malformed (bad paste)");
  });

  it("caps a relayed line at 200 chars", () => {
    const error = mapFirefliesError(6, `fireflies: ${"x".repeat(500)}`);
    expect(error.message.length).toBe(200);
  });
});
