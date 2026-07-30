"""Contrat public des diagnostics IA."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.ai_router import create_ai_router
from backend.config import Settings
from backend.llm_client import LMStudioClient


SECRET_SENTINEL = "router-secret-token-sentinel"
EXPECTED_FIELDS = {
    "ok",
    "status",
    "message",
    "configured",
    "connected",
    "provider",
    "model",
    "latency_ms",
    "error_code",
    "attempts",
}


def make_settings(tmp_path: Path, token: str | None) -> Settings:
    return Settings(
        database_path=tmp_path / "router.db",
        lm_studio_api_token=None,
        lm_studio_base_url="http://127.0.0.1:1234/v1" if token is not None else "",
        lm_studio_model="qwen/qwen3-8b",
        request_timeout_seconds=0.2,
        max_upload_bytes=1024,
        max_pdf_pages=2,
        cors_origins=("http://localhost:5173",),
        llm_max_attempts=2,
        llm_backoff_base_seconds=0.1,
        llm_backoff_max_seconds=0.2,
    )


def make_app(settings: Settings, handler) -> TestClient:
    async def no_sleep(_: float) -> None:
        return None

    llm_client = LMStudioClient(
        settings,
        transport=httpx.MockTransport(handler),
        sleep=no_sleep,
        random_source=lambda: 0.0,
    )
    app = FastAPI()
    app.include_router(create_ai_router(llm_client, settings))
    return TestClient(app)


def test_diagnostic_and_test_contract_when_not_configured(tmp_path):
    calls = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(500)

    with make_app(make_settings(tmp_path, None), handler) as client:
        for method, path in (("get", "/api/ai/diagnostic"), ("post", "/api/ai/test")):
            response = getattr(client, method)(path)
            assert response.status_code == 200
            payload = response.json()
            assert set(payload) == EXPECTED_FIELDS
            assert payload["ok"] is False
            assert payload["status"] == "not_configured"
            assert payload["configured"] is False
            assert payload["connected"] is False
            assert payload["error_code"] == "not_configured"
    assert calls == 0


def test_connection_success_updates_read_only_diagnostic(tmp_path):
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "model": "qwen/qwen3-8b",
                "choices": [{"message": {"content": "OK"}}],
            },
        )

    with make_app(make_settings(tmp_path, SECRET_SENTINEL), handler) as client:
        before = client.get("/api/ai/diagnostic").json()
        assert before["status"] == "ready"
        assert before["ok"] is False

        tested = client.post("/api/ai/test").json()
        assert set(tested) == EXPECTED_FIELDS
        assert tested["ok"] is True
        assert tested["status"] == "connected"
        assert tested["connected"] is True
        assert tested["provider"] == "lm_studio"
        assert tested["model"] == "qwen/qwen3-8b"
        assert tested["latency_ms"] is not None

        after = client.get("/api/ai/diagnostic").json()
        assert after["status"] == "connected"
        assert after["ok"] is True
        assert SECRET_SENTINEL not in json.dumps(after)


def test_connection_failure_returns_only_safe_error_metadata(tmp_path):
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text=f"invalid key: {SECRET_SENTINEL}")

    with make_app(make_settings(tmp_path, SECRET_SENTINEL), handler) as client:
        response = client.post("/api/ai/test")
        assert response.status_code == 200
        payload = response.json()
        assert payload["ok"] is False
        assert payload["status"] == "error"
        assert payload["error_code"] == "authentication_failed"
        assert payload["attempts"] == 1
        assert SECRET_SENTINEL not in response.text
