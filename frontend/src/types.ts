export type CandidateStatus = 'recommended' | 'consider' | 'not-recommended'
export type WorkflowStatus = 'nouveau' | 'a_revoir' | 'entretien' | 'retenu' | 'refuse'

export interface ScoreSection {
  key: string
  label: string
  score: number
  note: string
}

export interface Candidate {
  id: string
  name: string
  initials: string
  headline: string
  email: string
  phone: string
  location: string
  score: number
  status: CandidateStatus
  experienceYears: number
  education: string
  lastCompany: string
  jobName: string
  analyzedAt: string
  sourceFile: string
  skills: string[]
  missingSkills: string[]
  strengths: string[]
  improvements: string[]
  summary: string
  sections: ScoreSection[]
  interviewQuestions: string[]
  documentText?: string
  favorite?: boolean
  notes?: string
  workflowStatus: WorkflowStatus
  tags: string[]
  analysisWarnings: string[]
  analysisQuality: string
}

export interface AnalysisOptions {
  jobDescription: string
  jobFile: File | null
  temperature: number
  weights: Record<string, number>
}

export interface AiHealth {
  status: 'loading' | 'connected' | 'degraded' | 'offline'
  provider: string
  model: string
  configured: boolean
  mode?: string
}
