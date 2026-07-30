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
  const { aiHealth, refresh } = useData()
  const { preference, resolvedTheme, setTheme } = useTheme()
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<AiTestResult | null>(null)
  const [testError, setTestError] = useState<string | null>(null)

  const runAiTest = async () => {
    setTesting(true)
    setTestResult(null)
    setTestError(null)
    try {
      const result = await api.testAi()
      setTestResult(result)
      await refresh()
    } catch (error) {
      setTestError(error instanceof Error ? error.message : 'Le diagnostic IA n’a pas pu être exécuté.')
    } finally {
      setTesting(false)
    }
  }

  return (
    <PageTransition>
      <PageHeading
        eyebrow="Administration locale"
        title="Paramètres & gouvernance"
        description="Contrôlez l’apparence, la connexion IA et les garanties de confidentialité de votre espace."
      />

      <div className="settings-layout">
        <div className="settings-main">
          <motion.section
            className="panel settings-card"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.04 }}
          >
            <header className="settings-card__header">
              <span className="settings-card__icon"><Palette size={20} /></span>
              <div>
                <h2>Apparence</h2>
                <p>Une préférence purement visuelle, enregistrée sur cet appareil.</p>
              </div>
              <span className="settings-value-pill">{resolvedTheme === 'dark' ? 'Sombre' : 'Clair'} actif</span>
            </header>

            <div className="theme-choice" role="radiogroup" aria-label="Thème de l’interface">
              {themeOptions.map(({ value, label, description, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={preference === value}
                  className={preference === value ? 'is-active' : ''}
                  onClick={() => setTheme(value)}
                >
                  <span><Icon size={19} /></span>
                  <strong>{label}</strong>
                  <small>{description}</small>
                  <i aria-hidden="true">{preference === value && <CheckCircle2 size={16} />}</i>
                </button>
              ))}
            </div>

            <p className="settings-footnote">
              Raccourci rapide : <kbd>Ctrl</kbd> + <kbd>Maj</kbd> + <kbd>L</kbd>. Aucune donnée candidat n’est enregistrée avec cette préférence.
            </p>
          </motion.section>

          <motion.section
            className="panel settings-card settings-card--ai"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.09 }}
          >
            <header className="settings-card__header">
              <span className="settings-card__icon settings-card__icon--ai"><Bot size={21} /></span>
              <div>
                <h2>Centre de diagnostic IA</h2>
                <p>État réel du serveur local LM Studio.</p>
              </div>
              <span className={`health-pill health-pill--${aiStatusTone(aiHealth.status, aiHealth.configured, aiHealth.mode)}`}>
                <i />{aiStatusLabel(aiHealth.status, aiHealth.configured, aiHealth.mode)}
              </span>
            </header>

            <div className="ai-diagnostic-grid">
              <div className="diagnostic-item">
                <span><Server size={16} />Fournisseur</span>
                <strong>{providerLabel(aiHealth.provider)}</strong>
              </div>
              <div className="diagnostic-item">
                <span><Bot size={16} />Modèle</span>
                <strong>{aiHealth.model || 'Non configuré'}</strong>
              </div>
              <div className="diagnostic-item">
                <span><Monitor size={16} />Exécution</span>
                <strong>Locale</strong>
              </div>
            </div>

            {!aiHealth.configured && (
              <div className="configuration-callout" role="note">
                <span><TriangleAlert size={19} /></span>
                <div>
                  <strong>Connexion IA non configurée</strong>
                  <p>
                    Démarrez le serveur local dans l’onglet Developer de LM Studio, chargez Qwen3 8B,
                    puis lancez l’assistant de configuration depuis PowerShell à la racine du projet.
                  </p>
                  <code className="env-example">powershell -ExecutionPolicy Bypass -File .\scripts\configure_ai.ps1</code>
                </div>
              </div>
            )}

            <div className="diagnostic-actions">
              <button className="button button--primary" type="button" onClick={() => void runAiTest()} disabled={testing}>
                {testing ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}
                {testing ? 'Test en cours…' : 'Tester la connexion IA'}
              </button>
              <span>Le test envoie uniquement un message technique minimal, aucun contenu de CV.</span>
            </div>

            {(testResult || testError) && (
              <div
                className={`diagnostic-result ${testResult?.ok ? 'is-success' : 'is-error'}`}
                role={testResult?.ok ? 'status' : 'alert'}
                aria-live="polite"
              >
                {testResult?.ok ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
                <div>
                  <strong>{testResult?.ok ? 'Connexion validée' : 'Diagnostic en échec'}</strong>
                  <p>{testResult?.message || testError}</p>
                  {testResult?.ok && (
                    <small>
                      {providerLabel(testResult.provider)} · {testResult.model || 'modèle serveur'}
                      {typeof testResult.latencyMs === 'number' ? ` · ${Math.round(testResult.latencyMs)} ms` : ''}
                    </small>
                  )}
                </div>
              </div>
            )}
          </motion.section>
        </div>

        <aside className="settings-aside">
          <motion.section
            className="panel governance-card"
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.12 }}
          >
            <span className="governance-card__seal"><ShieldCheck size={24} /></span>
            <span className="eyebrow">Confidentialité</span>
            <h2>Vos données restent sur votre poste</h2>
            <p>
              Le navigateur communique avec le backend, qui interroge LM Studio sur l’interface locale uniquement.
            </p>
            <ul>
              <li><LockKeyhole size={15} /><span><strong>Accès local</strong>Serveur lié à 127.0.0.1 par défaut</span></li>
              <li><Database size={15} /><span><strong>Mémoire maîtrisée</strong>Conversations et dossiers dans la base locale</span></li>
              <li><Server size={15} /><span><strong>Diagnostic limité</strong>Aucun texte de CV envoyé pendant le test</span></li>
            </ul>
          </motion.section>

          <section className="panel enterprise-note">
            <span>Préparation entreprise</span>
            <h3>Avant une exposition publique</h3>
            <p>
              Ajoutez une authentification d’entreprise, des rôles, TLS, une politique de conservation et une journalisation d’audit centralisée.
            </p>
          </section>
        </aside>
      </div>
    </PageTransition>
  )
}
