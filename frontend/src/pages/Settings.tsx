import { motion } from 'framer-motion'
import {
  Bot,
  CheckCircle2,
  Database,
  LoaderCircle,
  LockKeyhole,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  Server,
  ShieldCheck,
  Sun,
  TriangleAlert,
  XCircle,
} from 'lucide-react'
import { useState } from 'react'
import { PageHeading, PageTransition } from '../components/ui'
import { useData } from '../context/DataContext'
import { useTheme, type ThemePreference } from '../context/ThemeContext'
import { api, type AiTestResult } from '../lib/api'

const themeOptions: Array<{
  value: ThemePreference
  label: string
  description: string
  icon: typeof Sun
}> = [
  { value: 'light', label: 'Clair', description: 'Lisibilité maximale en environnement lumineux', icon: Sun },
  { value: 'dark', label: 'Sombre', description: 'Confort visuel pour les longues sessions', icon: Moon },
  { value: 'system', label: 'Système', description: 'Suit automatiquement votre appareil', icon: Monitor },
]

function providerLabel(provider: string) {
  if (!provider || provider === 'IA') return 'Non communiqué'
  if (provider.toLowerCase().includes('lm_studio')) return 'LM Studio (local)'
  return provider.replaceAll('_', ' ')
}

function aiStatusLabel(status: string, configured: boolean, mode?: string) {
  if (!configured) return 'Non configurée'
  if (mode === 'configured_not_tested') return 'Prête à tester'
  if (mode === 'error') return 'Échec de connexion'
  if (status === 'connected') return 'Opérationnelle'
  if (status === 'loading') return 'Vérification'
  if (status === 'degraded') return 'Mode dégradé'
  return 'Indisponible'
}

function aiStatusTone(status: string, configured: boolean, mode?: string) {
  if (!configured) return 'missing'
  if (mode === 'configured_not_tested') return 'loading'
  if (mode === 'error') return 'offline'
  return status
}

export default function Settings() {
  // Settings page removed per request.
  return <PageTransition><div /></PageTransition>
}
