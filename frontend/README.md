# Analyse CV — frontend React

Interface React 19/Vite de l’application Analyse CV.

La première vue est « Nouvelle analyse ». Elle permet d’ajouter jusqu’à huit CV
PDF, de fournir la fiche de poste en texte et/ou en PDF, puis de configurer des
critères pondérés dynamiques. Le seul mode d’évaluation disponible est le LLM
configuré côté serveur.

## Commandes

```bash
npm install
npm run dev
npm run lint
npm run build
```

Le serveur Vite écoute sur `http://localhost:5173` et redirige `/api` vers la
cible définie par `API_PROXY_TARGET` (par défaut `http://localhost:8000`).

```env
VITE_API_URL=/api
API_PROXY_TARGET=http://localhost:8000
```

Ne placez jamais le jeton du fournisseur dans une variable `VITE_*` : ces
variables sont exposées au navigateur.

Les principaux écrans sont l’analyse, la CVthèque, le pipeline, le journal
d’activité, la fiche candidat et les paramètres du fournisseur LLM.
