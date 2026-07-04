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

  if (-not (Get-Command scoop -ErrorAction SilentlyContinue)) {
    Write-Host "Could not install Scoop automatically." -ForegroundColor Red
    Write-Host "Please install the Supabase CLI manually, then re-run this script:" -ForegroundColor Red
    Write-Host "  https://supabase.com/docs/guides/local-development/cli/getting-started" -ForegroundColor Red
    exit 1
  }

  try { scoop bucket add supabase https://github.com/supabase/scoop-bucket.git } catch {}
  scoop install supabase
  Refresh-Path
} else {
  Write-Host "Supabase CLI found." -ForegroundColor Green
}

if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
  Write-Host "Supabase CLI still not on PATH. Close this window, open a NEW PowerShell, and run the command again." -ForegroundColor Red
  exit 1
}

# 2. Log in (opens a browser once) ----------------------------------------------------
Write-Host ""
Write-Host "Logging in to Supabase (a browser will open - approve it)..." -ForegroundColor Cyan
supabase login

# 3. Link this project ----------------------------------------------------------------
Write-Host ""
Write-Host "Linking project $ProjectRef ..." -ForegroundColor Cyan
# -LiteralPath: the folder name has [ ] brackets which PowerShell treats as wildcards
Push-Location -LiteralPath (Split-Path -LiteralPath $PSScriptRoot -Parent)
supabase link --project-ref $ProjectRef

# 4. Gemini API key (AIza... old format, or AQ.... new format) -------------------------
Write-Host ""
$gem = (Read-Host "Paste your Gemini API key (AIza... or AQ...)").Trim()
if ($gem.Length -lt 20) {
  Write-Host "That key looks too short. Get one at https://aistudio.google.com/apikey" -ForegroundColor Red
  Pop-Location
  exit 1
}
supabase secrets set GEMINI_API_KEY=$gem

# Optional extras (press Enter to skip)
$resend = Read-Host "Optional - Resend API key for alarm emails (Enter to skip)"
if ($resend) { supabase secrets set RESEND_API_KEY=$resend }
$cron = Read-Host "Optional - a random secret for the daily cron (Enter to skip)"
if ($cron) { supabase secrets set CRON_SECRET=$cron }

# 5. Deploy the functions -------------------------------------------------------------
Write-Host ""
Write-Host "Deploying Edge Functions..." -ForegroundColor Cyan
$funcs = @("assistant","gemini-receipt","gemini-generate","daily-alarms")
foreach ($f in $funcs) {
  if (Test-Path "supabase\functions\$f\index.ts") {
    Write-Host ("  - " + $f) -ForegroundColor Yellow
    supabase functions deploy $f
  }
}

Pop-Location
Write-Host ""
Write-Host "Done. Refresh the hub - the AI Daily Briefing should fill in." -ForegroundColor Green
Write-Host "If it still says 'not connected', check Supabase -> Edge Functions -> assistant -> Logs."
Write-Host ""
