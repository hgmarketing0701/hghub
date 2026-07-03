# HG Mall Platform — Setup (Door 1 live)

One Apps Script web app. Your staff open it in a browser, log in with their
**@hggroup.com.my** account. Every upload is stamped **who + when**.
Files auto-file into **one company Drive folder** by Mall → Lot.

---

## Deploy — 8 steps, one time

1. Go to **script.google.com** → **New project**.
2. Delete the sample `Code.gs` content. Paste in my **Code.gs**.
3. Click the **+** next to Files → **HTML** → name it exactly **Index** → paste my **Index.html**.
4. Gear icon (Project Settings) → tick **"Show appsscript.json"**.
   Open `appsscript.json` → paste my version.
5. Top dropdown → pick **setup** → click **Run**.
   Approve the permissions when asked (Drive + Sheets).
6. Open **View → Logs**. You'll see two links:
   - ROOT FOLDER (your Drive folder)
   - DATABASE (your control sheet)
   Bookmark both.
7. **Deploy → New deployment** → type **Web app**.
   - Execute as: **User accessing the web app**
   - Who has access: **Anyone in HG Group** (your domain)
   - Deploy → copy the **Web app URL**.
8. Send that URL to your team. Done.

---

## How it works

- **Mall dropdown** seeded with `SCM`. Add more with **+ New**, or edit the
  `Malls` tab in the database sheet.
- **Upload** → picks Mall + Lot + Shop Type + photos/PDF → auto-creates
  `Mall / Lot No.` folder in Drive, or drops into the existing one.
- **Amended drawing** = upload again → saved as **v2, v3…**, old versions kept.
  Nothing is ever overwritten.
- **Browse** → search by mall + lot, newest version on top, each with
  date, time, and who uploaded.

---

## The control sheet (your back office)

| Tab | What it holds |
|-----|----|
| `Malls` | mall master list (name, code, location, notes) |
| `Sketches` | every upload logged (version, file, who, when) |
| `AuditLog` | who did what, when — your black-and-white record |
| `Categories` | Hoarding / Visual / Reinstatement / Renovation |
| `Requirements` | the guideline items per mall (Door 2) |
| `JobCategories` | panel contractor specializations |
| `Panels` | panel contractor companies |
| `PanelRates` | their rates per mall, from past engagement |

You can edit any of these in the app (Door 2) **or** straight in the sheet — same data.

---

## Door 2 — Requirement Lookup + Panel rate book

Five sub-tabs inside the app:

1. **🔎 Lookup** — staff pick mall + shop type → all requirements + panel contractor comparison (cheapest first). Built for zero-knowledge staff.
2. **📋 Requirements** — add / edit / delete the guideline items per mall.
3. **🏬 Malls** — add / edit / delete malls + details.
4. **🏢 Panel Rates** — add panel contractor companies, then their rates per mall + job category.
5. **⚙ Lists** — manage the Categories and Panel job-category dropdowns.

Seeded with the real **SCM** example from your mall guideline PDFs (hoarding spec, RM2mil insurance, Forms C/D, etc.) plus two **sample** panel contractors so the comparison table shows live. Replace the samples with your real panels.

---

## Notes

- Keep each file under ~40 MB (Apps Script limit). Phone photos and PDFs are fine.
- Renamed a mall folder by hand in Drive? Rename it back, or the next upload makes a new one.
- When you change Code.gs or Index.html later → **Deploy → Manage deployments →
  edit (pencil) → Version: New version → Deploy.** Same URL stays live.

---

## Updating to a new version (e.g. after Door 2)

1. Paste the new **Code.gs** and **Index.html** over the old ones → **Ctrl+S**.
2. Run **setup** once more. It only **adds** new tabs and seed data — it never wipes what you've entered.
3. **Deploy → Manage deployments → ✏ pencil → Version: New version → Deploy.** Same URL stays live.

---

## Door 3 — HIRARC + Method of Statement generator

Two sub-tabs:

1. **📝 Generate** — fill the header (project, ref no., date, duration), tick the services, hit **Generate**. The system builds a full SWMS: scope, equipment, PPE, work-sequence Method of Statement, and the HIRARC risk table (Impact × Likelihood, colour-coded). **Print / Save PDF** button included.
2. **🗂 Templates** — add / edit / delete the building blocks: SWMS services, steps + HIRARC (hazards, controls, impact, likelihood), equipment, PPE.

**Combining services merges automatically.** Tick Hoarding + Visual → shared steps (loading bay, barricade, ladder, cleanup…) appear once; only the install steps stay separate. No confusing duplicates.

Seeded with your real **TRX / Lendlease** hoarding + visual SWMS — 12 steps, full HIRARC. Add Reinstatement / Scaffold / Brick wall etc. as you go.

---

## Door 4 — Measurement Request Tracker (🎯 tab)

Kills the "forgot to send quotation" leak.

1. **Log a request** — mall, lot, client, who to attention, what to measure, purpose, remarks.
2. **Auto WhatsApp message** — built in your exact format. **Copy** → paste into the group chat.
3. **Track it** — Requested → Measured → **Quotation Sent** (or Reference only → Closed).
4. **Flag** — anything *measured but not quoted* shows a banner + amber highlight, with a "⚠ Needs quotation" filter. Nothing slips.
5. Same lot, several clients = separate rows, each tracking its own quote.
6. **🗂 Drawings** button on each request jumps to the Vault filtered to that mall + lot.

Manage the **Attention-to** list (Calvin…) and **Measure-for** options under Requirement Lookup → ⚙ Lists.

---

## Next

- Photos in Door 1 (deferred), rename-cascade for malls, WhatsApp API / Odoo hooks.
