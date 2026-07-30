import type { AiHealth, AnalysisOptions, Candidate, CandidateStatus, ScoreSection, WorkflowStatus } from '../types'

const API_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

class ApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message)
    this.name = 'ApiError'
  }
}

async function apiFetch<T>(path: string, init?: RequestInit, timeoutMs = 20_000): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: init?.body instanceof FormData
        ? init.headers
        : { 'Content-Type': 'application/json', ...init?.headers },
    })
    if (!response.ok) {
      let detail = `Erreur API (${response.status})`
      try {
        const body = await response.json() as { detail?: string }
        if (body.detail) detail = body.detail
      } catch { /* réponse non JSON */ }
      throw new ApiError(detail, response.status)
    }
    if (response.status === 204) return undefined as T
    return await response.json() as T
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('Le serveur met trop de temps à répondre. L’analyse peut être relancée sans perdre les fichiers.')
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

async function apiDownload(path: string, fallbackFilename: string): Promise<void> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 120_000)
  try {
    const response = await fetch(`${API_URL}${path}`, { signal: controller.signal })
    if (!response.ok) {
      let detail = `Export impossible (${response.status})`
      try {
        const body = await response.json() as { detail?: string }
        if (body.detail) detail = body.detail
      } catch { /* réponse non JSON */ }
      throw new ApiError(detail, response.status)
    }
    const disposition = response.headers.get('content-disposition') || ''
    const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
    const quoted = disposition.match(/filename="([^"]+)"/i)?.[1]
    const filename = encoded
      ? decodeURIComponent(encoded)
      : quoted || fallbackFilename
    const blobUrl = URL.createObjectURL(await response.blob())
    const link = document.createElement('a')
    link.href = blobUrl
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(blobUrl)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('La génération de l’export a dépassé le délai autorisé.')
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

type BackendAnalysis = Record<string, unknown> & {
  id: number | string
  cv_filename?: string
  candidate_name?: string
  score_global?: number
  verdict?: string
  status?: WorkflowStatus
  tags?: string[]
  skills?: string[]
  missing_skills?: string[]
  years_experience?: number
  created_at?: string
  analysis?: Record<string, unknown>
  sections?: Array<Record<string, unknown>>
}

const fallbackSections = (score: number): ScoreSection[] => [
  { key: 'technical', label: 'Compétences techniques', score, note: 'Score issu de l’analyse.' },
  { key: 'experience', label: 'Expérience', score, note: 'Score issu de l’analyse.' },
  { key: 'softSkills', label: 'Soft skills', score, note: 'Score issu de l’analyse.' },
  { key: 'education', label: 'Formation', score, note: 'Score issu de l’analyse.' },
]

function initialsFrom(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'CV'
}

function statusFrom(verdict = '', score = 0): CandidateStatus {
  const normalized = verdict.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (normalized.includes('non') || normalized.includes('refus')) return 'not-recommended'
  if (normalized.includes('consider')) return 'consider'
  if (normalized.includes('recommand')) return 'recommended'
  return score >= 75 ? 'recommended' : score >= 55 ? 'consider' : 'not-recommended'
}

const sectionKey = (name: string): string => {
  const value = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (value.includes('exp')) return 'experience'
  if (value.includes('soft')) return 'softSkills'
  if (value.includes('form') || value.includes('educ')) return 'education'
  if (value.includes('tech')) return 'technical'
  return value.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'criterion'
}

export function normalizeCandidate(raw: BackendAnalysis): Candidate {
  const nestedGlobal = (raw.analysis?.global || {}) as Record<string, unknown>
  const score = Number(raw.score_global ?? nestedGlobal.score_global ?? 0)
  const filename = raw.cv_filename || 'cv.pdf'
  const inferredName = filename.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
  const name = raw.candidate_name || String(nestedGlobal.candidate_name || '') || inferredName || 'Candidat'
  const sourceSections = (raw.sections || raw.analysis?.sections || []) as Array<Record<string, unknown>>
  const sections = sourceSections.length
    ? sourceSections.map((section) => ({
        key: sectionKey(String(section.section_name || section.name || 'Technique')),
        label: String(section.section_name || section.name || 'Compétences techniques'),
        score: Number(section.score || 0),
        note: String(section.justification || section.note || 'Score issu de l’analyse.'),
      }))
    : fallbackSections(score)

  const strengths = (nestedGlobal.forces_principales || raw.analysis?.strengths || []) as string[]
  const improvements = (nestedGlobal.points_amelioration || raw.analysis?.improvements || []) as string[]
  const synthesis = (raw.analysis?.llm_synthese || {}) as Record<string, unknown>
  const comparisonMetrics = (raw.analysis?.comparison_metrics || {}) as Record<string, unknown>
  const candidateProfile = (raw.analysis?.candidate_profile || {}) as Record<string, unknown>
  const analysisWarnings = Array.isArray(raw.analysis?.warnings)
    ? raw.analysis.warnings.filter((warning): warning is string => typeof warning === 'string' && Boolean(warning.trim()))
    : []
  return {
    id: String(raw.id),
    name,
    initials: initialsFrom(name),
    headline: String(raw.analysis?.headline || candidateProfile.headline || raw.analysis?.job_title || 'Profil candidat'),
    email: String(raw.analysis?.email || candidateProfile.email || ''),
    phone: String(raw.analysis?.phone || candidateProfile.phone || ''),
    location: String(raw.analysis?.location || candidateProfile.location || ''),
    score,
    status: statusFrom(raw.verdict || String(nestedGlobal.verdict || ''), score),
    experienceYears: Number(raw.years_experience ?? comparisonMetrics.years_experience ?? candidateProfile.years_experience ?? 0),
    education: String(candidateProfile.degree_label || raw.analysis?.education || 'Non renseignée'),
    lastCompany: String(raw.analysis?.last_company || 'Non renseignée'),
    jobName: String(raw.analysis?.job_name || 'Poste analysé'),
    analyzedAt: raw.created_at || new Date().toISOString(),
    sourceFile: filename,
    skills: raw.skills || (nestedGlobal.skills_presents as string[]) || [],
    missingSkills: raw.missing_skills || (nestedGlobal.skills_absents as string[]) || [],
    strengths: strengths.length ? strengths : ['Analyse disponible dans le rapport détaillé'],
    improvements: improvements.length ? improvements : ['À valider lors de l’entretien'],
    summary: String(synthesis.resume_candidat || raw.commentaire_global || nestedGlobal.commentaire_global || 'Le résumé détaillé sera disponible après synchronisation complète de l’analyse.'),
    sections,
    interviewQuestions: (synthesis.questions_entretien || raw.analysis?.interview_questions || []) as string[],
    documentText: String(raw.markdown_content || ''),
    favorite: Boolean(raw.favorite),
    notes: String(raw.notes || ''),
    workflowStatus: raw.status || 'nouveau',
    tags: raw.tags || [],
    analysisWarnings,
    analysisQuality: String(raw.analysis?.analysis_quality || nestedGlobal.analysis_quality || raw.analysis?.confidence || nestedGlobal.confidence || ''),
  }
}

export interface AiTestResult {
  ok: boolean
  status: string
  message: string
  provider: string
  model: string
  latencyMs?: number
  configured: boolean
}

export const api = {
  health: async (): Promise<AiHealth> => {
    const raw = await apiFetch<{ ai?: { configured?: boolean; provider?: string; model?: string; mode?: string } }>('/health')
    const mode = raw.ai?.mode || ''
    return {
      status: mode === 'connected' ? 'connected' : mode === 'error' ? 'offline' : 'degraded',
      provider: raw.ai?.provider || 'IA', model: raw.ai?.model || '', configured: Boolean(raw.ai?.configured),
      mode,
    }
  },

  testAi: async (): Promise<AiTestResult> => {
    const raw = await apiFetch<Record<string, unknown>>('/ai/test', { method: 'POST' }, 60_000)
    const status = String(raw.status || raw.mode || '')
    const ok = typeof raw.ok === 'boolean'
      ? raw.ok
      : typeof raw.success === 'boolean'
        ? raw.success
        : ['ok', 'connected', 'ready', 'success'].includes(status.toLowerCase())
    const latency = Number(raw.latency_ms ?? raw.latencyMs)
    return {
      ok,
      status: status || (ok ? 'connected' : 'error'),
      message: String(raw.message || raw.detail || (ok ? 'Connexion IA opérationnelle.' : 'Le test IA a échoué.')),
      provider: String(raw.provider || 'IA'),
      model: String(raw.model || ''),
      latencyMs: Number.isFinite(latency) ? latency : undefined,
      configured: typeof raw.configured === 'boolean' ? raw.configured : ok,
    }
  },

  loadWorkspace: async () => {
    const firstPage = await apiFetch<{ items: BackendAnalysis[]; total: number }>('/analyses?limit=100&offset=0')
    const remainingOffsets = Array.from(
      { length: Math.max(0, Math.ceil((firstPage.total || 0) / 100) - 1) },
      (_, index) => (index + 1) * 100,
    )
    const remainingPages = await Promise.all(remainingOffsets.map((offset) =>
      apiFetch<{ items: BackendAnalysis[] }>(`/analyses?limit=100&offset=${offset}`),
    ))
    const candidates = [...(firstPage.items || []), ...remainingPages.flatMap((page) => page.items || [])].map(normalizeCandidate)
    return candidates
  },

  getCandidate: async (id: string) => normalizeCandidate(await apiFetch<BackendAnalysis>(`/analyses/${encodeURIComponent(id)}?include_document=true`)),
  patchCandidate: async (
    id: string,
    payload: { candidate_name?: string; status?: WorkflowStatus; tags?: string[]; favorite?: boolean; notes?: string },
  ) => normalizeCandidate(await apiFetch<BackendAnalysis>(`/analyses/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) })),
  bulkUpdateCandidates: async (
    ids: string[],
    payload: { status?: WorkflowStatus; add_tags?: string[]; remove_tags?: string[]; favorite?: boolean },
  ) => {
    const raw = await apiFetch<{ items: BackendAnalysis[]; requested: number; updated: number; missing: number[] }>('/analyses/bulk', {
      method: 'PATCH',
      body: JSON.stringify({
        ids: ids.map(Number).filter((value) => Number.isInteger(value) && value > 0),
        ...payload,
      }),
    })
    return { ...raw, items: raw.items.map(normalizeCandidate) }
  },
  deleteCandidate: (id: string) => apiFetch<void>(`/analyses/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  downloadCandidatesExcel: () => apiDownload('/exports/candidates.xlsx', 'analyse-cv-candidats.xlsx'),
  downloadCandidatesPdf: () => apiDownload('/exports/candidates.pdf', 'analyse-cv-candidats.pdf'),
  downloadCandidatePdf: (id: string) => apiDownload(`/exports/candidates/${encodeURIComponent(id)}.pdf`, `analyse-cv-candidat-${id}.pdf`),

  analyzeFile: async (file: File, options: AnalysisOptions) => {
    const form = new FormData()
    form.append('file', file)
    form.append('job_description', options.jobDescription)
    if (options.jobFile) form.append('job_file', options.jobFile)
    form.append('candidate_name', file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' '))
    form.append('temperature', String(options.temperature))
    form.append('weights_json', JSON.stringify(options.weights))
    return normalizeCandidate(await apiFetch<BackendAnalysis>('/analyses/upload', { method: 'POST', body: form }, 180_000))
  },
}

export { ApiError }
