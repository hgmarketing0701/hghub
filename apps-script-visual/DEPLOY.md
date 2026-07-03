# Visual Works Control — Deploy Guide

One web app to run the Visual print & install subcon (B) end-to-end.
Replaces what Hwei Qi does manually. So she can rest.

**What it does in one line:** HG records each job + measurement → that figure is the source of truth → when B sends his invoice, the system checks every line against the HG record in seconds, not days.

No API key. PDF/photo handling is built into Apps Script. Same pattern as your Subcon Invoice and Workers tools.

---

## Your 12 requirements → where they live

| # | You asked for | In the system |
|---|---|---|
| 1 | Size + rate for each confirmed job | **Jobs** → panels (L×H→sqft) × rate per sqft = expected amount |
| 2 | Material used + price per job | Each panel carries its own material + rate; job rolls them up |
| 3 | Lot number + which mall | Mandatory fields on every job |
| 4 | Artwork file for record + measurement | Artwork link (WeTransfer) + measurement sketch image + approved proof, all kept per job |
| 5 | All measurements tally with B's invoice | **Invoices & Recon** → side-by-side HG-recorded vs B-claimed, per job |
| 6 | Kill the long manual invoice checking | Recon verdict **MATCH / CHECK** auto-computed on save — flags only the jobs that differ |
| 7 | Store B's invoices | B's invoice PDF/image filed in Drive, linked to the record |
| 8 | Audit log report | **Audit Log** tab — every create/edit/status/PROCEED stamped with who + when |
| 9 | Formula: length × height → sqft | Built in; handles mm / cm / m / in / ft and qty |
| 10 | B's rates per mall / material / job | **Rate Card** — most-specific match wins (Mall+Material+Type → Material → ALL) |
| 11 | Store monthly/yearly permits per mall | **Permits** — filed per mall, with 14-day expiry early warning |
| 12 | B's worker name list + documents | **B Workers** — names, IDs, docs, 30-day doc-expiry warning |

Plus the **WhatsApp flow** is built in as job status:
NEW → DRAFT_IN → SENT_CLIENT → (ARTWORK_REJECTED loop) → **APPROVED = the PROCEED magic word** → PRINTING → INSTALLED → COMPLETED (with photos).

---

## One-time setup (~10 min)

### 1. Create the Sheet + Apps Script project
1. Open Google Drive signed in as **@hggroup.com.my**.
2. **New → Google Sheets**. Rename it **`Black Lee — Visual Works`**.
3. **Extensions → Apps Script**.
4. Delete the default `Code.gs` stub.
5. Create three files matching this folder:
   - `Code.gs` ← paste `apps-script-visual/Code.gs`
   - `Index.html` ← **File → New → HTML file**, name it `Index`, paste `apps-script-visual/Index.html`
   - `appsscript.json` ← **Project Settings (gear)** → tick *Show "appsscript.json" manifest* → paste `apps-script-visual/appsscript.json`
6. **Save**.

### 2. First run
1. Function dropdown → `setupConfig` → **Run**. Authorise (company account only).
2. **View → Logs** should show: Sheets initialised + Drive parent folder + subfolders.

### 3. Deploy as web app
1. **Deploy → New deployment** → gear → **Web app**.
2. Execute as: **User accessing the web app**.
3. Who has access: **Anyone within hggroup.com.my**.
4. **Deploy**, copy the **Web app URL**.

### 4. Share
Drop the URL in the WhatsApp group / pin it. Open on phone or desktop, signed in with the company Google account.

---

## About B's access — one decision for you

The tool is locked to **@hggroup.com.my** accounts, and every action is stamped with the signer's email (that's your audit trail). Two ways to run it:

1. **HG-keys-in (default, zero setup).** The HG requestor already in the WhatsApp loop creates the job and later logs B's invoice. The time saved is the auto sqft + rate + recon — not who types. Works today.
2. **B-keys-in.** Give B one **@hggroup.com.my** account (he's effectively your staff). Then B logs his own drafts/photos/invoice and his name shows in the audit log.

You don't have to choose now — start with #1, switch to #2 anytime by issuing B an account. No code change.

> Don't open the web app to "Anyone" with no login — that breaks the audit trail (no name on actions), which is the whole point for disputes.

---

## Daily flow (maps to your WhatsApp steps)

1. **Job order goes to B on WhatsApp** → create a **Job**: mall, lot, type, install date, artwork WeTransfer link, paste the measurement sketch, add panels. Status **NEW**.
2. **B sends draft back** → open job → **B sent draft** (DRAFT_IN). HG sends to client → **Sent to client**.
3. **Pixelated / missing font** → **Artwork rejected** (reason logged) → request new file → back to draft.
4. **Client approves** → **✓ PROCEED** (APPROVED). This is the magic word, captured with who+when.
5. Attach **work permit** + install date already on the job for B's reference.
6. **B prints** → Printing → **Installed**.
7. **B shares completion photos** → **📷 Completion photos** → COMPLETED.
8. **Month end, B sends invoice** → **Invoices & Recon** → Log B invoice → tick the jobs → system shows MATCH or CHECK and exactly which lines differ. Mark **verified / disputed / paid**.

---

## The sqft formula

`sqft = (width in ft) × (height in ft) × qty`, with unit conversion:
mm ÷ 304.8 · cm ÷ 30.48 · m × 3.2808 · in ÷ 12 · ft × 1.

Your drawings are in mm (e.g. 12200 × 4780) — pick **mm**, type the numbers, sqft is live. Amount = sqft × the matching rate. **All math is recomputed on the server** — the browser figure is a preview, the Sheet is authoritative.

---

## What lives where

| Thing | Location |
|---|---|
| Web app code | Apps Script bound to the Sheet |
| All data | `Black Lee — Visual Works` Sheet — tabs: Jobs, JobPanels, Rates, Malls, Materials, Permits, Workers, Invoices, InvoiceJobs, AuditLog |
| **Each job's files** | Drive · `Black Lee — Visual Works / <Mall> / <Lot> /` — sketch, proof + `Site Reference/` + `Completion/` subfolders, made automatically on Create |
| Permit files | Drive · `… / Work Permits` |
| Worker docs | Drive · `… / Worker Docs / <Worker name> /` |
| B's invoice files | Drive · `… / B Invoices` |

---

## Notes & limits

- **Set up Rate Card first.** Until a rate matches a job's mall/material, amounts show RM 0 (you can still type a rate per panel). Add B's agreed rates once and every future job auto-prices.
- **Recon tolerance** is RM 5 or 1% (whichever) — tiny rounding won't nag. Edit `RECON_TOL_RM` / `RECON_TOL_PCT` in `Code.gs`.
- **Permit warning** = 14 days, **worker-doc warning** = 30 days. Both editable at the top of `Code.gs`.
- **WeTransfer links expire** (~7 days). The link is kept for reference, but for permanent record drag the final approved artwork into the job's Drive folder, or upload the approved proof.
- **Numbering** uses `LockService` — two people saving at once won't collide. Job numbers `VIS-2026-0001…`.

---

## Troubleshooting

- **"Access denied"** — not signed in with @hggroup.com.my.
- **Banner "isn't connected to the server"** — you opened the raw HTML, not the deployed `/exec` URL.
- **Amounts all RM 0** — no rate card row matches yet; add one under Rate Card.

---

## Add it to operations.html later

When deployed, add a tile pointing at the Web app URL (status Live), next to your other Apps Script tools.

---

## v1.2 changes (2026-06-07)

- **Job type** now has **Install only** (client prints elsewhere, B only installs — priced at the install rate).
- **Package RM/sqft** rate column — one all-in supply+install rate that overrides the print/install split.
- **Mall** and **Default material** are managed dropdowns (⚙ Manage → add / rename / delete). Materials are seeded with Tarpaulin, Sticker, Fabric, Vinyl, Forex Board on `setupConfig`.
- **Sketch / proof** accept drag-drop **or** a pasted URL. New **Site pictures** field takes multiple drag-uploads.
- On **Create**, the system auto-builds the Drive folder `<Mall>/<Lot>/` and files everything there.
- **Workers** now hold dedicated **IC**, **CIDB Green Card**, and **WAH** document slots (each with file upload + expiry), plus an Other slot. CIDB/WAH expiries feed the early-warning.
- **Permits** gained a **Lot number** field (leave blank for a whole-mall permit).

> Upgrading an already-deployed copy: re-paste `Code.gs` + `Index.html`, run **`setupConfig`** once (adds the new sheets/columns + seeds materials), then **Deploy → Manage deployments → Edit → New version**.
