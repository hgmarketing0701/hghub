# Receipt Claims — Deploy Guide

A web app for staff to submit expense claims by photo. Auto-reads receipts in English / Chinese / Malay, generates a PDF, saves to Drive folder, logs to Sheet.

---

## One-time setup (~10 min)

### 1. Get a Gemini API key (free)
1. Open https://aistudio.google.com/app/apikey
2. Sign in with your `@hggroup.com.my` account
3. Click **Create API key** → **Create API key in new project**
4. Copy the key (starts with `AIza...`)

### 2. Create the Sheet + Apps Script project
1. Open Google Drive (signed in as `@hggroup.com.my`).
2. **New → Google Sheets**. Rename it to **`Black Lee — Claims Log`**.
3. In the Sheet: **Extensions → Apps Script**.
4. The script editor opens. Delete the default `Code.gs` stub.
5. In the editor, create three files matching the local folder:
   - `Code.gs`         ← paste contents of `apps-script-claims/Code.gs`
   - `Index.html`      ← **File → New → HTML file**, name it `Index`, paste contents of `apps-script-claims/Index.html`
   - `appsscript.json` ← click the gear icon **Project Settings**, tick **Show "appsscript.json" manifest file in editor**, then paste contents of `apps-script-claims/appsscript.json` into the file that appears
6. Click **Save** (disk icon).

### 3. Configure the Gemini key
1. In the Apps Script editor: **Project Settings (gear) → Script Properties → Add script property**.
2. Property name: `GEMINI_API_KEY` · Value: *(paste your key)* · **Save**.

### 4. First run
1. Back in the editor, select the function `setupConfig` from the dropdown.
2. Click **Run**. Authorise when prompted (`@hggroup.com.my` account only).
3. Open **View → Logs**. You should see:
   - "Sheets initialised: Claims, ClaimLines, AuditLog"
   - "Drive parent folder: Black Lee — Claims (ID...)"
   - "Gemini API key: SET"

### 5. Deploy as web app
1. **Deploy → New deployment**.
2. Gear icon → **Web app**.
3. Settings:
   - Description: `Receipt Claims v1`
   - Execute as: **User accessing the web app**
   - Who has access: **Anyone within hggroup.com.my**
4. Click **Deploy**. Authorise again if asked. Copy the **Web app URL** at the end.

### 6. Share with staff
Send the Web app URL via WhatsApp. They open it on their phone — must be signed into Chrome with their `@hggroup.com.my` Google account.

---

## How staff use it (batch supported)

1. Open the link → tap **Tap to take photos**.
2. Select multiple photos at once (or take them one by one). **Each photo becomes its own claim card** by default.
3. For a long receipt that needs 2 photos: tap the dashed **+** tile inside that card to add more photos to *that specific* receipt.
4. Tap **⚡ Extract all** → Gemini reads every card in parallel (5–10s).
5. Each card now shows the extracted vendor / date / line items / amounts. Fix anything wrong, override categories, toggle SST 6% per card if needed.
6. Need to add a claim with no receipt photo? Tap **+ Add manual claim** and type it in.
7. When all cards look right, tap the **Submit all & generate PDFs** button in the sticky bottom bar.
8. Each card flips to **✓ Done** with its own PDF + Drive folder link. If any single card fails, the others still submit; failed ones show an error and can be retried.

Every submission (per card):
- Gets its own sequential claim number (`CLM-2026-001`, `CLM-2026-002`, …)
- Creates its own Drive subfolder inside **Black Lee — Claims**
- Saves the receipt photo(s) + a generated A4 claim PDF in that subfolder
- Appends one row to `Claims` and N rows to `ClaimLines` in the Sheet
- Writes a `claim.create` row to `AuditLog` with the submitter's email

### Summary PDF (bundle many claims into one cover sheet)

Two ways to generate a summary:

1. **Right after a batch submit** — if you submitted 2+ claims, a banner appears under the submit bar. Tap **📑 Generate summary PDF** → bundles all just-submitted claims into one PDF.
2. **Ad-hoc from history** — in the "My recent claims" table, tick the checkboxes next to whichever claims you want. Tap **📑 Generate summary of selected**. Useful for "all my claims this month" or "all site-visit receipts for ABC Sdn Bhd".

Each summary PDF contains:
- Cover page: claim count, period, grand total, totals by category, totals by currency, subsidy column (if any petrol receipts), signature line
- Detail page: each claim's line items + clickable links back to that claim's individual PDF and Drive folder

### Where the summary files live (per summary)

Each summary gets its **own Drive subfolder** under `Black Lee — Claims / Summaries /`:

```
Black Lee — Claims/
  Summaries/
    SUM-2026-001 — RM 1234.56 — 5 claim(s)/
      SUM-2026-001.pdf          ← the official summary report
      Receipts-index.html       ← clickable index — one link per claim,
                                  jumps to that claim's PDF or receipt folder
```

The `Summaries` tab in the Sheet now records both `pdfUrl` and `folderUrl` per summary. The "Recent summary PDFs" strip in the UI shows three buttons per row: **📄 PDF · 🖨️ Print · 📁 Folder**.

To **print** a summary: tap 🖨️ Print → opens the PDF in Drive's preview mode → press Ctrl+P (or use the print icon in the top-right).

### Receipt math — the full formula

The system handles every component you find on a Malaysian receipt:

```
Subtotal  (sum of line items)
+ Service charge       (restaurants — usually 10% of subtotal)
- Subsidy              (petrol — Budi95 / BSH / Subsidi)
+ SST 6%               (applied to taxable base = subtotal + SC − subsidy)
± Rounding adjustment  (cash receipts — usually ±0.02 to nearest 5 sen)
= NET CLAIMABLE
```

Every line is auto-extracted by Gemini and shown as an editable field on each receipt card:

| Field | Where it shows up | Notes |
|---|---|---|
| **Service charge (RM)** | Restaurants (Service Charge / SC / Servis) | Auto-filled. Editable. Shown in PDF as `+ RM x.xx`. |
| **Budi95 / fuel subsidy (RM)** | Petrol receipts | Auto-filled. Deducted before SST. |
| **SST 6%** | Restaurants, retail | Toggle on/off; auto-computed on (subtotal + SC − subsidy). |
| **Rounding adjustment (RM)** | Cash receipts | Signed (can be negative). Auto-filled. |

The total label on every PDF says **NET CLAIMABLE** — that's the figure the company actually pays out. New `Claims` sheet columns: `serviceCharge`, `subsidyAmount`, `roundingAdjustment` (alongside existing `subtotal`, `sstAmount`, `total`) so the full audit trail is preserved.

---

## What lives where

| Thing | Location |
|---|---|
| Web app code | Apps Script project bound to the Sheet |
| Submission log | `Black Lee — Claims Log` Sheet · `Claims`, `ClaimLines`, `Summaries`, `AuditLog` tabs |
| Receipt photos + claim PDFs | Google Drive · `Black Lee — Claims/CLM-YYYY-NNN — Vendor — RM Amount/` |
| Summary PDFs (bundles) | Google Drive · `Black Lee — Claims/Summaries/SUM-YYYY-NNN — RM Amount — N claims.pdf` |
| API key | Script Properties (never in code) |

---

## Costs

- Gemini free tier: ~1,500 requests/day on `gemini-2.5-flash`. Far more than 40 staff would ever submit.
- Drive storage: receipts are small (~500 KB each).

---

## Troubleshooting

**"Access denied"** — Staff not signed in with `@hggroup.com.my`. Have them sign in to Chrome with the company account.

**"GEMINI_API_KEY not set"** — Step 3 was skipped. Add the key under Script Properties.

**Extract returns nothing / errors** — Check the **Apps Script editor → Executions** tab to see the error. Usually a malformed receipt photo or quota exceeded. Staff can fall back to **Enter manually instead**.

**Claim numbers skip / duplicate** — Shouldn't happen (LockService is on). If it does, check `AuditLog` for the actual sequence.

**PDF looks wrong** — `Utilities.newBlob(...).getAs(MimeType.PDF)` is Apps Script's built-in HTML→PDF. Very stable. If layout breaks, the HTML template lives in `buildClaimPdf_()` in `Code.gs`.

---

## Add it to operations.html later

Replace the placeholder tile (when ready):

```js
{ key: 'claims', title: 'Receipt Claims', desc: 'Snap → extract → PDF → Drive → Sheet', href: '<YOUR_WEB_APP_URL>', live: true }
```
