# ============================================================================
# HG - One-click Edge Function deploy (Windows PowerShell)
# Run from a PowerShell window:
#   powershell -ExecutionPolicy Bypass -File "C:\Users\User\Downloads\Black AI - 16 May [Source Code]\supabase\deploy-functions.ps1"
# ============================================================================

$ProjectRef = "fwenyafmfcpecerywfex"

function Refresh-Path {
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
              [System.Environment]::GetEnvironmentVariable("Path","User")
}

Write-Host ""
Write-Host "=== HG Edge Function Deploy ===" -ForegroundColor Yellow
Write-Host ""

# 1. Ensure Supabase CLI is installed -------------------------------------------------
if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
  Write-Host "Supabase CLI not found - installing via Scoop..." -ForegroundColor Cyan
  if (-not (Get-Command scoop -ErrorAction SilentlyContinue)) {
    try { Invoke-RestMethod -Uri https://get.scoop.sh | Invoke-Expression }
    catch { Write-Host ("Scoop note: " + $_.Exception.Message) -ForegroundColor DarkYellow }
    Refresh-Path
  }
  try { scoop bucket add supabase https://github.com/supabase/scoop-bucket.git } catch {}
  scoop install supabase
  Refresh-Path
} else {
  Write-Host "Supabase CLI found." -ForegroundColor Green
}
if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
  Write-Host "Supabase CLI not on PATH yet. Close this window, open a NEW PowerShell, and run the command again." -ForegroundColor Red
  exit 1
}

# 2. Log in (opens a browser once) ----------------------------------------------------
Write-Host ""
Write-Host "Logging in to Supabase (a browser will open - approve it)..." -ForegroundColor Cyan
supabase login

# 3. Move into the project root (parent of this /supabase folder) ---------------------
# NOTE: -LiteralPath only on Push-Location - the folder name has [ ] brackets.
$root = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $root
Write-Host ""
Write-Host ("Project folder: " + $root) -ForegroundColor DarkGray

# 4. Gemini API key (AIza... old format, or AQ.... new format) ------------------------
Write-Host ""
Write-Host "TIP: in Google AI Studio, click 'Copy key' so you paste the exact key." -ForegroundColor DarkGray
$gem = (Read-Host "Paste your Gemini API key").Trim()
if ($gem.Length -lt 20) {
  Write-Host "That key looks too short. Get one at https://aistudio.google.com/apikey" -ForegroundColor Red
  Pop-Location; exit 1
}
Write-Host "Setting GEMINI_API_KEY..." -ForegroundColor Cyan
supabase secrets set --project-ref $ProjectRef GEMINI_API_KEY=$gem

# 5. Deploy the functions (directly, by project ref - no linking needed) --------------
Write-Host ""
Write-Host "Deploying Edge Functions..." -ForegroundColor Cyan
$funcs = @("assistant","gemini-receipt","gemini-generate","daily-alarms")
$deployed = 0
foreach ($f in $funcs) {
  if (Test-Path -LiteralPath "supabase\functions\$f\index.ts") {
    Write-Host ("  - " + $f) -ForegroundColor Yellow
    supabase functions deploy $f --project-ref $ProjectRef
    if ($LASTEXITCODE -eq 0) { $deployed++ }
  } else {
    Write-Host ("  ! missing: supabase\functions\$f\index.ts") -ForegroundColor DarkYellow
  }
}

Pop-Location
Write-Host ""
if ($deployed -gt 0) {
  Write-Host ("Deployed $deployed function(s). Refresh the hub - the AI Daily Briefing should fill in.") -ForegroundColor Green
} else {
  Write-Host "No functions were deployed. Copy the red text above and send it over." -ForegroundColor Red
}
Write-Host ""
