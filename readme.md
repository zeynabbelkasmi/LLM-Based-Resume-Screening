# Analyse CV

Application locale d’analyse de CV avec interface React et API FastAPI. Les CV
sont évalués par Qwen3 8B exécuté localement dans LM Studio, selon une fiche de poste et des
critères pondérés définis par l’utilisateur.

## Fonctionnalités

- analyse simultanée de plusieurs CV PDF ;
- fiche de poste saisie en texte brut, téléversée en PDF, ou combinée ;
- critères d’évaluation ajoutables dynamiquement avec pondérations totalisant 100 % ;
- analyse sémantique LLM avec sortie JSON contrôlée et garde-fous RH ;
- CVthèque, fiches candidat, pipeline, journal d’activité et exports PDF/Excel ;
- stockage SQLite local et validation humaine explicitement requise.

L’application ne contient ni moteur de scoring à règles, ni données simulées,
ni assistant conversationnel.

## Installation

```powershell
python -m pip install -r requirements.txt
cd frontend
npm install
cd ..
```

## Configuration de LM Studio

1. Dans LM Studio, téléchargez et chargez un modèle **Qwen3 8B** compatible avec
   votre machine.
2. Ouvrez l’onglet **Developer**, puis démarrez le serveur local sur le port
   `1234`.
3. Vérifiez l’identifiant exact exposé par LM Studio :

```powershell
(Invoke-RestMethod http://127.0.0.1:1234/v1/models).data | Select-Object id
```

4. Copiez `.env.example` vers `.env`, puis adaptez le modèle si l’identifiant
   affiché diffère :

```env
LM_STUDIO_BASE_URL=http://127.0.0.1:1234/v1
LM_STUDIO_MODEL=qwen/qwen3-8b
LM_STUDIO_API_TOKEN=
```

Le script suivant crée ou actualise automatiquement `.env` avec ces valeurs :

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\configure_ai.ps1
```

La clé est facultative. Renseignez `LM_STUDIO_API_TOKEN` seulement si vous avez
activé **Require Authentication** dans LM Studio.

## Démarrage

Dans deux terminaux :

```powershell
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8001
```

```powershell
cd frontend
npm run dev
```

Ouvrez `http://localhost:5175`. L’API documentée est disponible sur
`http://127.0.0.1:8001/docs`.

## Vérification

```powershell
pytest -q
cd frontend
npm run lint
npm run build
```

## Structure

```text
backend/                API, analyse LLM, stockage et exports
frontend/               interface React/Vite
scripts/                configuration locale de LM Studio
tests/                  tests unitaires et d’intégration
convertisseur.py        extraction et conversion PDF vers Markdown
```

Les fichiers `.env`, `analyses.db`, archives et documents locaux sont ignorés
afin d’éviter la versionisation de secrets ou de données de candidats.
