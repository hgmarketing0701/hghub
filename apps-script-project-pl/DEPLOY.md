# Project Revenue vs Expenses — Deploy Guide

**v3.8** — adds **In-House Material → Subcon Deduction** on the Material form:
> When HG sells own factory stock to a subcon and nets the value off the subcon's bill, pick **In-House → Deduct from Subcon** in the new Material Source dropdown, then pick which subcon it's charged to.
> - The material amount does **NOT** count as Material Cost on the project P&L (HG already owns the stock).
> - The subcon's **Committed** amount is reduced by the in-house material total.
> - **Outstanding (Subcon)** on the dashboard auto-nets the deduction.
> - In-house rows are highlighted yellow on the Materials table and show "In-House → [Subcon Name]" instead of supplier.

**v3.1** — adds **Role-Based Access Control** (RBAC): 4 roles (Admin / Manager / Editor / Viewer), `UserRoles` sheet, per-permission UI hiding, server-side enforcement on every save/delete. Bootstrap admin hardcoded as `lee@hggroup.com.my`. Manage users from **Setup → User Roles**.

> 🔒 **What each role can do:**
> - **Admin** — full access including managing other users' roles.
> - **Manager** — everything except User Roles: full project + financial + master-list access, can delete projects.
> - **Editor** — projects, job scopes, materials, manpower, photos, daily reports, file uploads. **CANNOT see money** (no Profit/Margin cards, no Payments tabs, no Outstanding columns).
> - **Viewer** — read-only operational data only. Cannot edit anything, no money visibility.
>
> The first time you deploy v3.1, all team members except `lee@hggroup.com.my` become Viewers. Go to **Setup → User Roles** and add Manager/Editor assignments for the right people.

**v2.3** — adds In-House Building Maintenance flow: Sub-Category lookup (Upgrading / Repair / Replacement / New), In-House Workers master list, Manpower section with In-House or Subcon assignments + days × rate cost, Before/After photo sections with **native drag-and-drop upload to Drive**.

> ⚠️ **v2.3 introduces a new OAuth scope** (`drive.file`) — when you redeploy, Google will prompt for re-authorization. Each team member opening the web app for the first time on v2.3 will also see the consent screen once. Approve it — the scope is scoped (the script can only see files it creates).

**v2.0** — adds Clients/Buildings/Subcons/Suppliers/Material Items master lists, lookup-managed dropdowns, supervisor, file URLs, supplier payments, lump-sum subcon charges, dashboard filters/CSV/outstanding tables.

Same pattern as your Inventory tool (`apps-script/`). 5 steps, ~10 minutes.

> **Upgrading from v1?** Safe — `ensureSheets_` only **adds** missing columns and missing tabs. Your v1 data stays intact. After re-deploy, walk into **Setup / Master Lists** and add Clients / Buildings / Subcons / Suppliers, then re-open each existing project to pick the right entries from the dropdowns.

---

## Step 1. Create the Google Sheet

1. Open Google Drive (signed in as your `@hggroup.com.my` account)
2. New → Google Sheets → blank
3. Rename it: **Black Lee — Project P&L**
4. Move it into your shared `HG Group` Drive folder so your team can access

The script will auto-create these tabs on first load:

**Transaction tabs:**
- `Projects`
- `JobScopes`
- `Materials`
- `ClientPayments`
- `SubconPayments`
- `SupplierPayments` *(new in v2.0)*
- `SubconCharges` *(lump-sum arrangements)*

**Master list tabs:**
- `Clients`
- `Buildings`
- `Subcons`
- `Suppliers`
- `MaterialItems`
- `Lookups` *(Category, ProjectStatus, JobStatus, ClientPaymentStatus, JobScopeUnit, MaterialUnit)*

**Audit:**
- `AuditLog`

Lookups are seeded with your 6 service-line categories + sensible defaults on first run.

---

## Step 2. Open Apps Script editor

1. In the sheet → **Extensions → Apps Script**
2. A new tab opens with `Code.gs` (default empty)
3. Rename the project at the top: **Project P&L — Web App**

---

## Step 3. Paste in the 3 files

Copy from `apps-script-project-pl/` in this folder.

### File A: `Code.gs`
- Replace the default `Code.gs` content with the contents of `Code.gs`

### File B: `Index.html`
- In the Apps Script editor: click **+** → **HTML** → name it **Index** (capital I, no `.html`)
- Paste the contents of `Index.html`

### File C: `appsscript.json` (manifest)
- In the Apps Script editor: ⚙ **Project Settings** (gear icon, left side)
- Tick **"Show 'appsscript.json' manifest file in editor"**
- Back to the editor, click **appsscript.json**
- Replace contents with the contents of `appsscript.json`

Save all (`Ctrl + S`).

---

## Step 4. Deploy as Web App

1. Top right → **Deploy → New deployment**
2. Gear icon next to "Select type" → **Web app**
3. Settings:
   - **Description:** `v1.0 — initial`
   - **Execute as:** `Me (your.email@hggroup.com.my)`
   - **Who has access:** `Anyone within HG Group` (this is your Workspace domain restriction)
4. Click **Deploy**
5. First time only: it asks for permissions → **Authorize access** → pick your `@hggroup.com.my` account → **Allow**
6. Copy the **Web app URL** that appears. That's the link you share with your team.

---

## Step 5. Test

1. Open the Web app URL in a new tab.
2. You should see the dashboard with your email in the green pill and 12 summary cards (all zero).
3. Go to **Setup / Master Lists**:
   - Add a Client: `ABC Sdn Bhd`
   - Add a Building: `Avenue K`
   - Add a Subcon: `Painting Subcon A`
   - Add a Material Item + Supplier if you want to test that flow
4. Go to **Projects → + New Project**:
   - Client: `ABC Sdn Bhd` (from dropdown)
   - Building: `Avenue K` (from dropdown)
   - Category: `Fit-Out`
   - Status: `Active`
   - Supervisor: `Your supervisor name`
   - Invoice Amount: `20500`
5. **Save Project Info**
6. Add a Job Scope:
   - Description: `Painting external ducting`
   - Qty: `1`, Unit: `lot`
   - Client Rate: `20500`
   - Subcon: `Painting Subcon A`
   - Subcon Rate: `7200`
7. Save → P&L shows **Profit RM 13,300 · Margin 64.88%** (matches your sample sheet)
8. Test the **lump-sum** scenario: add 4 job scopes with client rates 4000 / 3000 / 300 / 6500 and Subcon Rate = 0 on each. Then in **Subcon Charges**, add one lump charge: pick the subcon, lump amount `8000`, tick all 4 scopes. Save. Each scope's "Lump Allocation" column now shows the pro-rated share (≈ 2,319 / 1,739 / 174 / 3,768).

## File uploads (subcon / supplier invoices, payment slips)

v2.0 stores **Google Drive share URLs** in the file fields. Workflow:

1. Upload the photo/PDF to your shared Drive folder.
2. Right-click → **Get link** → **Copy link**.
3. Paste into the URL field on the form.
4. The tool detects Drive URLs and shows a thumbnail (images) or 📎 View link (PDFs).

Native one-click upload from the form is planned for v2.1 (needs Drive scope expansion — same trade-off you already navigated on the Inventory tool).

---

## What this tool gives you

| Pain | Before | Now |
|---|---|---|
| Per-job P&L | Manual sheet per project, no rollup | Live dashboard across all projects |
| Outstanding client owe | Hidden in payment columns | One number, red if > 0 |
| Outstanding to subcons | Tracked in WhatsApp screenshots | Auto-calc from job scopes − payments |
| Materials per job scope | Mixed with everything | Each material linked to a scope |
| Multi-user, daily entry | Sheets racing, no audit trail | Domain-locked, every save logged |

---

## Team access (Step 5b)

Once deployed:

1. Send the Web app URL to your team via WhatsApp.
2. They click it → Google asks them to sign in → they MUST use `@hggroup.com.my`.
3. Anyone outside the domain gets "Access denied" with no data leak.
4. Everything they do is logged in the `AuditLog` tab (timestamp + email + action + record).

---

## Updating later (versioning)

When you change `Code.gs` or `Index.html`:

1. Apps Script editor → **Deploy → Manage deployments**
2. Pencil (edit) icon on the active deployment
3. Version: **New version** → Description: `v1.1 — what changed`
4. Deploy

The URL stays the same. No need to resend to your team.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "No bound spreadsheet found" | Make sure you opened Apps Script via Extensions → Apps Script from inside the Sheet (not script.google.com fresh) |
| Access denied for your own email | Check the email is `your.name@hggroup.com.my`, not a personal `@gmail.com`. Sign out of personal Google, re-open URL. |
| Dashboard shows zeros after data entry | Click ↻ Refresh, or hard-reload (Ctrl+Shift+R) |
| Sheet headers got out of order | Don't reorder columns in the Sheet manually — the script writes by column index |
| Drive URL doesn't preview | The link must be sharable. Right-click in Drive → Share → set to "Anyone in HG Group with the link can view" |
| "Cannot delete: still referenced by X record(s)" | Master records (Clients/Subcons/etc) are blocked from deletion when used. Either rename them (Edit) or remove the referencing records first |
| Lump-sum charge math looks wrong | Make sure per-line Subcon Rate is `0` on scopes covered by the lump. Otherwise both are summed |

---

Built 2026-05-21. Architecture mirrors `apps-script/` (Inventory v2.0c).
