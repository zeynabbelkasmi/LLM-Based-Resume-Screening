"""Tests unitaires de résilience du client LM Studio."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import httpx
import pytest

from backend.config import Settings
from backend.llm_client import LMStudioClient, LLMProviderError


SECRET_SENTINEL = "super-secret-token-sentinel"


def make_settings(tmp_path: Path, token: str | None = None) -> Settings:
    return Settings(
        database_path=tmp_path / "client.db",
        lm_studio_api_token=token,
        lm_studio_base_url="http://127.0.0.1:1234/v1",
        lm_studio_model="qwen/qwen3-8b",
        request_timeout_seconds=0.2,
        max_upload_bytes=1024,
        max_pdf_pages=2,
        cors_origins=("http://localhost:5173",),
        llm_max_attempts=3,
        llm_backoff_base_seconds=0.1,
        llm_backoff_max_seconds=1.0,
    )


def completion_response() -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "model": "qwen/qwen3-8b",
            "choices": [{"message": {"content": "OK"}}],
            "usage": {
                "prompt_tokens": 3,
                "completion_tokens": 1,
                "total_tokens": 4,
            },
        },
    )


def run_complete(client: LMStudioClient):
    return asyncio.run(
        client.complete([{"role": "user", "content": "Bonjour"}], max_tokens=8)
    )


def test_success_records_latency_and_attempt_count(tmp_path):
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert "Authorization" not in request.headers
        assert request.url.path == "/v1/chat/completions"
        return completion_response()

    client = LMStudioClient(make_settings(tmp_path), transport=httpx.MockTransport(handler))
    result = run_complete(client)

    assert result["content"] == "OK"
    assert result["attempts"] == 1
    assert result["provider"] == "lm_studio"
    assert result["duration_ms"] >= 0
    assert len(requests) == 1
    diagnostic = client.get_diagnostic()
    assert diagnostic["connected"] is True
    assert diagnostic["error_code"] is None


def test_optional_api_token_is_sent_when_configured(tmp_path):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == f"Bearer {SECRET_SENTINEL}"
        return completion_response()

    client = LMStudioClient(
        make_settings(tmp_path, token=SECRET_SENTINEL),
        transport=httpx.MockTransport(handler),
    )
    assert run_complete(client)["content"] == "OK"


def test_401_is_not_retried_and_never_leaks_provider_body(tmp_path):
    calls = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(401, json={"error": SECRET_SENTINEL})

    client = LMStudioClient(make_settings(tmp_path), transport=httpx.MockTransport(handler))
    with pytest.raises(LLMProviderError) as caught:
        run_complete(client)

    assert caught.value.error_code == "authentication_failed"
    assert caught.value.attempts == 1
    assert calls == 1
    public_data = json.dumps(client.get_diagnostic()) + str(caught.value)
    assert SECRET_SENTINEL not in public_data


def test_429_retries_with_bounded_backoff_then_succeeds(tmp_path):
    calls = 0
    delays: list[float] = []

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls < 3:
            return httpx.Response(
                429,
                headers={"Retry-After": "0"},
                json={"error": SECRET_SENTINEL},
            )
        return completion_response()

    async def fake_sleep(delay: float) -> None:
        delays.append(delay)

    client = LMStudioClient(
        make_settings(tmp_path),
        transport=httpx.MockTransport(handler),
        sleep=fake_sleep,
        random_source=lambda: 0.0,
    )
    result = run_complete(client)

    assert calls == 3
    assert result["attempts"] == 3
    assert delays == [0.1, 0.2]
    assert all(0 <= delay <= 1.0 for delay in delays)


def test_500_retries_are_bounded_and_error_is_sanitized(tmp_path):
    calls = 0
    delays: list[float] = []

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(503, text=f"private upstream failure {SECRET_SENTINEL}")

    async def fake_sleep(delay: float) -> None:
        delays.append(delay)

    client = LMStudioClient(
        make_settings(tmp_path),
        transport=httpx.MockTransport(handler),
        sleep=fake_sleep,
        random_source=lambda: 0.0,
    )
    with pytest.raises(LLMProviderError) as caught:
        run_complete(client)

    assert calls == 3
    assert len(delays) == 2
    assert caught.value.error_code == "provider_unavailable"
    assert caught.value.attempts == 3
    assert SECRET_SENTINEL not in str(caught.value)
    assert SECRET_SENTINEL not in json.dumps(client.get_diagnostic())


def test_timeout_retries_are_bounded(tmp_path):
    calls = 0
    delays: list[float] = []

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        raise httpx.ReadTimeout("upstream timed out", request=request)

    async def fake_sleep(delay: float) -> None:
        delays.append(delay)

    client = LMStudioClient(
        make_settings(tmp_path),
        transport=httpx.MockTransport(handler),
        sleep=fake_sleep,
        random_source=lambda: 0.0,
    )
    with pytest.raises(LLMProviderError) as caught:
        run_complete(client)

    assert calls == 3
    assert len(delays) == 2
    assert caught.value.error_code == "timeout"
    assert caught.value.attempts == 3
    assert caught.value.latency_ms >= 0


def test_malformed_success_is_reported_without_payload_leak(tmp_path):
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"unexpected": SECRET_SENTINEL})

    client = LMStudioClient(make_settings(tmp_path), transport=httpx.MockTransport(handler))
    with pytest.raises(LLMProviderError) as caught:
        run_complete(client)

    assert caught.value.error_code == "invalid_response"
    assert caught.value.attempts == 1
    assert SECRET_SENTINEL not in str(caught.value)
