"""Contrats publics et non sensibles des routes de diagnostic IA."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat


AIConnectionStatus = Literal["connected", "ready", "not_configured", "error"]


class AIDiagnosticResponse(BaseModel):
    """Réponse volontairement limitée à des métadonnées opérationnelles."""

    model_config = ConfigDict(extra="forbid")

    ok: bool
    status: AIConnectionStatus
    message: str = Field(max_length=240)
    configured: bool
    connected: bool
    provider: Literal["lm_studio"] = "lm_studio"
    model: str = Field(min_length=1, max_length=160)
    latency_ms: FiniteFloat | None = Field(default=None, ge=0)
    error_code: str | None = Field(default=None, max_length=64)
    attempts: int = Field(default=0, ge=0, le=5)
