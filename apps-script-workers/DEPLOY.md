# Deployment guide — Workers Documentation (Cloud v1)

Estimated time: **30–45 minutes** (same pattern as the Inventory backend you already deployed).

You will deploy a Google Apps Script web app that:
- Is restricted to `@hggroup.com.my` Google Workspace accounts
- Uses one Google Sheet as its database (14 tabs)
- Auto-logs every save/edit/delete with the user's email and timestamp
- Sends a weekly email digest of expired + soon-to-expire documents AND work permits
- Stores issued mall / building work permits with worker linkage, so the site team can retrieve the PDF onsite

---

## What you need before starting

1. A Google account on the `@hggroup.com.my` Workspace.
2. Sign in to that account in your browser. Sign out of any personal Google accounts first to avoid confusion, or use a separate Chrome profile.
3. A Google Drive folder for worker document scans. Recommended: create one folder **`Workers — Documents`** at the root of your Workspace Drive, then a sub-folder per worker. Share the parent folder with **anyone at hggroup.com.my (Viewer)** so colleagues opening links don't get blocked.

---

## Step 1 — Create the Google Sheet (the database)

1. Go to <https://sheets.google.com> while signed in as your `@hggroup.com.my` account.
2. Click **Blank** to create a new sheet.
3. Rename it: **`Black Lee — Workers DB`**.
4. Leave it empty. The script will auto-create the 14 tabs (Divisions, Workers, Documents, WorkPermits, WorkPermitWorkers, WorkPermitAttachments, PermitForms, InsurancePolicies, InsurancePolicyAttachments, InsurancePolicyQuotes, InsurancePolicyPayments, ReportHistory, Config, AuditLog) on first run.

---

## Step 2 — Open Apps Script

1. In the new sheet, top menu: **Extensions → Apps Script**.
2. A new tab opens, titled "Untitled project". Rename it to **`Workers Backend`** (top-left).

---

## Step 3 — Paste `Code.gs`

1. In the left sidebar of Apps Script, you'll see one file called `Code.gs`. Click it.
2. Select everything in the editor (`Ctrl+A`) and delete it.
3. Open this file from your computer:
   `apps-script-workers/Code.gs`
4. Copy its **entire contents**, paste into the editor.
5. Press `Ctrl+S` to save.

---

## Step 4 — Add `Index.html`

1. In the Apps Script left sidebar, click the **`+`** next to "Files" → **HTML**.
2. Name it exactly: **`Index`** (no `.html` suffix — Apps Script adds it).
3. The new `Index.html` opens in the editor. Select everything (`Ctrl+A`) and delete the placeholder.
4. Open this file from your computer:
   `apps-script-workers/Index.html`
5. Copy its **entire contents**, paste into the editor.
6. Press `Ctrl+S` to save.

---

## Step 5 — Set the project manifest

1. In Apps Script, click the ⚙️ gear icon (**Project Settings**) on the left sidebar.
2. Tick the checkbox: **"Show 'appsscript.json' manifest file in editor"**.
3. Go back to the editor (left sidebar). You'll now see `appsscript.json`.
4. Click it. Select everything, delete it.
5. Open this file from your computer:
   `apps-script-workers/appsscript.json`
6. Copy its contents, paste in. Press `Ctrl+S` to save.

The important lines:
```json
"webapp": {
  "executeAs": "USER_DEPLOYING",
  "access": "DOMAIN"
}
```
- `USER_DEPLOYING` = the script runs as you (the owner). Staff still get identified via `Session.getActiveUser()` because they're on the same Workspace domain — that's what fills the AuditLog.
- `DOMAIN` = only `@hggroup.com.my` Workspace users can open it.

There are also extra scopes vs the inventory app: `script.send_mail` (for the weekly digest), `script.scriptapp` (for installing the time-driven trigger), and `drive` (full Drive access — needed to **upload files directly from the tool** into a `Workers Documentation — Uploads` folder, plus read existing files for the Full Pack PDF builder).

---

## Step 6 — First-run authorization

1. Open `Code.gs` again.
2. In the function dropdown at the top of the editor (next to **Debug**), select **`getAllData`**.
3. Click **Run**.
4. Google will show "Authorization required" → click **Review permissions**.
5. Pick your `@hggroup.com.my` account.
6. You may see "Google hasn't verified this app" → click **Advanced → Go to Workers Backend (unsafe)**. This is normal for internal scripts.
7. Click **Allow**. (Read the scopes: Sheets, send email as you, manage triggers — these match what the app needs.)
8. After it runs (a few seconds), switch back to your Sheet tab and you should see 8 new tabs at the bottom: **Divisions, Workers, Documents, WorkPermits, WorkPermitWorkers, WorkPermitAttachments, PermitForms, InsurancePolicies, InsurancePolicyAttachments, InsurancePolicyQuotes, InsurancePolicyPayments, ReportHistory, Config, AuditLog**.
9. Open the **Config** tab — it should already have 3 seeded rows:
   - `emailRecipients` → `blacklee@hggroup.com.my` (change this if you want the digest sent to multiple people — comma-separate them)
   - `expiringSoonDays` → `30`
   - `expiringWarnDays` → `90`

✅ Backend is now set up.

---

## Step 7 — Deploy as a Web App

1. In Apps Script, top-right: **Deploy → New deployment**.
2. Click the ⚙️ gear next to "Select type" → choose **Web app**.
3. Fill in:
   - **Description**: `v1 — initial release`
   - **Execute as**: `Me (your-email@hggroup.com.my)` ← **important**: NOT "User accessing the web app", because staff don't have direct access to the bound Google Sheet. Script runs as you (the owner); staff identity is still captured via `Session.getActiveUser()` for the audit log because everyone is on the same Workspace domain.
   - **Who has access**: `Anyone within hggroup.com.my`
4. Click **Deploy**.
5. Apps Script shows two URLs:
   - **Web app URL** ← this is the one to share
   - **Deployment ID**
6. **Copy the Web app URL.** Save it somewhere (paste it into a note or doc).

The URL will look like:
`https://script.google.com/a/macros/hggroup.com.my/s/AKfycb.../exec`

---

## Step 8 — Install the weekly email digest trigger

1. Back in Apps Script, open `Code.gs`.
2. In the function dropdown, select **`installWeeklyTrigger`**.
3. Click **Run**. Approve the additional permission prompt if it appears.
4. The function returns silently — verify it worked by selecting **`listTriggers`** in the dropdown and clicking **Run**, then check **Executions** (left sidebar, clock icon). You should see one trigger for `sendExpiryDigest`.
5. To test the email immediately, select **`sendExpiryDigest`** and click **Run**. Check your inbox.

The trigger fires every Monday at 07:00 Asia/Kuala_Lumpur. To change time or frequency, edit `installWeeklyTrigger` in `Code.gs` and re-run it (it auto-cleans the old trigger first).

To change who gets the email: edit the `emailRecipients` row on the **Config** sheet — comma-separated. No redeploy needed.

---

## Step 9 — Smoke test (you, alone)

1. Open the Web app URL in your browser.
2. You should see the Workers UI with **"👤 your-name@hggroup.com.my"** in the top-right.
3. **Divisions tab** → `+ Add Division` → add three: `Hoarding`, `Visual Print`, `Fit-Out`.
4. **Workers tab** → `+ Add Worker` → add **Worker A** under `Hoarding`. Save.
5. Click Worker A's row to open detail → `+ Add Document` → add a `Passport` with expiry `2027-12-31`. Save.
6. Add a second worker **Worker B** under `Fit-Out` with an expired `Passport` (e.g. expiry `2026-03-01`).
7. Add a third worker **Worker C** under `Visual Print` with a `Mall EHS Card` expiring 15 days from today.
8. **Dashboard tab** → confirm: 1 expired, 1 expiring within 30 days, the "Action needed" table lists Worker B and Worker C with the right badges.
9. **Generate Report tab**:
   - Step 1: tick `Hoarding` + `Fit-Out`
   - Step 2: leave all workers ticked
   - Step 3: tick only `Passport · IC · CIDB Green Card · Mall EHS Card`
   - Step 4: leave on `Checklist`
   - Step 5: project name `TEST`, mall `Pavilion KL`, date today
   - Click **Generate report** → browser print preview opens → save as PDF.
   - Verify columns match your selection, expired Passport shows red ✗, valid shows green ✓.
10. Switch Step 4 to **Full pack with images** → Generate → a PDF should download (one page per worker with embedded doc images from Drive).
11. **Work Permits tab** → `+ Add Permit`:
    - Project title: `Hoarding installation — Lot G-12, Level 2`
    - Mall: `Pavilion KL`
    - Client: `ABC Sdn Bhd`
    - Source: `Applied by us`
    - Valid from today, valid until +30 days
    - Drive URL: any PDF you have in Drive (for testing)
    - Workers picker: tick Worker A and Worker C → Save
12. Confirm: Dashboard shows 1 active permit. Workers tab → click Worker A → Worker Detail modal shows the permit under "🛂 Active work permits" with an Open PDF button. Click the title bar of the permit on the Work Permits tab → detail modal shows the workers covered + Open PDF.
13. **Form Library tab** → `+ Add Form`:
    - Mall: `Pavilion KL`
    - Form name: `Hot Work Permit Application`
    - Form type: `Hot Work Permit`
    - Version: `v2025`
    - Last verified: today
    - Drive URL: any blank PDF in your Drive (testing)
    - Contact: `ops@pavilion.com.my`
    - Lead time: `3 working days`
    - Required: `CIDB green card copy, workers list, work scope letter`
    - Save → form appears grouped under "🏬 Pavilion KL" with a Download blank form button.
14. **Go back to the Google Sheet** → check the **AuditLog** tab → you should see entries for every save AND an `EXPORT` row for each report generation. ← this is your audit trail.

If all of the above works: ✅ ready for HR.

---

## Step 10 — Share with HR / admin staff

The Web app URL is the **only thing you give to staff**. They open it, sign in with their `@hggroup.com.my` account, and use it. Three ways to share:

1. **WhatsApp the URL** to the HR team (matches your existing comms style).
2. **Bookmark it** on their phone/tablet home screen — it works like an app.
3. **Add it to operations.html** — see Step 11.

❗ **Important security notes:**
- Anyone outside `@hggroup.com.my` who opens the URL gets blocked. You do not need a password.
- Staff who sign in with a personal Gmail will see "Access denied". They must use their company account.
- If you fire a staff member, **revoke their Workspace account** in the Google Admin console — they instantly lose access to this tool too.
- Worker IC / passport / visa numbers are stored in the Sheet. Only people with access to the bound Sheet (you, the owner) and people with `@hggroup.com.my` accounts who use the tool can see them. Treat the URL as semi-sensitive.

---

## Step 11 — Wire the cloud app into operations.html

Open `operations.html` in a text editor and find this line:

```html
<div class="tile" onclick="window.open('PASTE-WORKERS-URL-HERE','_blank')">
```

Replace `PASTE-WORKERS-URL-HERE` with your Web app URL from Step 7.

Then your HR staff can click the **Workers Documentation** tile from operations.html to launch it.

---

## How file storage works (Google Drive)

The tool stores **only the URL** to each document scan — the files themselves stay in your Drive.

Recommended workflow for HR:
1. Get the physical document (passport, EHS card, etc.) from the worker.
2. Take a clear photo / scan it.
3. Upload to the worker's sub-folder in **`Workers — Documents`** on Drive.
4. Right-click the file → **Share → Copy link** (make sure the folder is shared with anyone at `@hggroup.com.my` — Viewer access).
5. Paste the link into the document form in the Workers tool.

The tool generates thumbnail previews using `https://drive.google.com/thumbnail?id=…` — this works as long as the file is viewable by the user opening it (i.e. the file is shared with the company Workspace).

---

## Updating the code later

When I send you a new version of `Code.gs` or `Index.html`:

1. Open Apps Script for this project.
2. Paste the new code into the relevant file. Save (`Ctrl+S`).
3. **Deploy → Manage deployments** → click the ✏️ pencil on your live deployment.
4. Change **Version** dropdown to **New version**.
5. Add a description (e.g. `v2 — added bulk import`).
6. Click **Deploy**.
7. The URL stays the same — staff don't need to do anything.

---

## What's NOT in v1 (planned for v2)

- **Direct file upload to Drive from the tool**. Today HR uploads to Drive separately and pastes the URL. v2 will upload directly via the Drive API.
- **Bulk import from CSV / existing spreadsheet**. Today add workers one at a time via the form.
- **WhatsApp / WATI push of expiry alerts**. Today: email only. v2 will optionally push to a WhatsApp group via your WATI account.
- **Worker self-service portal** (workers viewing their own docs / uploading new scans).
- **Integration with Odoo HR** — wait until the Odoo migration is further along.

---

## Troubleshooting

**"Access denied. Only @hggroup.com.my accounts allowed."**
You're signed in to a non-Workspace Google account. Switch accounts in the top-right of the browser.

**Loading… spins forever**
- Open browser DevTools (`F12`) → Console → check for errors.
- Confirm you ran `getAllData` once from the Apps Script editor to authorise the script.

**Photo / document thumbnail won't load**
- The Drive file isn't shared with the user opening it. Open the file in Drive → Share → make sure visibility includes `@hggroup.com.my`.
- The link is for a non-image file (e.g. a PDF). Thumbnails work best for JPG / PNG. For PDFs, the "Open file" button takes the user to Drive directly.

**Weekly digest email didn't arrive on Monday**
- In Apps Script → left sidebar → **Triggers** (clock icon). Confirm `sendExpiryDigest` is listed and weekly.
- Check **Executions** for errors.
- Verify the `emailRecipients` row on the Config sheet is spelled correctly.
- Run `sendExpiryDigest` manually from the editor to confirm the function itself works.

**I want to wipe everything and start fresh**
Open Apps Script → `Code.gs` → run `_resetAllSheets_DANGER`. This deletes and recreates all 5 sheets. **Audit log is also wiped — only use during initial testing.**

**Staff sees "You do not have permission to access the requested document"**
- Cause: deployment is set to `Execute as: User accessing the web app`, but staff don't have access to the bound Google Sheet.
- Fix: Deploy → Manage deployments → ✏️ pencil → change **Execute as** to **`Me (your-email@hggroup.com.my)`** → Version: New version → Deploy. URL stays the same. Staff refreshes the page.
