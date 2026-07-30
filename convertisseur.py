"""
convertisseur.py — Extraction PDF et structuration Markdown.
"""

from io import BytesIO
from pathlib import Path
import re
from typing import List, Dict

import pdfplumber


def extract_raw_text(pdf_path: Path) -> str:
    """
    Extrait tout le texte d'un fichier PDF page par page.
    Gère les PDF multi-colonnes et les tableaux basiques.
    """
    full_text: List[str] = []

    with pdfplumber.open(str(pdf_path)) as pdf:
        for page_num, page in enumerate(pdf.pages, 1):
            text = page.extract_text()
            if text:
                # Nettoie les sauts de ligne parasites dans les paragraphes
                cleaned = _clean_page_text(text)
                full_text.append(f"## Page {page_num}\n\n{cleaned}")

    return "\n\n".join(full_text)


def extract_raw_text_from_bytes(pdf_bytes: bytes) -> str:
    """
    Extrait le texte d'un PDF fourni en mémoire.
    Utile pour la fiche de poste uploadée dans l'interface.
    """
    full_text: List[str] = []

    with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
        for page_num, page in enumerate(pdf.pages, 1):
            text = page.extract_text()
            if text:
                cleaned = _clean_page_text(text)
                full_text.append(f"## Page {page_num}\n\n{cleaned}")

    return "\n\n".join(full_text)


def _clean_page_text(text: str) -> str:
    """
    Nettoie le texte extrait : fusionne les lignes coupées en milieu de phrase,
    supprime les espaces multiples, normalise les retours à la ligne.
    """
    # Supprime les traits d'union en fin de ligne (coupure de mot)
    text = re.sub(r'(\w)-\n(\w)', r'\1\2', text)

    # Fusionne les lignes qui ne se terminent pas par une ponctuation de fin
    lines = text.split('\n')
    cleaned: List[str] = []
    buffer = ''

    for line in lines:
        stripped = line.strip()
        if not stripped:
            if buffer:
                cleaned.append(buffer)
                buffer = ''
            cleaned.append('')
            continue

        # Les titres de section (lignes courtes en majuscules) restent isolés :
        # les fusionner ferait disparaître la structure du CV.
        if _looks_like_header(stripped):
            if buffer:
                cleaned.append(buffer)
                buffer = ''
            cleaned.append(stripped)
            continue

        # Si la ligne précédente ne finit pas par une ponctuation terminale
        # ou un deux-points, on fusionne
        if buffer:
            if buffer[-1] in '.!?…:;,—-':
                cleaned.append(buffer)
                buffer = stripped
            else:
                buffer += ' ' + stripped
        else:
            buffer = stripped

    if buffer:
        cleaned.append(buffer)

    return '\n'.join(cleaned)


def _looks_like_header(line: str, max_length: int = 60) -> bool:
    """
    Vrai si la ligne ressemble à un titre de section de CV :
    courte et essentiellement en majuscules (ex. « EXPÉRIENCE PROFESSIONNELLE »).
    """
    if len(line) > max_length:
        return False
    letters = [ch for ch in line if ch.isalpha()]
    if len(letters) < 3:
        return False
    upper_ratio = sum(1 for ch in letters if ch.isupper()) / len(letters)
    return upper_ratio >= 0.8


def convert_to_markdown(raw_text: str, filename: str) -> Dict[str, str]:
    """
    Transforme le texte brut en Markdown structuré avec :
      - Un titre de niveau 1 (nom du fichier)
      - Des sections identifiées automatiquement
      - Des listes à puces pour les énumérations

    Retourne un dict avec la clé 'markdown'.
    """
    md_lines: List[str] = []
    clean_name = Path(filename).stem.replace('_', ' ').replace('-', ' ').title()
    md_lines.append(f"# CV — {clean_name}\n")

    sections_found = _identify_sections(raw_text)

    if sections_found:
        for section_title, section_body in sections_found:
            md_lines.append(f"## {section_title}\n")
            md_lines.append(f"{section_body}\n")
    else:
        # Pas de sections détectées : on met tout en bloc
        md_lines.append(raw_text)

    return {
        "markdown": "\n".join(md_lines),
        "filename": filename,
    }


def _identify_sections(text: str) -> List[tuple]:
    """
    Détecte les sections d'un CV à partir de mots-clés connus (français + anglais).
    Retourne une liste de tuples (titre_section, contenu_section).
    """
    # Classes de caractères [ÉE], [ÈE]… : l'extraction PDF perd souvent les accents.
    section_patterns = [
        (r'(?:EXP[ÉE]RIENCES?(?:\s+PRO\w*)?|EMPLOI|WORK EXPERIENCE|PROFESSIONAL EXPERIENCE|EMPLOYMENT|PARCOURS PROFESSIONNEL|CARRI[ÈE]RE)',
         'Expérience Professionnelle'),
        (r'(?:FORMATIONS?|[ÉE]DUCATION|EDUCATION|DIPL[ÔO]MES?|DIPLOMAS?|STUDIES|ACADEMIC|PARCOURS ACAD[ÉE]MIQUE|CURSUS|SCOLARIT[ÉE])',
         'Formation'),
        (r'(?:COMP[ÉE]TENCES?|SKILLS|COMPETENCIES|SAVOIR-FAIRE|TECHNIQUES|TECHNICAL SKILLS|HARD SKILLS|LANGUES?|LANGUAGES|INFORMATIQUE|OUTILS|TECHNOLOGIES|STACK TECHNIQUE)',
         'Compétences Techniques'),
        (r'(?:LANGUES?|LANGUAGES|LANGAGES)',
         'Langues'),
        (r'(?:SOFT SKILLS|QUALIT[ÉE]S|QUALITIES|APTITUDES|COMP[ÉE]TENCES COMPORTEMENTALES|PERSONAL SKILLS|ATOUTS|SAVOIR-[ÊE]TRE|INTERPERSONAL)',
         'Soft Skills'),
        (r'(?:CENTRES? D[’\']INT[ÉE]R[ÊE]TS?|LOISIRS|HOBBIES|INTERESTS|PASSIONS|ACTIVIT[ÉE]S|EXTRA-CURRICULAR|B[ÉE]N[ÉE]VOLAT|VOLUNTEER)',
         'Centres d\'Intérêt'),
        (r'(?:PROJETS?|PROJECTS|R[ÉE]ALISATIONS?|ACHIEVEMENTS|PORTFOLIO)',
         'Projets'),
        (r'(?:PROFIL|PROFILE|R[ÉE]SUM[ÉE]|SUMMARY|OBJECTIF|OBJECTIVE|[ÀA] PROPOS|ABOUT ME|PR[ÉE]SENTATION|INTRODUCTION)',
         'Profil'),
        (r'(?:CERTIFICATIONS?|CERTIFICATES|HABILITATIONS?|LICENCES?)',
         'Certifications'),
    ]

    # On cherche chaque section dans le texte
    found: List[tuple] = []
    remaining = text

    # Approche : on cherche tous les titres de section et leur position.
    # Un mot-clé n'est retenu comme titre que s'il ouvre une ligne courte :
    # cela évite de découper « Master Informatique » ou « 3 ans d'expérience »
    # rencontrés au milieu du contenu.
    matches = []
    for pattern, display_name in section_patterns:
        for match in re.finditer(pattern, remaining, re.IGNORECASE):
            if _is_probable_header(remaining, match.start()):
                matches.append((match.start(), match.end(), display_name))

    # Trie par position dans le texte
    matches.sort(key=lambda x: x[0])

    # Découpe le texte entre les sections
    for i, (start, end, display_name) in enumerate(matches):
        section_start = _skip_header_residue(remaining, end)
        section_end = matches[i + 1][0] if i + 1 < len(matches) else len(remaining)
        body = remaining[section_start:section_end].strip()

        # Nettoie le début (supprime ':', tirets, espaces)
        body = re.sub(r'^[\s:—\-–]+', '', body)

        if body:
            found.append((display_name, body))

    return found


def _skip_header_residue(text: str, match_end: int) -> int:
    """
    Si le reste de la ligne après le mot-clé n'est que la fin du titre
    (ex. « PROFESSIONNELLE » après « EXPÉRIENCE »), le contenu de la section
    commence à la ligne suivante. S'il contient du vrai texte (minuscules),
    on le conserve.
    """
    line_end = text.find('\n', match_end)
    if line_end == -1:
        line_end = len(text)
    residue = text[match_end:line_end]
    lowercase_count = sum(1 for ch in residue if ch.isalpha() and ch.islower())
    return line_end if lowercase_count < 3 else match_end


def _is_probable_header(text: str, match_start: int, max_line_length: int = 60) -> bool:
    """
    Vrai si le mot-clé trouvé à `match_start` ressemble à un titre de section :
    en début de ligne (hors espaces) et sur une ligne courte.
    """
    line_start = text.rfind('\n', 0, match_start) + 1
    if text[line_start:match_start].strip():
        return False
    line_end = text.find('\n', match_start)
    if line_end == -1:
        line_end = len(text)
    return len(text[line_start:line_end].strip()) <= max_line_length


def process_cv_pdf(file_path: str) -> Dict[str, str]:
    """
    Point d'entrée unique : prend un chemin de PDF,
    retourne le Markdown structuré et le nom de fichier.
    """
    path = Path(file_path)

    if not path.exists():
        raise FileNotFoundError(f"Fichier introuvable : {file_path}")

    if path.suffix.lower() != '.pdf':
        raise ValueError(f"Format non supporté : {path.suffix}. Seuls les PDF sont acceptés.")

    raw = extract_raw_text(path)
    result = convert_to_markdown(raw, path.name)

    return result


def process_job_pdf_bytes(pdf_bytes: bytes, filename: str = "fiche_de_poste.pdf") -> Dict[str, str]:
    """
    Convertit une fiche de poste PDF en texte exploitable.
    """
    raw = extract_raw_text_from_bytes(pdf_bytes)
    return {
        "text": raw.strip(),
        "filename": filename,
    }
