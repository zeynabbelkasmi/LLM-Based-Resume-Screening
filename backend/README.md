# Analyse CV API

API FastAPI locale chargée de l’extraction PDF, de l’analyse LLM, du stockage
SQLite, de la gestion des candidats et des exports.

## Démarrage

```powershell
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8001
```

Documentation interactive : `http://127.0.0.1:8001/docs`.

## Analyse

`POST /api/analyses/upload` accepte :

- `file` : CV PDF ;
- `job_description` : texte brut optionnel si `job_file` est présent ;
- `job_file` : fiche de poste PDF optionnelle ;
- `weights_json` : objet ordonné `{ "Nom du critère": pourcentage }` dont la
  somme doit être égale à 100 ;
- `temperature` : température du modèle.

Sans serveur LM Studio configuré ou disponible, l’analyse renvoie une erreur 503.
Il n’existe aucun repli vers un moteur de scoring à règles.

## Routes principales

- `GET /api/health`
- `GET /api/ai/diagnostic` et `POST /api/ai/test`
- `GET /api/dashboard/stats`
- `GET|POST /api/analyses`
- `POST /api/analyses/upload` et `/api/analyses/upload/batch`
- `GET|PATCH|DELETE /api/analyses/{id}`
- `PATCH /api/analyses/bulk`
- `GET /api/pipeline/summary`
- `GET /api/audit/events`
- `GET /api/exports/candidates.xlsx|pdf`
- `GET /api/exports/candidates/{id}.pdf`

L’API est prévue pour un usage local mono-utilisateur. Toute exposition réseau
nécessite authentification, TLS et contrôle d’accès.
