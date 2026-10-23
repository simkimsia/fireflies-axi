import { execFile } from "node:child_process";
import { vi } from "vitest";

// Each test file that imports this must also call
// `vi.mock("node:child_process", () => ({ execFile: vi.fn() }))`.

export interface FakeRun {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  /** Simulate a spawn failure or kill instead of an exit code. */
  error?: Record<string, unknown>;
}

type Callback = (e: unknown, stdout: string, stderr: string) => void;

/** Fake the `fireflies` binary; `run` may depend on the argv it receives. */
export function fakeFireflies(run: FakeRun | ((argv: string[]) => FakeRun)) {
  vi.mocked(execFile).mockImplementation(((...callArgs: unknown[]) => {
    const argv = callArgs[1] as string[];
    const callback = callArgs.at(-1) as Callback;
    const r = typeof run === "function" ? run(argv) : run;
    const exitCode = r.exitCode ?? 0;
    const error = r.error
      ? Object.assign(new Error("spawn"), r.error)
      : exitCode === 0
        ? null
        : Object.assign(new Error("exit"), { code: exitCode });
    callback(error, r.stdout ?? "", r.stderr ?? "");
  }) as unknown as typeof execFile);
}
