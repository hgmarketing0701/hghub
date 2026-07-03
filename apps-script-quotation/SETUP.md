# HG Smart Quotation — setup

A mall-driven quotation builder. Pick a mall → service → sub-scope, compulsory items
load automatically, enter L×H (auto sqft), pick client type (Mall / Contractor / Tenant),
remove what the client doesn't need, save / print / WhatsApp.

One master **PriceBook** tab drives every dropdown and every line. No double entry.

---

## Deploy (10 minutes, once)

1. Go to **script.google.com** → **New project**.
2. Delete the sample `Code.gs`. Paste in this folder's **Code.gs**.
3. **File → New → HTML file**, name it exactly `Index` (no .html). Paste in **Index.html**.
4. **Project Settings (gear) → Show "appsscript.json"** → paste in this folder's **appsscript.json**.
5. Run the **`setup`** function once (pick it in the toolbar, click ▶). Approve permissions
   when asked. Check the log — it prints the new database spreadsheet URL.
6. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone within hggroup.com.my**
   - Deploy. Open the web-app URL. Done.

Re-running `setup()` later is safe — it never wipes data, it only adds missing tabs/seed rows.

---

## The tabs it creates

| Tab | What it holds |
|---|---|
| **PriceBook** | the master list — every priced item (this is what you maintain) |
| **Malls** | mall list for the dropdown |
| **Services** | service list + `IsExtra` flag (Fit-Out / Scaffold show as "extra work") |
| **Settings** | company info, SST %, quote prefix, footer |
| **Quotes / QuoteLines** | every saved quotation |
| **AuditLog** | who changed / saved what, when |

---

## How pricing works

**Three prices per item:** `PriceMall`, `PriceContractor`, `PriceTenant`.
Pick the client type at the top of a quote → the right column fills in (still editable per line).

**Mall pre-fix without re-typing:**
- Rows with Mall = **`(All Malls)`** apply to every mall — your standard rate card.
- A row for a specific mall (e.g. `KLCC`) **overrides** the default for that one item.
- Set the standard book once. Only add a mall-specific row where that mall is different.
- Button **"Clone defaults → mall"** copies the whole default book into one mall if you'd
  rather edit a full per-mall copy.

**Auto sqft:** any item with unit `sqft` shows Length × Height × Count and totals the area.
Units `ft` / `m` show Length × Count. Everything else (`nos`, `lot`, `day`, `month`, `trip`)
shows a plain quantity.

**Minimum charge (reinstatement):**
- `MinQty` — if the measured size is below this, it bills at the minimum size
  (e.g. min 200 sqft). A red "min" badge shows when it kicks in.
- `MinCharge` — if the line total is below this RM figure, it bills the minimum charge
  (e.g. make-good min RM 800).
- You can set either or both on any item.

---

## ⚠️ The seeded rates are SAMPLES

`setup()` fills the PriceBook with a realistic structure across all six service lines so the
tool works immediately — **but the RM numbers are placeholders.** Go to the **Price Book**
tab in the web app (or edit the sheet directly) and replace them with your real rates before
sending any quote to a client.

---

## Day-to-day: malls, services, items

**Add a mall** — New Quote tab → **"+ new mall"** beside the Mall dropdown. It instantly uses
every `(All Malls)` price; add override rows only where it differs. (Or add a row in the Malls
sheet tab.)

**Add a service** — New Quote tab → **"+ new service"** beside the Service dropdown. Mark it
"Extra work" if it's add-on like Fit-Out / Scaffold. Then add its items under Price Book.

**Add a job scope / item** — Price Book → **"+ Add item"**. Type the Service + Sub-scope + Item,
set unit, compulsory, min rules, and the 3 prices. A new sub-scope appears in New Quote
automatically. Set **Compulsory = Yes** to auto-load it, **No** to show it as an optional chip.

**Edit / delete an item** — Price Book → **click any row** → change and Save, or hit Delete.
Everything writes to the AuditLog tab.
