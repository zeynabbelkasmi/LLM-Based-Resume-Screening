"""Client LM Studio local, robuste et observable sans fuite de secret."""

from __future__ import annotations

import asyncio
import random
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from time import perf_counter
from typing import Any

import httpx

from .config import Settings


SAFE_ERROR_MESSAGES: dict[str, str] = {
    "not_configured": "LM Studio n'est pas configuré.",
    "authentication_failed": "L'authentification du service IA a échoué.",
    "rate_limited": "Le service IA est temporairement limité. Réessayez plus tard.",
    "provider_unavailable": "Le service IA est temporairement indisponible.",
    "timeout": "Le service IA a dépassé le délai de réponse.",
    "network_error": "La connexion au service IA a échoué.",
    "request_rejected": "Le service IA a refusé la requête.",
    "invalid_response": "Le service IA a retourné une réponse invalide.",
    "internal_error": "Le diagnostic IA n'a pas pu être exécuté.",
    "not_tested": "La connexion IA n'a pas encore été testée.",
}


def safe_error_message(error_code: str | None) -> str:
    """Retourne uniquement un message public contrôlé par l'application."""

    if error_code is None:
        return "Connexion au service IA opérationnelle."
    return SAFE_ERROR_MESSAGES.get(error_code, SAFE_ERROR_MESSAGES["internal_error"])


class LLMProviderError(RuntimeError):
    """Erreur neutralisée : aucun corps fournisseur ni en-tête n'est exposé."""

    def __init__(
        self,
        error_code: str,
        *,
        attempts: int,
        latency_ms: float,
        status_code: int | None = None,
    ):
        self.error_code = error_code
        self.attempts = attempts
        self.latency_ms = latency_ms
        self.status_code = status_code
        self.retryable = error_code in {
            "rate_limited",
            "provider_unavailable",
            "timeout",
            "network_error",
        }
        super().__init__(safe_error_message(error_code))


class LMStudioClient:
    """Client asynchrone pour l'API OpenAI-compatible de LM Studio."""

    provider_name = "lm_studio"

    def __init__(
        self,
        settings: Settings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        random_source: Callable[[], float] = random.random,
    ):
        self.settings = settings
        self._transport = transport
        self._sleep = sleep
        self._random_source = random_source
        self._last_diagnostic: dict[str, Any] = {
            "configured": self.configured,
            "connected": False,
            "provider": self.provider_name,
            "model": settings.lm_studio_model,
            "latency_ms": None,
            "error_code": "not_tested" if self.configured else "not_configured",
            "attempts": 0,
        }

    @property
    def configured(self) -> bool:
        return self.settings.llm_configured

    @property
    def max_attempts(self) -> int:
        # Le bornage est répété ici pour les Settings construites manuellement.
        return min(max(int(self.settings.llm_max_attempts), 1), 5)

    def get_diagnostic(self) -> dict[str, Any]:
        """Expose un instantané non secret sans déclencher de requête distante."""

        diagnostic = dict(self._last_diagnostic)
        diagnostic["configured"] = self.configured
        if not self.configured:
            diagnostic.update(
                connected=False,
                latency_ms=None,
                error_code="not_configured",
                attempts=0,
            )
        return diagnostic

    async def test_connection(self) -> dict[str, Any]:
        """Exécute une complétion minimale ; le texte retourné reste interne."""

        return await self.complete(
            [{"role": "user", "content": "Réponds uniquement par OK.\n/no_think"}],
            temperature=0.0,
            max_tokens=32,
        )

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.2,
        max_tokens: int = 1600,
    ) -> dict[str, Any]:
        started = perf_counter()
        if not self.configured:
            raise self._error("not_configured", started=started, attempts=0)

        payload = {
            "model": self.settings.lm_studio_model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        token = self.settings.lm_studio_api_token
        if token and token.strip():
            headers["Authorization"] = f"Bearer {token.strip()}"
        timeout = httpx.Timeout(max(float(self.settings.request_timeout_seconds), 0.1))

        async with httpx.AsyncClient(timeout=timeout, transport=self._transport) as client:
            for attempt in range(1, self.max_attempts + 1):
                response: httpx.Response | None = None
                try:
                    response = await client.post(
                        f"{self.settings.lm_studio_base_url}/chat/completions",
                        headers=headers,
                        json=payload,
                    )
                except httpx.TimeoutException:
                    error_code = "timeout"
                    status_code = None
                except httpx.HTTPError:
                    error_code = "network_error"
                    status_code = None
                else:
                    status_code = response.status_code
                    if response.is_success:
                        return self._parse_success(
                            response,
                            started=started,
                            attempts=attempt,
                        )
                    error_code = self._status_error_code(status_code)

                retryable = error_code in {
                    "rate_limited",
                    "provider_unavailable",
                    "timeout",
                    "network_error",
                }
                if retryable and attempt < self.max_attempts:
                    await self._sleep(self._retry_delay(attempt, response))
                    continue
                raise self._error(
                    error_code,
                    started=started,
                    attempts=attempt,
                    status_code=status_code,
                ) from None

        # La boucle ci-dessus retourne ou lève toujours une erreur.
        raise self._error("internal_error", started=started, attempts=self.max_attempts)

    def _parse_success(
        self,
        response: httpx.Response,
        *,
        started: float,
        attempts: int,
    ) -> dict[str, Any]:
        try:
            data = response.json()
            content = data["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError):
            raise self._error(
                "invalid_response",
                started=started,
                attempts=attempts,
                status_code=response.status_code,
            ) from None
        if not isinstance(content, str) or not content.strip():
            raise self._error(
                "invalid_response",
                started=started,
                attempts=attempts,
                status_code=response.status_code,
            )

        duration_ms = self._elapsed_ms(started)
        usage = data.get("usage") if isinstance(data, dict) else None
        usage = usage if isinstance(usage, dict) else {}
        model = data.get("model") if isinstance(data, dict) else None
        if not isinstance(model, str) or not model.strip():
            model = self.settings.lm_studio_model
        self._record_diagnostic(
            connected=True,
            latency_ms=duration_ms,
            error_code=None,
            attempts=attempts,
        )
        return {
            "content": content.strip(),
            "usage": {
                "prompt_tokens": self._nonnegative_int(usage.get("prompt_tokens")),
                "completion_tokens": self._nonnegative_int(usage.get("completion_tokens")),
                "total_tokens": self._nonnegative_int(usage.get("total_tokens")),
            },
            "duration_ms": duration_ms,
            "attempts": attempts,
            "model": model,
            "provider": self.provider_name,
        }

    @staticmethod
    def _status_error_code(status_code: int) -> str:
        if status_code in {401, 403}:
            return "authentication_failed"
        if status_code == 429:
            return "rate_limited"
        if 500 <= status_code <= 599:
            return "provider_unavailable"
        return "request_rejected"

    def _retry_delay(
        self,
        attempt: int,
        response: httpx.Response | None,
    ) -> float:
        base = min(max(float(self.settings.llm_backoff_base_seconds), 0.05), 5.0)
        maximum = min(max(float(self.settings.llm_backoff_max_seconds), 0.1), 30.0)
        delay = min(base * (2 ** max(attempt - 1, 0)), maximum)
        retry_after = self._retry_after_seconds(response)
        if retry_after is not None:
            delay = max(delay, min(retry_after, maximum))
        # Jitter positif de 0 à 20 %, sans jamais dépasser la borne maximale.
        jitter_room = max(maximum - delay, 0.0)
        jitter = min(delay * 0.2 * max(min(self._random_source(), 1.0), 0.0), jitter_room)
        return round(delay + jitter, 3)

    @staticmethod
    def _retry_after_seconds(response: httpx.Response | None) -> float | None:
        if response is None:
            return None
        raw_value = response.headers.get("Retry-After", "").strip()
        if not raw_value:
            return None
        try:
            return max(float(raw_value), 0.0)
        except ValueError:
            try:
                retry_at = parsedate_to_datetime(raw_value)
                if retry_at.tzinfo is None:
                    retry_at = retry_at.replace(tzinfo=timezone.utc)
                return max((retry_at - datetime.now(timezone.utc)).total_seconds(), 0.0)
            except (TypeError, ValueError, OverflowError):
                return None

    def _error(
        self,
        error_code: str,
        *,
        started: float,
        attempts: int,
        status_code: int | None = None,
    ) -> LLMProviderError:
        latency_ms = self._elapsed_ms(started)
        self._record_diagnostic(
            connected=False,
            latency_ms=latency_ms if attempts else None,
            error_code=error_code,
            attempts=attempts,
        )
        return LLMProviderError(
            error_code,
            attempts=attempts,
            latency_ms=latency_ms,
            status_code=status_code,
        )

    def _record_diagnostic(
        self,
        *,
        connected: bool,
        latency_ms: float | None,
        error_code: str | None,
        attempts: int,
    ) -> None:
        self._last_diagnostic = {
            "configured": self.configured,
            "connected": connected,
            "provider": self.provider_name,
            "model": self.settings.lm_studio_model,
            "latency_ms": latency_ms,
            "error_code": error_code,
            "attempts": attempts,
        }

    @staticmethod
    def _elapsed_ms(started: float) -> float:
        return round((perf_counter() - started) * 1000, 2)

    @staticmethod
    def _nonnegative_int(value: Any) -> int:
        try:
            return max(int(value or 0), 0)
        except (TypeError, ValueError, OverflowError):
            return 0
