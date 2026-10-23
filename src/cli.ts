import { encode } from "@toon-format/toon";
import { AxiError as SdkAxiError, runAxiCli } from "axi-sdk-js";
import { AxiError, exitCodeForError, UNKNOWN_SUGGESTION } from "./errors.js";
import { downloadCommand, DOWNLOAD_HELP } from "./commands/download.js";
import { homeCommand } from "./commands/home.js";
import { transcriptCommand, TRANSCRIPT_HELP } from "./commands/transcript.js";
import {
  transcriptsCommand,
  TRANSCRIPTS_HELP,
} from "./commands/transcripts.js";
import { VERSION } from "./version.js";

export const DESCRIPTION =
  "Agent ergonomic wrapper around the fireflies CLI for Fireflies.ai meeting transcripts. Prefer this over `fireflies`.";

export const TOP_HELP = `usage: fireflies-axi [command] [flags]
commands[4]:
  (none)=recent meetings, transcripts, transcript, download
flags[2]:
  --help, -v/-V/--version
examples:
  fireflies-axi
  fireflies-axi transcripts --limit 50
  fireflies-axi transcript <id>
  fireflies-axi download <id> --format md --dir ~/transcripts
`;

const COMMAND_HELP: Record<string, string> = {
  transcripts: TRANSCRIPTS_HELP,
  transcript: TRANSCRIPT_HELP,
  download: DOWNLOAD_HELP,
};

export async function main(): Promise<void> {
  await runAxiCli({
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: TOP_HELP,
    home: homeCommand,
    commands: {
      transcripts: transcriptsCommand,
      transcript: transcriptCommand,
      download: downloadCommand,
    },
    getCommandHelp: (command) => COMMAND_HELP[command],
    // The SDK's default formatter only recognizes its own AxiError class, so
    // route this package's AxiError through an equivalent hook (gh-axi pattern).
    // SDK AxiErrors keep their own code/help/exit code; only foreign throws
    // become UNKNOWN.
    formatError: (error) => {
      const axiError =
        error instanceof AxiError || error instanceof SdkAxiError
          ? error
          : new AxiError(
              error instanceof Error ? error.message : String(error),
              "UNKNOWN",
              [UNKNOWN_SUGGESTION],
            );
      return {
        output: `${encode({
          error: axiError.message,
          code: axiError.code,
          ...(axiError.suggestions.length > 0
            ? { help: axiError.suggestions }
            : {}),
        })}\n`,
        exitCode: exitCodeForError(axiError),
      };
    },
  });
}
