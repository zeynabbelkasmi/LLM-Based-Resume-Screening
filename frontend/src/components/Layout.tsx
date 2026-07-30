import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronRight,
  FileStack,
  GitBranch,
  History,
  Menu,
  Moon,
  PanelLeftClose,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Sun,
  UploadCloud,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "../lib/navigation";
import { useData } from "../context/DataContext";
import { useTheme } from "../context/ThemeContext";

const navigation = [
  { to: "/analyse", label: "Nouvelle analyse", icon: UploadCloud, exact: true },
  { to: "/candidats", label: "CV & candidats", icon: FileStack },
  { to: "/pipeline", label: "Pipeline", icon: GitBranch },
  { to: "/journal", label: "Journal d’activité", icon: History },
  { to: "/parametres", label: "Paramètres", icon: Settings2 },
];

const mobileNavigation = navigation.filter(({ to }) =>
  ["/analyse", "/candidats", "/pipeline", "/journal"].includes(to),
);

const titles: Record<string, string> = {
  "/candidats": "CV & candidats",
  "/pipeline": "Pipeline candidats",
  "/analyse": "Nouvelle analyse",
  "/journal": "Journal d’activité",
  "/parametres": "Paramètres",
};

export default function Layout({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const location = useLocation();
  const navigate = useNavigate();
  const { source, candidates } = useData();
  const { resolvedTheme, toggleTheme } = useTheme();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMobileOpen(false);
    setSearchOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        toggleTheme();
      }
      if (event.key === "Escape") setSearchOpen(false);
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [toggleTheme]);

  useEffect(() => {
    if (searchOpen) window.setTimeout(() => searchRef.current?.focus(), 60);
  }, [searchOpen]);

  const currentTitle = location.pathname.startsWith("/candidats/")
    ? "Fiche candidat"
    : titles[location.pathname] || "Analyse CV";
  const results =
    query.trim().length > 1
      ? candidates
          .filter((candidate) =>
            `${candidate.name} ${candidate.headline} ${candidate.skills.join(" ")}`
              .toLowerCase()
              .includes(query.toLowerCase()),
          )
          .slice(0, 5)
      : [];

  const sidebar = (
    <>
      <div className="brand">
        <Link to="/analyse" className="brand__mark">
          <Sparkles size={19} strokeWidth={2.3} />
        </Link>
        <Link to="/analyse" className="brand__word">
          <strong>Analyse CV</strong>
          <span>évaluation intelligente</span>
        </Link>
      </div>

      <nav className="side-nav" aria-label="Navigation principale">
        <span className="side-nav__label">Espace de travail</span>
        {navigation.map(({ to, label, icon: Icon, exact }) => (
          <NavLink
            key={to}
            to={to}
            end={exact}
            className={({ isActive }) =>
              `side-nav__item ${isActive ? "is-active" : ""}`
            }
            title={collapsed ? label : undefined}
          >
            <Icon size={19} strokeWidth={1.8} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar__footer">
        <div className="privacy-card">
          <span className="privacy-card__icon">
            <Sparkles size={15} />
          </span>
          <div>
            <strong>Données protégées</strong>
            <span>Traitement confidentiel</span>
          </div>
        </div>
        <div className="user-card">
          <span className="avatar avatar--sm avatar--color-3">RH</span>
          <div>
            <strong>Espace local</strong>
            <span>Session privée</span>
          </div>
          <ChevronRight size={15} />
        </div>
      </div>
    </>
  );

  return (
    <div className={`app-shell ${collapsed ? "app-shell--collapsed" : ""}`}>
      <aside className="sidebar">
        {sidebar}
        <button
          className="sidebar__collapse"
          onClick={() => setCollapsed((value) => !value)}
          aria-label="Réduire la navigation"
        >
          <PanelLeftClose size={16} />
        </button>
      </aside>

      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.button
              className="mobile-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              aria-label="Fermer le menu"
            />
            <motion.aside
              className="mobile-drawer"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 330, damping: 34 }}
            >
              {sidebar}
              <button
                className="mobile-drawer__close"
                onClick={() => setMobileOpen(false)}
                aria-label="Fermer"
              >
                <X size={20} />
              </button>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="app-body">
        <header className="topbar">
          <div className="topbar__start">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMobileOpen(true)}
              aria-label="Ouvrir le menu"
            >
              <Menu size={21} />
            </button>
            <div>
              <span className="topbar__breadcrumb">Analyse CV&nbsp; /</span>
              <strong>{currentTitle}</strong>
            </div>
          </div>
          <div className="topbar__actions">
            <button
              className="command-search"
              onClick={() => setSearchOpen(true)}
            >
              <Search size={17} />
              <span>Rechercher un candidat…</span>
              <kbd>⌘ K</kbd>
            </button>
            <button
              className="icon-button theme-toggle"
              onClick={toggleTheme}
              aria-label={resolvedTheme === "dark" ? "Activer le thème clair" : "Activer le thème sombre"}
              title={`${resolvedTheme === "dark" ? "Thème clair" : "Thème sombre"} (Ctrl+Maj+L)`}
            >
              {resolvedTheme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <span className={`connection-pill connection-pill--${source}`}>
              <i />
              {source === "api"
                ? "Synchronisé"
                : source === "loading"
                  ? "Connexion"
                  : "Hors ligne"}
            </span>
            <Link to="/analyse" className="button button--primary topbar__cta">
              <Plus size={17} />
              <span>Analyser des CV</span>
            </Link>
          </div>
        </header>

        <main className="main-content">
          {children}
        </main>

        <nav className="mobile-bottom-nav" aria-label="Navigation mobile">
          {mobileNavigation.map(({ to, label, icon: Icon, exact }) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              className={({ isActive }) => (isActive ? "is-active" : "")}
            >
              <Icon size={19} />
              <span>{label.replace("Nouvelle ", "").replace("CV & ", "")}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      <AnimatePresence>
        {searchOpen && (
          <motion.div
            className="command-layer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={() => setSearchOpen(false)}
          >
            <motion.div
              className="command-panel"
              role="dialog"
              aria-modal="true"
              aria-label="Recherche globale"
              initial={{ opacity: 0, scale: 0.97, y: -12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: -8 }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="command-panel__input">
                <Search size={20} />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Nom, rôle ou compétence…"
                />
                <kbd>Esc</kbd>
              </div>
              <div className="command-panel__body">
                {query.length < 2 && (
                  <p className="command-hint">
                    Saisissez au moins deux caractères pour rechercher dans la
                    CVthèque.
                  </p>
                )}
                {query.length >= 2 && results.length === 0 && (
                  <p className="command-hint">
                    Aucun candidat ne correspond à « {query} ».
                  </p>
                )}
                {results.map((candidate, index) => (
                  <button
                    key={candidate.id}
                    className="command-result"
                    onClick={() => navigate(`/candidats/${candidate.id}`)}
                  >
                    <span
                      className={`avatar avatar--sm avatar--color-${index % 5}`}
                    >
                      {candidate.initials}
                    </span>
                    <div>
                      <strong>{candidate.name}</strong>
                      <span>
                        {candidate.headline} · {candidate.score}/100
                      </span>
                    </div>
                    <ChevronRight size={17} />
                  </button>
                ))}
              </div>
              <div className="command-panel__footer">
                <span>↵ Ouvrir</span>
                <span>↑↓ Naviguer</span>
                <span>{candidates.length} profils indexés</span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
