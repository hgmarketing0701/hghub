# Deployment guide — Inventory & Purchasing (Cloud v1)

Estimated time: **30–45 minutes**.

You will deploy a Google Apps Script web app that:
- Is restricted to `@hggroup.com.my` Google Workspace accounts
- Uses one Google Sheet as its database (7 tabs)
- Auto-logs every save/edit/delete with the user's email and timestamp

---

## What you need before starting

1. A Google account on the `@hggroup.com.my` Workspace.
2. Sign in to that account in your browser. Sign out of any personal Google accounts first to avoid confusion, or use a separate Chrome profile.

---

## Step 1 — Create the Google Sheet (the database)

1. Go to <https://sheets.google.com> while signed in as your `@hggroup.com.my` account.
2. Click **Blank** to create a new sheet.
3. Rename it: **`Black Lee — Inventory DB`**.
4. Leave it empty. The script will auto-create the tabs (Materials, Suppliers, Purchases, PurchaseLines, StockOuts, StockOutLines, AuditLog) on first run.

---

## Step 2 — Open Apps Script

1. In the new sheet, top menu: **Extensions → Apps Script**.
2. A new tab opens, titled "Untitled project". Rename it to **`Inventory Backend`** (top-left).

---

## Step 3 — Paste `Code.gs`

1. In the left sidebar of Apps Script, you'll see one file called `Code.gs`. Click it.
2. Select everything in the editor (`Ctrl+A`) and delete it.
3. Open this file from your computer:
   `apps-script/Code.gs`
4. Copy its **entire contents**, paste into the editor.
5. Press `Ctrl+S` to save.

---

## Step 4 — Add `Index.html`

1. In the Apps Script left sidebar, click the **`+`** next to "Files" → **HTML**.
2. Name it exactly: **`Index`** (no `.html` suffix — Apps Script adds it).
3. The new `Index.html` opens in the editor. Select everything (`Ctrl+A`) and delete the placeholder.
4. Open this file from your computer:
   `apps-script/Index.html`
5. Copy its **entire contents**, paste into the editor.
6. Press `Ctrl+S` to save.

---

## Step 5 — Set the project manifest

1. In Apps Script, click the ⚙️ gear icon (**Project Settings**) on the left sidebar.
2. Tick the checkbox: **"Show 'appsscript.json' manifest file in editor"**.
3. Go back to the editor (left sidebar). You'll now see `appsscript.json`.
4. Click it. Select everything, delete it.
5. Open this file from your computer:
   `apps-script/appsscript.json`
6. Copy its contents, paste in. Press `Ctrl+S` to save.

The important lines:
```json
"webapp": {
  "executeAs": "USER_ACCESSING",
  "access": "DOMAIN"
}
```
- `USER_ACCESSING` = the script runs as whoever is logged in (so we know who they are)
- `DOMAIN` = only `@hggroup.com.my` Workspace users can open it

---

## Step 6 — First-run authorization

1. Open `Code.gs` again.
2. In the function dropdown at the top of the editor (next to **Debug**), select **`getAllData`**.
   *(Note: helper functions like `ensureSheets_` end with an underscore and are hidden from this dropdown by design — that's a private-function convention in Apps Script. Running `getAllData` triggers the same setup.)*
3. Click **Run**.
4. Google will show "Authorization required" → click **Review permissions**.
5. Pick your `@hggroup.com.my` account.
6. You may see "Google hasn't verified this app" → click **Advanced → Go to Inventory Backend (unsafe)**. This is normal for internal scripts.
7. Click **Allow**.
8. After it runs (a few seconds), switch back to your Sheet tab and you should see 7 new tabs at the bottom: Materials, Suppliers, Purchases, PurchaseLines, StockOuts, StockOutLines, AuditLog.

✅ Backend is now set up.

---

## Step 7 — Deploy as a Web App

1. In Apps Script, top-right: **Deploy → New deployment**.
2. Click the ⚙️ gear next to "Select type" → choose **Web app**.
3. Fill in:
   - **Description**: `v1 — initial release`
   - **Execute as**: `Me (your-email@hggroup.com.my)` ← **important**: NOT "User accessing the web app", because staff don't have direct access to the bound Google Sheet. Script runs as you (the owner); staff identity is still captured via `Session.getActiveUser()` for the audit log because everyone is on the same Workspace domain.
   - **Who has access**: `Anyone within hggroup.com.my` *(this is the option that appears because your account is on that Workspace)*
4. Click **Deploy**.
5. Apps Script shows two URLs:
   - **Web app URL** ← this is the one to share
   - **Deployment ID**
6. **Copy the Web app URL.** Save it somewhere (paste it into a note or doc).

The URL will look like:
`https://script.google.com/a/macros/hggroup.com.my/s/AKfycb.../exec`

---

## Step 8 — Smoke test (you, alone)

1. Open the Web app URL in your browser.
2. You should see the inventory UI with **"👤 your-name@hggroup.com.my"** in the top-right.
3. **Materials tab** → add: `Hoarding PVC` (m²), `Sliding door` (set).
4. **Suppliers tab** → add: `Supplier A Sdn Bhd`.
5. **Stock IN** → date today, supplier A, DO# `TEST-001`, add 1 line: Hoarding PVC, qty 100, rate 15, division Hoarding. Save.
6. **Dashboard** → confirm 100 m² Hoarding PVC, value RM 1,500.
7. **Stock OUT** → date today, division Fit-out, 1 line: Hoarding PVC, qty 30. Save → DN modal opens with DN# like `DN-20260518-001`.
8. **Dashboard** → confirm 70 m² on hand.
9. **Go back to the Google Sheet** → check the **AuditLog** tab → you should see entries for every save with your email and timestamp. ← this is your audit trail.

If all of the above works: ✅ ready for staff.

---

## Step 9 — Share with staff

The Web app URL is the **only thing you give to staff**. They open it, sign in with their `@hggroup.com.my` account, and use it. Three ways to share:

1. **WhatsApp the URL** to the team (matches your existing comms style).
2. **Bookmark it** on their phone/tablet home screen — it works like an app.
3. **Add it to operations.html** — see Step 10.

❗ **Important security notes:**
- Anyone outside `@hggroup.com.my` who opens the URL gets blocked. You do not need a password.
- Staff who sign in with a personal Gmail will see "Access denied". They must use their company account.
- If you fire a staff member, **revoke their Workspace account** in the Google Admin console — they instantly lose access to this tool too.

---

## Step 10 — Wire the cloud app into operations.html

After deployment, open `operations.html` in a text editor and find this line:

```html
<div class="tile" onclick="window.open('PASTE-CLOUD-URL-HERE','_blank')">
```

Replace `PASTE-CLOUD-URL-HERE` with your Web app URL from Step 7.

Then any of your staff can click tile **#16 Inventory (Cloud)** from operations.html to launch it.

---

## Updating the code later

When I send you a new version of `Code.gs` or `Index.html`:

1. Open Apps Script for this project.
2. Paste the new code into the relevant file. Save (`Ctrl+S`).
3. **Deploy → Manage deployments** → click the ✏️ pencil on your live deployment.
4. Change **Version** dropdown to **New version**.
5. Add a description (e.g. `v2 — added Drive photos`).
6. Click **Deploy**.
7. The URL stays the same — staff don't need to do anything.

---

## What's NOT in v1 (planned for v2)

- **Photos** (material reference, DO copies, delivery, collection). Reason: Google Sheets cells have a 50,000-char limit which compressed photos sometimes exceed. v2 will store photos in a Drive folder shared with `@hggroup.com.my` and put only the Drive URL in the Sheet.
- **Edit purchase/DN after save**. Today you can only delete and re-create. v2 will allow editing existing line items.
- **CSV export from the cloud UI**. For now, you can export directly from the Google Sheet (`File → Download → CSV`).
- **Role-based permissions** (e.g. only some staff can delete). v2 if needed.

---

## Troubleshooting

**"Access denied. Only @hggroup.com.my accounts allowed."**
You're signed in to a non-Workspace Google account. Switch accounts in the top-right of the browser.

**Loading… spins forever**
- Open browser DevTools (`F12`) → Console → check for errors.

**Staff sees "You do not have permission to access the requested document" (line 76 in Code)**
- Cause: deployment is set to `Execute as: User accessing the web app`, but staff don't have access to the bound Google Sheet.
- Fix: Deploy → Manage deployments → ✏️ pencil → change **Execute as** to **`Me (your-email@hggroup.com.my)`** → Version: New version → Deploy. URL stays the same. Staff refreshes the page.

**DN# duplicated**
Should not happen — the backend uses `LockService` to serialise DN# generation. If you see one, take a screenshot and let me know.

**Stock count looks wrong**
Click **↻ Refresh** on the Dashboard. The UI reads from the Sheet on load and after each save; refresh forces a re-read.

**I want to wipe everything and start fresh**
Open Apps Script → `Code.gs` → run `_resetAllSheets_DANGER`. This deletes and recreates all 7 sheets. **Audit log is also wiped — only use during initial testing.**
