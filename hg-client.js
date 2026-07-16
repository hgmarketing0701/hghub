/* hg-client.js — drop-in replacement for the supabase-js subset the HG tools use.
 *
 * Usage (replaces the supabase CDN + createClient):
 *   <script src="hg-client.js"></script>
 *   const sb = window.hg.createClient();      // same-origin /api — no URL, no key
 *
 * Implements exactly the surface measured across the 17 tool files:
 *   sb.from(t).select/insert/update/delete/upsert + eq neq gt lt gte lte ilike in is
 *              contains or order limit range single maybeSingle
 *   sb.rpc(name, args)
 *   sb.storage.from(bucket).upload(path, file) / .getPublicUrl(path)
 *   sb.auth.getSession() / onAuthStateChange(cb) / signOut()
 *   sb.auth.signInWithPassword({ email, password })   ← replaces signInWithOAuth
 * Responses keep the supabase shape: { data, error }.
 */
(function () {
  "use strict";

  const API = (window.HG_API_BASE || "") + "/api";

  async function call(method, path, body) {
    try {
      const res = await fetch(API + path, {
        method,
        credentials: "include",
        headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
      let j = null;
      try { j = await res.json(); } catch { /* empty body */ }
      if (!res.ok) return { data: null, error: (j && j.error) || { message: "HTTP " + res.status }, status: res.status };
      return { data: j ? j.data : null, error: null, status: res.status };
    } catch (e) {
      return { data: null, error: { message: e.message || "Network error" }, status: 0 };
    }
  }

  // ---- query builder ------------------------------------------------------
  function QB(table) {
    this._t = table;
    this._params = [];
    this._mode = null;     // 'select' | 'insert' | 'update' | 'delete'
    this._body = undefined;
    this._single = 0;      // 1 single, 2 maybeSingle
    this._upsert = false;
  }

  QB.prototype._p = function (k, v) { this._params.push(encodeURIComponent(k) + "=" + encodeURIComponent(v)); return this; };

  // filters
  ["eq", "neq", "gt", "lt", "gte", "lte"].forEach(op => {
    QB.prototype[op] = function (col, val) { return this._p(op + "." + col, val); };
  });
  QB.prototype.ilike = function (col, pat) { return this._p("ilike." + col, pat); };
  QB.prototype.like = QB.prototype.ilike; // collation is case-insensitive anyway
  QB.prototype.in = function (col, arr) { return this._p("in." + col, (arr || []).join(",")); };
  QB.prototype.is = function (col, val) { return this._p("is." + col, val === null ? "null" : "notnull"); };
  QB.prototype.contains = function (col, val) {
    const v = Array.isArray(val) || typeof val === "object" ? JSON.stringify(val) : val;
    return this._p("contains." + col, v);
  };
  QB.prototype.or = function (expr) { return this._p("or", "(" + expr + ")"); };
  QB.prototype.order = function (col, opts) {
    return this._p("order", col + "." + (opts && opts.ascending === false ? "desc" : "asc"));
  };
  QB.prototype.limit = function (n) { return this._p("limit", n); };
  QB.prototype.range = function (from, to) { this._p("offset", from); return this._p("limit", to - from + 1); };
  QB.prototype.single = function () { this._single = 1; return this; };
  QB.prototype.maybeSingle = function () { this._single = 2; return this; };

  // verbs
  QB.prototype.select = function (cols) {
    if (this._mode === null) this._mode = "select";
    if (cols && cols !== "*") this._p("select", String(cols).replace(/\s/g, ""));
    return this;
  };
  QB.prototype.insert = function (rows) { this._mode = "insert"; this._body = rows; return this; };
  QB.prototype.upsert = function (rows) { this._mode = "insert"; this._upsert = true; this._body = rows; return this; };
  QB.prototype.update = function (patch) { this._mode = "update"; this._body = patch; return this; };
  QB.prototype.delete = function () { this._mode = "delete"; return this; };

  // await — builds URL, fires request
  QB.prototype.then = function (resolve, reject) {
    let q = this._params.slice();
    if (this._single === 1) q.push("single=1");
    if (this._single === 2) q.push("maybe=1");
    if (this._upsert) q.push("upsert=1");
    const qs = q.length ? "?" + q.join("&") : "";
    const path = "/t/" + this._t + qs;
    const method = { select: "GET", insert: "POST", update: "PATCH", delete: "DELETE" }[this._mode || "select"];
    return call(method, path, method === "GET" || method === "DELETE" ? undefined : this._body)
      .then(resolve, reject);
  };

  // ---- auth ---------------------------------------------------------------
  let _authCb = null;
  const auth = {
    async getSession() {
      const r = await call("GET", "/auth/session");
      if (r.error) return { data: { session: null }, error: null };
      const session = { user: { id: r.data.user.id, email: r.data.user.email, user_metadata: { full_name: r.data.user.name }, role: r.data.user.role } };
      return { data: { session }, error: null };
    },
    onAuthStateChange(cb) {
      _authCb = cb;
      return { data: { subscription: { unsubscribe() { _authCb = null; } } } };
    },
    async signInWithPassword({ email, password }) {
      const r = await call("POST", "/auth/login", { email, password });
      if (r.error) return { data: { session: null }, error: r.error };
      const session = { user: { id: r.data.user.id, email: r.data.user.email, user_metadata: { full_name: r.data.user.name }, role: r.data.user.role } };
      if (_authCb) try { _authCb("SIGNED_IN", session); } catch (e) { console.error(e); }
      return { data: { session }, error: null };
    },
    // legacy call sites: surface a clear error instead of redirecting to Google
    async signInWithOAuth() {
      return { data: null, error: { message: "Google login replaced by email+password. Use the login form." } };
    },
    async signOut() {
      await call("POST", "/auth/logout");
      if (_authCb) try { _authCb("SIGNED_OUT", null); } catch (e) { console.error(e); }
      return { error: null };
    },
    async getUser() {
      const s = await this.getSession();
      return { data: { user: s.data.session ? s.data.session.user : null }, error: null };
    }
  };

  // ---- storage --------------------------------------------------------------
  const storage = {
    from(bucket) {
      return {
        async upload(path, file) {
          const fd = new FormData();
          fd.append("path", path);
          fd.append("file", file);
          try {
            const res = await fetch(API + "/files/" + bucket, { method: "POST", credentials: "include", body: fd });
            const j = await res.json().catch(() => null);
            if (!res.ok) return { data: null, error: (j && j.error) || { message: "HTTP " + res.status } };
            return { data: { path: j.data.path, fullPath: j.data.fullPath }, error: null };
          } catch (e) {
            return { data: null, error: { message: e.message } };
          }
        },
        getPublicUrl(path) {
          const base = window.HG_API_BASE || "";
          return { data: { publicUrl: base + "/uploads/" + bucket + "/" + String(path).replace(/^\/+/, "") } };
        }
      };
    }
  };

  // ---- rpc + client -------------------------------------------------------
  function createClient() {
    return {
      from: t => new QB(t),
      rpc: (name, args) => call("POST", "/rpc/" + name, args || {}),
      auth,
      storage
    };
  }

  window.hg = { createClient };
  // compat alias so tools' `supabase.createClient(url, key)` keeps working after swap
  window.supabase = { createClient: () => createClient() };
})();
