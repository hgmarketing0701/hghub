# Expenses Receipt System — Deploy

Apps Script web app + bound Google Sheet. AI reads receipts, you tag Business/Personal, print claim PDF.

---

## What you get

1. Upload many receipts **or** snap photos — or both.
2. Gemini Vision reads each one (vendor, date, amount, description, category).
3. Everything lands in one table.
4. Filter the table by month.
5. Print the table to PDF (saved to Drive + browser print).
6. Per-row **Business / Personal** dropdown. The Business PDF is your HR claim.
7. Private — each staff sees **only their own** receipts. You (`lee@hggroup.com.my`) see everyone.

---

## Setup — 8 steps

1. Open Google Drive → **New → Google Sheets** → name it `Black Lee — Expenses`.
2. In the Sheet: **Extensions → Apps Script**.
3. Delete the default `Code.gs` content. Paste in `Code.gs` from this folder.
4. **+ → HTML** file, name it exactly `Index` → paste `Index.html`.
5. **Project Settings (⚙) → Show appsscript.json** ON. Open `appsscript.json`, paste this folder's version over it.
6. Get a **Gemini API key** → https://aistudio.google.com/apikey (free tier is fine).
   - **Project Settings → Script Properties → Add property**
   - Name: `GEMINI_API_KEY`  ·  Value: your key  → Save.
7. Back in the editor, run the `setupConfig` function once (pick it from the dropdown → **Run**). Approve the permissions when asked. This creates the sheet tabs + Drive folder.
8. **Deploy → New deployment → Web app**
   - Description: `Expenses v1`
   - **Execute as: User accessing the web app**  ← important for privacy
   - **Who has access: Anyone within hggroup.com.my**
   - Deploy → copy the web app URL.

> **Execute as "User accessing"** is what makes the privacy work — the app sees who is signed in and shows only their rows. Admin = whoever is listed in `ADMIN_EMAILS` at the top of `Code.gs`.

---

## Daily use

- Open the URL → **Add receipts** → Analyze → check the fields → **Save to table**.
- Tag each row **Business** or **Personal** anytime (auto-saves).
- Pick a **Month** + **Type = Business** → **Generate PDF** → send that PDF to HR.

---

## Admin (you)

- You see a `★ ADMIN` badge and a **Staff** filter to view any person's receipts.
- You can generate a PDF for any staff member (pick them in the Staff dropdown first).
- Everyone else only ever sees their own — enforced on the server, not just the screen.

---

## Where files live (Drive)

```
Black Lee — Expenses/
  ├─ lee@hggroup.com.my/      ← each person's receipt images
  ├─ ainaa@hggroup.com.my/
  └─ _Reports/                 ← generated PDF claims/reports
```

---

## Change the admin list

Top of `Code.gs`:

```js
const ADMIN_EMAILS = ['lee@hggroup.com.my'];   // add more inside the brackets
```

Add categories or change the AI model in the same CONFIG block. Re-deploy after edits:
**Deploy → Manage deployments → edit (✏) → Version: New version → Deploy.**
