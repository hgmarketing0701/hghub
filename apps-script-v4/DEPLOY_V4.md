# Deploy Inventory Backend v4.0

**This is a NEW deployment that runs alongside live v3.4c. Do NOT modify the v3.4c project.**

v4.0 adds drag/drop file uploads (images + PDF) on every photo field. To do that it needs Drive access. To stay safe — and avoid the auth-state breakage that wrecked v2.0/v2.1 — we use the **narrow `drive.file` scope** (script only sees files it creates) and you **manually create the upload folder** so the script never asks Drive for elevated permissions.

If anything breaks during v4.0 setup, your live v3.4c URL keeps working — staff can't tell the difference. Only switch them over once v4.0 passes the smoke test at the end of this doc.

---

## 1. Create a fresh Google Sheet + Apps Script project

1. Go to https://sheets.google.com → **Blank**.
2. Rename it: `Black Lee — Inventory DB v4`.
3. **Extensions → Apps Script.**
4. Rename the script project: `Inventory Backend v4`.
5. Delete the placeholder `function myFunction()` code.

> Optional: you can also import data later by copying rows from your v3.4c Sheet. Don't try to *share* the same Sheet between v3.4c and v4.0 backends — schema migrations could collide.

---

## 2. Create the upload folder in Drive (DO THIS MANUALLY)

1. Go to https://drive.google.com.
2. **+ New → Folder**, name it: `Inventory Uploads v4`.
3. Right-click the folder → **Share → Share**.
4. In the "Add people and groups" box, type: `hggroup.com.my`
5. Set permission: **Editor**.
6. Click **Send** (or **Share**).
7. Open the folder. Copy the **folder ID** from the URL:
   `https://drive.google.com/drive/folders/`**`THIS_PART_HERE`**

Keep that folder ID in your clipboard for step 4.

> Why manual? Auto-creating a folder from the script previously broke the project's auth state. Doing it yourself in the Drive UI is fully separated from the script's permissions.

---

## 3. Paste the three files

In the Apps Script editor:

### appsscript.json

1. Click the ⚙️ **Project Settings** (left sidebar).
2. Tick **"Show 'appsscript.json' manifest file in editor"**.
3. Back in the Editor, open `appsscript.json` and replace its contents with the file from `apps-script-v4/appsscript.json`.

### Code.gs

1. Open `Code.gs` in the editor.
2. Replace all contents with `apps-script-v4/Code.gs`.
3. **Save** (Ctrl+S / Cmd+S).

### Index.html

1. In the editor: **+ (Files) → HTML → name it `Index`**.
2. Replace its contents with `apps-script-v4/Index.html`.
3. **Save.**

---

## 4. Set the Script Property (tells the script which folder to upload to)

1. ⚙️ **Project Settings** (left sidebar).
2. Scroll to **Script properties**.
3. **Add script property**:
   - Property: `INVENTORY_DRIVE_FOLDER_ID`
   - Value: *(paste the folder ID from step 2)*
4. **Save script properties.**

---

## 5. First run — accept permissions

1. In the editor, look at the **Services** panel on the left sidebar. You should see **Drive** listed (it's auto-added by `appsscript.json`). If not: click the **+** next to Services, scroll to **Drive API**, click Add.
2. With `Code.gs` open, pick `pingServer` from the function dropdown next to the Run button.
3. Click **Run**.
4. **Review permissions** → choose your `@hggroup.com.my` account → **Allow**.
   - It will list: Google Sheets (current only), Drive (files this app creates), email address, locale, container UI.
   - This is the expected scope set.
5. Open **Execution log** (View → Logs, or Ctrl+Enter). You should see no error.

If you see an error containing "Drive folder not configured" — re-check the Script Property name is exactly `INVENTORY_DRIVE_FOLDER_ID`.

---

## 6. Self-test the upload (proves Drive write works BEFORE deploying)

1. Function dropdown → pick `_selfTestUpload` → **Run**.
2. Execution log should show: `Self-test result: {"ok":true,"url":"https://drive.google.com/...","id":"...","name":"...selftest.png","mimeType":"image/png"}`
3. Open the Drive folder you created in step 2 — you should see one tiny file named like `20260528-143012_yourname_selftest.png`. **Delete it** (it was just a test).

If the self-test fails:
- "Drive folder not configured" → step 4 not done.
- "Cannot open Drive folder ID" → the folder doesn't exist or isn't shared with your `@hggroup.com.my` account.
- Anything else → copy the message and read it carefully; it tells you exactly what's wrong.

**Do NOT proceed to step 7 unless step 6 passes.**

---

## 7. Deploy as web app

1. Top-right: **Deploy → New deployment**.
2. Type (gear icon): **Web app**.
3. Description: `v4.0 initial deploy`.
4. **Execute as: Me (you@hggroup.com.my)** — important; do NOT pick "User accessing".
5. **Who has access: Anyone within HG Group** (i.e. your Workspace domain).
6. **Deploy.**
7. Copy the **Web app URL**.

---

## 8. Update operations.html tile (optional — only when ready to switch users over)

While testing v4.0, you can keep v3.4c live for staff and only open v4.0 yourself.

When v4.0 is verified end-to-end, in `operations.html` tile 16 update the localStorage entry:

```js
localStorage.setItem('bl_cloud_inventory_url', 'PASTE_V4_URL_HERE');
```

Or update the field in the UI if you've added one.

The old v3.4c URL keeps working as a rollback if you ever need it.

---

## 9. End-to-end smoke test (in the browser, as a real user)

1. Open the v4.0 web app URL.
2. Header should read `Cloud v4.0` and show `Uploads: configured`.
3. **Materials → Add new material** → name `Test Hoarding PVC`, unit `m²`. **Drag a phone photo onto the drop zone.** Save. The thumbnail should appear in the Materials table.
4. **Stock IN → Add purchase**, pick supplier + line. **Drag a PDF onto the Invoice/DO drop zone**, drag 2 photos into the Delivery photos zone. Save. Open the record — both should be visible.
5. **Stock OUT → New DN**, pick material + qty + division. Drag 2 photos into Collection photos. Save.
6. Open the Drive folder — every uploaded file should be there with timestamp + your name.
7. **AuditLog sheet** should have a row for each `UPLOAD`, plus the regular CREATE rows.

If all 7 pass → v4.0 is live. Tell staff the new URL.

---

## Rollback

If at any point v4.0 misbehaves and you need to revert:

1. **Stop using the v4.0 URL.**
2. Tell staff to use the old v3.4c URL again (it's untouched).
3. Open the issue with me with the exact error message from the in-app error banner.

No data is lost — v3.4c reads/writes its own Sheet, v4.0 reads/writes its own Sheet.

---

## Archive note

Once v4.0 is verified and adopted, you can archive v3.4c's deployment (Manage deployments → Archive). Keep the Sheet — it's your audit history for the v3.4c period.
