# Deployment guide — Daily Job Readiness & Dispatch (Cloud v1)

Estimated time: **30–40 minutes** — same pattern as the Inventory and Workers backends you already deployed.

You will deploy a Google Apps Script web app that:
- Is restricted to `@hggroup.com.my` Google Workspace accounts
- Uses one Google Sheet as its database (6 tabs)
- Auto-logs every save / edit / delete / assign with the user's email + timestamp
- Sends a **daily morning email** of permit alarms + at-risk + blocked jobs
- Replaces Eason's manual Excel: a **Readiness board** (the checking) + a **Dispatch board** (Calvin's 6–7pm team message)

---

## Who uses what

- **Eason** → *Readiness* tab. Inserts each confirmed job, ticks the gates green, watches the permit alarms.
- **Calvin** → *Dispatch* tab. Picks the night, drops ready jobs into teams, sets each crew, taps **Generate WhatsApp message** → pastes into the HG Operation group.
- **Both** see the same live board. The *Activity* tab is the who-did-what trail.

---

## Step 1 — Create the Google Sheet (the database)

1. Go to <https://sheets.google.com> signed in as your `@hggroup.com.my` account.
2. Click **Blank**.
3. Rename it: **`Black Lee — Dispatch DB`**.
4. Leave it empty. The script auto-creates the 6 tabs on first run (Jobs, Teams, Staff, Lorries, Config, AuditLog).

---

## Step 2 — Open Apps Script

1. In the new sheet: **Extensions → Apps Script**.
2. Rename the project (top-left) to **`Dispatch Backend`**.

---

## Step 3 — Paste `Code.gs`

1. Click `Code.gs` in the left sidebar. Select all (`Ctrl+A`), delete.
2. Open `apps-script-dispatch/Code.gs` from your computer, copy **everything**, paste in.
3. `Ctrl+S` to save.

---

## Step 4 — Add `Index.html`

1. Left sidebar: **`+` → HTML**. Name it exactly **`Index`** (no `.html`).
2. Select all, delete the placeholder.
3. Open `apps-script-dispatch/Index.html`, copy **everything**, paste in.
4. `Ctrl+S`.

---

## Step 5 — Set the manifest

1. Gear icon (**Project Settings**) → tick **"Show 'appsscript.json' manifest file in editor"**.
2. Back in the editor, open `appsscript.json`. Select all, delete.
3. Open `apps-script-dispatch/appsscript.json`, copy, paste. `Ctrl+S`.

Key lines:
```json
"webapp": { "executeAs": "USER_DEPLOYING", "access": "DOMAIN" }
```
- `USER_DEPLOYING` = the script runs as you (the owner). Staff are still identified via `Session.getActiveUser()` for the audit log because they're on the same Workspace domain.
- `DOMAIN` = only `@hggroup.com.my` users can open it.

Scopes vs the Inventory app: this one adds `script.send_mail` (daily email) and `script.scriptapp` (installing the daily trigger). **No Drive scope** — sketch / visual / permit copies are stored as **Drive links you paste**, same as the Workers form library.

---

## Step 6 — First-run authorization

1. Open `Code.gs`. In the function dropdown (next to **Debug**), select **`getAllData`**. Click **Run**.
2. "Authorization required" → **Review permissions** → pick your `@hggroup.com.my` account.
3. "Google hasn't verified this app" → **Advanced → Go to Dispatch Backend (unsafe)**. Normal for internal scripts.
4. **Allow**. (Scopes: Sheets, send email as you, manage triggers.)
5. Switch back to the Sheet — you should see 6 new tabs: **Jobs, Teams, Staff, Lorries, Config, AuditLog**.
6. Open **Config** — 6 seeded rows:
   - `permitLeadDays` → `3` (working days a permit needs before install → drives the alarm)
   - `atRiskDays` → `3`
   - `maxTeams` → `12`
   - `maxJobsPerTeam` → `5`
   - `maxWorkersPerTeam` → `5`
   - `emailRecipients` → `blacklee@hggroup.com.my` (comma-separate for more people)

You can also change these later in the app's **Settings** tab — no redeploy needed.

✅ Backend set up.

---

## Step 7 — (Optional) load sample data to see it working

1. In `Code.gs`, function dropdown → **`_seedSampleData_`** → **Run**.
2. This adds 3 drivers, ~6 workers, 3 lorries, and 3 jobs in different states (one Ready, one At-risk with a permit alarm, one Blocked). Good for the smoke test below.
3. To wipe it later before going live: run **`_resetAllSheets_DANGER`** (this also clears the audit log — only during testing).

---

## Step 8 — Deploy as a Web App

1. Top-right: **Deploy → New deployment**.
2. Gear next to "Select type" → **Web app**.
3. Fill in:
   - **Description**: `v1 — initial release`
   - **Execute as**: `Me (your-email@hggroup.com.my)` ← important. NOT "User accessing the web app" (staff don't have access to the bound Sheet).
   - **Who has access**: `Anyone within hggroup.com.my`
4. **Deploy** → copy the **Web app URL** (looks like `https://script.google.com/a/macros/hggroup.com.my/s/.../exec`). Save it.

---

## Step 9 — Install the daily email trigger

1. In `Code.gs`, function dropdown → **`installDailyTrigger`** → **Run**. Approve any extra permission prompt.
2. Verify: select **`listTriggers`** → **Run** → check **Executions** (clock icon, left sidebar). You should see one trigger for `sendDailyDispatchDigest`.
3. Test the email now: select **`sendDailyDispatchDigest`** → **Run** → check your inbox.

Fires daily ~07:30 Asia/Kuala_Lumpur. To change recipients, edit the `emailRecipients` row on the Config sheet **or** the Settings tab — no redeploy. To change the time, edit `installDailyTrigger` and re-run it (it auto-cleans the old trigger).

---

## Step 10 — Smoke test (you, alone)

1. Open the Web app URL. You should see the board with **"👤 your-name@hggroup.com.my"** top-right.
2. **Readiness tab** → `+ Add Job`:
   - Client `ABC Sdn Bhd`, Mall `Mid Valley`, Lot `L2-15`, Job type `Installation`, Scope `12m hoarding`, Door `Swing door`, Install night = **tomorrow**.
   - Set Measurement = `Sketch done`, Quotation = `Confirmed`, Visual needed = `No`, Permit responsibility = `We apply`, Permit status = `Pending`, Material ready = `No`.
   - Watch the preview at the top of the form turn from **blocked/at-risk** as you flip gates. Save.
3. The job card should be **AMBER (at risk)** with a 🚨 **permit alarm** (install tomorrow, permit not approved) and "Missing: Permit, Material / fab".
4. Edit the job → set Permit status = `Approved`, Material ready = `Yes`. Save → card turns **GREEN (ready)**, alarm clears.
5. **Crew & Lorries tab** → add a driver (e.g. `Ah Hock`), 3 workers, 1 lorry (`WA 1234 B`).
6. **Dispatch tab** → set **Install night** = tomorrow.
   - The green job shows in **Ready to assign** → set its dropdown to **Team 1**.
   - Click **+ Set up team crew** → Team 1 → pick driver `Ah Hock`, click the worker chips to add workers, pick the lorry → **Save crew**.
   - Team 1 card now shows the crew + the job, counted `1 / 5`.
   - Click **Generate WhatsApp message** → a clean text block appears → **Copy**. Paste into a notepad to confirm the format.
7. **Activity tab** → confirm every action you took is logged with your email + time. ← this is your audit trail.
8. Add a second job with Install night **8 days out** and most gates unset → it shows **RED (blocked)** but no alarm (too far away). Confirms the at-risk window works.

If all of that works: ✅ ready for Eason and Calvin.

---

## Step 11 — Share with Eason & Calvin

The Web app URL is the **only thing you give them**. They open it, sign in with their `@hggroup.com.my` account, and use it.

1. **WhatsApp the URL** to Eason and Calvin.
2. Tell them to **bookmark / add to home screen** — it works like an app on phone or tablet.
3. **Add it to operations.html** — see Step 12.

❗ **Security notes**
- Anyone outside `@hggroup.com.my` who opens the URL gets blocked. No password needed.
- Personal Gmail = "Access denied". They must use the company account.
- If you fire a staff member, revoke their Workspace account in Google Admin → they instantly lose access here too.

---

## Step 12 — Wire into operations.html

`operations.html` already has a tile **#18. Daily Schedule & Dispatch** wired to `openDispatch()`.
The **first time** you click that tile it asks for this Web app URL and remembers it (in your browser).
To change it later: clear the `bl_dispatch_url` key in DevTools, or re-paste when prompted.

---

## How the readiness gates work

A job goes **GREEN (ready)** only when every required gate passes:

| Gate | Passes when |
|------|-------------|
| Lot / Mall | both filled in |
| Measurement sketch | `Sketch done` or `Not required` |
| Quotation | `Confirmed` or `Not required` |
| Permit | `Approved`, or responsibility `Already have` / `Not required` |
| Visual artwork | only checked if "Visual needed = Yes" → then must be `Approved` |
| Material / fab | `Yes` |

- 🟢 **Ready** — all gates pass → shows up in Calvin's dispatch pool.
- 🟡 **At risk** — not ready AND install date within the at-risk window (default 3 days).
- 🔴 **Blocked** — not ready and further out.
- 🚨 **Permit alarm** — permit not approved AND install within `permitLeadDays` (default 3). Floats to the top of the board and into the daily email. This is the "don't get scolded" feature.

---

## Updating the code later

When I send a new `Code.gs` / `Index.html`:
1. Paste into the relevant file in Apps Script. Save.
2. **Deploy → Manage deployments** → ✏️ pencil on the live deployment.
3. **Version** → **New version** → describe it → **Deploy**.
4. URL stays the same — staff do nothing.

---

## Troubleshooting

**"Access denied. Only @hggroup.com.my accounts allowed."**
You're on a non-Workspace Google account. Switch accounts top-right of the browser.

**Loading… spins forever**
- DevTools (`F12`) → Console → check errors.
- Confirm you ran `getAllData` once from the editor to authorise.

**Staff sees "You do not have permission to access the requested document"**
- Deployment is set to *Execute as: User accessing the web app*. Fix: Manage deployments → ✏️ → **Execute as: Me** → New version → Deploy. URL stays the same.

**Daily email didn't arrive**
- Apps Script → **Triggers** (clock icon) → confirm `sendDailyDispatchDigest` is listed daily.
- Check **Executions** for errors. Run `sendDailyDispatchDigest` manually to test.
- Verify `emailRecipients` on the Config sheet / Settings tab.

**I want to wipe everything and start fresh**
`Code.gs` → run `_resetAllSheets_DANGER`. Deletes + recreates all tabs. **Audit log is wiped too — testing only.**

---

## What's NOT in v1 (planned next)

- **WATI / WhatsApp auto-pull** — today Eason still types each job in from the group chats. v2 can read structured updates from your WhatsApp groups via WATI so the board fills itself.
- **Direct Drive upload** of sketches / permits from the tool (today: paste the Drive link, same as Workers Docs).
- **Drag-and-drop** team building (today: a Team dropdown per job — works on phone, no drag needed).
- **Link to the Workers Docs permits** so an approved mall permit auto-ticks the permit gate.
- **Odoo sync** — wait until the migration is further along.
