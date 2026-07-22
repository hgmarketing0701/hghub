// AI assistant — ports supabase/functions/assistant/index.ts to Express + MySQL.
//   POST /api/ai/briefing   { force? }   → { data: { briefing, cached } }   (all staff)
//   POST /api/ai/chat       { question } → { data: { answer } }             (ADMIN ONLY)
// Gemini key stays server-side (env). Chat = guarded text-to-SQL:
// model writes ONE SELECT → validated → run on the READ-ONLY pool → model phrases the answer.

const express = require("express");
const { pool, roPool } = require("./db");
const { requireAuth, requireAdmin } = require("./auth");

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";  // stable alias — won't deprecate
const ROW_CAP = 200;

async function gemini(prompt, system) {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY not set");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1024 }
      })
    }
  );
  if (!res.ok) throw new Error("Gemini " + res.status + ": " + (await res.text()).slice(0, 300));
  const j = await res.json();
  return (j.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("").trim();
}

// vision variant — parts may mix {text} and {inlineData:{mimeType,data}}
async function geminiVision(parts, system) {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY not set");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents: [{ role: "user", parts }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 2048, responseMimeType: "application/json" }
      })
    }
  );
  if (!res.ok) throw new Error("Gemini " + res.status + ": " + (await res.text()).slice(0, 300));
  const j = await res.json();
  return (j.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("").trim();
}

// ---- SELECT-only guard (same rules as ai_run_select) ----------------------
const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|replace|call|handler|load|outfile|infile|lock|unlock|set|use|show|describe|explain)\b/i;

function validateSelect(q) {
  const sql = String(q || "").trim().replace(/;+\s*$/, "");
  if (!/^select\b/i.test(sql)) throw new Error("Only SELECT is allowed");
  if (sql.includes(";")) throw new Error("Single statement only");
  if (FORBIDDEN.test(sql)) throw new Error("Query contains a forbidden keyword");
  if (/--|\/\*/.test(sql)) throw new Error("Comments not allowed");
  return /\blimit\s+\d+/i.test(sql) ? sql : sql + " LIMIT " + ROW_CAP;
}

async function runSelect(sql) {
  const p = roPool || pool; // roPool (SELECT-only grants) preferred; validator still applies
  const [rows] = await p.query({ sql, timeout: 8000 });
  return rows.slice(0, ROW_CAP);
}

// ---- routes ---------------------------------------------------------------
const router = express.Router();
router.use(requireAuth);

// Daily briefing: summarize last ~28h of audit_log; cache one per day in ai_briefings.
router.post("/briefing", async (req, res) => {
  try {
    // KL day (fixed UTC+8)
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    if (!req.body?.force) {
      const [hit] = await pool.query("SELECT summary FROM ai_briefings WHERE brief_date = ? LIMIT 1", [today]);
      if (hit[0]) return res.json({ data: { briefing: hit[0].summary, cached: true } });
    }
    const [logs] = await pool.query(
      "SELECT at, user_email, action, details FROM audit_log WHERE at >= NOW() - INTERVAL 28 HOUR ORDER BY at DESC LIMIT 400"
    );
    let briefing;
    if (!logs.length) {
      briefing = "No activity logged in the last day.";
    } else {
      briefing = await gemini(
        "Activity log (most recent first):\n" +
          logs.map(l => `${l.at} ${l.user_email}: ${l.action} — ${String(l.details).slice(0, 160)}`).join("\n"),
        "You are the daily briefing writer for HG Group, a Malaysian contractor-support company (currency RM). " +
          "Summarize the last day's system activity for the boss: 3-6 short bullet points, black-and-white factual tone, " +
          "no fluff, group similar actions, name who did what. Start each bullet with '- '."
      );
    }
    await pool.query(
      "INSERT INTO ai_briefings (brief_date, summary, activity_n, created_by) VALUES (?, ?, ?, ?) " +
      "ON DUPLICATE KEY UPDATE summary = VALUES(summary), activity_n = VALUES(activity_n), created_at = NOW()",
      [today, briefing, logs.length, req.user.email]
    );
    res.json({ data: { briefing, cached: false } });
  } catch (e) {
    res.status(500).json({ error: { message: e.message } });
  }
});

// Ask-anything chat: ADMIN ONLY (reads all business data).
router.post("/chat", requireAdmin, async (req, res) => {
  try {
    const question = String(req.body?.question || "").trim();
    if (!question) return res.status(400).json({ error: { message: "question required" } });

    // 1. schema snapshot for the model (tables + columns, trimmed)
    const [cols] = await pool.query(
      "SELECT TABLE_NAME t, GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION) c " +
      "FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() GROUP BY TABLE_NAME"
    );
    const schema = cols.map(r => `${r.t}(${r.c})`).join("\n");

    // 2. model writes ONE SELECT
    const sqlRaw = await gemini(
      `Schema:\n${schema}\n\nQuestion: ${question}\n\nWrite ONE MySQL SELECT statement that answers it. ` +
        "Output ONLY the SQL, no markdown, no explanation. Dates are DATETIME strings, currency columns are DECIMAL in RM.",
      "You write a single safe MySQL 8 SELECT query. Never write anything except one SELECT."
    );
    const sql = validateSelect(sqlRaw.replace(/^```(sql)?|```$/g, "").trim());

    // 3. run read-only, 4. phrase answer
    const rows = await runSelect(sql);
    const answer = await gemini(
      `Question: ${question}\nSQL used: ${sql}\nResult rows (JSON):\n${JSON.stringify(rows).slice(0, 12000)}`,
      "Answer the boss's question from the query result. Direct, numbered/bulleted where useful, amounts in RM, " +
        "black-and-white tone, no fluff. If the result is empty say so plainly."
    );
    res.json({ data: { answer, sql } });
  } catch (e) {
    res.status(500).json({ error: { message: e.message } });
  }
});

// ---- invoice reader (HG Ops v1) -------------------------------------------
// POST /api/ai/invoice-read  (multipart "file": pdf/jpg/png)
// → { data: { invoice_no, client, mall, amount, sst, jobs:[{lot, description, suggested_scope}] } }
// Draft only — the office reviews/edits before anything is saved.
const multer = require("multer");
const invUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

router.post("/invoice-read", invUpload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: { message: "No file" } });
    const mime = req.file.mimetype || "application/pdf";
    if (!/pdf|jpe?g|png|webp/i.test(mime)) return res.status(400).json({ error: { message: "PDF or image only" } });
    const raw = await geminiVision(
      [
        { inlineData: { mimeType: mime, data: req.file.buffer.toString("base64") } },
        { text:
          "This is a confirmed customer invoice/PO for HG (Malaysian contractor-support: hoarding, visual print, scaffold, reinstatement, fit-out). " +
          "Extract JSON exactly in this shape: {\"invoice_no\":string,\"client\":string,\"mall\":string,\"amount\":number|null,\"sst\":number|null," +
          "\"jobs\":[{\"lot\":string,\"description\":string,\"suggested_scope\":string}]}. " +
          "jobs[] = one entry per DISTINCT SITE VISIT / physical work, NOT per invoice line item. " +
          "Line items that are parts of the same installation — e.g. hoarding panels + swing door + counterweight + skirting — " +
          "are ONE job: lot = ALL its lot numbers combined exactly as written (e.g. 'G8, G9 & G10'), " +
          "description = the line items joined with ' + ' (e.g. 'Hoarding white PVC plywood 3mm + single leaf swing door + counterweight system'). " +
          "Create separate jobs ONLY for genuinely separate works: install vs dismantle, or clearly separate visits/sites. " +
          "A typical hoarding invoice = 1 job. " +
          "suggested_scope = short work name like 'Hoarding Installation', 'Hoarding Dismantling', 'Visual Print & Install', 'Scaffold', 'Reinstatement'. " +
          "mall = the site/mall/building name. amount = grand total number in RM without currency sign. Use \"\" or null when unreadable. Output ONLY the JSON." }
      ],
      "You extract structured data from Malaysian construction invoices. Output strict JSON only."
    );
    let parsed;
    try { parsed = JSON.parse(raw.replace(/^```(json)?|```$/g, "").trim()); }
    catch { throw new Error("AI returned unreadable extraction — enter details manually"); }
    parsed.jobs = Array.isArray(parsed.jobs) && parsed.jobs.length ? parsed.jobs : [{ lot: "", description: "", suggested_scope: "" }];
    res.json({ data: parsed });
  } catch (e) {
    res.status(500).json({ error: { message: e.message } });
  }
});

module.exports = { router };
