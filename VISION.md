# Vision

This repo ships two binaries for pulling meeting transcripts out of [Fireflies.ai](https://fireflies.ai).
`fireflies` is a small plain CLI over the Fireflies GraphQL API.
`fireflies-axi` is an agent-ergonomic interface that wraps `fireflies`.

Fireflies has no official CLI, so `fireflies` fills that gap, and `fireflies-axi` follows the same shape as the other vendor axis: it wraps a CLI instead of calling the API itself.

## Scope

The only job is to pull transcripts: list recent meetings, then fetch one meeting's transcript.
Summaries, action items, search, uploads, and every write operation are out of scope until pulling transcripts works end to end and gets used.

`fireflies` is the only component that talks to the Fireflies API, and it is the only one that reads the API key (`FIREFLIES_API_KEY`).
`fireflies-axi` calls the `fireflies` binary for every operation and never reads, prints, or stores the key.
We do not call the Fireflies MCP server.

We accept contributions that expose existing Fireflies capabilities more ergonomically.
We do not add functionality that Fireflies itself does not provide, and we do not embed workflow logic (filing, summarising, routing transcripts) that belongs in the calling agent.

## Interface

`fireflies` is a conventional CLI: JSON on stdout, human-readable errors on stderr, non-zero exit codes on failure.
Its output is the contract that `fireflies-axi` depends on.

`fireflies-axi` must follow validated AXI principles and optimize for autonomous agent use.
Output may be structured, but its structure exists for agent comprehension rather than as a stable API for imperative programs.
Errors carry a stable code and a next step the agent can act on.
An unknown flag or argument is rejected by name before any `fireflies` call; it is never accepted silently.
When a command needs a meeting that is not named, it refuses and points at the command that lists meetings; it never guesses.

## Safety

Every command is read-only and never changes Fireflies state.
The API key comes from the environment, never from a flag, and never appears in output, errors, or logs.
