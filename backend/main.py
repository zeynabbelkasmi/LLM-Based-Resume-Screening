"""API FastAPI consommée par le frontend React."""

from __future__ import annotations

import asyncio
import json
import math
import re
from contextlib import asynccontextmanager
from io import BytesIO
from pathlib import Path
from typing import Annotated, Literal

import pdfplumber
from fastapi import FastAPI, File, Form, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from convertisseur import convert_to_markdown, extract_raw_text_from_bytes

from .analysis_service import AnalysisService, LLMAnalysisError, normalize_weights
from .ai_router import create_ai_router
from .config import Settings
from .enterprise_router import create_enterprise_router
from .export_router import router as export_router
from .llm_client import LMStudioClient, LLMProviderError
from .repository import Repository
from .schemas import (
    AnalysisCreate,
    AnalysisUpdate,
)


def _safe_filename(raw_name: str | None) -> str:
    name = Path((raw_name or "cv.pdf").replace("\x00", "")).name
    name = re.sub(r"[^\w.()\- ]+", "_", name, flags=re.UNICODE).strip(" .")
    return (name or "cv.pdf")[:180]


def _default_candidate_name(filename: str) -> str:
    stem = Path(filename).stem
    return re.sub(r"[_\-]+", " ", stem).strip().title() or "Candidat"


def _parse_weights(value: str | None) -> dict[str, float] | None:
    if not value:
        return None
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="weights_json doit être un objet JSON") from exc
    if not isinstance(parsed, dict) or len(parsed) > 12:
        raise HTTPException(status_code=422, detail="weights_json doit être un objet de pondérations")
    try:
        weights = {str(key): float(number) for key, number in parsed.items()}
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="Chaque pondération doit être numérique") from exc
    if any(not math.isfinite(number) for number in weights.values()):
        raise HTTPException(status_code=422, detail="Chaque pondération doit être un nombre fini")
    try:
        return normalize_weights(weights)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _require_job_context(job_description: str) -> None:
    if not job_description.strip():
        raise HTTPException(
            status_code=422,
            detail="Renseignez une fiche de poste en texte brut ou au format PDF",
        )


def _validation_json_safe(value):
    """Évite qu'une valeur NaN/Infinity reçue fasse échouer la réponse d'erreur JSON."""

    if isinstance(value, float) and not math.isfinite(value):
        return "valeur non finie"
    if isinstance(value, dict):
        return {str(key): _validation_json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_validation_json_safe(item) for item in value]
    if value is None or isinstance(value, (str, int, bool, float)):
        return value
    return str(value)


def _check_pdf_pages(data: bytes, max_pages: int) -> int:
    with pdfplumber.open(BytesIO(data)) as pdf:
        page_count = len(pdf.pages)
        if page_count > max_pages:
            raise ValueError(f"Le PDF dépasse la limite de {max_pages} pages")
        return page_count


async def _read_and_extract_pdf(
    upload: UploadFile,
    settings: Settings,
    *,
    label: str,
) -> tuple[str, str]:
    filename = _safe_filename(upload.filename)
    if Path(filename).suffix.casefold() != ".pdf":
        raise HTTPException(status_code=422, detail=f"{label} : seuls les PDF sont acceptés")
    if upload.content_type and upload.content_type.casefold() not in {
        "application/pdf",
        "application/x-pdf",
        "application/octet-stream",
    }:
        raise HTTPException(status_code=422, detail=f"{label} : type MIME invalide")

    data = await upload.read(settings.max_upload_bytes + 1)
    await upload.close()
    if len(data) > settings.max_upload_bytes:
        max_mb = settings.max_upload_bytes // (1024 * 1024)
        raise HTTPException(status_code=413, detail=f"{label} : taille maximale {max_mb} Mo")
    if not data or b"%PDF-" not in data[:1024]:
        raise HTTPException(status_code=422, detail=f"{label} : signature PDF invalide")
    try:
        await asyncio.wait_for(
            run_in_threadpool(_check_pdf_pages, data, settings.max_pdf_pages),
            timeout=15,
        )
        raw_text = await asyncio.wait_for(
            run_in_threadpool(extract_raw_text_from_bytes, data),
            timeout=30,
        )
    except TimeoutError as exc:
        raise HTTPException(status_code=408, detail=f"{label} : extraction trop longue") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"{label} : {exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"{label} : PDF illisible ou chiffré") from exc
    if not raw_text.strip():
        raise HTTPException(
            status_code=422,
            detail=f"{label} : aucun texte extractible (un OCR peut être nécessaire)",
        )
    return filename, raw_text


def create_app(
    settings: Settings | None = None,
    repository: Repository | None = None,
    llm_client: LMStudioClient | None = None,
) -> FastAPI:
    settings = settings or Settings.from_env()
    repository = repository or Repository(settings.database_path)
    llm_client = llm_client or LMStudioClient(settings)
    analysis_service = AnalysisService(llm_client)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        await run_in_threadpool(repository.init_schema)
        yield

    application = FastAPI(
        title="Analyse CV API",
        version="2.0.0",
        description=(
            "API locale mono-utilisateur pour l'analyse de CV. "
            "Ne pas exposer publiquement sans authentification réseau."
        ),
        lifespan=lifespan,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Accept", "Authorization"],
        expose_headers=["Content-Disposition", "Content-Length"],
    )
    application.state.settings = settings
    application.state.repository = repository
    application.state.llm_client = llm_client

    def _record_export_event(event: dict) -> None:
        export_format = str(event.get("format") or "unknown")
        count = max(int(event.get("candidate_count") or 0), 0)
        analysis_id = event.get("analysis_id")
        repository.record_audit_event(
            "export.generated",
            entity_type="analysis" if analysis_id is not None else "candidate_library",
            entity_id=analysis_id,
            summary=(
                f"Rapport du dossier #{analysis_id} exporté"
                if analysis_id is not None
                else f"Export de {count} dossier(s) généré"
            ),
            metadata={
                "format": export_format,
                "count": count,
                "scope": "candidate" if analysis_id is not None else "all_candidates",
            },
        )

    application.state.export_audit_hook = _record_export_event
    application.include_router(create_ai_router(llm_client, settings))
    application.include_router(export_router)
    # Enregistré avant les routes /analyses/{id} afin que /analyses/bulk
    # ne soit jamais interprété comme un identifiant de dossier.
    application.include_router(create_enterprise_router(repository))

    async def _record_event(
        action: str,
        *,
        entity_type: str,
        entity_id: str | int | None,
        summary: str,
        metadata: dict | None = None,
    ) -> None:
        """Le journal complète une action, sans pouvoir invalider celle-ci."""

        try:
            await run_in_threadpool(
                repository.record_audit_event,
                action,
                entity_type=entity_type,
                entity_id=entity_id,
                summary=summary,
                metadata=metadata,
            )
        except Exception:
            # Une base ancienne sera migrée au prochain démarrage. L'action métier
            # reste prioritaire si la journalisation est momentanément indisponible.
            return

    async def _analyze_with_llm(
        *,
        markdown: str,
        job_description: str,
        weights: dict[str, float] | None,
        temperature: float,
    ) -> dict:
        try:
            return await analysis_service.analyze(
                markdown=markdown,
                job_description=job_description,
                weights=weights,
                temperature=temperature,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except (LLMProviderError, LLMAnalysisError) as exc:
            raise HTTPException(
                status_code=503,
                detail=f"Analyse LLM indisponible : {exc}",
            ) from exc

    @application.exception_handler(RequestValidationError)
    async def validation_exception_handler(_: Request, exc: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content={"detail": _validation_json_safe(exc.errors())},
        )

    @application.middleware("http")
    async def reject_cross_origin_writes(request: Request, call_next):
        """CORS seul n'empêche pas un formulaire hostile d'écrire sur localhost."""
        if request.method in {"POST", "PATCH", "PUT", "DELETE"}:
            origin = request.headers.get("origin")
            if origin and origin not in settings.cors_origins:
                return Response(content="Origine non autorisée", status_code=403)
        return await call_next(request)

    @application.get("/", include_in_schema=False)
    async def root():
        return {"service": "Analyse CV API", "docs": "/docs", "health": "/api/health"}

    @application.get("/api/health", tags=["system"])
    async def health():
        ai_diagnostic = llm_client.get_diagnostic()
        if not llm_client.configured:
            ai_mode = "not_configured"
        elif ai_diagnostic.get("connected"):
            ai_mode = "connected"
        elif ai_diagnostic.get("error_code") not in {None, "not_tested"}:
            ai_mode = "error"
        else:
            ai_mode = "configured_not_tested"
        return {
            "status": "ok",
            "service": "analyse-cv-api",
            "version": application.version,
            "database": "ok",
            "ai": {
                "provider": "lm_studio",
                "configured": llm_client.configured,
                "connected": bool(ai_diagnostic.get("connected")),
                "model": settings.lm_studio_model,
                "mode": ai_mode,
            },
            "security": {
                "deployment_mode": "local_single_user",
                "public_exposure_supported": False,
            },
            "limits": {
                "max_upload_mb": settings.max_upload_bytes // (1024 * 1024),
                "max_pdf_pages": settings.max_pdf_pages,
            },
        }

    @application.get("/api/dashboard/stats", tags=["dashboard"])
    async def dashboard_stats():
        return await run_in_threadpool(repository.dashboard_stats)

    @application.get("/api/analyses", tags=["analyses"])
    async def list_analyses(
        search: str | None = Query(default=None, max_length=200),
        verdict: str | None = Query(default=None, max_length=80),
        candidate_status: str | None = Query(default=None, alias="status", max_length=30),
        min_score: float | None = Query(default=None, ge=0, le=100),
        max_score: float | None = Query(default=None, ge=0, le=100),
        favorite: bool | None = None,
        limit: int = Query(default=50, ge=1, le=100),
        offset: int = Query(default=0, ge=0),
        sort: Literal["created_at", "updated_at", "score", "name"] = "created_at",
        order: Literal["asc", "desc"] = "desc",
    ):
        return await run_in_threadpool(
            repository.list_analyses,
            search=search,
            verdict=verdict,
            status=candidate_status,
            min_score=min_score,
            max_score=max_score,
            favorite=favorite,
            limit=limit,
            offset=offset,
            sort=sort,
            order=order,
        )

    @application.post("/api/analyses", status_code=status.HTTP_201_CREATED, tags=["analyses"])
    async def create_text_analysis(payload: AnalysisCreate):
        result = await _analyze_with_llm(
            markdown=payload.cv_text,
            job_description=payload.job_description,
            weights=payload.weights,
            temperature=payload.temperature,
        )
        candidate_name = payload.candidate_name or _default_candidate_name(payload.cv_filename)
        analysis_id = await run_in_threadpool(
            repository.save_analysis,
            cv_filename=_safe_filename(payload.cv_filename),
            job_description=payload.job_description,
            markdown_content=payload.cv_text,
            result=result,
            candidate_name=candidate_name,
        )
        await _record_event(
            "analysis.created",
            entity_type="analysis",
            entity_id=analysis_id,
            summary=f"Dossier candidat #{analysis_id} créé",
            metadata={"scope": "text"},
        )
        return await run_in_threadpool(
            repository.get_analysis, analysis_id, include_document=False
        )

    @application.post(
        "/api/analyses/upload",
        status_code=status.HTTP_201_CREATED,
        tags=["analyses"],
    )
    async def upload_analysis(
        file: Annotated[UploadFile, File(description="CV au format PDF")],
        job_description: Annotated[str, Form(max_length=80_000)] = "",
        candidate_name: Annotated[str | None, Form(max_length=255)] = None,
        temperature: Annotated[float, Form(ge=0, le=2)] = 0.2,
        weights_json: Annotated[str | None, Form()] = None,
        job_file: Annotated[UploadFile | None, File(description="Fiche de poste PDF optionnelle")] = None,
    ):
        if job_file is None:
            _require_job_context(job_description)
        filename, raw_text = await _read_and_extract_pdf(file, settings, label="CV")
        if len(raw_text) > 300_000:
            raise HTTPException(status_code=422, detail="CV : texte extrait trop volumineux")
        if job_file is not None:
            _, job_text = await _read_and_extract_pdf(job_file, settings, label="Fiche de poste")
            job_description = "\n\n".join(
                part for part in [job_description.strip(), job_text.strip()] if part
            )
        _require_job_context(job_description)
        if len(job_description) > 80_000:
            raise HTTPException(status_code=422, detail="Fiche de poste trop volumineuse")
        converted = await run_in_threadpool(convert_to_markdown, raw_text, filename)
        result = await _analyze_with_llm(
            markdown=converted["markdown"],
            job_description=job_description,
            weights=_parse_weights(weights_json),
            temperature=temperature,
        )
        analysis_id = await run_in_threadpool(
            repository.save_analysis,
            cv_filename=filename,
            job_description=job_description,
            markdown_content=converted["markdown"],
            result=result,
            candidate_name=candidate_name or _default_candidate_name(filename),
        )
        await _record_event(
            "analysis.created",
            entity_type="analysis",
            entity_id=analysis_id,
            summary=f"Dossier candidat #{analysis_id} créé",
            metadata={"scope": "upload"},
        )
        return await run_in_threadpool(
            repository.get_analysis, analysis_id, include_document=False
        )

    @application.post("/api/analyses/upload/batch", tags=["analyses"])
    async def upload_analysis_batch(
        files: Annotated[list[UploadFile], File(description="Un ou plusieurs CV PDF")],
        job_description: Annotated[str, Form(max_length=80_000)] = "",
        temperature: Annotated[float, Form(ge=0, le=2)] = 0.2,
        weights_json: Annotated[str | None, Form()] = None,
        job_file: Annotated[UploadFile | None, File(description="Fiche de poste PDF optionnelle")] = None,
    ):
        if job_file is not None:
            _, job_text = await _read_and_extract_pdf(job_file, settings, label="Fiche de poste")
            job_description = "\n\n".join(
                part for part in [job_description.strip(), job_text.strip()] if part
            )
        _require_job_context(job_description)
        if len(job_description) > 80_000:
            raise HTTPException(status_code=422, detail="Fiche de poste trop volumineuse")
        if not files or len(files) > 20:
            raise HTTPException(status_code=422, detail="Envoyez entre 1 et 20 CV")
        weights = _parse_weights(weights_json)
        items: list[dict] = []
        errors: list[dict] = []
        for upload in files:
            original_name = _safe_filename(upload.filename)
            try:
                filename, raw_text = await _read_and_extract_pdf(upload, settings, label=original_name)
                if len(raw_text) > 300_000:
                    raise HTTPException(status_code=422, detail="Texte extrait trop volumineux")
                converted = await run_in_threadpool(convert_to_markdown, raw_text, filename)
                result = await _analyze_with_llm(
                    markdown=converted["markdown"],
                    job_description=job_description,
                    weights=weights,
                    temperature=temperature,
                )
                analysis_id = await run_in_threadpool(
                    repository.save_analysis,
                    cv_filename=filename,
                    job_description=job_description,
                    markdown_content=converted["markdown"],
                    result=result,
                    candidate_name=_default_candidate_name(filename),
                )
                detail = await run_in_threadpool(
                    repository.get_analysis, analysis_id, include_document=False
                )
                items.append(detail)
                await _record_event(
                    "analysis.created",
                    entity_type="analysis",
                    entity_id=analysis_id,
                    summary=f"Dossier candidat #{analysis_id} créé",
                    metadata={"scope": "batch_upload"},
                )
            except HTTPException as exc:
                errors.append({"filename": original_name, "status": exc.status_code, "detail": exc.detail})
        return {"items": items, "errors": errors, "total": len(files), "succeeded": len(items)}

    @application.get("/api/analyses/{analysis_id}", tags=["analyses"])
    async def get_analysis(analysis_id: int, include_document: bool = False):
        item = await run_in_threadpool(
            repository.get_analysis, analysis_id, include_document=include_document
        )
        if item is None:
            raise HTTPException(status_code=404, detail="Analyse introuvable")
        return item

    @application.patch("/api/analyses/{analysis_id}", tags=["analyses"])
    async def update_analysis(analysis_id: int, payload: AnalysisUpdate):
        changes = payload.model_dump(exclude_unset=True)
        item = await run_in_threadpool(
            repository.update_analysis,
            analysis_id,
            changes,
        )
        if item is None:
            raise HTTPException(status_code=404, detail="Analyse introuvable")
        await _record_event(
            "analysis.updated",
            entity_type="analysis",
            entity_id=analysis_id,
            summary=f"Dossier candidat #{analysis_id} mis à jour",
            metadata={"fields": sorted(changes)},
        )
        return item

    @application.delete(
        "/api/analyses/{analysis_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        tags=["analyses"],
    )
    async def delete_analysis(analysis_id: int):
        deleted = await run_in_threadpool(repository.delete_analysis, analysis_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Analyse introuvable")
        await _record_event(
            "analysis.deleted",
            entity_type="analysis",
            entity_id=analysis_id,
            summary=f"Dossier candidat #{analysis_id} supprimé",
        )
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return application


app = create_app()
