import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fake the fireflies binary itself, so the real spawn, scrub and mapping paths
// in src/fireflies.ts, src/scrub.ts and src/errors.ts all run.
vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

import { execFile } from "node:child_process";
import { downloadCommand } from "../src/commands/download.js";
import { homeCommand } from "../src/commands/home.js";
import { transcriptCommand } from "../src/commands/transcript.js";
import { transcriptsCommand } from "../src/commands/transcripts.js";
import { scrubSecrets } from "../src/scrub.js";
import { fakeFireflies } from "./fake-fireflies.js";

// Fake credentials in every shape the scrub must catch. None is a real key.
const CANARIES: Array<{ name: string; inject: string; secret: string }> = [
  {
    name: "uuid",
    inject: "3f2a9c1e-8b7d-4e6f-a5c4-1b2d3e4f5a6b",
    secret: "3f2a9c1e-8b7d-4e6f-a5c4-1b2d3e4f5a6b",
  },
  {
    name: "32-hex",
    inject: "9f86d081884c7d659a2feaa0c55ad015",
    secret: "9f86d081884c7d659a2feaa0c55ad015",
  },
  {
    name: "40-char base64url",
    inject: "Zm9vYmFyX2Jhel9xdXV4LWNhbmFyeV8xMjM0NTY3",
    secret: "Zm9vYmFyX2Jhel9xdXV4LWNhbmFyeV8xMjM0NTY3",
  },
  {
    name: "FIREFLIES_API_KEY=short",
    inject: "FIREFLIES_API_KEY=shortk3y",
    secret: "shortk3y",
  },
  { name: "Bearer short", inject: "Bearer sh0rtb3ar", secret: "sh0rtb3ar" },
];

const EXIT_CODES = [1, 2, 3, 4, 5, 6, 7, 130, 99];

const COMMANDS: Array<{ name: string; run: () => Promise<unknown> }> = [
  { name: "home", run: () => homeCommand() },
  { name: "transcripts", run: () => transcriptsCommand([]) },
  { name: "transcript", run: () => transcriptCommand(["abc123"]) },
  { name: "download", run: () => downloadCommand(["abc123"]) },
];

/** Everything a caller could see: the output, or the rendered error parts. */
async function visible(run: () => Promise<unknown>): Promise<string> {
  try {
    return String(await run());
  } catch (error) {
    const e = error as { message?: string; suggestions?: string[] };
    return [e.message ?? "", ...(e.suggestions ?? [])].join("\n");
  }
}

let debugSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.mocked(execFile).mockReset();
  vi.stubEnv("AXI_DEBUG", "1");
  debugSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  const printed = debugSpy.mock.calls.map((c) => String(c[0])).join("");
  debugSpy.mockRestore();
  vi.unstubAllEnvs();
  for (const c of CANARIES) expect(printed).not.toContain(c.secret);
});

const sweep = CANARIES.flatMap((canary) =>
  COMMANDS.flatMap((command) =>
    EXIT_CODES.map((exitCode) => ({
      label: `${command.name} exit ${exitCode} ${canary.name}`,
      canary,
      command,
      exitCode,
    })),
  ),
);

describe("no credential-shaped text reaches the caller", () => {
  it.each(sweep)("$label", async ({ canary, command, exitCode }) => {
    // The canary sits at the start, in the middle of a sentence, and in a
    // write-failure line, so every relayed position is covered.
    fakeFireflies({
      stderr:
        exitCode === 1
          ? `fireflies: Could not write ${canary.inject}: ${canary.inject}\n`
          : `fireflies: ${canary.inject} failed near ${canary.inject}.\n`,
      exitCode,
    });
    const out = await visible(command.run);
    expect(out).not.toContain(canary.secret);
  });
});

describe("scrubSecrets", () => {
  it("keeps file paths and generated filenames readable", () => {
    const line =
      "Could not write ./2024-04-22_weekly-sync-with-the-whole-team_Ab12Cd34Ef56Gh78.md: Permission denied";
    expect(scrubSecrets(line)).toBe(line);
  });

  it("masks a long token at the end of a sentence", () => {
    expect(
      scrubSecrets("bad key Zm9vYmFyX2Jhel9xdXV4LWNhbmFyeV8xMjM0NTY3."),
    ).toBe("bad key ***.");
  });
});

describe("the wrapper never reads FIREFLIES_API_KEY", () => {
  function tsFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return tsFiles(path);
      return path.endsWith(".ts") ? [path] : [];
    });
  }

  it("no src/**/*.ts touches process.env for the key", () => {
    const files = [
      ...tsFiles(join(__dirname, "..", "src")),
      ...tsFiles(join(__dirname, "..", "bin")),
    ];
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const text = readFileSync(file, "utf-8");
      expect(text, file).not.toMatch(
        /process\.env\s*(\.|\[)\s*["']?FIREFLIES_API_KEY/,
      );
      expect(text, file).not.toMatch(/dotenv|\benv:\s/);
    }
  });
});
