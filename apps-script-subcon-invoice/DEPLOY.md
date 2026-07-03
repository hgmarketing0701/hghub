# Subcon Invoice Generator — Deploy Guide

A web app to generate an invoice **on behalf of** an individual worker / subcon who doesn't issue their own invoice. Fill in their name (or company name + logo) and address, add line items, hit **Generate** → produces a PDF in Drive + a row in the Sheet. Every invoice is kept in a shared records table at the bottom.

No API key needed. PDF is made by Apps Script's built-in HTML→PDF.

---

## One-time setup (~8 min)

### 1. Create the Sheet + Apps Script project
1. Open Google Drive (signed in as `@hggroup.com.my`).
2. **New → Google Sheets**. Rename it to **`Black Lee — Subcon Invoices`**.
3. In the Sheet: **Extensions → Apps Script**.
4. Delete the default `Code.gs` stub.
5. Create three files matching this local folder:
   - `Code.gs`         ← paste contents of `apps-script-subcon-invoice/Code.gs`
   - `Index.html`      ← **File → New → HTML file**, name it `Index`, paste contents of `apps-script-subcon-invoice/Index.html`
   - `appsscript.json` ← **Project Settings (gear)** → tick *Show "appsscript.json" manifest file in editor*, then paste contents of `apps-script-subcon-invoice/appsscript.json`
6. Click **Save** (disk icon).

### 2. First run
1. Select the function `setupConfig` from the dropdown.
2. Click **Run**. Authorise when prompted (`@hggroup.com.my` account only).
3. Open **View → Logs**. You should see:
   - "Sheets initialised: Invoices, InvoiceLines, Subcons, AuditLog"
   - "Drive parent folder: Black Lee — Subcon Invoices (ID...)"

### 3. Deploy as web app
1. **Deploy → New deployment**.
2. Gear icon → **Web app**.
3. Settings:
   - Description: `Subcon Invoices v1`
   - Execute as: **User accessing the web app**
   - Who has access: **Anyone within hggroup.com.my**
4. Click **Deploy**. Authorise again if asked. Copy the **Web app URL**.

### 4. Share with staff
Send the Web app URL via WhatsApp. Open it on phone or desktop — must be signed in with the `@hggroup.com.my` Google account.

> The first time you save an invoice, type your own company name + address in **Bill to**. It's remembered for everyone after that.

---

## How to use

1. Pick **Individual** or **Company**.
2. Type the worker / subcon name. (Company can upload a logo; individuals usually leave it blank.)
3. Optionally fill IC/passport, address, phone, bank details.
4. Add line items — description, qty, unit price. Amount and totals calculate live.
5. SST 6% is **off by default** (individual subcons are rarely SST-registered). Toggle on if needed.
6. Hit **Generate PDF & Save**.

Each generate:
- Gets a sequential number `SUB-2026-0001`, `SUB-2026-0002`, … (leave the Invoice no. field blank to auto-assign, or type your own).
- Creates a Drive subfolder inside **Black Lee — Subcon Invoices** containing the A4 PDF.
- Appends one row to `Invoices` + N rows to `InvoiceLines`.
- Remembers the subcon (name, details, logo) so next time you can pick them from the **Load a saved subcon** dropdown.
- Writes an `invoice.create` row to `AuditLog`.

**Open** in the records table reloads an invoice as a *new copy* (fresh number) — handy for repeat monthly claims. **Delete** removes the Sheet row and trashes its Drive folder. **PDF** opens the stored file.

---

## What lives where

| Thing | Location |
|---|---|
| Web app code | Apps Script project bound to the Sheet |
| Invoice log | `Black Lee — Subcon Invoices` Sheet · `Invoices`, `InvoiceLines`, `Subcons`, `AuditLog` tabs |
| Invoice PDFs | Google Drive · `Black Lee — Subcon Invoices / SUB-YYYY-NNNN — Name — RM Amount /` |
| Subcon logos | Google Drive · `Black Lee — Subcon Invoices / Logos /` |
| Your company default | Script Properties (`MY_COMPANY`) |

---

## Notes & limits

- **Logos** are stored once per subcon in the `Logos` folder and reused. On load, the app reads each saved subcon's logo back as a thumbnail — fine for a normal number of subcons; if the list ever gets very large and load feels slow, that's the place to optimise.
- **Numbering** uses `LockService`, so two people generating at once won't collide.
- **Totals are recomputed on the server** — the browser figures are just a preview; the saved PDF and Sheet are authoritative.

---

## Troubleshooting

**"Access denied"** — Not signed in with `@hggroup.com.my`. Sign in to Chrome with the company account.

**Banner: "isn't connected to the server"** — You opened the raw HTML file instead of the deployed `/exec` URL. Use the Web app URL from step 3.

**PDF layout looks off** — The template lives in `buildInvoicePdf_()` in `Code.gs`. `Utilities.newBlob(...).getAs(MimeType.PDF)` is Apps Script's built-in converter; very stable.

**Numbers skip** — Expected if you delete an invoice; the sequence doesn't backfill. Check `AuditLog` for the real history.

---

## Add it to operations.html later

When ready, add a tile pointing at the Web app URL (status Live).
