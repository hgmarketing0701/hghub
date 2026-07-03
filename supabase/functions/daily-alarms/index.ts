// HG — daily-alarms Edge Function
// Replaces every Apps Script time-trigger email:
//   dispatch permit early-warnings, workers doc/permit expiry digest,
//   scaffold collection reminders, storage-rental renewal notices.
//
// It reads every `*_alarms` view that exists (dsp_alarms, wkr_alarms,
// scf_alarms, str_alarms — each created by that tool's schema file with
// columns: alarm_type text, ref text, detail text, due_date date, recipient text),
// groups the rows into one digest email, and sends it via Resend.
//
// Secrets required:  RESEND_API_KEY   (free tier at resend.com)
// Settings used:     app_settings.ALARM_EMAIL_TO   (fallback: COMPANY_EMAIL)
//                    app_settings.ALARM_EMAIL_FROM (fallback: onboarding@resend.dev)
//
// Schedule it daily (see EDGE-FUNCTIONS.md). Can also be invoked manually
// from any tool ("Send alarm digest now") — caller must be allowlisted,
// OR the request must carry the CRON_SECRET header when run by the scheduler.

import { createClient } from "npm:@supabase/supabase-js@2";

const ALARM_VIEWS = ["dsp_alarms", "wkr_alarms", "scf_alarms", "str_alarms"];

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── auth: scheduler (secret header) OR an allowlisted signed-in user ──
    const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
    const viaCron = cronSecret && req.headers.get("x-cron-secret") === cronSecret;
    if (!viaCron) {
      const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
      const { data: userData, error: userErr } = await supa.auth.getUser(jwt);
      if (userErr || !userData?.user?.email) return json({ error: "Not signed in." }, 401, cors);
      const { data: allowed } = await supa
        .from("allowed_users").select("email")
        .ilike("email", userData.user.email).maybeSingle();
      if (!allowed) return json({ error: "Not authorised." }, 403, cors);
    }

    // ── collect alarms from every view that exists ──
    type Alarm = { alarm_type: string; ref: string; detail: string; due_date: string; recipient: string | null };
    const all: (Alarm & { source: string })[] = [];
    for (const v of ALARM_VIEWS) {
      const { data, error } = await supa.from(v).select("*");
      if (error) continue; // view not created yet (tool not deployed) — skip
      for (const row of (data ?? []) as Alarm[]) all.push({ ...row, source: v });
    }

    if (!all.length) return json({ sent: false, reason: "No alarms due.", count: 0 }, 200, cors);

    // ── recipients ──
    const { data: settings } = await supa.from("app_settings").select("*");
    const s: Record<string, string> = {};
    (settings ?? []).forEach((r: { key: string; value: string }) => (s[r.key] = r.value));
    const to = (s.ALARM_EMAIL_TO || s.COMPANY_EMAIL || "").split(/[;,]/).map(x => x.trim()).filter(Boolean);
    if (!to.length) return json({ sent: false, reason: "No recipient — set ALARM_EMAIL_TO in app_settings." }, 200, cors);
    const from = s.ALARM_EMAIL_FROM || "HG Alarms <onboarding@resend.dev>";

    // ── compose digest ──
    const bySource: Record<string, (Alarm & { source: string })[]> = {};
    all.forEach(a => { (bySource[a.source] = bySource[a.source] || []).push(a); });
    const nice: Record<string, string> = {
      dsp_alarms: "🌙 Dispatch — permit early warnings",
      wkr_alarms: "🪪 Workers — document / permit expiry",
      scf_alarms: "🪜 Scaffold — collections due",
      str_alarms: "🏬 Storage — renewals due",
    };
    let html = `<h2 style="font-family:Arial">HG Daily Alarm Digest — ${new Date().toLocaleDateString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })}</h2>`;
    for (const src of Object.keys(bySource)) {
      html += `<h3 style="font-family:Arial">${nice[src] ?? src} (${bySource[src].length})</h3><ul style="font-family:Arial">`;
      for (const a of bySource[src]) {
        html += `<li><b>${escapeHtml(a.ref)}</b> — ${escapeHtml(a.detail)} <i>(due ${a.due_date})</i></li>`;
      }
      html += "</ul>";
    }

    // ── send via Resend ──
    const rk = Deno.env.get("RESEND_API_KEY");
    if (!rk) return json({ sent: false, reason: "RESEND_API_KEY secret not set.", count: all.length, preview: html }, 200, cors);
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${rk}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject: `HG Alarm Digest — ${all.length} item(s)`, html }),
    });
    if (!r.ok) return json({ sent: false, reason: `Resend error ${r.status}: ${await r.text()}` }, 502, cors);

    return json({ sent: true, count: all.length, to }, 200, cors);
  } catch (e) {
    return json({ error: String(e) }, 500, cors);
  }
});

function escapeHtml(s: unknown) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
function json(obj: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
