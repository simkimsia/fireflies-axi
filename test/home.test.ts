import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/fireflies.js", () => ({
  firefliesJson: vi.fn(),
  firefliesExec: vi.fn(),
}));

import { homeCommand } from "../src/commands/home.js";
import { AxiError, mapFirefliesError } from "../src/errors.js";
import { firefliesJson } from "../src/fireflies.js";

const json = vi.mocked(firefliesJson);

beforeEach(() => {
  json.mockReset();
});

describe("homeCommand", () => {
  it("shows the 5 most recent meetings", async () => {
    json.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        id: `id${i}`,
        title: `Meeting ${i}`,
        date: "2024-04-22T20:14:04.454Z",
        duration: 30,
        organizer_email: null,
        participants: [],
      })),
    );
    const out = await homeCommand();
    expect(out).toContain("count: 5 most recent meetings");
    expect(out).toContain("transcripts[5]{id,date,duration,title}:");
    expect(out).toContain('id4,"2024-04-22 20:14Z",30m,Meeting 4');
    expect(out).toContain(
      "Run `fireflies-axi transcripts --limit 50` for more meetings",
    );
  });

  it("says when the account is empty", async () => {
    json.mockResolvedValue([]);
    const out = await homeCommand();
    expect(out).toContain(
      "transcripts: 0 meetings found in this Fireflies account",
    );
    expect(out).toContain(
      "Record or upload a meeting in Fireflies, then rerun `fireflies-axi`",
    );
  });

  it("degrades an AUTH failure to state instead of throwing", async () => {
    json.mockImplementation(async () => {
      throw mapFirefliesError(3, "fireflies: FIREFLIES_API_KEY is not set.\n");
    });
    const out = await homeCommand();
    expect(out).toContain(
      "transcripts: unavailable (AUTH: FIREFLIES_API_KEY is not set)",
    );
    expect(out).toContain("help[1]:");
    expect(out).toContain("Do not ask them to paste the key into the chat");
  });

  it("still throws an UNKNOWN failure", async () => {
    json.mockImplementation(async () => {
      throw new AxiError("boom", "UNKNOWN");
    });
    await expect(homeCommand()).rejects.toMatchObject({ code: "UNKNOWN" });
  });
});
