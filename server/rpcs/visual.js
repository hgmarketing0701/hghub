// visual.js — RPC pack for the Visual Works module.
// Ports of supabase/schema-visual.sql plpgsql fns: vis_pick_rate, vis_save_job,
// vis_save_invoice. Contract: async ({ args, user, conn }) => value; conn is a
// mysql2 connection inside an OPEN TRANSACTION (rpc.js commits/rolls back).
// DECIMAL columns arrive as strings (dateStrings pool) — Number() at use-site.

const crypto = require("crypto");

// ─── helpers ────────────────────────────────────────────────────────────────

const round2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
const num = (v) => {
  if (v === null || v === undefined) return 0;
  const s = String(v).trim();
  if (s === "") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};
const trimStr = (v) => String(v === null || v === undefined ? "" : v).trim();
const orNull = (v) => (trimStr(v) === "" ? null : trimStr(v));
const toBool = (v) => v === true || v === 1 || /^(t|true|y|yes|on|1)$/i.test(String(v || ""));

// Asia/Kuala_Lumpur (UTC+8, no DST) — mirrors `now() at time zone 'Asia/Kuala_Lumpur'`
const klNow = () => new Date(Date.now() + 8 * 3600 * 1000);
const klToday = () => klNow().toISOString().slice(0, 10);        // YYYY-MM-DD
const klYear = () => klToday().slice(0, 4);

const jsonArr = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return []; }
  }
  return [];
};

async function logAudit(conn, user, action, details) {
  await conn.query(
    "INSERT INTO audit_log (at, user_email, action, details) VALUES (NOW(), ?, ?, ?)",
    [user.email, action, details]
  );
}

// ─── RATE PICKER — most-specific match wins ─────────────────────────────────
// mall+material+jobType (7) > mall+material (6) > mall+jobType (5) > mall (4)
// > material(+type) (2-3) > jobType (1) > ALL (0). Only rates effective on/before
// the job date count; tie-break = most recent effective_from (NULLs last, which
// is MySQL's default for DESC). Returns null when nothing matches.
async function pickRate(conn, mall, material, jobType, date) {
  const d = orNull(date);
  const [rows] = await conn.query(
    `SELECT * FROM vis_rates v
     WHERE (v.effective_from IS NULL OR ? IS NULL OR v.effective_from <= ?)
       AND (LOWER(COALESCE(v.mall,''))     IN ('','all','any','*') OR LOWER(v.mall)     = LOWER(?))
       AND (LOWER(COALESCE(v.material,'')) IN ('','all','any','*') OR LOWER(v.material) = LOWER(?))
       AND (LOWER(COALESCE(v.job_type,'')) IN ('','all','any','*') OR LOWER(v.job_type) = LOWER(?))
     ORDER BY
       ( (CASE WHEN LOWER(COALESCE(v.mall,''))     NOT IN ('','all','any','*') THEN 4 ELSE 0 END)
       + (CASE WHEN LOWER(COALESCE(v.material,'')) NOT IN ('','all','any','*') THEN 2 ELSE 0 END)
       + (CASE WHEN LOWER(COALESCE(v.job_type,'')) NOT IN ('','all','any','*') THEN 1 ELSE 0 END) ) DESC,
       v.effective_from DESC
     LIMIT 1`,
    [d, d, trimStr(mall), trimStr(material), trimStr(jobType)]
  );
  if (!rows.length) return null;
  const r = rows[0];
  r.rate_per_sqft = num(r.rate_per_sqft);
  r.install_rate  = num(r.install_rate);
  r.package_rate  = num(r.package_rate);
  r.min_charge    = num(r.min_charge);
  return r;
}

// feet-per-unit conversion — identical to panelSqft_ / the plpgsql CASE
function toFeet(v, unit) {
  switch (unit) {
    case "mm": return v / 304.8;
    case "cm": return v / 30.48;
    case "m":  return v * 3.280839895;
    case "in": return v / 12;
    default:   return v;          // ft
  }
}

// ─── RPCs ───────────────────────────────────────────────────────────────────

module.exports = {

  // vis_pick_rate(p_mall, p_material, p_job_type, p_date) → vis_rates row | null
  vis_pick_rate: async ({ args, conn }) => {
    return pickRate(conn, args.p_mall, args.p_material, args.p_job_type, args.p_date);
  },

  // ─── SAVE JOB — server recomputes every sqft + amount (never trusts client)
  // payload: { id?, status?, mall, lotNo, jobType, client, requestedBy, requestDate,
  //            installDate, material, notes, permitId, artworkLink,
  //            sketchPath?, sketchLink?, proofPath?, proofLink?, sitePhotoPaths?[],
  //            panels:[{label,widthVal,heightVal,unit,qty,material?,ratePerSqft?}] }
  // returns { ok, id, jobNo, totalSqft, expectedAmount }
  vis_save_job: async ({ args, user, conn }) => {
    const payload = args.payload || {};
    const editing = trimStr(payload.id) !== "";
    const mall = trimStr(payload.mall);
    const lot  = trimStr(payload.lotNo);
    if (mall === "") throw new Error("Mall is required.");
    if (lot === "")  throw new Error("Lot number is required.");

    const type = ["print_install", "print_only", "install_only"].includes(payload.jobType)
      ? payload.jobType : "print_install";
    const material = trimStr(payload.material);
    const date = orNull(payload.requestDate) || klToday();

    let id, jobNo, old = null;
    if (editing) {
      id = payload.id;
      const [rows] = await conn.query("SELECT * FROM vis_jobs WHERE id = ?", [id]);
      if (!rows.length) throw new Error("Job not found for edit.");
      old = rows[0];
      jobNo = old.job_no;
    } else {
      id = crypto.randomUUID();
      // atomic sequential job number VIS-YYYY-#### — FOR UPDATE takes next-key
      // locks on the job_no index range, standing in for the plpgsql table lock
      const year = klYear();
      const [[{ n }]] = await conn.query(
        `SELECT COALESCE(MAX(CAST(SUBSTRING(job_no, 10) AS UNSIGNED)), 0) + 1 AS n
         FROM vis_jobs WHERE job_no REGEXP ? FOR UPDATE`,
        ["^VIS-" + year + "-[0-9]+$"]
      );
      jobNo = "VIS-" + year + "-" + String(n).padStart(4, "0");
    }

    // job-level rate snapshot; package (all-in) rate only applies to print+install
    const rate = await pickRate(conn, mall, material, type, date);
    const usePkg = type === "print_install" && rate !== null && rate.package_rate > 0;

    // recompute panels server-side (identical maths to GAS panelSqft_/saveJob)
    const rateCache = {};   // per-material lookups within this job (stable fn)
    const panelRate = async (pmat) => {
      const key = pmat.toLowerCase();
      if (!(key in rateCache)) rateCache[key] = await pickRate(conn, mall, pmat, type, date);
      return rateCache[key];
    };
    let totalSqft = 0, subtotal = 0;
    const panels = [];
    for (const p of (Array.isArray(payload.panels) ? payload.panels : [])) {
      const w = num(p.widthVal), h = num(p.heightVal);
      if (w === 0 && h === 0) continue;
      let q = num(p.qty); if (q === 0) q = 1;
      const unit = ["mm", "cm", "m", "in", "ft"].includes(p.unit) ? p.unit : "mm";
      const sqft = round2(toFeet(w, unit) * toFeet(h, unit) * q);
      const pmat = trimStr(p.material) || material;
      // per-panel rate: explicit > install-only (install rate) > package > print rate
      let prv = num(p.ratePerSqft);
      if (prv === 0) {
        if (type === "install_only") {
          const pr = await panelRate(pmat);
          prv = pr ? pr.install_rate : 0;
        } else if (usePkg) {
          prv = rate.package_rate;
        } else {
          const pr = await panelRate(pmat);
          prv = pr ? pr.rate_per_sqft : 0;
        }
      }
      const amt = round2(sqft * prv);
      totalSqft = round2(totalSqft + sqft);
      subtotal  = round2(subtotal + amt);
      panels.push({
        label: p.label === null || p.label === undefined ? "" : String(p.label),
        width_val: w, height_val: h, unit, qty: q, sqft,
        material: pmat, rate_per_sqft: prv, amount: amt
      });
    }

    const jobRate = type === "install_only" ? (rate ? rate.install_rate : 0)
                  : usePkg ? rate.package_rate
                  : (rate ? rate.rate_per_sqft : 0);
    const instRate = rate ? rate.install_rate : 0;
    // separate install line only for print+install on the split (non-package) rate
    const instAmt = (type === "print_install" && !usePkg) ? round2(totalSqft * instRate) : 0;
    let expected = round2(subtotal + instAmt);
    if (rate !== null && rate.min_charge > 0 && expected < rate.min_charge) {
      expected = round2(rate.min_charge);
    }

    // sketch & proof: new upload > pasted link > existing value
    let skUrl  = editing ? (old.sketch_url  || "") : "";
    let skPath = editing ? (old.sketch_path || "") : "";
    if (String(payload.sketchPath || "") !== "") {
      skPath = payload.sketchPath; skUrl = "";
    } else if (trimStr(payload.sketchLink) !== "") {
      skUrl = trimStr(payload.sketchLink); skPath = "";
    }
    let pfUrl  = editing ? (old.artwork_proof_url  || "") : "";
    let pfPath = editing ? (old.artwork_proof_path || "") : "";
    if (String(payload.proofPath || "") !== "") {
      pfPath = payload.proofPath; pfUrl = "";
    } else if (trimStr(payload.proofLink) !== "") {
      pfUrl = trimStr(payload.proofLink); pfPath = "";
    }
    // site photos: append new uploads to the existing set
    const site = (editing ? jsonArr(old.site_photo_paths) : [])
      .concat(jsonArr(payload.sitePhotoPaths));

    const STATUSES = ["NEW", "DRAFT_IN", "SENT_CLIENT", "ARTWORK_REJECTED",
                      "APPROVED", "PRINTING", "INSTALLED", "COMPLETED", "CANCELLED"];
    const status = STATUSES.includes(payload.status) ? payload.status
                 : (editing ? old.status : "NEW");

    const client      = trimStr(payload.client);
    const requestedBy = trimStr(payload.requestedBy) || user.email;
    const installDate = orNull(payload.installDate);
    const artworkLink = trimStr(payload.artworkLink);
    const permitId    = orNull(payload.permitId);
    const notes       = trimStr(payload.notes);
    const rateId      = rate ? rate.id : null;

    if (editing) {
      await conn.query(
        `UPDATE vis_jobs SET
           status = ?, mall = ?, lot_no = ?, job_type = ?, client = ?,
           requested_by = ?, request_date = ?, install_date = ?, artwork_link = ?,
           artwork_proof_url = ?, artwork_proof_path = ?,
           sketch_url = ?, sketch_path = ?, site_photo_paths = ?,
           material = ?, total_sqft = ?, rate_id = ?, rate_per_sqft = ?,
           install_rate = ?, subtotal = ?, expected_amount = ?,
           permit_id = ?, notes = ?, updated_at = NOW()
         WHERE id = ?`,
        [status, mall, lot, type, client, requestedBy, date, installDate, artworkLink,
         pfUrl, pfPath, skUrl, skPath, JSON.stringify(site),
         material, totalSqft, rateId, jobRate, instRate, subtotal, expected,
         permitId, notes, id]
      );
      await conn.query("DELETE FROM vis_job_panels WHERE job_id = ?", [id]);   // replace panels
    } else {
      await conn.query(
        `INSERT INTO vis_jobs (id, job_no, status, mall, lot_no, job_type, client,
           requested_by, request_date, install_date, artwork_link,
           artwork_proof_url, artwork_proof_path, sketch_url, sketch_path,
           site_photo_paths, material, total_sqft, rate_id, rate_per_sqft,
           install_rate, subtotal, expected_amount, permit_id, notes, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, jobNo, status, mall, lot, type, client, requestedBy, date, installDate,
         artworkLink, pfUrl, pfPath, skUrl, skPath, JSON.stringify(site),
         material, totalSqft, rateId, jobRate, instRate, subtotal, expected,
         permitId, notes, user.email]
      );
    }

    for (const p of panels) {
      await conn.query(
        `INSERT INTO vis_job_panels (id, job_id, label, width_val, height_val, unit,
           qty, sqft, material, rate_per_sqft, amount)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [crypto.randomUUID(), id, p.label, p.width_val, p.height_val, p.unit,
         p.qty, p.sqft, p.material, p.rate_per_sqft, p.amount]
      );
    }

    // rememberMall_
    if (mall.toLowerCase() !== "all") {
      await conn.query("INSERT IGNORE INTO vis_malls (id, name) VALUES (?, ?)",
        [crypto.randomUUID(), mall]);
    }

    await logAudit(conn, user, editing ? "vis.job.update" : "vis.job.create",
      jobNo + " · " + mall + " · Lot " + lot + " · " + totalSqft.toFixed(2) +
      " sqft · RM " + expected.toFixed(2));

    return { ok: true, id, jobNo, totalSqft, expectedAmount: expected };
  },

  // ─── SAVE INVOICE — logs B's invoice + lines, runs the reconciliation ──────
  // Tolerance: OK when |claimed − recorded| ≤ RM 5 OR ≤ 1% (same as RECON_TOL_*).
  // payload: { id?, invNo, invDate, period, status?, notes, claimedAmount, sstEnabled,
  //            filePath?, fileUrl?, lines:[{jobId, claimedSqft, claimedAmount}] }
  // returns { ok, id, verdict, flagged, claimedTotal, reconNote }
  vis_save_invoice: async ({ args, user, conn }) => {
    const payload = args.payload || {};
    const editing = trimStr(payload.id) !== "";
    const invNo = trimStr(payload.invNo);
    if (invNo === "") throw new Error("B's invoice number is required.");

    let id, old = null;
    if (editing) {
      id = payload.id;
      const [rows] = await conn.query("SELECT * FROM vis_invoices WHERE id = ?", [id]);
      if (!rows.length) throw new Error("Invoice not found.");
      old = rows[0];
    } else {
      id = crypto.randomUUID();
    }

    // per-job reconciliation — claimed vs HG recorded totals
    const malls = [];
    const links = [];
    let lineClaim = 0, lineRec = 0, flagged = 0, count = 0;
    for (const line of (Array.isArray(payload.lines) ? payload.lines : [])) {
      const jobId = String((line && line.jobId) || "");
      if (jobId === "") continue;
      const [jrows] = await conn.query("SELECT * FROM vis_jobs WHERE id = ?", [jobId]);
      const job = jrows[0] || null;               // deleted job → recorded 0 (kept, like GAS)
      const rsqft = job ? num(job.total_sqft) : 0;
      const ramt  = job ? num(job.expected_amount) : 0;
      if (job && job.mall !== null && job.mall !== undefined && !malls.includes(job.mall)) {
        malls.push(job.mall);
      }
      const csqft = round2(num(line.claimedSqft));
      const camt  = round2(num(line.claimedAmount));
      lineClaim = round2(lineClaim + camt);
      lineRec   = round2(lineRec + ramt);
      const diff = Math.abs(camt - ramt);
      const pct  = ramt !== 0 ? diff / Math.abs(ramt) : (diff !== 0 ? 1 : 0);
      // verdict rules — EXACT port: OK when diff ≤ RM 5.00 OR pct ≤ 1%,
      // else OVER when claimed > recorded, else UNDER
      const flag = (diff <= 5.00 || pct <= 0.01) ? "OK" : (camt > ramt ? "OVER" : "UNDER");
      if (flag !== "OK") flagged++;
      count++;
      links.push({
        job_id: jobId, claimed_sqft: csqft, claimed_amount: camt,
        recorded_sqft: rsqft, recorded_amount: ramt,
        variance_rm: round2(camt - ramt), flag
      });
    }

    let claimed = num(payload.claimedAmount);
    if (claimed === 0) claimed = lineClaim;
    claimed = round2(claimed);
    const sstOn  = toBool(payload.sstEnabled);
    const sst    = sstOn ? round2(claimed * 0.06) : 0;
    const ctotal = round2(claimed + sst);
    const verdict = flagged > 0 ? "CHECK" : "MATCH";
    const note = flagged > 0
      ? flagged + " of " + count + " job(s) differ from HG record · claimed RM " +
        lineClaim.toFixed(2) + " vs recorded RM " + lineRec.toFixed(2)
      : count + " job(s) tally with HG record";

    // invoice file: new upload/link replaces; else keep existing
    // (NB: a pasted fileUrl does NOT clear file_path — same as the plpgsql)
    let furl  = editing ? (old.file_url  || "") : "";
    let fpath = editing ? (old.file_path || "") : "";
    if (String(payload.filePath || "") !== "") {
      fpath = payload.filePath; furl = "";
    } else if (String(payload.fileUrl || "") !== "") {
      furl = payload.fileUrl;
    }

    const status = trimStr(payload.status) ||
      (verdict === "MATCH" ? "verified" : "checking");
    const invDate = orNull(payload.invDate) || klToday();
    const period  = trimStr(payload.period);
    const notes   = trimStr(payload.notes);
    const mallsStr = malls.join(", ");

    if (editing) {
      await conn.query(
        `UPDATE vis_invoices SET
           inv_no = ?, inv_date = ?, period = ?, malls = ?,
           claimed_amount = ?, sst_enabled = ?, sst_amount = ?, claimed_total = ?,
           file_url = ?, file_path = ?, status = ?,
           recon_verdict = ?, recon_note = ?, notes = ?, updated_at = NOW()
         WHERE id = ?`,
        [invNo, invDate, period, mallsStr, claimed, sstOn ? 1 : 0, sst, ctotal,
         furl, fpath, status, verdict, note, notes, id]
      );
      await conn.query("DELETE FROM vis_invoice_jobs WHERE invoice_id = ?", [id]);
    } else {
      await conn.query(
        `INSERT INTO vis_invoices (id, inv_no, inv_date, period, malls,
           claimed_amount, sst_enabled, sst_amount, claimed_total,
           file_url, file_path, status, recon_verdict, recon_note, notes, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, invNo, invDate, period, mallsStr, claimed, sstOn ? 1 : 0, sst, ctotal,
         furl, fpath, status, verdict, note, notes, user.email]
      );
    }

    for (const l of links) {
      await conn.query(
        `INSERT INTO vis_invoice_jobs (id, invoice_id, job_id, claimed_sqft,
           claimed_amount, recorded_sqft, recorded_amount, variance_rm, flag)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [crypto.randomUUID(), id, l.job_id, l.claimed_sqft, l.claimed_amount,
         l.recorded_sqft, l.recorded_amount, l.variance_rm, l.flag]
      );
    }

    await logAudit(conn, user, editing ? "vis.invoice.update" : "vis.invoice.create",
      invNo + " · " + verdict + " · " + count + " job(s) · claimed RM " +
      claimed.toFixed(2) + " · " + note);

    return { ok: true, id, verdict, flagged, claimedTotal: ctotal, reconNote: note };
  }
};
