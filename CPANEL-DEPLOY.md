# HG Hub — cPanel deployment

One Node app serves everything (site + API + uploads) at `hggrouphub.com`. MySQL holds the data.

The three upload files are generated on the build PC under `deploy/` (NOT in git — they hold
production data + secrets):
- `deploy/hghub-database.sql` — full structure + your production data (one import)
- `deploy/hghub-app.zip` — the app (server code + built site + `.env`), no node_modules
- (`.env` is already inside the zip)

---

## 1 · Database (phpMyAdmin)
1. cPanel → **phpMyAdmin**.
2. Left list → click **`hggrouph_hghub`**.
3. Top tab **Import** → **Choose File** → `deploy/hghub-database.sql` → **Go**.
4. Wait for the green "Import has been successfully finished" (190 tables).

## 2 · App files (File Manager)
1. cPanel → **File Manager** → go to your home dir → create folder **`hghub`**.
2. Enter `hghub` → **Upload** → `deploy/hghub-app.zip`.
3. Back in File Manager, select the zip → **Extract** → into `hghub`.
   (You should see `app.js`, `.env`, `public/`, `rpcs/` directly inside `hghub`.)

## 3 · Node.js app (Setup Node.js App)
1. cPanel → **Setup Node.js App** → **Create Application**.
2. Fields:
   - **Node.js version**: newest 18+ offered
   - **Application mode**: Production
   - **Application root**: `hghub`
   - **Application URL**: `hggrouphub.com`  (root of the domain)
   - **Application startup file**: `app.js`
3. **Create**.
4. On the app's page click **Run NPM Install** (installs express, mysql2, etc.).
5. Click **Restart** (or Start).

## 4 · First admin login
On the **Setup Node.js App** page, copy the "Enter to the virtual environment" command
(looks like `source /home/hggrouph/nodevenv/hghub/18/bin/activate && cd …/hghub`).
cPanel → **Terminal**, paste it, then run (pick your own password):
```bash
node seed-admin.js lee@hggroup.com.my "YourStrongPassword" "Black Lee"
```
That email + password is your login. Re-run anytime to reset the password.

## 5 · Verify
Open **https://hggrouphub.com** → email + password login → hub with tools + live data.
- SSL must be on (cPanel AutoSSL) — the login cookie needs HTTPS. If login silently fails on
  `http://`, enable SSL for the domain (usually automatic) and use `https://`.

## 6 · Daily alarms cron (optional)
cPanel → **Cron Jobs** → add, 8:00 AM daily:
```
curl -s -H "x-cron-secret: <CRON_SECRET from .env>" https://hggrouphub.com/api/cron/daily-alarms >/dev/null
```

---

### Updating later
- Frontend/tool change → re-run `node prepare-public.js` locally, re-zip `public/`, re-upload, Restart.
- Backend change → upload changed `server/*.js`, Restart the Node app.
- Data changes stay in MySQL (phpMyAdmin) — never re-import the data file unless resetting.

### Notes
- `.env` in the app holds DB creds + Gemini key + JWT/CRON secrets. Keep it private.
- Add a read-only MySQL user later (`DB_RO_USER`) to harden the AI SQL runner.
