import { useMemo, useState, type DragEventHandler } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight,
  BriefcaseBusiness,
  Check,
  CircleAlert,
  Clock3,
  GripVertical,
  Search,
  Sparkles,
  UserCheck,
  UsersRound,
  X,
} from 'lucide-react'
import { Link } from 'wouter'
import { Avatar, EmptyState, LoadingState, PageHeading, PageTransition, ScoreBar, StatusBadge } from '../components/ui'
import { useData } from '../context/DataContext'
import { api } from '../lib/api'
import type { Candidate, WorkflowStatus } from '../types'
import './pipeline.css'

type Stage = {
  value: WorkflowStatus
  label: string
  description: string
  icon: typeof UsersRound
}

const stages: Stage[] = [
  { value: 'nouveau', label: 'Nouveaux', description: 'Profils à qualifier', icon: Sparkles },
  { value: 'a_revoir', label: 'À revoir', description: 'Validation du recruteur', icon: Clock3 },
  { value: 'entretien', label: 'Entretiens', description: 'Échanges planifiés', icon: BriefcaseBusiness },
  { value: 'retenu', label: 'Retenus', description: 'Profils sélectionnés', icon: UserCheck },
  { value: 'refuse', label: 'Non retenus', description: 'Dossiers clôturés', icon: X },
]

function Metric({ label, value, detail, icon: Icon }: { label: string; value: string | number; detail: string; icon: Stage['icon'] }) {
  return (
    <div className="pipeline-metric panel">
      <span><Icon size={18} /></span>
      <div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div>
    </div>
  )
}

export default function Pipeline() {
  const { candidates, source, error: workspaceError, refresh } = useData()
  const [query, setQuery] = useState('')
  const [localStatuses, setLocalStatuses] = useState<Record<string, WorkflowStatus>>({})
  const [movingId, setMovingId] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<WorkflowStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const candidatesWithStatus = useMemo(() => candidates.map((candidate) => ({
    ...candidate,
    workflowStatus: localStatuses[candidate.id] || candidate.workflowStatus,
  })), [candidates, localStatuses])

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('fr')
    if (!needle) return candidatesWithStatus
    return candidatesWithStatus.filter((candidate) => [
      candidate.name,
      candidate.headline,
      candidate.location,
      candidate.skills.join(' '),
      candidate.tags.join(' '),
    ].join(' ').toLocaleLowerCase('fr').includes(needle))
  }, [candidatesWithStatus, query])

  const grouped = useMemo(() => Object.fromEntries(stages.map((stage) => [
    stage.value,
    filtered.filter((candidate) => candidate.workflowStatus === stage.value),
  ])) as Record<WorkflowStatus, Candidate[]>, [filtered])

  const activeCount = candidatesWithStatus.filter((candidate) => !['retenu', 'refuse'].includes(candidate.workflowStatus)).length
  const interviewCount = grouped.entretien.length
  const retainedCount = grouped.retenu.length
  const decidedCount = retainedCount + grouped.refuse.length
  const conversion = decidedCount ? Math.round(retainedCount / decidedCount * 100) : 0

  const moveCandidate = async (candidateId: string, nextStatus: WorkflowStatus) => {
    const candidate = candidatesWithStatus.find((item) => item.id === candidateId)
    if (!candidate || candidate.workflowStatus === nextStatus || movingId) return
    if (source !== 'api') {
      setError('Le déplacement est disponible lorsque le backend est connecté.')
      return
    }
    const previous = candidate.workflowStatus
    setError(null)
    setMovingId(candidateId)
    setLocalStatuses((current) => ({ ...current, [candidateId]: nextStatus }))
    try {
      await api.patchCandidate(candidateId, { status: nextStatus })
      await refresh()
      setLocalStatuses((current) => {
        const copy = { ...current }
        delete copy[candidateId]
        return copy
      })
    } catch (moveError) {
      setLocalStatuses((current) => ({ ...current, [candidateId]: previous }))
      setError(moveError instanceof Error ? moveError.message : 'Le dossier n’a pas pu être déplacé.')
    } finally {
      setMovingId(null)
      setDraggingId(null)
      setDropTarget(null)
    }
  }

  return (
    <PageTransition>
      <PageHeading
        eyebrow="Suivi du recrutement"
        title="Pipeline candidats"
        description="Faites avancer chaque profil dans un processus clair, traçable et partagé."
        actions={<Link className="button button--primary" to="/analyse"><Sparkles size={17} />Analyser des CV</Link>}
      />

      <section className="pipeline-metrics" aria-label="Indicateurs du pipeline">
        <Metric icon={UsersRound} label="Dossiers actifs" value={activeCount} detail="En cours de traitement" />
        <Metric icon={BriefcaseBusiness} label="En entretien" value={interviewCount} detail="À préparer ou suivre" />
        <Metric icon={UserCheck} label="Profils retenus" value={retainedCount} detail="Décisions positives" />
        <Metric icon={Check} label="Taux de sélection" value={`${conversion}%`} detail="Sur les dossiers clôturés" />
      </section>

      <section className="pipeline-toolbar panel">
        <div className="search-field">
          <Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un candidat, un tag ou une compétence…" aria-label="Rechercher dans le pipeline" />
          {query && <button onClick={() => setQuery('')} aria-label="Effacer la recherche"><X size={16} /></button>}
        </div>
        <span>{filtered.length} profil{filtered.length > 1 ? 's' : ''} affiché{filtered.length > 1 ? 's' : ''}</span>
        <small><GripVertical size={14} /> Glissez-déposez les cartes entre les étapes</small>
      </section>

      <AnimatePresence>
        {(error || workspaceError) && (
          <motion.div className="pipeline-alert" role="alert" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <CircleAlert size={17} /><span>{error || workspaceError}</span>
            <button onClick={() => setError(null)} aria-label="Fermer"><X size={15} /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {source === 'loading' ? <LoadingState label="Chargement du pipeline…" /> : (
        <section className="pipeline-board" aria-label="Étapes du recrutement">
          {stages.map((stage) => {
            const Icon = stage.icon
            const stageCandidates = grouped[stage.value]
            const isTarget = dropTarget === stage.value
            return (
              <div
                className={`pipeline-column pipeline-column--${stage.value} ${isTarget ? 'is-drop-target' : ''}`}
                key={stage.value}
                onDragOver={(event) => { event.preventDefault(); setDropTarget(stage.value) }}
                onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget(null) }}
                onDrop={(event) => {
                  event.preventDefault()
                  const candidateId = event.dataTransfer.getData('text/candidate-id') || draggingId
                  if (candidateId) void moveCandidate(candidateId, stage.value)
                }}
              >
                <header className="pipeline-column__header">
                  <span><Icon size={17} /></span>
                  <div><strong>{stage.label}</strong><small>{stage.description}</small></div>
                  <b>{stageCandidates.length}</b>
                </header>
                <div className="pipeline-column__body">
                  <AnimatePresence mode="popLayout">
                    {stageCandidates.map((candidate, index) => (
                      <PipelineCard
                        key={candidate.id}
                        candidate={candidate}
                        index={index}
                        moving={movingId === candidate.id}
                        onMove={(status) => void moveCandidate(candidate.id, status)}
                        onDragStart={(event) => {
                          setDraggingId(candidate.id)
                          event.dataTransfer.effectAllowed = 'move'
                          event.dataTransfer.setData('text/candidate-id', candidate.id)
                        }}
                        onDragEnd={() => { setDraggingId(null); setDropTarget(null) }}
                      />
                    ))}
                  </AnimatePresence>
                  {!stageCandidates.length && (
                    <div className="pipeline-column__empty"><span><ArrowRight size={16} /></span><p>Déposez un profil ici</p></div>
                  )}
                </div>
              </div>
            )
          })}
        </section>
      )}

      {!candidates.length && source !== 'loading' && (
        <EmptyState title="Votre pipeline est vide" description="Analysez vos premiers CV pour démarrer le suivi des candidatures." action={<Link to="/analyse" className="button button--primary">Importer des CV</Link>} />
      )}
      <p className="human-review-note">Chaque changement d’étape est journalisé. La décision finale reste sous la responsabilité de l’équipe de recrutement.</p>
    </PageTransition>
  )
}

function PipelineCard({
  candidate,
  index,
  moving,
  onMove,
  onDragStart,
  onDragEnd,
}: {
  candidate: Candidate
  index: number
  moving: boolean
  onMove: (status: WorkflowStatus) => void
  onDragStart: DragEventHandler<HTMLElement>
  onDragEnd: DragEventHandler<HTMLElement>
}) {
  return (
    <motion.div
      layout
      className="pipeline-card-wrap"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: .97 }}
    >
      <article
        draggable={!moving}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        className={`pipeline-card ${moving ? 'is-moving' : ''}`}
      >
      <div className="pipeline-card__top">
        <GripVertical className="pipeline-card__grip" size={16} aria-hidden="true" />
        {candidate.favorite && <span className="pipeline-priority">Prioritaire</span>}
        <StatusBadge status={candidate.status} compact />
      </div>
      <Link className="pipeline-card__identity" to={`/candidats/${candidate.id}`}>
        <Avatar initials={candidate.initials} size="sm" colorIndex={index} />
        <div><strong>{candidate.name}</strong><span>{candidate.headline}</span></div>
      </Link>
      <div className="pipeline-card__score"><span>Adéquation</span><strong>{Math.round(candidate.score)}/100</strong><ScoreBar value={candidate.score} /></div>
      <div className="pipeline-card__tags">
        {(candidate.tags.length ? candidate.tags : candidate.skills).slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
      </div>
      <label className="pipeline-card__move">
        <span>Étape</span>
        <select value={candidate.workflowStatus} disabled={moving} onChange={(event) => onMove(event.target.value as WorkflowStatus)} aria-label={`Déplacer ${candidate.name}`}>
          {stages.map((stage) => <option key={stage.value} value={stage.value}>{stage.label}</option>)}
        </select>
      </label>
      </article>
    </motion.div>
  )
}
