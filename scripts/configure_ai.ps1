<#
.SYNOPSIS
Configure l'application pour Qwen3 8B servi localement par LM Studio.

.DESCRIPTION
Préserve les autres variables du fichier .env et actualise uniquement l'URL,
le modèle et l'éventuel jeton LM Studio. LM Studio n'exige aucun jeton par
défaut ; utilisez -ApiToken seulement si l'authentification y est activée.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File .\scripts\configure_ai.ps1

.EXAMPLE
powershell -ExecutionPolicy Bypass -File .\scripts\configure_ai.ps1 `
  -Model "identifiant-affiché-par-lm-studio"
#>

[CmdletBinding()]
param(
    [string]$EnvFile = (Join-Path $PSScriptRoot "..\.env"),
    [string]$BaseUrl = "http://127.0.0.1:1234/v1",
    [string]$Model = "qwen/qwen3-8b",
    [string]$ApiToken = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($BaseUrl -notmatch "^https?://[^\r\n]+$" -or $BaseUrl.Length -gt 500) {
    throw "L'URL LM Studio doit être une URL HTTP(S) valide sur une seule ligne."
}
if ([string]::IsNullOrWhiteSpace($Model) -or $Model -match "[\r\n]" -or $Model.Length -gt 160) {
    throw "L'identifiant du modèle LM Studio est invalide."
}
if ($ApiToken -match "[\r\n]") {
    throw "Le jeton LM Studio doit tenir sur une seule ligne."
}

$targetPath = [IO.Path]::GetFullPath($EnvFile)
$targetDirectory = [IO.Path]::GetDirectoryName($targetPath)
if (-not [IO.Directory]::Exists($targetDirectory)) {
    [void][IO.Directory]::CreateDirectory($targetDirectory)
}

if ([IO.File]::Exists($targetPath)) {
    $initialLines = [IO.File]::ReadAllLines($targetPath)
}
else {
    $examplePath = Join-Path $PSScriptRoot "..\.env.example"
    $initialLines = if ([IO.File]::Exists($examplePath)) {
        [IO.File]::ReadAllLines([IO.Path]::GetFullPath($examplePath))
    }
    else {
        @()
    }
}

$lines = [Collections.Generic.List[string]]::new()
foreach ($line in $initialLines) {
    $lines.Add($line)
}

function Set-DotEnvValue {
    param(
        [Collections.Generic.List[string]]$Lines,
        [string]$Key,
        [string]$Value
    )

    $found = $false
    $pattern = "^\s*" + [Regex]::Escape($Key) + "\s*="
    for ($index = 0; $index -lt $Lines.Count; $index++) {
        if ($Lines[$index] -match $pattern) {
            $Lines[$index] = $Key + "=" + $Value
            $found = $true
        }
    }
    if (-not $found) {
        if ($Lines.Count -gt 0 -and $Lines[$Lines.Count - 1] -ne "") {
            $Lines.Add("")
        }
        $Lines.Add($Key + "=" + $Value)
    }
}

Set-DotEnvValue -Lines $lines -Key "LM_STUDIO_BASE_URL" -Value $BaseUrl.TrimEnd("/")
Set-DotEnvValue -Lines $lines -Key "LM_STUDIO_MODEL" -Value $Model.Trim()
Set-DotEnvValue -Lines $lines -Key "LM_STUDIO_API_TOKEN" -Value $ApiToken.Trim()

$utf8WithoutBom = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllLines($targetPath, $lines, $utf8WithoutBom)

Write-Host "Configuration LM Studio enregistrée dans : $targetPath"
Write-Host "Vérifiez que Qwen3 8B est chargé et que le serveur local est démarré."
Write-Host "Redémarrez l'API, puis lancez :"
Write-Host "Invoke-RestMethod -Method Post -Uri http://localhost:8001/api/ai/test"
