// Project P&L (pl_) RPC pack — JS ports of supabase/schema-project-pl.sql
// functions for the Express API (see server/rpc.js registry contract).
//
// Ports: pl_role() (as internal plRole helper), pl_my_role, pl_log_audit,
//        pl_next_project_code.
// Tables: mysql/modules/07-project-pl.sql
//
// Every fn receives ({ args, user, conn }) with conn inside an OPEN
// TRANSACTION — use ONLY conn.query. Throw on failure (route rolls back).

const APP_ROLES = ["Admin", "Manager", "Editor", "Viewer"];

// ---------------------------------------------------------------------------
// plRole — port of pl_role(): effective P&L role of the signed-in user.
// Foundation admins (users.role = 'admin') are ALWAYS 'Admin' (mirrors the
// is_admin() short-circuit in plpgsql); otherwise pl_user_roles lookup by
// email (case-insensitive), default 'Viewer'.
//
// `userOrEmail` may be the req.user object ({ email, role }) — preferred, so
// the foundation-admin override applies — or a plain email string.
// Other packs can require this: const { plRole } = require("./project-pl");
async function plRole(conn, userOrEmail) {
  const isFoundationAdmin =
    userOrEmail && typeof userOrEmail === "object" && userOrEmail.role === "admin";
  if (isFoundationAdmin) return "Admin";
  const email =
    typeof userOrEmail === "object" ? userOrEmail.email : userOrEmail;
  const [rows] = await conn.query(
    "SELECT role FROM pl_user_roles WHERE LOWER(email) = LOWER(?) LIMIT 1",
    [String(email || "")]
  );
  const role = rows[0] && rows[0].role;
  return APP_ROLES.includes(role) ? role : "Viewer";
}

// plRoleIn — port of pl_role_in(roles[]): is_allowed() is guaranteed by
// requireAuth upstream, so this is just a membership test on the effective role.
async function plRoleIn(conn, user, roles) {
  return roles.includes(await plRole(conn, user));
}

// ---------------------------------------------------------------------------
// Role matrix (non-RPC) — mirrors the RLS policies in schema-project-pl.sql
// §7 / the ROLE_PERMS model in Code.gs, for later API-rule wiring (rules.js).
// Per table: which roles may read / write (insert+update) / delete.
const ALL = ["Admin", "Manager", "Editor", "Viewer"];
const EDITOR_UP = ["Admin", "Manager", "Editor"];
const MANAGER_UP = ["Admin", "Manager"];
const ADMIN_ONLY = ["Admin"];

const _roleMatrix = {
  roles: APP_ROLES,
  tables: {
    // Operational: everyone reads, Editor+ writes; project DELETE is Manager+
    pl_projects:       { read: ALL, write: EDITOR_UP, delete: MANAGER_UP },
    pl_job_scopes:     { read: ALL, write: EDITOR_UP, delete: EDITOR_UP },
    pl_materials:      { read: ALL, write: EDITOR_UP, delete: EDITOR_UP },
    pl_subcon_charges: { read: ALL, write: EDITOR_UP, delete: EDITOR_UP },
    pl_daily_reports:  { read: ALL, write: EDITOR_UP, delete: EDITOR_UP },
    pl_manpower:       { read: ALL, write: EDITOR_UP, delete: EDITOR_UP },
    pl_project_photos: { read: ALL, write: EDITOR_UP, delete: EDITOR_UP },
    // Money: fully hidden from Editor/Viewer (VIEW_MONEY + EDIT_PAYMENTS)
    pl_client_payments:   { read: MANAGER_UP, write: MANAGER_UP, delete: MANAGER_UP },
    pl_subcon_payments:   { read: MANAGER_UP, write: MANAGER_UP, delete: MANAGER_UP },
    pl_supplier_payments: { read: MANAGER_UP, write: MANAGER_UP, delete: MANAGER_UP },
    pl_credit_notes:      { read: MANAGER_UP, write: MANAGER_UP, delete: MANAGER_UP },
    // Master lists + lookups: everyone reads, Manager+ writes (MANAGE_MASTER_LISTS)
    pl_buildings:      { read: ALL, write: MANAGER_UP, delete: MANAGER_UP },
    pl_subcons:        { read: ALL, write: MANAGER_UP, delete: MANAGER_UP },
    pl_suppliers:      { read: ALL, write: MANAGER_UP, delete: MANAGER_UP },
    pl_material_items: { read: ALL, write: MANAGER_UP, delete: MANAGER_UP },
    pl_divisions:      { read: ALL, write: MANAGER_UP, delete: MANAGER_UP },
    pl_workers:        { read: ALL, write: MANAGER_UP, delete: MANAGER_UP },
    pl_supervisors:    { read: ALL, write: MANAGER_UP, delete: MANAGER_UP },
    pl_lookups:        { read: ALL, write: MANAGER_UP, delete: MANAGER_UP },
    // User roles: Admin only (MANAGE_USERS); own role read via pl_my_role RPC
    pl_user_roles:     { read: ADMIN_ONLY, write: ADMIN_ONLY, delete: ADMIN_ONLY },
    // Audit log: Admin/Manager read (VIEW_AUDIT); writes only via pl_log_audit
    pl_audit_log:      { read: MANAGER_UP, write: [], delete: [] },
  },
};

// ---------------------------------------------------------------------------
// RPCs
// ---------------------------------------------------------------------------

// pl_my_role() → 'Admin' | 'Manager' | 'Editor' | 'Viewer'
// Called by project-pl-supabase.html bootstrap() and by the index.html hub
// (USER_PROFILE.finance_role). Returns the bare role string.
async function pl_my_role({ user, conn }) {
  return plRole(conn, user);
}

// pl_log_audit(p_action, p_record_type, p_record_id, p_details) → void
// Inserts into pl_audit_log (details truncated to 300 chars) AND mirrors into
// the shared foundation audit_log with a '[P&L] ' prefix.
async function pl_log_audit({ args, user, conn }) {
  const action = String(args.p_action || "");
  const recordType = String(args.p_record_type || "");
  const recordId = String(args.p_record_id || "");
  const details = String(args.p_details || "");
  if (!action) throw new Error("p_action is required.");
  await conn.query(
    "INSERT INTO pl_audit_log (at, user_email, action, record_type, record_id, details) VALUES (NOW(), ?, ?, ?, ?, ?)",
    [user.email, action, recordType, recordId, details.slice(0, 300)]
  );
  await conn.query(
    "INSERT INTO audit_log (at, user_email, action, details) VALUES (NOW(), ?, ?, ?)",
    [user.email, "[P&L] " + action + " " + recordType, recordId + " · " + details]
  );
  return true; // plpgsql returns void; caller ignores the value
}

// pl_next_project_code(p_parent_code default null) → text
// Sequential project codes PRJ-YYYYMM-### (Asia/Kuala_Lumpur month, zero-
// padded 3); with a parent code, next add-on letter suffix (PARENT-A, -B, …).
// Editor+ only. Atomic: SELECT … FOR UPDATE inside the route's transaction —
// InnoDB next-key locks on idx_pl_projects_code serialize concurrent callers
// so two inserts can never mint the same code.
async function pl_next_project_code({ args, user, conn }) {
  if (!(await plRoleIn(conn, user, ["Admin", "Manager", "Editor"]))) {
    throw new Error("Not authorised to create projects.");
  }

  const parentCode = String(args.p_parent_code || "").trim();

  if (!parentCode) {
    // Kuala Lumpur is UTC+8, no DST — shift the clock, read as UTC.
    const kl = new Date(Date.now() + 8 * 3600 * 1000);
    const yyyymm =
      kl.getUTCFullYear() + String(kl.getUTCMonth() + 1).padStart(2, "0");
    const prefix = "PRJ-" + yyyymm + "-";
    const [rows] = await conn.query(
      "SELECT code FROM pl_projects WHERE code LIKE ? FOR UPDATE",
      [prefix + "%"]
    );
    const re = new RegExp("^PRJ-" + yyyymm + "-(\\d+)$");
    let max = 0;
    for (const r of rows) {
      const m = re.exec(r.code || "");
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return prefix + String(max + 1).padStart(3, "0");
  }

  // Add-on job: parent code + next letter (A, B, C, …)
  // LIKE 'PARENT-_' (escaped) locks the child-code index range; the regexp
  // then keeps only single-uppercase-letter suffixes, as in plpgsql.
  const likeParent = parentCode.replace(/([\\%_])/g, "\\$1");
  const [rows] = await conn.query(
    "SELECT code FROM pl_projects WHERE code LIKE ? FOR UPDATE",
    [likeParent + "-_"]
  );
  const escapedParent = parentCode.replace(/[().[\]\\+*?^$|{}-]/g, "\\$&");
  const re = new RegExp("^" + escapedParent + "-([A-Z])$");
  let maxLetter = "@"; // chr before 'A', same default as plpgsql
  for (const r of rows) {
    const m = re.exec(r.code || "");
    if (m && m[1] > maxLetter) maxLetter = m[1];
  }
  return parentCode + "-" + String.fromCharCode(maxLetter.charCodeAt(0) + 1);
}

module.exports = {
  pl_my_role,
  pl_log_audit,
  pl_next_project_code,
  // non-RPC exports (underscore/camelCase — not valid RPC names by convention)
  plRole,
  plRoleIn,
  _roleMatrix,
};
