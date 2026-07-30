"""Fonctions RH transverses : traitement groupé, pipeline et journal d'audit."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import Field, field_validator, model_validator

from .repository import Repository
from .schemas import CandidateStatus, StrictModel


class BulkAnalysisUpdate(StrictModel):
    ids: list[int] = Field(min_length=1, max_length=100)
    status: CandidateStatus | None = None
    add_tags: list[str] = Field(default_factory=list, max_length=20)
    remove_tags: list[str] = Field(default_factory=list, max_length=20)
    favorite: bool | None = None

    @field_validator("ids")
    @classmethod
    def normalize_ids(cls, values: list[int]) -> list[int]:
        result: list[int] = []
        for value in values:
            if isinstance(value, bool) or value <= 0:
                raise ValueError("Les identifiants doivent être des entiers positifs")
            if value not in result:
                result.append(value)
        return result

    @field_validator("add_tags", "remove_tags")
    @classmethod
    def normalize_tags(cls, values: list[str]) -> list[str]:
        result: list[str] = []
        seen: set[str] = set()
        for raw_tag in values:
            tag = " ".join(raw_tag.split())[:60]
            key = tag.casefold()
            if tag and key not in seen:
                seen.add(key)
                result.append(tag)
        return result

    @model_validator(mode="after")
    def require_change(self):
        if (
            self.status is None
            and self.favorite is None
            and not self.add_tags
            and not self.remove_tags
        ):
            raise ValueError("Indiquez au moins une modification")
        return self


def create_enterprise_router(repository: Repository) -> APIRouter:
    router = APIRouter(prefix="/api", tags=["enterprise"])

    @router.patch("/analyses/bulk")
    async def bulk_update(payload: BulkAnalysisUpdate):
        return await run_in_threadpool(
            repository.bulk_update_analyses,
            payload.ids,
            status=payload.status,
            add_tags=payload.add_tags,
            remove_tags=payload.remove_tags,
            favorite=payload.favorite,
        )

    @router.get("/audit/events")
    async def audit_events(
        limit: Annotated[int, Query(ge=1, le=200)] = 50,
        offset: Annotated[int, Query(ge=0)] = 0,
        action: Annotated[str | None, Query(max_length=80)] = None,
    ):
        return await run_in_threadpool(
            repository.list_audit_events,
            limit=limit,
            offset=offset,
            action=action,
        )

    @router.get("/pipeline/summary")
    async def pipeline_summary():
        stats = await run_in_threadpool(repository.dashboard_stats)
        distribution = {
            row["label"]: int(row["value"])
            for row in stats.get("status_distribution", [])
        }
        stages = ["nouveau", "a_revoir", "entretien", "retenu", "refuse"]
        return {
            "total": int(stats.get("overview", {}).get("total_cvs", 0)),
            "stages": [{"status": stage, "count": distribution.get(stage, 0)} for stage in stages],
        }

    return router

