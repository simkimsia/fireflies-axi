# fireflies-axi

Pull meeting transcripts from [Fireflies.ai](https://fireflies.ai), from the shell or from an agent.

- `fireflies`: a plain CLI over the Fireflies GraphQL API (reads `FIREFLIES_API_KEY`)
- `fireflies-axi`: an [AXI](https://axi.md) wrapper around `fireflies`, with TOON output and structured errors

See [VISION.md](VISION.md) for scope.

## Status

- `fireflies`: v0 works (list, get, download). Standard library only, no runtime dependencies.
- `fireflies-axi`: not started.

## Requirements

- Python >= 3.11 and [uv](https://docs.astral.sh/uv/)
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

## Usage

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

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | could not write the output file |
| 2 | usage error (unknown flag, missing argument) |
| 3 | `FIREFLIES_API_KEY` not set |
| 4 | authentication failed |
| 5 | transcript not found (or no access) |
| 6 | network or API error (including 30s timeout) |
| 7 | rate limited (a `Retry-After` of 30s or less is retried once automatically) |

## Development

```sh
uv run pytest -q
```

## License

MIT
