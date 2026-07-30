import { useEffect, useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import {
  CheckCircle2,
  CircleAlert,
  Download,
  FileDown,
  FilePlus2,
  GitBranch,
  History,
  Layers3,
  PencilLine,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react'
import { EmptyState, PageHeading, PageTransition } from '../components/ui'
import './activity.css'

const API_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')
const PAGE_SIZE = 50

type AuditMetadata = Record<string, unknown>

type AuditEvent = {
  id: number
  action: string
  entity_type: string
  entity_id: string | null
  summary: string
  metadata: AuditMetadata
  created_at: string
}

type AuditResponse = {
  items: AuditEvent[]
  total: number
  limit: number
  offset: number
}

type ActivityCategory = 'all' | 'candidate' | 'pipeline' | 'export' | 'system'

type EventPresentation = {
  label: string
  category: Exclude<ActivityCategory, 'all'>
  icon: LucideIcon
  tone: 'teal' | 'blue' | 'violet' | 'amber' | 'red' | 'neutral'
}

const categories: Array<{ value: ActivityCategory; label: string; icon: LucideIcon }> = [
  { value: 'all', label: 'Tout', icon: History },
  { value: 'candidate', label: 'Dossiers', icon: UsersRound },
  { value: 'pipeline', label: 'Pipeline', icon: GitBranch },
  { value: 'export', label: 'Exports', icon: Download },
  { value: 'system', label: 'Système', icon: ShieldCheck },
]

const knownActions: Record<string, EventPresentation> = {
  'analysis.created': { label: 'Dossier créé', category: 'candidate', icon: FilePlus2, tone: 'teal' },
  'analysis.updated': { label: 'Dossier mis à jour', category: 'candidate', icon: PencilLine, tone: 'blue' },
  'analysis.deleted': { label: 'Dossier supprimé', category: 'candidate', icon: Trash2, tone: 'red' },
  'analysis.bulk_updated': { label: 'Action groupée', category: 'pipeline', icon: Layers3, tone: 'violet' },
  'export.generated': { label: 'Export généré', category: 'export', icon: FileDown, tone: 'amber' },
}

const fieldLabels: Record<string, string> = {
  status: 'étape',
  tags: 'étiquettes',
  favorite: 'priorité',
  notes: 'notes',
  candidate_name: 'identité',
}

const scopeLabels: Record<string, string> = {
  text: 'Saisie texte',
  upload: 'Import PDF',
  batch_upload: 'Import groupé',
  all: 'Tous les dossiers',
  selected: 'Sélection de dossiers',
  all_candidates: 'Tous les dossiers',
  selection: 'Sélection de dossiers',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAuditEvent(value: unknown): value is AuditEvent {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'number' &&
    typeof value.action === 'string' &&
    typeof value.entity_type === 'string' &&
    (typeof value.entity_id === 'string' || value.entity_id === null) &&
    typeof value.summary === 'string' &&
    isRecord(value.metadata) &&
    typeof value.created_at === 'string'
  )
}

async function fetchAuditEvents(offset: number, signal?: AbortSignal): Promise<AuditResponse> {
  const response = await fetch(`${API_URL}/audit/events?limit=${PAGE_SIZE}&offset=${offset}`, {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
    signal,
  })

  if (!response.ok) {
    let detail = `Le journal est indisponible (${response.status}).`
    try {
      const payload = await response.json() as { detail?: unknown }
      if (typeof payload.detail === 'string' && payload.detail.trim()) detail = payload.detail
    } catch {
      // Une réponse non JSON conserve le message neutre ci-dessus.
    }
    throw new Error(detail)
  }

  const payload: unknown = await response.json()
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw new Error('La réponse du journal est invalide.')
  }

  const items = payload.items.filter(isAuditEvent)
  const total = typeof payload.total === 'number' && Number.isFinite(payload.total)
    ? Math.max(0, payload.total)
    : items.length

  return {
    items,
    total,
    limit: typeof payload.limit === 'number' ? payload.limit : PAGE_SIZE,
    offset: typeof payload.offset === 'number' ? payload.offset : offset,
  }
}

function presentationFor(event: AuditEvent): EventPresentation {
  const known = knownActions[event.action]
  if (known) {
    if (
      event.action === 'analysis.updated' &&
      Array.isArray(event.metadata.fields) &&
      event.metadata.fields.some((field) => ['status', 'tags', 'favorite'].includes(String(field)))
    ) {
      return { label: 'Pipeline mis à jour', category: 'pipeline', icon: GitBranch, tone: 'blue' }
    }
    return known
  }
  if (event.action.startsWith('export.')) return { label: 'Export', category: 'export', icon: FileDown, tone: 'amber' }
  if (event.action.startsWith('analysis.')) {
    return { label: 'Dossier candidat', category: 'candidate', icon: UsersRound, tone: 'teal' }
  }
  return { label: 'Événement système', category: 'system', icon: ShieldCheck, tone: 'neutral' }
}

function metadataDetails(metadata: AuditMetadata): string[] {
  const details: string[] = []
  if (Array.isArray(metadata.fields)) {
    const fields = metadata.fields
      .filter((field): field is string => typeof field === 'string')
      .slice(0, 4)
      .map((field) => fieldLabels[field] || field.replaceAll('_', ' '))
    if (fields.length) details.push(`Champs : ${fields.join(', ')}`)
  }
  if (typeof metadata.format === 'string' && metadata.format) details.push(`Format ${metadata.format.toUpperCase()}`)
  if (typeof metadata.scope === 'string' && metadata.scope) details.push(scopeLabels[metadata.scope] || 'Périmètre contrôlé')
  if (typeof metadata.status === 'string' && metadata.status) details.push(`Statut : ${metadata.status.replaceAll('_', ' ')}`)
  if (typeof metadata.updated === 'number') details.push(`${metadata.updated} dossier${metadata.updated > 1 ? 's' : ''} traité${metadata.updated > 1 ? 's' : ''}`)
  else if (typeof metadata.count === 'number') details.push(`${metadata.count} élément${metadata.count > 1 ? 's' : ''}`)
  const missingCount = Array.isArray(metadata.missing) ? metadata.missing.length : typeof metadata.missing === 'number' ? metadata.missing : 0
  if (missingCount > 0) details.push(`${missingCount} introuvable${missingCount > 1 ? 's' : ''}`)
  if (metadata.degraded === true) details.push('Mode de secours')
  return details.slice(0, 3)
}

const dayFormatter = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const preciseFormatter = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' })
const timeFormatter = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })
const relativeFormatter = new Intl.RelativeTimeFormat('fr-FR', { numeric: 'auto' })

function validDate(value: string): Date | null {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function dayKey(value: string): string {
  const date = validDate(value)
  if (!date) return 'unknown'
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function dayLabel(value: string): string {
  const date = validDate(value)
  if (!date) return 'Date non disponible'
  const today = new Date()
  const current = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const difference = Math.round((target - current) / 86_400_000)
  if (difference === 0) return "Aujourd’hui"
  if (difference === -1) return 'Hier'
  return dayFormatter.format(date)
}

function relativeDate(value: string): string {
  const date = validDate(value)
  if (!date) return 'Date inconnue'
  const difference = date.getTime() - Date.now()
  const minutes = Math.round(difference / 60_000)
  if (Math.abs(minutes) < 60) return relativeFormatter.format(minutes, 'minute')
  const hours = Math.round(difference / 3_600_000)
  if (Math.abs(hours) < 24) return relativeFormatter.format(hours, 'hour')
  return relativeFormatter.format(Math.round(difference / 86_400_000), 'day')
}

function entityLabel(event: AuditEvent): string | null {
  if (event.entity_type === 'analysis' && event.entity_id) return `Dossier #${event.entity_id}`
  if (event.entity_type === 'candidate_library') return 'CVthèque complète'
  if (event.entity_type === 'system') return 'Système'
  return null
}

export default function Activity() {
  const reduceMotion = useReducedMotion()
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [total, setTotal] = useState(0)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<ActivityCategory>('all')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [moreError, setMoreError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setMoreError(null)

    void fetchAuditEvents(0, controller.signal)
      .then((result) => {
        setEvents(result.items)
        setTotal(result.total)
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        setError(reason instanceof Error ? reason.message : 'Impossible de charger le journal d’activité.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [reloadKey])

  const counts = useMemo(() => {
    const result: Record<ActivityCategory, number> = { all: events.length, candidate: 0, pipeline: 0, export: 0, system: 0 }
    events.forEach((event) => { result[presentationFor(event).category] += 1 })
    return result
  }, [events])

  const filteredEvents = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('fr')
    return events.filter((event) => {
      const presentation = presentationFor(event)
      if (category !== 'all' && presentation.category !== category) return false
      if (!needle) return true
      const reference = entityLabel(event) || ''
      return `${event.summary} ${presentation.label} ${reference}`.toLocaleLowerCase('fr').includes(needle)
    })
  }, [category, events, query])

  const groupedEvents = useMemo(() => {
    const groups: Array<{ key: string; label: string; events: AuditEvent[] }> = []
    filteredEvents.forEach((event) => {
      const key = dayKey(event.created_at)
      const last = groups.at(-1)
      if (last?.key === key) last.events.push(event)
      else groups.push({ key, label: dayLabel(event.created_at), events: [event] })
    })
    return groups
  }, [filteredEvents])

  const recentCount = useMemo(() => {
    const threshold = Date.now() - 86_400_000
    return events.filter((event) => (validDate(event.created_at)?.getTime() || 0) >= threshold).length
  }, [events])

  const hasMore = events.length < total
  const latest = events[0]

  const loadMore = async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    setMoreError(null)
    try {
      const result = await fetchAuditEvents(events.length)
      setEvents((current) => {
        const knownIds = new Set(current.map((event) => event.id))
        return [...current, ...result.items.filter((event) => !knownIds.has(event.id))]
      })
      setTotal(result.total)
    } catch (reason) {
      setMoreError(reason instanceof Error ? reason.message : 'Les événements suivants n’ont pas pu être chargés.')
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <PageTransition>
      <PageHeading
        eyebrow="Gouvernance & traçabilité"
        title="Journal d’activité"
        description="Suivez les opérations sensibles de l’espace recrutement sans exposer les données des candidats."
        actions={(
          <button
            className="button button--secondary"
            type="button"
            onClick={() => setReloadKey((value) => value + 1)}
            disabled={loading}
          >
            <RefreshCw className={loading ? 'spin' : ''} size={16} />
            Actualiser
          </button>
        )}
      />

      <section className="activity-overview" aria-label="Synthèse du journal">
        <div className="activity-metric panel">
          <span className="activity-metric__icon"><History size={18} /></span>
          <div><small>Événements enregistrés</small><strong>{total}</strong><p>{events.length} chargé{events.length > 1 ? 's' : ''} dans cette vue</p></div>
        </div>
        <div className="activity-metric panel">
          <span className="activity-metric__icon activity-metric__icon--teal"><CheckCircle2 size={18} /></span>
          <div><small>Dernières 24 heures</small><strong>{recentCount}</strong><p>Opérations récentes chargées</p></div>
        </div>
        <div className="activity-metric panel">
          <span className="activity-metric__icon activity-metric__icon--violet"><GitBranch size={18} /></span>
          <div><small>Mouvements pipeline</small><strong>{counts.pipeline}</strong><p>Décisions et actions groupées</p></div>
        </div>
        <div className="activity-metric panel">
          <span className="activity-metric__icon activity-metric__icon--amber"><FileDown size={18} /></span>
          <div><small>Exports générés</small><strong>{counts.export}</strong><p>{latest ? `Dernière activité ${relativeDate(latest.created_at)}` : 'Aucune activité récente'}</p></div>
        </div>
      </section>

      <aside className="activity-privacy" role="note">
        <span><ShieldCheck size={18} /></span>
        <div>
          <strong>Journal conçu pour la confidentialité</strong>
          <p>Seules les opérations et métadonnées techniques sont affichées — aucun nom, contact, note ou contenu de CV.</p>
        </div>
        <i>Rétention bornée</i>
      </aside>

      <section className="activity-controls panel" aria-label="Filtres du journal">
        <div className="activity-search">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher une opération ou un dossier…"
            aria-label="Rechercher dans le journal"
          />
          {query && <button type="button" onClick={() => setQuery('')} aria-label="Effacer la recherche"><X size={15} /></button>}
        </div>
        <div className="activity-categories" role="group" aria-label="Filtrer par catégorie">
          {categories.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.value}
                type="button"
                className={category === item.value ? 'is-active' : ''}
                onClick={() => setCategory(item.value)}
                aria-pressed={category === item.value}
              >
                <Icon size={14} />
                {item.label}
                <span>{counts[item.value]}</span>
              </button>
            )
          })}
        </div>
      </section>

      <p className="activity-live" aria-live="polite">
        {loading ? 'Chargement du journal.' : `${filteredEvents.length} événement${filteredEvents.length > 1 ? 's' : ''} affiché${filteredEvents.length > 1 ? 's' : ''}.`}
      </p>

      {loading ? (
        <ActivitySkeleton />
      ) : error ? (
        <section className="activity-error panel" role="alert">
          <span><CircleAlert size={21} /></span>
          <div><strong>Le journal ne peut pas être chargé</strong><p>{error}</p></div>
          <button className="button button--secondary button--sm" type="button" onClick={() => setReloadKey((value) => value + 1)}>Réessayer</button>
        </section>
      ) : !filteredEvents.length ? (
        <section className="activity-empty panel">
          <EmptyState
            icon={History}
            title={events.length ? 'Aucun événement correspondant' : 'Le journal est encore vide'}
            description={events.length ? 'Modifiez la recherche ou choisissez une autre catégorie.' : 'Les prochaines opérations importantes apparaîtront ici automatiquement.'}
            action={events.length ? <button className="button button--secondary button--sm" type="button" onClick={() => { setQuery(''); setCategory('all') }}>Réinitialiser les filtres</button> : undefined}
          />
        </section>
      ) : (
        <section className="activity-feed panel" aria-label="Chronologie des opérations">
          <header className="activity-feed__header">
            <div><span className="eyebrow">Chronologie</span><h2>Activité récente</h2></div>
            <p>{filteredEvents.length} résultat{filteredEvents.length > 1 ? 's' : ''} sur {events.length} chargé{events.length > 1 ? 's' : ''}</p>
          </header>

          <div className="activity-timeline">
            {groupedEvents.map((group) => (
              <section className="activity-day" key={group.key} aria-labelledby={`activity-day-${group.key}`}>
                <header className="activity-day__label">
                  <h3 id={`activity-day-${group.key}`}>{group.label}</h3>
                  <span>{group.events.length} opération{group.events.length > 1 ? 's' : ''}</span>
                </header>
                <div className="activity-day__events">
                  {group.events.map((event, index) => (
                    <ActivityEventRow key={event.id} event={event} index={index} reduceMotion={Boolean(reduceMotion)} />
                  ))}
                </div>
              </section>
            ))}
          </div>

          <footer className="activity-feed__footer">
            <div>
              <strong>{events.length} sur {total}</strong>
              <span>événements chargés</span>
            </div>
            {moreError && <p role="alert"><CircleAlert size={14} />{moreError}</p>}
            {hasMore ? (
              <button className="button button--secondary" type="button" onClick={() => void loadMore()} disabled={loadingMore}>
                <RefreshCw className={loadingMore ? 'spin' : ''} size={16} />
                {loadingMore ? 'Chargement…' : 'Charger plus d’événements'}
              </button>
            ) : <span className="activity-feed__complete"><CheckCircle2 size={15} />Journal chargé</span>}
          </footer>
        </section>
      )}
    </PageTransition>
  )
}

function ActivityEventRow({ event, index, reduceMotion }: { event: AuditEvent; index: number; reduceMotion: boolean }) {
  const presentation = presentationFor(event)
  const Icon = presentation.icon
  const date = validDate(event.created_at)
  const details = metadataDetails(event.metadata)
  const entity = entityLabel(event)

  return (
    <motion.article
      className="activity-event"
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: .25, delay: Math.min(index * .025, .15) }}
    >
      <div className={`activity-event__icon activity-event__icon--${presentation.tone}`}><Icon size={17} /></div>
      <div className="activity-event__body">
        <div className="activity-event__heading">
          <div><strong>{presentation.label}</strong>{entity && <span>{entity}</span>}</div>
          <time dateTime={event.created_at} title={date ? preciseFormatter.format(date) : undefined}>
            {date ? timeFormatter.format(date) : '—'}
          </time>
        </div>
        <p>{event.summary}</p>
        {details.length > 0 && <div className="activity-event__details">{details.map((detail) => <span key={detail}>{detail}</span>)}</div>}
      </div>
    </motion.article>
  )
}

function ActivitySkeleton() {
  return (
    <section className="activity-skeleton panel" role="status" aria-label="Chargement du journal d’activité">
      <div className="activity-skeleton__header"><i /><span /></div>
      {Array.from({ length: 6 }, (_, index) => (
        <div className="activity-skeleton__row" key={index}><i /><div><span /><span /><span /></div></div>
      ))}
    </section>
  )
}
