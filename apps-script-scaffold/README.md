# HG Scaffold & Green Tag System

Google Sheet + Apps Script. Runs the scaffold business end-to-end for **3 services** in one place.

Same house UI as your other tools (dark theme, HG logo, tabbed). Multi-user, **@hggroup.com.my login only**, full audit.

---

## The 3 services — one job record

Every job has a **service type** + **scope**:

1. **Aluminium mobile scaffold**
   - *Full* — rental + install + weekly green tag.
   - *Rental only* — you deliver, client installs themselves. (Still charge PE + transport + rental.)
2. **Customized scaffold system** — same as above, plus a **3rd-party supplier** field + cost line.
3. **Green tag only** — inspect & endorse the client's *existing* scaffold. No rental, no material.

**Charges are typed line items** — pick from: PE calculation & endorsement · scaffold rental (day/week/month) · scaffold installation · lorry transport (delivery/pickup) · scaffold dismantling · green tag endorsement · 3rd-party supplier · other. This drives quotes, invoices **and** revenue-by-service reporting.

---

## The 8 tabs

1. **Dashboard** — active jobs, **green tags due/overdue**, **items deployed onsite**, **collection due**, outstanding RM, collected this month, certs expiring. One action list — click any line to jump to the record.
2. **Jobs** — every engagement. Search/filter by service + status. Open a job to manage charges, material, inspections, photos, sign-off, invoicing, status.
3. **Onsite** — every job with rented scaffold material still on site: **what is deployed, the rental return date, a collection countdown, and the exact item list to collect back**. One-click collection sign-off / "Collected all".
4. **Green Tag** — every scaffold onsite with its inspection status (last / next due / overdue), plus full inspection history. One-click **+ Inspect**.
5. **Invoices & Payments** — create invoices (SST 6%), record payments, track balance & status, print a tax invoice. Or **invoice straight from a job's unbilled charges**.
6. **Personnel** — your certified staff: **WAH · Scaffold Erector · Scaffold Inspector · OSH Coordinator** — with cert numbers + expiry. System warns before any expires.
7. **Reports** — 6 reports, view on screen → **Print/PDF** or **Download CSV**.
8. **Audit Log** — every create / edit / payment / status change / sign-off, **who + when**.

## Material onsite under rental → collection reminder

This mirrors the "Materials currently deployed / Due this week" panel in your Command Center:

- Each job has a **rental period**: *Start / delivery* → *Expected end (return)*.
- Kit-out records **qty out**; collection records **qty returned** → the difference is **what's still on site**.
- The **Onsite tab + Dashboard** show every job with material out, a **countdown to the return date**, and the **item-by-item list to collect back** (code · spec · qty).
- The daily 7am engine **emails the collection list** ahead of the return date (default 7 days — set in Settings → *Collection due window*) and again when overdue (1/3/7 days), so nothing is left on a client's site.

---

## What you asked for — and where it lives

1. **Client details** — Jobs → New Job (company, PIC, contact, email, address).
2. **Invoice number** — Invoices tab; auto-prefix `SCF-0001` or type your own.
3. **Invoice payment details** — record payments against each invoice (amount, date, method, reference) → balance + Paid/Partial/Overdue status auto-updates.
4. **Comprehensive + reporting** — the 6 reports above; dashboard money + compliance view.
5. **Audit — who keyed in / who handled** — every job stamps *Handled by* + created/updated by; AuditLog records every action with the signed-in email.
6. **Photos** — per job, 5 separate sets: **site location · before start · after install · after collection · defects**. Stored to a HG Drive folder, domain view-only, retrievable anytime.
7. **Material checkout / return with sign-off** — record every component sent to site (qty out), count it back on collection (qty returned), shortfall + damage auto-flagged, **client signs off both delivery and return** (name + date + optional signed photo/PDF). Print a job sheet with the material table + signature lines. The catalogue is seeded with your **real HG scaffold material list (code + spec)** from the hardcopy form — 5/4/3 Rung Frame, Guardrail, Horizontal/Diagonal Brace, Door Platform, Platform, Stabilizer, Toe Board, Ladder, Ladder Handrail, 8" Castor Wheel — so kit-out is one tap.

---

## The compliance engine (your edge)

Green tag is **weekly**. A scaffold without a current green tag must not be used.

- Each active job has an **inspection interval** (default 7 days).
- Dashboard + Green Tag tab flag every scaffold where the next green tag is **due or overdue**.
- The daily trigger (~7am) **emails** you + the handler when a green tag is due/overdue, an invoice is overdue (1/7/14 days), or a cert is about to expire (30/14/7/0 days).
- Inspections record the **inspector + their cert number + result (🟢 Green / 🔴 Red / 🟡 Hold)** and can store the signed green-tag certificate.

---

## Setup (one time, ~10 min)

1. Go to **sheets.new** (signed in as @hggroup.com.my). Name it `HG Scaffold & Green Tag`.
2. **Extensions → Apps Script.**
3. Delete the sample code → paste in **Code.gs**.
4. **+ → HTML**, name it exactly `Index`, paste in **Index.html**.
5. (Optional) Project Settings → check *Show appsscript.json* → paste **appsscript.json**.
6. Save. Run `setupSystem` once → authorise. (Builds the 10 tabs + seeds the scaffold material catalogue.)
7. Run `installDailyTrigger` once → daily green-tag + invoice + cert reminders (~7am).
8. **Deploy → New deployment → Web app** → Execute as **Me**, Access **HG Group (domain)** → copy the URL. That's your team's link.
9. In the app: **⚙ Settings** → company name / reg / SST no / address (printed on invoices) + reminder inbox.
10. **Personnel** tab → add your certified staff (WAH / Erector / Inspector / OSH Coord) so inspectors and cert-expiry warnings work.

---

## Day-to-day flow

**New job** → fill client + site + scaffold + PE + period + photos → Create.
**Add charges** (PE, rental, install, transport, dismantle, green tag…) → **Invoice unbilled charges** (one click, SST added).
**Kit out** material → tick catalogue items + qty → on collection, set qty returned (or **Return all**) → **Record sign-off** for delivery and return.
**Weekly** → Green Tag tab → **+ Inspect** each scaffold onsite → Green/Red + tag # + photos.
**Done** → **Mark completed** (records return date). If any material still out, it stays flagged.

---

## If you see "Cannot read properties of undefined (reading 'apply')"

The deployed **Code.gs is out of date** (page is calling a server function the old code doesn't have). Fix:
1. **Extensions → Apps Script**, replace `Code.gs` with the latest, **Save**.
2. **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy.**
3. Reload. (The web app serves a *fixed* version — editing code isn't live until you publish a new version.)

---

## Sheet tabs (data)

`Engagements` · `Charges` · `Materials` · `Inspections` · `Invoices` · `Payments` · `Personnel` · `Catalogue` · `Config` · `AuditLog` — all created automatically by `setupSystem`.

Operations Command Center: add this as a new tile alongside your other apps-script tools.
