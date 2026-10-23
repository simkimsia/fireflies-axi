import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/fireflies.js", () => ({
  firefliesJson: vi.fn(),
  firefliesExec: vi.fn(),
}));

import { collapseHome, downloadCommand } from "../src/commands/download.js";
import { mapFirefliesError } from "../src/errors.js";
import { firefliesExec } from "../src/fireflies.js";

const exec = vi.mocked(firefliesExec);
const dir = mkdtempSync(join(tmpdir(), "fireflies-axi-test-"));
const file = join(dir, "2024-04-22_weekly-sync_abc123.md");
writeFileSync(file, "# Weekly sync\n");

beforeEach(() => {
  exec.mockReset();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("downloadCommand", () => {
  it("defaults to md and reports the path and size", async () => {
    exec.mockResolvedValue(`${file}\n`);
    const out = await downloadCommand(["abc123", "--dir", dir]);
    expect(exec).toHaveBeenCalledWith(
      ["transcript", "download", "abc123", "--format", "md", "--dir", dir],
      { id: "abc123" },
    );
    expect(out).toContain("format: md");
    expect(out).toContain(`path: ${collapseHome(file)}`);
    expect(out).toContain("bytes: 14");
    expect(out).not.toContain("help[");
  });

  it("makes a relative printed path absolute", async () => {
    exec.mockResolvedValue(`${relative(process.cwd(), file)}\n`);
    const out = await downloadCommand(["abc123"]);
    expect(out).toContain(`path: ${collapseHome(file)}`);
  });

  it("rejects an invalid --format before calling fireflies", async () => {
    await expect(
      downloadCommand(["abc123", "--format", "pdf"]),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "--format must be one of text, md, json, got pdf",
    });
    expect(exec).not.toHaveBeenCalled();
  });

  it("refuses a missing id and an extra argument before calling fireflies", async () => {
    await expect(downloadCommand([])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "transcript id is required",
    });
    await expect(downloadCommand(["a", "b"])).rejects.toMatchObject({
      message: "unknown argument b for `download`",
    });
    expect(exec).not.toHaveBeenCalled();
  });

  it("surfaces exit 1 as WRITE_FAILED with the parsed path", async () => {
    exec.mockImplementation(async () => {
      throw mapFirefliesError(
        1,
        "fireflies: Could not write /ro/x.md: Permission denied\n",
      );
    });
    await expect(
      downloadCommand(["abc123", "--dir", "/ro"]),
    ).rejects.toMatchObject({
      code: "WRITE_FAILED",
      message: "Could not write /ro/x.md: Permission denied",
    });
  });
});

describe("collapseHome", () => {
  it("collapses the home directory only at a path boundary", () => {
    const home = homedir();
    expect(collapseHome(join(home, "t", "x.md"))).toBe(join("~", "t", "x.md"));
    expect(collapseHome(`${home}other/x`)).toBe(`${home}other/x`);
  });
});
