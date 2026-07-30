"""Routes FastAPI des exports entreprise.

Intégration dans l'application principale::

    from .export_router import router as export_router
    application.include_router(export_router)

Le dépôt est lu depuis ``application.state.repository`` afin de conserver la
même instance et la même base que le reste de l'API.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool

from .export_service import EXCEL_MIME, PDF_MIME, ExportService
from .repository import Repository


def _repository_from_request(request: Request) -> Repository:
    repository = getattr(request.app.state, "repository", None)
    if not isinstance(repository, Repository):
        raise RuntimeError("Le dépôt d'analyses n'est pas configuré")
    return repository


def _export_service(
    request: Request,
    repository: Repository = Depends(_repository_from_request),
) -> ExportService:
    audit_hook = getattr(request.app.state, "export_audit_hook", None)
    return ExportService(repository, audit_hook=audit_hook if callable(audit_hook) else None)


def _safe_download_filename(filename: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", filename).strip(".-")
    return cleaned[:160] or "analyse-cv-export"


def _attachment_headers(filename: str, payload: bytes) -> dict[str, str]:
    safe_name = _safe_download_filename(filename)
    encoded = quote(safe_name, safe=".-_")
    return {
        "Content-Disposition": (
            f'attachment; filename="{safe_name}"; filename*=UTF-8\'\'{encoded}'
        ),
        "Content-Length": str(len(payload)),
        "Cache-Control": "private, no-store, max-age=0",
        "Pragma": "no-cache",
        "X-Content-Type-Options": "nosniff",
    }


def _dated_filename(stem: str, extension: str) -> str:
    date = datetime.now(UTC).strftime("%Y-%m-%d")
    return f"{stem}-{date}.{extension}"


def create_export_router() -> APIRouter:
    export_router = APIRouter(prefix="/api/exports", tags=["exports"])

    @export_router.get(
        "/candidates.xlsx",
        summary="Exporter toute la CVthèque au format Excel",
        response_class=Response,
        responses={
            200: {
                "content": {EXCEL_MIME: {}},
                "description": "Classeur Excel exhaustif et filtrable",
            }
        },
    )
    async def export_candidates_xlsx(
        service: ExportService = Depends(_export_service),
    ) -> Response:
        payload = await run_in_threadpool(service.candidates_xlsx)
        filename = _dated_filename("analyse-cv-candidats", "xlsx")
        return Response(
            content=payload,
            media_type=EXCEL_MIME,
            headers=_attachment_headers(filename, payload),
        )

    @export_router.get(
        "/candidates.pdf",
        summary="Exporter la synthèse complète de la CVthèque au format PDF",
        response_class=Response,
        responses={
            200: {
                "content": {PDF_MIME: {}},
                "description": "Rapport PDF paginé et confidentiel",
            }
        },
    )
    async def export_candidates_pdf(
        service: ExportService = Depends(_export_service),
    ) -> Response:
        payload = await run_in_threadpool(service.candidates_pdf)
        filename = _dated_filename("analyse-cv-candidats", "pdf")
        return Response(
            content=payload,
            media_type=PDF_MIME,
            headers=_attachment_headers(filename, payload),
        )

    @export_router.get(
        "/candidates/{analysis_id}.pdf",
        summary="Exporter le rapport PDF d'un candidat",
        response_class=Response,
        responses={
            200: {
                "content": {PDF_MIME: {}},
                "description": "Rapport candidat détaillé sans CV brut",
            },
            404: {"description": "Candidat introuvable"},
        },
    )
    async def export_candidate_pdf(
        analysis_id: int,
        service: ExportService = Depends(_export_service),
    ) -> Response:
        if analysis_id < 1:
            raise HTTPException(status_code=404, detail="Candidat introuvable")
        payload = await run_in_threadpool(service.candidate_pdf, analysis_id)
        if payload is None:
            raise HTTPException(status_code=404, detail="Candidat introuvable")
        filename = f"analyse-cv-candidat-{analysis_id}.pdf"
        return Response(
            content=payload,
            media_type=PDF_MIME,
            headers=_attachment_headers(filename, payload),
        )

    return export_router


router = create_export_router()


__all__ = ["create_export_router", "router"]
