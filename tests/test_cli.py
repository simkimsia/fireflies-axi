import io
import json
import urllib.error
from email.message import Message

import pytest

from fireflies_cli import __version__, api, cli

KEY = "sk-test-SECRET-key-123"

TRANSCRIPT = {
    "id": "abc123",
    "title": "Weekly Sync: Q3 / Plans!",
    "date": 1713816844454,
    "dateString": "2024-04-22T20:14:04.454Z",
    "duration": 32.5,
    "organizer_email": "alice@example.com",
    "participants": ["alice@example.com", "bob@example.com"],
    "speakers": [{"id": "0", "name": "Alice"}, {"id": "1", "name": "Bob"}],
    "sentences": [
        {"index": 0, "speaker_name": "Alice", "speaker_id": "0", "text": "Hi all.", "raw_text": "hi all", "start_time": 0.48, "end_time": 1.6},
        {"index": 1, "speaker_name": "Alice", "speaker_id": "0", "text": "Let's start.", "raw_text": "lets start", "start_time": "2.1", "end_time": "3.0"},
        {"index": 2, "speaker_name": "Bob", "speaker_id": "1", "text": "Sure.", "raw_text": "sure", "start_time": 83.9, "end_time": 85.0},
    ],
}


class FakeResp:
    def __init__(self, payload, status=200):
        self.status = status
        self._body = json.dumps(payload).encode()

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def http_error(code, payload=None, headers=None):
    msg = Message()
    for k, v in (headers or {}).items():
        msg[k] = v
    body = io.BytesIO(json.dumps(payload).encode() if payload is not None else b"")
    return urllib.error.HTTPError(api.API_URL, code, "err", msg, body)


@pytest.fixture
def mock_http(monkeypatch):
    """Queue responses (FakeResp or exceptions); records requests."""
    state = {"responses": [], "requests": []}

    def fake_open(req, timeout):
        state["requests"].append({"req": req, "timeout": timeout, "body": json.loads(req.data)})
        r = state["responses"].pop(0)
        if isinstance(r, BaseException):
            raise r
        return r

    monkeypatch.setattr(api, "_open", fake_open)
    monkeypatch.setattr(api, "_sleep", lambda s: state.setdefault("slept", []).append(s))
    monkeypatch.setenv("FIREFLIES_API_KEY", KEY)
    return state


def run(argv, capsys):
    code = cli.main(argv)
    out, err = capsys.readouterr()
    assert KEY not in out and KEY not in err
    return code, out, err


def test_version(capsys):
    with pytest.raises(SystemExit) as e:
        cli.main(["--version"])
    assert e.value.code == 0
    assert __version__ in capsys.readouterr().out


def test_unknown_flag_rejected(capsys):
    with pytest.raises(SystemExit) as e:
        cli.main(["transcripts", "list", "--bogus"])
    assert e.value.code == 2
    assert "--bogus" in capsys.readouterr().err


def test_no_command_is_usage_error(capsys):
    assert cli.main([]) == 2


def test_list(mock_http, capsys):
    mock_http["responses"].append(FakeResp({"data": {"transcripts": [TRANSCRIPT]}}))
    code, out, _ = run(["transcripts", "list", "--limit", "5"], capsys)
    assert code == 0
    rows = json.loads(out)
    assert rows == [{
        "id": "abc123", "title": "Weekly Sync: Q3 / Plans!", "date": "2024-04-22T20:14:04.454Z",
        "duration": 32.5, "organizer_email": "alice@example.com",
        "participants": ["alice@example.com", "bob@example.com"],
    }]
    req = mock_http["requests"][0]
    assert req["body"]["variables"] == {"limit": 5, "skip": 0}
    assert req["req"].get_header("Authorization") == f"Bearer {KEY}"
    assert req["timeout"] == 30


def test_list_pages_past_50(mock_http, capsys):
    page1 = [{"id": f"t{i}", "date": 1713816844454} for i in range(50)]
    page2 = [{"id": f"t{i}", "date": 1713816844454} for i in range(50, 60)]
    mock_http["responses"] += [FakeResp({"data": {"transcripts": page1}}), FakeResp({"data": {"transcripts": page2}})]
    code, out, _ = run(["transcripts", "list", "--limit", "70", "--skip", "10"], capsys)
    assert code == 0
    assert len(json.loads(out)) == 60
    assert [r["body"]["variables"] for r in mock_http["requests"]] == [{"limit": 50, "skip": 10}, {"limit": 20, "skip": 60}]


def test_list_date_from_ms_epoch(mock_http, capsys):
    mock_http["responses"].append(FakeResp({"data": {"transcripts": [{"id": "x", "date": 1713816844454}]}}))
    _, out, _ = run(["transcripts", "list"], capsys)
    assert json.loads(out)[0]["date"] == "2024-04-22T20:14:04.454Z"


def test_get_text(mock_http, capsys):
    mock_http["responses"].append(FakeResp({"data": {"transcript": TRANSCRIPT}}))
    code, out, _ = run(["transcript", "get", "abc123"], capsys)
    assert code == 0
    assert "Title: Weekly Sync: Q3 / Plans!" in out
    assert "Participants: alice@example.com, bob@example.com" in out
    assert "[00:00:00] Alice: Hi all." in out
    assert "[00:00:02] Alice: Let's start." in out
    assert "[00:01:23] Bob: Sure." in out
    assert mock_http["requests"][0]["body"]["variables"] == {"id": "abc123"}


def test_get_json(mock_http, capsys):
    mock_http["responses"].append(FakeResp({"data": {"transcript": TRANSCRIPT}}))
    code, out, _ = run(["transcript", "get", "abc123", "--format", "json"], capsys)
    assert code == 0
    assert json.loads(out) == TRANSCRIPT


def test_get_md_merges_speaker_turns(mock_http, capsys):
    mock_http["responses"].append(FakeResp({"data": {"transcript": TRANSCRIPT}}))
    code, out, _ = run(["transcript", "get", "abc123", "--format", "md"], capsys)
    assert code == 0
    assert out.startswith("# Weekly Sync: Q3 / Plans!\n")
    assert "**Alice** [00:00:00]: Hi all. Let's start." in out
    assert "**Bob** [00:01:23]: Sure." in out
    assert out.count("**Alice**") == 1


def test_get_output_file(mock_http, capsys, tmp_path):
    mock_http["responses"].append(FakeResp({"data": {"transcript": TRANSCRIPT}}))
    target = tmp_path / "sub" / "t.md"
    code, out, err = run(["transcript", "get", "abc123", "--format", "md", "-o", str(target)], capsys)
    assert code == 0 and out == ""
    assert str(target) in err
    assert target.read_text().startswith("# Weekly Sync")


def test_download_filename(mock_http, capsys, tmp_path):
    mock_http["responses"].append(FakeResp({"data": {"transcript": TRANSCRIPT}}))
    code, out, _ = run(["transcript", "download", "abc123", "--format", "md", "--dir", str(tmp_path)], capsys)
    assert code == 0
    expected = tmp_path / "2024-04-22_weekly-sync-q3-plans_abc123.md"
    assert out.strip() == str(expected)
    assert expected.exists()


def test_download_default_text_ext(mock_http, capsys, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    mock_http["responses"].append(FakeResp({"data": {"transcript": {**TRANSCRIPT, "title": None, "dateString": None}}}))
    code, out, _ = run(["transcript", "download", "abc123"], capsys)
    assert code == 0
    assert out.strip() == "2024-04-22_untitled_abc123.txt"
    assert (tmp_path / "2024-04-22_untitled_abc123.txt").exists()


def test_missing_key(monkeypatch, capsys):
    monkeypatch.delenv("FIREFLIES_API_KEY", raising=False)
    monkeypatch.setattr(api, "_open", lambda *a, **k: pytest.fail("no HTTP without a key"))
    code, out, err = run(["transcripts", "list"], capsys)
    assert code == 3
    assert "FIREFLIES_API_KEY" in err and "Developer settings" in err and "export" in err


def test_auth_error_graphql_200(mock_http, capsys):
    mock_http["responses"].append(FakeResp({"data": None, "errors": [
        {"message": f"Invalid API key {KEY}", "code": "auth_failed", "extensions": {"code": "auth_failed", "status": 401}}]}))
    code, out, err = run(["transcripts", "list"], capsys)
    assert code == 4
    assert "Authentication failed" in err
    assert "***" in err


def test_auth_error_http_401(mock_http, capsys):
    mock_http["responses"].append(http_error(401, {"errors": [{"message": "Unauthorized", "code": "auth_failed"}]}))
    code, _, err = run(["transcript", "get", "abc123"], capsys)
    assert code == 4


def test_auth_error_http_401_no_body(mock_http, capsys):
    mock_http["responses"].append(http_error(401))
    code, _, _ = run(["transcript", "get", "abc123"], capsys)
    assert code == 4


def test_not_found_graphql_error(mock_http, capsys):
    mock_http["responses"].append(FakeResp({"data": {}, "errors": [
        {"message": "Object not found", "code": "object_not_found", "friendly": True,
         "extensions": {"code": "object_not_found", "status": 404}}]}))
    code, _, err = run(["transcript", "get", "nope"], capsys)
    assert code == 5
    assert "Not found" in err


def test_not_found_null_transcript(mock_http, capsys):
    mock_http["responses"].append(FakeResp({"data": {"transcript": None}}))
    code, _, err = run(["transcript", "get", "nope"], capsys)
    assert code == 5


def test_network_error(mock_http, capsys):
    mock_http["responses"].append(urllib.error.URLError(f"boom {KEY}"))
    code, _, err = run(["transcripts", "list"], capsys)
    assert code == 6
    assert "Network error" in err


def test_timeout(mock_http, capsys):
    mock_http["responses"].append(TimeoutError("timed out"))
    code, _, _ = run(["transcripts", "list"], capsys)
    assert code == 6


def test_http_500(mock_http, capsys):
    mock_http["responses"].append(http_error(500))
    code, _, err = run(["transcripts", "list"], capsys)
    assert code == 6


def test_rate_limited_retries_once(mock_http, capsys):
    mock_http["responses"] += [http_error(429, headers={"Retry-After": "2"}),
                               FakeResp({"data": {"transcripts": []}})]
    code, out, _ = run(["transcripts", "list"], capsys)
    assert code == 0 and json.loads(out) == []
    assert mock_http["slept"] == [2]


def test_rate_limited_long_wait_fails(mock_http, capsys):
    mock_http["responses"].append(http_error(429, headers={"Retry-After": "600"}))
    code, _, err = run(["transcripts", "list"], capsys)
    assert code == 7
    assert "600" in err


def test_rate_limited_graphql_code(mock_http, capsys):
    mock_http["responses"].append(FakeResp({"errors": [{"message": "Too many requests", "code": "too_many_requests"}]}))
    code, _, _ = run(["transcripts", "list"], capsys)
    assert code == 7


def test_invalid_limit(capsys):
    with pytest.raises(SystemExit) as e:
        cli.main(["transcripts", "list", "--limit", "0"])
    assert e.value.code == 2


def test_auth_error_http_500_with_auth_failed_body(mock_http, capsys):
    # Observed live 2026-10-22: a bad key returns HTTP 500 with code auth_failed in the body.
    mock_http["responses"].append(http_error(500, {"data": None, "errors": [
        {"message": "An error occurred while authenticating your request.", "code": "auth_failed",
         "extensions": {"code": "auth_failed", "status": 500}}]}))
    code, _, err = run(["transcripts", "list"], capsys)
    assert code == 4
    assert "Authentication failed" in err


# --- review fixes -----------------------------------------------------------

import time as _time


def _rl_errors(seconds_from_now):
    return [{"message": "Too many requests", "code": "too_many_requests",
             "extensions": {"code": "too_many_requests", "status": 429,
                            "metadata": {"retryAfter": (_time.time() + seconds_from_now) * 1000}}}]


def test_http_429_body_retry_after_retries(mock_http, capsys):
    mock_http["responses"] += [http_error(429, {"errors": _rl_errors(3)}),
                               FakeResp({"data": {"transcripts": []}})]
    code, out, _ = run(["transcripts", "list"], capsys)
    assert code == 0 and json.loads(out) == []
    assert len(mock_http["slept"]) == 1 and 2 <= mock_http["slept"][0] <= 4


def test_http_429_body_long_wait_keeps_hint(mock_http, capsys):
    mock_http["responses"].append(http_error(429, {"errors": _rl_errors(600)}))
    code, _, err = run(["transcripts", "list"], capsys)
    assert code == 7
    assert "Retry in about" in err and "Too many requests" in err
    assert "slept" not in mock_http


def test_graphql_200_rate_limit_retries_once(mock_http, capsys):
    mock_http["responses"] += [FakeResp({"data": None, "errors": _rl_errors(2)}),
                               FakeResp({"data": {"transcripts": []}})]
    code, out, _ = run(["transcripts", "list"], capsys)
    assert code == 0 and json.loads(out) == []
    assert len(mock_http["requests"]) == 2 and len(mock_http["slept"]) == 1


def test_graphql_200_rate_limit_retry_only_once(mock_http, capsys):
    mock_http["responses"] += [FakeResp({"data": None, "errors": _rl_errors(1)}),
                               FakeResp({"data": None, "errors": _rl_errors(1)})]
    code, _, _ = run(["transcripts", "list"], capsys)
    assert code == 7
    assert len(mock_http["requests"]) == 2


def test_partial_errors_with_usable_data_warns(mock_http, capsys):
    mock_http["responses"].append(FakeResp({"data": {"transcript": TRANSCRIPT}, "errors": [
        {"message": f"Cannot resolve speakers {KEY}", "path": ["transcript", "speakers"]}]}))
    code, out, err = run(["transcript", "get", "abc123"], capsys)
    assert code == 0
    assert "Hi all." in out
    assert "warning: Cannot resolve speakers ***" in err


def test_errors_with_null_root_still_fail(mock_http, capsys):
    mock_http["responses"].append(FakeResp({"data": {"transcript": None}, "errors": [
        {"message": "Object not found", "code": "object_not_found"}]}))
    code, _, err = run(["transcript", "get", "nope"], capsys)
    assert code == 5


@pytest.mark.parametrize("bad", ["sk-SECRET\nX-Evil: 1", "sk SECRET", "sk-SECRET\rX", "sk-SEC\tRET", "sk-SÉCRET"])
def test_bad_key_characters_rejected_without_echo(monkeypatch, capsys, bad):
    monkeypatch.setenv("FIREFLIES_API_KEY", bad)
    monkeypatch.setattr(api, "_open", lambda *a, **k: pytest.fail("no HTTP with a bad key"))
    code = cli.main(["transcript", "get", "abc"])
    out, err = capsys.readouterr()
    assert code == 3
    assert "SECRET" not in err and "SECRET" not in out and "SÉCRET" not in err
    assert "FIREFLIES_API_KEY" in err


def test_valueerror_from_http_layer_is_scrubbed(mock_http, capsys):
    mock_http["responses"].append(ValueError(f"Invalid header value b'Bearer {KEY}'"))
    code, _, err = run(["transcripts", "list"], capsys)
    assert code == 6
    assert "Traceback" not in err


def test_redirect_not_followed_and_auth_not_forwarded(monkeypatch, capsys):
    import http.server
    import threading

    seen = []

    class Target(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            seen.append(self.headers.get("Authorization"))
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"data": {"transcripts": []}}')

        def log_message(self, *a):
            pass

    target = http.server.HTTPServer(("127.0.0.1", 0), Target)

    class Redirector(Target):
        def do_POST(self):
            self.send_response(302)
            self.send_header("Location", f"http://127.0.0.1:{target.server_port}/graphql")
            self.end_headers()

    redir = http.server.HTTPServer(("127.0.0.1", 0), Redirector)
    for srv in (target, redir):
        threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        monkeypatch.setattr(api, "API_URL", f"http://127.0.0.1:{redir.server_port}/graphql")
        monkeypatch.setenv("FIREFLIES_API_KEY", KEY)
        code, _, err = run(["transcripts", "list"], capsys)
    finally:
        target.shutdown()
        redir.shutdown()
    assert code == 6
    assert "redirect" in err
    assert seen == []


def test_unknown_flag_after_subcommand_uses_sub_usage(capsys):
    with pytest.raises(SystemExit) as e:
        cli.main(["transcript", "get", "abc", "--bogus"])
    assert e.value.code == 2
    err = capsys.readouterr().err
    assert "usage: fireflies transcript get" in err
    assert "unrecognized arguments: --bogus" in err


def test_unknown_flag_on_list_uses_sub_usage(capsys):
    with pytest.raises(SystemExit):
        cli.main(["transcripts", "list", "--bogus"])
    assert "usage: fireflies transcripts list" in capsys.readouterr().err


@pytest.mark.parametrize("argv", [
    ["transcript", "get", "x", "--form", "md"],
    ["transcript", "download", "x", "--form", "md"],
    ["transcripts", "list", "--lim", "3"],
])
def test_flag_abbreviations_rejected(capsys, argv):
    with pytest.raises(SystemExit) as e:
        cli.main(argv)
    assert e.value.code == 2


@pytest.mark.parametrize("action", ["get", "download"])
def test_format_help_text(capsys, action):
    with pytest.raises(SystemExit):
        cli.main(["transcript", action, "--help"])
    out = capsys.readouterr().out
    assert "text (default)" in out and "raw API object" in out
