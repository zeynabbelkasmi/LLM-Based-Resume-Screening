"""Schémas d'entrée de l'API publique."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, field_validator, model_validator


CandidateStatus = Literal["nouveau", "a_revoir", "entretien", "retenu", "refuse"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class AnalysisCreate(StrictModel):
    cv_filename: str = Field(default="cv.txt", min_length=1, max_length=255)
    cv_text: str = Field(min_length=1, max_length=300_000)
    candidate_name: str | None = Field(default=None, max_length=255)
    job_description: str = Field(default="", max_length=80_000)
    weights: dict[str, FiniteFloat] | None = None
    temperature: float = Field(default=0.2, ge=0.0, le=2.0)

    @field_validator("weights")
    @classmethod
    def validate_weights(cls, value: dict[str, float] | None):
        if value is not None and not 1 <= len(value) <= 12:
            raise ValueError("Définissez entre 1 et 12 pondérations")
        return value

    @model_validator(mode="after")
    def require_job_context(self):
        if not self.job_description:
            raise ValueError("Renseignez une fiche de poste")
        return self


class AnalysisUpdate(StrictModel):
    candidate_name: str | None = Field(default=None, max_length=255)
    status: CandidateStatus | None = None
    tags: list[str] | None = Field(default=None, max_length=20)
    notes: str | None = Field(default=None, max_length=20_000)
    favorite: bool | None = None

    @model_validator(mode="before")
    @classmethod
    def reject_explicit_nulls(cls, value):
        if isinstance(value, dict):
            null_fields = [name for name in ("status", "notes") if name in value and value[name] is None]
            if null_fields:
                fields = ", ".join(null_fields)
                raise ValueError(f"Les champs suivants ne peuvent pas être nuls : {fields}")
        return value

    @field_validator("tags")
    @classmethod
    def normalize_tags(cls, value: list[str] | None):
        if value is None:
            return None
        result: list[str] = []
        seen: set[str] = set()
        for raw_tag in value:
            tag = raw_tag.strip()[:60]
            key = tag.casefold()
            if tag and key not in seen:
                seen.add(key)
                result.append(tag)
        return result

