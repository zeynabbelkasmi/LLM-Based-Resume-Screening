from pathlib import Path

# Adjust base path if needed
base = Path(r"c:\Users\zeyna\Downloads\Zeynab CV Sqli - COMPLET - VERIFIE V2\Zeynab CV Sqli")

candidates = base / "frontend" / "src" / "pages" / "Candidates.tsx"
cdetail = base / "frontend" / "src" / "pages" / "CandidateDetail.tsx"

if not candidates.exists():
    print('Candidates.tsx not found at', candidates)
else:
    text = candidates.read_text(encoding='utf-8')
    text = text.replace('useState<"excel" | "pdf" | null>(null)', 'useState<"excel" | null>(null)')
    text = text.replace('const downloadExport = async (format: "excel" | "pdf") => {', 'const downloadExport = async (format: "excel") => {')
    text = text.replace('if (format === "excel") await api.downloadCandidatesExcel();\n      else await api.downloadCandidatesPdf();', 'await api.downloadCandidatesExcel();')
    # remove pdf button block
    text = text.replace('\n                <button type="button" onClick={() => void downloadExport("pdf")} disabled={!candidates.length || exporting !== null || source !== "api"}>\n                  <i className="export-icon export-icon--pdf"><FileText size={18} /></i>\n                  <div><strong>Rapport PDF consolidé</strong><small>Synthèse paginée de tous les profils</small></div>\n                  <FileDown size={15} />\n                </button>\n                <p>{exporting ? `Génération ${exporting === "excel" ? "du classeur" : "du rapport"}…` : "Exports confidentiels · contenu brut exclu"}</p>', '\n                <p>{exporting ? `Génération du classeur…` : "Exports confidentiels · contenu brut exclu"}</p>')
    candidates.write_text(text, encoding='utf-8')
    print('Patched Candidates.tsx')

if not cdetail.exists():
    print('CandidateDetail.tsx not found at', cdetail)
else:
    text = cdetail.read_text(encoding='utf-8')
    text = text.replace('const [exportingReport, setExportingReport] = useState(false);\n  const [exportError, setExportError] = useState<string | null>(null);', '// Export PDF report removed')
    text = text.replace('const exportReport = async () => {\n    if (source !== "api") return;\n    setExportingReport(true);\n    setExportError(null);\n    try {\n      await api.downloadCandidatePdf(candidate.id);\n    } catch (error) {\n      setExportError(error instanceof Error ? error.message : "Le rapport PDF n’a pas pu être généré.");\n    } finally {\n      setExportingReport(false);\n    }\n  };', '// exportReport removed per request')
    text = text.replace('          <button className="button button--secondary" onClick={() => void exportReport()} disabled={exportingReport || source !== "api"}>\n            <Download size={16} />\n            {exportingReport ? "Génération…" : "Rapport PDF"}\n          </button>\n', '')
    text = text.replace('\n      {exportError && (\n        <div className="api-error-banner" role="alert">\n          <span>{exportError}</span>\n          <button className="icon-button icon-button--sm" onClick={() => setExportError(null)} aria-label="Fermer"><X size={15} /></button>\n        </div>\n      )}\n', '\n')
    cdetail.write_text(text, encoding='utf-8')
    print('Patched CandidateDetail.tsx')
