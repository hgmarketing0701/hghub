# ============================================================================
# HG — One-click Edge Function deploy (Windows PowerShell)
# Run this from the project folder:
#   Right-click → Run with PowerShell   (or)   in a terminal:
#   powershell -ExecutionPolicy Bypass -File supabase\deploy-functions.ps1
#
# It will: install the Supabase CLI if missing, log you in, link the project,
# set your Gemini key, and deploy all Edge Functions.
# ============================================================================

$ErrorActionPreference = "Stop"
$ProjectRef = "fwenyafmfcpecerywfex"   # HG Supabase project

Write-Host "`n=== HG Edge Function Deploy ===`n" -ForegroundColor Yellow

# 1. Ensure Supabase CLI is installed
if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
  Write-Host "Supabase CLI not found — installing via Scoop..." -ForegroundColor Cyan
  if (-not (Get-Command scoop -ErrorAction SilentlyContinue)) {
    Set-ExecutionPolicy -Scope CurrentUser RemoteSigned -Force
    Invoke-RestMethod -Uri https://get.scoop.sh | Invoke-Expression
  }
  scoop bucket add supabase https://github.com/supabase/scoop-bucket.git 2>$null
  scoop install supabase
} else {
  Write-Host "Supabase CLI found." -ForegroundColor Green
}

# 2. Log in (opens a browser once)
Write-Host "`nLogging in to Supabase (a browser will open)..." -ForegroundColor Cyan
supabase login

# 3. Link this project
Write-Host "`nLinking project $ProjectRef ..." -ForegroundColor Cyan
Push-Location (Split-Path $PSScriptRoot -Parent)   # project root (parent of /supabase)
supabase link --project-ref $ProjectRef

# 4. Ask for the Gemini API key (must start with AIza)
Write-Host ""
$gem = Read-Host "Paste your Gemini API key (starts with AIza...)"
if ($gem -notmatch '^AIza') {
  Write-Host "That doesn't look like a Gemini key (should start with AIza...). Get one at https://aistudio.google.com/apikey" -ForegroundColor Red
  Pop-Location; exit 1
}
supabase secrets set GEMINI_API_KEY=$gem

# Optional: alarm emails (press Enter to skip)
$resend = Read-Host "Optional — Resend API key for alarm emails (Enter to skip)"
if ($resend) { supabase secrets set RESEND_API_KEY=$resend }
$cron = Read-Host "Optional — a random secret for the daily cron (Enter to skip)"
if ($cron) { supabase secrets set CRON_SECRET=$cron }

# 5. Deploy the functions
Write-Host "`nDeploying Edge Functions..." -ForegroundColor Cyan
$funcs = @("assistant","gemini-receipt","gemini-generate","daily-alarms")
foreach ($f in $funcs) {
  if (Test-Path "supabase\functions\$f\index.ts") {
    Write-Host "  → $f" -ForegroundColor Yellow
    supabase functions deploy $f
  }
}

Pop-Location
Write-Host "`n✓ Done. Refresh the hub — the AI Daily Briefing should fill in." -ForegroundColor Green
Write-Host "  If the chat/briefing still says 'not connected', check: Supabase → Edge Functions → assistant → Logs.`n"
