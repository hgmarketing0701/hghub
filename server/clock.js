// Worker self-clock (HG Ops attendance slice).
// Every worker clocks for THEMSELVES: selfie required, SERVER KL timestamp, GPS recorded.
// AI face-check runs async and FLAGS mismatches for admin review — it never blocks a punch.
//
//   GET  /clock/:token      no-login mobile page (worker name + state-aware IN/OUT button)
//   POST /clock/:token      multipart selfie + gps → ja_clock_events + roll-up into
//                           ja_attendance_log (the wage engine's table; legacy row model:
//                           id at_<worker>_<date>_<category>, next_day_out overnight flag)
//   POST /api/clock/links   (admin) ensure/rotate tokens for all ja_workers → [{worker,url}]
//   POST /api/clock/review  (admin) {event_id, action:'approve'|'reject'}
//
// Category rule (legacy): worker's job membership that op-date decides day/night;
// fallback by hour (>=18:00 or <06:00 → night). An 'out' before 06:00 with no open
// same-day row closes YESTERDAY's night row (next_day_out=1).

const express = require("express");
const crypto = require("crypto");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { pool } = require("./db");
const { requireAuth, requireAdmin } = require("./auth");

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, "..", "uploads");
const PUBLIC_BASE = process.env.UPLOADS_PUBLIC_BASE || "/uploads";
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

function klDate() { return new Date(Date.now() + 8 * 3600 * 1000); }
function klNowSql() { return klDate().toISOString().slice(0, 19).replace("T", " "); }
function klToday() { return klDate().toISOString().slice(0, 10); }
function hhmmNow() { return klDate().toISOString().slice(11, 16); }
function addDays(iso, n) { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now); hits.set(ip, arr);
  return arr.length > 20;
}

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function page(body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>HG — Clock</title><style>
body{font-family:system-ui,sans-serif;background:#10151d;color:#eef2f7;margin:0;padding:20px;display:flex;justify-content:center}
.card{max-width:430px;width:100%;background:#1a2230;border:1px solid #2c3a4f;border-radius:16px;padding:22px;text-align:center}
h1{font-size:1.2rem;margin:0 0 4px}.sub{color:#9fb0c3;font-size:.9rem;margin:4px 0 14px}
.time{font-size:2.2rem;font-weight:800;letter-spacing:.02em;margin:6px 0 2px}
.state{color:#9fb0c3;font-size:.85rem;margin-bottom:16px}
input[type=file]{display:none}
.snapbtn{display:block;width:100%;background:#22c55e;color:#08130b;font-weight:800;font-size:1.15rem;border:0;border-radius:12px;padding:18px;cursor:pointer}
.snapbtn.out{background:#f59e0b;color:#1a1205}
.hint{color:#9fb0c3;font-size:.8rem;margin-top:12px;line-height:1.5}
.ok{color:#22c55e;font-weight:700}.err{color:#f87171;font-weight:600}
img.pv{max-width:60%;border-radius:10px;margin-top:10px}</style></head><body><div class="card">${body}</div></body></html>`;
}

async function loadToken(token) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(String(token || ""))) return null;
  const [rows] = await pool.query("SELECT * FROM ja_clock_tokens WHERE token=? AND active=1", [token]);
  return rows[0] || null;
}

// operational punch resolution: which attendance row does this punch belong to
async function resolvePunch(workerId) {
  const today = klToday();
  const hh = parseInt(hhmmNow().slice(0, 2), 10);
  // early-morning 'out': is there an OPEN night row from yesterday?
  if (hh < 6) {
    const yid = "at_" + workerId + "_" + addDays(today, -1) + "_night";
    const [[yrow]] = await pool.query("SELECT * FROM ja_attendance_log WHERE id=?", [yid.replace(/\s+/g, "_")]);
    if (yrow && yrow.clock_in && !yrow.clock_out) return { opDate: addDays(today, -1), category: "night", row: yrow };
  }
  // category from job membership on the op date (the spine decides day/night)
  let category = null;
  const [jobs] = await pool.query("SELECT shift, worker_ids FROM ja_jobs WHERE date=? LIMIT 400", [today]);
  for (const j of jobs) {
    let ids = j.worker_ids;
    if (typeof ids === "string") { try { ids = JSON.parse(ids); } catch { ids = []; } }
    if (Array.isArray(ids) && ids.includes(workerId)) {
      category = /^night/.test(String(j.shift || "")) ? "night" : "day";
      break;
    }
  }
  if (!category) category = (hh >= 18 || hh < 6) ? "night" : "day";
  const id = ("at_" + workerId + "_" + today + "_" + category).replace(/\s+/g, "_");
  const [[row]] = await pool.query("SELECT * FROM ja_attendance_log WHERE id=?", [id]);
  return { opDate: today, category, row: row || null };
}

// async, never blocks the punch
async function faceCheck(eventId, selfieAbs, workerId) {
  try {
    if (!GEMINI_KEY) return;
    const [rows] = await pool.query(
      "SELECT photo_url FROM hg_workers WHERE status='active' AND (id=? OR name_norm=(SELECT LOWER(TRIM(name)) FROM ja_workers WHERE id=? LIMIT 1)) LIMIT 1",
      [workerId, workerId]);
    let refUrl = rows[0] && rows[0].photo_url;
    if (!refUrl) {
      await pool.query("UPDATE ja_clock_events SET face_verdict='unclear', face_notes='No roster photo on file — first selfie becomes provisional reference' WHERE id=?", [eventId]);
      return;
    }
    const refAbs = refUrl.startsWith(PUBLIC_BASE + "/") ? path.join(UPLOADS_DIR, refUrl.slice(PUBLIC_BASE.length + 1)) : null;
    if (!refAbs || !fs.existsSync(refAbs)) {
      await pool.query("UPDATE ja_clock_events SET face_verdict='unclear', face_notes='Roster photo not accessible for comparison' WHERE id=?", [eventId]);
      return;
    }
    const parts = [
      { inlineData: { mimeType: "image/jpeg", data: fs.readFileSync(selfieAbs).toString("base64") } },
      { inlineData: { mimeType: "image/jpeg", data: fs.readFileSync(refAbs).toString("base64") } },
      { text: 'First image = clock-in selfie taken now on site (possibly dark/blurry). Second = the worker\'s roster photo. Are they the SAME PERSON? Answer strict JSON: {"verdict":"match"|"mismatch"|"unclear","reason":"one short line"}. Be lenient about lighting/angle/helmet; "mismatch" only when clearly a different person.' }
    ];
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { temperature: 0, maxOutputTokens: 200, responseMimeType: "application/json" } }) });
    if (!res.ok) throw new Error("Gemini " + res.status);
    const j = await res.json();
    const txt = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
    let out; try { out = JSON.parse(txt.replace(/^```(json)?|```$/g, "").trim()); } catch { out = { verdict: "unclear", reason: "AI reply unreadable" }; }
    const v = ["match", "mismatch", "unclear"].includes(out.verdict) ? out.verdict : "unclear";
    await pool.query("UPDATE ja_clock_events SET face_verdict=?, face_notes=? WHERE id=?", [v, String(out.reason || "").slice(0, 500), eventId]);
  } catch (e) {
    try { await pool.query("UPDATE ja_clock_events SET face_verdict='unclear', face_notes=? WHERE id=?", ["check failed: " + String(e.message).slice(0, 200), eventId]); } catch {}
  }
}

const router = express.Router();

router.get("/:token", async (req, res) => {
  try {
    if (limited(req.ip)) return res.status(429).send(page("<h1>Too many requests</h1>"));
    const t = await loadToken(req.params.token);
    if (!t) return res.status(404).send(page("<h1>Link not valid</h1><p class='sub'>Ask the office for your clock link.</p>"));
    const [[wk]] = await pool.query("SELECT id, name FROM ja_workers WHERE id=?", [t.worker_id]);
    if (!wk) return res.status(404).send(page("<h1>Worker not found</h1>"));
    const p = await resolvePunch(wk.id);
    const goingOut = !!(p.row && p.row.clock_in && !p.row.clock_out);
    const kind = goingOut ? "out" : "in";
    const stateLine = goingOut
      ? "Clocked in " + esc(p.row.clock_in) + " (" + esc(p.category) + " shift, " + esc(p.opDate) + ") — time to clock OUT"
      : "Not clocked in yet for the " + esc(p.category) + " shift";
    res.send(page(`
      <h1>${esc(wk.name)}</h1>
      <div class="sub">HG attendance — selfie + time + location are recorded</div>
      <div class="time" id="clk">--:--</div>
      <div class="state">${stateLine}</div>
      <form id="f" method="post" enctype="multipart/form-data">
        <input type="hidden" name="kind" value="${kind}">
        <input type="hidden" name="lat" id="lat"><input type="hidden" name="lng" id="lng"><input type="hidden" name="acc" id="acc">
        <input type="file" name="selfie" id="selfie" accept="image/*" capture="user">
        <button type="button" class="snapbtn ${kind}" onclick="document.getElementById('selfie').click()">
          📸 ${kind === "out" ? "Clock OUT" : "Clock IN"} — take selfie</button>
      </form>
      <div class="hint">Tapping opens your camera. The photo + exact server time + GPS are saved. One tap, done.</div>
      <script>
        function tick(){var d=new Date(Date.now()+ (8*3600000) + (new Date().getTimezoneOffset()*60000));document.getElementById('clk').textContent=d.toTimeString().slice(0,5);}
        tick();setInterval(tick,10000);
        navigator.geolocation && navigator.geolocation.getCurrentPosition(function(p){
          document.getElementById('lat').value=p.coords.latitude.toFixed(6);
          document.getElementById('lng').value=p.coords.longitude.toFixed(6);
          document.getElementById('acc').value=Math.round(p.coords.accuracy||0);
        },function(){},{enableHighAccuracy:true,timeout:8000});
        document.getElementById('selfie').addEventListener('change',function(){ if(this.files.length) document.getElementById('f').submit(); });
      </script>`));
  } catch (e) { res.status(500).send(page("<h1 class='err'>Error</h1><p>" + esc(e.message) + "</p>")); }
});

router.post("/:token", upload.single("selfie"), async (req, res) => {
  try {
    if (limited(req.ip)) return res.status(429).send(page("<h1>Too many requests</h1>"));
    const t = await loadToken(req.params.token);
    if (!t) return res.status(404).send(page("<h1>Link not valid</h1>"));
    if (!req.file || !/^image\//.test(req.file.mimetype || "")) return res.status(400).send(page("<h1 class='err'>No selfie</h1><p class='sub'>Go back and take the photo.</p>"));
    const [[wk]] = await pool.query("SELECT id, name FROM ja_workers WHERE id=?", [t.worker_id]);
    if (!wk) return res.status(404).send(page("<h1>Worker not found</h1>"));
    const p = await resolvePunch(wk.id);
    const kind = (String(req.body.kind) === "out" || (p.row && p.row.clock_in && !p.row.clock_out)) ? "out" : "in";
    const now = klNowSql(), hm = hhmmNow();
    // selfie to disk
    const rel = wk.id + "/" + p.opDate + "-" + kind + "-" + Date.now() + ".jpg";
    const abs = path.join(UPLOADS_DIR, "attendance", rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, req.file.buffer);
    const selfieUrl = PUBLIC_BASE + "/attendance/" + rel;
    // evidence event
    const lat = req.body.lat ? parseFloat(req.body.lat) : null;
    const lng = req.body.lng ? parseFloat(req.body.lng) : null;
    const [ev] = await pool.query(
      "INSERT INTO ja_clock_events (worker_id, worker_name, op_date, category, kind, ts, selfie_url, gps_lat, gps_lng, gps_acc, face_verdict, device_info, via_token) VALUES (?,?,?,?,?,?,?,?,?,?,'pending',?,?)",
      [wk.id, wk.name, p.opDate, p.category, kind, now, selfieUrl, lat, lng,
       req.body.acc ? parseInt(req.body.acc, 10) : null,
       String(req.headers["user-agent"] || "").slice(0, 250), t.token]);
    // roll-up into the WAGE table (legacy row model)
    const rowId = ("at_" + wk.id + "_" + p.opDate + "_" + p.category).replace(/\s+/g, "_");
    if (kind === "in") {
      if (p.row) {
        await pool.query("UPDATE ja_attendance_log SET clock_in=COALESCE(NULLIF(clock_in,''),?), source='self-clock' WHERE id=?", [hm, rowId]);
      } else {
        await pool.query(
          "INSERT INTO ja_attendance_log (id, worker_id, worker_name, date, category, clock_in, clock_out, next_day_out, raw_events, source, created_at, created_by) VALUES (?,?,?,?,?,?,'',0,?, 'self-clock', ?, 'clock-page')",
          [rowId, wk.id, wk.name, p.opDate, p.category, hm, JSON.stringify([ev.insertId]), now]);
      }
    } else {
      const nextDay = p.opDate !== klToday() ? 1 : 0; // early-morning out closing yesterday's night
      if (p.row) {
        await pool.query("UPDATE ja_attendance_log SET clock_out=?, next_day_out=?, source='self-clock' WHERE id=?", [hm, nextDay, rowId]);
      } else {
        await pool.query(
          "INSERT INTO ja_attendance_log (id, worker_id, worker_name, date, category, clock_in, clock_out, next_day_out, raw_events, source, created_at, created_by) VALUES (?,?,?,?,?, '', ?, ?, ?, 'self-clock', ?, 'clock-page')",
          [rowId, wk.id, wk.name, p.opDate, p.category, hm, nextDay, JSON.stringify([ev.insertId]), now]);
      }
    }
    await pool.query("INSERT INTO ja_audit_log (ts, user_email, action, details) VALUES (?,?,?,?)",
      [now, "clock:" + wk.name, "Clock " + kind, p.opDate + " " + p.category + " " + hm + (lat ? " @" + lat + "," + lng : " (no GPS)")]);
    // async face check — never blocks
    faceCheck(ev.insertId, abs, wk.id);
    res.send(page("<h1 class='ok'>Clock " + kind.toUpperCase() + " ✓</h1>" +
      "<div class='time'>" + esc(hm) + "</div>" +
      "<div class='sub'>" + esc(wk.name) + " · " + esc(p.category) + " shift · " + esc(p.opDate) + "</div>" +
      "<img class='pv' src='" + esc(selfieUrl) + "'>" +
      "<div class='hint'>Recorded. You can close this page.</div>"));
  } catch (e) { res.status(500).send(page("<h1 class='err'>Failed</h1><p>" + esc(e.message) + "</p>")); }
});

// ---- admin: links + review (mounted at /api/clock) -------------------------
const adminRouter = express.Router();
adminRouter.use(requireAuth, requireAdmin);

adminRouter.post("/links", async (req, res) => {
  try {
    const rotate = !!(req.body || {}).rotate;
    const [workers] = await pool.query("SELECT id, name FROM ja_workers ORDER BY name");
    const out = [];
    for (const w of workers) {
      if (rotate) await pool.query("UPDATE ja_clock_tokens SET active=0 WHERE worker_id=?", [w.id]);
      const [ex] = await pool.query("SELECT token FROM ja_clock_tokens WHERE worker_id=? AND active=1 LIMIT 1", [w.id]);
      let token = ex[0] && ex[0].token;
      if (!token) {
        token = crypto.randomBytes(18).toString("base64url");
        await pool.query("INSERT INTO ja_clock_tokens (token, worker_id, created_at, created_by) VALUES (?,?,?,?)",
          [token, w.id, klNowSql(), req.user.email]);
      }
      out.push({ worker_id: w.id, name: w.name, url: "/clock/" + token });
    }
    res.json({ data: out });
  } catch (e) { res.status(500).json({ error: { message: e.message } }); }
});

adminRouter.post("/review", async (req, res) => {
  try {
    const { event_id, action } = req.body || {};
    const [[ev]] = await pool.query("SELECT * FROM ja_clock_events WHERE id=?", [event_id]);
    if (!ev) return res.status(404).json({ error: { message: "event not found" } });
    if (action === "approve") {
      await pool.query("UPDATE ja_clock_events SET face_verdict='approved', reviewed_by=? WHERE id=?", [req.user.email, event_id]);
    } else if (action === "reject") {
      await pool.query("UPDATE ja_clock_events SET face_verdict='voided', reviewed_by=? WHERE id=?", [req.user.email, event_id]);
      // recompute the attendance row from remaining valid events
      const rowId = ("at_" + ev.worker_id + "_" + String(ev.op_date).slice(0, 10) + "_" + ev.category).replace(/\s+/g, "_");
      const [evs] = await pool.query(
        "SELECT * FROM ja_clock_events WHERE worker_id=? AND op_date=? AND category=? AND face_verdict<>'voided' ORDER BY ts",
        [ev.worker_id, String(ev.op_date).slice(0, 10), ev.category]);
      const ins = evs.filter(x => x.kind === "in"), outs = evs.filter(x => x.kind === "out");
      const ci = ins.length ? String(ins[0].ts).slice(11, 16) : "";
      const co = outs.length ? String(outs[outs.length - 1].ts).slice(11, 16) : "";
      if (!ci && !co) await pool.query("DELETE FROM ja_attendance_log WHERE id=? AND source='self-clock'", [rowId]);
      else await pool.query("UPDATE ja_attendance_log SET clock_in=?, clock_out=? WHERE id=?", [ci, co, rowId]);
    } else return res.status(400).json({ error: { message: "action must be approve|reject" } });
    await pool.query("INSERT INTO ja_audit_log (ts, user_email, action, details) VALUES (?,?,?,?)",
      [klNowSql(), req.user.email, "Clock review " + action, "event " + event_id + " · " + ev.worker_name]);
    res.json({ data: { ok: true } });
  } catch (e) { res.status(500).json({ error: { message: e.message } }); }
});

module.exports = { router, adminRouter };
