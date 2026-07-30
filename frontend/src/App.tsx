import { lazy, Suspense } from 'react'
import { MotionConfig } from 'framer-motion'
import { Redirect, Route, Switch } from 'wouter'
import Layout from './components/Layout'
import { LoadingState } from './components/ui'
import { ThemeProvider } from './context/ThemeContext'

const Candidates = lazy(() => import('./pages/Candidates'))
const CandidateDetail = lazy(() => import('./pages/CandidateDetail'))
const Analyze = lazy(() => import('./pages/Analyze'))
const Pipeline = lazy(() => import('./pages/Pipeline'))
const Activity = lazy(() => import('./pages/Activity'))
const Settings = lazy(() => import('./pages/Settings'))

export default function App() {
  return (
    <ThemeProvider>
      <MotionConfig reducedMotion="user">
        <Layout>
          <Suspense fallback={<LoadingState label="Ouverture de l’espace…" />}>
            <Switch>
              <Route path="/analyse" component={Analyze} />
              <Route path="/candidats/:candidateId" component={CandidateDetail} />
              <Route path="/candidats" component={Candidates} />
              <Route path="/pipeline" component={Pipeline} />
              <Route path="/journal" component={Activity} />
              <Route path="/parametres" component={Settings} />
              <Route><Redirect to="/analyse" /></Route>
            </Switch>
          </Suspense>
        </Layout>
      </MotionConfig>
    </ThemeProvider>
  )
}
