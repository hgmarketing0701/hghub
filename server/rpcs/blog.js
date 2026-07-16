// RPC pack: blog — port of supabase/schema-blog.sql blg_mark() (plpgsql).
// Registered by server/rpc.js; each fn runs inside an open transaction on `conn`.

module.exports = {
  // blg_mark({ p_ref, p_channel, p_status, p_link })
  // → { ok: true, ref } on success, { error: "..." } on bad ref/channel
  //   (the plpgsql returned error objects instead of raising — kept identical)
  blg_mark: async ({ args, user, conn }) => {
    const ref = String(args.p_ref || "");
    const channel = String(args.p_channel || "");
    const status = args.p_status == null ? "" : String(args.p_status);
    const link = args.p_link == null ? "" : String(args.p_link);

    const [rows] = await conn.query("SELECT id FROM blg_posts WHERE ref = ?", [ref]);
    if (rows.length === 0) return { error: "ref not found: " + ref };
    const id = rows[0].id;

    if (channel === "wix") {
      // COALESCE(NULLIF(new,''), old) — blank keeps the existing value
      await conn.query(
        `UPDATE blg_posts SET
           wix_status = COALESCE(NULLIF(?, ''), wix_status),
           wix_link   = COALESCE(NULLIF(?, ''), wix_link),
           pushed_at  = NOW()
         WHERE id = ?`,
        [status, link, id]
      );
    } else if (channel === "linkedin") {
      await conn.query(
        `UPDATE blg_posts SET
           linkedin_status = COALESCE(NULLIF(?, ''), linkedin_status),
           linkedin_link   = COALESCE(NULLIF(?, ''), linkedin_link),
           pushed_at       = NOW()
         WHERE id = ?`,
        [status, link, id]
      );
    } else {
      return { error: "unknown channel: " + channel };
    }

    // log_audit('MARK POST', ...) — details truncated to 300 chars like the SQL fn
    const details = (ref + " · " + channel + " → " + status).slice(0, 300);
    await conn.query(
      "INSERT INTO audit_log (at, user_email, action, details) VALUES (NOW(), ?, 'MARK POST', ?)",
      [user.email, details]
    );

    return { ok: true, ref };
  },
};
