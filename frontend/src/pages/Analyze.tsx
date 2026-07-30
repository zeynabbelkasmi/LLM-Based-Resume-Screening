import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronRight,
  FileCheck2,
  FileText,
  Info,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { type DragEvent, type FormEvent, useRef, useState } from "react";
import { Link } from "../lib/navigation";
import {
  AnalysisWarning,
  Avatar,
  PageHeading,
  PageTransition,
  ScoreRing,
  StatusBadge,
} from "../components/ui";
import { useData } from "../context/DataContext";
import { api } from "../lib/api";
import type { Candidate } from "../types";

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const MAX_FILES = 8;
interface Criterion {
  id: string;
  name: string;
  weight: number;
  custom: boolean;
}

const DEFAULT_CRITERIA: Criterion[] = [
  { id: "technical", name: "Compétences Techniques", weight: 35, custom: false },
  { id: "experience", name: "Expérience Professionnelle", weight: 30, custom: false },
  { id: "soft-skills", name: "Soft Skills", weight: 20, custom: false },
  { id: "education", name: "Formation", weight: 15, custom: false },
];

const freshDefaultCriteria = (): Criterion[] => DEFAULT_CRITERIA.map((criterion) => ({ ...criterion }));

export default function Analyze() {
  const { addCandidates, aiHealth } = useData();
  const inputRef = useRef<HTMLInputElement>(null);
  const jobInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [jobDescription, setJobDescription] = useState("");
  const [jobFile, setJobFile] = useState<File | null>(null);
  const [temperature, setTemperature] = useState(20);
  const [criteria, setCriteria] = useState<Criterion[]>(freshDefaultCriteria);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentFile, setCurrentFile] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [fileError, setFileError] = useState("");
  const [jobFileError, setJobFileError] = useState("");

  const weightTotal = criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  const criteriaAreValid = criteria.every((criterion, index) => {
    const name = criterion.name.trim().toLocaleLowerCase("fr");
    return Boolean(name) && criterion.weight > 0 && criteria.findIndex((item) => item.name.trim().toLocaleLowerCase("fr") === name) === index;
  });
  const hasJobContext = Boolean(jobDescription.trim() || jobFile);

  const addFiles = (incoming: File[]) => {
    setFileError("");
    const rejected = incoming.filter(
      (file) =>
        file.type !== "application/pdf" &&
        !file.name.toLowerCase().endsWith(".pdf"),
    );
    const tooLarge = incoming.filter((file) => file.size > MAX_FILE_SIZE);
    if (rejected.length) setFileError("Seuls les fichiers PDF sont acceptés.");
    else if (tooLarge.length)
      setFileError("Chaque PDF doit peser moins de 15 Mo.");
    const accepted = incoming.filter(
      (file) =>
        (file.type === "application/pdf" ||
          file.name.toLowerCase().endsWith(".pdf")) &&
        file.size <= MAX_FILE_SIZE,
    );
    setFiles((current) => {
      const names = new Set(current.map((file) => `${file.name}-${file.size}`));
      return [
        ...current,
        ...accepted.filter((file) => !names.has(`${file.name}-${file.size}`)),
      ].slice(0, MAX_FILES);
    });
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  };

  const selectJobFile = (file: File | undefined) => {
    setJobFileError("");
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      setJobFileError("La fiche de poste PDF doit peser moins de 15 Mo.");
      return;
    }
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setJobFileError("La fiche de poste doit être fournie au format PDF.");
      return;
    }
    setJobFile(file);
  };

  const updateCriterion = (id: string, changes: Partial<Pick<Criterion, "name" | "weight">>) => {
    setCriteria((current) => current.map((criterion) => criterion.id === id ? { ...criterion, ...changes } : criterion));
  };

  const addCriterion = () => {
    if (criteria.length >= 12) return;
    setCriteria((current) => [
      ...current,
      { id: `criterion-${Date.now()}`, name: "", weight: 0, custom: true },
    ]);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setErrors([]);
    setResults([]);
    if (!files.length || !hasJobContext || weightTotal !== 100 || !criteriaAreValid) return;
    setProcessing(true);
    setProgress(4);
    const completed: Candidate[] = [];
    const failures: string[] = [];
    const weights = Object.fromEntries(criteria.map((criterion) => [criterion.name.trim(), criterion.weight]));

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      setCurrentFile(file.name);
      setProgress(Math.max(8, Math.round((index / files.length) * 88)));
      try {
        let result: Candidate;
        result = await api.analyzeFile(file, {
          jobDescription,
          jobFile,
          temperature: temperature / 100,
          weights,
        });
        completed.push(result);
      } catch (error) {
        failures.push(
          `${file.name} — ${error instanceof Error ? error.message : "échec de l’analyse"}`,
        );
      }
      setProgress(Math.round(((index + 1) / files.length) * 94));
    }

    setProgress(100);
    setResults(completed.sort((a, b) => b.score - a.score));
    setErrors(failures);
    if (completed.length) await addCandidates(completed);
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    setProcessing(false);
  };

  const reset = () => {
    setResults([]);
    setErrors([]);
    setFiles([]);
    setProgress(0);
    setCurrentFile("");
  };

  return (
    <PageTransition>
      <PageHeading
        eyebrow="Analyse intelligente"
        title="Nouvelle analyse"
        description="Importez jusqu’à 8 CV et mesurez leur adéquation avec votre besoin."
      />
      {(!aiHealth.configured || aiHealth.mode === "error") && (
          <div className="ai-fallback-warning">
            <Info size={16} />
            <span>
              <strong>Connexion LM Studio indisponible.</strong> Vérifiez que le serveur local
              est démarré et que Qwen3 8B est chargé, puis relancez le diagnostic.
            </span>
          </div>
      )}
      {!processing && !results.length && errors.length > 0 && (
        <div className="result-errors result-errors--spaced">
          {errors.map((error) => (
            <span key={error}>
              <X size={14} />
              {error}
            </span>
          ))}
        </div>
      )}

      {!results.length ? (
        <form onSubmit={submit} className="analysis-layout">
          <section className="analysis-main">
            <article className="panel analysis-card">
              <header className="analysis-card__header">
                <span className="step-number">01</span>
                <div>
                  <h2>CV des candidats</h2>
                  <p>Ajoutez un ou plusieurs documents PDF</p>
                </div>
                <span className="optional-label">
                  {files.length}/{MAX_FILES}
                </span>
              </header>
              <div
                className={`dropzone ${dragging ? "is-dragging" : ""} ${files.length ? "has-files" : ""}`}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter") inputRef.current?.click();
                }}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  multiple
                  hidden
                  onChange={(event) =>
                    addFiles(Array.from(event.target.files || []))
                  }
                />
                <motion.span
                  className="dropzone__icon"
                  animate={dragging ? { y: [-2, -8, -2] } : { y: 0 }}
                  transition={{
                    repeat: dragging ? Infinity : 0,
                    duration: 0.8,
                  }}
                >
                  <UploadCloud size={27} />
                </motion.span>
                <h3>
                  {dragging ? "Déposez les CV ici" : "Glissez-déposez vos CV"}
                </h3>
                <p>
                  ou <strong>parcourez vos fichiers</strong>
                </p>
                <small>PDF uniquement · 15 Mo max par fichier</small>
              </div>
              {fileError && (
                <p className="field-error">
                  <Info size={14} />
                  {fileError}
                </p>
              )}
              <AnimatePresence>
                {files.length > 0 && (
                  <motion.div
                    className="upload-list"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                  >
                    <div className="upload-list__heading">
                      <span>
                        {files.length} document{files.length > 1 ? "s" : ""}{" "}
                        prêt{files.length > 1 ? "s" : ""}
                      </span>
                      <button type="button" onClick={() => setFiles([])}>
                        Tout retirer
                      </button>
                    </div>
                    {files.map((file) => (
                      <div
                        className="upload-file"
                        key={`${file.name}-${file.size}`}
                      >
                        <span>
                          <FileText size={18} />
                        </span>
                        <div>
                          <strong>{file.name}</strong>
                          <small>
                            {(file.size / 1024 / 1024).toFixed(2)} Mo · PDF
                          </small>
                        </div>
                        <i>
                          <Check size={12} />
                        </i>
                        <button
                          type="button"
                          onClick={() =>
                            setFiles((current) =>
                              current.filter((item) => item !== file),
                            )
                          }
                          aria-label={`Retirer ${file.name}`}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </article>

            <article className="panel analysis-card">
              <header className="analysis-card__header">
                <span className="step-number">02</span>
                <div>
                  <h2>Contexte du poste</h2>
                  <p>Décrivez précisément le profil recherché</p>
                </div>
                <span className="required-label">Requis</span>
              </header>
              <label className="field-label" htmlFor="job-description">
                Fiche de poste en texte brut
              </label>
              <textarea
                id="job-description"
                className="large-textarea"
                value={jobDescription}
                onChange={(event) => setJobDescription(event.target.value)}
                placeholder="Collez ici l’intitulé, les missions, les compétences attendues, le niveau d’expérience…"
                rows={9}
              />
              <div className="textarea-footer">
                <span>
                  {jobDescription.length.toLocaleString("fr-FR")} caractères
                </span>
                <span>
                  <Sparkles size={13} />
                  Plus le contexte est précis, plus l’analyse est pertinente.
                </span>
              </div>
              <div className="job-file-separator"><span>ou</span></div>
              <label className="field-label">Fiche de poste au format PDF</label>
              <input
                ref={jobInputRef}
                type="file"
                accept=".pdf,application/pdf"
                hidden
                onChange={(event) => selectJobFile(event.target.files?.[0])}
              />
              {jobFile ? (
                <div className="upload-file job-upload-file">
                  <span><FileText size={18} /></span>
                  <div>
                    <strong>{jobFile.name}</strong>
                    <small>{(jobFile.size / 1024 / 1024).toFixed(2)} Mo · PDF</small>
                  </div>
                  <i><Check size={12} /></i>
                  <button type="button" onClick={() => setJobFile(null)} aria-label="Retirer la fiche de poste">
                    <Trash2 size={15} />
                  </button>
                </div>
              ) : (
                <button className="job-file-button" type="button" onClick={() => jobInputRef.current?.click()}>
                  <UploadCloud size={18} />
                  Téléverser une fiche de poste PDF
                </button>
              )}
              {jobFileError && <p className="field-error"><Info size={14} />{jobFileError}</p>}
            </article>
          </section>

          <aside className="analysis-sidebar">
            <article className="panel configuration-card">
              <header>
                <span>
                  <Settings2 size={18} />
                </span>
                <div>
                  <h2>Configuration</h2>
                  <p>Personnalisez le scoring</p>
                </div>
              </header>
              <label className="field-label">Mode d’analyse</label>
              <div className="mode-selector mode-selector--single">
                <div className="is-active">
                  <BrainCircuit size={15} />
                  <span>
                    LLM<small>Analyse sémantique</small>
                  </span>
                </div>
              </div>
              <div className="mode-explanation">
                <Info size={15} />
                <span>Utilise la compréhension sémantique du modèle LLM connecté.</span>
              </div>

              <div className="divider" />
              <div className="weight-heading">
                <label className="field-label">Pondération des critères</label>
                <button
                  type="button"
                  onClick={() => setCriteria(freshDefaultCriteria())}
                >
                  <RotateCcw size={13} />
                  Réinitialiser
                </button>
              </div>
              <div className="weight-list">
                {criteria.map((criterion, index) => (
                  <div className="criterion-weight" key={criterion.id}>
                    <div className="criterion-weight__heading">
                      <span>
                        <i className={`weight-dot weight-dot--${index}`} />
                        {criterion.custom ? (
                          <input
                            type="text"
                            value={criterion.name}
                            maxLength={100}
                            placeholder="Nom du nouveau critère"
                            aria-label="Nom du critère"
                            onChange={(event) => updateCriterion(criterion.id, { name: event.target.value })}
                          />
                        ) : criterion.name}
                      </span>
                      <label className="criterion-percentage">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="1"
                          value={criterion.weight}
                          aria-label={`Pondération ${criterion.name || "du critère"}`}
                          onChange={(event) => updateCriterion(criterion.id, { weight: Math.max(0, Math.min(100, Number(event.target.value))) })}
                        />
                        <span>%</span>
                      </label>
                      {criterion.custom && (
                        <button type="button" onClick={() => setCriteria((current) => current.filter((item) => item.id !== criterion.id))} aria-label="Supprimer ce critère">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={criterion.weight}
                      onChange={(event) => updateCriterion(criterion.id, { weight: Number(event.target.value) })}
                    />
                  </div>
                ))}
              </div>
              <button className="add-criterion-button" type="button" onClick={addCriterion} disabled={criteria.length >= 12}>
                <Plus size={14} /> Ajouter un critère
              </button>
              <div
                className={`weight-total ${weightTotal === 100 && criteriaAreValid ? "is-valid" : ""}`}
              >
                <span>Total</span>
                <strong>{weightTotal}%</strong>
              </div>
              {!criteriaAreValid && <p className="field-error">Chaque critère doit avoir un nom unique et une pondération supérieure à 0 %.</p>}

              <button
                className="advanced-toggle"
                type="button"
                onClick={() => setAdvancedOpen((value) => !value)}
              >
                <span>Paramètres avancés</span>
                <ChevronDown
                  size={16}
                  className={advancedOpen ? "rotate" : ""}
                />
              </button>
              <AnimatePresence>
                {advancedOpen && (
                  <motion.div
                    className="advanced-settings"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                  >
                    <label>
                      <div>
                        <span>Créativité du modèle</span>
                        <strong>{(temperature / 100).toFixed(2)}</strong>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="5"
                        value={temperature}
                        onChange={(event) =>
                          setTemperature(Number(event.target.value))
                        }
                      />
                    </label>
                  </motion.div>
                )}
              </AnimatePresence>
            </article>

            <div className="privacy-note">
              <LockKeyhole size={18} />
              <div>
                <strong>Traitement maîtrisé</strong>
                <span>
                  Les fichiers ne sont pas conservés dans ce navigateur. Leur
                  contenu est transmis par le backend au fournisseur LLM configuré.
                </span>
              </div>
            </div>
            <button
              className="button button--primary button--xl button--full analyze-button"
              type="submit"
              disabled={
                !files.length ||
                !hasJobContext ||
                weightTotal !== 100 ||
                !criteriaAreValid ||
                processing
              }
            >
              <Sparkles size={18} />
              Lancer l’analyse
              <ArrowRight size={18} />
            </button>
            <p className="analysis-disclaimer">
              Aide à la décision — validation humaine requise.
            </p>
          </aside>
        </form>
      ) : (
        <Results results={results} errors={errors} reset={reset} />
      )}

      <AnimatePresence>
        {processing && (
          <ProcessingOverlay
            progress={progress}
            currentFile={currentFile}
            count={files.length}
          />
        )}
      </AnimatePresence>
    </PageTransition>
  );
}

function ProcessingOverlay({
  progress,
  currentFile,
  count,
}: {
  progress: number;
  currentFile: string;
  count: number;
}) {
  const label =
    progress < 25
      ? "Extraction du contenu"
      : progress < 55
        ? "Détection des compétences"
        : progress < 88
          ? "Évaluation de l’adéquation"
          : "Finalisation des rapports";
  return (
    <motion.div
      className="processing-layer"
      role="dialog"
      aria-modal="true"
      aria-label="Analyse en cours"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="processing-card"
        aria-live="polite"
        initial={{ scale: 0.96, y: 12 }}
        animate={{ scale: 1, y: 0 }}
      >
        <div className="processing-visual">
          <span className="processing-core">
            <BrainCircuit size={30} />
          </span>
          <i />
          <i />
          <i />
        </div>
        <span className="eyebrow">Analyse en cours</span>
        <h2>{label}…</h2>
        <p>
          {currentFile}
          <br />
          <small>{count} CV au total · ne fermez pas cette page</small>
        </p>
        <div className="processing-progress">
          <span style={{ width: `${progress}%` }} />
        </div>
        <strong className="processing-percent">{progress}%</strong>
        <div className="processing-steps">
          <span className={progress > 12 ? "is-done" : "is-current"}>
            <Check size={12} />
            Lecture PDF
          </span>
          <span
            className={
              progress > 50 ? "is-done" : progress > 12 ? "is-current" : ""
            }
          >
            <LoaderCircle size={12} />
            Scoring
          </span>
          <span
            className={
              progress > 90 ? "is-done" : progress > 50 ? "is-current" : ""
            }
          >
            <FileCheck2 size={12} />
            Rapport
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Results({
  results,
  errors,
  reset,
}: {
  results: Candidate[];
  errors: string[];
  reset: () => void;
}) {
  return (
    <motion.section
      className="analysis-results"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="results-hero">
        <span>
          <Check size={28} />
        </span>
        <div>
          <span className="eyebrow">Analyse terminée</span>
          <h2>
            {results.length} profil{results.length > 1 ? "s" : ""} évalué
            {results.length > 1 ? "s" : ""} avec succès
          </h2>
          <p>Les résultats sont classés par score d’adéquation.</p>
        </div>
        <button className="button button--secondary" onClick={reset}>
          <RotateCcw size={16} />
          Nouvelle analyse
        </button>
      </div>
      {errors.length > 0 && (
        <div className="result-errors">
          {errors.map((error) => (
            <span key={error}>
              <X size={14} />
              {error}
            </span>
          ))}
        </div>
      )}
      <div className="result-list">
        {results.map((candidate, index) => (
          <article className="panel result-card" key={candidate.id}>
            <span className="result-rank">#{index + 1}</span>
            <Avatar
              initials={candidate.initials}
              size="lg"
              colorIndex={index}
            />
            <div className="result-person">
              <h3>{candidate.name}</h3>
              <p>{candidate.headline}</p>
              <div>
                {candidate.skills.slice(0, 4).map((skill) => (
                  <span key={skill}>{skill}</span>
                ))}
              </div>
              <AnalysisWarning
                warnings={candidate.analysisWarnings}
                quality={candidate.analysisQuality}
                compact
              />
            </div>
            <ScoreRing score={candidate.score} size={90} />
            <StatusBadge status={candidate.status} />
            <Link
              className="button button--secondary"
              to={`/candidats/${candidate.id}`}
            >
              Voir l’analyse <ChevronRight size={16} />
            </Link>
          </article>
        ))}
      </div>
      <div className="decision-disclaimer">
        <ShieldCheck size={18} />
        <div>
          <strong>
            Ces résultats éclairent votre jugement, ils ne le remplacent pas.
          </strong>
          <span>
            Relisez les éléments sources et validez chaque décision avec votre
            équipe.
          </span>
        </div>
      </div>
    </motion.section>
  );
}
