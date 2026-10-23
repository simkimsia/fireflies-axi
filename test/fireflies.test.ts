import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

import { execFile } from "node:child_process";
import { downloadCommand } from "../src/commands/download.js";
import { homeCommand } from "../src/commands/home.js";
import { transcriptCommand } from "../src/commands/transcript.js";
import { transcriptsCommand } from "../src/commands/transcripts.js";
import {
  debugLine,
  firefliesExec,
  firefliesJson,
  shellQuote,
} from "../src/fireflies.js";
import { fakeFireflies } from "./fake-fireflies.js";

const spawn = vi.mocked(execFile);

function argvOf(call = 0): string[] {
  return spawn.mock.calls[call]![1] as unknown as string[];
}

beforeEach(() => {
  spawn.mockReset();
});

describe("argv forwarded to fireflies", () => {
  it("home lists the 5 most recent", async () => {
    fakeFireflies({ stdout: "[]" });
    await homeCommand();
    expect(spawn.mock.calls[0]![0]).toBe("fireflies");
    expect(argvOf()).toEqual([
      "transcripts",
      "list",
      "--limit",
      "5",
      "--skip",
      "0",
    ]);
  });

  it("transcripts forwards limit and skip", async () => {
    fakeFireflies({ stdout: "[]" });
    await transcriptsCommand(["--limit", "3", "--skip", "6"]);
    expect(argvOf()).toEqual([
      "transcripts",
      "list",
      "--limit",
      "3",
      "--skip",
      "6",
    ]);
  });

  it("transcript asks for raw JSON", async () => {
    fakeFireflies({ stdout: JSON.stringify({ id: "abc123", sentences: [] }) });
    await transcriptCommand(["abc123"]);
    expect(argvOf()).toEqual([
      "transcript",
      "get",
      "abc123",
      "--format",
      "json",
    ]);
  });

  it("download forwards format and dir, never -o", async () => {
    fakeFireflies({ stdout: "/nonexistent/x.md\n" });
    await downloadCommand(["abc123", "--dir", "/tmp/x"]).catch(() => {});
    expect(argvOf()).toEqual([
      "transcript",
      "download",
      "abc123",
      "--format",
      "md",
      "--dir",
      "/tmp/x",
    ]);
  });

  it("passes no env option, so the child inherits process.env", async () => {
    fakeFireflies({ stdout: "[]" });
    await firefliesJson(["transcripts", "list"]);
    const options = spawn.mock.calls[0]![2] as Record<string, unknown>;
    expect(options).not.toHaveProperty("env");
    expect(options).toMatchObject({
      maxBuffer: 50 * 1024 * 1024,
      timeout: 120_000,
    });
  });
});

describe("spawn failures", () => {
  it("maps ENOENT to FIREFLIES_NOT_INSTALLED with the uv hint", async () => {
    fakeFireflies({ error: { code: "ENOENT" } });
    await expect(firefliesJson(["transcripts", "list"])).rejects.toMatchObject({
      code: "FIREFLIES_NOT_INSTALLED",
      suggestions: expect.arrayContaining([
        "Install it: `uv tool install git+https://github.com/simkimsia/fireflies-axi`",
      ]),
    });
  });

  it("maps non-JSON stdout to UNKNOWN without echoing it", async () => {
    fakeFireflies({ stdout: "Hello from some other fireflies binary" });
    try {
      await firefliesJson(["transcripts", "list"]);
      expect.unreachable("should have thrown");
    } catch (error) {
      const e = error as {
        code: string;
        message: string;
        suggestions: string[];
      };
      expect(e.code).toBe("UNKNOWN");
      expect(e.message).toBe("Unexpected output from the fireflies CLI");
      expect([e.message, ...e.suggestions].join("\n")).not.toContain("Hello");
    }
  });

  it("maps a timeout kill to API_ERROR", async () => {
    fakeFireflies({ error: { killed: true, signal: "SIGTERM", code: null } });
    await expect(firefliesExec(["transcripts", "list"])).rejects.toMatchObject({
      code: "API_ERROR",
      message: "fireflies timed out after 120s",
    });
  });

  it("maps a maxBuffer overflow to UNKNOWN", async () => {
    fakeFireflies({
      error: { killed: true, code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" },
    });
    await expect(firefliesExec(["x"])).rejects.toMatchObject({
      code: "UNKNOWN",
    });
  });
});

describe("AXI_DEBUG", () => {
  let stderr: ReturnType<typeof vi.spyOn>;
  let stdout: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    stderr.mockRestore();
    stdout.mockRestore();
  });

  it("prints one argv line on stderr and nothing on stdout", async () => {
    vi.stubEnv("AXI_DEBUG", "1");
    fakeFireflies({ stdout: "[]" });
    await firefliesJson(["transcripts", "list", "--limit", "5"]);
    expect(stderr.mock.calls.map((c) => c[0])).toEqual([
      "[axi-debug] fireflies transcripts list --limit 5\n",
    ]);
    expect(stdout).not.toHaveBeenCalled();
  });

  it("prints nothing unless set to 1", async () => {
    fakeFireflies({ stdout: "[]" });
    await firefliesJson(["transcripts", "list"]);
    vi.stubEnv("AXI_DEBUG", "true");
    await firefliesJson(["transcripts", "list"]);
    expect(stderr).not.toHaveBeenCalled();
  });

  it("quotes tokens for a copy-pasteable line", () => {
    expect(shellQuote("a b")).toBe("'a b'");
    expect(shellQuote("O'Brien")).toBe(`'O'\\''Brien'`);
    expect(debugLine(["transcript", "get", "a b"])).toBe(
      "[axi-debug] fireflies transcript get 'a b'",
    );
  });
});
