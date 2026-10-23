import {
  assertNoArgs,
  takeFlag,
  takeIntFlag,
  takeNonNegativeIntFlag,
} from "../args.js";
import { AxiError } from "../errors.js";
import { firefliesJson } from "../fireflies.js";
import {
  compactDate,
  formatDuration,
  type ListRow,
} from "../transcript-model.js";
import { renderHelp, renderList, renderOutput } from "../toon.js";

export const TRANSCRIPTS_LIMIT_DEFAULT = 20;
export const TRANSCRIPTS_LIMIT_MAX = 100;
/** The Fireflies API rejects a larger skip with invalid_arguments. */
export const TRANSCRIPTS_SKIP_MAX = 5000;
const EXTRA_FIELDS = ["organizer", "participants"] as const;
type ExtraField = (typeof EXTRA_FIELDS)[number];
const FLAGS = ["--limit", "--skip", "--fields"];

export const TRANSCRIPTS_HELP = `usage: fireflies-axi transcripts [flags]
Lists meetings, newest first: id, date, duration, title.
flags[3]:
  --limit <n>        rows to return (default ${TRANSCRIPTS_LIMIT_DEFAULT}, max ${TRANSCRIPTS_LIMIT_MAX})
  --skip <n>         offset for paging (default 0, max ${TRANSCRIPTS_SKIP_MAX})
  --fields <list>    extra columns: ${EXTRA_FIELDS.join(", ")}
examples:
  fireflies-axi transcripts
  fireflies-axi transcripts --limit 50 --skip 50
  fireflies-axi transcripts --fields organizer,participants
`;

export async function transcriptsCommand(args: string[]): Promise<string> {
  const limit = takeIntFlag(
    args,
    "--limit",
    TRANSCRIPTS_LIMIT_DEFAULT,
    TRANSCRIPTS_LIMIT_MAX,
  );
  const skip = takeNonNegativeIntFlag(args, "--skip", 0);
  if (skip > TRANSCRIPTS_SKIP_MAX) {
    // Retrying would never help, so refuse here rather than relay API_ERROR.
    throw new AxiError(
      `--skip must be at most ${TRANSCRIPTS_SKIP_MAX} (Fireflies API limit), got ${skip}`,
      "VALIDATION_ERROR",
      [
        `Pass \`--skip\` between 0 and ${TRANSCRIPTS_SKIP_MAX}; the Fireflies API cannot page further`,
      ],
    );
  }
  const fields = parseFields(takeFlag(args, "--fields"));
  assertNoArgs("transcripts", args, FLAGS);

  const rows = await firefliesJson<ListRow[]>([
    "transcripts",
    "list",
    "--limit",
    String(limit),
    "--skip",
    String(skip),
  ]);
  return renderTranscripts(rows, { limit, skip, fields });
}

function parseFields(raw: string | undefined): ExtraField[] {
  if (raw === undefined) return [];
  const wanted = raw
    .split(",")
    .map((f) => f.trim())
    .filter((f) => f !== "");
  const unknown = wanted.filter(
    (f) => !(EXTRA_FIELDS as readonly string[]).includes(f),
  );
  if (unknown.length > 0 || wanted.length === 0) {
    throw new AxiError(
      unknown.length > 0
        ? `unknown field ${unknown[0]} for \`transcripts --fields\``
        : "--fields needs at least one field",
      "VALIDATION_ERROR",
      [`valid fields: ${EXTRA_FIELDS.join(", ")}`],
    );
  }
  return [...new Set(wanted)] as ExtraField[];
}

/** Flatten list rows into TOON table rows (shared with the home view). */
export function meetingRows(
  rows: ListRow[],
  fields: ExtraField[],
): Record<string, unknown>[] {
  return rows.map((r) => {
    const row: Record<string, unknown> = {
      id: r.id,
      date: compactDate(r.date),
      duration: formatDuration(r.duration),
      title: r.title || "(untitled)",
    };
    if (fields.includes("organizer")) {
      row.organizer = r.organizer_email || "unknown";
    }
    if (fields.includes("participants")) {
      row.participants = (r.participants ?? []).length;
    }
    return row;
  });
}

export function renderTranscripts(
  rows: ListRow[],
  opts: { limit: number; skip: number; fields: ExtraField[] },
): string {
  const { limit, skip, fields } = opts;
  if (rows.length === 0) {
    if (skip === 0) {
      return "transcripts: 0 meetings found in this Fireflies account";
    }
    return renderOutput([
      `transcripts: 0 meetings at --skip ${skip} (end of list)`,
      renderHelp([
        "Run `fireflies-axi transcripts --skip 0` for the most recent",
      ]),
    ]);
  }

  // The Fireflies list API returns no total, so none is invented here: a full
  // page only means more may exist.
  const full = rows.length === limit;
  const hints = [
    "Run `fireflies-axi transcript <id>` for details and a transcript preview",
  ];
  if (full) {
    const next = skip + limit;
    const extra = fields.length > 0 ? ` --fields ${fields.join(",")}` : "";
    hints.push(
      next <= TRANSCRIPTS_SKIP_MAX
        ? `More may exist: run \`fireflies-axi transcripts --limit ${limit} --skip ${next}${extra}\``
        : `More may exist, but the Fireflies API cannot page past --skip ${TRANSCRIPTS_SKIP_MAX}`,
    );
  }
  return renderOutput([
    `count: ${rows.length} meetings (skip ${skip}${full ? "" : ", end of list"})`,
    renderList("transcripts", meetingRows(rows, fields)),
    renderHelp(hints),
  ]);
}
