// No-login job-completion proof uploads (HG Ops v1).
// The token IS the auth: staff mint a link per job, WhatsApp it to the driver/worker,
// they open it on a phone and upload photos. No account needed (worker logins come later).
//
//   GET  /proof/:token   → tiny self-contained mobile upload page (or a plain "link expired" page)
//   POST /proof/:token   → multipart "photos" (≤6 × 10MB) + name + notes
//                          → files saved to the jcr bucket, ja_job_completions row,
//                            ja_jobs.job_status = 'completed'
// Minting (auth'd, used by hg-ops.html): POST /api/rpc/ops_proof_link is registered in rpc.js? No —
// simpler: POST /proof-mint (requireAuth) lives here too, mounted under /api by app.js.

const express = require("express");
const crypto = require("crypto");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { pool } = require("./db");
const { requireAuth } = require("./auth");

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, "..", "uploads");
const PUBLIC_BASE = process.env.UPLOADS_PUBLIC_BASE || "/uploads";

function klNowSql() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 6 } });

// crude in-memory rate limit per IP (no-auth surface)
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now); hits.set(ip, arr);
  return arr.length > 30;
}

async function loadToken(token) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(String(token || ""))) return null;
  const [rows] = await pool.query("SELECT * FROM ja_proof_tokens WHERE token = ?", [token]);
  const t = rows[0];
  if (!t) return null;
  if (t.expires_at && new Date(String(t.expires_at).replace(" ", "T")) < new Date(Date.now() + 8 * 3600 * 1000)) return null;
  return t;
}

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function page(body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>HG — Job Completion</title><style>
body{font-family:system-ui,sans-serif;background:#10151d;color:#eef2f7;margin:0;padding:20px;display:flex;justify-content:center}
.card{max-width:430px;width:100%;background:#1a2230;border:1px solid #2c3a4f;border-radius:16px;padding:22px}
h1{font-size:1.15rem;margin:0 0 6px}p{color:#9fb0c3;font-size:.9rem;margin:6px 0}
.job{background:#141b26;border:1px solid #2c3a4f;border-radius:10px;padding:12px;margin:14px 0;font-size:.92rem;line-height:1.5}
input[type=text],textarea{width:100%;box-sizing:border-box;background:#141b26;color:#eef2f7;border:1px solid #2c3a4f;border-radius:9px;padding:11px;font-size:1rem;margin:6px 0}
input[type=file]{margin:10px 0;color:#9fb0c3;width:100%}
button{width:100%;background:#22c55e;color:#08130b;font-weight:700;font-size:1.05rem;border:0;border-radius:11px;padding:14px;margin-top:10px}
.ok{color:#22c55e;font-weight:700}.err{color:#f87171;font-weight:600}
img.pv{width:31%;border-radius:8px;margin:1%}</style></head><body><div class="card">${body}</div></body></html>`;
}

const router = express.Router();

// ---- public: the upload page ----------------------------------------------
router.get("/:token", async (req, res) => {
  try {
    if (limited(req.ip)) return res.status(429).send(page("<h1>Too many requests</h1><p>Try again in a minute.</p>"));
    const t = await loadToken(req.params.token);
    if (!t) return res.status(404).send(page("<h1>Link expired</h1><p>Ask the office for a new completion link.</p>"));
    const [[job]] = await pool.query(
      "SELECT id, scope, title, mall, lot, date, time, job_status FROM ja_jobs WHERE id = ?", [t.job_id]);
    if (!job) return res.status(404).send(page("<h1>Job not found</h1>"));
    const done = job.job_status === "completed";
    res.send(page(`
      <h1>Job Completion ${done ? "<span class='ok'>— already submitted ✓</span>" : ""}</h1>
      <div class="job"><b>${esc(job.scope || job.title || "Job")}</b><br>
        ${esc(job.mall || "")}${job.lot ? " · Lot " + esc(job.lot) : ""}<br>
        ${esc(String(job.date || "").slice(0, 10))} ${esc(job.time || "")}</div>
      <form method="post" enctype="multipart/form-data">
        <p>Take photos of the completed work (up to 6):</p>
        <input type="file" name="photos" accept="image/*" capture="environment" multiple required>
        <input type="text" name="name" placeholder="Your name" required>
        <textarea name="notes" rows="2" placeholder="Notes (optional)"></textarea>
        <button type="submit">Submit completion ✓</button>
      </form>`));
  } catch (e) { res.status(500).send(page("<h1>Error</h1><p>" + esc(e.message) + "</p>")); }
});

// ---- public: receive the proof --------------------------------------------
router.post("/:token", upload.array("photos", 6), async (req, res) => {
  try {
    if (limited(req.ip)) return res.status(429).send(page("<h1>Too many requests</h1>"));
    const t = await loadToken(req.params.token);
    if (!t) return res.status(404).send(page("<h1>Link expired</h1><p>Ask the office for a new link.</p>"));
    if (!req.files || !req.files.length) return res.status(400).send(page("<h1 class='err'>No photos</h1><p>Go back and attach at least one photo.</p>"));
    const urls = [];
    for (const f of req.files) {
      if (!/^image\//.test(f.mimetype || "")) continue;
      const rel = t.job_id + "/" + Date.now() + "-" + Math.random().toString(36).slice(2, 7) +
                  (path.extname(f.originalname || "") || ".jpg");
      const dest = path.join(UPLOADS_DIR, "jcr", rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, f.buffer);
      urls.push(`${PUBLIC_BASE}/jcr/${rel}`);
    }
    if (!urls.length) return res.status(400).send(page("<h1 class='err'>Images only</h1>"));
    const now = klNowSql();
    const name = String(req.body.name || "").slice(0, 120);
    await pool.query(
      "INSERT INTO ja_job_completions (job_id, submitted_at, submitted_name, photos, notes, via_token) VALUES (?,?,?,?,?,?)",
      [t.job_id, now, name, JSON.stringify(urls), String(req.body.notes || "").slice(0, 1000), t.token]);
    await pool.query("UPDATE ja_jobs SET job_status='completed', updated_at=? WHERE id=?", [now, t.job_id]);
    await pool.query("UPDATE ja_proof_tokens SET used_at=? WHERE token=?", [now, t.token]);
    await pool.query("INSERT INTO ja_audit_log (ts, user_email, action, details) VALUES (?,?,?,?)",
      [now, "site:" + name, "Job completion proof", t.job_id + " · " + urls.length + " photo(s)"]);
    res.send(page("<h1 class='ok'>Submitted ✓</h1><p>Thank you, " + esc(name) + ". The office can see the proof now.</p>" +
      urls.map(u => `<img class="pv" src="${esc(u)}">`).join("")));
  } catch (e) { res.status(500).send(page("<h1 class='err'>Failed</h1><p>" + esc(e.message) + "</p>")); }
});

// ---- auth'd: mint a link (mounted at /api/proof-mint by app.js) ------------
const mintRouter = express.Router();
mintRouter.post("/", requireAuth, async (req, res) => {
  try {
    const jobId = String((req.body || {}).job_id || "");
    if (!jobId) return res.status(400).json({ error: { message: "job_id required" } });
    const [[job]] = await pool.query("SELECT id FROM ja_jobs WHERE id = ?", [jobId]);
    if (!job) return res.status(404).json({ error: { message: "job not found" } });
    // reuse a live token if one exists
    const [ex] = await pool.query(
      "SELECT token FROM ja_proof_tokens WHERE job_id=? AND (expires_at IS NULL OR expires_at > ?) LIMIT 1",
      [jobId, klNowSql()]);
    let token = ex[0] && ex[0].token;
    if (!token) {
      token = crypto.randomBytes(18).toString("base64url");
      const exp = new Date(Date.now() + 8 * 3600 * 1000 + 14 * 86400000).toISOString().slice(0, 19).replace("T", " ");
      await pool.query(
        "INSERT INTO ja_proof_tokens (token, job_id, created_at, expires_at, created_by) VALUES (?,?,?,?,?)",
        [token, jobId, klNowSql(), exp, req.user.email]);
    }
    res.json({ data: { token, url: "/proof/" + token } });
  } catch (e) { res.status(500).json({ error: { message: e.message } }); }
});

module.exports = { router, mintRouter };
