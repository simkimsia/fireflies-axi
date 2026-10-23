/**
 * Defensive scrub of child stderr before any of it can reach an error message.
 *
 * fireflies-axi never reads FIREFLIES_API_KEY (VISION.md Safety), so it cannot
 * mask the exact value; instead it masks anything shaped like a credential.
 * The Python CLI already replaces the exact key with *** itself; this is the
 * second layer.
 */
const KEY_ASSIGNMENT = /(FIREFLIES_API_KEY\s*[=:]\s*)\S+/g;
const BEARER = /\b(Bearer|Authorization:?)\s+\S+/gi;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const LONG_RUN = /[A-Za-z0-9_\-+/=]{32,}/g;

export function scrubSecrets(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      maskLongRuns(
        line
          .replace(KEY_ASSIGNMENT, "$1***")
          .replace(BEARER, "$1 ***")
          .replace(UUID, "***"),
      ),
    )
    .join("\n");
}

/**
 * Mask runs of 32+ token characters holding both a letter and a digit. A run
 * inside a whitespace-delimited word that has a `.` or a path separator is
 * kept, so file paths and filenames (`2024-04-22_weekly-sync_<id>.md`) in a
 * WRITE_FAILED message stay readable.
 */
function maskLongRuns(line: string): string {
  return line.replace(LONG_RUN, (run, offset: number) => {
    if (!/[A-Za-z]/.test(run) || !/\d/.test(run)) return run;
    const word = wordAround(line, offset, run.length).replace(
      /[.,;:!?)'"`\]]+$/,
      "",
    );
    if (/[./\\]/.test(word)) return run;
    return "***";
  });
}

function wordAround(line: string, start: number, length: number): string {
  let from = start;
  while (from > 0 && !/\s/.test(line[from - 1])) from--;
  let to = start + length;
  while (to < line.length && !/\s/.test(line[to])) to++;
  return line.slice(from, to);
}
