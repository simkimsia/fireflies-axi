# fireflies-axi

Pull meeting transcripts from [Fireflies.ai](https://fireflies.ai), from the shell or from an agent.

- `fireflies`: a plain CLI over the Fireflies GraphQL API (reads `FIREFLIES_API_KEY`)
- `fireflies-axi`: an [AXI](https://axi.md) wrapper around `fireflies`, with TOON output and structured errors

See [VISION.md](VISION.md) for scope.

## Status

Scaffold only. No code yet.

Planned v0:

- `fireflies transcripts list [--limit N]`
- `fireflies transcript get <id> [--format text|json]`
- matching `fireflies-axi` commands

## Requirements

- Node.js >= 20
- A Fireflies API key (Fireflies → Settings → Developer settings), exported as `FIREFLIES_API_KEY`
