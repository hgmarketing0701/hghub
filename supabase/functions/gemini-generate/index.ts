// HG — gemini-generate Edge Function
// General text generation for the Blog / LinkedIn tool (and any future tool).
// Secrets required:  GEMINI_API_KEY
// Caller must be a signed-in user whose email is in allowed_users.
//
// Request:  POST { prompt: string, system?: string }
// Response: { text: string }

import { createClient } from "npm:@supabase/supabase-js@2";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // ── auth: caller must be signed in AND allowlisted ──
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: userData, error: userErr } = await supa.auth.getUser(jwt);
    if (userErr || !userData?.user?.email) {
      return json({ error: "Not signed in." }, 401, cors);
    }
    const { data: allowed } = await supa
      .from("allowed_users")
      .select("email")
      .ilike("email", userData.user.email)
      .maybeSingle();
    if (!allowed) return json({ error: "Not authorised." }, 403, cors);

    // ── input ──
    const { prompt, system } = await req.json();
    if (!prompt) return json({ error: "prompt is required." }, 400, cors);

    const key = Deno.env.get("GEMINI_API_KEY");
    if (!key) return json({ error: "GEMINI_API_KEY secret not set." }, 500, cors);

    const g = await fetch(`${GEMINI_URL}?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7 },
      }),
    });
    if (!g.ok) return json({ error: `Gemini error ${g.status}: ${await g.text()}` }, 502, cors);

    const body = await g.json();
    const text = body?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    return json({ text }, 200, cors);
  } catch (e) {
    return json({ error: String(e) }, 500, cors);
  }
});

function json(obj: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
