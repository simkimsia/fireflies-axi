# fireflies-axi

Pull meeting transcripts from [Fireflies.ai](https://fireflies.ai), from the shell or from an agent.

- `fireflies`: a plain CLI over the Fireflies GraphQL API (reads `FIREFLIES_API_KEY`)
- `fireflies-axi`: an [AXI](https://axi.md) wrapper around `fireflies`, with TOON output and structured errors

See [VISION.md](VISION.md) for scope.

## Status

- `fireflies`: v0 works (list, get, download). Standard library only, no runtime dependencies.
- `fireflies-axi`: v0 (transcripts, transcript, download). Read-only.

## Requirements

- Python >= 3.11 and [uv](https://docs.astral.sh/uv/)
- Node.js >= 20, for `fireflies-axi`, which needs `fireflies` on PATH
- A Fireflies API key (Fireflies → Settings → Developer settings), exported as `FIREFLIES_API_KEY`

## Install

```sh
uv tool install git+https://github.com/simkimsia/fireflies-axi
```

Or run it from a clone without installing:

```sh
git clone https://github.com/simkimsia/fireflies-axi
uv --directory fireflies-axi run fireflies --version
```

To keep the key in a file instead of your shell, put `FIREFLIES_API_KEY=<your key>` in `.env` at the repo root (it is gitignored) and pass it to uv:

```sh
uv --directory fireflies-axi run --env-file .env fireflies transcripts list
```

Then install `fireflies-axi`, the agent wrapper:

```sh
pnpm add -g @simkimsia/fireflies-axi
```

Or run it without installing: `npx -y @simkimsia/fireflies-axi --help`.
Check it with `fireflies-axi --version`, and update it later with `fireflies-axi update`.

To work on `fireflies-axi` from a clone:

```sh
git clone https://github.com/simkimsia/fireflies-axi
pnpm -C fireflies-axi install
pnpm -C fireflies-axi run build
pnpm add -g link:$PWD/fireflies-axi   # puts `fireflies-axi` on PATH
```

## Usage: fireflies-axi

`fireflies-axi` never reads the key; the `fireflies` it calls does, from the same environment.

```sh
fireflies-axi                                  # the 5 most recent meetings
fireflies-axi transcripts --limit 50 --skip 50 # page through meetings
fireflies-axi transcripts --fields organizer,participants
fireflies-axi transcript <id>                  # details plus a 1500-char transcript preview
fireflies-axi transcript <id> --full           # every speaker turn
fireflies-axi download <id> --dir ~/transcripts   # save as markdown (default), text or json
fireflies-axi --help
fireflies-axi --version
```

Example output (TOON):

```
count: 20 meetings (skip 0)
transcripts[20]{id,date,duration,title}:
  abc123,"2024-04-22 20:14Z",32.5m,Weekly sync
  ...
help[2]:
  Run `fireflies-axi transcript <id>` for details and a transcript preview
  More may exist: run `fireflies-axi transcripts --limit 20 --skip 20`
```

Errors carry a stable `code` (`AUTH`, `NOT_FOUND`, `RATE_LIMITED`, `API_ERROR`, `WRITE_FAILED`, `VALIDATION_ERROR`, `FIREFLIES_NOT_INSTALLED`, `UNKNOWN`) and a `help` next step.
Set `AXI_DEBUG=1` to print the `fireflies` argv it forwards on stderr.

## Agent skill

Install the bundled skill so your coding agent prefers `fireflies-axi` over raw
`fireflies`, falls back to `fireflies` when a command is not wrapped yet, and
files the gap as an issue here (label `agent-reported-gap`):

```sh
npx skills add simkimsia/fireflies-axi --skill fireflies-axi -g
```

The skill is a discovery stub that defers to `fireflies-axi --help` for current
command guidance. Source: [`skills/fireflies-axi/SKILL.md`](skills/fireflies-axi/SKILL.md).

## Usage: fireflies

```sh
export FIREFLIES_API_KEY=<your key>

# Recent meetings as a JSON array (id, title, date, duration in minutes, organizer_email, participants)
fireflies transcripts list --limit 10
fireflies transcripts list --limit 10 --skip 10

# One transcript to stdout: text (default), md, or json (raw API object)
fireflies transcript get <id>
fireflies transcript get <id> --format md -o meeting.md

# Save with a generated name, e.g. 2024-04-22_weekly-sync_<id>.md; prints the path
fireflies transcript download <id> --format md --dir ~/transcripts
```

Text format looks like:

```
Title: Weekly sync
Date: 2024-04-22T20:14:04.454Z
Duration: 32.5 min
Participants: alice@example.com, bob@example.com
ID: abc123

[00:00:00] Alice: Hi all.
[00:01:23] Bob: Sure.
```

The key is read only from `FIREFLIES_API_KEY`. It is never accepted as a flag and is scrubbed from all output and errors.

## Exit codes

| Code | Meaning                                                                     |
| ---- | --------------------------------------------------------------------------- |
| 0    | success                                                                     |
| 1    | could not write the output file                                             |
| 2    | usage error (unknown flag, missing argument)                                |
| 3    | `FIREFLIES_API_KEY` not set                                                 |
| 4    | authentication failed                                                       |
| 5    | transcript not found (or no access)                                         |
| 6    | network or API error (including 30s timeout)                                |
| 7    | rate limited (a `Retry-After` of 30s or less is retried once automatically) |

## Development

```sh
uv run pytest -q      # the Python fireflies CLI

pnpm install          # fireflies-axi
pnpm run dev          # run from source (tsx)
pnpm test             # vitest
pnpm run build        # tsc -> dist/
pnpm run format:check
```

## Changelog

Release notes for `fireflies-axi` live in [CHANGELOG.md](CHANGELOG.md) and on [GitHub Releases](https://github.com/simkimsia/fireflies-axi/releases).
release-please writes both from conventional commits, so do not edit the file by hand.
Breaking changes, such as a renamed error code, are listed under "⚠ BREAKING CHANGES" and bump the minor version while below 1.0.

## License

MIT
