import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../lib/api'
import type { AiHealth, Candidate } from '../types'

type DataSource = 'loading' | 'api' | 'error'

interface DataContextValue {
  candidates: Candidate[]
  source: DataSource
  error: string | null
  aiHealth: AiHealth
  addCandidates: (items: Candidate[]) => Promise<void>
  refresh: () => Promise<void>
  findCandidate: (id: string) => Candidate | undefined
}

const DataContext = createContext<DataContextValue | null>(null)
export function DataProvider({ children }: { children: ReactNode }) {
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [source, setSource] = useState<DataSource>('loading')
  const [error, setError] = useState<string | null>(null)
  const [aiHealth, setAiHealth] = useState<AiHealth>({ status: 'loading', provider: 'IA', model: '', configured: false })

  const refresh = useCallback(async () => {
    setSource('loading')
    setError(null)
    try {
      const [remoteCandidates, health] = await Promise.all([api.loadWorkspace(), api.health()])
      setCandidates(remoteCandidates)
      setAiHealth(health)
      setSource('api')
    } catch (loadError) {
      setCandidates([])
      setAiHealth({ status: 'offline', provider: 'IA', model: '', configured: false })
      setSource('error')
      setError(loadError instanceof Error ? loadError.message : 'Impossible de joindre le backend.')
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const addCandidates = useCallback(async (items: Candidate[]) => {
    if (items.length) await refresh()
  }, [refresh])

  const value = useMemo<DataContextValue>(() => ({
    candidates,
    source, error, aiHealth, addCandidates, refresh,
    findCandidate: (id) => candidates.find((candidate) => candidate.id === id),
  }), [addCandidates, aiHealth, candidates, error, refresh, source])

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData() {
  const context = useContext(DataContext)
  if (!context) throw new Error('useData doit être utilisé dans DataProvider')
  return context
}
