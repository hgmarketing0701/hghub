// RPC pack: workers module — ports of supabase/schema-workers.sql plpgsql fns.
// See mysql/modules/13-workers.sql tail for the RPC-PORT checklist.
// Every fn runs inside the route wrapper's open transaction — conn.query only.

const crypto = require("crypto");

// ---- small helpers (mirror the plpgsql coalesce/nullif casts) --------------

const s = (v) => (v === undefined || v === null ? "" : String(v)); // coalesce(x,'')

// nullif(x,'')::date — '' / null → NULL, else the yyyy-mm-dd string (MySQL casts)
function toDate(v) {
  const t = s(v).trim();
  return t === "" ? null : t.slice(0, 10);
}

// coalesce(nullif(x,'')::numeric, 0) — invalid numerics throw like a PG cast
function toNum(v) {
  const t = s(v).trim();
  if (t === "") return 0;
  const n = Number(t);
  if (!isFinite(n)) throw new Error("Invalid number: " + t);
  return n;
}

// perform log_audit(action, details) — same row the shared log_audit RPC writes
async function audit(conn, user, action, details) {
  await conn.query(
    "INSERT INTO audit_log (at, user_email, action, details) VALUES (NOW(), ?, ?, ?)",
    [user.email, action, s(details)]
  );
}

module.exports = {

  // ── wkr_save_permit(payload) → uuid ───────────────────────────────────────
  // Atomic upsert of a work permit, then REPLACES its worker links + attachments
  // from the payload (payload is the source of truth — same as the GAS server).
  // Called from workers-supabase.html savePermit(): rpc('wkr_save_permit',{payload}).
  wkr_save_permit: async ({ args, user, conn }) => {
    const p = args.payload || {};

    if (s(p.mallName) === "" && s(p.permitNumber) === "" && s(p.title) === "") {
      throw new Error("At minimum the permit needs a mall, permit number, or title.");
    }

    const id = s(p.id).trim() || crypto.randomUUID();
    const [existing] = await conn.query(
      "SELECT id FROM wkr_work_permits WHERE id = ?", [id]
    );
    const editing = existing.length > 0;

    // only keep the linked policy when source really is the HG library
    let polId = s(p.insurancePolicyId).trim() || null;
    if ((s(p.insuranceSource).trim() || "none") !== "hg_existing") polId = null;

    const cols = {
      permit_number:           s(p.permitNumber),
      title:                   s(p.title),
      mall_name:               s(p.mallName),
      project_reference:       s(p.projectReference),
      contractor_client:       s(p.contractorClient),
      work_scope:              s(p.workScope),
      work_area:               s(p.workArea),
      working_hours:           s(p.workingHours),
      applied_by:              s(p.appliedBy).trim() || "own_team",
      issued_by:               s(p.issuedBy),
      issue_date:              toDate(p.issueDate),
      valid_from:              toDate(p.validFrom),
      valid_until:             toDate(p.validUntil),
      file_url:                s(p.fileUrl),
      status:                  s(p.status).trim() || "active",
      notes:                   s(p.notes),
      duration:                s(p.duration).trim() || "ad_hoc",
      insurance_source:        s(p.insuranceSource).trim() || "none",
      insurance_policy_id:     polId,
      insurance_provider:      s(p.insuranceProvider),
      insurance_policy_number: s(p.insurancePolicyNumber),
      insurance_file_url:      s(p.insuranceFileUrl),
      insurance_notes:         s(p.insuranceNotes),
      client_invoice_number:   s(p.clientInvoiceNumber),
    };

    if (editing) {
      const sets = Object.keys(cols).map((c) => c + " = ?").join(", ");
      await conn.query(
        `UPDATE wkr_work_permits SET ${sets}, updated_by = ?, updated_at = NOW() WHERE id = ?`,
        [...Object.values(cols), user.email, id]
      );
    } else {
      const names = Object.keys(cols).join(", ");
      const marks = Object.keys(cols).map(() => "?").join(", ");
      await conn.query(
        `INSERT INTO wkr_work_permits (id, ${names}, created_by, updated_by, updated_at)
         VALUES (?, ${marks}, ?, ?, NOW())`,
        [id, ...Object.values(cols), user.email, user.email]
      );
    }

    // Replace worker join rows (dedup the incoming list, drop empties)
    if ("workerIds" in p) {
      await conn.query("DELETE FROM wkr_permit_workers WHERE permit_id = ?", [id]);
      const wids = [...new Set((Array.isArray(p.workerIds) ? p.workerIds : [])
        .map((w) => s(w).trim()).filter((w) => w !== ""))];
      if (wids.length) {
        await conn.query(
          "INSERT INTO wkr_permit_workers (id, permit_id, worker_id) VALUES " +
            wids.map(() => "(?, ?, ?)").join(", "),
          wids.flatMap((w) => [crypto.randomUUID(), id, w])
        );
      }
    }

    // Replace attachments (keep incoming order as sort_order; drop empty rows)
    if ("attachments" in p) {
      await conn.query("DELETE FROM wkr_permit_attachments WHERE permit_id = ?", [id]);
      const rows = (Array.isArray(p.attachments) ? p.attachments : [])
        .filter((a) => s(a && a.label) !== "" || s(a && a.fileUrl) !== "");
      if (rows.length) {
        await conn.query(
          "INSERT INTO wkr_permit_attachments (id, permit_id, label, file_url, sort_order) VALUES " +
            rows.map(() => "(?, ?, ?, ?, ?)").join(", "),
          rows.flatMap((a, i) => [crypto.randomUUID(), id, s(a.label), s(a.fileUrl), i])
        );
      }
    }

    await audit(conn, user,
      editing ? "wkr.permit.update" : "wkr.permit.create",
      s(p.permitNumber).trim() || s(p.title).trim() || s(p.mallName));
    return id;
  },

  // ── wkr_save_insurance(payload) → uuid ────────────────────────────────────
  // Atomic upsert of an insurance policy, then REPLACES its attachments,
  // quotes and payments child rows from the payload.
  // Called from workers-supabase.html saveInsurance(): rpc('wkr_save_insurance',{payload}).
  wkr_save_insurance: async ({ args, user, conn }) => {
    const p = args.payload || {};

    if (s(p.policyNumber).trim() === "") throw new Error("Policy / cover note number required.");
    if (s(p.provider).trim() === "")     throw new Error("Insurance provider required.");

    const id = s(p.id).trim() || crypto.randomUUID();
    const [existing] = await conn.query(
      "SELECT id FROM wkr_insurance_policies WHERE id = ?", [id]
    );
    const editing = existing.length > 0;

    const cols = {
      policy_number:     s(p.policyNumber).trim(),
      provider:          s(p.provider).trim(),
      coverage_type:     s(p.coverageType),
      coverage_amount:   s(p.coverageAmount),
      valid_from:        toDate(p.validFrom),
      valid_until:       toDate(p.validUntil),
      file_url:          s(p.fileUrl),
      notes:             s(p.notes),
      status:            s(p.status).trim() || "active",
      invoice_number:    s(p.invoiceNumber),
      premium_amount:    toNum(p.premiumAmount),
      charged_to_client: toNum(p.chargedToClient),
    };

    if (editing) {
      const sets = Object.keys(cols).map((c) => c + " = ?").join(", ");
      await conn.query(
        `UPDATE wkr_insurance_policies SET ${sets}, updated_by = ?, updated_at = NOW() WHERE id = ?`,
        [...Object.values(cols), user.email, id]
      );
    } else {
      const names = Object.keys(cols).join(", ");
      const marks = Object.keys(cols).map(() => "?").join(", ");
      await conn.query(
        `INSERT INTO wkr_insurance_policies (id, ${names}, created_by, updated_by, updated_at)
         VALUES (?, ${marks}, ?, ?, NOW())`,
        [id, ...Object.values(cols), user.email, user.email]
      );
    }

    // Replace attachments (payload order → sort_order; drop empty rows)
    if ("attachments" in p) {
      await conn.query("DELETE FROM wkr_insurance_attachments WHERE policy_id = ?", [id]);
      const rows = (Array.isArray(p.attachments) ? p.attachments : [])
        .filter((a) => s(a && a.label) !== "" || s(a && a.fileUrl) !== "");
      if (rows.length) {
        await conn.query(
          "INSERT INTO wkr_insurance_attachments (id, policy_id, label, file_url, sort_order) VALUES " +
            rows.map(() => "(?, ?, ?, ?, ?)").join(", "),
          rows.flatMap((a, i) => [crypto.randomUUID(), id, s(a.label), s(a.fileUrl), i])
        );
      }
    }

    // Replace quotes (keep rows with a provider or a non-zero amount)
    if ("quotes" in p) {
      await conn.query("DELETE FROM wkr_insurance_quotes WHERE policy_id = ?", [id]);
      const rows = (Array.isArray(p.quotes) ? p.quotes : [])
        .filter((q) => s(q && q.provider) !== "" || toNum(q && q.amount) !== 0);
      if (rows.length) {
        await conn.query(
          "INSERT INTO wkr_insurance_quotes (id, policy_id, provider, amount, notes, sort_order) VALUES " +
            rows.map(() => "(?, ?, ?, ?, ?, ?)").join(", "),
          rows.flatMap((q, i) => [crypto.randomUUID(), id, s(q.provider), toNum(q.amount), s(q.notes), i])
        );
      }
    }

    // Replace payments (keep rows with a non-zero amount or a payment date)
    if ("payments" in p) {
      await conn.query("DELETE FROM wkr_insurance_payments WHERE policy_id = ?", [id]);
      const rows = (Array.isArray(p.payments) ? p.payments : [])
        .filter((pm) => toNum(pm && pm.amount) !== 0 || s(pm && pm.paymentDate) !== "");
      if (rows.length) {
        await conn.query(
          "INSERT INTO wkr_insurance_payments (id, policy_id, payment_date, amount, reference, notes, sort_order) VALUES " +
            rows.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", "),
          rows.flatMap((pm, i) => [
            crypto.randomUUID(), id, toDate(pm.paymentDate), toNum(pm.amount),
            s(pm.reference), s(pm.notes), i,
          ])
        );
      }
    }

    await audit(conn, user,
      editing ? "wkr.insurance.update" : "wkr.insurance.create",
      s(p.provider) + " · " + s(p.policyNumber));
    return id;
  },

  // ── wkr_delete_division(p_id) → void ──────────────────────────────────────
  // Blocks the delete if any non-resigned workers are still assigned; detaches
  // resigned workers (division_id = NULL), then deletes. Same guard as GAS.
  // Called from workers-supabase.html deleteDivision(): rpc('wkr_delete_division',{p_id}).
  wkr_delete_division: async ({ args, user, conn }) => {
    const id = s(args.p_id || args.id).trim();
    if (!id) throw new Error("Division not found.");

    const [rows] = await conn.query("SELECT name FROM wkr_divisions WHERE id = ?", [id]);
    if (!rows.length) throw new Error("Division not found.");
    const name = rows[0].name;

    const [assigned] = await conn.query(
      "SELECT 1 FROM wkr_workers WHERE division_id = ? AND status <> 'resigned' LIMIT 1",
      [id]
    );
    if (assigned.length) {
      throw new Error(
        'Cannot delete: workers are still assigned to "' + name +
        '". Reassign them first, or mark the division inactive.'
      );
    }

    await conn.query("UPDATE wkr_workers SET division_id = NULL WHERE division_id = ?", [id]);
    await conn.query("DELETE FROM wkr_divisions WHERE id = ?", [id]);
    await audit(conn, user, "wkr.division.delete", name);
    return null;
  },
};
