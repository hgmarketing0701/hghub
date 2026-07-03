# HG Temporary Storage Rental System

Google Sheet + Apps Script. Runs the temporary storage rental business end-to-end —
lots, client engagements, internal HG use, **invoices & payments**, deposits, renewals, audit.

Same house UI as your other tools (dark theme, BL logo, tabbed). Multi-user, @hggroup.com.my login only.

---

## The 6 tabs

1. **Dashboard** — occupancy %, lots free/occupied/internal, monthly recurring revenue, outstanding RM, overdue invoices, collected this month, deposits held. Plus a live alert list (expiring rentals + due/overdue invoices) — click any alert to jump to the record.
2. **Availability** — lot grid by zone. 🟢 free · 🔴 client · 🔵 internal HG. Click a free lot to rent it, a taken lot to open it.
3. **Rentals** — every engagement (client + internal). Search/filter, open to renew / vacate / sell-off / refund deposit / print agreement / invoice.
4. **Invoices & Payments** — create invoices (with SST 6%), record payments, track balance & status (Unpaid / Partial / Paid / Overdue / Void), print a proper tax invoice. **Auto-generates monthly** for active rentals (see below).
5. **Reports** — pick a report, view on screen, **Print / Save PDF**, or **Download CSV** (see below).
6. **Lots** — the inventory from your floor plans. Edit dimensions / locksets, add or remove lots.
7. **Audit Log** — every create / edit / payment / status change, who + when.

---

## What it tracks (your original 7 + more)

1. Client details + invoice + storage period — one form.
2. **Invoices & payments** — invoice no, amount, date, due date, SST, payments received, balance, paid/partial/overdue status. Printable tax invoice.
3. Storage period → **2 renewal notices** (30 + 7 days, configurable) by email with a ready-to-send WhatsApp draft → no renewal → Expired → one-click **Sell-off** (items become HG).
4. Which lot taken / free — live colour-coded board.
5. Audit log — who keyed in + who handled, every action timestamped.
6. Item photos — upload from phone/PC to a HG Drive folder (domain view-only) or paste links.
7. CCTV number + login URL per lot.

**Added (good-to-have for the business):**
- **Security deposits** — record deposit held per client, one-click refund (logged).
- **Money dashboard** — recurring revenue, outstanding, overdue, collected-this-month, deposits held.
- **Overdue-invoice email nudges** — at 1, 7, 14 days overdue.
- **Internal HG use** — track a lot used by your own team (no invoice / no sell-off).
- **Settings panel** — company name/reg/SST no/address (printed on invoices), reminder days & recipients.

---

## Setup (one time, ~10 min)

1. Go to **sheets.new** (signed in as @hggroup.com.my). Name it `HG Storage Rental`.
2. **Extensions → Apps Script.**
3. Delete the sample code → paste in **Code.gs**.
4. **+ → HTML**, name it exactly `Index`, paste in **Index.html**.
5. Save. Run `setupSystem` once → authorise. (Builds tabs + loads 32 lots from your floor plans.)
6. Run `installDailyTrigger` once → daily renewal + overdue-invoice engine (~8am).
7. **Deploy → New deployment → Web app** → Execute as **Me**, Access **HG Group (domain)** → copy the URL. That's your team's link.
8. In the app: **Dashboard → ⚙ Settings** → fill company details + reminder recipient.

---

## Client vs Internal (HG team) use

Every engagement has a **type**:

- **Client** — external paying client. Full flow: invoices, rate, deposit, agreement, 2-notice renewal, sell-off.
- **Internal** — a lot used by an HG team (Scaffold, Visual, Stores…). Tracked but **no invoice, no agreement, no renewal emails, no sell-off**. Records the HG department, PIC, items, photos, CCTV, start date. End date optional (blank = open-ended). Free it via **Release lot**.

Internal lots show **blue "INTERNAL"** and still block double-booking. Same audit trail.

---

## Auto monthly invoicing

On the **1st of each month at ~7am** the system creates one invoice per active **client** rental that has a monthly rate — with your prefix (e.g. `STR-0002`), SST if enabled, due date = invoice date + your terms days, and the billing period filled in. It **skips** internal use, terminated rentals, and any rental already invoiced for that period (safe to re-run).

- Run it anytime: **Invoices → ⚡ Generate monthly** → pick the month (YYYY-MM). Shows you exactly what it created.
- Tune it: **Settings → Auto monthly invoicing** — invoice prefix, payment terms (days), SST on/off.
- The 1st-of-month trigger is installed by `installDailyTrigger` (so the one setup step covers reminders **and** auto-invoicing).

---

## If you see "Cannot read properties of undefined (reading 'apply')"

That means the deployed **Code.gs is out of date** (the page is calling a server function the old code doesn't have). Fix:
1. Open **Extensions → Apps Script**, replace `Code.gs` with the latest, **Save**.
2. **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy.**
3. Reload the app. (The web app serves a *fixed* version — editing code isn't live until you publish a new version.)

---

## Reminders — go to you + the handler

Set **REMINDER_TO** (Settings) to your email or an ops inbox. Each reminder also goes to that engagement's **Handled By** staff automatically — as long as Handled By is an *email*. Tip: if staff log in with their own @hggroup.com.my accounts, Handled By pre-fills with their email, so this just works.

---

## The agreement — print, sign, store

Full loop, all inside one engagement (Rentals → **Open**):
1. **Print agreement** → auto-filled with client, lot, lockset, period, deposit, terms → Print / Save PDF.
2. Client signs.
3. **Edit** the engagement → **Signed agreement file** → upload the scan/photo (PDF or image). Filed to a HG Drive folder, domain view-only.
4. The signed copy then shows in the engagement detail as **Agreement: Yes · signed copy ↗** — one click to retrieve, anytime.

Before deploying / offline: open `Storage-Agreement-Template.html` in any browser, fill the top bar, Print/Save PDF.

## Reports — view, print PDF, download

**Reports** tab → pick a report from the dropdown → it shows on screen with summary cards + a table. Then:
- **🖨 Print / Save PDF** — opens a clean printable page (your company name on top) → browser Print → Save as PDF or print.
- **⬇ Download CSV** — downloads the table as a spreadsheet file (opens in Excel/Sheets).

Five reports:
1. **Rent Roll** — every current engagement: lot, holder, **New/Existing/Internal client**, period, rate, deposit, status. Totals: new vs existing client counts, recurring revenue + deposits held. (A client counts as **New** if their first engagement started within the "New client window" days in Settings — default 60; renewed/long-term tenants stay **Existing**.)
2. **Occupancy by zone** — free / client / internal per zone, occupancy %.
3. **Revenue & Collections (monthly)** — pick a month: billed, SST, collected, plus all outstanding.
4. **Outstanding & Aging** — unpaid balances bucketed by overdue age (not due / 1–30 / 31–60 / 61–90 / 90+).
5. **Renewals & Expiring** — client rentals by soonest expiry.

(If CSV download is blocked in your browser, use Print → Save as PDF instead.)

## Where client payments go

Payments are recorded **against an invoice** (so the balance is always right):
1. **Invoices & Payments** → create the invoice (or use ⚡ Generate monthly).
2. Click **Open** on that invoice → **+ Record payment** → amount, date, method, reference.
3. Status auto-updates: Unpaid → Partial → Paid. Print invoice shows payments + balance.

---

## Lot data — check before going live (Lots tab)

32 lots loaded from the 4 floor plans (Zone A ground, B & C level 1, D level 2).

1. **Lockset `24590` appears twice** — on `A-05` and `B-S01`. Confirm which is correct.
2. **Dimensions marked "verify on site"** — Zone A depths and all Zone B small (S) bays had no clear measurement on the plan; their area is blank until you fill Width/Depth (area auto-computes).

Zone C, Zone D, and the Zone B large bays are measured from the plans.

---

## Sheet tabs (data)

`Lots` · `Rentals` · `Invoices` · `Payments` · `Config` · `AuditLog` — all created automatically by `setupSystem`.
