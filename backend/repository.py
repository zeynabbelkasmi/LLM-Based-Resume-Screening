"""Accès SQLite de l'API Analyse CV."""

from __future__ import annotations

import json
import re
import sqlite3
from copy import deepcopy
from collections import Counter
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterator


_AUDIT_METADATA_KEYS = {
    "fields",
    "count",
    "requested",
    "updated",
    "missing",
    "status",
    "format",
    "scope",
    "degraded",
    "provider",
}


def _utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _json_dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _json_load(value: Any, default: Any) -> Any:
    if not value:
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (TypeError, ValueError, json.JSONDecodeError):
        return default


def _audit_metadata(value: dict[str, Any] | None) -> dict[str, Any]:
    """Conserve uniquement des métadonnées techniques sans données de CV."""

    result: dict[str, Any] = {}
    for raw_key, raw_value in (value or {}).items():
        key = str(raw_key)
        if key not in _AUDIT_METADATA_KEYS:
            continue
        if isinstance(raw_value, (str, int, float, bool)) or raw_value is None:
            result[key] = raw_value
        elif isinstance(raw_value, list):
            result[key] = [
                item
                for item in raw_value[:100]
                if isinstance(item, (str, int, float, bool)) or item is None
            ]
    return result


class Repository:
    """Petit dépôt sans ORM, avec requêtes paramétrées et migrations additives."""

    def __init__(self, path: str | Path):
        self.path = Path(path)

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(
            str(self.path), timeout=30, check_same_thread=False, isolation_level=None
        )
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA secure_delete=ON")
        conn.execute("PRAGMA busy_timeout=30000")
        conn.execute("PRAGMA journal_mode=WAL")
        try:
            yield conn
        finally:
            conn.close()

    def init_schema(self) -> None:
        with self.connection() as conn:
            conn.executescript(
                """
                BEGIN;
                CREATE TABLE IF NOT EXISTS analyses (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    cv_filename TEXT NOT NULL,
                    job_description TEXT NOT NULL DEFAULT '',
                    markdown_content TEXT NOT NULL DEFAULT '',
                    score_global REAL,
                    verdict TEXT,
                    commentaire_global TEXT,
                    weights_json TEXT NOT NULL DEFAULT '{}',
                    analysis_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    candidate_name TEXT,
                    status TEXT NOT NULL DEFAULT 'nouveau',
                    tags_json TEXT NOT NULL DEFAULT '[]',
                    notes TEXT NOT NULL DEFAULT '',
                    favorite INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT
                );

                CREATE TABLE IF NOT EXISTS sections (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    analysis_id INTEGER NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
                    section_name TEXT NOT NULL,
                    score REAL,
                    justification TEXT,
                    points_forts TEXT,
                    points_faibles TEXT
                );

                CREATE TABLE IF NOT EXISTS token_usage (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    analysis_id INTEGER NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
                    appel_api_count INTEGER NOT NULL DEFAULT 0,
                    tokens_prompt INTEGER NOT NULL DEFAULT 0,
                    tokens_completion INTEGER NOT NULL DEFAULT 0,
                    tokens_total INTEGER NOT NULL DEFAULT 0,
                    duree_totale_secondes REAL NOT NULL DEFAULT 0.0,
                    tokens_par_seconde REAL NOT NULL DEFAULT 0.0
                );

                CREATE TABLE IF NOT EXISTS audit_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    action TEXT NOT NULL,
                    entity_type TEXT NOT NULL,
                    entity_id TEXT,
                    summary TEXT NOT NULL,
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_analyses_created_at
                    ON analyses(created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_sections_analysis_id ON sections(analysis_id);
                CREATE INDEX IF NOT EXISTS idx_token_usage_analysis_id
                    ON token_usage(analysis_id);
                CREATE INDEX IF NOT EXISTS idx_audit_events_created_at
                    ON audit_events(created_at DESC, id DESC);
                COMMIT;
                """
            )
            # Les bases créées par l'ancienne application n'ont pas ces colonnes.
            additions = {
                "candidate_name": "TEXT",
                "status": "TEXT NOT NULL DEFAULT 'nouveau'",
                "tags_json": "TEXT NOT NULL DEFAULT '[]'",
                "notes": "TEXT NOT NULL DEFAULT ''",
                "favorite": "INTEGER NOT NULL DEFAULT 0",
                "updated_at": "TEXT",
                "weights_json": "TEXT NOT NULL DEFAULT '{}'",
                "analysis_json": "TEXT NOT NULL DEFAULT '{}'",
            }
            conn.execute("BEGIN IMMEDIATE")
            try:
                columns = {
                    row["name"]
                    for row in conn.execute("PRAGMA table_info(analyses)").fetchall()
                }
                for name, definition in additions.items():
                    if name not in columns:
                        conn.execute(f"ALTER TABLE analyses ADD COLUMN {name} {definition}")
                # Cet index doit être créé après la migration additive de ``status``.
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_analyses_status ON analyses(status)"
                )
                conn.execute("PRAGMA user_version=3")
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise

    def save_analysis(
        self,
        *,
        cv_filename: str,
        job_description: str,
        markdown_content: str,
        result: dict[str, Any],
        candidate_name: str | None = None,
    ) -> int:
        stored_result = deepcopy(result)
        # Le texte brut reste dans markdown_content : ne pas le dupliquer dans le JSON.
        candidate_profile = stored_result.get("candidate_profile")
        if isinstance(candidate_profile, dict):
            candidate_profile.pop("markdown", None)
        global_data = stored_result.get("global", {})
        token_data = result.get("tokens", {})
        now = _utc_now()
        with self.connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                cursor = conn.execute(
                    """
                    INSERT INTO analyses (
                        cv_filename, job_description,
                        markdown_content, score_global, verdict,
                        commentaire_global, weights_json, analysis_json,
                        candidate_name, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        cv_filename,
                        job_description,
                        markdown_content,
                        global_data.get("score_global", 0),
                        global_data.get("verdict", ""),
                        global_data.get("commentaire_global", ""),
                        _json_dump(global_data.get("weights", {})),
                        _json_dump(stored_result),
                        candidate_name,
                        now,
                    ),
                )
                analysis_id = int(cursor.lastrowid)
                for section in result.get("sections", []):
                    conn.execute(
                        """
                        INSERT INTO sections (
                            analysis_id, section_name, score, justification,
                            points_forts, points_faibles
                        ) VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (
                            analysis_id,
                            section.get("section_name", ""),
                            section.get("score", 0),
                            section.get("justification", ""),
                            _json_dump(section.get("points_forts", [])),
                            _json_dump(section.get("points_faibles", [])),
                        ),
                    )
                conn.execute(
                    """
                    INSERT INTO token_usage (
                        analysis_id, appel_api_count, tokens_prompt,
                        tokens_completion, tokens_total, duree_totale_secondes,
                        tokens_par_seconde
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        analysis_id,
                        token_data.get("appels_api", 0),
                        token_data.get("tokens_prompt", 0),
                        token_data.get("tokens_completion", 0),
                        token_data.get("tokens_total", 0),
                        token_data.get("duree_totale_secondes", 0.0),
                        token_data.get("tokens_par_seconde", 0.0),
                    ),
                )
                conn.execute("COMMIT")
                return analysis_id
            except Exception:
                conn.execute("ROLLBACK")
                raise

    @staticmethod
    def _summary_from_row(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
        item = dict(row)
        analysis_json = _json_load(item.pop("analysis_json", None), {})
        global_data = analysis_json.get("global", {})
        metrics = analysis_json.get("comparison_metrics", {})
        item["tags"] = _json_load(item.pop("tags_json", None), [])
        item["favorite"] = bool(item.get("favorite"))
        item["score_global"] = round(float(item.get("score_global") or 0), 2)
        item["skills"] = list(global_data.get("skills_presents", []))[:12]
        item["missing_skills"] = list(global_data.get("skills_absents", []))[:12]
        item["years_experience"] = metrics.get("years_experience", 0)
        # La CVthèque et la comparaison ont besoin des vrais scores par critère,
        # sans pour autant recevoir le texte du CV ni le résultat complet.
        item["sections"] = [
            {
                "section_name": section.get("section_name", ""),
                "score": round(float(section.get("score") or 0), 2),
            }
            for section in analysis_json.get("sections", [])
            if isinstance(section, dict)
        ][:4]
        return item

    def list_analyses(
        self,
        *,
        search: str | None = None,
        verdict: str | None = None,
        status: str | None = None,
        min_score: float | None = None,
        max_score: float | None = None,
        favorite: bool | None = None,
        limit: int = 50,
        offset: int = 0,
        sort: str = "created_at",
        order: str = "desc",
    ) -> dict[str, Any]:
        clauses: list[str] = []
        params: list[Any] = []
        if search:
            clauses.append(
                "(cv_filename LIKE ? OR COALESCE(candidate_name, '') LIKE ? "
                "OR job_description LIKE ? OR tags_json LIKE ?)"
            )
            needle = f"%{search}%"
            params.extend([needle, needle, needle, needle])
        if verdict:
            clauses.append("verdict = ?")
            params.append(verdict)
        if status:
            clauses.append("status = ?")
            params.append(status)
        if min_score is not None:
            clauses.append("score_global >= ?")
            params.append(min_score)
        if max_score is not None:
            clauses.append("score_global <= ?")
            params.append(max_score)
        if favorite is not None:
            clauses.append("favorite = ?")
            params.append(int(favorite))
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        sort_column = {
            "created_at": "created_at",
            "updated_at": "COALESCE(updated_at, created_at)",
            "score": "score_global",
            "name": "COALESCE(candidate_name, cv_filename)",
        }.get(sort, "created_at")
        direction = "ASC" if order.casefold() == "asc" else "DESC"
        with self.connection() as conn:
            total = int(
                conn.execute(
                    f"SELECT COUNT(*) FROM analyses {where}", params
                ).fetchone()[0]
            )
            rows = conn.execute(
                f"""
                SELECT id, cv_filename, candidate_name, score_global, verdict,
                       status, tags_json, favorite, created_at, updated_at,
                       analysis_json
                FROM analyses
                {where}
                ORDER BY {sort_column} {direction}, id DESC
                LIMIT ? OFFSET ?
                """,
                [*params, limit, offset],
            ).fetchall()
        return {
            "items": [self._summary_from_row(row) for row in rows],
            "total": total,
            "limit": limit,
            "offset": offset,
        }

    def get_analysis(self, analysis_id: int, *, include_document: bool = True) -> dict[str, Any] | None:
        with self.connection() as conn:
            row = conn.execute("SELECT * FROM analyses WHERE id = ?", (analysis_id,)).fetchone()
            if row is None:
                return None
            sections = conn.execute(
                """SELECT id, section_name, score, justification, points_forts,
                          points_faibles FROM sections WHERE analysis_id = ? ORDER BY id""",
                (analysis_id,),
            ).fetchall()
            tokens = conn.execute(
                "SELECT * FROM token_usage WHERE analysis_id = ?", (analysis_id,)
            ).fetchone()
        item = dict(row)
        item["weights"] = _json_load(item.pop("weights_json", None), {})
        item["analysis"] = _json_load(item.pop("analysis_json", None), {})
        item["tags"] = _json_load(item.pop("tags_json", None), [])
        item["favorite"] = bool(item.get("favorite"))
        item["sections"] = []
        for raw_section in sections:
            section = dict(raw_section)
            section["points_forts"] = _json_load(section.get("points_forts"), [])
            section["points_faibles"] = _json_load(section.get("points_faibles"), [])
            item["sections"].append(section)
        item["tokens"] = dict(tokens) if tokens else {}
        if not include_document:
            item.pop("markdown_content", None)
            item.pop("job_description", None)
            candidate_profile = item.get("analysis", {}).get("candidate_profile")
            if isinstance(candidate_profile, dict):
                candidate_profile.pop("markdown", None)
        return item

    def update_analysis(self, analysis_id: int, changes: dict[str, Any]) -> dict[str, Any] | None:
        mapping = {
            "candidate_name": "candidate_name",
            "status": "status",
            "tags": "tags_json",
            "notes": "notes",
            "favorite": "favorite",
        }
        assignments: list[str] = []
        params: list[Any] = []
        for public_name, column in mapping.items():
            if public_name not in changes:
                continue
            value = changes[public_name]
            if public_name == "tags":
                value = _json_dump(value or [])
            elif public_name == "favorite":
                value = int(bool(value))
            assignments.append(f"{column} = ?")
            params.append(value)
        if not assignments:
            return self.get_analysis(analysis_id, include_document=False)
        assignments.append("updated_at = ?")
        params.extend([_utc_now(), analysis_id])
        with self.connection() as conn:
            cursor = conn.execute(
                f"UPDATE analyses SET {', '.join(assignments)} WHERE id = ?", params
            )
        if cursor.rowcount == 0:
            return None
        return self.get_analysis(analysis_id, include_document=False)

    def bulk_update_analyses(
        self,
        analysis_ids: list[int],
        *,
        status: str | None = None,
        add_tags: list[str] | None = None,
        remove_tags: list[str] | None = None,
        favorite: bool | None = None,
    ) -> dict[str, Any]:
        """Met à jour jusqu'à 100 dossiers dans une transaction atomique."""

        unique_ids = list(dict.fromkeys(int(value) for value in analysis_ids))
        if not unique_ids or len(unique_ids) > 100 or any(value <= 0 for value in unique_ids):
            raise ValueError("Entre 1 et 100 identifiants positifs sont requis")
        add_tags = list(add_tags or [])
        remove_keys = {tag.casefold() for tag in (remove_tags or [])}
        placeholders = ",".join("?" for _ in unique_ids)
        now = _utc_now()

        with self.connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                rows = conn.execute(
                    f"SELECT id, tags_json FROM analyses WHERE id IN ({placeholders})",
                    unique_ids,
                ).fetchall()
                found_ids = {int(row["id"]) for row in rows}
                missing = [value for value in unique_ids if value not in found_ids]

                for row in rows:
                    assignments: list[str] = []
                    params: list[Any] = []
                    if status is not None:
                        assignments.append("status = ?")
                        params.append(status)
                    if add_tags or remove_tags:
                        tags = [str(tag) for tag in _json_load(row["tags_json"], [])]
                        tags = [tag for tag in tags if tag.casefold() not in remove_keys]
                        seen = {tag.casefold() for tag in tags}
                        for tag in add_tags:
                            if tag.casefold() not in seen and len(tags) < 20:
                                seen.add(tag.casefold())
                                tags.append(tag)
                        assignments.append("tags_json = ?")
                        params.append(_json_dump(tags))
                    if favorite is not None:
                        assignments.append("favorite = ?")
                        params.append(int(favorite))
                    assignments.append("updated_at = ?")
                    params.extend([now, int(row["id"])])
                    conn.execute(
                        f"UPDATE analyses SET {', '.join(assignments)} WHERE id = ?",
                        params,
                    )

                fields = [
                    name
                    for name, present in (
                        ("status", status is not None),
                        ("tags", bool(add_tags or remove_tags)),
                        ("favorite", favorite is not None),
                    )
                    if present
                ]
                conn.execute(
                    """
                    INSERT INTO audit_events (
                        action, entity_type, entity_id, summary, metadata_json, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        "analysis.bulk_updated",
                        "analysis",
                        None,
                        f"Mise à jour groupée de {len(found_ids)} dossier(s)",
                        _json_dump(
                            {
                                "fields": fields,
                                "requested": len(unique_ids),
                                "updated": len(found_ids),
                                "missing": missing,
                            }
                        ),
                        now,
                    ),
                )
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise

        items = [
            item
            for analysis_id in unique_ids
            if (item := self.get_analysis(analysis_id, include_document=False)) is not None
        ]
        return {
            "items": items,
            "requested": len(unique_ids),
            "updated": len(items),
            "missing": missing,
        }

    def record_audit_event(
        self,
        action: str,
        *,
        entity_type: str = "system",
        entity_id: str | int | None = None,
        summary: str,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Ajoute un événement sans nom, contact, note ni contenu de CV."""

        action = re.sub(r"[^a-z0-9_.-]", "", str(action).casefold())[:80] or "system.event"
        entity_type = re.sub(r"[^a-z0-9_.-]", "", str(entity_type).casefold())[:40] or "system"
        safe_entity_id = str(entity_id)[:80] if entity_id is not None else None
        safe_summary = " ".join(str(summary).split())[:240] or "Événement système"
        safe_metadata = _audit_metadata(metadata)
        now = _utc_now()
        with self.connection() as conn:
            cursor = conn.execute(
                """
                INSERT INTO audit_events (
                    action, entity_type, entity_id, summary, metadata_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (action, entity_type, safe_entity_id, safe_summary, _json_dump(safe_metadata), now),
            )
            # Rétention locale bornée pour éviter une croissance illimitée.
            conn.execute(
                """
                DELETE FROM audit_events
                WHERE id <= (SELECT MAX(id) - 5000 FROM audit_events)
                """
            )
            event_id = int(cursor.lastrowid)
        return {
            "id": event_id,
            "action": action,
            "entity_type": entity_type,
            "entity_id": safe_entity_id,
            "summary": safe_summary,
            "metadata": safe_metadata,
            "created_at": now,
        }

    def list_audit_events(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
        action: str | None = None,
    ) -> dict[str, Any]:
        clauses = "WHERE action = ?" if action else ""
        params: list[Any] = [action] if action else []
        with self.connection() as conn:
            total = int(
                conn.execute(f"SELECT COUNT(*) FROM audit_events {clauses}", params).fetchone()[0]
            )
            rows = conn.execute(
                f"""
                SELECT id, action, entity_type, entity_id, summary, metadata_json, created_at
                FROM audit_events {clauses}
                ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
                """,
                [*params, limit, offset],
            ).fetchall()
        items: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            item["metadata"] = _json_load(item.pop("metadata_json", None), {})
            items.append(item)
        return {"items": items, "total": total, "limit": limit, "offset": offset}

    def delete_analysis(self, analysis_id: int) -> bool:
        with self.connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                exists = conn.execute(
                    "SELECT 1 FROM analyses WHERE id = ?", (analysis_id,)
                ).fetchone()
                if exists is None:
                    conn.execute("ROLLBACK")
                    return False
                cursor = conn.execute("DELETE FROM analyses WHERE id = ?", (analysis_id,))
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise

            # Meilleur effort après commit : ne remet jamais en cause la suppression
            # logique si un autre lecteur empêche momentanément de tronquer le WAL.
            try:
                conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
            except sqlite3.OperationalError:
                pass
            return cursor.rowcount > 0

    def dashboard_stats(self) -> dict[str, Any]:
        with self.connection() as conn:
            overview = dict(
                conn.execute(
                    """
                    SELECT COUNT(*) AS total_cvs,
                           ROUND(COALESCE(AVG(score_global), 0), 2) AS average_score,
                           ROUND(COALESCE(MAX(score_global), 0), 2) AS best_score,
                           SUM(CASE WHEN favorite = 1 THEN 1 ELSE 0 END) AS favorites
                    FROM analyses
                    """
                ).fetchone()
            )
            token_row = conn.execute(
                """SELECT COALESCE(SUM(tokens_total), 0) AS total_tokens,
                          COALESCE(SUM(appel_api_count), 0) AS api_calls
                   FROM token_usage"""
            ).fetchone()
            verdict_rows = conn.execute(
                """SELECT COALESCE(verdict, 'Non défini') AS label, COUNT(*) AS value
                   FROM analyses GROUP BY verdict ORDER BY value DESC"""
            ).fetchall()
            status_rows = conn.execute(
                """SELECT status AS label, COUNT(*) AS value FROM analyses
                   GROUP BY status ORDER BY value DESC"""
            ).fetchall()
            section_rows = conn.execute(
                """SELECT section_name AS name, ROUND(AVG(score), 2) AS score
                   FROM sections GROUP BY section_name ORDER BY MIN(id)"""
            ).fetchall()
            trend_rows = conn.execute(
                """SELECT date(created_at) AS date, ROUND(AVG(score_global), 2) AS score,
                          COUNT(*) AS analyses
                   FROM analyses GROUP BY date(created_at)
                   ORDER BY date(created_at) DESC LIMIT 30"""
            ).fetchall()
            recent_rows = conn.execute(
                """SELECT id, cv_filename, candidate_name, score_global, verdict,
                          status, tags_json, favorite, created_at, updated_at, analysis_json
                   FROM analyses ORDER BY created_at DESC, id DESC LIMIT 6"""
            ).fetchall()
            payloads = conn.execute("SELECT analysis_json FROM analyses").fetchall()

        skill_counter: Counter[str] = Counter()
        missing_counter: Counter[str] = Counter()
        for payload_row in payloads:
            payload = _json_load(payload_row["analysis_json"], {})
            global_data = payload.get("global", {})
            for skill in set(global_data.get("skills_presents", [])):
                if skill:
                    skill_counter[str(skill)] += 1
            for skill in set(global_data.get("skills_absents", [])):
                if skill:
                    missing_counter[str(skill)] += 1

        overview.update(dict(token_row))
        overview["recommended"] = sum(
            row["value"] for row in verdict_rows if "RECOMMAND" in row["label"] and "NON" not in row["label"]
        )
        return {
            "overview": overview,
            "verdict_distribution": [dict(row) for row in verdict_rows],
            "status_distribution": [dict(row) for row in status_rows],
            "section_averages": [dict(row) for row in section_rows],
            "score_trend": [dict(row) for row in reversed(trend_rows)],
            "top_skills": [
                {"name": name, "count": count} for name, count in skill_counter.most_common(12)
            ],
            "top_missing_skills": [
                {"name": name, "count": count} for name, count in missing_counter.most_common(12)
            ],
            "recent_analyses": [self._summary_from_row(row) for row in recent_rows],
        }

    def iter_analysis_documents(
        self, ids: list[int] | None = None, *, batch_size: int = 32
    ) -> Iterator[dict[str, Any]]:
        """Parcourt exhaustivement les documents sans charger toute la base en mémoire."""

        clauses = ""
        params: list[Any] = []
        if ids:
            placeholders = ",".join("?" for _ in ids)
            clauses = f"WHERE id IN ({placeholders})"
            params.extend(ids)
        with self.connection() as conn:
            cursor = conn.execute(
                f"""SELECT id, cv_filename, candidate_name, score_global, verdict,
                           status, tags_json, notes, favorite, job_description,
                           markdown_content, analysis_json,
                           created_at, updated_at
                    FROM analyses {clauses}
                    ORDER BY created_at DESC, id DESC""",
                params,
            )
            safe_batch_size = max(1, min(int(batch_size), 200))
            while rows := cursor.fetchmany(safe_batch_size):
                for row in rows:
                    item = dict(row)
                    item["analysis"] = _json_load(item.pop("analysis_json", None), {})
                    item["tags"] = _json_load(item.pop("tags_json", None), [])
                    yield item

    def analysis_documents(self, ids: list[int] | None = None) -> list[dict[str, Any]]:
        """Retourne une liste exhaustive pour les rares consommateurs non diffusés."""

        return list(self.iter_analysis_documents(ids))
