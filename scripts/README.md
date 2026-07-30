# Configuration locale de LM Studio

Depuis la racine du projet, lancez :

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\configure_ai.ps1
```

Le script configure `http://127.0.0.1:1234/v1` et `qwen/qwen3-8b` par défaut,
tout en préservant les autres variables de `.env`. Si LM Studio affiche un autre
identifiant dans `GET /v1/models`, passez-le avec `-Model` :

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\configure_ai.ps1 -Model "identifiant-lm-studio"
```

LM Studio n'exige aucun jeton par défaut. Si son authentification est activée,
utilisez `-ApiToken` ou renseignez `LM_STUDIO_API_TOKEN` directement dans `.env`.
Redémarrez ensuite FastAPI, puis vérifiez la connexion :

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:8001/api/ai/test
```

La réponse de diagnostic ne contient jamais le jeton ni le texte renvoyé par le modèle.
