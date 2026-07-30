import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = Exclude<ThemePreference, 'system'>

interface ThemeContextValue {
  preference: ThemePreference
  resolvedTheme: ResolvedTheme
  setTheme: (theme: ThemePreference) => void
  toggleTheme: () => void
}

const STORAGE_KEY = 'analyse-cv-theme-preference'
const DARK_QUERY = '(prefers-color-scheme: dark)'

const ThemeContext = createContext<ThemeContextValue | null>(null)

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

function readPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return isThemePreference(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== 'system') return preference
  return window.matchMedia?.(DARK_QUERY).matches ? 'dark' : 'light'
}

function applyTheme(preference: ThemePreference) {
  const resolved = resolveTheme(preference)
  const root = document.documentElement
  root.dataset.theme = resolved
  root.dataset.themePreference = preference
  root.style.colorScheme = resolved
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    'content',
    resolved === 'dark' ? '#0c1312' : '#f5f6f2',
  )
  return resolved
}

// Exécuté avant le premier rendu React : le thème est posé sans écran clair intermédiaire.
const initialPreference = typeof window === 'undefined' ? 'system' : readPreference()
if (typeof document !== 'undefined') applyTheme(initialPreference)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(initialPreference)
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    typeof window === 'undefined' ? 'light' : resolveTheme(initialPreference),
  )

  const setTheme = useCallback((theme: ThemePreference) => {
    setPreference(theme)
    setResolvedTheme(applyTheme(theme))
    try {
      // Seule la préférence visuelle est persistée, jamais une donnée candidat.
      window.localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // Le thème reste actif même si le stockage privé du navigateur est indisponible.
    }
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(resolveTheme(preference) === 'dark' ? 'light' : 'dark')
  }, [preference, setTheme])

  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY)
    const syncSystemTheme = () => {
      if (preference === 'system') setResolvedTheme(applyTheme('system'))
    }
    syncSystemTheme()
    media.addEventListener('change', syncSystemTheme)
    return () => media.removeEventListener('change', syncSystemTheme)
  }, [preference])

  const value = useMemo(
    () => ({ preference, resolvedTheme, setTheme, toggleTheme }),
    [preference, resolvedTheme, setTheme, toggleTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme doit être utilisé dans ThemeProvider')
  return context
}
