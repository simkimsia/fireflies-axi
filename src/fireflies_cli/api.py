"""Thin GraphQL client for the Fireflies API (standard library only)."""

from __future__ import annotations

import json
import os
import re
import socket
import sys
import time
import urllib.error
import urllib.request
from typing import Any

from . import __version__

API_URL = "https://api.fireflies.ai/graphql"
ENV_KEY = "FIREFLIES_API_KEY"
TIMEOUT_SECONDS = 30
PAGE_MAX = 50  # Fireflies caps `limit` at 50 per query.
MAX_AUTO_RETRY_WAIT = 30  # seconds; longer Retry-After values fail fast instead.

# Exit codes (2 = usage, raised by argparse).
EXIT_MISSING_KEY = 3
EXIT_AUTH = 4
EXIT_NOT_FOUND = 5
EXIT_API = 6
EXIT_RATE_LIMITED = 7

AUTH_CODES = {"auth_failed", "unauthenticated", "unauthorized", "invalid_api_key"}

LIST_QUERY = """
query List($limit: Int, $skip: Int) {
  transcripts(limit: $limit, skip: $skip) {
    id title date duration organizer_email participants
  }
}
"""

GET_QUERY = """
query Transcript($id: String!) {
  transcript(id: $id) {
    id title date dateString duration organizer_email host_email participants transcript_url
    speakers { id name }
    sentences { index speaker_name speaker_id text raw_text start_time end_time }
  }
}
"""


class FirefliesError(Exception):
    def __init__(self, message: str, exit_code: int = EXIT_API):
        super().__init__(message)
        self.message = message
        self.exit_code = exit_code


class MissingKeyError(FirefliesError):
    def __init__(self) -> None:
        super().__init__(
            f"{ENV_KEY} is not set.\n"
            "Get an API key in Fireflies: Settings -> Developer settings, then run:\n"
            f"  export {ENV_KEY}=<your key>",
            EXIT_MISSING_KEY,
        )


_KEY_RE = re.compile(r"[\x21-\x7e]+")


def get_api_key() -> str:
    key = os.environ.get(ENV_KEY, "").strip()
    if not key:
        raise MissingKeyError()
    if not _KEY_RE.fullmatch(key):
        # Never echo the key: it may be partly valid and this message goes to stderr.
        raise FirefliesError(
            f"{ENV_KEY} contains whitespace, control or non-ASCII characters "
            "(often a bad paste). Re-copy the key and export it again.",
            EXIT_MISSING_KEY,
        )
    return key


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Refuse redirects: the stdlib handler would copy Authorization to the new host."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def _open(req: urllib.request.Request, timeout: float):
    """Indirection point so tests can mock the HTTP layer."""
    return _OPENER.open(req, timeout=timeout)


def _sleep(seconds: float) -> None:
    time.sleep(seconds)


def _scrub(text: str, key: str) -> str:
    if key and text:
        text = text.replace(key, "***")
    return text


def _first_error(errors: list[dict[str, Any]]) -> tuple[str, dict[str, Any]]:
    first = errors[0] if errors and isinstance(errors[0], dict) else {}
    ext = first.get("extensions") or {}
    code = str(first.get("code") or ext.get("code") or "").lower()
    return code, ext


def _is_rate_limited(errors: list[dict[str, Any]]) -> bool:
    code, ext = _first_error(errors)
    return code == "too_many_requests" or ext.get("status") == 429


def _retry_wait_from_errors(errors: list[dict[str, Any]] | None) -> int | None:
    """Seconds to wait, from errors[0].extensions.metadata.retryAfter (epoch ms)."""
    if not errors:
        return None
    _, ext = _first_error(errors)
    retry = (ext.get("metadata") or {}).get("retryAfter")
    if isinstance(retry, bool) or not isinstance(retry, (int, float)):
        return None
    return max(0, int(retry / 1000 - time.time() + 0.999))


def _error_from_graphql(errors: list[dict[str, Any]], http_status: int | None) -> FirefliesError:
    first = errors[0] if errors and isinstance(errors[0], dict) else {}
    code, ext = _first_error(errors)
    status = ext.get("status") or http_status
    message = str(first.get("message") or "unknown error")
    label = f"{message} ({code})" if code else message

    if code in AUTH_CODES or status == 401:
        return FirefliesError(
            f"Authentication failed: {label}. Check that {ENV_KEY} holds a valid key "
            "(Fireflies -> Settings -> Developer settings).",
            EXIT_AUTH,
        )
    if code == "object_not_found" or status == 404:
        return FirefliesError(f"Not found: {label}", EXIT_NOT_FOUND)
    if code == "too_many_requests" or status == 429:
        wait = _retry_wait_from_errors(errors)
        hint = f" Retry in about {wait}s." if wait is not None else ""
        return FirefliesError(f"Rate limited by Fireflies: {label}.{hint}", EXIT_RATE_LIMITED)
    return FirefliesError(f"Fireflies API error: {label}", EXIT_API)


def graphql(query: str, variables: dict[str, Any], api_key: str | None = None) -> dict[str, Any]:
    """POST a GraphQL query and return `data`. Raises FirefliesError on any failure."""
    key = api_key or get_api_key()
    try:
        return _graphql(query, variables, key)
    except FirefliesError as exc:
        exc.message = _scrub(exc.message, key)
        exc.args = (exc.message,)
        raise


def _graphql(query: str, variables: dict[str, Any], key: str, retried: bool = False) -> dict[str, Any]:
    body = json.dumps({"query": query, "variables": variables}).encode("utf-8")
    req = urllib.request.Request(
        API_URL,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": f"Bearer {key}",
            "User-Agent": f"fireflies-cli/{__version__}",
        },
    )
    http_status: int | None = None
    try:
        with _open(req, TIMEOUT_SECONDS) as resp:
            http_status = getattr(resp, "status", 200)
            raw = resp.read()
    except urllib.error.HTTPError as exc:
        http_status = exc.code
        try:
            raw = exc.read()
        except Exception:
            raw = b""
        payload = _parse(raw)
        errors = payload.get("errors") if payload else None
        if 300 <= exc.code < 400:
            raise FirefliesError(
                f"Fireflies API answered with a redirect (HTTP {exc.code}); refusing to follow it "
                "so the API key is not sent elsewhere.",
                EXIT_API,
            ) from None
        if exc.code == 429:
            retry_after = _retry_after_seconds(exc.headers)
            if retry_after is None:
                retry_after = _retry_wait_from_errors(errors)
            if not retried and retry_after is not None and retry_after <= MAX_AUTO_RETRY_WAIT:
                _sleep(retry_after)
                return _graphql(query, variables, key, retried=True)
            if errors and _retry_after_seconds(exc.headers) is None:
                raise _error_from_graphql(errors, 429) from None
            wait = f" Retry in {retry_after}s." if retry_after is not None else ""
            raise FirefliesError(f"Rate limited by Fireflies (HTTP 429).{wait}", EXIT_RATE_LIMITED) from None
        if errors:
            raise _error_from_graphql(errors, exc.code) from None
        if exc.code in (401, 403):
            raise _error_from_graphql([{"message": f"HTTP {exc.code}", "code": "auth_failed"}], exc.code) from None
        raise FirefliesError(f"Fireflies API returned HTTP {exc.code} {exc.reason}", EXIT_API) from None
    except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError, OSError) as exc:
        reason = getattr(exc, "reason", exc)
        raise FirefliesError(f"Network error talking to Fireflies: {reason}", EXIT_API) from None
    except ValueError:
        # e.g. http.client "Invalid header value b'Bearer <key>'": never surface its text.
        raise FirefliesError("Could not build the request to Fireflies (invalid header value).", EXIT_API) from None

    payload = _parse(raw)
    if payload is None:
        raise FirefliesError(f"Fireflies returned a non-JSON response (HTTP {http_status})", EXIT_API)
    errors = payload.get("errors")
    data = payload.get("data")
    usable = isinstance(data, dict) and any(v is not None for v in data.values())
    if errors and not usable:
        if not retried and _is_rate_limited(errors):
            wait = _retry_wait_from_errors(errors)
            if wait is not None and wait <= MAX_AUTO_RETRY_WAIT:
                _sleep(wait)
                return _graphql(query, variables, key, retried=True)
        raise _error_from_graphql(errors, http_status)
    if not isinstance(data, dict):
        raise FirefliesError("Fireflies response had no data", EXIT_API)
    if errors:
        for err in errors:
            msg = err.get("message") if isinstance(err, dict) else err
            print(f"fireflies: warning: {_scrub(str(msg or 'unknown error'), key)}", file=sys.stderr)
    return data


def _parse(raw: bytes) -> dict[str, Any] | None:
    try:
        payload = json.loads(raw.decode("utf-8") if raw else "")
    except (ValueError, UnicodeDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _retry_after_seconds(headers) -> int | None:
    if not headers:
        return None
    value = headers.get("Retry-After")
    try:
        return max(0, int(float(value)))
    except (TypeError, ValueError):
        return None


def list_transcripts(limit: int, skip: int = 0, api_key: str | None = None) -> list[dict[str, Any]]:
    """Fetch up to `limit` transcripts starting at `skip`, paging by 50."""
    key = api_key or get_api_key()
    results: list[dict[str, Any]] = []
    while len(results) < limit:
        page_size = min(PAGE_MAX, limit - len(results))
        data = graphql(LIST_QUERY, {"limit": page_size, "skip": skip + len(results)}, key)
        page = data.get("transcripts") or []
        results.extend(page)
        if len(page) < page_size:
            break
    return results


def get_transcript(transcript_id: str, api_key: str | None = None) -> dict[str, Any]:
    data = graphql(GET_QUERY, {"id": transcript_id}, api_key)
    transcript = data.get("transcript")
    if not transcript:
        raise FirefliesError(f"Not found: no transcript with id {transcript_id!r}", EXIT_NOT_FOUND)
    return transcript
