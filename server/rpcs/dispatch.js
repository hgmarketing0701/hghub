// dispatch RPC pack — port of supabase/schema-dispatch.sql dsp_save_job(payload jsonb).
// Atomic insert/update of dsp_jobs: mints the next sequential J-#### job_code
// (max of digits across job_code + 1, keeps the existing code on update),
// accepts the same camelCase payload keys the GAS saveJob() used,
// stamps created_by/updated_by from the auth email and writes the audit entry.
//
// Registered via server/rpc.js — receives ({ args, user, conn }) with conn inside
// an open transaction (commit/rollback handled by the route wrapper).

const { randomUUID } = require("crypto");

// payload->>'k' semantics: coalesce(payload->>'k','') — string or ''
const s = (v) => (v === undefined || v === null ? "" : String(v));
// coalesce(nullif(payload->>'k',''), fallback)
const nz = (v, fallback) => (s(v) !== "" ? s(v) : fallback);
// nullif(payload->>'k','')::date — '' / missing → NULL
const d = (v) => (s(v) !== "" ? s(v) : null);

async function dsp_save_job({ args, user, conn }) {
  const p = args.payload || args || {};

  if (s(p.mall) === "" && s(p.lotNo) === "" && s(p.client) === "") {
    throw new Error("At minimum a job needs a client, mall, or lot number.");
  }

  const id = nz(p.id, randomUUID());

  // Lock the existing row (if any) for the duration of the transaction.
  const [curRows] = await conn.query(
    "SELECT * FROM dsp_jobs WHERE id = ? FOR UPDATE",
    [id]
  );
  const cur = curRows[0] || null;

  // Keep the existing code on update; otherwise mint the next J-####
  // (max of any digits found in job_code, like the GAS backend).
  // FOR UPDATE serialises concurrent minting inside the transaction.
  let code = cur && s(cur.job_code) !== "" ? cur.job_code : nz(p.jobCode, null);
  if (code === null) {
    const [maxRows] = await conn.query(
      "SELECT COALESCE(MAX(CAST(REGEXP_SUBSTR(job_code, '[0-9]+') AS UNSIGNED)), 0) + 1 AS next_no " +
      "FROM dsp_jobs FOR UPDATE"
    );
    code = "J-" + String(maxRows[0].next_no).padStart(4, "0");
  }

  const label = [s(p.mall), s(p.lotNo), s(p.jobType)].filter(Boolean).join(" · ");

  // Shared field semantics (same coalesce/nullif rules as the plpgsql body)
  const needsVisual = s(p.needsVisual) === "yes" ? "yes" : "no";
  const fields = {
    job_code:           code,
    client:             s(p.client),
    client_group:       s(p.clientGroup),
    mall:               s(p.mall),
    lot_no:             s(p.lotNo),
    job_type:           nz(p.jobType, "install"),
    scope:              s(p.scope),
    door_type:          s(p.doorType),
    install_date:       d(p.installDate),
    measure_status:     nz(p.measureStatus, "pending"),
    sketch_url:         s(p.sketchUrl),
    quote_status:       nz(p.quoteStatus, "pending"),
    quote_ref:          s(p.quoteRef),
    needs_visual:       needsVisual,
    visual_status:      nz(p.visualStatus, needsVisual === "yes" ? "pending" : "na"),
    visual_url:         s(p.visualUrl),
    permit_by:          nz(p.permitBy, "us"),
    permit_status:      nz(p.permitStatus, "pending"),
    permit_url:         s(p.permitUrl),
    permit_approved_at: d(p.permitApprovedAt),
    material_ready:     s(p.materialReady) === "yes" ? "yes" : "no",
    material_notes:     s(p.materialNotes),
    job_status:         nz(p.jobStatus, "open"),
    notes:              s(p.notes),
  };

  if (cur) {
    // UPDATE — dispatch assignment fields fall back to the current row
    fields.dispatch_date = d(p.dispatchDate) !== null ? d(p.dispatchDate) : cur.dispatch_date;
    fields.team_no       = nz(p.teamNo, cur.team_no === null ? "" : cur.team_no);
    fields.seq           = p.seq !== undefined && p.seq !== null ? String(p.seq)
                           : (cur.seq === null ? "" : cur.seq);

    const cols = Object.keys(fields);
    await conn.query(
      "UPDATE dsp_jobs SET " + cols.map((c) => c + " = ?").join(", ") +
      ", updated_at = NOW(), updated_by = ? WHERE id = ?",
      [...cols.map((c) => fields[c]), user.email, id]
    );
    await conn.query(
      "INSERT INTO audit_log (at, user_email, action, details) VALUES (NOW(), ?, ?, ?)",
      [user.email, "UPDATE Job", code + " · " + label]
    );
  } else {
    // INSERT
    fields.dispatch_date = d(p.dispatchDate);
    fields.team_no       = s(p.teamNo);
    fields.seq           = s(p.seq);

    const cols = Object.keys(fields);
    await conn.query(
      "INSERT INTO dsp_jobs (id, " + cols.join(", ") + ", created_by, updated_by) VALUES (?" +
      ", ?".repeat(cols.length) + ", ?, ?)",
      [id, ...cols.map((c) => fields[c]), user.email, user.email]
    );
    await conn.query(
      "INSERT INTO audit_log (at, user_email, action, details) VALUES (NOW(), ?, ?, ?)",
      [user.email, "CREATE Job", code + " · " + label]
    );
  }

  return id; // uuid, same as the plpgsql function
}

module.exports = { dsp_save_job };
