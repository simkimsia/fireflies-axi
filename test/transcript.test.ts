import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/fireflies.js", () => ({
  firefliesJson: vi.fn(),
  firefliesExec: vi.fn(),
}));

import {
  PREVIEW_BUDGET,
  transcriptCommand,
} from "../src/commands/transcript.js";
import { firefliesJson } from "../src/fireflies.js";
import {
  mergeTurns,
  sortedSentences,
  timestamp,
  type Transcript,
} from "../src/transcript-model.js";
import { decode as decodeToon } from "@toon-format/toon";

/** Decode the TOON blocks before the hand-rendered help list. */
function decode(out: string): unknown {
  return decodeToon(out.split("\nhelp[")[0]);
}

const json = vi.mocked(firefliesJson);

// Shaped like the GET_QUERY object in src/fireflies_cli/api.py.
function meeting(overrides: Partial<Transcript> = {}): Transcript {
  return {
    id: "abc123",
    title: "Weekly sync",
    date: 1713816844454,
    dateString: "2024-04-22T20:14:04.454Z",
    duration: 32.5,
    organizer_email: "alice@example.com",
    host_email: null,
    participants: ["alice@example.com", "bob@example.com"],
    transcript_url: "https://app.fireflies.ai/view/abc123",
    speakers: [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ],
    sentences: [
      {
        index: 0,
        speaker_name: "Alice",
        speaker_id: 1,
        text: "Hi all.",
        start_time: 0,
      },
      {
        index: 1,
        speaker_name: "Alice",
        speaker_id: 1,
        text: "Let's start.",
        start_time: 2.5,
      },
      {
        index: 2,
        speaker_name: "Bob",
        speaker_id: 2,
        text: "Sure.",
        start_time: "83.2",
      },
    ],
    ...overrides,
  };
}

function longMeeting(turns: number, chars: number): Transcript {
  return meeting({
    sentences: Array.from({ length: turns }, (_, i) => ({
      index: i,
      speaker_name: i % 2 === 0 ? "Alice" : "Bob",
      speaker_id: i % 2,
      text: "x".repeat(chars),
      start_time: i * 10,
    })),
  });
}

beforeEach(() => {
  json.mockReset();
});

describe("transcriptCommand input", () => {
  it("refuses a missing id without calling fireflies", async () => {
    await expect(transcriptCommand([])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "transcript id is required",
      suggestions: ["Run `fireflies-axi transcripts` to list meeting ids"],
    });
    expect(json).not.toHaveBeenCalled();
  });

  it("rejects a second positional by name", async () => {
    await expect(transcriptCommand(["abc123", "xyz"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "unknown argument xyz for `transcript`",
    });
    expect(json).not.toHaveBeenCalled();
  });

  it("never treats a dash-leading token as the id", async () => {
    await expect(transcriptCommand(["-abc"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "unknown flag -abc for `transcript`",
    });
    expect(json).not.toHaveBeenCalled();
  });

  it("passes the id as NOT_FOUND context", async () => {
    json.mockResolvedValue(meeting());
    await transcriptCommand(["abc123"]);
    expect(json).toHaveBeenCalledWith(
      ["transcript", "get", "abc123", "--format", "json"],
      { id: "abc123" },
    );
  });
});

describe("turn model", () => {
  it("sorts by index (nulls last) and merges same-speaker sentences", () => {
    const turns = mergeTurns(
      sortedSentences({
        id: "x",
        sentences: [
          { index: null, speaker_name: null, speaker_id: null, text: "Last." },
          { index: 2, speaker_name: null, speaker_id: 2, text: "B two." },
          { index: 0, speaker_name: "Alice", text: "A one.", start_time: 1 },
          { index: 1, speaker_name: "Alice", text: "A\ntwo.", start_time: 5 },
          { index: 3, speaker_name: null, speaker_id: 2, text: "B three." },
        ],
      }),
    );
    expect(turns).toEqual([
      { at: "00:00:01", speaker: "Alice", text: "A one. A two." },
      { at: "00:00:00", speaker: "Speaker 2", text: "B two. B three." },
      { at: "00:00:00", speaker: "Unknown", text: "Last." },
    ]);
  });

  it("renders HH:MM:SS from numbers and numeric strings, clamping junk to 0", () => {
    expect(timestamp(3725.9)).toBe("01:02:05");
    expect(timestamp("83.2")).toBe("00:01:23");
    expect(timestamp(-5)).toBe("00:00:00");
    expect(timestamp("abc")).toBe("00:00:00");
    expect(timestamp(null)).toBe("00:00:00");
  });
});

describe("transcriptCommand output", () => {
  it("shows details and all turns with no hints when nothing was cut", async () => {
    json.mockResolvedValue(meeting());
    const out = await transcriptCommand(["abc123"]);
    const parsed = decode(out) as Record<string, any>;
    expect(parsed.transcript).toMatchObject({
      id: "abc123",
      title: "Weekly sync",
      date: "2024-04-22 20:14Z",
      duration: "32.5m",
      organizer: "alice@example.com",
      participants: ["alice@example.com", "bob@example.com"],
      speakers: ["Alice", "Bob"],
      url: "https://app.fireflies.ai/view/abc123",
      content: "2 turns, 3 sentences, 25 chars",
    });
    expect(parsed.turns).toEqual([
      { at: "00:00:00", speaker: "Alice", text: "Hi all. Let's start." },
      { at: "00:01:23", speaker: "Bob", text: "Sure." },
    ]);
    expect(out).not.toContain("help[");
  });

  it("previews within the budget and hints at --full and download", async () => {
    json.mockResolvedValue(longMeeting(20, 612));
    const out = await transcriptCommand(["abc123"]);
    const parsed = decode(out) as Record<string, any>;
    const shown = parsed.turns as Array<{ text: string }>;
    const kept = shown
      .map((t) => t.text.replace(/… \(\d+ chars\)$/, "").length)
      .reduce((a, b) => a + b, 0);
    expect(kept).toBeLessThanOrEqual(PREVIEW_BUDGET);
    expect(shown[0].text).toMatch(/… \(612 chars\)$/);
    expect(out).toContain(
      `Showing ${shown.length} of 20 turns (1500-char preview); run \`fireflies-axi transcript abc123 --full\` for all turns`,
    );
    expect(out).toContain(
      "Run `fireflies-axi download abc123 --format md` to save the whole transcript to a file",
    );
  });

  it("returns every turn uncut with --full and no hints", async () => {
    json.mockResolvedValue(longMeeting(20, 612));
    const out = await transcriptCommand(["abc123", "--full"]);
    const parsed = decode(out) as Record<string, any>;
    expect(parsed.turns).toHaveLength(20);
    expect(out).not.toContain("chars)");
    expect(out).not.toContain("help[");
  });

  it("says the meeting may still be processing when there are no sentences", async () => {
    json.mockResolvedValue(meeting({ sentences: [] }));
    const out = await transcriptCommand(["abc123"]);
    expect(out).toContain(
      "0 turns (no sentences yet; Fireflies may still be processing this meeting)",
    );
    expect(out).toContain(
      "Retry `fireflies-axi transcript abc123` in a few minutes",
    );
  });

  it("omits null fields and caps participants at 10", async () => {
    const many = Array.from({ length: 24 }, (_, i) => `p${i}@example.com`);
    json.mockResolvedValue(
      meeting({
        organizer_email: null,
        transcript_url: null,
        speakers: null,
        participants: many,
      }),
    );
    const out = await transcriptCommand(["abc123"]);
    expect(out).not.toContain("null");
    expect(out).not.toMatch(/organizer:|url:|speakers/);
    expect(out).toContain('participants: "24 (first 10: p0@example.com, ');
    expect(out).not.toContain("p10@example.com");
  });

  it("falls back to the epoch-ms date when dateString is missing", async () => {
    json.mockResolvedValue(meeting({ dateString: null }));
    const out = await transcriptCommand(["abc123"]);
    expect(out).toContain('date: "2024-04-22 20:14Z"');
  });
});
