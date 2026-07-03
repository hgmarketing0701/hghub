# Deployment guide — Lorry Fleet (Cloud v1)

Estimated time: **30–45 minutes** (same flow as your inventory tool).

You will deploy a Google Apps Script web app that:
- Is restricted to `@hggroup.com.my` Google Workspace accounts
- Uses one Google Sheet as its database (5 tabs)
- Stores receipt + pump-display + vehicle card photos (and PDFs) in a Google Drive folder
- Auto-logs every save/edit/delete with the staff member's email and timestamp

---

## What you need before starting

1. A Google account on the `@hggroup.com.my` Workspace.
2. Sign in to that account in your browser. Sign out of personal Google accounts first, or use a separate Chrome profile.

---

## Step 1 — Create the Google Sheet (the database)

1. Go to <https://sheets.google.com> while signed in as `@hggroup.com.my`.
2. Click **Blank** to create a new sheet.
3. Rename it: **`Black Lee — Lorry Fleet DB`**.
4. Leave it empty. The script will auto-create the tabs (Lorries, FuelLogs, TollParkLogs, MaintLogs, AuditLog) on first run.

---

## Step 2 — Open Apps Script

1. In the new sheet: **Extensions → Apps Script**.
2. A new tab opens. Rename the project (top-left) to **`Lorry Fleet Backend`**.

---

## Step 3 — Paste `Code.gs`

1. Click `Code.gs` in the left sidebar.
2. Select all (`Ctrl+A`), delete the placeholder.
3. Open `apps-script-lorry/Code.gs` from your computer.
4. Copy its entire contents, paste into the editor.
5. Save (`Ctrl+S`).

---

## Step 4 — Add `Index.html`

1. Apps Script sidebar → **`+`** next to "Files" → **HTML**.
2. Name it exactly **`Index`** (no `.html` suffix — Apps Script adds it).
3. Select all of the placeholder, delete.
4. Open `apps-script-lorry/Index.html` from your computer.
5. Copy entire contents, paste, save.

---

## Step 5 — Set the project manifest

1. Apps Script left sidebar → ⚙️ **Project Settings**.
2. Tick: **"Show 'appsscript.json' manifest file in editor"**.
3. Back to the editor → click `appsscript.json`.
4. Select all, delete.
5. Open `apps-script-lorry/appsscript.json` from your computer.
6. Copy contents, paste, save.

The important lines:
```json
"webapp": {
  "executeAs": "USER_DEPLOYING",
  "access": "DOMAIN"
}
```
- `USER_DEPLOYING` = the script runs as **you** (so it can read/write your Sheet + Drive folder)
- `DOMAIN` = only `@hggroup.com.my` Workspace users can open the URL
- `Session.getActiveUser().getEmail()` still captures the staff member's identity for the audit log

The OAuth scopes include `drive` so the script can create the `Black Lee — Lorry Photos` folder at your Drive root on first upload and write photo/PDF files into it. In practice the script only ever touches that one folder (it stores the folder ID in Script Properties and reuses it), but Google's permission prompt will say "See, edit, create, and delete all of your Google Drive files" — that's the cost of `DriveApp.createFolder()`.

If a tighter scope is a hard requirement later, the alternative is: manually create a folder in Drive, set its ID via Script Properties (`PHOTO_FOLDER_ID`), and switch the scope to `drive.file`. Not needed for v1.

---

## Step 6 — First-run authorization

1. Open `Code.gs`.
2. Top of editor → function dropdown → select **`getAllData`** → click **Run**.
3. Google: "Authorization required" → **Review permissions**.
4. Choose your `@hggroup.com.my` account.
5. "Google hasn't verified this app" → **Advanced → Go to Lorry Fleet Backend (unsafe)**. Normal for internal scripts.
6. Allow.
7. After a few seconds, switch to the Sheet tab. You should see 5 new tabs at the bottom: `Lorries`, `FuelLogs`, `TollParkLogs`, `MaintLogs`, `AuditLog`.
8. Also check your Drive — a folder called **`Black Lee — Lorry Photos`** will be created the first time someone uploads a photo (not yet on this step).

✅ Backend wired.

---

## Step 7 — Deploy as a Web App

1. Apps Script top-right: **Deploy → New deployment**.
2. ⚙️ next to "Select type" → **Web app**.
3. Fill in:
   - **Description**: `v1 — initial release`
   - **Execute as**: `Me (your-email@hggroup.com.my)` ← **important**.
   - **Who has access**: `Anyone within hggroup.com.my`
4. **Deploy**.
5. Copy the **Web app URL**. It looks like:
   `https://script.google.com/a/macros/hggroup.com.my/s/AKfycb.../exec`

---

## Step 8 — Smoke test (you, alone)

1. Open the Web app URL in your browser.
2. Top-right shows **👤 your-name@hggroup.com.my** in green.
3. **Lorries tab** → + Add Lorry → fill Plate / Model / Year. Click **📎 Upload Vehicle Card** and attach a photo OR PDF of the geran (file is stored in Drive, linked to the lorry). Save.
4. Add another lorry: `WXY 1234`, Isuzu NPR 3-Ton, 2021, Active. Save.
4. **Fuel tab** → + Add Fuel Entry → today, WXY 1234, amount RM 130.50, station Petronas, paid Company Card. Snap a photo of any receipt with your phone (or pick an image file). Save.
5. **Toll & Parking** → + Add → today, WXY 1234, toll, RM 8.50, location "PLUS Sg Buloh → Bukit Lanjan", Touch n Go. Save.
6. **Maintenance** → + Add → today, WXY 1234, odo 125000, service, items "Engine oil", workshop Ah Hock, cost RM 380, next service 135000. Save.
7. **Dashboard** → confirm KPIs populated (Fuel RM 130.50 / Toll RM 8.50 / Maintenance RM 380.00).
8. Click the photo thumbnail in the Fuel row → lightbox opens. Click "Open in Drive ↗" → file opens in Drive in a new tab. ✅ Drive folder is created.
9. Back to the **Google Sheet** → check **AuditLog** tab. You should see 4 CREATE rows with your email and timestamps. ← this is your audit trail.

If all of the above works: ✅ ready for staff.

---

## Step 9 — Share with staff

The Web app URL is the only thing you give to staff. Three ways:

1. **WhatsApp the URL** to the team (matches your existing comms style).
2. **Bookmark it on their phone** — works like an app. Camera button opens the phone camera directly for receipt photos.
3. **Add it to operations.html** — see Step 10.

❗ **Security notes:**
- Anyone outside `@hggroup.com.my` who opens the URL gets blocked. No password needed.
- Staff signed in with a personal Gmail will see "Access denied" — they must use their company account.
- If you fire a staff member, **revoke their Workspace account** in Google Admin — they instantly lose access.
- The audit log records the staff member's email on every save, edit, and delete. They cannot turn this off from the UI.

---

## Step 10 — Wire the cloud app into operations.html

Open `operations.html` in a text editor. Either replace one of the placeholder tiles with a "Lorry Fleet (Cloud)" tile, or add a new tile, pointing at the Web app URL from Step 7:

```html
<div class="tile" onclick="window.open('PASTE-LORRY-URL-HERE','_blank')">
  <div class="tile-icon">🚚</div>
  <div class="tile-title">Lorry Fleet (Cloud)</div>
  <div class="tile-desc">Fuel, toll, parking, maintenance</div>
</div>
```

Replace `PASTE-LORRY-URL-HERE` with your Web app URL.

---

## What about the local `lorry.html` file?

You now have two tools:

| File | Where data lives | Who can use it | When to use |
|---|---|---|---|
| `lorry.html` (local) | localStorage on one device | 1 admin | Offline testing, single-admin scratchpad |
| Cloud Web App (this) | Google Sheet + Drive | Whole `@hggroup.com.my` team | **Production — for actual fleet tracking** |

The local file does **not** sync to the cloud. Anything you keyed there stays there. If you want to move it across, manually re-enter into the cloud app (only takes a few minutes — the data is small).

Recommended: archive `lorry.html` somewhere (or delete it) once the cloud version is live, so staff don't accidentally use it.

---

## Updating the code later

When I send you a new `Code.gs` or `Index.html`:

1. Open Apps Script for this project.
2. Paste the new code into the relevant file. Save.
3. **Deploy → Manage deployments** → ✏️ pencil on your live deployment.
4. **Version** dropdown → **New version**.
5. Add a description (e.g. `v2 — added cost-per-km`).
6. **Deploy**.
7. URL stays the same — staff don't need to do anything.

---

## What's NOT in v1 (planned for v2)

- **Cartrack integration** — auto-pull mileage from Cartrack via their API instead of typing odometer manually. Needs Cartrack API key.
- **Monthly auto-report email** to you on the 1st of each month.
- **Per-driver expense report** (which driver spent the most on tolls last month, etc.).
- **Service-due email alerts** when a lorry crosses the threshold.
- **Cost per km calc with date range** (currently lifetime only on local; cloud version skips it pending more odometer data).
- **Bulk import from existing spreadsheets** (CSV → Sheets).

---

## Troubleshooting

**"Access denied. Only @hggroup.com.my accounts allowed."**
You're signed in to a non-Workspace Google account. Switch accounts in the top-right of the browser.

**Loading… spins forever**
- Open DevTools (`F12`) → Console → check for errors.
- Common cause: deployment is set to `Execute as: User accessing the web app` — change to `Me (...)` per Step 7. Staff doesn't have direct access to the bound Sheet.

**"Authorization required" pop-up every time**
- Deployment is `Execute as: User accessing the web app` instead of `Me`. Fix in Manage deployments.

**Photo thumbnails show broken image**
- The photo folder's sharing setting was rejected by your Workspace admin. Two fixes:
  - **Option A (easier):** Ask your Workspace admin to allow `Sharing outside the domain via link → Off; within domain via link → On`.
  - **Option B (manual):** Open Drive → folder `Black Lee — Lorry Photos` → Share → set to `Anyone at hggroup.com.my with the link — Viewer`. New photos inherit the folder's setting.

**"Quota exceeded"**
- Google Apps Script has daily quotas: 6 hours total runtime, 50 MB/file upload via UrlFetch. We compress photos to ~80–150 KB so this should not hit. If it does, you're saving photos faster than the cap allows — wait 24 hours or split workload.

**A staff member made a mistake — how do I find who?**
- Open the Sheet → AuditLog tab. Filter by `recordId` or `userEmail` or date.

**I want to wipe the database and start fresh**
- Apps Script → `Code.gs` → run `_resetAllSheets_DANGER`. Deletes and recreates the 5 sheets. **Audit log is wiped too** — only use during initial testing.
- For photos: run `_trashAllPhotos_DANGER`. Photos go to Drive trash (recoverable for 30 days).

**Two staff edit the same record at the same time**
- Apps Script saves are atomic at the row level. Last write wins. The AuditLog shows both edits with timestamps so you can trace.

**Vehicle card PDF thumbnail not showing in the lorry list**
- Google Drive's thumbnail service can take 1–2 minutes to generate the preview for a freshly uploaded PDF. Refresh after a minute, or just click the thumbnail to open in Drive.

---

## Disk usage projections

- **Sheet rows**: ~200 bytes/row × 30 entries/day × 365 days = ~2 MB/year. Sheets cap is 10 million cells per file — won't hit for decades.
- **Drive photos**: ~100 KB/photo × 2 photos/day × 365 days = ~73 MB/year per lorry. 15 lorries → ~1 GB/year. Your Workspace plan should comfortably cover this. Photos in `Black Lee — Lorry Photos` are organised into monthly subfolders (`2026-05`, `2026-06`, etc.) for easy archival.
