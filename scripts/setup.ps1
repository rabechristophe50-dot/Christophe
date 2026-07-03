# setup.ps1 — Installation en une commande pour Windows
# Usage (depuis le dossier du projet) :  powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
#
# Fait 3 choses :
#   1. npm install
#   2. cree rules.json depuis l'exemple SEULEMENT s'il n'existe pas (ne detruit pas votre config)
#   3. ajoute le serveur MCP dans %USERPROFILE%\.claude\.mcp.json en FUSIONNANT (n'ecrase pas les autres)

$ErrorActionPreference = "Stop"

# Racine du projet = dossier parent de ce script
$root = Split-Path -Parent $PSScriptRoot

Write-Host "==> Projet : $root"

# 1. Dependances
Write-Host "==> npm install ..."
Push-Location $root
npm install
Pop-Location

# 2. rules.json (protege l'existant)
$rules = Join-Path $root "rules.json"
if (Test-Path $rules) {
    Write-Host "==> rules.json existe deja — conserve tel quel."
} else {
    Copy-Item (Join-Path $root "rules.example.json") $rules
    Write-Host "==> rules.json cree depuis rules.example.json — a personnaliser."
}

# 3. Fusion de la config MCP
$cfgDir = Join-Path $HOME ".claude"
$cfg    = Join-Path $cfgDir ".mcp.json"
New-Item -ItemType Directory -Force -Path $cfgDir | Out-Null

if (Test-Path $cfg) {
    $json = Get-Content $cfg -Raw | ConvertFrom-Json
} else {
    $json = [PSCustomObject]@{}
}

# Garantir la presence de mcpServers
if (-not ($json.PSObject.Properties.Name -contains "mcpServers")) {
    $json | Add-Member -NotePropertyName "mcpServers" -NotePropertyValue ([PSCustomObject]@{})
}

$serverEntry = [PSCustomObject]@{
    command = "node"
    args    = @((Join-Path $root "src\server.js"))
}

# Ajoute ou remplace uniquement notre entree, sans toucher aux autres
if ($json.mcpServers.PSObject.Properties.Name -contains "claudeverstradingview") {
    $json.mcpServers.claudeverstradingview = $serverEntry
} else {
    $json.mcpServers | Add-Member -NotePropertyName "claudeverstradingview" -NotePropertyValue $serverEntry
}

$json | ConvertTo-Json -Depth 10 | Set-Content $cfg -Encoding UTF8
Write-Host "==> Config MCP fusionnee dans $cfg"
Write-Host "    Serveurs presents : $($json.mcpServers.PSObject.Properties.Name -join ', ')"

Write-Host ""
Write-Host "Termine. Etapes suivantes :"
Write-Host "  1. Lancer TradingView :   scripts\launch_tv_debug.bat"
Write-Host "  2. Redemarrer Claude Code"
Write-Host "  3. Verifier avec l'outil : tv_health_check  (attendu : cdp_connected: true)"
