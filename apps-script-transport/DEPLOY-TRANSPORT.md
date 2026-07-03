# Deploy — Transport · Mover · Rorobin (Cloud v1)

Same deployment flow as your Storage Rental and Lorry Fleet tools.
Estimated time: **30 minutes.**

What this is: one web app to run **client engagements** for the 3 services you sell —
**Lorry transport · Mover services · Rorobin rental (SWCorp)** — with rate-card
auto-pricing, one-invoice-many-lines billing, payments + SST, bin inventory,
before/after photos, and a full audit trail. Locked to `@hggroup.com.my`.

> This is NOT the same as `apps-script-lorry` (that one tracks your own vehicles'
> fuel/toll/maintenance). This one is the **money-making side** — what you charge clients.

---

## Step 1 — Create the Google Sheet (the database)

1. Go to <https://sheets.google.com> signed in as `@hggroup.com.my`.
2. **Blank** → rename it: **`Black Lee — Transport DB`**.
3. Leave it empty. The script builds all 12 tabs on first run
   (Clients, Engagements, Jobs, Bins, Rates, Invoices, Payments, Photos, **Workers, Trips**, Config, AuditLog).

## Step 2 — Open Apps Script

1. In the sheet: **Extensions → Apps Script**.
2. Rename the project (top-left) to **`Transport Backend`**.

## Step 3 — Paste `Code.gs`

1. Click `Code.gs` → select all → delete.
2. Paste the entire contents of `apps-script-transport/Code.gs`. Save (`Ctrl+S`).

## Step 4 — Add `Index.html`

1. Sidebar **`+` → HTML**. Name it exactly **`Index`** (no `.html`).
2. Delete the placeholder, paste all of `apps-script-transport/Index.html`. Save.

## Step 5 — Set the manifest

1. ⚙️ **Project Settings** → tick **“Show appsscript.json manifest in editor”**.
2. Back in the editor → `appsscript.json` → select all → delete.
3. Paste `apps-script-transport/appsscript.json`. Save.

Scopes: Sheets, Drive (photo/invoice files), triggers (daily alerts), send-mail (alerts),
user email (audit). Google's prompt mentions broad Drive access — that's `DriveApp.createFolder`;
the script only ever touches its own **`Black Lee — Transport`** folder.

## Step 6 — First run (creates tabs + seeds rate card + sample bins)

1. Open `Code.gs` → function dropdown → **`setupSystem`** → **Run**.
2. Authorize: pick your `@hggroup.com.my` account → **Advanced → Go to Transport Backend (unsafe)** → **Allow**.
3. Switch to the Sheet — 10 tabs appear. The **Rates** tab is pre-filled with
   **placeholder** prices and **Bins** has 4 sample bins.
4. (Optional) Run **`installDailyTrigger`** → enables the ~7am daily alert email
   (rorobin overstays + overdue invoices).

⚠️ **Before going live: open the app → Rate Card tab → set your REAL RM rates.**
The seeded numbers are guesses.

## Step 7 — Deploy as Web App

1. **Deploy → New deployment** → ⚙️ → **Web app**.
2. Description: `v1 — initial release`.
   - **Execute as:** `Me (you@hggroup.com.my)` ← important.
   - **Who has access:** `Anyone within hggroup.com.my`.
3. **Deploy** → copy the **Web app URL** (`https://script.google.com/a/macros/hggroup.com.my/s/…/exec`).

## Step 8 — Smoke test

1. Open the URL. Top-right shows your email in the pill.
2. **Clients** → + Add client → `ABC Sdn Bhd`. Save.
3. **Rate Card** → edit the seeded rates to your real prices.
4. **Engagements** → + New engagement → client `ABC Sdn Bhd`, reason `Reinstatement`. Save.
5. Inside the engagement → **+ Add job**:
   - Service `Lorry`, rate `Lorry 3-Tonne`, **2 trips** (night collection + next-day delivery),
     collection movers = `Reinstatement workers`, delivery movers = `HG team`. Save.
   - **+ Add job** again → service `Mover`, 3 movers × 1 shift. Save.
6. On the Lorry job → **Photos** → add `Lorry Reach`, `Box Before Load`, `Box After Unload`, `Lorry Leave`.
   Watch the badge go ✓.
7. **+ Create invoice** → tick both jobs → key in your invoice number → SST on → Save.
8. Open the invoice → **Record payment** → part-pay → status goes **Partial**.
9. **Bins** tab → place a bin via a Rorobin job (Mall, place ~10pm) → it shows **OUT**;
   leave collection blank past 6am → red **OVERSTAY** glow + dashboard alert.
10. **Reports** → revenue by service + photo-compliance gaps.
11. Open the **Sheet → AuditLog** tab → every action stamped with the staff email. ✅

## Step 9 — Share with staff

Give staff only the **Web app URL** (WhatsApp it / bookmark on phone — camera button
opens directly for site photos). Non-`@hggroup.com.my` logins are blocked, no password needed.
Fire someone → revoke their Workspace account → access gone instantly.

## Step 10 — Wire into operations.html (optional)

```html
<div class="tile" onclick="window.open('PASTE-TRANSPORT-URL','_blank')">
  <div class="tile-icon">🚚</div>
  <div class="tile-title">Transport · Mover · Rorobin</div>
  <div class="tile-desc">Client jobs, bins, invoices, photos</div>
</div>
```

---

## Shared lorry runs (1 lorry → several clients in one trip)

**Run-first (the main way):** when ONE lorry is shared across **several unrelated clients** in one
shift (your cost saving, invisible to clients), build it inside the **Run**:

1. **Runs → + New run** → date, **shift** (night/morning), lorry, driver, and the **crew**
   (workers for that shift — their shift pay = HG's cost).
2. Open the run → **+ Add client stop** for each client:
   - pick the **client**, pick-up location+time, delivery location+time
   - tick **🚚 Lorry** and/or **📦 Mover**, and **key the charge** for each (e.g. RM 500 lorry, RM 300 mover)
   - pick which **workers** did that leg, add notes
   - (or tick **🏠 Internal** for no charge)
3. Each stop becomes that client's **own billable job**, grouped by client in the run.
4. Per client, hit **+ Invoice** to raise that client's invoice (each client billed separately).
5. The run shows **Client billing − HG cost (crew + driver + lorry) = your saving.**

The older **engagement → job** way still works for a single client's reinstatement (mover + lorry
together); use **Link existing job** in a run to attach those.

---

(Legacy note — one driver + a few mover workers + one lorry for ONE client's multi-service job:)

1. **Workers** tab → add your drivers and movers once. Each has a **role** (Mover / Driver / Both)
   and a **pay basis**:
   - **Per-shift** (outsource/casual) → set **day** and **night** shift rates.
   - **Monthly** (in-house salaried) → set monthly salary; counts **RM0** against each shared run.
2. **Runs** tab → **+ New run** → date, shift, lorry plate. **Pick the driver** from the Workers list
   (his pay auto-fills — RM0 if he's in-house monthly). Add the **mover crew** the same way.
   **One shift pay per person covers the whole run — all stops, regardless of how many drops.**
3. Open the run → **+ Add client stop** → tick the lorry/mover jobs delivered on that trip
   (each job already sits under its own client engagement). Order the stops ↑↓.
4. The run shows **Client billing** (normal rates, unchanged) − **HG actual cost** (crew + driver + lorry)
   = **Saving / margin**. Clients still pay their normal rate and never see the sharing.
5. **🖨 Run sheet** prints the route + crew record (ordered stops, locations, items, tick-box) —
   WhatsApp it to the driver or keep as the trip record.

You can also attach a job to a run from the job's **⋯ menu → 🚚 Add to a run**.
Each client's reach/box/leave photos still live on that client's own job, so a 4-drop run
captures 4 sets of before/after photos.

## How the model works (so staff key it in right)

- **Client** → reusable master record (no re-typing).
- **Engagement** = one client job (e.g. a reinstatement). Auto-ref `ENG-0001`.
  It **groups** several service jobs.
- **Job** = one service line under an engagement. Charge = **rate-card rate × quantity**:
  - Lorry: rate × **trips**. A lorry job can have **multiple stops** (pickup→delivery legs) —
    each with client/recipient, pick-up location+time, delivery location+time, notes
    (+ Add stop). The job's summary from/to/time is taken from the first/last stop.
  - Mover: rate × (**movers × shifts**)
  - Rorobin: rate × **placements** (usually 1)
- **Invoice** covers one OR several jobs of an engagement (separate lines, one total).
  You **key in the invoice number** yourself (from Odoo / accounting). One engagement can have
  multiple invoices if you split mover and lorry.
- **Payments** logged against the invoice, with SST 6% toggle.
- **Photos** are stage-tagged. Required stages auto-flagged until captured:
  - Lorry: Lorry Reach · Box Before Load · Box After Unload · Lorry Leave
  - Mover: Items Before Start (+ Defect if any)
  - Rorobin: Placement Location · After Pick Up (+ Defect if any)
- **Rorobin policy automation:** Mall / Office Tower = place ~10pm, **must collect before 6am**;
  Shop Lot / Roadside = **max 3 days** (editable in Settings). The system flags overstays
  on the dashboard and in the daily email.

## Command-Center-parity features (added 2026-06-08)

- **Rorobin tipping / ESG closure.** Lifecycle is now **Onsite → Awaiting Tipping → Tipped.**
  After a bin is collected, open the job → **♻️ Record tipping** → enter landfill, **tonnage**,
  tip fee, date, and attach the **tipping receipt.** Dashboard shows **waste tipped (tons)**,
  **tip fees**, and **bins awaiting tipping**; Reports has a full tipping/ESG table.
  Add **Waste Load** + **Tipping / Landfill** photos via the photo manager.
- **Internal HG use (no charge).** Any lorry/mover (or bin) job can be ticked **🏠 Internal** —
  e.g. your own scaffold delivery. It's charged **RM 0**, excluded from invoicing, but fully
  tracked (driver, lorry, crew, photos). Dashboard counts internal jobs.
- **By-driver / by-lorry utilization** in Reports — trips, billable vs internal split, revenue,
  pulled from each job and its run.
- **Lorry fleet master** (new **Fleet** tab) — plate / code / type / capacity / **category
  (in-house vs outsource, e.g. Balan)**, like the Command Center's fleet list. `setupSystem()`
  seeds 3 sample lorries (HG-01, HG-02, BALAN-A). When logging a lorry job or a run, **pick the
  lorry from the fleet** and the plate auto-fills (or type a plate manually). By-lorry
  utilization shows each lorry's category.

## Updating later

Paste new `Code.gs` / `Index.html` → Save → **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**.
URL stays the same. On the next load the script **auto-adds** any new tabs/columns
(e.g. the Workers + Trips tabs and the `tripId`/`stopSeq` columns) — no data is lost.

## Reset (testing only)

`Code.gs` → run `_resetAllSheets_DANGER` → wipes & recreates all tabs (**audit too**).
