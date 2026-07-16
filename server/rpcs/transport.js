// RPC pack: transport — port of supabase/schema-transport.sql plpgsql functions.
// Registered by server/rpc.js; each fn runs inside an open transaction on `conn`.
//
// Client call shapes (transport-supabase.html):
//   rpcSave(fn, p)  → sb.rpc(fn, { payload: p })   — args = { payload: {...} }
//   trn_assign_jobs_to_trip                          — args = { p_trip_id, p_job_ids: [] }
// Returns: uuid string for the save_* fns (UI opens the record by it), null for void fns.

const { randomUUID } = require("crypto");

// money-safe 2dp rounding
const r2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;

// coalesce(payload->>'k','')             — absent → ''
const s = (v) => (v == null ? "" : String(v));

// coalesce(nullif(payload->>'k',''), d)  — absent or '' → d
const nz = (v, d) => (v == null || v === "" ? d : String(v));

// coalesce(nullif(payload->>'k','')::numeric, d)
const num = (v, d) => {
  if (v == null || v === "") return d;
  const n = Number(v);
  return isNaN(n) ? d : n;
};

// (payload->>'k')::boolean with coalesce(..., false)
const asBool = (v) => v === true || v === "true" || v === 1 || v === "1";

// KL is UTC+8, no DST — today's date in Asia/Kuala_Lumpur as YYYY-MM-DD
const klToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

// log_audit(action, details) — foundation audit_log table
async function audit(conn, email, action, details) {
  await conn.query(
    "INSERT INTO audit_log (at, user_email, action, details) VALUES (NOW(), ?, ?, ?)",
    [email, action, String(details)]
  );
}

// atomic sequential ref (ENG-0001 / RUN-0001): prefix from trn_settings, then
// SELECT ... FOR UPDATE on the matching refs so concurrent mints serialize.
async function nextRef(conn, table, settingKey, defPrefix) {
  const [pr] = await conn.query("SELECT value FROM trn_settings WHERE `key` = ?", [settingKey]);
  const prefix = pr.length && String(pr[0].value || "") !== "" ? String(pr[0].value) : defPrefix;
  const [rows] = await conn.query(
    "SELECT ref FROM " + table + " WHERE ref LIKE ? FOR UPDATE",
    [prefix + "%"]
  );
  let maxN = 0;
  for (const row of rows) {
    const tail = String(row.ref).slice(prefix.length);
    if (/^[0-9]+$/.test(tail)) maxN = Math.max(maxN, parseInt(tail, 10));
  }
  return prefix + String(maxN + 1).padStart(4, "0");
}

async function getOne(conn, sql, params) {
  const [rows] = await conn.query(sql, params);
  return rows.length ? rows[0] : null;
}

module.exports = {
  // ── trn_save_engagement({ payload }) → engagement id ──────────────────────
  // payload: { id?, clientId, reason, siteName, siteAddress, handledBy, remarks, status? }
  trn_save_engagement: async ({ args, user, conn }) => {
    const p = args.payload || {};
    if (s(p.clientId) === "") throw new Error("Client is required.");
    const client = await getOne(conn, "SELECT * FROM trn_clients WHERE id = ?", [String(p.clientId)]);
    if (!client) throw new Error("Client not found.");

    if (s(p.id) !== "") {
      const ex = await getOne(conn, "SELECT * FROM trn_engagements WHERE id = ?", [String(p.id)]);
      if (!ex) throw new Error("Engagement not found.");
      await conn.query(
        `UPDATE trn_engagements SET
           client_id = ?, client_company = ?, reason = ?,
           site_name = ?, site_address = ?, status = ?,
           handled_by = ?, remarks = ?, updated_by = ?, updated_at = NOW()
         WHERE id = ?`,
        [
          client.id, client.company,
          nz(p.reason, "Ad-hoc"),
          p.siteName == null ? ex.site_name : String(p.siteName),      // coalesce(payload->>'siteName', site_name)
          p.siteAddress == null ? ex.site_address : String(p.siteAddress),
          nz(p.status, ex.status),
          p.handledBy == null ? ex.handled_by : String(p.handledBy),
          p.remarks == null ? ex.remarks : String(p.remarks),
          user.email, ex.id,
        ]
      );
      // keep job denormalised client fields in sync
      await conn.query(
        "UPDATE trn_jobs SET client_company = ?, client_id = ? WHERE engagement_id = ?",
        [client.company, client.id, ex.id]
      );
      await audit(conn, user.email, "UPDATE Engagement", ex.ref + " · " + client.company);
      return ex.id;
    }

    const ref = await nextRef(conn, "trn_engagements", "ENG_PREFIX", "ENG-");
    const id = randomUUID();
    await conn.query(
      `INSERT INTO trn_engagements (id, ref, client_id, client_company, reason, site_name, site_address,
                                    status, handled_by, remarks, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, ref, client.id, client.company,
        nz(p.reason, "Ad-hoc"), s(p.siteName), s(p.siteAddress),
        nz(p.status, "Open"), nz(p.handledBy, user.email), s(p.remarks),
        user.email, user.email,
      ]
    );
    await audit(conn, user.email, "CREATE Engagement",
      ref + " · " + client.company + " / " + nz(p.reason, "Ad-hoc"));
    return id;
  },

  // ── trn_save_job({ payload }) → job id ────────────────────────────────────
  // Server-side recompute: qty per service, amount (rate×qty / manual / 0 internal),
  // rorobin bin clash check, lorry multi-stop summary derivation, invoiced-job guard.
  trn_save_job: async ({ args, user, conn }) => {
    const p = args.payload || {};
    if (s(p.engagementId) === "") throw new Error("Engagement is required.");
    const service = p.service == null ? null : String(p.service);
    if (!["Lorry", "Mover", "Rorobin"].includes(service)) throw new Error("Pick a valid service.");
    const eng = await getOne(conn, "SELECT * FROM trn_engagements WHERE id = ?", [String(p.engagementId)]);
    if (!eng) throw new Error("Engagement not found.");

    const internal = asBool(p.internalUse);
    const manual = p.manualAmount;
    const hasManual = !internal && manual != null && manual !== "";

    let rate = null;
    if (s(p.rateCode) !== "") {
      rate = await getOne(conn, "SELECT * FROM trn_rates WHERE LOWER(code) = LOWER(?) LIMIT 1", [String(p.rateCode)]);
    }
    if (!internal && !hasManual) {
      if (!rate) throw new Error("Pick a rate or key a charge amount.");
      if (!Number(rate.active)) throw new Error("Rate " + rate.code + " is inactive — pick an active rate.");
      if (rate.service !== service)
        throw new Error("Rate " + rate.code + " is for " + rate.service + ", not " + service + ".");
    }

    // quantity per service
    let qty;
    if (service === "Lorry") qty = Math.max(1, num(p.trips, 1));
    else if (service === "Mover") qty = Math.max(1, num(p.movers, 1) * num(p.shifts, 1));
    else qty = Math.max(1, num(p.quantity, 1));

    const amount = internal ? 0 : hasManual ? r2(Number(manual)) : r2((rate ? Number(rate.rate) : 0) * qty);

    // rorobin bin handling + clash check
    let binId = null, binNo = "";
    if (service === "Rorobin") {
      binId = nz(p.binId, null);
      if (binId == null) throw new Error("Select a rorobin bin.");
      const bin = await getOne(conn, "SELECT * FROM trn_bins WHERE id = ?", [binId]);
      if (!bin) throw new Error("Bin not found.");
      binNo = bin.bin_no;
      if (s(p.collectDateTime) === "" &&
          !["Completed", "Cancelled"].includes(nz(p.status, "Scheduled"))) {
        const clash = await getOne(
          conn,
          `SELECT 1 AS x FROM trn_jobs
            WHERE service = 'Rorobin' AND bin_id = ?
              AND NOT (id <=> ?)
              AND status NOT IN ('Completed','Cancelled')
              AND COALESCE(collect_datetime, '') = ''
            LIMIT 1`,
          [binId, nz(p.id, null)]
        );
        if (clash) throw new Error("Bin " + binNo + " is already deployed. Collect it first.");
      }
    }

    let maxDays = num(p.maxDays, null);
    if (maxDays == null) {
      const md = await getOne(conn, "SELECT value FROM trn_settings WHERE `key` = 'ROROBIN_MAX_DAYS'", []);
      maxDays = md && String(md.value || "") !== "" && !isNaN(Number(md.value)) ? Number(md.value) : 3;
    }

    // multi-stop legs (lorry): derive summary from/to/time when blank
    const stops = Array.isArray(p.stops) ? p.stops : [];
    let start = s(p.startDateTime), end = s(p.endDateTime);
    let from = s(p.fromLocation), to = s(p.toLocation);
    if (service === "Lorry" && stops.length > 0) {
      const first = stops[0] || {}, last = stops[stops.length - 1] || {};
      if (start === "") start = s(first.pickupDateTime);
      if (end === "") end = s(last.deliveryDateTime);
      if (from === "") from = s(first.pickupLocation);
      if (to === "") to = s(last.deliveryLocation);
    }

    const rateLabel = internal ? "Internal use (no charge)"
      : rate ? rate.label
      : hasManual ? "Keyed charge" : "";

    const handledBy = nz(p.handledBy, eng.handled_by != null ? eng.handled_by : user.email);
    const unitRate = rate ? Number(rate.rate) : 0;

    if (s(p.id) !== "") {
      const ex = await getOne(conn, "SELECT * FROM trn_jobs WHERE id = ?", [String(p.id)]);
      if (!ex) throw new Error("Job not found.");
      if (ex.invoice_id != null)
        throw new Error("Job is already on invoice — void/unlink the invoice before editing the charge.");
      await conn.query(
        `UPDATE trn_jobs SET
           engagement_id = ?, engagement_ref = ?, client_id = ?, client_company = ?,
           service = ?, status = ?, stops = ?, start_datetime = ?, end_datetime = ?,
           from_location = ?, to_location = ?, lorry_type = ?, lorry_plate = ?, driver = ?,
           trips = ?, collection_mover_by = ?, delivery_mover_by = ?, movers = ?, shifts = ?,
           items_description = ?, bin_id = ?, bin_no = ?, placement_type = ?,
           place_datetime = ?, collect_datetime = ?, permit_no = ?, swcorp_ref = ?, max_days = ?,
           rate_code = ?, rate_label = ?, unit_rate = ?, quantity = ?, amount = ?,
           internal_use = ?, handled_by = ?, remarks = ?, updated_by = ?, updated_at = NOW()
         WHERE id = ?`,
        [
          eng.id, eng.ref, eng.client_id, eng.client_company,
          service, nz(p.status, "Scheduled"), JSON.stringify(stops), start, end,
          from, to, s(p.lorryType), s(p.lorryPlate), s(p.driver),
          num(p.trips, 0), s(p.collectionMoverBy), s(p.deliveryMoverBy), num(p.movers, 0), num(p.shifts, 0),
          s(p.itemsDescription), binId, binNo, s(p.placementType),
          s(p.placeDateTime), s(p.collectDateTime), s(p.permitNo), s(p.swcorpRef), maxDays,
          rate ? rate.code : "", rateLabel, unitRate, qty, amount,
          internal ? 1 : 0, handledBy, s(p.remarks), user.email, ex.id,
        ]
      );
      await audit(conn, user.email, "UPDATE Job",
        eng.ref + "/" + service + " · " + (internal ? "Internal (no charge)" : "RM" + amount));
      return ex.id;
    }

    const id = randomUUID();
    await conn.query(
      `INSERT INTO trn_jobs (id, engagement_id, engagement_ref, client_id, client_company, service, status,
         stops, start_datetime, end_datetime, from_location, to_location, lorry_type, lorry_plate, driver,
         trips, collection_mover_by, delivery_mover_by, movers, shifts, items_description,
         bin_id, bin_no, placement_type, place_datetime, collect_datetime, permit_no, swcorp_ref, max_days,
         rate_code, rate_label, unit_rate, quantity, amount, internal_use, handled_by, remarks,
         created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, eng.id, eng.ref, eng.client_id, eng.client_company, service, nz(p.status, "Scheduled"),
        JSON.stringify(stops), start, end, from, to, s(p.lorryType), s(p.lorryPlate), s(p.driver),
        num(p.trips, 0), s(p.collectionMoverBy), s(p.deliveryMoverBy), num(p.movers, 0), num(p.shifts, 0),
        s(p.itemsDescription),
        binId, binNo, s(p.placementType), s(p.placeDateTime), s(p.collectDateTime),
        s(p.permitNo), s(p.swcorpRef), maxDays,
        rate ? rate.code : "", rateLabel, unitRate, qty, amount, internal ? 1 : 0, handledBy, s(p.remarks),
        user.email, user.email,
      ]
    );
    await audit(conn, user.email, "CREATE Job",
      eng.ref + "/" + service + " · " +
      (internal ? "Internal (no charge)" : "RM" + amount + " (" + (rate ? rate.code : "-") + " ×" + qty + ")"));
    return id;
  },

  // ── trn_save_trip({ payload }) → trip id ──────────────────────────────────
  // payload: { id?, tripDate, shift, status, lorryPlate, driver, driverId, driverCost, lorryCost, notes, crew:[] }
  trn_save_trip: async ({ args, user, conn }) => {
    const p = args.payload || {};
    const crew = Array.isArray(p.crew) ? p.crew : [];
    const tripDate = nz(p.tripDate, klToday());
    const shift = p.shift === "Night" ? "Night" : "Day";
    const driverCost = r2(num(p.driverCost, 0));
    const lorryCost = r2(num(p.lorryCost, 0));

    if (s(p.id) !== "") {
      const ex = await getOne(conn, "SELECT * FROM trn_trips WHERE id = ?", [String(p.id)]);
      if (!ex) throw new Error("Trip not found.");
      await conn.query(
        `UPDATE trn_trips SET
           trip_date = ?, shift = ?, lorry_plate = ?, driver = ?, driver_id = ?,
           driver_cost = ?, lorry_cost = ?, crew = ?, status = ?, notes = ?,
           updated_by = ?, updated_at = NOW()
         WHERE id = ?`,
        [
          tripDate, shift, s(p.lorryPlate), s(p.driver), nz(p.driverId, null),
          driverCost, lorryCost, JSON.stringify(crew), nz(p.status, "Planned"), s(p.notes),
          user.email, ex.id,
        ]
      );
      await audit(conn, user.email, "UPDATE Trip",
        ex.ref + " · " + s(p.lorryPlate) + " · " + crew.length + " crew");
      return ex.id;
    }

    const ref = await nextRef(conn, "trn_trips", "TRIP_PREFIX", "RUN-");
    const id = randomUUID();
    await conn.query(
      `INSERT INTO trn_trips (id, ref, trip_date, shift, lorry_plate, driver, driver_id, driver_cost, lorry_cost,
                              crew, status, notes, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, ref, tripDate, shift, s(p.lorryPlate), s(p.driver), nz(p.driverId, null),
        driverCost, lorryCost, JSON.stringify(crew), nz(p.status, "Planned"), s(p.notes),
        user.email, user.email,
      ]
    );
    await audit(conn, user.email, "CREATE Trip",
      ref + " · " + s(p.lorryPlate) + " · " + crew.length + " crew");
    return id;
  },

  // ── trn_assign_jobs_to_trip({ p_trip_id, p_job_ids }) → null (void) ───────
  // Appends jobs as stops after the current max stop_seq; rejects jobs on another run.
  trn_assign_jobs_to_trip: async ({ args, user, conn }) => {
    const tripId = s(args.p_trip_id);
    const jobIds = Array.isArray(args.p_job_ids) ? args.p_job_ids : [];
    const trip = await getOne(conn, "SELECT * FROM trn_trips WHERE id = ?", [tripId]);
    if (!trip) throw new Error("Trip not found.");
    const seqRow = await getOne(
      conn, "SELECT COALESCE(MAX(stop_seq), 0) AS m FROM trn_jobs WHERE trip_id = ?", [tripId]
    );
    let seq = Number(seqRow.m) || 0;
    for (const jid of jobIds) {
      const job = await getOne(conn, "SELECT * FROM trn_jobs WHERE id = ?", [String(jid)]);
      if (!job) continue;
      if (job.trip_id != null && job.trip_id !== tripId)
        throw new Error("A job is already on another run (" + job.engagement_ref + "). Remove it first.");
      seq += 1;
      await conn.query("UPDATE trn_jobs SET trip_id = ?, stop_seq = ? WHERE id = ?", [tripId, seq, job.id]);
    }
    await audit(conn, user.email, "TRIP_ASSIGN", trip.ref + " · " + jobIds.length + " stop(s)");
    return null;
  },

  // ── trn_add_run_stop({ payload }) → null (void) ───────────────────────────
  // Run-first billable stop: finds/auto-creates the client's 'Transport' engagement,
  // inserts a Lorry and/or Mover job stamped with trip_id + next stop_seq.
  // payload: { tripId, clientId, lorry, lorryCharge, mover, moverCharge, workers:[],
  //            pickupLocation, pickupDateTime, deliveryLocation, deliveryDateTime,
  //            notes, internalUse, status? }
  trn_add_run_stop: async ({ args, user, conn }) => {
    const p = args.payload || {};
    const trip = await getOne(conn, "SELECT * FROM trn_trips WHERE id = ?", [nz(p.tripId, null)]);
    if (!trip) throw new Error("Run not found.");
    if (s(p.clientId) === "") throw new Error("Select a client for this stop.");
    const client = await getOne(conn, "SELECT * FROM trn_clients WHERE id = ?", [String(p.clientId)]);
    if (!client) throw new Error("Client not found.");

    const lorryCharge = r2(num(p.lorryCharge, 0));
    const moverCharge = r2(num(p.moverCharge, 0));
    const internal = asBool(p.internalUse);
    const wantLorry = asBool(p.lorry) || lorryCharge > 0;
    const wantMover = asBool(p.mover) || moverCharge > 0;
    if (!wantLorry && !wantMover)
      throw new Error("Tick Lorry and/or Mover for this stop (with a charge, or mark internal).");

    // find or create the client's auto "Transport" engagement
    let eng = await getOne(
      conn,
      `SELECT * FROM trn_engagements
        WHERE client_id = ? AND reason = 'Transport' AND status <> 'Cancelled'
        ORDER BY created_at LIMIT 1`,
      [client.id]
    );
    if (!eng) {
      const ref = await nextRef(conn, "trn_engagements", "ENG_PREFIX", "ENG-");
      const engId = randomUUID();
      await conn.query(
        `INSERT INTO trn_engagements (id, ref, client_id, client_company, reason, status, handled_by, remarks,
                                      created_by, updated_by)
         VALUES (?, ?, ?, ?, 'Transport', 'Open', ?, 'Auto-created for transport runs', ?, ?)`,
        [engId, ref, client.id, client.company, user.email, user.email, user.email]
      );
      eng = { id: engId, ref, client_id: client.id, client_company: client.company };
      await audit(conn, user.email, "CREATE Engagement", ref + " · " + client.company + " / Transport (auto)");
    }

    const seqRow = await getOne(
      conn, "SELECT COALESCE(MAX(stop_seq), 0) AS m FROM trn_jobs WHERE trip_id = ?", [trip.id]
    );
    let seq = Number(seqRow.m) || 0;
    const workers = Array.isArray(p.workers) ? p.workers : [];
    const nWorkers = workers.length;

    const status = nz(p.status, "Scheduled");
    const handledBy = nz(p.handledBy, nz(trip.driver, user.email));

    if (wantLorry) {
      seq += 1;
      await conn.query(
        `INSERT INTO trn_jobs (id, engagement_id, engagement_ref, client_id, client_company, service, status,
           start_datetime, end_datetime, from_location, to_location, items_description,
           lorry_plate, driver, trips, movers, shifts, quantity, unit_rate, amount, rate_label,
           internal_use, handled_by, trip_id, stop_seq, stops, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, 'Lorry', ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, 1, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`,
        [
          randomUUID(), eng.id, eng.ref, client.id, client.company, status,
          s(p.pickupDateTime), s(p.deliveryDateTime), s(p.pickupLocation), s(p.deliveryLocation), s(p.notes),
          trip.lorry_plate, trip.driver,
          internal ? 0 : lorryCharge, internal ? 0 : lorryCharge,
          internal ? "Internal use (no charge)" : "Keyed charge",
          internal ? 1 : 0, handledBy, trip.id, seq, user.email, user.email,
        ]
      );
    }

    if (wantMover) {
      seq += 1;
      const movers = Math.max(1, nWorkers > 0 ? nWorkers : Math.trunc(num(p.moverCount, 1)) || 1);
      await conn.query(
        `INSERT INTO trn_jobs (id, engagement_id, engagement_ref, client_id, client_company, service, status,
           start_datetime, end_datetime, from_location, to_location, items_description,
           lorry_plate, driver, trips, movers, shifts, quantity, unit_rate, amount, rate_label,
           internal_use, handled_by, trip_id, stop_seq, stops, remarks, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, 'Mover', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)`,
        [
          randomUUID(), eng.id, eng.ref, client.id, client.company, status,
          s(p.pickupDateTime), s(p.deliveryDateTime), s(p.pickupLocation), s(p.deliveryLocation), s(p.notes),
          trip.lorry_plate, trip.driver, movers,
          internal ? 0 : moverCharge, internal ? 0 : moverCharge,
          internal ? "Internal use (no charge)" : "Keyed charge",
          internal ? 1 : 0, handledBy, trip.id, seq,
          nWorkers > 0 ? "Crew: " + workers.map(String).join(", ") : "",
          user.email, user.email,
        ]
      );
    }

    await audit(conn, user.email, "RUN_STOP",
      trip.ref + " · " + client.company +
      (wantLorry ? " · Lorry " + (internal ? "internal" : "RM" + lorryCharge) : "") +
      (wantMover ? " · Mover " + (internal ? "internal" : "RM" + moverCharge) : ""));
    return null;
  },

  // ── trn_save_invoice({ payload }) → invoice id ────────────────────────────
  // Sums selected jobs, optional 6% SST, invoice-no uniqueness, guards, re-stamps jobs.
  // payload: { id?, invNo, engagementId, jobIds:[], invDate, dueDate, sstEnabled,
  //            notes, description?, filePath?, status? }
  trn_save_invoice: async ({ args, user, conn }) => {
    const p = args.payload || {};
    if (s(p.invNo) === "") throw new Error("Invoice number is required.");
    if (s(p.engagementId) === "") throw new Error("Engagement is required.");
    if (s(p.invDate) === "") throw new Error("Invoice date is required.");
    const jobIds = Array.isArray(p.jobIds) ? p.jobIds : [];
    if (jobIds.length === 0) throw new Error("Select at least one job to bill.");
    const eng = await getOne(conn, "SELECT * FROM trn_engagements WHERE id = ?", [String(p.engagementId)]);
    if (!eng) throw new Error("Engagement not found.");

    const invNo = String(p.invNo).trim();
    const exId = nz(p.id, null);

    // unique invoice number
    const dup = await getOne(
      conn,
      "SELECT 1 AS x FROM trn_invoices WHERE LOWER(inv_no) = LOWER(?) AND NOT (id <=> ?) LIMIT 1",
      [invNo, exId]
    );
    if (dup) throw new Error("Invoice number " + p.invNo + " already exists.");

    let amount = 0;
    let services = "";
    for (const jid of jobIds) {
      const job = await getOne(conn, "SELECT * FROM trn_jobs WHERE id = ?", [String(jid)]);
      if (!job) throw new Error("Some selected jobs were not found.");
      if (job.engagement_id !== eng.id)
        throw new Error("Job " + job.service + " is not in this engagement.");
      if (job.invoice_id != null && job.invoice_id !== exId)
        throw new Error("Job " + job.engagement_ref + "/" + job.service + " is already on another invoice.");
      amount += Number(job.amount) || 0;
      services += (services === "" ? "" : " + ") + job.service;
    }
    amount = r2(amount);
    const sstOn = asBool(p.sstEnabled);
    const sst = sstOn ? r2(amount * 0.06) : 0;
    const total = r2(amount + sst);
    const desc = nz(p.description, "Engagement " + eng.ref + " — " + services);
    const status = p.status === "Void" ? "Void" : "";

    let id;
    if (exId != null) {
      const ex = await getOne(conn, "SELECT * FROM trn_invoices WHERE id = ?", [exId]);
      if (!ex) throw new Error("Invoice not found.");
      id = ex.id;
      await conn.query(
        `UPDATE trn_invoices SET
           inv_no = ?, engagement_id = ?, engagement_ref = ?, client_id = ?, client_company = ?,
           inv_date = ?, due_date = ?, description = ?, amount = ?, sst_enabled = ?, sst_amount = ?, total = ?,
           status = ?, file_path = ?, notes = ?, updated_at = NOW()
         WHERE id = ?`,
        [
          invNo, eng.id, eng.ref, eng.client_id, eng.client_company,
          String(p.invDate), s(p.dueDate), desc, amount, sstOn ? 1 : 0, sst, total,
          status, nz(p.filePath, ex.file_path), s(p.notes), id,
        ]
      );
      await conn.query("UPDATE trn_jobs SET invoice_id = NULL WHERE invoice_id = ?", [id]); // re-stamp
      await audit(conn, user.email, "UPDATE Invoice",
        String(p.invNo) + " · " + eng.client_company + " / RM" + total);
    } else {
      id = randomUUID();
      await conn.query(
        `INSERT INTO trn_invoices (id, inv_no, engagement_id, engagement_ref, client_id, client_company,
           inv_date, due_date, description, amount, sst_enabled, sst_amount, total, status, file_path, notes,
           created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, invNo, eng.id, eng.ref, eng.client_id, eng.client_company,
          String(p.invDate), s(p.dueDate), desc, amount, sstOn ? 1 : 0, sst, total,
          status, s(p.filePath), s(p.notes), user.email,
        ]
      );
      await audit(conn, user.email, "CREATE Invoice",
        String(p.invNo) + " · " + eng.client_company + " / RM" + total);
    }

    await conn.query(
      "UPDATE trn_jobs SET invoice_id = ? WHERE id IN (?)",
      [id, jobIds.map(String)]
    );
    return id;
  },
};
