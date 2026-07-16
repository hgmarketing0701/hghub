// server/rpcs/expenses.js — JS ports of supabase/schema-expenses.sql plpgsql RPCs.
// Registered by server/rpc.js: each fn gets ({ args, user, conn }) inside an
// OPEN TRANSACTION — use ONLY conn.query, throw on failure (route rolls back).
//
// All three RPCs are admin-only (was: if not is_admin() then raise ...).
// user.role === 'admin' replaces is_admin(); user.email = current_email().
//
// ── TRIGGER REPLACEMENT NOTE ─────────────────────────────────────────────────
// The Postgres trigger exp_set_month_key() (BEFORE INSERT OR UPDATE on
// exp_expenses: month_key := to_char(receipt_date, 'YYYY-MM')) does NOT exist
// in MySQL. Inserts/updates that go through the generic /api/t/exp_expenses
// route MUST now compute month_key client- or API-side:
//
//     monthKey = receipt_date.slice(0, 7)          // 'YYYY-MM-DD' → 'YYYY-MM'
//
// and send it as month_key alongside receipt_date. Any edit that changes
// receipt_date must re-send the matching month_key. The rename/delete RPCs
// below only re-tag `category`, so month_key is untouched there.
// ─────────────────────────────────────────────────────────────────────────────

// was: lower(trim(regexp_replace(name, '\s+', ' ', 'g')))
function normName(s) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().toLowerCase();
}

const NAME_RE = /^[a-z0-9 &/-]+$/; // was: v_name ~ '^[a-z0-9 &/-]+$'

function requireAdmin(user) {
  if (user.role !== "admin") throw new Error("Only the admin can manage categories.");
}

async function logAudit(conn, user, action, details) {
  await conn.query(
    "INSERT INTO audit_log (at, user_email, action, details) VALUES (NOW(), ?, ?, ?)",
    [user.email, action, details]
  );
}

module.exports = {

  // ── exp_add_category(p_name text) returns void ────────────────────────────
  // Validate (lowercase, <=24 chars, [a-z0-9 &/-]), reject duplicates,
  // insert with next sort slot below the locked 'other' (sort 999).
  exp_add_category: async ({ args, user, conn }) => {
    requireAdmin(user);
    const name = normName(args.p_name);
    if (name === "") throw new Error("Enter a category name.");
    if (!NAME_RE.test(name)) throw new Error("Use letters, numbers, spaces, & / - only.");
    if (name.length > 24) throw new Error("Keep it under 24 characters.");

    const [dup] = await conn.query("SELECT 1 FROM exp_categories WHERE name = ?", [name]);
    if (dup.length) throw new Error(`"${name}" already exists.`);

    await conn.query(
      `INSERT INTO exp_categories (name, sort)
       SELECT ?, COALESCE(MAX(sort), 0) + 1 FROM exp_categories WHERE sort < 999`,
      [name]
    );
    await logAudit(conn, user, "EXP category-add", name);
    return null; // plpgsql returns void → supabase client saw data: null
  },

  // ── exp_rename_category(p_old, p_new) returns int ─────────────────────────
  // Rename category ('other' locked) AND re-tag matching exp_expenses rows —
  // the atomic cascade the plpgsql did. Returns the number of receipts moved.
  exp_rename_category: async ({ args, user, conn }) => {
    requireAdmin(user);
    const oldN = normName(args.p_old);
    const newN = normName(args.p_new);
    if (oldN === "" || newN === "") throw new Error("Missing name.");
    if (oldN === "other") throw new Error('"other" is the fallback category — it cannot be renamed.');
    if (!NAME_RE.test(newN)) throw new Error("Use letters, numbers, spaces, & / - only.");
    if (newN.length > 24) throw new Error("Keep it under 24 characters.");

    const [oldRow] = await conn.query("SELECT 1 FROM exp_categories WHERE name = ?", [oldN]);
    if (!oldRow.length) throw new Error(`"${oldN}" not found.`);
    if (oldN !== newN) {
      const [dup] = await conn.query("SELECT 1 FROM exp_categories WHERE name = ?", [newN]);
      if (dup.length) throw new Error(`"${newN}" already exists.`);
    }

    await conn.query("UPDATE exp_categories SET name = ? WHERE name = ?", [newN, oldN]);
    // keep receipts consistent — same cascade as the plpgsql function
    const [res] = await conn.query(
      "UPDATE exp_expenses SET category = ? WHERE category = ?", [newN, oldN]
    );
    const moved = Number(res.affectedRows) || 0;

    await logAudit(conn, user, "EXP category-rename", `${oldN} -> ${newN} (${moved} rows)`);
    return moved;
  },

  // ── exp_delete_category(p_name) returns int ───────────────────────────────
  // Delete category ('other' locked) and re-tag affected exp_expenses rows to
  // 'other'. Returns the number of receipts moved.
  exp_delete_category: async ({ args, user, conn }) => {
    requireAdmin(user);
    const name = normName(args.p_name);
    if (name === "other") throw new Error('"other" cannot be deleted — it is the fallback.');

    const [row] = await conn.query("SELECT 1 FROM exp_categories WHERE name = ?", [name]);
    if (!row.length) throw new Error(`"${name}" not found.`);

    await conn.query("DELETE FROM exp_categories WHERE name = ?", [name]);
    // affected receipts -> other, same cascade as the plpgsql function
    const [res] = await conn.query(
      "UPDATE exp_expenses SET category = 'other' WHERE category = ?", [name]
    );
    const moved = Number(res.affectedRows) || 0;

    await logAudit(conn, user, "EXP category-delete", `${name} (${moved} rows -> other)`);
    return moved;
  }
};
