// Per-table access rules — replaces Supabase RLS.
// Default (table not listed): any signed-in user can read + write.
// { read: 'admin', write: 'admin', hideCols: [...], deny: true }
//
// hideCols: stripped from GET responses for non-admins (column-level privacy).

const tableRules = {
  // auth — managed exclusively via /api/auth/users, never via generic CRUD
  users: { deny: true },

  // audit logs: anyone can append, nobody edits (append-only enforced here)
  audit_log: { read: "staff", write: "staff" }, // inserts only — PATCH/DELETE blocked below

  // AI briefing cache: written by the server itself
  ai_briefings: { read: "staff", write: "admin" },

  // Project P&L — restricted access in production (UserRoles tab)
  pl_user_roles: { read: "admin", write: "admin" },

  // Job Arrangement workers: bank details are sensitive
  ja_workers: {
    read: "staff",
    write: "admin",
    hideCols: ["bank_name", "account_name", "account_no", "monthly_pay", "rate"]
  },

  // wage/payment data — admin only
  ja_wage_adjustments: { read: "admin", write: "admin" },

  // canonical masters — managed via /api/masters (normalize + pending workflow);
  // generic CRUD on them is admin-only so the workflow can't be bypassed
  hg_clients: { read: "admin", write: "admin" },
  hg_workers: { read: "admin", write: "admin", hideCols: ["rate", "monthly_pay", "bank_name", "account_name", "account_no"] },
  hg_vehicles: { read: "admin", write: "admin" },
  hg_malls: { read: "admin", write: "admin" },
  hg_master_map: { read: "admin", write: "admin" },

  // finance tools (payable/receivable) — admin only until UIs ship with role design
  ap_payment_requests: { read: "admin", write: "admin" },
  ap_audit_log: { read: "admin", write: "admin" },
  ar_payments_received: { read: "admin", write: "admin" },
  ar_audit_log: { read: "admin", write: "admin" }
};

// tables where PATCH/DELETE are never allowed (append-only)
const appendOnly = new Set([
  "audit_log", "ap_audit_log", "ar_audit_log", "ja_audit_log",
  "hrd_price_history", "wkr_report_history"
]);

module.exports = { tableRules, appendOnly };
