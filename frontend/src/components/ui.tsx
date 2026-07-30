import { motion } from 'framer-motion'
import { CircleAlert, FileSearch, LoaderCircle, TriangleAlert, type LucideIcon } from 'lucide-react'
import type { CandidateStatus } from '../types'

export const statusMeta: Record<CandidateStatus, { label: string; shortLabel: string }> = {
  recommended: { label: 'Recommandé', shortLabel: 'Recommandé' },
  consider: { label: 'À considérer', shortLabel: 'À considérer' },
  'not-recommended': { label: 'Non recommandé', shortLabel: 'Non retenu' },
}

export function Avatar({ initials, size = 'md', colorIndex = 0 }: { initials: string; size?: 'sm' | 'md' | 'lg' | 'xl'; colorIndex?: number }) {
  return <span className={`avatar avatar--${size} avatar--color-${colorIndex % 5}`} aria-hidden="true">{initials}</span>
}

export function StatusBadge({ status, compact = false }: { status: CandidateStatus; compact?: boolean }) {
  return <span className={`status-badge status-badge--${status}`}><i />{compact ? statusMeta[status].shortLabel : statusMeta[status].label}</span>
}

export function AnalysisWarning({ warnings, quality, compact = false }: { warnings: string[]; quality?: string; compact?: boolean }) {
  if (!warnings.length) return null
  const visibleWarnings = compact ? warnings.slice(0, 1) : warnings.slice(0, 3)
  return (
    <aside className={`analysis-warning ${compact ? 'analysis-warning--compact' : ''}`} role="note" aria-label="Limites de l’analyse">
      <TriangleAlert size={compact ? 14 : 17} />
      <div>
        <strong>
          Analyse à interpréter avec prudence
          {quality ? ` · qualité ${quality}` : ''}
        </strong>
        <ul>{visibleWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        {compact && warnings.length > 1 && <span>+{warnings.length - 1} autre{warnings.length > 2 ? 's' : ''} avertissement{warnings.length > 2 ? 's' : ''}</span>}
      </div>
    </aside>
  )
}

export function ScoreRing({ score, size = 104 }: { score: number; size?: number }) {
  const radius = 42
  const circumference = 2 * Math.PI * radius
  const colorClass = score >= 75 ? 'good' : score >= 55 ? 'medium' : 'low'
  return (
    <div className={`score-ring score-ring--${colorClass}`} style={{ width: size, height: size }} aria-label={`Score ${score} sur 100`}>
      <svg viewBox="0 0 100 100" role="img">
        <circle className="score-ring__track" cx="50" cy="50" r={radius} />
        <motion.circle
          className="score-ring__value"
          cx="50" cy="50" r={radius}
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - score / 100) }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
        />
      </svg>
      <span className="score-ring__text"><strong>{Math.round(score)}</strong><small>/100</small></span>
    </div>
  )
}

export function ScoreBar({ value, animate = true }: { value: number; animate?: boolean }) {
  const tone = value >= 75 ? 'good' : value >= 55 ? 'medium' : 'low'
  return (
    <div className={`score-bar score-bar--${tone}`}>
      <motion.span initial={animate ? { width: 0 } : false} animate={{ width: `${value}%` }} transition={{ duration: .8, ease: 'easeOut' }} />
    </div>
  )
}

export function PageHeading({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <header className="page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-heading__actions">{actions}</div>}
    </header>
  )
}

export function LoadingState({ label = 'Chargement de vos données…' }: { label?: string }) {
  return (
    <div className="loading-state" role="status">
      <LoaderCircle className="spin" size={22} />
      <span>{label}</span>
    </div>
  )
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return <div className="skeleton-table" aria-label="Chargement">{Array.from({ length: rows }, (_, i) => <div className="skeleton-row" key={i}><i /><span /><span /><span /></div>)}</div>
}

export function EmptyState({ title, description, action, icon: Icon = FileSearch }: { title: string; description: string; action?: React.ReactNode; icon?: LucideIcon }) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon"><Icon size={23} /></span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  )
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <CircleAlert size={20} />
      <div><strong>Une erreur est survenue</strong><p>{message}</p></div>
      {retry && <button className="button button--secondary button--sm" onClick={retry}>Réessayer</button>}
    </div>
  )
}

export function PageTransition({ children }: { children: React.ReactNode }) {
  return <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .38, ease: [0.22, 1, 0.36, 1] }}>{children}</motion.div>
}
