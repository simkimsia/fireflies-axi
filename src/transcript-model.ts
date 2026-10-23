// TypeScript port of the parts of src/fireflies_cli/formatting.py the wrapper
// needs to shape `fireflies transcript get --format json` output.

/** One row of `fireflies transcripts list` (formatting.summary_row). */
export interface ListRow {
  id: string;
  title: string | null;
  date: string | null;
  duration: number | null;
  organizer_email: string | null;
  participants: string[];
}

export interface Sentence {
  index?: number | null;
  speaker_name?: string | null;
  speaker_id?: string | number | null;
  text?: string | null;
  raw_text?: string | null;
  start_time?: number | string | null;
  end_time?: number | string | null;
}

/** The raw GET_QUERY object (api.py). */
export interface Transcript {
  id: string;
  title?: string | null;
  date?: number | string | null;
  dateString?: string | null;
  duration?: number | null;
  organizer_email?: string | null;
  host_email?: string | null;
  participants?: string[] | null;
  transcript_url?: string | null;
  speakers?: Array<{
    id?: string | number | null;
    name?: string | null;
  }> | null;
  sentences?: Sentence[] | null;
}

export interface Turn {
  at: string;
  speaker: string;
  text: string;
}

/** ISO 8601 UTC string from dateString, else `date` in epoch ms (formatting.iso_date). */
export function isoDate(t: Transcript): string | null {
  if (typeof t.dateString === "string" && t.dateString !== "") {
    return t.dateString;
  }
  const ms = Number(t.date);
  if (t.date === null || t.date === undefined || !Number.isFinite(ms)) {
    return null;
  }
  return new Date(ms).toISOString();
}

/** Compact UTC date for agents: `2024-04-22 20:14Z`, or `unknown`. */
export function compactDate(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "unknown";
  const s = new Date(time).toISOString();
  return `${s.slice(0, 10)} ${s.slice(11, 16)}Z`;
}

/** Fireflies duration is in minutes: `32.5m`, or `unknown`. */
export function formatDuration(minutes: unknown): string {
  const n = typeof minutes === "string" ? Number(minutes) : minutes;
  if (typeof n !== "number" || !Number.isFinite(n)) return "unknown";
  return `${Math.round(n * 10) / 10}m`;
}

/** start_time arrives as a number or numeric string of seconds (formatting.to_seconds). */
export function toSeconds(value: unknown): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/** `HH:MM:SS` (formatting.timestamp). */
export function timestamp(value: unknown): string {
  const total = Math.floor(toSeconds(value));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((x) => String(x).padStart(2, "0")).join(":");
}

export function speakerOf(s: Sentence): string {
  if (s.speaker_name) return String(s.speaker_name);
  if (
    s.speaker_id !== null &&
    s.speaker_id !== undefined &&
    s.speaker_id !== ""
  )
    return `Speaker ${s.speaker_id}`;
  return "Unknown";
}

/** Sentences sorted by index, nulls last (formatting._sentences). */
export function sortedSentences(t: Transcript): Sentence[] {
  const list = [...(t.sentences ?? [])];
  return list
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const an = a.s.index === null || a.s.index === undefined;
      const bn = b.s.index === null || b.s.index === undefined;
      if (an !== bn) return an ? 1 : -1;
      const diff = (a.s.index ?? 0) - (b.s.index ?? 0);
      return diff !== 0 ? diff : a.i - b.i;
    })
    .map(({ s }) => s);
}

/** Merge consecutive same-speaker sentences into turns (formatting.render_md). */
export function mergeTurns(sentences: Sentence[]): Turn[] {
  const turns: Array<{ at: string; speaker: string; texts: string[] }> = [];
  for (const s of sentences) {
    const speaker = speakerOf(s);
    const text = (s.text ?? "").replace(/\s*\n\s*/g, " ").trim();
    const last = turns.at(-1);
    if (last && last.speaker === speaker) {
      last.texts.push(text);
    } else {
      turns.push({ at: timestamp(s.start_time), speaker, texts: [text] });
    }
  }
  return turns.map((t) => ({
    at: t.at,
    speaker: t.speaker,
    text: t.texts.filter((x) => x !== "").join(" "),
  }));
}
