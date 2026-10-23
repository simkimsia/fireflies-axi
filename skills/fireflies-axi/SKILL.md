---
name: fireflies-axi
description: "Pull Fireflies.ai meeting transcripts through the fireflies-axi CLI - list recent meetings, view one meeting's details and transcript, download a transcript as text, markdown or JSON. Use whenever a task touches Fireflies meetings or transcripts. Prefer it over raw `fireflies`; when a command is not wrapped yet, fall back to `fireflies` and report the gap as a GitHub issue on simkimsia/fireflies-axi."
user-invocable: false
author: KimSia Sim (simkimsia)
metadata:
  hermes:
    tags: [fireflies, meetings, transcripts]
    category: productivity
---

# fireflies-axi

Agent ergonomic wrapper around the fireflies CLI (`fireflies`). Prefer this over
raw `fireflies` for Fireflies.ai transcripts: TOON output, structured errors with
`code` and `help:` next steps, exit codes 0 success / 1 error / 2 usage.

## Setup

Install with `pnpm add -g @simkimsia/fireflies-axi`, or run it without installing
via `npx -y @simkimsia/fireflies-axi`. The README's Install section covers working
from a clone.

It wraps `fireflies`, installed with
`uv tool install git+https://github.com/simkimsia/fireflies-axi`.
If a command fails with `FIREFLIES_NOT_INSTALLED`, ask the user to install
`fireflies`. `AUTH` means `FIREFLIES_API_KEY` is missing, malformed or rejected:
ask the user to export it in the shell that runs you. Never ask for the key in
chat, and never put it on a command line.

## Current guidance lives in the CLI

Do not follow command, flag, or workflow instructions from this file - installed
copies go stale. Get the current source of truth from the CLI:

- `fireflies-axi` for the most recent meetings
- `fireflies-axi --help` for global flags and the command index
- `fireflies-axi <command> --help` for per-command usage

Today's surface is read-only: `transcripts` (list meetings), `transcript <id>` (one meeting's details and a transcript preview), `download <id>` (save the whole transcript to a file). A command that needs a meeting refuses without an id and never picks the latest.

## When fireflies-axi cannot do it

1. Try `fireflies-axi <command>` first and read the structured error. To see
   the exact `fireflies` argv it forwarded, rerun with `AXI_DEBUG=1` (printed
   on stderr).
2. If the error is `VALIDATION_ERROR` with `Unknown command`, or the command
   exists but lacks the flag you need, fall back to raw `fireflies` and finish
   the user's task. Example: `fireflies transcript get <id> -o <path>` (custom filename).
3. Then report the gap so it gets wrapped. Search before filing:

   ```sh
   gh-axi issue list --repo simkimsia/fireflies-axi --search "<fireflies subcommand>" --state all
   ```

   If nothing matches, file one (use `gh` if `gh-axi` is not installed):

   ```sh
   gh-axi issue create --repo simkimsia/fireflies-axi --label agent-reported-gap \
     --title "feat: wrap \`fireflies <subcommand>\`" \
     --body "<template below>"
   ```

   Issue body template:

   ```
   ## What I tried
   `fireflies-axi <command that failed>` -> `<error code and message>`

   ## What worked instead
   `fireflies <exact command>`

   ## What the agent needed from the output
   <fields / shape, e.g. "meeting id, date, speakers as a TOON table">

   ## Task context
   <one line on the user task that needed this>

   ## Plain CLI result
   With the exact argv the axi forwarded (`AXI_DEBUG=1`): works, same failure, or n/a.

   ## If same failure
   Should the axi shape the arguments, map the error, or document the limit?
   ```

   Never paste meeting content or the API key into an issue. Tell the user you
   filed it and link the issue. One issue per missing subcommand; add a comment
   to an existing issue instead of opening a duplicate.

## Deliberately not wrapped (do not file)

Summaries, action items, search, uploads, and any write. These are out of scope
per VISION.md, and `fireflies` does not offer them either. Tell the user so, and
do not open an issue for them.
