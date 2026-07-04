// HG — assistant Edge Function
// Two jobs:
//   mode "briefing" : plain-English summary of the last ~28h of activity (all staff)
//   mode "chat"     : admin-only "ask anything" — Gemini writes ONE read-only SELECT,
//                     we run it via ai_run_select(), Gemini phrases the answer.
// Secrets required: GEMINI_API_KEY
// Auth: caller must be signed-in + allowlisted. Chat additionally requires is_admin.

import { createClient } from "npm:@supabase/supabase-js@2";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const key = Deno.env.get("GEMINI_API_KEY");
    if (!key) return json({ error: "GEMINI_API_KEY not set." }, 500);

    // ── who is calling? ──
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: u } = await admin.auth.getUser(jwt);
    const email = u?.user?.email?.toLowerCase();
    if (!email) return json({ error: "Not signed in." }, 401);
    const { data: acc } = await admin.from("allowed_users")
      .select("email, is_admin").ilike("email", email).maybeSingle();
    if (!acc) return json({ error: "Not authorised." }, 403);

    const body = await req.json().catch(() => ({}));
    const mode = body.mode || "briefing";

    // ════════════════ DAILY BRIEFING ════════════════
    if (mode === "briefing") {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
      if (!body.force) {
        const { data: existing } = await admin.from("ai_briefings")
          .select("*").eq("brief_date", today).maybeSingle();
        if (existing && existing.summary) return json({ date: today, summary: existing.summary, cached: true });
      }
      // last ~28h of activity
      const since = new Date(Date.now() - 28 * 3600 * 1000).toISOString();
      const { data: acts } = await admin.from("audit_log")
        .select("at, user_email, action, details").gte("at", since).order("at", { ascending: false }).limit(400);
      const rows = acts ?? [];
      if (!rows.length) {
        const summary = "No activity logged in the last 24 hours. Quiet day — nothing needs your attention from the system.";
        await admin.from("ai_briefings").upsert({ brief_date: today, summary, activity_n: 0, created_by: email });
        return json({ date: today, summary, cached: false });
      }
      const prompt =
        "You are the operations assistant for HG Group, a Malaysian contractor-support company " +
        "(hoarding, scaffold, visual print, storage rental, reinstatement, fit-out). " +
        "Write a short daily briefing for the business owner from this activity log. " +
        "Group by area (Quotations, Site/Dispatch, Finance, Workers, Inventory, etc). " +
        "Lead with anything that needs attention (expiring permits, outstanding money). " +
        "Use RM for money, be concise, use short bullet points, no preamble.\n\n" +
        "ACTIVITY (newest first):\n" +
        rows.map((r: any) => `• ${new Date(r.at).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })} — ${r.user_email?.split("@")[0] ?? "?"}: ${r.action} ${r.details ?? ""}`).join("\n");
      const summary = await gemini(key, prompt, 0.4);
      await admin.from("ai_briefings").upsert({ brief_date: today, summary, activity_n: rows.length, created_by: email });
      return json({ date: today, summary, cached: false });
    }

    // ════════════════ CHAT (admin only) ════════════════
    if (mode === "chat") {
      if (!acc.is_admin) return json({ error: "The ask-anything assistant is limited to admins." }, 403);
      const question = String(body.question || "").trim();
      if (!question) return json({ error: "Empty question." }, 400);

      // compact schema of the public tables for the model
      const { data: cols } = await admin.rpc("ai_schema_catalog").maybeSingle().then(
        () => ({ data: null }), () => ({ data: null }),
      ).catch(() => ({ data: null }));
      const schema = await buildSchema(admin);

      // 1) Gemini → one read-only SELECT
      const sqlPrompt =
        "You are a Postgres analyst for HG Group. Using ONLY the schema below, write ONE " +
        "read-only SQL SELECT (Postgres) that answers the question. Rules: SELECT only, no " +
        "semicolons, no comments, no CTE writes. Money columns are RM. Timezone Asia/Kuala_Lumpur. " +
        "Prefer clear aggregates. Return ONLY the SQL, nothing else.\n\nSCHEMA:\n" + schema +
        "\n\nQUESTION: " + question;
      let sql = cleanSql(await gemini(key, sqlPrompt, 0.1));

      // 2) run it (guarded)
      let rows: unknown = null, runErr: string | null = null;
      try {
        const { data, error } = await admin.rpc("ai_run_select", { q: sql });
        if (error) throw error;
        rows = data;
      } catch (e) {
        runErr = String((e as any)?.message ?? e);
        // one retry: let Gemini fix the SQL given the error
        try {
          const fix = cleanSql(await gemini(key,
            sqlPrompt + "\n\nYour previous SQL failed with: " + runErr + "\nSQL was:\n" + sql + "\nReturn a corrected SELECT only.", 0.1));
          sql = fix;
          const { data, error } = await admin.rpc("ai_run_select", { q: sql });
          if (error) throw error;
          rows = data; runErr = null;
        } catch (e2) { runErr = String((e2 as any)?.message ?? e2); }
      }
      if (runErr) return json({ answer: "I couldn't run a safe query for that. Try rephrasing — e.g. ask about counts, totals, or recent records.", sql, error: runErr });

      // 3) Gemini → phrase the answer
      const answerPrompt =
        "You are HG Group's business assistant answering the owner. Question: \"" + question + "\".\n" +
        "Here is the query result as JSON:\n" + JSON.stringify(rows).slice(0, 12000) +
        "\n\nAnswer in plain English, concise, RM for money, Malaysian tone ok. If the result is empty, say so plainly. Do not mention SQL.";
      const answer = await gemini(key, answerPrompt, 0.4);
      return json({ answer, sql, rows: Array.isArray(rows) ? rows.length : 0 });
    }

    return json({ error: "Unknown mode." }, 400);
  } catch (e) {
    return json({ error: String((e as any)?.message ?? e) }, 500);
  }
});

// ── helpers ──
async function gemini(key: string, prompt: string, temp: number): Promise<string> {
  const g = await fetch(`${GEMINI_URL}?key=${key}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: temp } }),
  });
  if (!g.ok) throw new Error(`Gemini ${g.status}: ${await g.text()}`);
  const b = await g.json();
  return b?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
}

function cleanSql(s: string): string {
  return s.replace(/```sql/gi, "").replace(/```/g, "").replace(/;+\s*$/, "").trim();
}

// Build a compact "table(col1, col2, ...)" schema string from information_schema.
async function buildSchema(admin: any): Promise<string> {
  const { data } = await admin.rpc("ai_run_select", {
    q: `select table_name, string_agg(column_name, ', ' order by ordinal_position) as cols
        from information_schema.columns
        where table_schema = 'public'
          and table_name not like 'ai_%' and table_name <> 'allowed_users'
        group by table_name order by table_name`,
  });
  if (!Array.isArray(data)) return "(schema unavailable)";
  return data.map((r: any) => `${r.table_name}(${r.cols})`).join("\n");
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
