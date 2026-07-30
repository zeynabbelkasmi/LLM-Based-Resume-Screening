"""Tests du convertisseur PDF → Markdown (parties pur-texte)."""

import pytest

import convertisseur


def test_clean_page_text_merges_wrapped_lines():
    text = "Développeur backend au sein\nd'une équipe agile."
    cleaned = convertisseur._clean_page_text(text)
    assert "au sein d'une équipe agile." in cleaned


def test_clean_page_text_repairs_hyphenated_words():
    assert "développement" in convertisseur._clean_page_text("dévelop-\npement web")


def test_clean_page_text_preserves_uppercase_section_headers():
    text = "Sarah Martin\nFORMATION\nMaster IA - CentraleSupelec\nCOMPÉTENCES\nPython, SQL"
    cleaned = convertisseur._clean_page_text(text)
    assert "FORMATION" in cleaned.splitlines()
    assert "COMPÉTENCES" in cleaned.splitlines()


def test_clean_page_text_keeps_breaks_after_punctuation():
    cleaned = convertisseur._clean_page_text("Première phrase.\nDeuxième phrase.")
    assert cleaned.splitlines() == ["Première phrase.", "Deuxième phrase."]


def test_identify_sections_finds_standard_headers():
    text = (
        "FORMATION\nMaster Informatique, 2021\n"
        "EXPÉRIENCE PROFESSIONNELLE\nData Analyst chez ACME\n"
        "COMPÉTENCES\nPython, SQL"
    )
    sections = dict(convertisseur._identify_sections(text))
    assert "Formation" in sections
    assert "Expérience Professionnelle" in sections
    assert "Master Informatique" in sections["Formation"]


def test_convert_to_markdown_structure():
    raw = "FORMATION\nMaster Informatique\nCOMPÉTENCES\nPython, SQL"
    result = convertisseur.convert_to_markdown(raw, "jean_dupont-cv.pdf")
    markdown = result["markdown"]
    assert markdown.startswith("# CV — Jean Dupont Cv")
    assert "## Formation" in markdown
    assert result["filename"] == "jean_dupont-cv.pdf"


def test_convert_to_markdown_without_sections_keeps_raw_text():
    raw = "Texte libre sans aucun en-tête reconnu ici même"
    result = convertisseur.convert_to_markdown(raw, "cv.pdf")
    assert raw in result["markdown"]


def test_process_cv_pdf_rejects_missing_file():
    with pytest.raises(FileNotFoundError):
        convertisseur.process_cv_pdf("introuvable_9999.pdf")


def test_process_cv_pdf_rejects_non_pdf(tmp_path):
    txt = tmp_path / "cv.txt"
    txt.write_text("pas un pdf", encoding="utf-8")
    with pytest.raises(ValueError):
        convertisseur.process_cv_pdf(str(txt))
