"""`fireflies` command-line entry point."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import __version__, api
from .formatting import download_filename, render, summary_row

FORMATS = ["text", "json", "md"]


def _positive_int(value: str) -> int:
    try:
        n = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError(f"not an integer: {value!r}") from None
    if n < 1:
        raise argparse.ArgumentTypeError("must be >= 1")
    return n


def _non_negative_int(value: str) -> int:
    try:
        n = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError(f"not an integer: {value!r}") from None
    if n < 0:
        raise argparse.ArgumentTypeError("must be >= 0")
    return n


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="fireflies",
        description="Read-only CLI for Fireflies.ai transcripts. Reads the API key from FIREFLIES_API_KEY.",
        allow_abbrev=False,
    )
    p.add_argument("--version", action="version", version=f"fireflies {__version__}")
    sub = p.add_subparsers(dest="group", metavar="{transcripts,transcript}")

    ts = sub.add_parser("transcripts", help="list meetings", allow_abbrev=False)
    ts_sub = ts.add_subparsers(dest="action", metavar="{list}")
    ls = ts_sub.add_parser("list", help="list recent transcripts as JSON", allow_abbrev=False)
    ls.add_argument("--limit", type=_positive_int, default=20, help="how many to return (default 20)")
    ls.add_argument("--skip", type=_non_negative_int, default=0, help="offset for paging (default 0)")

    t = sub.add_parser("transcript", help="fetch one transcript", allow_abbrev=False)
    t_sub = t.add_subparsers(dest="action", metavar="{get,download}")
    get = t_sub.add_parser("get", help="print a transcript (stdout or -o PATH)", allow_abbrev=False)
    get.add_argument("id", help="transcript id (see `fireflies transcripts list`)")
    get.add_argument("--format", choices=FORMATS, default="text", help="output format: text (default), md (speaker turns merged), or json (raw API object)")
    get.add_argument("-o", "--output", metavar="PATH", help="write to PATH instead of stdout")

    dl = t_sub.add_parser("download", help="save a transcript to a file with a generated name", allow_abbrev=False)
    dl.add_argument("id", help="transcript id (see `fireflies transcripts list`)")
    dl.add_argument("--format", choices=FORMATS, default="text", help="output format: text (default), md (speaker turns merged), or json (raw API object)")
    dl.add_argument("--dir", default=".", metavar="DIR", help="directory to save into (default: cwd)")

    p._subparsers_for_help = {"transcripts": ts, "transcript": t}  # type: ignore[attr-defined]
    p._action_parsers = {  # type: ignore[attr-defined]
        ("transcripts", "list"): ls,
        ("transcript", "get"): get,
        ("transcript", "download"): dl,
    }
    return p


def _write(path: Path, content: str) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    except OSError as exc:
        raise api.FirefliesError(f"Could not write {path}: {exc.strerror or exc}", 1) from None


def run(args: argparse.Namespace) -> int:
    if args.group == "transcripts":
        rows = [summary_row(t) for t in api.list_transcripts(args.limit, args.skip, api.get_api_key())]
        sys.stdout.write(json.dumps(rows, indent=2, ensure_ascii=False) + "\n")
        return 0

    transcript = api.get_transcript(args.id, api.get_api_key())
    content = render(transcript, args.format)
    if args.action == "get":
        if args.output:
            path = Path(args.output).expanduser()
            _write(path, content)
            print(f"Saved {path}", file=sys.stderr)
        else:
            sys.stdout.write(content)
        return 0

    path = Path(args.dir).expanduser() / download_filename(transcript, args.format)
    _write(path, content)
    print(path)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args, extras = parser.parse_known_args(argv)
    if extras:
        group, action = getattr(args, "group", None), getattr(args, "action", None)
        target = parser._action_parsers.get((group, action)) or parser._subparsers_for_help.get(group, parser)  # type: ignore[attr-defined]
        target.error(f"unrecognized arguments: {' '.join(extras)}")
    if args.group is None or getattr(args, "action", None) is None:
        target = parser._subparsers_for_help.get(args.group, parser)  # type: ignore[attr-defined]
        target.print_help(sys.stderr)
        return 2
    try:
        return run(args)
    except api.FirefliesError as exc:
        print(f"fireflies: {exc.message}", file=sys.stderr)
        return exc.exit_code
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
