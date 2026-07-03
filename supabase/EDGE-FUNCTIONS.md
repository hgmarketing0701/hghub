# HG — Edge Functions deploy guide

Three functions replace the server-only parts of the old Apps Script tools:

| Function | Replaces | Used by |
|---|---|---|
| `gemini-receipt` | Gemini receipt-photo reading (server-side key) | Claims, Expenses |
| `gemini-generate` | Gemini text generation | Blog / LinkedIn |
| `daily-alarms` | Every time-trigger email (permit warnings, doc expiry digest, collection reminders, renewal notices) | Dispatch, Workers, Scaffold, Storage |

All three check the caller is signed in AND on `allowed_users` (the scheduler
uses a `CRON_SECRET` header instead).

---

## 1 · One-time setup (10 min)

**Install the Supabase CLI** (PowerShell):
```powershell
scoop install supabase
# or:  npm install -g supabase
```

**Login + link the project** (run inside this project folder):
```powershell
supabase login
supabase link --project-ref fwenyafmfcpecerywfex
```

**Set the secrets:**
```powershell
# Gemini key: https://aistudio.google.com/apikey  (free tier is fine)
supabase secrets set GEMINI_API_KEY=YOUR_GEMINI_KEY

# Resend key: https://resend.com (free tier 100 emails/day) — for daily-alarms
supabase secrets set RESEND_API_KEY=YOUR_RESEND_KEY

# any random long string — protects the cron endpoint
supabase secrets set CRON_SECRET=some-long-random-string
```

## 2 · Deploy
```powershell
supabase functions deploy gemini-receipt
supabase functions deploy gemini-generate
supabase functions deploy daily-alarms
```

## 3 · Schedule the daily alarm digest (8:00 AM MYT daily)
Supabase Dashboard → **SQL Editor** → run (replace the two placeholders):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'hg-daily-alarms',
  '0 0 * * *',   -- 00:00 UTC = 08:00 Asia/Kuala_Lumpur
  $$
  select net.http_post(
    url     := 'https://fwenyafmfcpecerywfex.supabase.co/functions/v1/daily-alarms',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'some-long-random-string'
    ),
    body    := '{}'::jsonb
  );
  $$
);
```

## 4 · Recipients
The digest goes to `app_settings` key **`ALARM_EMAIL_TO`**
(comma-separated emails; falls back to `COMPANY_EMAIL`). Set it in any
tool's Settings tab or directly in the table.

## Notes
- Until `RESEND_API_KEY` is set, `daily-alarms` still runs and returns the digest
  as JSON (`preview` field) without sending — tools can show it in-app.
- Resend free tier sends from `onboarding@resend.dev`. To send from
  `alerts@hggroup.com.my`, verify the domain in Resend and set
  `app_settings.ALARM_EMAIL_FROM`.
- Function logs: Dashboard → Edge Functions → (function) → Logs.
