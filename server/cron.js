// Daily alarms digest — replaces the daily-alarms Edge Function + pg_cron.
// cPanel Cron Job (08:00 MYT):
//   curl -s -H "x-cron-secret: $CRON_SECRET" http://127.0.0.1:$PORT/api/cron/daily-alarms
// Reads the *_alarms views, emails via Resend (or returns a JSON preview if no key).

const express = require("express");
const { pool } = require("./db");

const ALARM_VIEWS = ["jjr_alarms", "wkr_alarms", "str_alarms", "trn_alarms", "vis_alarms"]; // jjr = ja_jobs readiness (replaced dsp_alarms)
// scf_alarms is an RPC (complex view) — included via registry when ported.

const router = express.Router();

router.all("/daily-alarms", async (req, res) => {
  if (req.get("x-cron-secret") !== process.env.CRON_SECRET)
    return res.status(401).json({ error: { message: "bad secret" } });
  try {
    const sections = [];
    for (const v of ALARM_VIEWS) {
      try {
        const [rows] = await pool.query(`SELECT * FROM \`${v}\` LIMIT 100`);
        if (rows.length) sections.push({ source: v, count: rows.length, rows });
      } catch { /* view not created yet — skip */ }
    }
    let emailed = false;
    if (sections.length && process.env.RESEND_API_KEY) {
      const [toRow] = await pool.query(
        "SELECT `value` FROM app_settings WHERE `key` IN ('ALARM_EMAIL_TO','COMPANY_EMAIL') ORDER BY FIELD(`key`,'ALARM_EMAIL_TO','COMPANY_EMAIL') LIMIT 1"
      );
      const to = (toRow[0]?.value || "").split(",").map(s => s.trim()).filter(Boolean);
      if (to.length) {
        const html =
          "<h2>HG daily alarms</h2>" +
          sections.map(s =>
            `<h3>${s.source} (${s.count})</h3><pre>${s.rows.map(r => JSON.stringify(r)).join("\n").slice(0, 4000)}</pre>`
          ).join("");
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: process.env.ALARM_EMAIL_FROM || "onboarding@resend.dev",
            to, subject: "HG daily alarms — " + new Date().toISOString().slice(0, 10), html
          })
        });
        emailed = r.ok;
      }
    }
    res.json({ data: { sections: sections.map(s => ({ source: s.source, count: s.count })), emailed, preview: emailed ? undefined : sections } });
  } catch (e) {
    res.status(500).json({ error: { message: e.message } });
  }
});

module.exports = { router };
