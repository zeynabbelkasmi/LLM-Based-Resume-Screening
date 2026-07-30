"""Tests des fonctions RH destinées à une utilisation en équipe."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from backend.config import Settings
from backend.main import create_app


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        database_path=tmp_path / "enterprise.db",
        lm_studio_api_token=None,
        lm_studio_base_url="http://127.0.0.1:1234/v1",
        lm_studio_model="qwen/qwen3-8b",
        request_timeout_seconds=2,
        max_upload_bytes=2 * 1024 * 1024,
        max_pdf_pages=10,
        cors_origins=("http://localhost:5173",),
    )


class EnterpriseFakeLLM:
    provider_name = "test_llm"
    configured = True

    def __init__(self, settings: Settings):
        self.settings = settings

    def get_diagnostic(self):
        return {"connected": True, "error_code": None}

    async def complete(self, _messages, **_kwargs):
        names = [
            "Compétences Techniques",
            "Expérience Professionnelle",
            "Soft Skills",
            "Formation",
        ]
        payload = {
            "sections": [
                {"nom": name, "score_sur_100": 80, "points_forts": ["Python"], "points_faibles": [], "justification": "Évaluation factuelle."}
                for name in names
            ],
            "profil_candidat": {"headline": "Ingénieur", "annees_experience": 5, "competences": ["Python", "SQL"]},
            "synthese": {"resume_candidat": "Profil technique.", "adequation_poste": "Bonne adéquation.", "commentaire_global": "Validation humaine requise.", "questions_entretien": [], "risques": []},
        }
        return {"content": json.dumps(payload, ensure_ascii=False), "usage": {}, "duration_ms": 1}


def _client(tmp_path: Path) -> TestClient:
    settings = _settings(tmp_path)
    return TestClient(create_app(settings=settings, llm_client=EnterpriseFakeLLM(settings)))


def _create_candidate(client: TestClient, index: int) -> dict:
    response = client.post(
        "/api/analyses",
        json={
            "cv_filename": f"candidate-{index}.txt",
            "candidate_name": f"Nom très confidentiel {index}",
            "cv_text": f"# CV {index}\n\nPython, SQL, 5 ans d'expérience.",
            "job_description": "Ingénieur Python et SQL avec 3 ans d'expérience.",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_bulk_update_pipeline_and_privacy_safe_audit(tmp_path):
    with _client(tmp_path) as client:
        candidates = [_create_candidate(client, index) for index in range(3)]
        first_id, second_id, third_id = [item["id"] for item in candidates]

        response = client.patch(
            "/api/analyses/bulk",
            json={
                "ids": [first_id, second_id, first_id, 999_999],
                "status": "entretien",
                "add_tags": ["Prioritaire", "prioritaire", "Data"],
                "favorite": True,
            },
        )
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["requested"] == 3
        assert payload["updated"] == 2
        assert payload["missing"] == [999_999]
        assert {item["id"] for item in payload["items"]} == {first_id, second_id}
        assert all(item["status"] == "entretien" for item in payload["items"])
        assert all(item["tags"] == ["Prioritaire", "Data"] for item in payload["items"])
        assert all(item["favorite"] is True for item in payload["items"])

        untouched = client.get(f"/api/analyses/{third_id}").json()
        assert untouched["status"] == "nouveau"
        assert untouched["tags"] == []

        pipeline = client.get("/api/pipeline/summary")
        assert pipeline.status_code == 200
        stages = {row["status"]: row["count"] for row in pipeline.json()["stages"]}
        assert stages["entretien"] == 2
        assert stages["nouveau"] == 1

        audit = client.get("/api/audit/events?limit=100")
        assert audit.status_code == 200
        events = audit.json()["items"]
        assert any(event["action"] == "analysis.bulk_updated" for event in events)
        serialized = audit.text
        assert "Nom très confidentiel" not in serialized
        assert "Python, SQL" not in serialized


def test_bulk_validation_and_audit_survives_candidate_deletion(tmp_path):
    with _client(tmp_path) as client:
        candidate = _create_candidate(client, 1)

        assert client.patch("/api/analyses/bulk", json={"ids": [candidate["id"]]}).status_code == 422
        assert client.patch(
            "/api/analyses/bulk",
            json={"ids": [candidate["id"]], "status": "inconnu"},
        ).status_code == 422

        assert client.delete(f"/api/analyses/{candidate['id']}").status_code == 204
        audit = client.get("/api/audit/events").json()["items"]
        deleted = next(event for event in audit if event["action"] == "analysis.deleted")
        assert deleted["entity_id"] == str(candidate["id"])
        assert "Nom très confidentiel" not in deleted["summary"]
