import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import { takeFlag } from "../args.js";
import { AxiError, UNKNOWN_SUGGESTION } from "../errors.js";
import { firefliesExec } from "../fireflies.js";
import { encode } from "../toon.js";
import { requireId } from "./transcript.js";

const FORMATS = ["text", "md", "json"] as const;
type Format = (typeof FORMATS)[number];
// fireflies itself defaults to text; md merges speaker turns and is cheaper
// for an agent to read back.
export const DOWNLOAD_FORMAT_DEFAULT: Format = "md";
const FLAGS = ["--format", "--dir"];

export const DOWNLOAD_HELP = `usage: fireflies-axi download <id> [flags]
Saves one meeting's whole transcript to a file and prints its path and size.
The filename is generated (<date>_<title-slug>_<id>.<ext>), so downloading the
same meeting again overwrites the same file.
args[1]:
  <id>              transcript id (required; run \`fireflies-axi transcripts\` to list ids)
flags[2]:
  --format <fmt>    text, md (speaker turns merged) or json (raw API object); default ${DOWNLOAD_FORMAT_DEFAULT}
  --dir <path>      directory to save into, created if missing (default: current directory)
examples:
  fireflies-axi download abc123
  fireflies-axi download abc123 --format json --dir ~/transcripts
  fireflies-axi download abc123 --format text
`;

export async function downloadCommand(args: string[]): Promise<string> {
  const format = parseFormat(takeFlag(args, "--format"));
  const dir = takeFlag(args, "--dir") ?? ".";
  const id = requireId("download", args, FLAGS);

  const stdout = await firefliesExec(
    // One token per option, so argparse never reads a dash-leading value
    // (`--dir=-x`) as an option.
    ["transcript", "download", id, `--format=${format}`, `--dir=${dir}`],
    { id },
  );
  const printed = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .at(-1);
  if (!printed) {
    throw new AxiError("fireflies did not report a saved path", "UNKNOWN", [
      UNKNOWN_SUGGESTION,
    ]);
  }
  // The child inherits this process's cwd, so a relative path resolves here.
  const absolute = resolve(printed);
  let bytes: number;
  try {
    bytes = (await stat(absolute)).size;
  } catch {
    throw new AxiError(
      `fireflies reported ${collapseHome(absolute)}, but it cannot be read`,
      "WRITE_FAILED",
      [
        "Check that `--dir` exists and is writable, or pass another `--dir <path>`",
      ],
    );
  }
  return encode({
    downloaded: { id, format, path: collapseHome(absolute), bytes },
  });
}

function parseFormat(raw: string | undefined): Format {
  if (raw === undefined) return DOWNLOAD_FORMAT_DEFAULT;
  if ((FORMATS as readonly string[]).includes(raw)) return raw as Format;
  throw new AxiError(
    `--format must be one of ${FORMATS.join(", ")}, got ${raw}`,
    "VALIDATION_ERROR",
    [
      `Pass \`--format ${FORMATS.join("|")}\` (default ${DOWNLOAD_FORMAT_DEFAULT})`,
    ],
  );
}

export function collapseHome(path: string, home = homedir()): string {
  if (path === home) return "~";
  if (path.startsWith(home + sep)) return `~${path.slice(home.length)}`;
  return path;
}
