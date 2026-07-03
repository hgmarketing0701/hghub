/**
 * Black Lee — Daily Job Arrangement
 * Google Apps Script backend for schedule.html
 * v3 — adds human-readable name columns + Monthly Summary tab + debug tool
 *
 * ============ FIRST-TIME SETUP ============
 *
 * 1. Create a new Google Sheet. Name it: "Black Lee — Job Arrangement"
 * 2. Extensions → Apps Script
 * 3. Delete the placeholder code → paste THIS ENTIRE FILE
 * 4. 💾 Save → name the project "BL Schedule API"
 * 5. Function dropdown → choose "setup" → ▶ Run → approve permissions
 * 6. Deploy → New deployment
 *    - Type: Web app
 *    - Execute as: Me
 *    - Who has access: Anyone   ← important
 *    - Click Deploy → copy the Web App URL (ends with /exec)
 * 7. In schedule.html → ☁ Cloud Sync → paste URL → Save
 *
 * ============ UPGRADING FROM v1 ============
 *
 * Already have schedule.html running and connected? Do this once:
 *
 * 1. Open Apps Script (Extensions → Apps Script in your Sheet)
 * 2. Select ALL the existing code → Delete → paste THIS file
 * 3. 💾 Save
 * 4. Function dropdown → "rebuildNames" → ▶ Run
 *    - Fills supervisorNames, workerNames, lorryDetails for all existing rows
 * 5. Deploy → Manage deployments → ✏ pencil → Version: "New version" → Deploy
 *    - Same URL stays. schedule.html keeps working — no changes needed.
 *
 * ============ HOW NAMES WORK ============
 *
 * - When schedule.html saves a job, Apps Script looks up the IDs against
 *   the Supervisors / Workers / Lorries tabs and writes the names too.
 * - If you rename someone in the Workers tab, run "rebuildNames" to refresh
 *   the name columns on past jobs.
 * - The original *Ids columns stay — they're the stable reference the app reads.
 *   You can hide them in the Sheet view if you don't want to see them.
 */

/* ============ ENDPOINTS ============ */

function doGet(e) {
  return jsonResp(readAll());
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const actor = (data.actor || 'Unknown').toString();
    const action = data.action;
    let result, auditAct, auditDetail;
    if (action === 'getAll')              { result = readAll(); }
    else if (action === 'getAudit')       { result = readAudit_(data.limit == null ? 300 : data.limit); }
    else if (action === 'upsertJob')      {
      const existed = jobExists_(data.job.id);
      result = upsertJob(data.job);
      auditAct = data.auditAction || (existed ? 'Job edited' : 'Job inserted');
      auditDetail = jobSummary_(data.job);
    }
    else if (action === 'deleteJob')      {
      auditDetail = jobSummaryById_(data.id);
      result = deleteJob(data.id);
      auditAct = 'Job deleted';
    }
    else if (action === 'saveList')       {
      result = saveList(data.key, data.items);
      auditAct = 'List updated';
      auditDetail = data.key + ' (' + (data.items || []).length + ' items)';
    }
    else if (action === 'refreshSummary') { result = buildMonthlySummary(); }
    else if (action === 'submitDispute')  {
      result = submitDispute_(data.dispute);
      auditAct = 'Dispute submitted';
      auditDetail = (data.dispute || {}).workerName + ' · ' + (data.dispute || {}).date;
    }
    else if (action === 'listDisputes')   { result = listDisputes_(); }
    else if (action === 'updateDispute')  {
      result = updateDispute_(data.id, data.fields);
      auditAct = 'Dispute updated';
      auditDetail = data.id + ' · status=' + ((data.fields || {}).status || '');
    }
    else if (action === 'uploadDisputePhoto') { result = uploadDisputePhoto_(data.payload); }
    else if (action === 'saveVehicleLog')  {
      result = saveVehicleLog_(data.log);
      auditAct = data.log && data.log.id ? 'Vehicle log updated' : 'Vehicle log added';
      auditDetail = (data.log || {}).date + ' · lorry=' + ((data.log || {}).lorryId || '') + ' · ' + ((data.log || {}).departHG || '—') + '→' + ((data.log || {}).returnHG || '—');
    }
    else if (action === 'deleteVehicleLog') {
      result = deleteVehicleLog_(data.id);
      auditAct = 'Vehicle log deleted';
      auditDetail = data.id;
    }
    else if (action === 'bulkSaveVehicleLog') {
      result = bulkSaveVehicleLog_(data.rows, data.actor || 'Cartrack import');
      auditAct = 'Cartrack import';
      auditDetail = 'inserted=' + result.inserted + ' · updated=' + result.updated + ' · skipped=' + result.skipped;
    }
    else if (action === 'listVehicleLogs') { result = listVehicleLogs_(); }
    else if (action === 'saveConflictReview') {
      result = saveConflictReview_(data.review);
      auditAct = 'Conflict reviewed';
      auditDetail = (data.review || {}).workerName + ' · ' + (data.review || {}).date + ' · ' + (data.review || {}).category + ' → ' + ((data.review || {}).status || '');
    }
    else if (action === 'listConflictReviews') { result = listConflictReviews_(); }
    else if (action === 'saveWageAdjustment') {
      result = saveWageAdjustment_(data.adjustment);
      auditAct = 'Wage adjusted';
      auditDetail = (data.adjustment || {}).workerName + ' · ' + (data.adjustment || {}).date + ' · delta=' + (result && result.delta);
    }
    else if (action === 'deleteWageAdjustment') {
      result = deleteWageAdjustment_(data.id);
      auditAct = 'Wage adjustment removed';
      auditDetail = data.id;
    }
    else if (action === 'listWageAdjustments') { result = listWageAdjustments_(); }
    else if (action === 'saveAttendanceLog') {
      result = saveAttendanceLog_(data.log);
      auditAct = result.inserted ? 'Attendance added' : 'Attendance updated';
      // Use the client-built detail (includes before/after diff + amendment reason) when provided,
      // fall back to a simple summary otherwise.
      auditDetail = (data.auditDetail && String(data.auditDetail).trim())
        ? String(data.auditDetail)
        : ((data.log || {}).workerName + ' · ' + (data.log || {}).date + ' · ' + ((data.log || {}).clockIn||'—') + '→' + ((data.log || {}).clockOut||'—'));
    }
    else if (action === 'bulkSaveAttendance') {
      result = bulkSaveAttendance_(data.rows, data.actor || 'Unknown');
      auditAct = 'Attendance imported';
      auditDetail = (result && result.inserted || 0) + ' inserted, ' + (result && result.updated || 0) + ' updated';
    }
    else if (action === 'deleteAttendanceLog') {
      result = deleteAttendanceLog_(data.id);
      auditAct = 'Attendance removed';
      auditDetail = data.id;
    }
    else if (action === 'listAttendanceLogs') { result = listAttendanceLogs_(); }
    else if (action === 'clearAttendanceLog') {
      result = clearAttendanceLog_();
      auditAct = 'Attendance log cleared';
      auditDetail = (result && result.deleted) + ' rows deleted';
    }
    else if (action === 'relinkAttendance') {
      result = relinkAttendance_();
      auditAct = 'Attendance re-linked';
      auditDetail = (result && result.linked) + ' linked, ' + (result && result.skipped) + ' skipped';
    }
    else if (action === 'bulkDeleteAttendance') {
      result = bulkDeleteAttendance_(data.ids);
      auditAct = 'Attendance bulk delete';
      auditDetail = (result && result.deleted) + ' rows deleted';
    }
    else throw new Error('Unknown action: ' + action);
    if (auditAct) logAudit_(actor, auditAct, auditDetail);
    return jsonResp({ ok: true, result });
  } catch (err) {
    return jsonResp({ ok: false, error: err.toString() });
  }
}

/* ============ AUDIT LOG ============ */
function logAudit_(actor, action, detail) {
  const sh = ss().getSheetByName('AuditLog') || ss().insertSheet('AuditLog');
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, 4).setValues([['timestamp','actor','action','detail']]);
    sh.setFrozenRows(1);
  }
  sh.appendRow([new Date().toISOString(), actor, action, detail || '']);
}
function readAudit_(limit) {
  const sh = ss().getSheetByName('AuditLog');
  if (!sh || sh.getLastRow() < 2) return [];
  const last = sh.getLastRow();
  const total = last - 1;
  // 0 or negative limit = all records; otherwise cap to requested amount
  const n = (!limit || limit <= 0) ? total : Math.min(limit, total);
  return sh.getRange(last - n + 1, 1, n, 4).getValues().map(r => ({
    timestamp: (r[0] instanceof Date) ? r[0].toISOString() : String(r[0]),
    actor: r[1], action: r[2], detail: r[3]
  })).reverse();
}

/* ============ DISPUTES (worker form + admin review) ============ */
const DISPUTE_HEADERS = ['id','submittedAt','workerId','workerName','date','claimedIn','claimedOut','claimedNextDay','claimedAmount','workerNote','status','reviewerNote','reviewedBy','reviewedAt','photos'];

function ensureDisputesSheet_() {
  let sh = ss().getSheetByName('Disputes');
  if (!sh) sh = ss().insertSheet('Disputes');
  if (sh.getLastRow() === 0 || sh.getRange(1,1).getValue() !== 'id') {
    sh.getRange(1, 1, 1, DISPUTE_HEADERS.length).setValues([DISPUTE_HEADERS]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function submitDispute_(d) {
  if (!d || !d.workerId || !d.date) throw new Error('Worker and date required');
  const sh = ensureDisputesSheet_();
  const id = 'dsp_' + new Date().getTime() + '_' + Math.random().toString(36).slice(2, 6);
  const row = DISPUTE_HEADERS.map(h => {
    if (h === 'id') return id;
    if (h === 'submittedAt') return new Date().toISOString();
    if (h === 'status') return 'Pending';
    if (h === 'claimedNextDay') return d.claimedNextDay ? 'TRUE' : 'FALSE';
    return d[h] !== undefined && d[h] !== null ? d[h] : '';
  });
  sh.appendRow(row);
  return { id };
}

function listDisputes_() {
  const sh = ss().getSheetByName('Disputes');
  if (!sh || sh.getLastRow() < 2) return [];
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const fmtTime = v => {
    if (v == null || v === '') return '';
    if (v instanceof Date) return Utilities.formatDate(v, _tz_(), 'HH:mm');
    return String(v);
  };
  return data.slice(1).filter(r => r[0]).map(r => {
    const o = {};
    headers.forEach((h, i) => o[h] = r[i]);
    if (o.submittedAt instanceof Date) o.submittedAt = o.submittedAt.toISOString();
    if (o.reviewedAt instanceof Date)  o.reviewedAt  = o.reviewedAt.toISOString();
    if (o.date instanceof Date) o.date = Utilities.formatDate(o.date, _tz_(), 'yyyy-MM-dd');
    o.claimedIn  = fmtTime(o.claimedIn);
    o.claimedOut = fmtTime(o.claimedOut);
    o.claimedNextDay = (o.claimedNextDay === true || o.claimedNextDay === 'TRUE' || o.claimedNextDay === 'true');
    return o;
  }).reverse();
}

function updateDispute_(id, fields) {
  if (!id) throw new Error('Dispute id required');
  const sh = ss().getSheetByName('Disputes');
  if (!sh) throw new Error('Disputes sheet not found');
  const last = sh.getLastRow();
  if (last < 2) throw new Error('No disputes yet');
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) {
      const row = i + 2;
      const updates = {
        status: fields.status,
        reviewerNote: fields.reviewerNote,
        reviewedBy: fields.reviewedBy,
        reviewedAt: new Date().toISOString()
      };
      DISPUTE_HEADERS.forEach((h, col) => {
        if (updates[h] !== undefined) sh.getRange(row, col + 1).setValue(updates[h]);
      });
      return { ok: true };
    }
  }
  throw new Error('Dispute not found: ' + id);
}

function getOrCreateDisputeFolder_() {
  const name = 'BlackLee Dispute Photos';
  const it = DriveApp.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  const folder = DriveApp.createFolder(name);
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return folder;
}

function uploadDisputePhoto_(payload) {
  if (!payload || !payload.base64) throw new Error('Missing photo data');
  const folder = getOrCreateDisputeFolder_();
  const bytes = Utilities.base64Decode(payload.base64);
  const blob = Utilities.newBlob(bytes, payload.mimeType || 'image/jpeg', payload.filename || ('photo_' + Date.now() + '.jpg'));
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const id = file.getId();
  return {
    id: id,
    viewUrl: 'https://drive.google.com/file/d/' + id + '/view',
    thumbUrl: 'https://drive.google.com/thumbnail?id=' + id + '&sz=w400'
  };
}

/* ============ VEHICLE LOG (Cartrack timings) ============ */
const VEHICLE_LOG_HEADERS = ['id','date','lorryId','shift','departHG','returnHG','nextDayReturn','notes','tripDetails','createdAt','createdBy'];

function ensureVehicleLogSheet_() {
  let sh = ss().getSheetByName('VehicleLog');
  if (!sh) sh = ss().insertSheet('VehicleLog');
  // Fresh sheet — write all headers and exit
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, VEHICLE_LOG_HEADERS.length).setValues([VEHICLE_LOG_HEADERS]);
    sh.setFrozenRows(1);
    return sh;
  }
  // Existing sheet — migrate by inserting any missing columns at the right index
  let existing = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  for (let i = 0; i < VEHICLE_LOG_HEADERS.length; i++) {
    if (existing[i] !== VEHICLE_LOG_HEADERS[i]) {
      sh.insertColumnBefore(i + 1);
      sh.getRange(1, i + 1).setValue(VEHICLE_LOG_HEADERS[i]);
      existing.splice(i, 0, VEHICLE_LOG_HEADERS[i]);
    }
  }
  if (sh.getFrozenRows() === 0) sh.setFrozenRows(1);
  return sh;
}

function saveVehicleLog_(log) {
  if (!log || !log.date || !log.lorryId) throw new Error('Date and lorry required');
  const sh = ensureVehicleLogSheet_();
  if (log.id) {
    const last = sh.getLastRow();
    if (last >= 2) {
      const ids = sh.getRange(2, 1, last - 1, 1).getValues();
      for (let i = 0; i < ids.length; i++) {
        if (ids[i][0] === log.id) {
          const row = i + 2;
          VEHICLE_LOG_HEADERS.forEach((h, col) => {
            if (h === 'id' || h === 'createdAt' || h === 'createdBy') return;
            sh.getRange(row, col + 1).setValue(log[h] !== undefined && log[h] !== null ? log[h] : '');
          });
          return { id: log.id, updated: true };
        }
      }
    }
  }
  const id = log.id || ('vl_' + new Date().getTime() + '_' + Math.random().toString(36).slice(2, 6));
  const row = VEHICLE_LOG_HEADERS.map(h => {
    if (h === 'id') return id;
    if (h === 'createdAt') return new Date().toISOString();
    if (h === 'createdBy') return log.createdBy || '';
    return log[h] !== undefined && log[h] !== null ? log[h] : '';
  });
  sh.appendRow(row);
  return { id };
}

// Bulk upsert for Cartrack import. Uses deterministic id `vl_<lorryId>_<date>_<shift>` so
// re-importing the same trip period is idempotent — existing rows are updated, not duplicated.
function bulkSaveVehicleLog_(rows, actor) {
  if (!Array.isArray(rows)) throw new Error('rows must be an array');
  const sh = ensureVehicleLogSheet_();
  const last = sh.getLastRow();
  const existingIds = last >= 2 ? sh.getRange(2, 1, last - 1, 1).getValues().map(r => r[0]) : [];
  const idToRowIdx = {};
  existingIds.forEach((id, i) => { if (id) idToRowIdx[id] = i + 2; });
  let inserted = 0, updated = 0, skipped = 0;
  const toAppend = [];
  for (const r of rows) {
    if (!r || !r.date || !r.lorryId) { skipped++; continue; }
    const shift = r.shift || 'day';
    const id = r.id || ('vl_' + r.lorryId + '_' + r.date + '_' + shift).replace(/\s+/g,'_');
    if (idToRowIdx[id] != null) {
      const rowIdx = idToRowIdx[id];
      VEHICLE_LOG_HEADERS.forEach((h, col) => {
        if (h === 'id' || h === 'createdAt') return;
        if (r[h] !== undefined && r[h] !== null && r[h] !== '') sh.getRange(rowIdx, col + 1).setValue(r[h]);
      });
      updated++;
    } else {
      const row = VEHICLE_LOG_HEADERS.map(h => {
        if (h === 'id') return id;
        if (h === 'createdAt') return new Date().toISOString();
        if (h === 'createdBy') return actor || 'Cartrack import';
        return r[h] !== undefined && r[h] !== null ? r[h] : '';
      });
      toAppend.push(row);
      inserted++;
    }
  }
  if (toAppend.length) {
    sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, VEHICLE_LOG_HEADERS.length).setValues(toAppend);
  }
  return { inserted, updated, skipped };
}

function listVehicleLogs_() {
  const sh = ss().getSheetByName('VehicleLog');
  if (!sh || sh.getLastRow() < 2) return [];
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const fmtTime = v => {
    if (v == null || v === '') return '';
    if (v instanceof Date) return Utilities.formatDate(v, _tz_(), 'HH:mm');
    return String(v);
  };
  return data.slice(1).filter(r => r[0]).map(r => {
    const o = {};
    headers.forEach((h, i) => o[h] = r[i]);
    if (o.date instanceof Date) o.date = Utilities.formatDate(o.date, _tz_(), 'yyyy-MM-dd');
    if (o.createdAt instanceof Date) o.createdAt = o.createdAt.toISOString();
    o.departHG = fmtTime(o.departHG);
    o.returnHG = fmtTime(o.returnHG);
    o.nextDayReturn = (o.nextDayReturn === true || o.nextDayReturn === 'TRUE' || o.nextDayReturn === 'true');
    if (!o.shift) o.shift = ''; // legacy rows without shift
    return o;
  }).reverse();
}

function deleteVehicleLog_(id) {
  if (!id) throw new Error('Vehicle log id required');
  const sh = ss().getSheetByName('VehicleLog');
  if (!sh || sh.getLastRow() < 2) throw new Error('Vehicle log not found');
  const last = sh.getLastRow();
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) { sh.deleteRow(i + 2); return { ok: true }; }
  }
  throw new Error('Vehicle log not found: ' + id);
}

/* ============ WAGE ADJUSTMENTS (admin per-worker per-shift adjustments / deductions) ============ */
const WAGE_ADJUSTMENT_HEADERS = ['id','workerId','workerName','date','category','originalAmount','adjustedAmount','delta','reason','adjustedBy','adjustedAt'];

function ensureAdjustmentsSheet_() {
  let sh = ss().getSheetByName('WageAdjustments');
  if (!sh) sh = ss().insertSheet('WageAdjustments');
  if (sh.getLastRow() === 0 || sh.getRange(1,1).getValue() !== 'id') {
    sh.getRange(1, 1, 1, WAGE_ADJUSTMENT_HEADERS.length).setValues([WAGE_ADJUSTMENT_HEADERS]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function saveWageAdjustment_(adj) {
  if (!adj || !adj.workerId || !adj.date) throw new Error('workerId and date required');
  const sh = ensureAdjustmentsSheet_();
  const cat = adj.category || 'day';
  const id = adj.id || ('wa_' + adj.workerId + '_' + adj.date + '_' + cat);
  const orig = Number(adj.originalAmount) || 0;
  const adjusted = Number(adj.adjustedAmount) || 0;
  const delta = adjusted - orig;
  const last = sh.getLastRow();
  if (last >= 2) {
    const ids = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (ids[i][0] === id) {
        const row = i + 2;
        WAGE_ADJUSTMENT_HEADERS.forEach((h, col) => {
          if (h === 'id') return;
          if (h === 'adjustedAt') { sh.getRange(row, col + 1).setValue(new Date().toISOString()); return; }
          if (h === 'delta')      { sh.getRange(row, col + 1).setValue(delta); return; }
          if (h === 'originalAmount') { sh.getRange(row, col + 1).setValue(orig); return; }
          if (h === 'adjustedAmount') { sh.getRange(row, col + 1).setValue(adjusted); return; }
          if (adj[h] !== undefined && adj[h] !== null) sh.getRange(row, col + 1).setValue(adj[h]);
        });
        return { id, updated: true, delta };
      }
    }
  }
  const row = WAGE_ADJUSTMENT_HEADERS.map(h => {
    if (h === 'id') return id;
    if (h === 'adjustedAt')      return new Date().toISOString();
    if (h === 'delta')           return delta;
    if (h === 'originalAmount')  return orig;
    if (h === 'adjustedAmount')  return adjusted;
    return adj[h] !== undefined && adj[h] !== null ? adj[h] : '';
  });
  sh.appendRow(row);
  return { id, inserted: true, delta };
}

function listWageAdjustments_() {
  const sh = ss().getSheetByName('WageAdjustments');
  if (!sh || sh.getLastRow() < 2) return [];
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  return data.slice(1).filter(r => r[0]).map(r => {
    const o = {};
    headers.forEach((h, i) => o[h] = r[i]);
    if (o.date instanceof Date) o.date = Utilities.formatDate(o.date, _tz_(), 'yyyy-MM-dd');
    if (o.adjustedAt instanceof Date) o.adjustedAt = o.adjustedAt.toISOString();
    return o;
  });
}

function deleteWageAdjustment_(id) {
  if (!id) throw new Error('Adjustment id required');
  const sh = ss().getSheetByName('WageAdjustments');
  if (!sh || sh.getLastRow() < 2) throw new Error('Adjustment not found');
  const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) { sh.deleteRow(i + 2); return { ok: true }; }
  }
  throw new Error('Adjustment not found: ' + id);
}

/* ============ ATTENDANCE LOG (Face Recognition clock-in/out — priority source for factory shifts) ============ */
const ATTENDANCE_HEADERS = ['id','workerId','workerName','date','category','clockIn','clockOut','nextDayOut','rawEvents','source','notes','createdAt','createdBy'];

function ensureAttendanceSheet_() {
  let sh = ss().getSheetByName('AttendanceLog');
  if (!sh) sh = ss().insertSheet('AttendanceLog');
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, ATTENDANCE_HEADERS.length).setValues([ATTENDANCE_HEADERS]);
    sh.setFrozenRows(1);
    return sh;
  }
  // Existing sheet — migrate by inserting any missing columns at the right index
  let existing = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  for (let i = 0; i < ATTENDANCE_HEADERS.length; i++) {
    if (existing[i] !== ATTENDANCE_HEADERS[i]) {
      sh.insertColumnBefore(i + 1);
      sh.getRange(1, i + 1).setValue(ATTENDANCE_HEADERS[i]);
      existing.splice(i, 0, ATTENDANCE_HEADERS[i]);
    }
  }
  if (sh.getFrozenRows() === 0) sh.setFrozenRows(1);
  // Force clock-time columns to text format so "09:20" stays as a string and never gets reinterpreted
  // under whatever timezone the sheet happens to be set to.
  const inCol  = ATTENDANCE_HEADERS.indexOf('clockIn')  + 1;
  const outCol = ATTENDANCE_HEADERS.indexOf('clockOut') + 1;
  if (inCol > 0)  sh.getRange(2, inCol,  Math.max(sh.getMaxRows() - 1, 1)).setNumberFormat('@');
  if (outCol > 0) sh.getRange(2, outCol, Math.max(sh.getMaxRows() - 1, 1)).setNumberFormat('@');
  return sh;
}

function saveAttendanceLog_(log) {
  if (!log || !log.date) throw new Error('Date required');
  if (!log.workerId && !log.workerName) throw new Error('Worker required');
  const sh = ensureAttendanceSheet_();
  const cat = log.category || 'day';
  const id = log.id || ('at_' + (log.workerId || log.workerName) + '_' + log.date + '_' + cat).replace(/\s+/g,'_');
  const last = sh.getLastRow();
  if (last >= 2) {
    const ids = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (ids[i][0] === id) {
        const row = i + 2;
        ATTENDANCE_HEADERS.forEach((h, col) => {
          if (h === 'id' || h === 'createdAt') return;
          if (log[h] !== undefined && log[h] !== null) sh.getRange(row, col + 1).setValue(log[h]);
        });
        return { id, updated: true };
      }
    }
  }
  const row = ATTENDANCE_HEADERS.map(h => {
    if (h === 'id') return id;
    if (h === 'createdAt') return new Date().toISOString();
    if (h === 'source' && !log.source) return 'manual';
    return log[h] !== undefined && log[h] !== null ? log[h] : '';
  });
  sh.appendRow(row);
  return { id, inserted: true };
}

function bulkSaveAttendance_(rows, actor) {
  if (!Array.isArray(rows)) throw new Error('rows must be an array');
  const sh = ensureAttendanceSheet_();
  const last = sh.getLastRow();
  const existingIds = last >= 2 ? sh.getRange(2, 1, last - 1, 1).getValues().map(r => r[0]) : [];
  const idToRowIdx = {};
  existingIds.forEach((id, i) => { if (id) idToRowIdx[id] = i + 2; });
  let inserted = 0, updated = 0, skipped = 0;
  const toAppend = [];
  for (const r of rows) {
    if (!r || !r.date || (!r.workerId && !r.workerName)) { skipped++; continue; }
    const cat = r.category || 'day';
    const id = r.id || ('at_' + (r.workerId || r.workerName) + '_' + r.date + '_' + cat).replace(/\s+/g,'_');
    if (idToRowIdx[id] != null) {
      const rowIdx = idToRowIdx[id];
      ATTENDANCE_HEADERS.forEach((h, col) => {
        if (h === 'id' || h === 'createdAt') return;
        if (r[h] !== undefined && r[h] !== null && r[h] !== '') sh.getRange(rowIdx, col + 1).setValue(r[h]);
      });
      updated++;
    } else {
      const row = ATTENDANCE_HEADERS.map(h => {
        if (h === 'id') return id;
        if (h === 'createdAt') return new Date().toISOString();
        if (h === 'createdBy') return actor || 'Import';
        if (h === 'source' && !r.source) return 'import';
        return r[h] !== undefined && r[h] !== null ? r[h] : '';
      });
      toAppend.push(row);
      inserted++;
    }
  }
  if (toAppend.length) {
    sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, ATTENDANCE_HEADERS.length).setValues(toAppend);
  }
  return { inserted, updated, skipped };
}

function listAttendanceLogs_() {
  const sh = ss().getSheetByName('AttendanceLog');
  if (!sh || sh.getLastRow() < 2) return [];
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  // Use the SPREADSHEET's own timezone so "09:20" written under any TZ reads back as "09:20".
  const tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone() || _tz_();
  const fmtTime = v => {
    if (v == null || v === '') return '';
    if (v instanceof Date) return Utilities.formatDate(v, tz, 'HH:mm');
    return String(v);
  };
  return data.slice(1).filter(r => r[0]).map(r => {
    const o = {};
    headers.forEach((h, i) => o[h] = r[i]);
    if (o.date instanceof Date) o.date = Utilities.formatDate(o.date, _tz_(), 'yyyy-MM-dd');
    if (o.createdAt instanceof Date) o.createdAt = o.createdAt.toISOString();
    o.clockIn = fmtTime(o.clockIn);
    o.clockOut = fmtTime(o.clockOut);
    o.nextDayOut = (o.nextDayOut === true || o.nextDayOut === 'TRUE' || o.nextDayOut === 'true');
    if (!o.category) o.category = 'day';   // legacy rows
    return o;
  }).reverse();
}

function relinkAttendance_() {
  const sh = ss().getSheetByName('AttendanceLog');
  if (!sh || sh.getLastRow() < 2) return { linked: 0, skipped: 0, total: 0 };
  // Load workers and build a normalized-name lookup
  const workersSh = ss().getSheetByName('Workers');
  if (!workersSh || workersSh.getLastRow() < 2) throw new Error('Workers sheet is empty');
  const wHeaders = workersSh.getRange(1, 1, 1, workersSh.getLastColumn()).getValues()[0];
  const wIdCol = wHeaders.indexOf('id');
  const wNameCol = wHeaders.indexOf('name');
  if (wIdCol < 0 || wNameCol < 0) throw new Error('Workers sheet missing id or name column');
  const wRows = workersSh.getRange(2, 1, workersSh.getLastRow() - 1, workersSh.getLastColumn()).getValues();
  const normalize = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
  const byNorm = {};
  wRows.forEach(r => {
    const id = r[wIdCol], name = r[wNameCol];
    if (id && name) byNorm[normalize(name)] = { id, name };
  });
  // Walk attendance rows; for each with empty workerId, look up by workerName
  const aHeaders = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const idCol  = aHeaders.indexOf('workerId') + 1;
  const nameCol = aHeaders.indexOf('workerName') + 1;
  if (idCol === 0 || nameCol === 0) throw new Error('AttendanceLog missing workerId or workerName column');
  const last = sh.getLastRow();
  const all = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  let linked = 0, skipped = 0, total = 0;
  for (let i = 0; i < all.length; i++) {
    if (!all[i][0]) continue;
    total++;
    const currentId = all[i][idCol - 1];
    if (currentId) continue; // already linked
    const wname = all[i][nameCol - 1];
    const hit = byNorm[normalize(wname)];
    if (hit) {
      sh.getRange(i + 2, idCol).setValue(hit.id);
      // Also normalize the workerName to the worker record's canonical name
      sh.getRange(i + 2, nameCol).setValue(hit.name);
      linked++;
    } else {
      skipped++;
    }
  }
  return { linked, skipped, total };
}

function clearAttendanceLog_() {
  const sh = ss().getSheetByName('AttendanceLog');
  if (!sh) return { deleted: 0 };
  const last = sh.getLastRow();
  const deleted = Math.max(0, last - 1);  // exclude header
  if (deleted > 0) sh.getRange(2, 1, deleted, sh.getLastColumn()).clearContent();
  return { deleted };
}

function bulkDeleteAttendance_(ids) {
  if (!Array.isArray(ids) || !ids.length) return { deleted: 0 };
  const sh = ss().getSheetByName('AttendanceLog');
  if (!sh || sh.getLastRow() < 2) return { deleted: 0 };
  const idSet = {};
  ids.forEach(id => { if (id) idSet[id] = true; });
  const last = sh.getLastRow();
  const numCols = sh.getLastColumn();
  const allData = sh.getRange(2, 1, last - 1, numCols).getValues();
  const keep = [];
  let deleted = 0;
  for (const row of allData) {
    if (idSet[row[0]]) deleted++;
    else keep.push(row);
  }
  // Wipe the data area, then write back the survivors in one batch.
  // Avoids the O(N) deleteRow loop that triggers "out of bounds" on large selections.
  sh.getRange(2, 1, last - 1, numCols).clearContent();
  if (keep.length) sh.getRange(2, 1, keep.length, numCols).setValues(keep);
  return { deleted };
}

function deleteAttendanceLog_(id) {
  if (!id) throw new Error('Attendance log id required');
  const sh = ss().getSheetByName('AttendanceLog');
  if (!sh || sh.getLastRow() < 2) throw new Error('Attendance log not found');
  const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) { sh.deleteRow(i + 2); return { ok: true }; }
  }
  throw new Error('Attendance log not found: ' + id);
}

/* ============ SHIFT CONFLICT REVIEWS (admin decisions on flagged worker double-bookings) ============ */
const SHIFT_CONFLICT_HEADERS = ['id','workerId','workerName','date','category','shiftIds','status','reviewerNote','reviewedBy','reviewedAt','createdAt'];

function ensureConflictsSheet_() {
  let sh = ss().getSheetByName('ShiftConflictReviews');
  if (!sh) sh = ss().insertSheet('ShiftConflictReviews');
  if (sh.getLastRow() === 0 || sh.getRange(1,1).getValue() !== 'id') {
    sh.getRange(1, 1, 1, SHIFT_CONFLICT_HEADERS.length).setValues([SHIFT_CONFLICT_HEADERS]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function saveConflictReview_(r) {
  if (!r || !r.workerId || !r.date || !r.category) throw new Error('workerId, date and category required');
  const sh = ensureConflictsSheet_();
  // Deterministic id so we upsert one row per unique flag
  const id = r.id || ('cr_' + r.workerId + '_' + r.date + '_' + r.category);
  const last = sh.getLastRow();
  if (last >= 2) {
    const ids = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (ids[i][0] === id) {
        const row = i + 2;
        SHIFT_CONFLICT_HEADERS.forEach((h, col) => {
          if (h === 'id' || h === 'createdAt') return;
          if (h === 'reviewedAt') { sh.getRange(row, col + 1).setValue(new Date().toISOString()); return; }
          if (r[h] !== undefined && r[h] !== null) sh.getRange(row, col + 1).setValue(r[h]);
        });
        return { id, updated: true };
      }
    }
  }
  const row = SHIFT_CONFLICT_HEADERS.map(h => {
    if (h === 'id') return id;
    if (h === 'createdAt') return new Date().toISOString();
    if (h === 'reviewedAt') return new Date().toISOString();
    if (h === 'status') return r.status || 'Pending';
    return r[h] !== undefined && r[h] !== null ? r[h] : '';
  });
  sh.appendRow(row);
  return { id, inserted: true };
}

function listConflictReviews_() {
  const sh = ss().getSheetByName('ShiftConflictReviews');
  if (!sh || sh.getLastRow() < 2) return [];
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  return data.slice(1).filter(r => r[0]).map(r => {
    const o = {};
    headers.forEach((h, i) => o[h] = r[i]);
    if (o.reviewedAt instanceof Date) o.reviewedAt = o.reviewedAt.toISOString();
    if (o.createdAt  instanceof Date) o.createdAt  = o.createdAt.toISOString();
    if (o.date instanceof Date) o.date = Utilities.formatDate(o.date, _tz_(), 'yyyy-MM-dd');
    return o;
  });
}

function jobExists_(id) {
  const sh = ss().getSheetByName('Jobs');
  if (!sh || sh.getLastRow() < 2) return false;
  return sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().some(r => r[0] === id);
}
function jobSummary_(job) {
  return `${job.date||''} · ${job.scope||job.title||'Job'}${job.mall?' @ '+job.mall:''}${job.lot?' ('+job.lot+')':''}`;
}
function jobSummaryById_(id) {
  const sh = ss().getSheetByName('Jobs');
  if (!sh || sh.getLastRow() < 2) return String(id);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      const o = {}; headers.forEach((h, k) => o[h] = data[i][k]);
      const d = (o.date instanceof Date) ? Utilities.formatDate(o.date, _tz_(), 'yyyy-MM-dd') : o.date;
      return `${d||''} · ${o.scope||o.title||'Job'}${o.mall?' @ '+o.mall:''}`;
    }
  }
  return String(id);
}

function jsonResp(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }
// Use the SPREADSHEET's timezone (not a hardcoded one) so time/date values round-trip correctly
// regardless of which TZ the sheet was created under.
function _tz_() { return ss().getSpreadsheetTimeZone() || 'Asia/Kuala_Lumpur'; }

/* ============ READ ============ */

function readAll() {
  return {
    jobs:          readJobs(),
    malls:         readListSimple('Malls'),
    clients:       readListSimple('Clients'),
    scopeFactory:  readListSimple('ScopeFactory'),
    scopeOnsite:   readListSimple('ScopeOnsite'),
    supervisors:   readListObj('Supervisors', ['id','name','type']),
    workers:       readListObj('Workers',     ['id','name','rate','team','monthlyPay','bankName','accountName','accountNo']),
    lorries:       readListObj('Lorries',     ['id','plate']),
    states:        readListObj('States',      ['state','wkMult','wkAllow','inhouseInc','outsourceRate']),
    mallStates:    readListObj('MallStates',  ['mall','state']),
    vehicleLogs:   listVehicleLogs_(),
    conflictReviews: listConflictReviews_(),
    wageAdjustments: listWageAdjustments_(),
    attendanceLogs: listAttendanceLogs_(),
    serverTime:    new Date().toISOString()
  };
}

function readJobs() {
  const sh = ss().getSheetByName('Jobs');
  if (!sh || sh.getLastRow() < 2) return [];
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  return data.slice(1).filter(r => r[0]).map(r => {
    const o = {};
    headers.forEach((h, i) => o[h] = r[i]);
    ['supervisorIds','workerIds','lorryIds'].forEach(k => {
      try { o[k] = o[k] ? JSON.parse(o[k]) : []; } catch(e) { o[k] = []; }
    });
    try { o.workerTimes = o.workerTimes ? JSON.parse(o.workerTimes) : {}; } catch(e) { o.workerTimes = {}; }
    // Format every yyyy-MM-dd field consistently. Sheets returns Date objects when the cell type
    // is Date — without this, the front-end <input type="date"> can't parse the ISO string and
    // shows the field as empty (the data IS still there, just unreadable by the UI). Adding any
    // future date field to this list keeps it round-trippable.
    ['date','invoiceDate','incentivePaidDate','wagePaidDate','allowPaidDate','cidbSubmittedDate'].forEach(k => {
      if (o[k] instanceof Date) o[k] = Utilities.formatDate(o[k], _tz_(), 'yyyy-MM-dd');
    });
    if (o.time instanceof Date) o.time = Utilities.formatDate(o.time, _tz_(), 'HH:mm');
    return o;
  });
}

function readListSimple(name) {
  const sh = ss().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues()
    .map(r => r[0]).filter(v => v !== '' && v !== null);
}

function readListObj(name, fields) {
  const sh = ss().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  // Cap the column read at whatever the sheet actually has — when we add new fields to a schema
  // (e.g. Workers gained bankName/accountName/accountNo), the existing sheet still has the old
  // column count until the next saveList. Reading past the last column throws in Apps Script,
  // breaking the whole sync. New fields default to empty string for old rows.
  const cols = Math.max(1, Math.min(fields.length, sh.getLastColumn()));
  return sh.getRange(2, 1, sh.getLastRow() - 1, cols).getValues()
    .filter(r => r[0])
    .map(r => {
      const o = {};
      fields.forEach((f, i) => { o[f] = (i < cols && r[i] !== undefined) ? r[i] : ''; });
      return o;
    });
}

/* ============ NAME LOOKUP ============ */

function nameMap() {
  const sv = readListObj('Supervisors', ['id','name']);
  const wk = readListObj('Workers',     ['id','name']);
  const ly = readListObj('Lorries',     ['id','plate']);
  return {
    sv: Object.fromEntries(sv.map(s => [s.id, s.name])),
    wk: Object.fromEntries(wk.map(w => [w.id, w.name])),
    ly: Object.fromEntries(ly.map(l => [l.id, l.id + ' - ' + l.plate]))
  };
}

/* ============ WRITE ============ */

const JOB_HEADERS = [
  'id','title','client','mall','lot','shift','scope','date','time','notes',
  'supervisorIds','workerIds','lorryIds','createdAt','updatedAt',
  'supervisorNames','workerNames','lorryDetails',
  'state','incentiveStatus','incentivePaidDate','incentiveNotes',
  'wageStatus','wagePaidDate','wageNotes',
  'allowStatus','allowPaidDate','allowNotes',
  'remarks',
  'po','invoiceNo','invoiceDate','invoiceAmount','invoiceStatus','invoiceNotes',
  'chargeHoarding','chargeVisual','chargeDismantling','discount','hasTax',
  'hoardingSize',
  'workerTimes',
  'chargePreliminaries','chargeInsurance','chargeOutstation','chargeScaffold',
  'chargeDoor','chargeCounterweight','chargeFabric','chargePeepingHole','chargeOthers','chargeSkirting',
  'cidbStatus','cidbSubmittedDate','cidbReference','cidbSubmittedBy'
];

function upsertJob(job) {
  const sh = ss().getSheetByName('Jobs') || ss().insertSheet('Jobs');
  ensureHeaders(sh, JOB_HEADERS);

  const nm = nameMap();
  const svNames = (job.supervisorIds || []).map(id => nm.sv[id] || id).join(', ');
  const wkNames = (job.workerIds     || []).map(id => nm.wk[id] || id).join(', ');
  const lyDet   = (job.lorryIds      || []).map(id => nm.ly[id] || id).join(', ');

  const row = JOB_HEADERS.map(h => {
    if (h === 'supervisorIds') return JSON.stringify(job.supervisorIds || []);
    if (h === 'workerIds')     return JSON.stringify(job.workerIds     || []);
    if (h === 'lorryIds')      return JSON.stringify(job.lorryIds      || []);
    if (h === 'workerTimes')   return JSON.stringify(job.workerTimes   || {});
    if (h === 'supervisorNames') return svNames;
    if (h === 'workerNames')     return wkNames;
    if (h === 'lorryDetails')    return lyDet;
    if (h === 'updatedAt') return new Date().toISOString();
    if (h === 'createdAt') return job.createdAt || new Date().toISOString();
    return job[h] !== undefined && job[h] !== null ? job[h] : '';
  });

  const last = sh.getLastRow();
  if (last >= 2) {
    const ids = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (ids[i][0] === job.id) {
        sh.getRange(i + 2, 1, 1, JOB_HEADERS.length).setValues([row]);
        return job;
      }
    }
  }
  sh.appendRow(row);
  return job;
}

function deleteJob(id) {
  const sh = ss().getSheetByName('Jobs');
  if (!sh) return false;
  const last = sh.getLastRow();
  if (last < 2) return false;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) { sh.deleteRow(i + 2); return true; }
  }
  return false;
}

function saveList(key, items) {
  const map = {
    malls:        { sheet:'Malls',        headers:['value'],                 simple:true  },
    clients:      { sheet:'Clients',      headers:['value'],                 simple:true  },
    scopeFactory: { sheet:'ScopeFactory', headers:['value'],                 simple:true  },
    scopeOnsite:  { sheet:'ScopeOnsite',  headers:['value'],                 simple:true  },
    supervisors:  { sheet:'Supervisors',  headers:['id','name','type'],      simple:false },
    workers:      { sheet:'Workers',      headers:['id','name','rate','team','monthlyPay','bankName','accountName','accountNo'], simple:false },
    lorries:      { sheet:'Lorries',      headers:['id','plate'],            simple:false },
    states:       { sheet:'States',       headers:['state','wkMult','wkAllow','inhouseInc','outsourceRate'], simple:false },
    mallStates:   { sheet:'MallStates',   headers:['mall','state'],          simple:false }
  };
  const cfg = map[key];
  if (!cfg) throw new Error('Unknown list: ' + key);
  const sh = ss().getSheetByName(cfg.sheet) || ss().insertSheet(cfg.sheet);
  sh.clear();
  sh.getRange(1, 1, 1, cfg.headers.length).setValues([cfg.headers]);
  if (!items || items.length === 0) return true;
  const rows = cfg.simple
    ? items.map(v => [v])
    : items.map(o => cfg.headers.map(h => o[h] || ''));
  sh.getRange(2, 1, rows.length, cfg.headers.length).setValues(rows);
  return true;
}

function ensureHeaders(sh, headers) {
  const lastCol = sh.getLastColumn();
  const cur = lastCol > 0
    ? sh.getRange(1, 1, 1, Math.max(lastCol, headers.length)).getValues()[0]
    : [];
  let needsUpdate = false;
  for (let i = 0; i < headers.length; i++) {
    if (cur[i] !== headers[i]) { needsUpdate = true; break; }
  }
  if (needsUpdate) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
}

/* ============ DIAGNOSTIC ============ */

function debugLookup() {
  const sv = readListObj('Supervisors', ['id','name']);
  const wk = readListObj('Workers',     ['id','name']);
  const ly = readListObj('Lorries',     ['id','plate']);
  Logger.log('Supervisors tab: ' + sv.length + ' rows');
  Logger.log('Workers tab:     ' + wk.length + ' rows');
  Logger.log('Lorries tab:     ' + ly.length + ' rows');
  Logger.log('First 5 workers: ' + JSON.stringify(wk.slice(0,5)));
  const nm = nameMap();
  Logger.log('Test lookup wk02 → ' + JSON.stringify(nm.wk['wk02']));
  Logger.log('Test lookup wk09 → ' + JSON.stringify(nm.wk['wk09']));
  Logger.log('Test lookup wk30 → ' + JSON.stringify(nm.wk['wk30']));
}

/* ============ BACKFILL NAMES (run after upgrading or renaming staff) ============ */

function rebuildNames() {
  const sh = ss().getSheetByName('Jobs');
  if (!sh) { Logger.log('No Jobs sheet found.'); return; }
  ensureHeaders(sh, JOB_HEADERS);
  const last = sh.getLastRow();
  if (last < 2) { Logger.log('No job rows to rebuild.'); return; }

  const nm = nameMap();
  const data = sh.getRange(2, 1, last - 1, JOB_HEADERS.length).getValues();
  const svIdx  = JOB_HEADERS.indexOf('supervisorIds');
  const wkIdx  = JOB_HEADERS.indexOf('workerIds');
  const lyIdx  = JOB_HEADERS.indexOf('lorryIds');
  const svnIdx = JOB_HEADERS.indexOf('supervisorNames');
  const wknIdx = JOB_HEADERS.indexOf('workerNames');
  const lydIdx = JOB_HEADERS.indexOf('lorryDetails');
  const parse = s => { try { return s ? JSON.parse(s) : []; } catch(e) { return []; } };

  data.forEach(r => {
    r[svnIdx] = parse(r[svIdx]).map(id => nm.sv[id] || id).join(', ');
    r[wknIdx] = parse(r[wkIdx]).map(id => nm.wk[id] || id).join(', ');
    r[lydIdx] = parse(r[lyIdx]).map(id => nm.ly[id] || id).join(', ');
  });
  sh.getRange(2, 1, data.length, JOB_HEADERS.length).setValues(data);
  Logger.log('Rebuilt names for ' + data.length + ' job rows.');
}

/* ============ MONTHLY SUMMARY ============ */

function buildMonthlySummary() {
  const jobs = readJobs();
  const supervisors = readListObj('Supervisors', ['id','name']);
  const workers     = readListObj('Workers',     ['id','name']);
  const lorries     = readListObj('Lorries',     ['id','plate']);

  // Collect months from jobs, always include current month
  const months = new Set();
  jobs.forEach(j => { const m = monthOf_(j.date); if (m) months.add(m); });
  months.add(monthOf_(new Date()));
  const monthList = [...months].filter(Boolean).sort();

  let sh = ss().getSheetByName('Monthly Summary');
  if (!sh) sh = ss().insertSheet('Monthly Summary');
  sh.clear();
  sh.clearFormats();

  let row = 1;
  sh.getRange(row, 1).setValue('Black Lee — Monthly Summary')
    .setFontWeight('bold').setFontSize(14);
  row++;
  sh.getRange(row, 1).setValue('Last refreshed: ' + new Date().toLocaleString('en-GB') + ' · ' + jobs.length + ' total jobs')
    .setFontStyle('italic').setFontColor('#666666');
  row += 2;

  // 1. Jobs by Shift
  const shiftDefs = [
    ['Day','day'],['Day (Add-On)','day-addon'],['Night (Factory)','night-factory'],
    ['Day (Outstation)','day-out'],['Day (Installation)','day-inst'],['Day (Others)','day-oth'],
    ['Night (Installation)','night-inst'],['Night (Others)','night-oth']
  ];
  row = writeMonthlySection_(sh, row, 'JOBS BY SHIFT',
    shiftDefs, monthList, jobs, (j, k) => j.shift === k);

  // 2. Jobs by Scope (only scopes used)
  const scopes = [...new Set(jobs.map(j => j.scope).filter(Boolean))].sort();
  if (scopes.length) {
    row = writeMonthlySection_(sh, row, 'JOBS BY SCOPE',
      scopes.map(s => [s, s]), monthList, jobs, (j, k) => j.scope === k);
  }

  // 3. Jobs by Mall (only malls used)
  const mallsUsed = [...new Set(jobs.map(j => j.mall).filter(Boolean))].sort();
  if (mallsUsed.length) {
    row = writeMonthlySection_(sh, row, 'JOBS BY MALL',
      mallsUsed.map(m => [m, m]), monthList, jobs, (j, k) => j.mall === k);
  }

  // 4. Supervisor workload (all supervisors)
  row = writeMonthlySection_(sh, row, 'SUPERVISOR / DRIVER WORKLOAD',
    supervisors.map(s => [s.name, s.id]),
    monthList, jobs, (j, k) => (j.supervisorIds || []).includes(k));

  // 5. Worker workload (all workers)
  row = writeMonthlySection_(sh, row, 'WORKER WORKLOAD',
    workers.map(w => [w.name, w.id]),
    monthList, jobs, (j, k) => (j.workerIds || []).includes(k));

  // 6. Lorry usage
  row = writeMonthlySection_(sh, row, 'LORRY USAGE',
    lorries.map(l => [l.id + ' (' + l.plate + ')', l.id]),
    monthList, jobs, (j, k) => (j.lorryIds || []).includes(k));

  sh.setFrozenRows(4);
  sh.autoResizeColumn(1);
  Logger.log('Monthly summary refreshed. Months covered: ' + monthList.join(', '));
  return { ok: true, months: monthList.length, jobs: jobs.length };
}

function monthOf_(d) {
  if (!d) return '';
  if (d instanceof Date) return Utilities.formatDate(d, _tz_(), 'yyyy-MM');
  return String(d).slice(0,7);
}

function writeMonthlySection_(sh, startRow, title, labelKeys, monthList, jobs, matchFn) {
  const cols = monthList.length + 2;
  sh.getRange(startRow, 1).setValue(title)
    .setFontWeight('bold').setFontSize(11)
    .setBackground('#f59e0b').setFontColor('#000000');
  sh.getRange(startRow, 1, 1, cols).merge().setHorizontalAlignment('left');
  startRow++;

  const headers = ['Item', ...monthList, 'Total'];
  sh.getRange(startRow, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#1c2335').setFontColor('#ffffff');
  startRow++;

  const rows = labelKeys.map(([label, key]) => {
    const r = [label];
    let total = 0;
    monthList.forEach(m => {
      const count = jobs.filter(j => monthOf_(j.date) === m && matchFn(j, key)).length;
      r.push(count);
      total += count;
    });
    r.push(total);
    return r;
  });

  if (rows.length) {
    sh.getRange(startRow, 1, rows.length, headers.length).setValues(rows);
    // Highlight totals column
    sh.getRange(startRow, headers.length, rows.length, 1)
      .setFontWeight('bold').setBackground('#fff4e0');
  }
  return startRow + rows.length + 2;
}

/* ============ SETUP (run once on a fresh Sheet) ============ */

function setup() {
  const TABS = ['Jobs','Malls','Clients','ScopeFactory','ScopeOnsite','Supervisors','Workers','Lorries','States','MallStates','AuditLog','Disputes'];
  TABS.forEach(name => { if (!ss().getSheetByName(name)) ss().insertSheet(name); });

  const s1 = ss().getSheetByName('Sheet1');
  if (s1 && ss().getSheets().length > 1) ss().deleteSheet(s1);

  ensureHeaders(ss().getSheetByName('Jobs'), JOB_HEADERS);

  saveList('malls',        DEFAULT_MALLS);
  saveList('scopeFactory', DEFAULT_SCOPE_FACTORY);
  saveList('scopeOnsite',  DEFAULT_SCOPE_ONSITE);
  saveList('supervisors',  DEFAULT_SUPERVISORS);
  saveList('workers',      DEFAULT_WORKERS);
  saveList('lorries',      DEFAULT_LORRIES);
  saveList('states',       DEFAULT_STATES);
  saveList('mallStates',   DEFAULT_MALLS.map(m => ({ mall: m, state: inferState_(m) })));

  Logger.log('Setup complete. Next: Deploy → New deployment → Web app.');
}

/* ============ STATE INFERENCE ============ */

function inferState_(mall) {
  const m = (mall || '').toLowerCase();
  if (m.includes('jb') || m.includes('johor') || m.includes('tebrau') || m.includes('kulai') || m.includes('permas') || m.includes('bukit indah') || m.includes('mutiara rini') || m.includes('toppen') || m.includes('city square') || m.includes('komtar') || m.includes('r&f mall') || m.includes('southkey') || m.includes('paradigm mall jb') || m.includes('big box')) return 'Johor';
  if (m.includes('penang') || m.includes('bukit mertajam') || m.includes('seberang') || m.includes('queensbay') || m.includes('gurney') || m.includes('1st avenue') || m.includes('design village') || m.includes('sunway carnival')) return 'Pulau Pinang';
  if (m.includes('ipoh') || m.includes('taiping') || m.includes('kinta')) return 'Perak';
  if (m.includes('kota bharu')) return 'Kelantan';
  if (m.includes('melaka') || m.includes('hatten') || m.includes('mahkota parade') || m.includes('dataran pahlawan') || m.includes('bandaraya melaka')) return 'Melaka';
  if (m.includes('genting')) return 'Genting Highlands';
  if (m.includes('kuantan') || m.includes('berjaya megamall')) return 'Pahang (excl. Genting)';
  if (m.includes('nilai') || m.includes('seremban')) return 'Negeri Sembilan';
  if (m.includes('kedah') || m.includes('sungai petani')) return 'Kedah';
  if (m.includes('terengganu')) return 'Terengganu';
  return 'KL / Selangor';
}

/* ============ V3 MIGRATION (run once for the pay-engine upgrade) ============ */
// Safe: reseeds State rate table (new 4-rate structure), adds 'type' to existing
// Supervisors and 'rate' to existing Workers WITHOUT wiping their names/ids.
// Leaves Malls, Clients, MallStates, Scopes, Lorries, Jobs untouched.
function migrateToV3() {
  // 1. State rate table → new structure (verify/edit in the app after)
  saveList('states', DEFAULT_STATES);

  // 2. Supervisors: keep names/ids, fill in 'type'
  const typeByName = {};
  DEFAULT_SUPERVISORS.forEach(d => typeByName[d.name] = d.type);
  let sv = readListObj('Supervisors', ['id','name','type']).map(s => ({
    id: s.id, name: s.name,
    type: s.type || typeByName[s.name] || 'driver_inhouse'
  }));
  if (!sv.some(s => s.name === 'Pak Cik Mat')) {
    sv.push({ id:'sv12', name:'Pak Cik Mat', type:'driver_inhouse' });
  }
  saveList('supervisors', sv);

  // 3. Workers: keep names/ids, default rate 100 where blank
  let wk = readListObj('Workers', ['id','name','rate']).map(w => ({
    id: w.id, name: w.name,
    rate: (w.rate === '' || w.rate == null) ? 100 : w.rate
  }));
  saveList('workers', wk);

  Logger.log('Migrated to v3: States reseeded (' + DEFAULT_STATES.length + '), '
    + sv.length + ' supervisors typed, ' + wk.length + ' workers given rate. Verify in the app.');
}

/* ============ INCENTIVE SEEDING (run once after upgrading) ============ */
function seedStatesAndMallStates() {
  saveList('states', DEFAULT_STATES);
  const existingMalls = readListSimple('Malls');
  const mapping = existingMalls.map(m => ({ mall: m, state: inferState_(m) }));
  saveList('mallStates', mapping);
  Logger.log('Seeded ' + DEFAULT_STATES.length + ' states and ' + mapping.length + ' mall-state mappings.');
}

/* ============ DEFAULT SEED DATA ============ */

const DEFAULT_SCOPE_ONSITE = [
  'Hoarding Installation','Hoarding Modification','Hoarding Repairing / Rectification',
  'Hoarding Dismantling','Hoarding & Visual Installation','Visual Installation',
  'Scaffold','Reinstatement','Partition','Plaster Ceiling','Brick Wall',
  'Painting','Flooring','Tiling','Fit Out'
];
const DEFAULT_SCOPE_FACTORY = [
  'Unloading / Loading',
  'Potong Papan / Kokchai (Cut Plywood/Board / Fingerjoint)',
  'Fabricate Papan (Hoarding Panel)','Fabricate Besi (Metal)','Fabricate Plastic Sheet',
  'Store Keeper & Material Coordinator',
  'Repair Papan Lama (Old Hoarding Panel)',
  'Repair Kayu / Kokchai (Timber Structure / Fingerjoint)',
  'Buat Concrete Batu (Make Concrete Counterweight)',
  'Paint Papan / Kokchai (Hoarding Panel / Fingerjoint)',
  'Housekeeping','Others'
];
const DEFAULT_SUPERVISORS = [
  { id:'sv01', name:'Tim',                type:'sv_inhouse' },
  { id:'sv02', name:'Wai',                type:'sv_inhouse' },
  { id:'sv03', name:'Mion',               type:'sv_inhouse' },
  { id:'sv04', name:'Tuck',               type:'sv_inhouse' },
  { id:'sv05', name:'Arel',               type:'driver_inhouse' },
  { id:'sv06', name:'Red',                type:'driver_inhouse' },
  { id:'sv07', name:'Hadi',               type:'driver_inhouse' },
  { id:'sv08', name:'Baan',               type:'driver_inhouse' },
  { id:'sv09', name:'Balan (Outsource)',  type:'driver_outsource' },
  { id:'sv10', name:'Driver (Outsource)', type:'driver_outsource' },
  { id:'sv11', name:'Gabriel (Back Up)',  type:'driver_inhouse' },
  { id:'sv12', name:'Pak Cik Mat',        type:'driver_inhouse' }
];
const DEFAULT_WORKERS = [
  'Abu Bakkor','Akash','Alamin-2','Angarshah','Anwar','Arif Hossain','Azizul','Based',
  'Bijoy','Billal','Deen Islam','Ekram Shardar','Eleyas','Forid','Hasan Bepari','Hazrat Bepari',
  'Ibrahim','Ifran','Iqbal','Ismail','Liton Khan','Mahimur','Mamun','Manik',
  'Md Arif','Md Jomir','Mokarom','Nasir Uddin','Rabu Biswas','Rayhan','Sahidul','Sapan',
  'Shafiqul','Shah Ali','Shakil','Shakil-2','Shakil-3','Sohag','Sohel Sikder','Uzzal Gazi'
].map((n,i) => ({ id:'wk'+String(i+1).padStart(2,'0'), name:n, rate:100 }));
const DEFAULT_STATES = [
  { state:'KL / Selangor',            wkMult:1, wkAllow:0,  inhouseInc:0,   outsourceRate:120 },
  { state:'Negeri Sembilan',          wkMult:1, wkAllow:15, inhouseInc:30,  outsourceRate:250 },
  { state:'Melaka',                   wkMult:1, wkAllow:30, inhouseInc:60,  outsourceRate:250 },
  { state:'Genting Highlands',        wkMult:1, wkAllow:15, inhouseInc:60,  outsourceRate:250 },
  { state:'Johor',                    wkMult:2, wkAllow:30, inhouseInc:120, outsourceRate:250 },
  { state:'Perak',                    wkMult:2, wkAllow:30, inhouseInc:120, outsourceRate:250 },
  { state:'Pulau Pinang',             wkMult:2, wkAllow:30, inhouseInc:120, outsourceRate:250 },
  { state:'Kedah',                    wkMult:2, wkAllow:30, inhouseInc:150, outsourceRate:250 },
  { state:'Terengganu',               wkMult:2, wkAllow:30, inhouseInc:150, outsourceRate:250 },
  { state:'Pahang (excl. Genting)',   wkMult:2, wkAllow:30, inhouseInc:120, outsourceRate:250 },
  { state:'Kelantan',                 wkMult:3, wkAllow:45, inhouseInc:250, outsourceRate:250 }
];
const DEFAULT_LORRIES = [
  ['ST02','VCA7999'],['ST03','VBK7999'],['ST04','VDW7999'],['ST05','VED7999'],
  ['ST06','JUF7999'],['ST07','NDQ7999'],['ST08','TCP7999'],['ST09','VKC7999'],
  ['ST10','DEY7999'],['ST11','QM7999R'],['ST12','BSE7999'],['ST13','PRW7999'],
  ['ST14','QS7999X']
].map(([id,plate]) => ({ id, plate }));
const DEFAULT_MALLS = [
  'AEON Alpha Angle','AEON AU2 Setiawangsa','AEON Bandaraya Melaka','AEON Bukit Indah JB',
  'AEON Bukit Mertajam','AEON Bukit Raja','AEON Bukit Tinggi Klang','AEON Cheras Selatan',
  'AEON Equine Park','AEON Ipoh Falim','AEON Ipoh Klebang','AEON Ipoh Station 18',
  'AEON Kinta City Ipoh','AEON Kota Bharu','AEON Kulaijaya','AEON Mahkota Cheras',
  'AEON Melaka','AEON Metro Prima Kepong','AEON Mid Valley','AEON Nilai','AEON One Utama',
  'AEON Permas Jaya','AEON Quill City KL','AEON Rawang','AEON Seberang Prai City',
  'AEON Seremban 2','AEON Setia Alam','AEON Shah Alam','AEON Sri Petaling','AEON Sunway Pyramid',
  'AEON Taiping','AEON Taman Equine','AEON Taman Maluri','AEON Tebrau City','AEON Wangsa Maju',
  "Lotus's Ampang","Lotus's Bandar Tasik Selatan","Lotus's Cheras","Lotus's Damansara Damai",
  "Lotus's Ipoh","Lotus's Kajang","Lotus's Kepong","Lotus's Klang","Lotus's Kota Bharu",
  "Lotus's Kota Damansara","Lotus's Mutiara Damansara","Lotus's Mutiara Rini","Lotus's Penang",
  "Lotus's Puchong","Lotus's Seberang Jaya","Lotus's Seremban","Lotus's Setia Alam",
  "Lotus's Shah Alam","Lotus's Sungai Petani","Lotus's Taiping",
  'Sunway Pyramid','Sunway Velocity','Sunway Big Box JB','Sunway Carnival Penang',
  'Sunway Putra Mall','Sunway Square','Sunway Wangsa Walk','Sunway Citrine Hub',
  'IOI City Mall','IOI Mall Puchong','IOI City Mall Tower 2','IOI Damansara Mall',
  'Suria KLCC','Pavilion KL','Pavilion Bukit Jalil','Pavilion Damansara Heights',
  'Avenue K','Intermark Mall','Mid Valley Megamall','The Gardens Mall','Mid Valley Southkey JB',
  'Berjaya Times Square','Fahrenheit 88','Genting SkyAvenue','Genting Highlands Premium Outlets',
  'KLIA Main Terminal','KLIA Satellite (SAT)','KLIA2 Gateway','KLIA2 Airside',
  'Starhill Gallery','Lot 10','1 Utama','The Curve','Citta Mall',
  'Sungei Wang Plaza','Plaza Low Yat','Berjaya Megamall Kuantan',
  'TRX Exchange 106','TRX The Exchange','TRX Marketlane',
  'MyTown Cheras','Setia City Mall','Paradigm Mall PJ','Paradigm Mall JB',
  'Nu Empire','Wisma MBSA','Megahrise Mall','Da Men Mall USJ','Nu Empire Subang',
  'KIP Mall','Galleria@Cyberjaya','Tamarind Square Cyberjaya','Atria Shopping Gallery',
  '1 Mont Kiara','Plaza Mont Kiara','Quill City Mall','GMBB','Sogo KL',
  'Mahkota Parade Melaka','Hatten Square Melaka','Dataran Pahlawan Melaka',
  'Gurney Plaza Penang','Gurney Paragon Penang','Queensbay Mall Penang','Penang Times Square',
  '1st Avenue Penang','Design Village Penang',
  'City Square JB','Komtar JBCC','R&F Mall JB','Toppen Shopping Centre JB'
];
