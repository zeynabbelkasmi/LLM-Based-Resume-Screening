"""Tests d'intégration de l'API FastAPI Analyse CV."""

from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.analysis_service import DEFAULT_WEIGHTS
from backend.config import Settings
from backend.main import _parse_weights, create_app
from backend.repository import Repository


CV_TEXT = """# CV — Samira Martin

Python, SQL, Docker, Git. Master en informatique. Data analyst — 4 ans d'expérience.
"""
JOB_TEXT = "Développeur Python avec SQL, Docker et 3 ans d'expérience. Master souhaité."


def make_settings(tmp_path: Path, token: str | None = "test-token") -> Settings:
    return Settings(
        database_path=tmp_path / "api.db",
        lm_studio_api_token=None,
        lm_studio_base_url="http://127.0.0.1:1234/v1" if token is not None else "",
        lm_studio_model="test-model",
        request_timeout_seconds=2,
        max_upload_bytes=2 * 1024 * 1024,
        max_pdf_pages=10,
        cors_origins=(
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:4173",
            "http://127.0.0.1:4173",
        ),
    )


class FakeLLM:
    provider_name = "test_llm"
    configured = True

    def __init__(self, settings: Settings):
        self.settings = settings
        self.calls = 0

    def get_diagnostic(self):
        return {"connected": True, "error_code": None}

    async def complete(self, messages, **_kwargs):
        self.calls += 1
        prompt = messages[1]["content"]
        criteria_block = prompt.split("CRITÈRES ET PONDÉRATIONS :", 1)[1].split(
            "Réponds uniquement", 1
        )[0]
        names = []
        for line in criteria_block.splitlines():
            match = re.match(r"- (.+) : [0-9.]+ %", line.strip())
            if match:
                names.append(match.group(1))
        payload = {
            "sections": [
                {
                    "nom": name,
                    "score_sur_100": 80,
                    "points_forts": [f"Force {name}"],
                    "points_faibles": [],
                    "justification": f"Évaluation factuelle de {name}.",
                }
                for name in names
            ],
            "profil_candidat": {
                "headline": "Data analyst",
                "email": "samira@example.test",
                "telephone": "+33 6 00 00 00 00",
                "localisation": "Paris",
                "formation": "Master informatique",
                "derniere_entreprise": "Acme",
                "annees_experience": 4,
                "competences": ["Python", "SQL", "Docker"],
            },
            "synthese": {
                "resume_candidat": "Profil data expérimenté.",
                "adequation_poste": "Bonne adéquation avec le poste.",
                "commentaire_global": "Validation humaine requise.",
                "questions_entretien": ["Décrivez un projet Python."],
                "risques": [],
            },
        }
        return {
            "content": json.dumps(payload, ensure_ascii=False),
            "usage": {"prompt_tokens": 100, "completion_tokens": 50},
            "duration_ms": 20,
        }


@pytest.fixture
def client(tmp_path):
    settings = make_settings(tmp_path)
    with TestClient(create_app(settings=settings, llm_client=FakeLLM(settings))) as test_client:
        yield test_client


def create_analysis(client: TestClient, **overrides) -> dict:
    payload = {
        "cv_filename": "samira-martin.txt",
        "candidate_name": "Samira Martin",
        "cv_text": CV_TEXT,
        "job_description": JOB_TEXT,
    }
    payload.update(overrides)
    response = client.post("/api/analyses", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def test_text_analysis_requires_job_description(client):
    response = client.post(
        "/api/analyses",
        json={"cv_filename": "samira.txt", "cv_text": CV_TEXT, "job_description": "   "},
    )
    assert response.status_code == 422
    assert "fiche de poste" in response.text.lower()
    assert client.get("/api/analyses").json()["total"] == 0


@pytest.mark.parametrize("obsolete_field", ["mode", "blend", "custom_criteria"])
def test_removed_analysis_options_are_rejected(client, obsolete_field):
    payload = {"cv_text": CV_TEXT, "job_description": JOB_TEXT, obsolete_field: "hybride"}
    assert client.post("/api/analyses", json=payload).status_code == 422


def test_health_identifies_analyse_cv_and_llm_requirement(tmp_path):
    settings = make_settings(tmp_path, token=None)
    with TestClient(create_app(settings=settings)) as test_client:
        payload = test_client.get("/api/health").json()
    assert payload["service"] == "analyse-cv-api"
    assert payload["ai"]["configured"] is False
    assert payload["ai"]["mode"] == "not_configured"


def test_missing_llm_configuration_returns_503_without_persistence(tmp_path):
    settings = make_settings(tmp_path, token=None)
    with TestClient(create_app(settings=settings)) as test_client:
        response = test_client.post(
            "/api/analyses", json={"cv_text": CV_TEXT, "job_description": JOB_TEXT}
        )
        assert response.status_code == 503
        assert test_client.get("/api/analyses").json()["total"] == 0


@pytest.mark.parametrize(
    "origin",
    [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ],
)
def test_local_origins_can_create_analysis(client, origin):
    response = client.post(
        "/api/analyses",
        json={"cv_text": CV_TEXT, "job_description": JOB_TEXT},
        headers={"origin": origin},
    )
    assert response.status_code == 201
    assert response.headers["access-control-allow-origin"] == origin


def test_unknown_origin_cannot_write(client):
    response = client.post(
        "/api/analyses",
        json={"cv_text": CV_TEXT, "job_description": JOB_TEXT},
        headers={"origin": "https://example.invalid"},
    )
    assert response.status_code == 403


def test_llm_analysis_crud_and_dynamic_criteria(client):
    weights = {"Compétences Techniques": 50, "Anglais professionnel": 50}
    created = create_analysis(client, weights=weights)
    analysis_id = created["id"]
    assert "markdown_content" not in created
    assert "job_description" not in created
    assert created["analysis"]["mode"] == "llm"
    assert created["analysis"]["provider"] == "test_llm"
    assert created["analysis"]["global"]["weights"] == weights
    assert created["score_global"] == 80
    assert {section["section_name"] for section in created["sections"]} == set(weights)

    listing = client.get("/api/analyses").json()
    assert listing["total"] == 1
    assert "markdown_content" not in listing["items"][0]

    redacted = client.get(f"/api/analyses/{analysis_id}").json()
    assert "markdown_content" not in redacted
    full = client.get(
        f"/api/analyses/{analysis_id}", params={"include_document": "true"}
    ).json()
    assert "Python" in full["markdown_content"]

    patched = client.patch(
        f"/api/analyses/{analysis_id}",
        json={"status": "entretien", "tags": ["Data", "data"], "favorite": True},
    )
    assert patched.json()["tags"] == ["Data"]
    assert patched.json()["favorite"] is True
    assert client.delete(f"/api/analyses/{analysis_id}").status_code == 204


@pytest.mark.parametrize(
    "weights",
    [
        {"Technique": 60, "Formation": 30},
        {"Technique": -1, "Formation": 101},
        {"Technique": 100, "Formation": 0},
        {"Technique": 100, " technique ": 0},
        {},
    ],
)
def test_invalid_weights_are_rejected_without_persistence(client, weights):
    response = client.post(
        "/api/analyses",
        json={"cv_text": CV_TEXT, "job_description": JOB_TEXT, "weights": weights},
    )
    assert response.status_code == 422
    assert client.get("/api/analyses").json()["total"] == 0


@pytest.mark.parametrize("literal", ["NaN", "Infinity", "-Infinity", '"NaN"'])
def test_multipart_weight_parser_rejects_non_finite_values(literal):
    with pytest.raises(HTTPException) as error:
        _parse_weights('{"Technique":' + literal + "}")
    assert error.value.status_code == 422


def _minimal_pdf(text: str) -> bytes:
    stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode("latin-1")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    result = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for number, obj in enumerate(objects, 1):
        offsets.append(len(result))
        result.extend(f"{number} 0 obj\n".encode())
        result.extend(obj + b"\nendobj\n")
    xref = len(result)
    result.extend(f"xref\n0 {len(objects) + 1}\n".encode())
    result.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        result.extend(f"{offset:010d} 00000 n \n".encode())
    result.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    )
    return bytes(result)


def test_pdf_upload_accepts_job_file_and_combines_dynamic_weights(client):
    response = client.post(
        "/api/analyses/upload",
        files={
            "file": ("cv.pdf", _minimal_pdf("Python SQL Docker 4 ans"), "application/pdf"),
            "job_file": ("poste.pdf", _minimal_pdf("Python SQL requis"), "application/pdf"),
        },
        data={"weights_json": json.dumps(DEFAULT_WEIGHTS, ensure_ascii=False)},
    )
    assert response.status_code == 201, response.text
    assert response.json()["analysis"]["mode"] == "llm"


def test_pdf_upload_requires_job_text_or_pdf(client):
    response = client.post(
        "/api/analyses/upload",
        files={"file": ("cv.pdf", _minimal_pdf("Python SQL"), "application/pdf")},
    )
    assert response.status_code == 422


def test_chat_routes_are_removed(client):
    assert client.get("/api/chat/sessions").status_code == 404
    assert client.post("/api/chat", json={"message": "Bonjour"}).status_code == 404


def test_repository_migrates_legacy_schema_without_chat_tables(tmp_path):
    path = tmp_path / "legacy.db"
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE analyses (
            id INTEGER PRIMARY KEY AUTOINCREMENT, cv_filename TEXT NOT NULL,
            job_description TEXT NOT NULL DEFAULT '', custom_criteria TEXT NOT NULL DEFAULT '',
            markdown_content TEXT NOT NULL DEFAULT '', score_global INTEGER, verdict TEXT,
            commentaire_global TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE sections (
            id INTEGER PRIMARY KEY AUTOINCREMENT, analysis_id INTEGER NOT NULL
            REFERENCES analyses(id) ON DELETE CASCADE, section_name TEXT NOT NULL,
            score INTEGER, justification TEXT, points_forts TEXT, points_faibles TEXT
        );
        CREATE TABLE token_usage (
            id INTEGER PRIMARY KEY AUTOINCREMENT, analysis_id INTEGER NOT NULL
            REFERENCES analyses(id) ON DELETE CASCADE, appel_api_count INTEGER DEFAULT 0,
            tokens_prompt INTEGER DEFAULT 0, tokens_completion INTEGER DEFAULT 0,
            tokens_total INTEGER DEFAULT 0, duree_totale_secondes REAL DEFAULT 0,
            tokens_par_seconde REAL DEFAULT 0
        );
        """
    )
    connection.close()
    repository = Repository(path)
    repository.init_schema()
    with repository.connection() as connection:
        tables = {
            row["name"]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        assert "audit_events" in tables
        assert "chat_sessions" not in tables
        assert "chat_messages" not in tables
