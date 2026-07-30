"""Configuration du backend, exclusivement pilotée par l'environnement."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _env_int(name: str, default: int, minimum: int = 1) -> int:
    try:
        return max(int(os.getenv(name, default)), minimum)
    except (TypeError, ValueError):
        return default


def _env_float(name: str, default: float, minimum: float = 0.1) -> float:
    try:
        return max(float(os.getenv(name, default)), minimum)
    except (TypeError, ValueError):
        return default


def _env_int_bounded(name: str, default: int, minimum: int, maximum: int) -> int:
    """Lit un entier d'environnement sans permettre une valeur non bornée."""

    try:
        return min(max(int(os.getenv(name, default)), minimum), maximum)
    except (TypeError, ValueError):
        return default


def _env_float_bounded(
    name: str,
    default: float,
    minimum: float,
    maximum: float,
) -> float:
    """Lit un flottant d'environnement dans un intervalle sûr."""

    try:
        return min(max(float(os.getenv(name, default)), minimum), maximum)
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True, slots=True)
class Settings:
    """Configuration immuable injectable dans ``create_app`` pour les tests."""

    database_path: Path
    lm_studio_api_token: str | None
    lm_studio_base_url: str
    lm_studio_model: str
    request_timeout_seconds: float
    max_upload_bytes: int
    max_pdf_pages: int
    cors_origins: tuple[str, ...]
    # Les valeurs par défaut maintiennent la compatibilité avec les instances
    # Settings créées explicitement dans les tests et les intégrations tierces.
    llm_max_attempts: int = 3
    llm_backoff_base_seconds: float = 0.35
    llm_backoff_max_seconds: float = 4.0

    @property
    def llm_configured(self) -> bool:
        # LM Studio n'exige pas de jeton par défaut. La configuration est donc
        # exploitable dès qu'une URL locale et un identifiant de modèle existent.
        return bool(self.lm_studio_base_url.strip() and self.lm_studio_model.strip())

    @classmethod
    def from_env(cls) -> "Settings":
        # Le fichier reste local et ignoré par Git ; les variables du processus
        # gardent toujours la priorité sur celles de .env.
        load_dotenv(PROJECT_ROOT / ".env", override=False)
        database_path = Path(
            os.getenv("CVANALYSE_DB_PATH", str(PROJECT_ROOT / "analyses.db"))
        ).expanduser()
        origins = tuple(
            origin.strip()
            for origin in os.getenv(
                "CVANALYSE_CORS_ORIGINS",
                (
                    "http://localhost:5173,http://127.0.0.1:5173,"
                    "http://localhost:4173,http://127.0.0.1:4173"
                ),
            ).split(",")
            if origin.strip()
        )
        return cls(
            database_path=database_path,
            lm_studio_api_token=os.getenv("LM_STUDIO_API_TOKEN") or None,
            lm_studio_base_url=os.getenv(
                "LM_STUDIO_BASE_URL",
                "http://127.0.0.1:1234/v1",
            ).rstrip("/"),
            lm_studio_model=os.getenv("LM_STUDIO_MODEL", "qwen/qwen3-8b"),
            request_timeout_seconds=_env_float("CVANALYSE_LLM_TIMEOUT", 180.0),
            max_upload_bytes=_env_int("CVANALYSE_MAX_UPLOAD_MB", 15) * 1024 * 1024,
            max_pdf_pages=_env_int("CVANALYSE_MAX_PDF_PAGES", 40),
            cors_origins=origins,
            llm_max_attempts=_env_int_bounded(
                "CVANALYSE_LLM_MAX_ATTEMPTS", 3, 1, 5
            ),
            llm_backoff_base_seconds=_env_float_bounded(
                "CVANALYSE_LLM_BACKOFF_BASE", 0.35, 0.05, 5.0
            ),
            llm_backoff_max_seconds=_env_float_bounded(
                "CVANALYSE_LLM_BACKOFF_MAX", 4.0, 0.1, 30.0
            ),
        )
