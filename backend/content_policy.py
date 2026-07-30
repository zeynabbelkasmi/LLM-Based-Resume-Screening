"""Politique partagée de détection des attributs sensibles RH."""

from __future__ import annotations

import re
import unicodedata


SENSITIVE_OUTPUT_REFUSAL = (
    "Je ne peux pas fournir cette réponse, car elle pourrait utiliser des "
    "informations personnelles non pertinentes pour l'évaluation professionnelle. "
    "Toute décision doit être fondée sur les compétences et validée par un humain."
)


def normalize_text(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", (text or "").casefold())
    return "".join(char for char in normalized if not unicodedata.combining(char))


# Frontières explicites : ``age`` ne doit pas correspondre à ``management`` ou
# ``langage``. Les locutions techniques sûres sont retirées avant l'évaluation.
_SENSITIVE_PATTERNS = tuple(
    re.compile(pattern)
    for pattern in (
        r"(?<![a-z0-9])ages?(?![a-z0-9])",
        r"(?<![a-z0-9])genres?(?![a-z0-9])",
        r"(?<![a-z0-9])genders?(?![a-z0-9])",
        r"(?<![a-z0-9])sexes?(?![a-z0-9])",
        r"(?<![a-z0-9])origines?(?![a-z0-9])",
        r"(?<![a-z0-9])origins?(?![a-z0-9])",
        r"(?<![a-z0-9])races?(?![a-z0-9])",
        r"(?<![a-z0-9])racial(?:e|es|s)?(?![a-z0-9])",
        r"(?<![a-z0-9])ethni(?:e|es|que|ques|city|c)(?![a-z0-9])",
        r"(?<![a-z0-9])religions?(?![a-z0-9])",
        r"(?<![a-z0-9])religious(?:\s+beliefs?)?(?![a-z0-9])",
        r"(?<![a-z0-9])sante(?![a-z0-9])",
        r"(?<![a-z0-9])health(?![a-z0-9])",
        r"(?<![a-z0-9])medical(?:\s+(?:condition|history|status))?(?![a-z0-9])",
        r"(?<![a-z0-9])handicaps?(?![a-z0-9])",
        r"(?<![a-z0-9])disabilit(?:y|ies)(?![a-z0-9])",
        r"(?<![a-z0-9])disabled(?![a-z0-9])",
        r"(?<![a-z0-9])enceinte(?:s)?(?![a-z0-9])",
        r"(?<![a-z0-9])grossesses?(?![a-z0-9])",
        r"(?<![a-z0-9])pregnan(?:t|cy)(?![a-z0-9])",
        r"(?<![a-z0-9])orientations?\s+sexuelles?(?![a-z0-9])",
        r"(?<![a-z0-9])sexual\s+orientations?(?![a-z0-9])",
        r"(?<![a-z0-9])opinions?\s+politiques?(?![a-z0-9])",
        r"(?<![a-z0-9])political\s+(?:opinions?|affiliations?)(?![a-z0-9])",
        r"(?<![a-z0-9])appartenance\s+syndicale(?![a-z0-9])",
        r"(?<![a-z0-9])syndicats?(?![a-z0-9])",
        r"(?<![a-z0-9])(?:trade\s+union|union\s+membership)(?![a-z0-9])",
        r"(?<![a-z0-9])nationalites?(?![a-z0-9])",
        r"(?<![a-z0-9])nationalit(?:y|ies)(?![a-z0-9])",
        r"(?<![a-z0-9])citizenships?(?![a-z0-9])",
        r"(?<![a-z0-9])situations?\s+familiales?(?![a-z0-9])",
        r"(?<![a-z0-9])etat\s+civil(?![a-z0-9])",
        r"(?<![a-z0-9])(?:marital|family)\s+status(?![a-z0-9])",
        r"(?<![a-z0-9])(?:plus\s+)?jeunes?(?![a-z0-9])",
        r"(?<![a-z0-9])(?:plus\s+)?(?:vieux|vieille|vieilles)(?![a-z0-9])",
        r"(?<![a-z0-9])(?:youngest|oldest)(?![a-z0-9])",
        r"(?<![a-z0-9])hommes?\s+(?:ou|et)\s+(?:(?:un|une|des|les)\s+)?femmes?(?![a-z0-9])",
        r"(?<![a-z0-9])femmes?\s+(?:ou|et)\s+(?:(?:un|une|des|les)\s+)?hommes?(?![a-z0-9])",
        r"(?<![a-z0-9])(?:men|women)\s+(?:or|and)\s+(?:men|women)(?![a-z0-9])",
        r"(?<![a-z0-9])(?:male|female)s?(?![a-z0-9])",
        r"(?<![a-z0-9])(?:marie|mariee|maries|mariees|celibataire|celibataires)(?![a-z0-9])",
        r"(?<![a-z0-9])(?:married|single|divorced|widowed)(?![a-z0-9])",
        r"(?<![a-z0-9])(?:musulman|musulmane|musulmans|musulmanes|muslim|muslims)(?![a-z0-9])",
        r"(?<![a-z0-9])(?:chretien|chretienne|juif|juive|hindou|bouddhiste|atheist|athee)s?(?![a-z0-9])",
        r"(?<![a-z0-9])(?:gay|lesbienne?|homosexuel(?:le)?|bisexuel(?:le)?|queer)s?(?![a-z0-9])",
        r"(?<![a-z0-9])(?:candidat|candidate|profil)\s+(?:est\s+)?(?:de\s+)?\d{1,3}\s+ans(?![a-z0-9])",
        r"(?<![a-z0-9])(?:preferer|privilegier|recommander|choisir|favoriser)\w*\s+(?:(?:un|une|le|la|les)\s+)?(?:homme|femme)(?![a-z0-9])",
        r"(?<![a-z0-9])(?:candidat|candidate|profil)\s+(?:est|semble)\s+(?:un|une)\s+(?:homme|femme)(?![a-z0-9])",
    )
)

_PROFESSIONAL_SAFE_PATTERNS = tuple(
    re.compile(pattern)
    for pattern in (
        r"(?<![a-z0-9])race\s+conditions?(?![a-z0-9])",
        r"(?<![a-z0-9])same[-\s]?origin(?![a-z0-9])",
        # « jeune diplômé(e) » désigne un stade de carrière (sortie d'études),
        # pas l'âge de la personne ; « plus jeune diplômé » reste bloqué.
        r"(?<!plus )(?<![a-z0-9])jeunes?\s+diplome(?:e|es|s)?(?![a-z0-9])",
    )
)


def contains_sensitive_content(text: str) -> bool:
    normalized = normalize_text(text)
    for safe_pattern in _PROFESSIONAL_SAFE_PATTERNS:
        normalized = safe_pattern.sub(" ", normalized)
    return any(pattern.search(normalized) for pattern in _SENSITIVE_PATTERNS)
