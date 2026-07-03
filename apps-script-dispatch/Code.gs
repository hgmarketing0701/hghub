/**
 * Black Lee — Daily Job Readiness & Dispatch (Cloud v1)
 * Google Apps Script backend, served as a Workspace-restricted web app.
 *
 * Storage: the Google Sheet this script is bound to (container-bound script).
 * Auth:    Workspace domain restriction in appsscript.json (access: DOMAIN),
 *          plus a domain check on every server call for defence in depth.
 *
 * Purpose: replace Eason's manual Excel. Two jobs in one tool —
 *   1) READINESS  — every confirmed hoarding job carries a checklist of gates
 *      (lot/mall, measurement sketch, quotation, permit, visual artwork,
 *      material/fab). A job can't go GREEN until every required gate passes.
 *      A permit early-warning flags any job whose install date is near while
 *      the permit is still not approved — the "get scolded" problem.
 *   2) DISPATCH   — Calvin loads the GREEN jobs into teams (1 driver/SV,
 *      workers, 1 lorry, max 5 jobs/team, max 12 teams) for a chosen night,
 *      then one-click generates the WhatsApp message for the HG Operation group.
 *
 * Every save/edit/delete is auto-stamped with the user's email + timestamp.
 */

/* ===================== CONFIG ===================== */
const ALLOWED_DOMAIN = 'hggroup.com.my';
const DEFAULT_EMAIL_RECIPIENT = 'blacklee@hggroup.com.my';

const SHEETS = {
  JOBS:    'Jobs',
  TEAMS:   'Teams',
  STAFF:   'Staff',
  LORRIES: 'Lorries',
  CONFIG:  'Config',
  AUDIT:   'AuditLog',
};

const HEADERS = {
  Jobs: ['id','jobCode','client','clientGroup','mall','lotNo','jobType','scope','doorType','installDate',
         'measureStatus','sketchUrl','quoteStatus','quoteRef','needsVisual','visualStatus','visualUrl',
         'permitBy','permitStatus','permitUrl','permitApprovedAt','materialReady','materialNotes',
         'jobStatus','dispatchDate','teamNo','seq','notes',
         'createdAt','createdBy','updatedAt','updatedBy'],
  Teams:   ['id','dispatchDate','teamNo','driver','workers','lorry','notes','createdAt','createdBy','updatedAt','updatedBy'],
  Staff:   ['id','name','role','phone','active','createdAt','createdBy','updatedAt','updatedBy'],
  Lorries: ['id','plate','label','active','createdAt','createdBy','updatedAt','updatedBy'],
  Config:  ['key','value','notes'],
  AuditLog:['timestamp','userEmail','action','recordType','recordId','details'],
};

/* ===== Enums shipped to the frontend so dropdowns stay in sync ===== */
const JOB_TYPES = [
  { key: 'install',   label: 'Installation' },
  { key: 'dismantle', label: 'Dismantling' },
  { key: 'rectify',   label: 'Rectification' },
  { key: 'modify',    label: 'Modification' },
  { key: 'other',     label: 'Other' },
];
const DOOR_TYPES = ['None', 'Swing door', 'Sliding door', 'Double door', 'Roller shutter', 'Other'];
const MEASURE_STATUS = [
  { key: 'pending',      label: 'Pending site measurement' },
  { key: 'sketch_done',  label: 'Sketch done ✔' },
  { key: 'not_required', label: 'Not required' },
];
const QUOTE_STATUS = [
  { key: 'pending',      label: 'Pending' },
  { key: 'sent',         label: 'Sent to client' },
  { key: 'confirmed',    label: 'Confirmed by client ✔' },
  { key: 'not_required', label: 'Not required' },
];
const VISUAL_STATUS = [
  { key: 'na',       label: 'N/A' },
  { key: 'pending',  label: 'Pending approval' },
  { key: 'approved', label: 'Approved ✔' },
];
const PERMIT_BY = [
  { key: 'us',           label: 'We apply (Imrah)' },
  { key: 'client',       label: 'Client applies' },
  { key: 'already_have', label: 'Already have ✔' },
  { key: 'not_required', label: 'Not required' },
];
const PERMIT_STATUS = [
  { key: 'not_required', label: 'Not required' },
  { key: 'pending',      label: 'Pending' },
  { key: 'submitted',    label: 'Submitted, awaiting approval' },
  { key: 'approved',     label: 'Approved ✔' },
];
const JOB_STATUS = [
  { key: 'open',      label: 'Open' },
  { key: 'assigned',  label: 'Assigned to team' },
  { key: 'done',      label: 'Done' },
  { key: 'cancelled', label: 'Cancelled' },
];

/* ===================== ENTRY ===================== */
function doGet(e) {
  const email = (Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email.endsWith('@' + ALLOWED_DOMAIN)) {
    return HtmlService.createHtmlOutput(
      `<div style="font-family:sans-serif;padding:40px;max-width:600px;">
         <h2>Access denied</h2>
         <p>This tool is restricted to <b>@${ALLOWED_DOMAIN}</b> Google Workspace accounts.</p>
         <p>You are signed in as: <code>${email || '(unknown)'}</code></p>
         <p>Sign in with your company account and reload.</p>
       </div>`
    );
  }
  ensureSheets_();
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('HG — Daily Job Readiness & Dispatch')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/* ===================== AUTH GUARD ===================== */
function requireDomain_() {
  const email = (Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email.endsWith('@' + ALLOWED_DOMAIN)) {
    throw new Error('Access denied. Only @' + ALLOWED_DOMAIN + ' accounts allowed.');
  }
  return email;
}
function getCurrentUser() { return requireDomain_(); }

/* ===================== SHEET HELPERS ===================== */
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function ensureSheets_() {
  const ss = ss_();
  Object.keys(HEADERS).forEach(name => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.appendRow(HEADERS[name]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, HEADERS[name].length).setFontWeight('bold');
    } else {
      const expected = HEADERS[name];
      const lastCol = Math.max(sheet.getLastColumn(), 1);
      const currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || ''));
      const allEmpty = currentHeaders.every(v => v === '');
      if (allEmpty) {
        sheet.getRange(1, 1, 1, expected.length).setValues([expected]);
      } else {
        // SCHEMA MIGRATION: append any missing columns at the end so existing data is preserved.
        const missing = expected.filter(h => currentHeaders.indexOf(h) === -1);
        missing.forEach((h, i) => sheet.getRange(1, lastCol + 1 + i).setValue(h));
      }
      sheet.setFrozenRows(1);
      const finalCol = sheet.getLastColumn();
      if (finalCol > 0) sheet.getRange(1, 1, 1, finalCol).setFontWeight('bold');
    }
  });
  // Seed default Config rows if Config sheet is empty
  const cfg = ss.getSheetByName(SHEETS.CONFIG);
  if (cfg && cfg.getLastRow() < 2) {
    cfg.appendRow(['permitLeadDays',    '3',  'Working days a permit needs before install — drives the permit early-warning']);
    cfg.appendRow(['atRiskDays',        '3',  'If install date is within N days and the job is not ready → AMBER "at risk"']);
    cfg.appendRow(['maxTeams',          '12', 'Max night-install teams']);
    cfg.appendRow(['maxJobsPerTeam',    '5',  'Max jobs per team per night']);
    cfg.appendRow(['maxWorkersPerTeam', '5',  'Max workers per team (excludes the driver cum supervisor)']);
    cfg.appendRow(['emailRecipients',   DEFAULT_EMAIL_RECIPIENT, 'Comma-separated — who gets the daily readiness email']);
  }
  // Drop the default empty "Sheet1"
  const def = ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() <= 1 && def.getLastColumn() <= 1 && ss.getSheets().length > 1) {
    ss.deleteSheet(def);
  }
}

function readSheet_(name) {
  const sheet = ss_().getSheetByName(name);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  const actualHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || ''));
  const expectedHeaders = HEADERS[name] || [];
  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  return values
    .filter(row => row.some(v => v !== '' && v !== null))
    .map(row => {
      const obj = {};
      expectedHeaders.forEach(h => obj[h] = '');
      actualHeaders.forEach((h, i) => {
        if (!h) return;
        let v = row[i];
        if (v instanceof Date) {
          v = Utilities.formatDate(v, Session.getScriptTimeZone() || 'Asia/Kuala_Lumpur', 'yyyy-MM-dd');
        }
        obj[h] = v;
      });
      return obj;
    });
}

function findRowIndexById_(sheetName, id) {
  const sheet = ss_().getSheetByName(sheetName);
  if (!sheet) return -1;
  const last = sheet.getLastRow();
  if (last < 2) return -1;
  const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function rowFromRecord_(name, rec) {
  const sheet = ss_().getSheetByName(name);
  if (!sheet || sheet.getLastColumn() < 1) {
    return (HEADERS[name] || []).map(h => rec[h] === undefined ? '' : rec[h]);
  }
  const actualHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h || ''));
  return actualHeaders.map(h => rec[h] === undefined ? '' : rec[h]);
}

function appendRecord_(name, rec) {
  ss_().getSheetByName(name).appendRow(rowFromRecord_(name, rec));
}

function updateRecord_(name, id, rec) {
  const row = findRowIndexById_(name, id);
  if (row < 2) throw new Error('Record not found: ' + name + '/' + id);
  const values = rowFromRecord_(name, rec);
  ss_().getSheetByName(name).getRange(row, 1, 1, values.length).setValues([values]);
}

function deleteRecordsById_(name, id, column) {
  const sheet = ss_().getSheetByName(name);
  const col = column || 1;
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const vals = sheet.getRange(2, col, last - 1, 1).getValues();
  let deleted = 0;
  for (let i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][0]) === String(id)) { sheet.deleteRow(i + 2); deleted++; }
  }
  return deleted;
}

/* ===================== UTILS ===================== */
function uid_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 12); }
function nowIso_() { return new Date().toISOString(); }

function readConfigMap_() {
  const rows = readSheet_(SHEETS.CONFIG);
  const map = {};
  rows.forEach(r => { if (r.key) map[String(r.key).trim()] = String(r.value == null ? '' : r.value); });
  return map;
}

function parseDateLocal_(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function startOfDayLocal_(d) {
  const tz = Session.getScriptTimeZone() || 'Asia/Kuala_Lumpur';
  return parseDateLocal_(Utilities.formatDate(d, tz, 'yyyy-MM-dd'));
}
function daysUntil_(dateStr) {
  const d = parseDateLocal_(dateStr);
  if (!d) return null;
  const today = startOfDayLocal_(new Date());
  return Math.floor((d - today) / 86400000);
}
function todayLabel_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Kuala_Lumpur', 'yyyy-MM-dd');
}
function escapeHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function nextJobCode_() {
  const jobs = readSheet_(SHEETS.JOBS);
  let max = 0;
  jobs.forEach(j => {
    const m = String(j.jobCode || '').match(/(\d+)/);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return 'J-' + String(max + 1).padStart(4, '0');
}

/* ===================== READINESS ENGINE ===================== */
// Single source of truth for the traffic-light status. Mirrored in Index.html
// for instant in-form preview — keep the two in sync if you change the rules.
function computeJobReadiness_(j, cfg) {
  const missing = [];
  if (!j.mall || !j.lotNo) missing.push('Lot / Mall');
  if (!(j.measureStatus === 'sketch_done' || j.measureStatus === 'not_required')) missing.push('Measurement sketch');
  if (!(j.quoteStatus === 'confirmed' || j.quoteStatus === 'not_required')) missing.push('Quotation');

  const permitOk = (j.permitStatus === 'approved') || (j.permitBy === 'already_have') ||
                   (j.permitBy === 'not_required') || (j.permitStatus === 'not_required');
  if (!permitOk) missing.push('Permit');

  if (j.needsVisual === 'yes' && j.visualStatus !== 'approved') missing.push('Visual artwork');
  if (j.materialReady !== 'yes') missing.push('Material / fab');

  const atRiskDays = Number(cfg.atRiskDays || 3);
  const leadDays   = Number(cfg.permitLeadDays || 3);
  const days  = daysUntil_(j.installDate);
  const ready = missing.length === 0;

  let readiness = 'ready';
  if (!ready) readiness = (days !== null && days <= atRiskDays) ? 'at_risk' : 'blocked';

  const permitAlarm = !permitOk && days !== null && days <= leadDays;

  return { readiness: readiness, missing: missing, daysToInstall: days, permitAlarm: permitAlarm };
}

function decorateJobs_(jobs, cfg) {
  return jobs.map(j => {
    const r = computeJobReadiness_(j, cfg);
    j.readiness    = r.readiness;
    j.missing      = r.missing;
    j.daysToInstall = r.daysToInstall;
    j.permitAlarm  = r.permitAlarm;
    return j;
  });
}

/* ===================== AUDIT ===================== */
function logAudit_(action, recordType, recordId, details) {
  const email = (Session.getActiveUser().getEmail() || 'unknown').toLowerCase();
  ss_().getSheetByName(SHEETS.AUDIT).appendRow([
    nowIso_(), email, action, recordType, recordId, details || '',
  ]);
}

/* ===================== PUBLIC API ===================== */
function getAllData() {
  const email = requireDomain_();
  ensureSheets_();
  const cfg = readConfigMap_();
  return {
    currentUser: email,
    serverTime:  nowIso_(),
    today:       todayLabel_(),
    domain:      ALLOWED_DOMAIN,
    config:      cfg,
    jobs:        decorateJobs_(readSheet_(SHEETS.JOBS), cfg),
    teams:       readSheet_(SHEETS.TEAMS),
    staff:       readSheet_(SHEETS.STAFF),
    lorries:     readSheet_(SHEETS.LORRIES),
    audit:       recentAudit_(60),
    enums: {
      jobTypes:      JOB_TYPES,
      doorTypes:     DOOR_TYPES,
      measureStatus: MEASURE_STATUS,
      quoteStatus:   QUOTE_STATUS,
      visualStatus:  VISUAL_STATUS,
      permitBy:      PERMIT_BY,
      permitStatus:  PERMIT_STATUS,
      jobStatus:     JOB_STATUS,
    },
  };
}

function recentAudit_(n) {
  const rows = readSheet_(SHEETS.AUDIT);
  return rows.slice(Math.max(0, rows.length - (n || 60))).reverse();
}

/* ===== Jobs ===== */
function saveJob(payload) {
  const email = requireDomain_();
  if (!payload) throw new Error('Empty payload.');
  if (!payload.mall && !payload.lotNo && !payload.client) {
    throw new Error('At minimum a job needs a client, mall, or lot number.');
  }
  const rec = {
    id:              payload.id || uid_(),
    jobCode:         payload.jobCode || '',
    client:          payload.client || '',
    clientGroup:     payload.clientGroup || '',
    mall:            payload.mall || '',
    lotNo:           payload.lotNo || '',
    jobType:         payload.jobType || 'install',
    scope:           payload.scope || '',
    doorType:        payload.doorType || '',
    installDate:     payload.installDate || '',
    measureStatus:   payload.measureStatus || 'pending',
    sketchUrl:       payload.sketchUrl || '',
    quoteStatus:     payload.quoteStatus || 'pending',
    quoteRef:        payload.quoteRef || '',
    needsVisual:     payload.needsVisual === 'yes' ? 'yes' : 'no',
    visualStatus:    payload.visualStatus || (payload.needsVisual === 'yes' ? 'pending' : 'na'),
    visualUrl:       payload.visualUrl || '',
    permitBy:        payload.permitBy || 'us',
    permitStatus:    payload.permitStatus || 'pending',
    permitUrl:       payload.permitUrl || '',
    permitApprovedAt:payload.permitApprovedAt || '',
    materialReady:   payload.materialReady === 'yes' ? 'yes' : 'no',
    materialNotes:   payload.materialNotes || '',
    jobStatus:       payload.jobStatus || 'open',
    dispatchDate:    payload.dispatchDate || '',
    teamNo:          payload.teamNo || '',
    seq:             payload.seq || '',
    notes:           payload.notes || '',
    createdAt:       payload.createdAt || nowIso_(),
    createdBy:       payload.createdBy || email,
    updatedAt:       nowIso_(),
    updatedBy:       email,
  };
  const existing = findRowIndexById_(SHEETS.JOBS, rec.id);
  if (existing >= 2) {
    const cur = readSheet_(SHEETS.JOBS).find(j => j.id === rec.id);
    if (cur) {
      rec.createdAt = cur.createdAt || rec.createdAt;
      rec.createdBy = cur.createdBy || rec.createdBy;
      rec.jobCode   = cur.jobCode || rec.jobCode || nextJobCode_();
    }
    updateRecord_(SHEETS.JOBS, rec.id, rec);
    logAudit_('UPDATE', 'Job', rec.jobCode || rec.id, jobLabel_(rec));
  } else {
    if (!rec.jobCode) rec.jobCode = nextJobCode_();
    appendRecord_(SHEETS.JOBS, rec);
    logAudit_('CREATE', 'Job', rec.jobCode, jobLabel_(rec));
  }
  return getAllData();
}

function jobLabel_(j) {
  return [j.mall, j.lotNo, j.jobType].filter(Boolean).join(' · ');
}

function deleteJob(id) {
  requireDomain_();
  const j = readSheet_(SHEETS.JOBS).find(x => x.id === id) || {};
  deleteRecordsById_(SHEETS.JOBS, id);
  logAudit_('DELETE', 'Job', j.jobCode || id, jobLabel_(j));
  return getAllData();
}

// Lightweight dispatch ops — avoid re-sending the whole job payload.
function assignJob(payload) {
  const email = requireDomain_();
  if (!payload || !payload.jobId) throw new Error('Missing job.');
  const j = readSheet_(SHEETS.JOBS).find(x => x.id === payload.jobId);
  if (!j) throw new Error('Job not found.');
  j.dispatchDate = payload.dispatchDate || j.installDate || '';
  j.teamNo       = (payload.teamNo === '' || payload.teamNo == null) ? '' : String(payload.teamNo);
  j.jobStatus    = j.teamNo ? 'assigned' : 'open';
  j.updatedAt    = nowIso_();
  j.updatedBy    = email;
  updateRecord_(SHEETS.JOBS, j.id, j);
  logAudit_('ASSIGN', 'Job', j.jobCode || j.id,
    j.teamNo ? ('→ ' + (j.dispatchDate || '') + ' Team ' + j.teamNo) : 'unassigned');
  return getAllData();
}

function unassignJob(jobId) {
  return assignJob({ jobId: jobId, teamNo: '', dispatchDate: '' });
}

function setJobStatus(jobId, status) {
  const email = requireDomain_();
  const valid = JOB_STATUS.map(s => s.key);
  if (valid.indexOf(status) === -1) throw new Error('Invalid status: ' + status);
  const j = readSheet_(SHEETS.JOBS).find(x => x.id === jobId);
  if (!j) throw new Error('Job not found.');
  j.jobStatus = status;
  j.updatedAt = nowIso_();
  j.updatedBy = email;
  updateRecord_(SHEETS.JOBS, j.id, j);
  logAudit_('STATUS', 'Job', j.jobCode || j.id, '→ ' + status);
  return getAllData();
}

/* ===== Teams (crew per night per team number) ===== */
function saveTeam(payload) {
  const email = requireDomain_();
  if (!payload || !payload.dispatchDate || !payload.teamNo) {
    throw new Error('Team needs a date and a team number.');
  }
  // One row per (dispatchDate, teamNo) — find existing by composite key.
  const existing = readSheet_(SHEETS.TEAMS).find(t =>
    String(t.dispatchDate) === String(payload.dispatchDate) &&
    String(t.teamNo) === String(payload.teamNo));
  const rec = {
    id:           (existing && existing.id) || payload.id || uid_(),
    dispatchDate: payload.dispatchDate,
    teamNo:       String(payload.teamNo),
    driver:       payload.driver || '',
    workers:      payload.workers || '',
    lorry:        payload.lorry || '',
    notes:        payload.notes || '',
    createdAt:    (existing && existing.createdAt) || nowIso_(),
    createdBy:    (existing && existing.createdBy) || email,
    updatedAt:    nowIso_(),
    updatedBy:    email,
  };
  if (existing) {
    updateRecord_(SHEETS.TEAMS, rec.id, rec);
    logAudit_('UPDATE', 'Team', rec.dispatchDate + ' T' + rec.teamNo, rec.driver);
  } else {
    appendRecord_(SHEETS.TEAMS, rec);
    logAudit_('CREATE', 'Team', rec.dispatchDate + ' T' + rec.teamNo, rec.driver);
  }
  return getAllData();
}

function deleteTeam(id) {
  requireDomain_();
  const t = readSheet_(SHEETS.TEAMS).find(x => x.id === id) || {};
  // Unassign any jobs pointing at this team/night
  const jobs = readSheet_(SHEETS.JOBS).filter(j =>
    String(j.dispatchDate) === String(t.dispatchDate) && String(j.teamNo) === String(t.teamNo));
  jobs.forEach(j => { j.teamNo = ''; j.jobStatus = 'open'; updateRecord_(SHEETS.JOBS, j.id, j); });
  deleteRecordsById_(SHEETS.TEAMS, id);
  logAudit_('DELETE', 'Team', (t.dispatchDate || '') + ' T' + (t.teamNo || ''),
    jobs.length + ' job(s) unassigned');
  return getAllData();
}

/* ===== Staff (drivers cum supervisors + workers) ===== */
function saveStaff(payload) {
  const email = requireDomain_();
  if (!payload || !payload.name) throw new Error('Staff name required.');
  const rec = {
    id:        payload.id || uid_(),
    name:      String(payload.name).trim(),
    role:      payload.role || 'worker', // driver | worker
    phone:     payload.phone || '',
    active:    payload.active === false ? false : true,
    createdAt: payload.createdAt || nowIso_(),
    createdBy: payload.createdBy || email,
    updatedAt: nowIso_(),
    updatedBy: email,
  };
  const existing = findRowIndexById_(SHEETS.STAFF, rec.id);
  if (existing >= 2) {
    const cur = readSheet_(SHEETS.STAFF).find(s => s.id === rec.id);
    if (cur) { rec.createdAt = cur.createdAt || rec.createdAt; rec.createdBy = cur.createdBy || rec.createdBy; }
    updateRecord_(SHEETS.STAFF, rec.id, rec);
    logAudit_('UPDATE', 'Staff', rec.id, rec.name + ' (' + rec.role + ')');
  } else {
    appendRecord_(SHEETS.STAFF, rec);
    logAudit_('CREATE', 'Staff', rec.id, rec.name + ' (' + rec.role + ')');
  }
  return getAllData();
}
function deleteStaff(id) {
  requireDomain_();
  const s = readSheet_(SHEETS.STAFF).find(x => x.id === id) || {};
  deleteRecordsById_(SHEETS.STAFF, id);
  logAudit_('DELETE', 'Staff', id, s.name || '');
  return getAllData();
}

/* ===== Lorries ===== */
function saveLorry(payload) {
  const email = requireDomain_();
  if (!payload || !payload.plate) throw new Error('Lorry plate required.');
  const rec = {
    id:        payload.id || uid_(),
    plate:     String(payload.plate).trim(),
    label:     payload.label || '',
    active:    payload.active === false ? false : true,
    createdAt: payload.createdAt || nowIso_(),
    createdBy: payload.createdBy || email,
    updatedAt: nowIso_(),
    updatedBy: email,
  };
  const existing = findRowIndexById_(SHEETS.LORRIES, rec.id);
  if (existing >= 2) {
    const cur = readSheet_(SHEETS.LORRIES).find(l => l.id === rec.id);
    if (cur) { rec.createdAt = cur.createdAt || rec.createdAt; rec.createdBy = cur.createdBy || rec.createdBy; }
    updateRecord_(SHEETS.LORRIES, rec.id, rec);
    logAudit_('UPDATE', 'Lorry', rec.id, rec.plate);
  } else {
    appendRecord_(SHEETS.LORRIES, rec);
    logAudit_('CREATE', 'Lorry', rec.id, rec.plate);
  }
  return getAllData();
}
function deleteLorry(id) {
  requireDomain_();
  const l = readSheet_(SHEETS.LORRIES).find(x => x.id === id) || {};
  deleteRecordsById_(SHEETS.LORRIES, id);
  logAudit_('DELETE', 'Lorry', id, l.plate || '');
  return getAllData();
}

/* ===== Config ===== */
function saveConfig(payload) {
  requireDomain_();
  if (!payload || typeof payload !== 'object') throw new Error('Empty config.');
  const sheet = ss_().getSheetByName(SHEETS.CONFIG);
  const rows = readSheet_(SHEETS.CONFIG);
  Object.keys(payload).forEach(key => {
    const val = String(payload[key] == null ? '' : payload[key]);
    const idx = rows.findIndex(r => String(r.key) === key);
    if (idx >= 0) {
      sheet.getRange(idx + 2, 2).setValue(val); // col 2 = value
    } else {
      sheet.appendRow([key, val, '']);
    }
  });
  logAudit_('UPDATE', 'Config', 'settings', Object.keys(payload).join(', '));
  return getAllData();
}

/* ===================== DAILY READINESS EMAIL ===================== */
/**
 * Time-driven entrypoint. Install via installDailyTrigger().
 * Emails an early-warning digest: permit alarms, at-risk jobs, blocked jobs
 * for the next `horizon` days + tonight's dispatch summary.
 */
function sendDailyDispatchDigest() {
  ensureSheets_();
  const cfg = readConfigMap_();
  const recipients = (cfg.emailRecipients || DEFAULT_EMAIL_RECIPIENT)
    .split(',').map(s => s.trim()).filter(Boolean);
  if (!recipients.length) return { sent: false, reason: 'No recipients configured.' };

  const horizon = 7;
  const jobs = decorateJobs_(readSheet_(SHEETS.JOBS), cfg)
    .filter(j => j.jobStatus !== 'done' && j.jobStatus !== 'cancelled');

  const upcoming = jobs.filter(j => j.daysToInstall !== null && j.daysToInstall >= 0 && j.daysToInstall <= horizon);

  const permitAlarms = jobs.filter(j => j.permitAlarm)
    .sort((a, b) => (a.daysToInstall) - (b.daysToInstall));
  const atRisk = upcoming.filter(j => j.readiness === 'at_risk' && !j.permitAlarm)
    .sort((a, b) => a.daysToInstall - b.daysToInstall);
  const blocked = jobs.filter(j => j.readiness === 'blocked')
    .sort((a, b) => (a.daysToInstall == null ? 9999 : a.daysToInstall) - (b.daysToInstall == null ? 9999 : b.daysToInstall));

  const total = permitAlarms.length + atRisk.length;

  if (!total && !blocked.length) {
    MailApp.sendEmail({
      to: recipients.join(','),
      subject: `[HG Dispatch] All clear — ${todayLabel_()}`,
      htmlBody: emailShell_('No permit alarms, nothing at risk in the next ' + horizon + ' days',
        `<p>✅ Every upcoming job is on track. ${jobs.length} active job(s) on the board.</p>`),
    });
    return { sent: true, permitAlarms: 0, atRisk: 0, blocked: 0 };
  }

  const subject = `[HG Dispatch] ${permitAlarms.length} permit alarm(s) · ${atRisk.length} at risk · ${blocked.length} blocked — ${todayLabel_()}`;
  const body = jobTable_('🚨 Permit alarms — submit / chase NOW', permitAlarms, '#dc2626', true)
             + jobTable_('🟡 At risk — install soon, not ready', atRisk, '#d97706', false)
             + jobTable_('🔴 Blocked — missing items', blocked.slice(0, 30), '#dc2626', false);
  MailApp.sendEmail({ to: recipients.join(','), subject: subject, htmlBody: emailShell_(subject.replace('[HG Dispatch] ', ''), body) });
  return { sent: true, permitAlarms: permitAlarms.length, atRisk: atRisk.length, blocked: blocked.length };
}

function jobTable_(title, rows, accent, permitFocus) {
  if (!rows.length) return '';
  function dline(r) {
    const when = (r.daysToInstall == null)
      ? '<span style="color:#6b7280;">no date</span>'
      : (r.daysToInstall < 0
          ? `<span style="color:#dc2626;font-weight:700;">${-r.daysToInstall}d overdue</span>`
          : `<span style="color:${r.daysToInstall <= 3 ? '#dc2626' : '#374151'};font-weight:700;">${r.daysToInstall}d</span>`);
    const detail = permitFocus
      ? ('Permit: ' + escapeHtml_(r.permitBy) + ' / ' + escapeHtml_(r.permitStatus))
      : escapeHtml_((r.missing || []).join(', '));
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;"><b>${escapeHtml_(r.mall || '—')}</b> · ${escapeHtml_(r.lotNo || '—')}<br><small style="color:#6b7280;">${escapeHtml_(r.jobCode || '')} · ${escapeHtml_(r.client || '')}</small></td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#374151;font-family:monospace;">${escapeHtml_(r.installDate || '—')}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center;">${when}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#374151;">${detail}</td>
    </tr>`;
  }
  return `
    <h2 style="font-size:16px;margin:24px 0 10px;color:${accent};">${title}</h2>
    <table style="border-collapse:collapse;width:100%;font-size:13px;">
      <thead><tr style="background:#f3f4f6;">
        <th style="padding:8px 10px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;">Job</th>
        <th style="padding:8px 10px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;">Install</th>
        <th style="padding:8px 10px;text-align:center;color:#6b7280;font-size:11px;text-transform:uppercase;">Left</th>
        <th style="padding:8px 10px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;">${permitFocus ? 'Permit' : 'Missing'}</th>
      </tr></thead>
      <tbody>${rows.map(dline).join('')}</tbody>
    </table>`;
}

function emailShell_(heading, inner) {
  const webAppUrl = ScriptApp.getService().getUrl() || '';
  const openBtn = webAppUrl ? `<p style="margin-top:24px;"><a href="${webAppUrl}" style="background:#f59e0b;color:#0a0e1a;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px;">Open Dispatch Board</a></p>` : '';
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;max-width:760px;margin:0 auto;padding:24px;color:#111827;">
    <h1 style="font-size:18px;margin:0 0 6px;color:#0a0e1a;">HG — Daily Job Readiness & Dispatch</h1>
    <p style="color:#6b7280;font-size:13px;margin:0 0 16px;">${escapeHtml_(heading)}</p>
    ${inner}
    ${openBtn}
    <p style="color:#9ca3af;font-size:11px;margin-top:32px;border-top:1px solid #e5e7eb;padding-top:12px;">Auto-generated by the Dispatch backend · ${escapeHtml_(todayLabel_())}</p>
  </div>`;
}

/* ===================== TRIGGER INSTALLER ===================== */
/** Run ONCE from the editor. Default: every day 07:30 Asia/Kuala_Lumpur. */
function installDailyTrigger() {
  requireDomain_();
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'sendDailyDispatchDigest') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendDailyDispatchDigest')
    .timeBased().everyDays(1).atHour(7).nearMinute(30).create();
  return { installed: true, function: 'sendDailyDispatchDigest', schedule: 'Daily ~07:30 MYT' };
}
function listTriggers() {
  return ScriptApp.getProjectTriggers().map(t => ({
    fn: t.getHandlerFunction(), type: String(t.getEventType()), source: String(t.getTriggerSource()),
  }));
}

/* ===================== DEV / TEST ===================== */
function _seedSampleData_() {
  requireDomain_();
  ensureSheets_();
  // Staff
  ['Ah Hock','Calvin Tan','Raju'].forEach(n => saveStaff({ name: n, role: 'driver' }));
  ['Ali','Bala','Chong','Dinesh','Eason Lim','Fad,'].forEach(n => saveStaff({ name: n.replace(/,$/, ''), role: 'worker' }));
  // Lorries
  ['WA 1234 B','WB 5678 C','WC 9012 D'].forEach(p => saveLorry({ plate: p, label: '3-tonne' }));
  const tz = Session.getScriptTimeZone() || 'Asia/Kuala_Lumpur';
  const d = n => Utilities.formatDate(new Date(Date.now() + n * 86400000), tz, 'yyyy-MM-dd');
  // Jobs in different readiness states
  saveJob({ client:'ABC Sdn Bhd', clientGroup:'ABC × HG', mall:'Mid Valley', lotNo:'L2-15', jobType:'install',
    scope:'12m hoarding', doorType:'Swing door', installDate:d(1), measureStatus:'sketch_done',
    quoteStatus:'confirmed', needsVisual:'yes', visualStatus:'approved', permitBy:'us', permitStatus:'approved',
    materialReady:'yes' }); // READY
  saveJob({ client:'XYZ Construction', clientGroup:'XYZ × HG', mall:'Sunway Pyramid', lotNo:'LG-22', jobType:'install',
    scope:'8m hoarding', doorType:'Sliding door', installDate:d(2), measureStatus:'sketch_done',
    quoteStatus:'confirmed', needsVisual:'no', visualStatus:'na', permitBy:'us', permitStatus:'submitted',
    materialReady:'yes' }); // AT RISK + permit alarm (install in 2 days, permit not approved)
  saveJob({ client:'DEF Builders', clientGroup:'DEF × HG', mall:'Pavilion KL', lotNo:'L3-08', jobType:'dismantle',
    scope:'15m hoarding dismantle', doorType:'None', installDate:d(9), measureStatus:'pending',
    quoteStatus:'sent', needsVisual:'no', visualStatus:'na', permitBy:'client', permitStatus:'pending',
    materialReady:'no' }); // BLOCKED (far out)
  return getAllData();
}

function _resetAllSheets_DANGER() {
  const ss = ss_();
  Object.keys(HEADERS).forEach(name => {
    const s = ss.getSheetByName(name);
    if (s) ss.deleteSheet(s);
  });
  ensureSheets_();
}
