import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDownAZ,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Download,
  FileDown,
  FileSpreadsheet,
  FileText,
  FilePlus2,
  Filter,
  Grid2X2,
  List,
  Search,
  SlidersHorizontal,
  Sparkles,
  Tag,
  UsersRound,
  X,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "../lib/navigation";
import {
  Avatar,
  EmptyState,
  ErrorState,
  PageHeading,
  PageTransition,
  ScoreBar,
  StatusBadge,
  TableSkeleton,
} from "../components/ui";
import { useData } from "../context/DataContext";
import { api } from "../lib/api";
import type { Candidate, CandidateStatus, WorkflowStatus } from "../types";
import "./candidates-enterprise.css";

type SortKey = "score-desc" | "score-asc" | "recent" | "name";

export default function Candidates() {
  const { candidates, source, error, refresh } = useData();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | CandidateStatus>("all");
  const [sort, setSort] = useState<SortKey>("score-desc");
  const [view, setView] = useState<"table" | "grid">("table");
  const [selected, setSelected] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [exporting, setExporting] = useState<"excel" | "pdf" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [bulkStatus, setBulkStatus] = useState<"" | WorkflowStatus>("");
  const [bulkTag, setBulkTag] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return candidates
      .filter((candidate) => status === "all" || candidate.status === status)
      .filter(
        (candidate) =>
          !normalized ||
          `${candidate.name} ${candidate.headline} ${candidate.location} ${candidate.skills.join(" ")}`
            .toLowerCase()
            .includes(normalized),
      )
      .sort((a, b) =>
        sort === "score-desc"
          ? b.score - a.score
          : sort === "score-asc"
            ? a.score - b.score
            : sort === "name"
              ? a.name.localeCompare(b.name, "fr")
              : Date.parse(b.analyzedAt) - Date.parse(a.analyzedAt),
      );
  }, [candidates, query, sort, status]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visibleCandidates = filtered.slice(
    (page - 1) * pageSize,
    page * pageSize,
  );

  useEffect(() => {
    setPage(1);
  }, [query, sort, status, view]);
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const selectedCandidates = candidates.filter((candidate) =>
    selected.includes(candidate.id),
  );
  const toggleSelected = (id: string) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : current.length < 100
          ? [...current, id]
          : current,
    );

  const allVisibleSelected = visibleCandidates.length > 0 && visibleCandidates.every((candidate) => selected.includes(candidate.id));
  const toggleVisible = () => {
    const visibleIds = visibleCandidates.map((candidate) => candidate.id);
    setSelected((current) => allVisibleSelected
      ? current.filter((id) => !visibleIds.includes(id))
      : [...new Set([...current, ...visibleIds])].slice(0, 100));
  };

  const downloadExport = async (format: "excel" | "pdf") => {
    setExporting(format);
    setActionError(null);
    try {
      if (format === "excel") await api.downloadCandidatesExcel();
      else await api.downloadCandidatesPdf();
    } catch (downloadError) {
      setActionError(downloadError instanceof Error ? downloadError.message : "L’export n’a pas pu être généré.");
    } finally {
      setExporting(null);
    }
  };

  const applyBulkUpdate = async (favorite?: boolean) => {
    const normalizedTag = bulkTag.trim();
    if (!selected.length || (!bulkStatus && !normalizedTag && favorite === undefined)) return;
    setBulkBusy(true);
    setActionError(null);
    try {
      await api.bulkUpdateCandidates(selected, {
        ...(bulkStatus ? { status: bulkStatus } : {}),
        ...(normalizedTag ? { add_tags: [normalizedTag] } : {}),
        ...(favorite !== undefined ? { favorite } : {}),
      });
      setBulkStatus("");
      setBulkTag("");
      await refresh();
    } catch (bulkError) {
      setActionError(bulkError instanceof Error ? bulkError.message : "La mise à jour groupée a échoué.");
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <PageTransition>
      <PageHeading
        eyebrow="CVthèque intelligente"
        title="CV & candidats"
        description="Explorez, filtrez et comparez tous les profils analysés."
        actions={
          <>
            <details className="export-menu">
              <summary className="button button--secondary" aria-label="Télécharger la liste des candidats">
                <Download size={17} />
                Télécharger
                <ChevronDown size={14} />
              </summary>
              <div className="export-menu__popover">
                <span>Exporter toute la CVthèque</span>
                <button type="button" onClick={() => void downloadExport("excel")} disabled={!candidates.length || exporting !== null || source !== "api"}>
                  <i className="export-icon export-icon--excel"><FileSpreadsheet size={18} /></i>
                  <div><strong>Classeur Excel</strong><small>24 colonnes · filtrable · exhaustif</small></div>
                  <FileDown size={15} />
                </button>
                <button type="button" onClick={() => void downloadExport("pdf")} disabled={!candidates.length || exporting !== null || source !== "api"}>
                  <i className="export-icon export-icon--pdf"><FileText size={18} /></i>
                  <div><strong>Rapport PDF consolidé</strong><small>Synthèse paginée de tous les profils</small></div>
                  <FileDown size={15} />
                </button>
                <p>{exporting ? `Génération ${exporting === "excel" ? "du classeur" : "du rapport"}…` : "Exports confidentiels · contenu brut exclu"}</p>
              </div>
            </details>
            <Link className="button button--primary" to="/analyse">
              <FilePlus2 size={17} />
              Ajouter des CV
            </Link>
          </>
        }
      />
      {actionError && (
        <div className="api-error-banner" role="alert">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} aria-label="Fermer"><X size={15} /></button>
        </div>
      )}

      <section className="library-summary">
        <div>
          <span>Tous les profils</span>
          <strong>{candidates.length}</strong>
        </div>
        <i />
        <div>
          <span>Recommandés</span>
          <strong>
            {candidates.filter((item) => item.status === "recommended").length}
          </strong>
        </div>
        <i />
        <div>
          <span>À considérer</span>
          <strong>
            {candidates.filter((item) => item.status === "consider").length}
          </strong>
        </div>
        <i />
        <div>
          <span>Score moyen</span>
          <strong>
            {candidates.length
              ? Math.round(
                  candidates.reduce((sum, item) => sum + item.score, 0) /
                    candidates.length,
                )
              : 0}
            <small>/100</small>
          </strong>
        </div>
      </section>

      <section className="candidate-toolbar">
        <div className="search-field">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher par nom, rôle, compétence…"
          />
          {query && (
            <button onClick={() => setQuery("")} aria-label="Effacer">
              <X size={16} />
            </button>
          )}
        </div>
        <label className="select-control">
          <Filter size={16} />
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="all">Tous les verdicts</option>
            <option value="recommended">Recommandés</option>
            <option value="consider">À considérer</option>
            <option value="not-recommended">Non retenus</option>
          </select>
          <ChevronDown size={15} />
        </label>
        <label className="select-control">
          <ArrowUpDown size={16} />
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
          >
            <option value="score-desc">Score décroissant</option>
            <option value="score-asc">Score croissant</option>
            <option value="recent">Plus récents</option>
            <option value="name">Nom A–Z</option>
          </select>
          <ChevronDown size={15} />
        </label>
        <div className="view-toggle">
          <button
            className={view === "table" ? "is-active" : ""}
            onClick={() => setView("table")}
            aria-label="Vue liste"
          >
            <List size={17} />
          </button>
          <button
            className={view === "grid" ? "is-active" : ""}
            onClick={() => setView("grid")}
            aria-label="Vue grille"
          >
            <Grid2X2 size={17} />
          </button>
        </div>
      </section>

      {source === "loading" ? (
        <div className="candidate-table panel">
          <TableSkeleton rows={7} />
        </div>
      ) : source === "error" ? (
        <ErrorState
          message={error || "Impossible de charger la CVthèque."}
          retry={() => void refresh()}
        />
      ) : !filtered.length ? (
        <EmptyState
          title="Aucun profil trouvé"
          description={
            query || status !== "all"
              ? "Modifiez vos filtres pour élargir la recherche."
              : "Importez vos premiers CV pour construire votre vivier."
          }
          action={
            <button
              className="button button--secondary"
              onClick={() => {
                setQuery("");
                setStatus("all");
              }}
            >
              Réinitialiser les filtres
            </button>
          }
        />
      ) : view === "table" ? (
        <section className="candidate-table panel">
          <div className="candidate-table__head">
            <label className="custom-check check-cell" title="Sélectionner la page">
              <input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} aria-label="Sélectionner les profils de cette page" />
              <span>{allVisibleSelected && <Check size={12} />}</span>
            </label>
            <span>Candidat</span>
            <span>Score d’adéquation</span>
            <span>Verdict</span>
            <span>Expérience</span>
            <span>Analyse</span>
            <span />
          </div>
          {visibleCandidates.map((candidate, index) => (
            <CandidateRow
              key={candidate.id}
              candidate={candidate}
              index={(page - 1) * pageSize + index}
              checked={selected.includes(candidate.id)}
              onCheck={() => toggleSelected(candidate.id)}
            />
          ))}
          <footer className="table-footer">
            <span>
              {filtered.length} profil{filtered.length > 1 ? "s" : ""} · page{" "}
              {page}/{pageCount}
            </span>
            <div>
              <button
                disabled={page === 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                aria-label="Page précédente"
              >
                <ChevronLeft size={16} />
              </button>
              {Array.from({ length: pageCount }, (_, index) => index + 1)
                .filter(
                  (value) =>
                    value === 1 ||
                    value === pageCount ||
                    Math.abs(value - page) <= 1,
                )
                .map((value) => (
                  <button
                    key={value}
                    className={value === page ? "is-active" : ""}
                    onClick={() => setPage(value)}
                  >
                    {value}
                  </button>
                ))}
              <button
                disabled={page === pageCount}
                onClick={() =>
                  setPage((value) => Math.min(pageCount, value + 1))
                }
                aria-label="Page suivante"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </footer>
        </section>
      ) : (
        <>
          <section className="candidate-grid">
            {visibleCandidates.map((candidate, index) => (
              <CandidateCard
                key={candidate.id}
                candidate={candidate}
                index={(page - 1) * pageSize + index}
                checked={selected.includes(candidate.id)}
                onCheck={() => toggleSelected(candidate.id)}
              />
            ))}
          </section>
          {pageCount > 1 && (
            <div className="grid-pagination">
              <button
                disabled={page === 1}
                onClick={() => setPage((value) => value - 1)}
              >
                <ChevronLeft size={15} />
                Précédent
              </button>
              <span>
                Page {page} sur {pageCount}
              </span>
              <button
                disabled={page === pageCount}
                onClick={() => setPage((value) => value + 1)}
              >
                Suivant
                <ChevronRight size={15} />
              </button>
            </div>
          )}
        </>
      )}

      <AnimatePresence>
        {selected.length > 0 && (
          <motion.div
            className="compare-tray bulk-tray"
            initial={{ y: 90, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 90, opacity: 0 }}
          >
            <div className="compare-tray__avatars">
              {selectedCandidates.slice(0, 4).map((candidate, index) => (
                <Avatar
                  key={candidate.id}
                  initials={candidate.initials}
                  size="sm"
                  colorIndex={index}
                />
              ))}
              {Array.from(
                { length: Math.max(0, 2 - selected.length) },
                (_, index) => (
                  <span className="compare-placeholder" key={index}>
                    +
                  </span>
                ),
              )}
              {selected.length > 4 && <span className="compare-placeholder">+{selected.length - 4}</span>}
            </div>
            <div>
              <strong>
                {selected.length} profil{selected.length > 1 ? "s" : ""}{" "}
                sélectionné{selected.length > 1 ? "s" : ""}
              </strong>
              <span>
                {selected.length > 4
                  ? "Actions groupées actives · comparaison limitée à 4"
                  : "Déplacez, taguez, favorisez ou comparez"}
              </span>
            </div>
            <div className="bulk-controls">
              <label>
                <UsersRound size={14} />
                <select value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value as "" | WorkflowStatus)} disabled={bulkBusy} aria-label="Nouvelle étape">
                  <option value="">Changer l’étape…</option>
                  <option value="nouveau">Nouveau</option>
                  <option value="a_revoir">À revoir</option>
                  <option value="entretien">Entretien</option>
                  <option value="retenu">Retenu</option>
                  <option value="refuse">Non retenu</option>
                </select>
              </label>
              <label>
                <Tag size={14} />
                <input value={bulkTag} onChange={(event) => setBulkTag(event.target.value)} maxLength={60} placeholder="Ajouter un tag…" disabled={bulkBusy} aria-label="Tag à ajouter" />
              </label>
              <button className="button button--light button--sm" disabled={bulkBusy || (!bulkStatus && !bulkTag.trim())} onClick={() => void applyBulkUpdate()}>
                <Check size={15} />Appliquer
              </button>
              <button className="button bulk-favorite button--sm" disabled={bulkBusy} onClick={() => void applyBulkUpdate(true)} title="Ajouter aux favoris">
                <Sparkles size={14} />Favoris
              </button>
            </div>
            <button
              className="button button--primary button--sm"
              disabled={selected.length < 2 || selected.length > 4}
              onClick={() => setCompareOpen(true)}
            >
              <Columns3 size={16} />
              Comparer
            </button>
            <button
              className="icon-button icon-button--sm"
              onClick={() => setSelected([])}
            >
              <X size={17} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {compareOpen && (
          <ComparisonModal
            candidates={selectedCandidates.slice(0, 4)}
            close={() => setCompareOpen(false)}
          />
        )}
      </AnimatePresence>
      <p className="human-review-note">
        Les scores sont des indicateurs d’aide à la décision — validation
        humaine requise.
      </p>
    </PageTransition>
  );
}

function CandidateRow({
  candidate,
  index,
  checked,
  onCheck,
}: {
  candidate: Candidate;
  index: number;
  checked: boolean;
  onCheck: () => void;
}) {
  return (
    <div className={`candidate-row ${checked ? "is-selected" : ""}`}>
      <label className="custom-check">
        <input type="checkbox" checked={checked} onChange={onCheck} />
        <span>{checked && <Check size={12} />}</span>
      </label>
      <Link to={`/candidats/${candidate.id}`} className="candidate-identity">
        <Avatar initials={candidate.initials} size="md" colorIndex={index} />
        <div>
          <strong>{candidate.name}</strong>
          <span>
            {candidate.headline} ·{" "}
            {candidate.location || "Localisation non renseignée"}
          </span>
          <div className="mobile-row-score">
            <b>{candidate.score}/100</b>
            <StatusBadge status={candidate.status} compact />
          </div>
        </div>
      </Link>
      <div className="table-score">
        <div>
          <strong>{candidate.score}</strong>
          <span>/100</span>
        </div>
        <ScoreBar value={candidate.score} />
      </div>
      <StatusBadge status={candidate.status} compact />
      <div className="experience-cell">
        <strong>
          {candidate.experienceYears || "—"}
          {candidate.experienceYears ? " ans" : ""}
        </strong>
        <span>{candidate.lastCompany}</span>
      </div>
      <time>
        {new Intl.DateTimeFormat("fr-FR", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }).format(new Date(candidate.analyzedAt))}
      </time>
      <Link
        className="row-action"
        to={`/candidats/${candidate.id}`}
        aria-label={`Voir ${candidate.name}`}
      >
        <ChevronRight size={18} />
      </Link>
    </div>
  );
}

function CandidateCard({
  candidate,
  index,
  checked,
  onCheck,
}: {
  candidate: Candidate;
  index: number;
  checked: boolean;
  onCheck: () => void;
}) {
  return (
    <motion.article
      className={`candidate-card ${checked ? "is-selected" : ""}`}
      layout
    >
      <div className="candidate-card__top">
        <label className="custom-check">
          <input type="checkbox" checked={checked} onChange={onCheck} />
          <span>{checked && <Check size={12} />}</span>
        </label>
        <StatusBadge status={candidate.status} compact />
      </div>
      <Avatar initials={candidate.initials} size="lg" colorIndex={index} />
      <h3>{candidate.name}</h3>
      <p>{candidate.headline}</p>
      <div className="candidate-card__score">
        <strong>{candidate.score}</strong>
        <span>/100</span>
        <ScoreBar value={candidate.score} />
      </div>
      <div className="candidate-card__skills">
        {candidate.skills.slice(0, 3).map((skill) => (
          <span key={skill}>{skill}</span>
        ))}
      </div>
      <Link
        className="button button--secondary button--full"
        to={`/candidats/${candidate.id}`}
      >
        Voir le profil <ChevronRight size={16} />
      </Link>
    </motion.article>
  );
}

function ComparisonModal({
  candidates,
  close,
}: {
  candidates: Candidate[];
  close: () => void;
}) {
  const criteria = candidates[0]?.sections || [];
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close]);

  return (
    <motion.div
      className="modal-layer"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={close}
    >
      <motion.div
        className="comparison-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="comparison-title"
        initial={{ scale: 0.96, y: 15 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.97, y: 8 }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="eyebrow">Comparaison rapide</span>
            <h2 id="comparison-title">{candidates.length} profils côte à côte</h2>
          </div>
          <button className="icon-button" onClick={close} autoFocus aria-label="Fermer la comparaison">
            <X size={20} />
          </button>
        </header>
        <div
          className="comparison-grid"
          style={{
            gridTemplateColumns: `180px repeat(${candidates.length}, minmax(150px, 1fr))`,
          }}
        >
          <div />
          <>
            {candidates.map((candidate, index) => (
              <div className="compare-person" key={candidate.id}>
                <Avatar
                  initials={candidate.initials}
                  size="md"
                  colorIndex={index}
                />
                <strong>{candidate.name}</strong>
                <span>{candidate.headline}</span>
                <b>{candidate.score}/100</b>
              </div>
            ))}
          </>
          <span className="compare-label">Verdict</span>
          {candidates.map((candidate) => (
            <div className="compare-value" key={candidate.id}>
              <StatusBadge status={candidate.status} compact />
            </div>
          ))}
          {criteria.map((criterion) => (
            <Fragment key={criterion.key}>
              <span className="compare-label">
                {criterion.label}
              </span>
              {candidates.map((candidate) => {
                const score =
                  candidate.sections.find((item) => item.key === criterion.key)
                    ?.score || 0;
                return (
                  <div
                    className="compare-value"
                    key={`${candidate.id}-${criterion.key}`}
                  >
                    <strong>{score}</strong>
                    <ScoreBar value={score} />
                  </div>
                );
              })}
            </Fragment>
          ))}
          <span className="compare-label">Expérience</span>
          {candidates.map((candidate) => (
            <div className="compare-value" key={candidate.id}>
              {candidate.experienceYears || "—"} ans
            </div>
          ))}
        </div>
        <footer>
          <span>
            <SlidersHorizontal size={15} />
            Les critères utilisent la pondération de chaque analyse.
          </span>
          <button className="button button--primary" onClick={close}>
            Terminer
          </button>
        </footer>
      </motion.div>
    </motion.div>
  );
}
