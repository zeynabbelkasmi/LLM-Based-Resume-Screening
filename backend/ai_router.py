"""Routes de diagnostic LM Studio, sans exposition de contenu ni de secret."""

from __future__ import annotations

import math
from typing import Any

from fastapi import APIRouter

from .ai_schemas import AIDiagnosticResponse
from .config import Settings
from .llm_client import LMStudioClient, LLMProviderError, safe_error_message


def _safe_latency(value: Any) -> float | None:
    try:
        latency = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    if not math.isfinite(latency) or latency < 0:
        return None
    return round(latency, 2)


def _safe_attempts(value: Any) -> int:
    try:
        return min(max(int(value), 0), 5)
    except (TypeError, ValueError, OverflowError):
        return 0


def _response(
    settings: Settings,
    *,
    configured: bool,
    connected: bool,
    latency_ms: Any = None,
    error_code: str | None = None,
    attempts: Any = 0,
    tested: bool = False,
) -> AIDiagnosticResponse:
    if not configured:
        status = "not_configured"
        message = safe_error_message("not_configured")
        error_code = "not_configured"
    elif connected:
        status = "connected"
        message = "Connexion au serveur local LM Studio opérationnelle."
        error_code = None
    elif not tested and error_code in {None, "not_tested"}:
        status = "ready"
        message = "Configuration détectée. Lancez le test de connexion."
        error_code = None
    else:
        status = "error"
        error_code = error_code if error_code in {
            "authentication_failed",
            "rate_limited",
            "provider_unavailable",
            "timeout",
            "network_error",
            "request_rejected",
            "invalid_response",
            "internal_error",
        } else "internal_error"
        message = safe_error_message(error_code)

    return AIDiagnosticResponse(
        ok=connected,
        status=status,
        message=message,
        configured=configured,
        connected=connected,
        provider="lm_studio",
        model=settings.lm_studio_model,
        latency_ms=_safe_latency(latency_ms),
        error_code=error_code,
        attempts=_safe_attempts(attempts),
    )


def create_ai_router(llm_client: LMStudioClient, settings: Settings) -> APIRouter:
    """Construit le routeur avec un client injectable pour les tests."""

    router = APIRouter(prefix="/api/ai", tags=["ai"])

    @router.get("/diagnostic", response_model=AIDiagnosticResponse)
    async def diagnostic() -> AIDiagnosticResponse:
        getter = getattr(llm_client, "get_diagnostic", None)
        snapshot = getter() if callable(getter) else {}
        if not isinstance(snapshot, dict):
            snapshot = {}
        configured = bool(getattr(llm_client, "configured", False))
        connected = bool(snapshot.get("connected", False)) if configured else False
        return _response(
            settings,
            configured=configured,
            connected=connected,
            latency_ms=snapshot.get("latency_ms"),
            error_code=snapshot.get("error_code"),
            attempts=snapshot.get("attempts", 0),
            tested=snapshot.get("error_code") not in {None, "not_tested"},
        )

    @router.post("/test", response_model=AIDiagnosticResponse)
    async def test_connection() -> AIDiagnosticResponse:
        configured = bool(getattr(llm_client, "configured", False))
        if not configured:
            return _response(
                settings,
                configured=False,
                connected=False,
                error_code="not_configured",
                tested=True,
            )

        try:
            tester = getattr(llm_client, "test_connection", None)
            if callable(tester):
                result = await tester()
            else:
                result = await llm_client.complete(
                    [{"role": "user", "content": "Réponds uniquement par OK."}],
                    temperature=0.0,
                    max_tokens=8,
                )
            result = result if isinstance(result, dict) else {}
            return _response(
                settings,
                configured=True,
                connected=True,
                latency_ms=result.get("duration_ms"),
                attempts=result.get("attempts", 1),
                tested=True,
            )
        except LLMProviderError as exc:
            return _response(
                settings,
                configured=True,
                connected=False,
                latency_ms=exc.latency_ms,
                error_code=exc.error_code,
                attempts=exc.attempts,
                tested=True,
            )
        except Exception:
            # Ne jamais sérialiser l'exception : elle peut retenir une requête HTTP.
            return _response(
                settings,
                configured=True,
                connected=False,
                error_code="internal_error",
                tested=True,
            )

    return router
