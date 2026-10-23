import { assertNoArgs, takeBoolFlag, takePositional } from "../args.js";
import { AxiError } from "../errors.js";
import { firefliesJson } from "../fireflies.js";
import {
  compactDate,
  formatDuration,
  isoDate,
  mergeTurns,
  sortedSentences,
  type Transcript,
} from "../transcript-model.js";
import { encode, renderHelp, renderOutput, Truncator } from "../toon.js";

/** Characters of turn text shown across the whole preview. */
export const PREVIEW_BUDGET = 1500;
/** Characters shown per turn in the preview. */
export const TURN_MAX = 300;
const PARTICIPANTS_MAX = 10;

export const TRANSCRIPT_HELP = `usage: fireflies-axi transcript <id> [flags]
Shows one meeting's details and a preview of its speaker turns.
args[1]:
  <id>      transcript id (required; run \`fireflies-axi transcripts\` to list ids)
flags[1]:
  --full    every turn uncut and every participant (default: a ${PREVIEW_BUDGET}-char preview, first ${PARTICIPANTS_MAX} participants)
examples:
  fireflies-axi transcript abc123
  fireflies-axi transcript abc123 --full
  fireflies-axi download abc123 --format md
`;

/**
 * Take the meeting id. A missing id is refused and never defaults to the
 * latest meeting (VISION.md Interface).
 */
export function requireId(
  command: string,
  args: string[],
  flags: string[],
): string {
  const id = takePositional(args);
  assertNoArgs(command, args, flags);
  if (id === undefined || id.trim() === "") {
    throw new AxiError("transcript id is required", "VALIDATION_ERROR", [
      "Run `fireflies-axi transcripts` to list meeting ids",
    ]);
  }
  return id;
}

export async function transcriptCommand(args: string[]): Promise<string> {
  const full = takeBoolFlag(args, "--full");
  const id = requireId("transcript", args, ["--full"]);
  const t = await firefliesJson<Transcript>(
    ["transcript", "get", id, "--format", "json"],
    { id },
  );
  return renderTranscript(t, { full });
}

export function renderTranscript(
  t: Transcript,
  opts: { full: boolean },
): string {
  const sentences = sortedSentences(t);
  const turns = mergeTurns(sentences);
  const chars = turns.reduce((n, turn) => n + turn.text.length, 0);

  const details: Record<string, unknown> = {
    id: t.id,
    title: t.title || "(untitled)",
    date: compactDate(isoDate(t)),
    duration: formatDuration(t.duration),
  };
  const organizer = t.organizer_email || t.host_email;
  if (organizer) details.organizer = organizer;
  // Always an array (AXI §3): cut to the first PARTICIPANTS_MAX outside
  // --full, with the real size in participants_total when anything was cut.
  const participants = (t.participants ?? []).map(String);
  const participantsCut = !opts.full && participants.length > PARTICIPANTS_MAX;
  details.participants = participantsCut
    ? participants.slice(0, PARTICIPANTS_MAX)
    : participants;
  if (participantsCut) details.participants_total = participants.length;
  const speakers = (t.speakers ?? [])
    .map((s) => s?.name)
    .filter((n): n is string => typeof n === "string" && n !== "");
  if (speakers.length > 0) details.speakers = speakers;
  if (t.transcript_url) details.url = t.transcript_url;

  const participantsHint = `Showing ${PARTICIPANTS_MAX} of ${participants.length} participants; run \`fireflies-axi transcript ${t.id} --full\` for all`;

  if (turns.length === 0) {
    details.content =
      "0 turns (no sentences yet; Fireflies may still be processing this meeting)";
    return renderOutput([
      encode({ transcript: details }),
      renderHelp([
        `Retry \`fireflies-axi transcript ${t.id}\` in a few minutes`,
        ...(participantsCut ? [participantsHint] : []),
      ]),
    ]);
  }
  details.content = `${turns.length} turns, ${sentences.length} sentences, ${chars} chars`;

  if (opts.full) {
    // Self-contained: every turn, uncut, and nothing left to hint at.
    return renderOutput([encode({ transcript: details }), encode({ turns })]);
  }

  const truncator = new Truncator();
  const shown: typeof turns = [];
  let remaining = PREVIEW_BUDGET;
  for (const turn of turns) {
    if (remaining <= 0) break;
    const max = Math.min(TURN_MAX, remaining);
    shown.push({ ...turn, text: truncator.cut(turn.text, max) });
    remaining -= Math.min(turn.text.length, max);
  }

  const hints: string[] = participantsCut ? [participantsHint] : [];
  if (truncator.count > 0 || shown.length < turns.length) {
    hints.push(
      `Showing ${shown.length} of ${turns.length} turns (${PREVIEW_BUDGET}-char preview); run \`fireflies-axi transcript ${t.id} --full\` for all turns`,
      `Run \`fireflies-axi download ${t.id} --format md\` to save the whole transcript to a file`,
    );
  }
  return renderOutput([
    encode({ transcript: details }),
    encode({ turns: shown }),
    renderHelp(hints),
  ]);
}
