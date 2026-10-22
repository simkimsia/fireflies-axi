"""Render Fireflies transcripts as text, markdown or JSON."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

EXTENSIONS = {"text": "txt", "md": "md", "json": "json"}


def iso_date(transcript: dict[str, Any]) -> str | None:
    """ISO 8601 UTC string, from dateString or `date` (ms since epoch)."""
    ds = transcript.get("dateString")
    if isinstance(ds, str) and ds:
        return ds
    ms = transcript.get("date")
    try:
        ms = float(ms)
    except (TypeError, ValueError):
        return None
    dt = datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def summary_row(t: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": t.get("id"),
        "title": t.get("title"),
        "date": iso_date(t),
        "duration": t.get("duration"),
        "organizer_email": t.get("organizer_email"),
        "participants": t.get("participants") or [],
    }


def to_seconds(value: Any) -> float:
    """start_time/end_time arrive as a number or numeric string; assume seconds."""
    try:
        return max(0.0, float(value))
    except (TypeError, ValueError):
        return 0.0


def timestamp(value: Any) -> str:
    total = int(to_seconds(value))
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


def _speaker(sentence: dict[str, Any]) -> str:
    name = sentence.get("speaker_name")
    if name:
        return str(name)
    sid = sentence.get("speaker_id")
    return f"Speaker {sid}" if sid not in (None, "") else "Unknown"


def _sentences(t: dict[str, Any]) -> list[dict[str, Any]]:
    s = t.get("sentences") or []
    return sorted(s, key=lambda x: (x.get("index") is None, x.get("index") or 0))


def _header_fields(t: dict[str, Any]) -> list[tuple[str, str]]:
    fields = [("Date", iso_date(t) or "unknown")]
    duration = t.get("duration")
    if duration is not None:
        fields.append(("Duration", f"{duration} min"))
    participants = t.get("participants") or []
    if participants:
        fields.append(("Participants", ", ".join(map(str, participants))))
    fields.append(("ID", str(t.get("id", ""))))
    return fields


def render_text(t: dict[str, Any]) -> str:
    lines = [f"Title: {t.get('title') or '(untitled)'}"]
    lines += [f"{k}: {v}" for k, v in _header_fields(t)]
    lines.append("")
    sentences = _sentences(t)
    if not sentences:
        lines.append("(no sentences in this transcript yet)")
    for s in sentences:
        lines.append(f"[{timestamp(s.get('start_time'))}] {_speaker(s)}: {s.get('text') or ''}".rstrip())
    return "\n".join(lines) + "\n"


def render_md(t: dict[str, Any]) -> str:
    lines = [f"# {t.get('title') or '(untitled)'}", ""]
    lines += [f"- **{k}:** {v}" for k, v in _header_fields(t)]
    lines += ["", "## Transcript", ""]
    turns: list[tuple[str, str, list[str]]] = []
    for s in _sentences(t):
        speaker = _speaker(s)
        text = (s.get("text") or "").strip()
        if turns and turns[-1][0] == speaker:
            turns[-1][2].append(text)
        else:
            turns.append((speaker, timestamp(s.get("start_time")), [text]))
    if not turns:
        lines += ["_No sentences in this transcript yet._", ""]
    for speaker, ts, texts in turns:
        lines.append(f"**{speaker}** [{ts}]: " + " ".join(x for x in texts if x))
        lines.append("")
    return "\n".join(lines).rstrip("\n") + "\n"


def render_json(t: dict[str, Any]) -> str:
    return json.dumps(t, indent=2, ensure_ascii=False) + "\n"


RENDERERS = {"text": render_text, "md": render_md, "json": render_json}


def render(t: dict[str, Any], fmt: str) -> str:
    return RENDERERS[fmt](t)


def slugify(value: str, max_len: int = 60) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug[:max_len].rstrip("-") or "untitled"


def download_filename(t: dict[str, Any], fmt: str) -> str:
    iso = iso_date(t)
    day = iso[:10] if iso and re.match(r"\d{4}-\d{2}-\d{2}", iso) else "undated"
    safe_id = re.sub(r"[^A-Za-z0-9_-]+", "", str(t.get("id") or "")) or "noid"
    return f"{day}_{slugify(str(t.get('title') or ''))}_{safe_id}.{EXTENSIONS[fmt]}"
