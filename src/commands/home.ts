import { AxiError, type ErrorCode } from "../errors.js";
import { firefliesJson } from "../fireflies.js";
import type { ListRow } from "../transcript-model.js";
import { encode, renderHelp, renderList, renderOutput } from "../toon.js";
import { meetingRows } from "./transcripts.js";

const HOME_LIMIT = 5;

/** Failures the home view shows as state instead of exiting non-zero. */
const DEGRADE: ErrorCode[] = [
  "FIREFLIES_NOT_INSTALLED",
  "AUTH",
  "RATE_LIMITED",
  "API_ERROR",
];

export async function homeCommand(): Promise<string> {
  // Content first (AXI §8): the most recent meetings, never a usage manual.
  let rows: ListRow[];
  try {
    rows = await firefliesJson<ListRow[]>([
      "transcripts",
      "list",
      "--limit",
      String(HOME_LIMIT),
      "--skip",
      "0",
    ]);
  } catch (error) {
    if (error instanceof AxiError && DEGRADE.includes(error.code)) {
      return renderOutput([
        encode({
          transcripts: {
            status: "unavailable",
            code: error.code,
            error: error.message,
          },
        }),
        renderHelp(error.suggestions),
      ]);
    }
    throw error;
  }

  if (rows.length === 0) {
    return renderOutput([
      "transcripts: 0 meetings found in this Fireflies account",
      renderHelp([
        "Record or upload a meeting in Fireflies, then rerun `fireflies-axi`",
      ]),
    ]);
  }
  return renderOutput([
    `count: ${rows.length} most recent meetings`,
    renderList("transcripts", meetingRows(rows, [])),
    renderHelp([
      "Run `fireflies-axi transcript <id>` for one meeting's details and transcript preview",
      // A short page means the account has no more meetings (AXI §9).
      ...(rows.length === HOME_LIMIT
        ? ["Run `fireflies-axi transcripts --limit 50` for more meetings"]
        : []),
    ]),
  ]);
}
