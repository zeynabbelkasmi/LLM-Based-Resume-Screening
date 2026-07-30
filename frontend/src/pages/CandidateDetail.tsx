import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ClipboardList,
  Download,
  FileText,
  FolderKanban,
  GraduationCap,
  Heart,
  Lightbulb,
  Mail,
  MapPin,
  MessageSquareText,
  Phone,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  Tag,
  Target,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "../lib/navigation";
import {
  AnalysisWarning,
  Avatar,
  EmptyState,
  LoadingState,
  PageTransition,
  ScoreBar,
  ScoreRing,
  StatusBadge,
} from "../components/ui";
import { useData } from "../context/DataContext";
import { api } from "../lib/api";
import type { Candidate, WorkflowStatus } from "../types";

type DetailTab = "overview" | "criteria" | "document";

const workflowOptions: Array<{ value: WorkflowStatus; label: string }> = [
  { value: "nouveau", label: "Nouveau" },
  { value: "a_revoir", label: "À revoir" },
  { value: "entretien", label: "Entretien" },
  { value: "retenu", label: "Retenu" },
  { value: "refuse", label: "Refusé" },
];

function normalizeWorkflowTags(values: string[]) {
  const seen = new Set<string>();
  return values
    .map((value) => value.trim().slice(0, 60))
    .filter((value) => {
      const key = value.toLocaleLowerCase("fr-FR");
      if (!value || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);
}

function mergeCandidatePatch(current: Candidate, patched: Candidate): Candidate {
  const preservePlaceholder = (
    value: string,
    placeholder: string,
    fallback: string,
  ) => (value && value !== placeholder ? value : fallback);

  return {
    ...current,
    ...patched,
    headline: preservePlaceholder(
      patched.headline,
      "Profil candidat",
      current.headline,
    ),
    email: patched.email || current.email,
    phone: patched.phone || current.phone,
    location: patched.location || current.location,
    experienceYears:
      patched.experienceYears || current.experienceYears,
    education: preservePlaceholder(
      patched.education,
      "Non renseignée",
      current.education,
    ),
    lastCompany: preservePlaceholder(
      patched.lastCompany,
      "Non renseignée",
      current.lastCompany,
    ),
    jobName: preservePlaceholder(
      patched.jobName,
      "Poste analysé",
      current.jobName,
    ),
    skills: patched.skills.length ? patched.skills : current.skills,
    missingSkills: patched.missingSkills.length
      ? patched.missingSkills
      : current.missingSkills,
    strengths:
      !patched.strengths.length ||
      (patched.strengths.length === 1 &&
        patched.strengths[0] ===
          "Analyse disponible dans le rapport détaillé")
        ? current.strengths
        : patched.strengths,
    improvements: patched.improvements.length
      ? patched.improvements.length === 1 &&
        patched.improvements[0] === "À valider lors de l’entretien"
        ? current.improvements
        : patched.improvements
      : current.improvements,
    summary: preservePlaceholder(
      patched.summary,
      "Le résumé détaillé sera disponible après synchronisation complète de l’analyse.",
      current.summary,
    ),
    sections: patched.sections.every(
      (section) => section.note === "Score issu de l’analyse.",
    )
      ? current.sections
      : patched.sections,
    interviewQuestions: patched.interviewQuestions.length
      ? patched.interviewQuestions
      : current.interviewQuestions,
    documentText: patched.documentText || current.documentText,
    analysisWarnings: patched.analysisWarnings.length
      ? patched.analysisWarnings
      : current.analysisWarnings,
    analysisQuality: patched.analysisQuality || current.analysisQuality,
  };
}

export default function CandidateDetail() {
  const { candidateId = "" } = useParams();
  const { findCandidate, refresh, source } = useData();
  const [candidate, setCandidate] = useState<Candidate | undefined>(() =>
    findCandidate(candidateId),
  );
  const [loading, setLoading] = useState(
    source === "loading" || (source === "api" && !candidate),
  );
  const [tab, setTab] = useState<DetailTab>("overview");
  const [favorite, setFavorite] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [exportingReport, setExportingReport] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    const cached = findCandidate(candidateId);
    if (cached) {
      setCandidate((current) =>
        current?.id === cached.id
          ? mergeCandidatePatch(current, cached)
          : cached,
      );
      setFavorite(Boolean(cached.favorite));
      setNote(cached.notes || "");
    }
    if (source === "api") {
      setLoading(true);
      api
        .getCandidate(candidateId)
        .then((detail) => {
          setCandidate(detail);
          setFavorite(Boolean(detail.favorite));
          setNote(detail.notes || "");
        })
        .catch(() => undefined)
        .finally(() => setLoading(false));
    } else if (source !== "loading") setLoading(false);
  }, [candidateId, findCandidate, source]);

  if (loading) return <LoadingState label="Ouverture du dossier candidat…" />;
  if (!candidate)
    return (
      <EmptyState
        title="Profil introuvable"
        description="Ce CV n’existe plus ou n’est pas accessible."
        action={
          <Link className="button button--secondary" to="/candidats">
            <ArrowLeft size={16} />
            Retour à la CVthèque
          </Link>
        }
      />
    );

  const exportReport = async () => {
    if (source !== "api") return;
    setExportingReport(true);
    setExportError(null);
    try {
      await api.downloadCandidatePdf(candidate.id);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Le rapport PDF n’a pas pu être généré.");
    } finally {
      setExportingReport(false);
    }
  };

  const updateFavorite = async () => {
    const next = !favorite;
    setFavorite(next);
    if (source === "api") {
      try {
        const updated = await api.patchCandidate(candidate.id, {
          favorite: next,
        });
        setCandidate((current) =>
          current ? mergeCandidatePatch(current, updated) : updated,
        );
        await refresh();
      } catch {
        setFavorite(!next);
      }
    }
  };

  const saveNote = async () => {
    if (source !== "api") return;
    setSaving(true);
    try {
      const updated = await api.patchCandidate(candidate.id, { notes: note });
      setCandidate((current) =>
        current ? mergeCandidatePatch(current, updated) : updated,
      );
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageTransition>
      <div className="detail-topline">
        <Link to="/candidats" className="back-link">
          <ArrowLeft size={17} />
          Tous les candidats
        </Link>
        <div>
          <button
            className={`icon-button ${favorite ? "is-favorite" : ""}`}
            onClick={() => void updateFavorite()}
            aria-label="Ajouter aux favoris"
          >
            <Heart size={18} fill={favorite ? "currentColor" : "none"} />
          </button>
          <button className="button button--secondary" onClick={() => void exportReport()} disabled={exportingReport || source !== "api"}>
            <Download size={16} />
            {exportingReport ? "Génération…" : "Rapport PDF"}
          </button>
        </div>
      </div>

      {exportError && (
        <div className="api-error-banner" role="alert">
          <span>{exportError}</span>
          <button className="icon-button icon-button--sm" onClick={() => setExportError(null)} aria-label="Fermer"><X size={15} /></button>
        </div>
      )}

      <section className="profile-hero panel">
        <div className="profile-hero__identity">
          <Avatar
            initials={candidate.initials}
            size="xl"
            colorIndex={Number(candidate.id.replace(/\D/g, "")) || 0}
          />
          <div>
            <div className="profile-name-line">
              <h1>{candidate.name}</h1>
              <StatusBadge status={candidate.status} />
            </div>
            <p>{candidate.headline}</p>
            <div className="profile-meta">
              {candidate.location && (
                <span>
                  <MapPin size={14} />
                  {candidate.location}
                </span>
              )}
              <span>
                <BriefcaseBusiness size={14} />
                {candidate.experienceYears
                  ? `${candidate.experienceYears} ans d’expérience`
                  : "Expérience non renseignée"}
              </span>
              <span>
                <CalendarDays size={14} />
                Analysé le{" "}
                {new Intl.DateTimeFormat("fr-FR", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                }).format(new Date(candidate.analyzedAt))}
              </span>
            </div>
          </div>
        </div>
        <div className="profile-hero__score">
          <ScoreRing score={candidate.score} size={116} />
          <div>
            <span>Score d’adéquation</span>
            <strong>{candidate.jobName}</strong>
            <small>Score indicatif · à valider humainement</small>
          </div>
        </div>
      </section>

      <AnalysisWarning
        warnings={candidate.analysisWarnings}
        quality={candidate.analysisQuality}
      />

      <nav className="detail-tabs">
        <button
          className={tab === "overview" ? "is-active" : ""}
          onClick={() => setTab("overview")}
        >
          Synthèse
        </button>
        <button
          className={tab === "criteria" ? "is-active" : ""}
          onClick={() => setTab("criteria")}
        >
          Analyse détaillée
        </button>
        <button
          className={tab === "document" ? "is-active" : ""}
          onClick={() => setTab("document")}
        >
          CV source
        </button>
      </nav>

      {tab === "overview" && (
        <Overview
          candidate={candidate}
          note={note}
          setNote={setNote}
          saveNote={saveNote}
          saving={saving}
          canSave={source === "api"}
          onCandidateUpdated={setCandidate}
        />
      )}
      {tab === "criteria" && <Criteria candidate={candidate} />}
      {tab === "document" && <Document candidate={candidate} />}

      <div className="decision-disclaimer">
        <ShieldCheck size={18} />
        <div>
          <strong>Aide à la décision — validation humaine requise</strong>
          <span>
            Ce score synthétise des signaux du CV et ne constitue jamais une
            décision automatique. Vérifiez les informations et menez un
            entretien équitable.
          </span>
        </div>
      </div>
    </PageTransition>
  );
}

function Overview({
  candidate,
  note,
  setNote,
  saveNote,
  saving,
  canSave,
  onCandidateUpdated,
}: {
  candidate: Candidate;
  note: string;
  setNote: (value: string) => void;
  saveNote: () => Promise<void>;
  saving: boolean;
  canSave: boolean;
  onCandidateUpdated: (candidate: Candidate) => void;
}) {
  return (
    <motion.div
      className="profile-grid"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <div className="profile-main-column">
        <section className="panel content-panel ai-summary">
          <header>
            <span className="section-icon section-icon--ai">
              <Sparkles size={18} />
            </span>
            <div>
              <h2>Synthèse du profil</h2>
              <p>Résumé établi à partir des éléments du CV</p>
            </div>
            <span className="ai-label">Synthèse</span>
          </header>
          <blockquote>{candidate.summary}</blockquote>
          <div className="summary-confidence">
            <ShieldCheck size={15} />
            <span>Informations à confirmer avec le candidat</span>
          </div>
        </section>

        <section className="panel content-panel">
          <header>
            <span className="section-icon">
              <Target size={18} />
            </span>
            <div>
              <h2>Adéquation par critère</h2>
              <p>Lecture pondérée des quatre dimensions clés</p>
            </div>
          </header>
          <div className="criteria-preview">
            {candidate.sections.map((section) => (
              <div className="criterion-preview" key={section.key}>
                <div>
                  <span>{section.label}</span>
                  <strong>
                    {section.score}
                    <small>/100</small>
                  </strong>
                </div>
                <ScoreBar value={section.score} />
              </div>
            ))}
          </div>
        </section>

        <section className="strength-grid">
          <article className="panel insight-card insight-card--positive">
            <header>
              <span>
                <Check size={17} />
              </span>
              <div>
                <h2>Points forts</h2>
                <p>Signaux particulièrement pertinents</p>
              </div>
            </header>
            <ul>
              {candidate.strengths.map((item) => (
                <li key={item}>
                  <Check size={14} />
                  {item}
                </li>
              ))}
            </ul>
          </article>
          <article className="panel insight-card insight-card--watch">
            <header>
              <span>
                <TriangleAlert size={17} />
              </span>
              <div>
                <h2>Points à approfondir</h2>
                <p>Sujets à vérifier en entretien</p>
              </div>
            </header>
            <ul>
              {candidate.improvements.map((item) => (
                <li key={item}>
                  <TriangleAlert size={14} />
                  {item}
                </li>
              ))}
            </ul>
          </article>
        </section>

        <section className="panel content-panel">
          <header>
            <span className="section-icon">
              <MessageSquareText size={18} />
            </span>
            <div>
              <h2>Questions d’entretien suggérées</h2>
              <p>Personnalisées selon les zones à approfondir</p>
            </div>
          </header>
          <div className="question-list">
            {(candidate.interviewQuestions.length
              ? candidate.interviewQuestions
              : [
                  "Pouvez-vous détailler le projet le plus pertinent pour ce poste ?",
                  "Quelles compétences souhaitez-vous développer durant la première année ?",
                ]
            ).map((question, index) => (
              <div key={question}>
                <span>{index + 1}</span>
                <p>{question}</p>
                <button
                  aria-label="Copier la question"
                  onClick={() => void navigator.clipboard?.writeText(question)}
                >
                  <ClipboardList size={15} />
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>

      <aside className="profile-side-column">
        <section className="panel side-card">
          <h2>Informations</h2>
          <div className="info-list">
            {candidate.email && (
              <span>
                <Mail size={16} />
                <div>
                  <small>E-mail</small>
                  <a href={`mailto:${candidate.email}`}>{candidate.email}</a>
                </div>
              </span>
            )}
            {candidate.phone && (
              <span>
                <Phone size={16} />
                <div>
                  <small>Téléphone</small>
                  <a href={`tel:${candidate.phone}`}>{candidate.phone}</a>
                </div>
              </span>
            )}
            <span>
              <GraduationCap size={16} />
              <div>
                <small>Formation</small>
                <strong>{candidate.education}</strong>
              </div>
            </span>
            <span>
              <BriefcaseBusiness size={16} />
              <div>
                <small>Dernière entreprise</small>
                <strong>{candidate.lastCompany}</strong>
              </div>
            </span>
          </div>
        </section>
        <section className="panel side-card">
          <div className="side-card__heading">
            <h2>Compétences détectées</h2>
            <span>{candidate.skills.length}</span>
          </div>
          <div className="skill-cloud">
            {candidate.skills.map((skill, index) => (
              <span className={index < 3 ? "is-key" : ""} key={skill}>
                {skill}
                {index < 3 && <Check size={11} />}
              </span>
            ))}
          </div>
          {candidate.missingSkills.length > 0 && (
            <>
              <h3>À renforcer</h3>
              <div className="skill-cloud skill-cloud--missing">
                {candidate.missingSkills.map((skill) => (
                  <span key={skill}>{skill}</span>
                ))}
              </div>
            </>
          )}
        </section>
        <WorkflowManager
          candidate={candidate}
          canSave={canSave}
          onUpdated={onCandidateUpdated}
        />
        <section className="panel side-card note-card">
          <div className="side-card__heading">
            <h2>Note d’équipe</h2>
            <Lightbulb size={16} />
          </div>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Ajoutez une observation pour votre équipe…"
            rows={4}
            disabled={!canSave}
          />
          <p className="note-disclosure">
            Note privée, stockée localement et jamais envoyée au fournisseur IA.
          </p>
          <button
            className="button button--secondary button--full"
            disabled={!canSave || saving}
            onClick={() => void saveNote()}
          >
            {saving
              ? "Enregistrement…"
              : canSave
                ? "Enregistrer la note"
                : "Backend indisponible"}
          </button>
        </section>
      </aside>
    </motion.div>
  );
}

function WorkflowManager({
  candidate,
  canSave,
  onUpdated,
}: {
  candidate: Candidate;
  canSave: boolean;
  onUpdated: (candidate: Candidate) => void;
}) {
  const { refresh } = useData();
  const navigate = useNavigate();
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowStatus>(
    candidate.workflowStatus,
  );
  const [tags, setTags] = useState(candidate.tags);
  const [tagDraft, setTagDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setWorkflowStatus(candidate.workflowStatus);
    setTags(candidate.tags);
    setTagDraft("");
  }, [candidate.id, candidate.tags, candidate.workflowStatus]);

  useEffect(() => {
    if (!deleteOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    cancelDeleteRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deleting) setDeleteOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      previouslyFocused?.focus();
    };
  }, [deleteOpen, deleting]);

  const addTag = () => {
    const next = normalizeWorkflowTags([...tags, tagDraft]);
    setTags(next);
    setTagDraft("");
    setFeedback(null);
  };

  const saveWorkflow = async () => {
    if (!canSave) return;
    const nextTags = normalizeWorkflowTags([...tags, tagDraft]);
    setTags(nextTags);
    setTagDraft("");
    setSaving(true);
    setFeedback(null);
    try {
      const updated = await api.patchCandidate(candidate.id, {
        status: workflowStatus,
        tags: nextTags,
      });
      onUpdated(mergeCandidatePatch(candidate, updated));
      await refresh();
      setFeedback({ kind: "success", text: "Dossier mis à jour." });
    } catch (error) {
      setFeedback({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Impossible d’enregistrer le dossier.",
      });
    } finally {
      setSaving(false);
    }
  };

  const removeCandidate = async () => {
    if (!canSave) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await api.deleteCandidate(candidate.id);
      await refresh();
      navigate("/candidats");
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? error.message
          : "La suppression du dossier a échoué.",
      );
      setDeleting(false);
    }
  };

  return (
    <>
      <section className="panel side-card dossier-card">
        <div className="side-card__heading">
          <h2>Gestion du dossier</h2>
          <FolderKanban size={16} />
        </div>

        <label className="dossier-label" htmlFor="workflow-status">
          Étape du recrutement
        </label>
        <select
          id="workflow-status"
          value={workflowStatus}
          disabled={!canSave || saving}
          onChange={(event) => {
            setWorkflowStatus(event.target.value as WorkflowStatus);
            setFeedback(null);
          }}
        >
          {workflowOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="dossier-hint">
          Indépendant du verdict calculé à partir du score.
        </p>

        <label className="dossier-label dossier-label--spaced" htmlFor="tag-input">
          Tags
        </label>
        <div className="dossier-tags" aria-label="Tags du dossier">
          {tags.length ? (
            tags.map((tag) => (
              <span key={tag}>
                <Tag size={11} />
                {tag}
                <button
                  type="button"
                  disabled={!canSave || saving}
                  onClick={() => {
                    setTags((current) =>
                      current.filter((currentTag) => currentTag !== tag),
                    );
                    setFeedback(null);
                  }}
                  aria-label={`Retirer le tag ${tag}`}
                >
                  <X size={11} />
                </button>
              </span>
            ))
          ) : (
            <small>Aucun tag</small>
          )}
        </div>
        <div className="tag-input-row">
          <input
            id="tag-input"
            value={tagDraft}
            maxLength={60}
            disabled={!canSave || saving || tags.length >= 20}
            placeholder="Ex. Prioritaire"
            onChange={(event) => setTagDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                addTag();
              }
            }}
          />
          <button
            className="icon-button icon-button--sm"
            type="button"
            disabled={!canSave || saving || !tagDraft.trim()}
            onClick={addTag}
            aria-label="Ajouter le tag"
          >
            <Plus size={15} />
          </button>
        </div>

        {feedback && (
          <p
            className={`dossier-feedback dossier-feedback--${feedback.kind}`}
            role={feedback.kind === "error" ? "alert" : "status"}
          >
            {feedback.text}
          </p>
        )}

        <button
          className="button button--primary button--full dossier-save"
          disabled={!canSave || saving}
          onClick={() => void saveWorkflow()}
        >
          <Save size={15} />
          {saving
            ? "Enregistrement…"
            : canSave
              ? "Enregistrer le dossier"
              : "Backend indisponible"}
        </button>
        <button
          className="dossier-delete-trigger"
          disabled={!canSave || saving}
          onClick={() => {
            setDeleteError("");
            setDeleteOpen(true);
          }}
        >
          <Trash2 size={14} />
          Supprimer ce dossier
        </button>
      </section>

      <AnimatePresence>
        {deleteOpen && (
          <motion.div
            className="modal-layer dossier-delete-layer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !deleting)
                setDeleteOpen(false);
            }}
          >
            <motion.section
              className="delete-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-dialog-title"
              aria-describedby="delete-dialog-description"
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
            >
              <header>
                <span>
                  <TriangleAlert size={20} />
                </span>
                <div>
                  <h2 id="delete-dialog-title">Supprimer ce dossier ?</h2>
                  <p>Cette action est définitive.</p>
                </div>
                <button
                  className="icon-button icon-button--sm"
                  disabled={deleting}
                  onClick={() => setDeleteOpen(false)}
                  aria-label="Fermer la confirmation"
                >
                  <X size={16} />
                </button>
              </header>
              <p id="delete-dialog-description">
                Le CV et son analyse seront définitivement supprimés de la base
                locale.
              </p>
              {deleteError && (
                <p className="delete-dialog__error" role="alert">
                  {deleteError}
                </p>
              )}
              <footer>
                <button
                  ref={cancelDeleteRef}
                  className="button button--secondary"
                  disabled={deleting}
                  onClick={() => setDeleteOpen(false)}
                >
                  Annuler
                </button>
                <button
                  className="button button--danger"
                  disabled={deleting}
                  onClick={() => void removeCandidate()}
                >
                  <Trash2 size={15} />
                  {deleting
                    ? "Suppression…"
                    : "Supprimer définitivement le dossier"}
                </button>
              </footer>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Criteria({ candidate }: { candidate: Candidate }) {
  return (
    <motion.section
      className="panel detailed-analysis"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <header>
        <div>
          <span className="eyebrow">Lecture explicable</span>
          <h2>Détail du scoring</h2>
          <p>
            Chaque score doit être relu à la lumière du poste et de l’entretien.
          </p>
        </div>
        <ScoreRing score={candidate.score} size={90} />
      </header>
      <div className="detailed-criteria">
        {candidate.sections.map((section, index) => (
          <article key={section.key}>
            <div className="criterion-number">0{index + 1}</div>
            <div>
              <header>
                <h3>{section.label}</h3>
                <strong>
                  {section.score}
                  <small>/100</small>
                </strong>
              </header>
              <ScoreBar value={section.score} />
              <p>{section.note}</p>
              <div className="criterion-tags">
                {candidate.skills.slice(index, index + 3).map((skill) => (
                  <span key={skill}>
                    <Check size={11} />
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>
    </motion.section>
  );
}

function Document({ candidate }: { candidate: Candidate }) {
  return (
    <motion.section
      className="document-view panel"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <div className="document-toolbar">
        <div>
          <FileText size={19} />
          <span>
            <strong>{candidate.sourceFile}</strong>
            <small>Texte extrait utilisé pour l’analyse</small>
          </span>
        </div>
        <span className="read-only-pill">
          <ShieldCheck size={13} />
          Lecture seule
        </span>
      </div>
      {candidate.documentText ? (
        <pre className="document-content">{candidate.documentText}</pre>
      ) : (
        <div className="document-placeholder">
          <FileText size={34} />
          <h3>Texte source indisponible</h3>
          <p>
            Cette analyse ne contient pas de transcription exploitable du CV.
          </p>
          <span>
            <ShieldCheck size={14} />
            Aucun contenu n’est mis en cache dans le navigateur.
          </span>
        </div>
      )}
    </motion.section>
  );
}
