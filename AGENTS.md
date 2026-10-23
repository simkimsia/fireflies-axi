# Project agent memory

Project-intrinsic knowledge for agents working on fireflies-axi.

## What this is

This repo ships two binaries. `fireflies` is a plain Python CLI over the
Fireflies.ai GraphQL API (`src/fireflies_cli/`, tests in `tests/`).
`fireflies-axi` is an AXI-compliant wrapper around `fireflies`, built on
`axi-sdk-js` (`runAxiCli` in `src/cli.ts`) and deliberately modeled on the
reference implementation [gh-axi](https://github.com/kunchenguid/gh-axi) and
the sibling [railway-axi](https://github.com/simkimsia/railway-axi). When
adding a capability, check how gh-axi solved the analogous problem first, and
follow the AXI principles (the `axi` skill in the upstream `kunchenguid/axi`
repo). Scope is in [VISION.md](VISION.md).

## Architecture

- `bin/fireflies-axi.ts`: entrypoint; answers bare `-v`/`-V`/`--version` via
  `axi-sdk-js/fast-path` before dynamically importing `src/cli.ts`.
  `src/version.ts` must stay a LEAF module (node builtins only) or the fast
  path silently stops being fast. It prints the npm package version, not the
  Python one.
- `src/fireflies.ts`: sole place that spawns the `fireflies` binary (bare
  name, resolved on PATH, no shell, no `env` option). Non-zero exits route
  through `scrubSecrets` then `mapFirefliesError`; ENOENT maps to
  `FIREFLIES_NOT_INSTALLED`, a timeout kill (120 s) to `API_ERROR`, and
  non-JSON stdout to `UNKNOWN` without echoing it. `AXI_DEBUG=1` prints the
  forwarded argv on stderr.
- `src/errors.ts`: `mapFirefliesError` maps by **exit code**, not by stderr
  regex, because the Python CLI's exit codes are a documented contract.
  Messages are authored here; only exit 1, 6 and unknown codes relay one
  scrubbed stderr line (prefix stripped, capped at 200 chars).
- `src/scrub.ts`: masks credential-shaped text (key assignments, Bearer
  tokens, UUIDs, long mixed tokens) without reading the key.
- `src/args.ts`: commands pull the flags they know with the `take*` helpers,
  then `assertNoArgs` rejects whatever is left by name with exit code 2
  before any `fireflies` call (AXI §6), and lists the valid flags.
- `src/transcript-model.ts`: TS port of the parts of `formatting.py` the
  wrapper needs (ISO date, `HH:MM:SS`, sentence sort, speaker-turn merge).
- Commands live in `src/commands/`, return TOON strings via `src/toon.ts`
  helpers; errors render through the `formatError` hook in `src/cli.ts`
  because the SDK's default formatter only recognizes its own AxiError class.

## fireflies CLI notes (verified against fireflies 0.1.0)

- `fireflies transcripts list --limit N --skip M` prints a JSON array of
  `{id, title, date (ISO), duration, organizer_email, participants[]}`
  (`formatting.summary_row`). There is no total count; the Python CLI pages
  internally by 50 per request.
- `fireflies transcript get <id> --format json` prints the raw `GET_QUERY`
  object (`api.py`): `id, title, date (epoch ms), dateString, duration,
organizer_email, host_email, participants, transcript_url, speakers[{id,name}],
sentences[{index, speaker_name, speaker_id, text, raw_text, start_time, end_time}]`.
- `fireflies transcript download <id> --format text|md|json --dir D` writes
  `<date>_<title-slug>_<id>.<ext>` (overwriting) and prints the path on stdout.
- `duration` is in minutes; `start_time`/`end_time` are seconds (number or
  numeric string). `sentences` is empty while Fireflies is still processing.
- Errors go to stderr as `fireflies: <message>`; argparse usage errors print
  `usage: ...` instead. Exit codes: 1 write failed, 2 usage, 3 key missing or
  malformed, 4 auth failed, 5 not found, 6 network/API (30 s request
  timeout), 7 rate limited (a Retry-After of 30 s or less is retried once
  automatically), 130 interrupted.
- The SDK ships `update` as a reserved built-in, so `fireflies-axi update`
  works with no code here; the npm package name resolves from `package.json`.

## API key rule

`fireflies-axi` never reads `FIREFLIES_API_KEY`: no `process.env` lookup, no
`.env` loading, no `env:` option on `execFile`. The child inherits the
environment. `test/secret-leak.test.ts` enforces this statically and sweeps
credential-shaped canaries through every command and exit code. Tests never
read `.env`; it may hold a real key.

## Python CLI shares the root

`pyproject.toml`, `uv.lock`, `src/fireflies_cli/` and `tests/` belong to the
Python CLI. tsconfig includes only `.ts` files, hatch builds only
`src/fireflies_cli`, Vitest only matches `test/**/*.test.ts`, and pytest only
reads `tests/`. Run both suites: `pnpm test` and `uv run pytest -q`. The npm
tarball never ships the Python CLI, and `pyproject.toml`'s version is bumped
by hand, separately from release-please.

## Conventions

- pnpm, Node >= 20, ES modules, TypeScript Node16 resolution
  (import specifiers end in `.js`), Vitest tests in `test/`.
- Tests are OFFLINE: they feed fixtures shaped like real `fireflies` output
  and never spawn the real binary or touch the network.
- Conventional commit messages (`feat:`, `fix:`, `docs:`). Releases are cut by
  release-please from those commits and published to npm by trusted publishing.

## Maintaining this file

Keep entries concise and durable; point at the authoritative file rather than
restating what the code shows. Prefer rewriting or pruning over appending.
