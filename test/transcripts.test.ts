import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/fireflies.js", () => ({
  firefliesJson: vi.fn(),
  firefliesExec: vi.fn(),
}));

import { transcriptsCommand } from "../src/commands/transcripts.js";
import { firefliesJson } from "../src/fireflies.js";
import type { ListRow } from "../src/transcript-model.js";

const json = vi.mocked(firefliesJson);

// Shaped by formatting.summary_row (src/fireflies_cli/formatting.py).
function row(i: number): ListRow {
  return {
    id: `id${i}`,
    title: `Meeting ${i}`,
    date: "2024-04-22T20:14:04.454Z",
    duration: 32.5,
    organizer_email: "alice@example.com",
    participants: ["alice@example.com", "bob@example.com", "carol@example.com"],
  };
}
const rows = (n: number) => Array.from({ length: n }, (_, i) => row(i));

beforeEach(() => {
  json.mockReset();
});

describe("transcriptsCommand", () => {
  it("defaults to --limit 20 --skip 0", async () => {
    json.mockResolvedValue([]);
    await transcriptsCommand([]);
    expect(json).toHaveBeenCalledWith([
      "transcripts",
      "list",
      "--limit",
      "20",
      "--skip",
      "0",
    ]);
  });

  it("clamps --limit at 100", async () => {
    json.mockResolvedValue([]);
    await transcriptsCommand(["--limit", "500"]);
    expect(json.mock.calls[0]![0]).toContain("100");
  });

  it("renders the table with compact date and duration", async () => {
    json.mockResolvedValue(rows(2));
    const out = await transcriptsCommand(["--limit", "5"]);
    expect(out).toContain("count: 2 meetings (skip 0, end of list)");
    expect(out).toContain("transcripts[2]{id,date,duration,title}:");
    expect(out).toContain('id0,"2024-04-22 20:14Z",32.5m,Meeting 0');
    expect(out).not.toContain("More may exist");
  });

  it("hints that more may exist only on a full page", async () => {
    json.mockResolvedValue(rows(3));
    const out = await transcriptsCommand(["--limit", "3", "--skip", "6"]);
    expect(out).toContain("count: 3 meetings (skip 6)");
    expect(out).toContain(
      "More may exist: run `fireflies-axi transcripts --limit 3 --skip 9`",
    );
  });

  it("adds --fields columns, participants as a count", async () => {
    json.mockResolvedValue(rows(1));
    const out = await transcriptsCommand([
      "--fields",
      "organizer,participants",
    ]);
    expect(out).toContain(
      "transcripts[1]{id,date,duration,title,organizer,participants}:",
    );
    expect(out).toContain("alice@example.com,3");
  });

  it("rejects an unknown field and lists the valid ones", async () => {
    await expect(
      transcriptsCommand(["--fields", "summary"]),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      suggestions: ["valid fields: organizer, participants"],
    });
    expect(json).not.toHaveBeenCalled();
  });

  it("says when the account has no meetings", async () => {
    json.mockResolvedValue([]);
    expect(await transcriptsCommand([])).toBe(
      "transcripts: 0 meetings found in this Fireflies account",
    );
  });

  it("says when --skip is past the end", async () => {
    json.mockResolvedValue([]);
    const out = await transcriptsCommand(["--skip", "40"]);
    expect(out).toContain("transcripts: 0 meetings at --skip 40 (end of list)");
    expect(out).toContain(
      "Run `fireflies-axi transcripts --skip 0` for the most recent",
    );
  });

  it("rejects an unknown flag by name without calling fireflies", async () => {
    await expect(transcriptsCommand(["--stat", "x"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "unknown flag --stat for `transcripts`",
    });
    expect(json).not.toHaveBeenCalled();
  });

  it("rejects a negative --skip without calling fireflies", async () => {
    await expect(transcriptsCommand(["--skip=-1"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(json).not.toHaveBeenCalled();
  });
});
