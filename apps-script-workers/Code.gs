/**
 * Black Lee — Workers Documentation System (Cloud v1)
 * Google Apps Script backend, served as a Workspace-restricted web app.
 *
 * Storage: the Google Sheet this script is bound to (Container-bound script).
 * Auth:    Workspace domain restriction set in appsscript.json (access: DOMAIN).
 *          We also enforce a domain check on every server call for defence in depth.
 *
 * Purpose: track every worker's compliance documents (passport, IC, visa, mall
 * EHS cards, CIDB green cards, competency certificates, driving licences) with
 * expiry-date reminders. Generate per-project compliance PDFs by division +
 * doc-type selection.
 */

/* ===================== CONFIG ===================== */
const ALLOWED_DOMAIN = 'hggroup.com.my';
const DEFAULT_EMAIL_RECIPIENT = 'blacklee@hggroup.com.my';

const SHEETS = {
  DIVISIONS:                     'Divisions',
  WORKERS:                       'Workers',
  DOCUMENTS:                     'Documents',
  WORK_PERMITS:                  'WorkPermits',
  WORK_PERMIT_WORKERS:           'WorkPermitWorkers',
  WORK_PERMIT_ATTACHMENTS:       'WorkPermitAttachments',
  PERMIT_FORMS:                  'PermitForms',
  INSURANCE_POLICIES:            'InsurancePolicies',
  INSURANCE_POLICY_ATTACHMENTS:  'InsurancePolicyAttachments',
  INSURANCE_POLICY_QUOTES:       'InsurancePolicyQuotes',
  INSURANCE_POLICY_PAYMENTS:     'InsurancePolicyPayments',
  REPORT_HISTORY:                'ReportHistory',
  CONFIG:                        'Config',
  AUDIT:                         'AuditLog',
};

const HEADERS = {
  Divisions:         ['id','name','description','active','createdAt','createdBy'],
  Workers:           ['id','fullName','icNumber','passportNumber','nationality','divisionId','position','phone','photoDriveUrl','status','createdAt','createdBy','updatedAt','updatedBy'],
  Documents:         ['id','workerId','docType','docSubtype','docNumber','issueDate','expiryDate','issuingAuthority','driveUrl','notes','createdAt','createdBy','updatedAt','updatedBy'],
  // New columns (duration + insurance + clientInvoice fields) appended at the end so existing rows still align.
  // ensureSheets_ auto-migrates the live sheet by appending any missing columns.
  WorkPermits:                  ['id','permitNumber','title','mallName','projectReference','contractorClient','workScope','workArea','workingHours','appliedBy','issuedBy','issueDate','validFrom','validUntil','driveUrl','status','notes','createdAt','createdBy','updatedAt','updatedBy','duration','insuranceSource','insurancePolicyId','insuranceProvider','insurancePolicyNumber','insuranceDriveUrl','insuranceNotes','clientInvoiceNumber'],
  WorkPermitWorkers:            ['id','permitId','workerId','role'],
  WorkPermitAttachments:        ['id','permitId','label','driveUrl','sortOrder'],
  PermitForms:                  ['id','mallName','formName','formType','version','driveUrl','contactInfo','leadTime','requirements','notes','lastVerifiedDate','createdAt','createdBy','updatedAt','updatedBy'],
  // InsurancePolicies — added invoiceNumber, premiumAmount, chargedToClient at the end (auto-migrate handles existing sheets).
  InsurancePolicies:            ['id','policyNumber','provider','coverageType','coverageAmount','validFrom','validUntil','driveUrl','notes','status','createdAt','createdBy','updatedAt','updatedBy','invoiceNumber','premiumAmount','chargedToClient'],
  InsurancePolicyAttachments:   ['id','policyId','label','driveUrl','sortOrder'],
  InsurancePolicyQuotes:        ['id','policyId','provider','amount','notes','sortOrder'],
  InsurancePolicyPayments:      ['id','policyId','paymentDate','amount','reference','notes','sortOrder'],
  ReportHistory:     ['id','generatedAt','generatedBy','format','mallName','projectName','contractorRef','reportDate','divisionIds','workerIds','docTypes','workerCount','docTypeCount'],
  Config:            ['key','value','notes'],
  AuditLog:          ['timestamp','userEmail','action','recordType','recordId','details'],
};

// Work-permit duration types — drives the new filter on the Work Permits tab.
const PERMIT_DURATIONS = [
  { key: 'yearly',  label: 'Yearly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'ad_hoc',  label: 'Ad-hoc / one-off' },
];

// Where the insurance cover comes from when applying for a work permit.
const INSURANCE_SOURCES = [
  { key: 'hg_existing', label: 'Use existing HG insurance policy' },
  { key: 'new',         label: 'Buy new insurance policy' },
  { key: 'client',      label: 'Insurance cover note from client' },
  { key: 'none',        label: 'No insurance coverage needed' },
];

// Suggested form-type categories (free-text input still allowed)
const FORM_TYPES = [
  'General Work Permit',
  'Hot Work Permit',
  'After-Hours / Night Work',
  'Lift / Crane Permit',
  'Hoarding Permit',
  'Loading Bay Booking',
  'Worker Pass Application',
  'Vehicle Pass Application',
  'EHS / Safety Induction',
  'Other',
];

// Locked doc-type enum, matches the 11 types from the brief.
const DOC_TYPES = [
  { key: 'PASSPORT',         label: 'Passport',                          tracksExpiry: true,  hasSubtype: false },
  { key: 'IC',               label: 'IC / MyKad',                        tracksExpiry: false, hasSubtype: false },
  { key: 'WORKING_VISA',     label: 'Working Visa',                      tracksExpiry: true,  hasSubtype: false },
  { key: 'LETTER_AUTH',      label: 'Letter of Authorization (Agent)',   tracksExpiry: true,  hasSubtype: false },
  { key: 'MALL_PLEDGE',      label: 'Mall Safety Pledge',                tracksExpiry: false, hasSubtype: true  }, // subtype = mall name
  { key: 'MALL_EHS',         label: 'Mall EHS Card',                     tracksExpiry: true,  hasSubtype: true  }, // subtype = mall name
  { key: 'CIDB_GREEN',       label: 'CIDB Green Card',                   tracksExpiry: true,  hasSubtype: false },
  { key: 'WAH',              label: 'Work at Height (WAH)',              tracksExpiry: true,  hasSubtype: true,  subtypeRequired: false }, // subtype = level / variant (optional)
  { key: 'COMPETENCY_CERT',  label: 'Competency Certificate',            tracksExpiry: true,  hasSubtype: true  },
  { key: 'EDUCATION_CERT',   label: 'Education Certificate',             tracksExpiry: false, hasSubtype: true  },
  { key: 'PROFESSIONAL_CERT',label: 'Professional Certificate',          tracksExpiry: true,  hasSubtype: true  },
  { key: 'DRIVING_HEAVY',    label: 'Driving Licence — Heavy Vehicle',   tracksExpiry: true,  hasSubtype: true  }, // subtype = lorry / backhoe / crane etc.
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
    .setTitle('Black Lee — Workers Documentation')
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

function getCurrentUser() {
  return requireDomain_();
}

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
        // SCHEMA MIGRATION: append any missing columns to the end so existing data is preserved.
        // This lets us add new fields to HEADERS without rebuilding the sheet.
        const missing = expected.filter(h => currentHeaders.indexOf(h) === -1);
        missing.forEach((h, i) => {
          sheet.getRange(1, lastCol + 1 + i).setValue(h);
        });
      }
      sheet.setFrozenRows(1);
      const finalCol = sheet.getLastColumn();
      if (finalCol > 0) sheet.getRange(1, 1, 1, finalCol).setFontWeight('bold');
    }
  });
  // Seed default Config rows if Config sheet is empty
  const cfg = ss.getSheetByName(SHEETS.CONFIG);
  if (cfg && cfg.getLastRow() < 2) {
    cfg.appendRow(['emailRecipients', DEFAULT_EMAIL_RECIPIENT, 'Comma-separated list of emails for the weekly expiry digest']);
    cfg.appendRow(['expiringSoonDays', '30', 'Anything expiring within N days counts as "expiring soon" (amber)']);
    cfg.appendRow(['expiringWarnDays', '90', 'Anything expiring within N days but past expiringSoonDays counts as "warning" (yellow)']);
  }
  // Drop the default "Sheet1" if it's empty
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
  // Read by ACTUAL sheet headers (not the JS HEADERS constant) so the function works even
  // when the sheet is mid-migration (older schema than HEADERS) or has manual extra columns.
  const actualHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || ''));
  const expectedHeaders = HEADERS[name] || [];
  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  return values
    .filter(row => row.some(v => v !== '' && v !== null))
    .map(row => {
      const obj = {};
      // Pre-initialise every expected field so the frontend never trips on `undefined`
      expectedHeaders.forEach(h => obj[h] = '');
      // Then overlay the actual sheet values
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
  // Align with the sheet's ACTUAL column order so writes don't shift data into the wrong columns
  // after a schema migration has appended new columns at the end.
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
  ss_().getSheetByName(name).getRange(row, 1, 1, HEADERS[name].length)
    .setValues([rowFromRecord_(name, rec)]);
}

function deleteRecordsById_(name, id, column) {
  const sheet = ss_().getSheetByName(name);
  const col = column || 1;
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const vals = sheet.getRange(2, col, last - 1, 1).getValues();
  let deleted = 0;
  for (let i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][0]) === String(id)) {
      sheet.deleteRow(i + 2);
      deleted++;
    }
  }
  return deleted;
}

/* ===================== UTILS ===================== */
function uid_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}
function nowIso_() {
  return new Date().toISOString();
}
function readConfigMap_() {
  const rows = readSheet_(SHEETS.CONFIG);
  const map = {};
  rows.forEach(r => { if (r.key) map[String(r.key).trim()] = String(r.value == null ? '' : r.value); });
  return map;
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
  return {
    currentUser:        email,
    serverTime:         nowIso_(),
    domain:             ALLOWED_DOMAIN,
    docTypes:           DOC_TYPES,
    config:             readConfigMap_(),
    divisions:          readSheet_(SHEETS.DIVISIONS),
    workers:            readSheet_(SHEETS.WORKERS),
    documents:          readSheet_(SHEETS.DOCUMENTS),
    workPermits:            readSheet_(SHEETS.WORK_PERMITS),
    workPermitWorkers:      readSheet_(SHEETS.WORK_PERMIT_WORKERS),
    workPermitAttachments:  readSheet_(SHEETS.WORK_PERMIT_ATTACHMENTS),
    permitForms:        readSheet_(SHEETS.PERMIT_FORMS),
    formTypes:          FORM_TYPES,
    insurancePolicies:            readSheet_(SHEETS.INSURANCE_POLICIES),
    insurancePolicyAttachments:   readSheet_(SHEETS.INSURANCE_POLICY_ATTACHMENTS),
    insurancePolicyQuotes:        readSheet_(SHEETS.INSURANCE_POLICY_QUOTES),
    insurancePolicyPayments:      readSheet_(SHEETS.INSURANCE_POLICY_PAYMENTS),
    permitDurations:    PERMIT_DURATIONS,
    insuranceSources:   INSURANCE_SOURCES,
    reportHistory:      readSheet_(SHEETS.REPORT_HISTORY),
  };
}

/* ===== Divisions ===== */
function saveDivision(payload) {
  const email = requireDomain_();
  if (!payload || !payload.name) throw new Error('Division name required.');
  const rec = {
    id:          payload.id || uid_(),
    name:        String(payload.name).trim(),
    description: payload.description || '',
    active:      payload.active === false ? false : true,
    createdAt:   payload.createdAt || nowIso_(),
    createdBy:   payload.createdBy || email,
  };
  const existing = findRowIndexById_(SHEETS.DIVISIONS, rec.id);
  if (existing >= 2) {
    const cur = readSheet_(SHEETS.DIVISIONS).find(d => d.id === rec.id);
    if (cur) { rec.createdAt = cur.createdAt || rec.createdAt; rec.createdBy = cur.createdBy || rec.createdBy; }
    updateRecord_(SHEETS.DIVISIONS, rec.id, rec);
    logAudit_('UPDATE', 'Division', rec.id, rec.name);
  } else {
    appendRecord_(SHEETS.DIVISIONS, rec);
    logAudit_('CREATE', 'Division', rec.id, rec.name);
  }
  return getAllData();
}
function deleteDivision(id) {
  requireDomain_();
  const name = (readSheet_(SHEETS.DIVISIONS).find(d => d.id === id) || {}).name || '';
  // Guard: block delete if any active workers reference it
  const inUse = readSheet_(SHEETS.WORKERS).some(w => w.divisionId === id && w.status !== 'resigned');
  if (inUse) throw new Error('Cannot delete: workers are still assigned to "' + name + '". Reassign them first, or mark the division inactive.');
  deleteRecordsById_(SHEETS.DIVISIONS, id);
  logAudit_('DELETE', 'Division', id, name);
  return getAllData();
}

/* ===== Workers ===== */
function saveWorker(payload) {
  const email = requireDomain_();
  if (!payload || !payload.fullName) throw new Error('Worker name required.');
  const rec = {
    id:              payload.id || uid_(),
    fullName:        String(payload.fullName).trim(),
    icNumber:        payload.icNumber || '',
    passportNumber:  payload.passportNumber || '',
    nationality:     payload.nationality || '',
    divisionId:      payload.divisionId || '',
    position:        payload.position || '',
    phone:           payload.phone || '',
    photoDriveUrl:   payload.photoDriveUrl || '',
    status:          payload.status || 'active',
    createdAt:       payload.createdAt || nowIso_(),
    createdBy:       payload.createdBy || email,
    updatedAt:       nowIso_(),
    updatedBy:       email,
  };
  const existing = findRowIndexById_(SHEETS.WORKERS, rec.id);
  if (existing >= 2) {
    const cur = readSheet_(SHEETS.WORKERS).find(w => w.id === rec.id);
    if (cur) { rec.createdAt = cur.createdAt || rec.createdAt; rec.createdBy = cur.createdBy || rec.createdBy; }
    updateRecord_(SHEETS.WORKERS, rec.id, rec);
    logAudit_('UPDATE', 'Worker', rec.id, rec.fullName);
  } else {
    appendRecord_(SHEETS.WORKERS, rec);
    logAudit_('CREATE', 'Worker', rec.id, rec.fullName);
  }
  // PERF: return only the saved record. Frontend merges into local cache and skips
  // re-reading all 8 sheets — much faster than the old `return getAllData()`.
  return { ok: true, worker: rec };
}
function deleteWorker(id) {
  requireDomain_();
  const w = readSheet_(SHEETS.WORKERS).find(x => x.id === id) || {};
  // Hard delete worker + all their documents + any work-permit join rows
  deleteRecordsById_(SHEETS.WORKERS, id);
  const docs = readSheet_(SHEETS.DOCUMENTS).filter(d => d.workerId === id);
  const docIds = docs.map(d => d.id);
  docs.forEach(d => deleteRecordsById_(SHEETS.DOCUMENTS, d.id));
  const joins = readSheet_(SHEETS.WORK_PERMIT_WORKERS).filter(j => j.workerId === id);
  const joinIds = joins.map(j => j.id);
  joins.forEach(j => deleteRecordsById_(SHEETS.WORK_PERMIT_WORKERS, j.id));
  logAudit_('DELETE', 'Worker', id, w.fullName + ' (+ ' + docs.length + ' docs, ' + joins.length + ' permit link(s))');
  return { ok: true, deletedWorkerId: id, deletedDocumentIds: docIds, deletedPermitWorkerIds: joinIds };
}

/* ===== Documents ===== */
function saveDocument(payload) {
  const email = requireDomain_();
  if (!payload || !payload.workerId || !payload.docType) throw new Error('Worker and document type required.');
  if (!DOC_TYPES.some(t => t.key === payload.docType)) throw new Error('Unknown document type: ' + payload.docType);
  // Pull worker name so the audit-log "Details" cell makes sense at a glance
  // (e.g. "Calvin Chong · CIDB_GREEN" instead of just "CIDB_GREEN").
  const worker = readSheet_(SHEETS.WORKERS).find(w => w.id === payload.workerId);
  const workerName = worker ? worker.fullName : '(unknown worker)';
  const rec = {
    id:                payload.id || uid_(),
    workerId:          payload.workerId,
    docType:           payload.docType,
    docSubtype:        payload.docSubtype || '',
    docNumber:         payload.docNumber || '',
    issueDate:         payload.issueDate || '',
    expiryDate:        payload.expiryDate || '',
    issuingAuthority:  payload.issuingAuthority || '',
    driveUrl:          payload.driveUrl || '',
    notes:             payload.notes || '',
    createdAt:         payload.createdAt || nowIso_(),
    createdBy:         payload.createdBy || email,
    updatedAt:         nowIso_(),
    updatedBy:         email,
  };
  const auditDetails = workerName + ' · ' + rec.docType + (rec.docSubtype ? ' · ' + rec.docSubtype : '');
  const existing = findRowIndexById_(SHEETS.DOCUMENTS, rec.id);
  if (existing >= 2) {
    const cur = readSheet_(SHEETS.DOCUMENTS).find(d => d.id === rec.id);
    if (cur) { rec.createdAt = cur.createdAt || rec.createdAt; rec.createdBy = cur.createdBy || rec.createdBy; }
    updateRecord_(SHEETS.DOCUMENTS, rec.id, rec);
    logAudit_('UPDATE', 'Document', rec.id, auditDetails);
  } else {
    appendRecord_(SHEETS.DOCUMENTS, rec);
    logAudit_('CREATE', 'Document', rec.id, auditDetails);
  }
  // PERF: return only the saved record (avoid re-reading all 8 sheets)
  return { ok: true, document: rec };
}
function deleteDocument(id) {
  requireDomain_();
  const d = readSheet_(SHEETS.DOCUMENTS).find(x => x.id === id) || {};
  const worker = d.workerId ? readSheet_(SHEETS.WORKERS).find(w => w.id === d.workerId) : null;
  const workerName = worker ? worker.fullName : '(unknown worker)';
  const auditDetails = workerName + ' · ' + (d.docType || '') + (d.docSubtype ? ' · ' + d.docSubtype : '');
  deleteRecordsById_(SHEETS.DOCUMENTS, id);
  logAudit_('DELETE', 'Document', id, auditDetails);
  return { ok: true, deletedDocumentId: id };
}

/* ===== Work Permits ===== */
function saveWorkPermit(payload) {
  const email = requireDomain_();
  if (!payload) throw new Error('Empty payload.');
  if (!payload.mallName && !payload.permitNumber && !payload.title) {
    throw new Error('At minimum the permit needs a mall, permit number, or title.');
  }
  const rec = {
    id:                     payload.id || uid_(),
    permitNumber:           payload.permitNumber || '',
    title:                  payload.title || '',
    mallName:               payload.mallName || '',
    projectReference:       payload.projectReference || '',
    contractorClient:       payload.contractorClient || '',
    workScope:              payload.workScope || '',
    workArea:               payload.workArea || '',
    workingHours:           payload.workingHours || '',
    appliedBy:              payload.appliedBy || 'own_team',   // own_team / client / mall
    issuedBy:               payload.issuedBy || '',
    issueDate:              payload.issueDate || '',
    validFrom:              payload.validFrom || '',
    validUntil:             payload.validUntil || '',
    driveUrl:               payload.driveUrl || '',
    status:                 payload.status || 'active',        // active / cancelled / superseded
    notes:                  payload.notes || '',
    createdAt:              payload.createdAt || nowIso_(),
    createdBy:              payload.createdBy || email,
    updatedAt:              nowIso_(),
    updatedBy:              email,
    duration:               payload.duration || 'ad_hoc',      // yearly / monthly / ad_hoc
    insuranceSource:        payload.insuranceSource || 'none', // hg_existing / new / client / none
    insurancePolicyId:      payload.insurancePolicyId || '',   // only if insuranceSource === 'hg_existing'
    insuranceProvider:      payload.insuranceProvider || '',
    insurancePolicyNumber:  payload.insurancePolicyNumber || '',
    insuranceDriveUrl:      payload.insuranceDriveUrl || '',
    insuranceNotes:         payload.insuranceNotes || '',
    clientInvoiceNumber:    payload.clientInvoiceNumber || '',  // invoice we sent to client for THIS permit
  };
  const existing = findRowIndexById_(SHEETS.WORK_PERMITS, rec.id);
  if (existing >= 2) {
    const cur = readSheet_(SHEETS.WORK_PERMITS).find(p => p.id === rec.id);
    if (cur) { rec.createdAt = cur.createdAt || rec.createdAt; rec.createdBy = cur.createdBy || rec.createdBy; }
    updateRecord_(SHEETS.WORK_PERMITS, rec.id, rec);
    logAudit_('UPDATE', 'WorkPermit', rec.id, (rec.permitNumber || rec.title || rec.mallName));
  } else {
    appendRecord_(SHEETS.WORK_PERMITS, rec);
    logAudit_('CREATE', 'WorkPermit', rec.id, (rec.permitNumber || rec.title || rec.mallName));
  }

  // Replace worker-permit join rows for this permit (the payload's workerIds is the source of truth)
  if (Array.isArray(payload.workerIds)) {
    const existingJoins = readSheet_(SHEETS.WORK_PERMIT_WORKERS).filter(j => j.permitId === rec.id);
    existingJoins.forEach(j => deleteRecordsById_(SHEETS.WORK_PERMIT_WORKERS, j.id));
    const seen = {};
    payload.workerIds.forEach(wid => {
      if (!wid || seen[wid]) return;
      seen[wid] = true;
      appendRecord_(SHEETS.WORK_PERMIT_WORKERS, {
        id: uid_(), permitId: rec.id, workerId: wid, role: '',
      });
    });
  }

  // Replace attachment rows for this permit (the payload's `attachments` is the source of truth)
  if (Array.isArray(payload.attachments)) {
    const existingAtts = readSheet_(SHEETS.WORK_PERMIT_ATTACHMENTS).filter(a => a.permitId === rec.id);
    existingAtts.forEach(a => deleteRecordsById_(SHEETS.WORK_PERMIT_ATTACHMENTS, a.id));
    payload.attachments.forEach((att, i) => {
      if (!att || (!att.label && !att.driveUrl)) return; // skip empty rows
      appendRecord_(SHEETS.WORK_PERMIT_ATTACHMENTS, {
        id:        att.id || uid_(),
        permitId:  rec.id,
        label:     String(att.label || '').trim(),
        driveUrl:  String(att.driveUrl || '').trim(),
        sortOrder: i,
      });
    });
  }
  return getAllData();
}

function deleteWorkPermit(id) {
  requireDomain_();
  const p = readSheet_(SHEETS.WORK_PERMITS).find(x => x.id === id) || {};
  deleteRecordsById_(SHEETS.WORK_PERMITS, id);
  const joins = readSheet_(SHEETS.WORK_PERMIT_WORKERS).filter(j => j.permitId === id);
  joins.forEach(j => deleteRecordsById_(SHEETS.WORK_PERMIT_WORKERS, j.id));
  const atts = readSheet_(SHEETS.WORK_PERMIT_ATTACHMENTS).filter(a => a.permitId === id);
  atts.forEach(a => deleteRecordsById_(SHEETS.WORK_PERMIT_ATTACHMENTS, a.id));
  logAudit_('DELETE', 'WorkPermit', id, (p.permitNumber || p.title || p.mallName || '') + ' (+ ' + joins.length + ' worker links, ' + atts.length + ' attachments)');
  return getAllData();
}

/* ===== Permit Forms (blank templates library) ===== */
function savePermitForm(payload) {
  const email = requireDomain_();
  if (!payload || !payload.mallName) throw new Error('Mall / building name required.');
  if (!payload.formName) throw new Error('Form name required.');
  const rec = {
    id:                payload.id || uid_(),
    mallName:          String(payload.mallName).trim(),
    formName:          String(payload.formName).trim(),
    formType:          payload.formType || '',
    version:           payload.version || '',
    driveUrl:          payload.driveUrl || '',
    contactInfo:       payload.contactInfo || '',
    leadTime:          payload.leadTime || '',
    requirements:      payload.requirements || '',
    notes:             payload.notes || '',
    lastVerifiedDate:  payload.lastVerifiedDate || '',
    createdAt:         payload.createdAt || nowIso_(),
    createdBy:         payload.createdBy || email,
    updatedAt:         nowIso_(),
    updatedBy:         email,
  };
  const existing = findRowIndexById_(SHEETS.PERMIT_FORMS, rec.id);
  if (existing >= 2) {
    const cur = readSheet_(SHEETS.PERMIT_FORMS).find(f => f.id === rec.id);
    if (cur) { rec.createdAt = cur.createdAt || rec.createdAt; rec.createdBy = cur.createdBy || rec.createdBy; }
    updateRecord_(SHEETS.PERMIT_FORMS, rec.id, rec);
    logAudit_('UPDATE', 'PermitForm', rec.id, rec.mallName + ' · ' + rec.formName);
  } else {
    appendRecord_(SHEETS.PERMIT_FORMS, rec);
    logAudit_('CREATE', 'PermitForm', rec.id, rec.mallName + ' · ' + rec.formName);
  }
  return getAllData();
}

function deletePermitForm(id) {
  requireDomain_();
  const f = readSheet_(SHEETS.PERMIT_FORMS).find(x => x.id === id) || {};
  deleteRecordsById_(SHEETS.PERMIT_FORMS, id);
  logAudit_('DELETE', 'PermitForm', id, (f.mallName || '') + ' · ' + (f.formName || ''));
  return getAllData();
}

/* ===== Insurance Policies (HG's own cover note library) ===== */
function saveInsurancePolicy(payload) {
  const email = requireDomain_();
  if (!payload || !payload.policyNumber) throw new Error('Policy / cover note number required.');
  if (!payload.provider) throw new Error('Insurance provider required.');
  const rec = {
    id:               payload.id || uid_(),
    policyNumber:     String(payload.policyNumber).trim(),
    provider:         String(payload.provider).trim(),
    coverageType:     payload.coverageType || '',
    coverageAmount:   payload.coverageAmount || '',
    validFrom:        payload.validFrom || '',
    validUntil:       payload.validUntil || '',
    driveUrl:         payload.driveUrl || '',
    notes:            payload.notes || '',
    status:           payload.status || 'active',  // active / expired / cancelled
    createdAt:        payload.createdAt || nowIso_(),
    createdBy:        payload.createdBy || email,
    updatedAt:        nowIso_(),
    updatedBy:        email,
    invoiceNumber:    payload.invoiceNumber || '',
    premiumAmount:    Number(payload.premiumAmount)   || 0,  // cost we pay to insurer
    chargedToClient:  Number(payload.chargedToClient) || 0,  // what we bill the client
  };
  const existing = findRowIndexById_(SHEETS.INSURANCE_POLICIES, rec.id);
  if (existing >= 2) {
    const cur = readSheet_(SHEETS.INSURANCE_POLICIES).find(p => p.id === rec.id);
    if (cur) { rec.createdAt = cur.createdAt || rec.createdAt; rec.createdBy = cur.createdBy || rec.createdBy; }
    updateRecord_(SHEETS.INSURANCE_POLICIES, rec.id, rec);
    logAudit_('UPDATE', 'InsurancePolicy', rec.id, rec.provider + ' · ' + rec.policyNumber);
  } else {
    appendRecord_(SHEETS.INSURANCE_POLICIES, rec);
    logAudit_('CREATE', 'InsurancePolicy', rec.id, rec.provider + ' · ' + rec.policyNumber);
  }

  // Replace attachment / quote / payment rows for this policy (payload is the source of truth)
  function replaceChildRows_(sheetName, items, builder) {
    const existing = readSheet_(sheetName).filter(x => x.policyId === rec.id);
    existing.forEach(x => deleteRecordsById_(sheetName, x.id));
    (items || []).forEach((item, i) => {
      const row = builder(item, i);
      if (row) appendRecord_(sheetName, row);
    });
  }
  if (Array.isArray(payload.attachments)) {
    replaceChildRows_(SHEETS.INSURANCE_POLICY_ATTACHMENTS, payload.attachments, (att, i) => {
      if (!att || (!att.label && !att.driveUrl)) return null;
      return { id: att.id || uid_(), policyId: rec.id, label: String(att.label || '').trim(), driveUrl: String(att.driveUrl || '').trim(), sortOrder: i };
    });
  }
  if (Array.isArray(payload.quotes)) {
    replaceChildRows_(SHEETS.INSURANCE_POLICY_QUOTES, payload.quotes, (q, i) => {
      if (!q || (!q.provider && !Number(q.amount))) return null;
      return { id: q.id || uid_(), policyId: rec.id, provider: String(q.provider || '').trim(), amount: Number(q.amount) || 0, notes: String(q.notes || '').trim(), sortOrder: i };
    });
  }
  if (Array.isArray(payload.payments)) {
    replaceChildRows_(SHEETS.INSURANCE_POLICY_PAYMENTS, payload.payments, (p, i) => {
      if (!p || (!Number(p.amount) && !p.paymentDate)) return null;
      return { id: p.id || uid_(), policyId: rec.id, paymentDate: String(p.paymentDate || '').trim(), amount: Number(p.amount) || 0, reference: String(p.reference || '').trim(), notes: String(p.notes || '').trim(), sortOrder: i };
    });
  }
  return getAllData();
}

function deleteInsurancePolicy(id) {
  requireDomain_();
  const p = readSheet_(SHEETS.INSURANCE_POLICIES).find(x => x.id === id) || {};
  // Guard: warn if any work permit references this policy
  const inUse = readSheet_(SHEETS.WORK_PERMITS).filter(wp => wp.insurancePolicyId === id);
  if (inUse.length) {
    throw new Error('Cannot delete — ' + inUse.length + ' work permit(s) still reference this policy. Reassign them first.');
  }
  deleteRecordsById_(SHEETS.INSURANCE_POLICIES, id);
  // Cascade-delete attachment / quote / payment rows
  [SHEETS.INSURANCE_POLICY_ATTACHMENTS, SHEETS.INSURANCE_POLICY_QUOTES, SHEETS.INSURANCE_POLICY_PAYMENTS].forEach(sheetName => {
    readSheet_(sheetName).filter(x => x.policyId === id).forEach(x => deleteRecordsById_(sheetName, x.id));
  });
  logAudit_('DELETE', 'InsurancePolicy', id, (p.provider || '') + ' · ' + (p.policyNumber || ''));
  return getAllData();
}

/* ===== Direct file upload to Drive ===== */
// All uploads land in: <My Drive>/Workers Documentation — Uploads/<subfolder>/
// Each file is auto-shared "anyone at @hggroup.com.my with the link can view".
const UPLOAD_ROOT_FOLDER = 'Workers Documentation — Uploads';
const UPLOAD_MAX_BYTES   = 10 * 1024 * 1024; // 10 MB per file

function uploadFileToDrive(payload) {
  requireDomain_();
  if (!payload || !payload.base64 || !payload.filename) {
    throw new Error('Missing file data.');
  }
  const mimeType  = payload.mimeType  || 'application/octet-stream';
  const subfolder = payload.subfolder || 'General';

  // Decode base64
  const bytes = Utilities.base64Decode(payload.base64);
  if (bytes.length > UPLOAD_MAX_BYTES) {
    throw new Error('File too large. Max ' + Math.round(UPLOAD_MAX_BYTES / 1024 / 1024) + ' MB.');
  }

  // Build a unique filename — original name with a timestamp prefix so we never overwrite
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Kuala_Lumpur', 'yyyyMMdd-HHmmss');
  const finalName = stamp + '_' + cleanFilename_(payload.filename);

  const blob = Utilities.newBlob(bytes, mimeType, finalName);
  const folder = getOrCreateUploadFolder_(subfolder);
  const file = folder.createFile(blob);

  // Share with the company Workspace domain so staff can open the link
  try {
    file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    Logger.log('setSharing failed: ' + (e && e.message ? e.message : e));
  }

  logAudit_('UPLOAD', 'DriveFile', file.getId(), finalName + ' → ' + subfolder + ' (' + bytes.length + ' bytes)');

  return {
    id:        file.getId(),
    url:       file.getUrl(),
    name:      file.getName(),
    sizeBytes: bytes.length,
  };
}

function getOrCreateUploadFolder_(subfolderName) {
  let root;
  const rootIter = DriveApp.getFoldersByName(UPLOAD_ROOT_FOLDER);
  if (rootIter.hasNext()) {
    root = rootIter.next();
  } else {
    root = DriveApp.createFolder(UPLOAD_ROOT_FOLDER);
    try { root.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  }
  const subIter = root.getFoldersByName(subfolderName);
  if (subIter.hasNext()) return subIter.next();
  const sub = root.createFolder(subfolderName);
  try { sub.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  return sub;
}

function cleanFilename_(s) {
  return String(s || 'file').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
}

/* ===== Image fetching for PDF (sidesteps Drive CORS block) ===== */
/**
 * Fetches a batch of Drive image URLs and returns them as base64 data URIs.
 * Why: Google Drive thumbnail/file URLs do NOT return Access-Control-Allow-Origin
 * headers, so html2canvas (used by the Full Pack PDF) can't read them directly
 * in the browser. Apps Script runs server-side as the script owner — it can read
 * Drive files via DriveApp without any CORS restriction. We hand the browser
 * the bytes inline so html2canvas just reads them as local data.
 *
 * Returns an object { driveUrl: 'data:image/png;base64,...' or '' if failed }.
 */
function getImagesAsDataUris(driveUrls) {
  requireDomain_();
  const result = {};
  (driveUrls || []).forEach(url => {
    if (!url || result[url] !== undefined) return;
    result[url] = fetchDriveImage_(url);
  });
  return result;
}

function fetchDriveImage_(driveUrl) {
  try {
    const match = String(driveUrl).match(/\/d\/([a-zA-Z0-9_-]+)/) || String(driveUrl).match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (!match) return '';
    const fileId = match[1];
    const file = DriveApp.getFileById(fileId);
    const blob = file.getBlob();
    const contentType = blob.getContentType() || '';
    // Only return images. PDFs / docs / other files don't render in <img>.
    if (!contentType.indexOf('image/') === 0 && !/^image\//.test(contentType)) return '';
    const bytes = blob.getBytes();
    // Cap individual image size at ~8 MB to keep payload manageable.
    if (bytes.length > 8 * 1024 * 1024) return '';
    return 'data:' + contentType + ';base64,' + Utilities.base64Encode(bytes);
  } catch (e) {
    Logger.log('fetchDriveImage_ failed for ' + driveUrl + ': ' + (e && e.message ? e.message : e));
    return '';
  }
}

/* ===== Audit Log viewer (lazy-loaded by the Audit Log tab) ===== */
// Returns recent audit entries with optional filtering. Capped per call so a year of
// activity doesn't ship 50k rows to the browser on tab open.
function getAuditLog(opts) {
  requireDomain_();
  opts = opts || {};
  const limit = Math.min(Math.max(Number(opts.limit || 500), 50), 5000);
  const all = readSheet_(SHEETS.AUDIT);
  // Sort newest first
  all.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));

  let filtered = all;
  if (opts.user) {
    const u = String(opts.user).toLowerCase();
    filtered = filtered.filter(r => String(r.userEmail || '').toLowerCase().includes(u));
  }
  if (opts.action) {
    filtered = filtered.filter(r => String(r.action || '') === String(opts.action));
  }
  if (opts.recordType) {
    filtered = filtered.filter(r => String(r.recordType || '') === String(opts.recordType));
  }
  if (opts.from) {
    // from = YYYY-MM-DD inclusive
    filtered = filtered.filter(r => String(r.timestamp || '') >= String(opts.from));
  }
  if (opts.to) {
    // to = YYYY-MM-DD inclusive — extend to end of day
    const cutoff = String(opts.to) + 'T23:59:59.999Z';
    filtered = filtered.filter(r => String(r.timestamp || '') <= cutoff);
  }

  const total = filtered.length;
  return {
    rows:      filtered.slice(0, limit),
    total:     total,
    limit:     limit,
    truncated: total > limit,
  };
}

/* ===== Export logging ===== */
function logExport(payload) {
  requireDomain_();
  const details = (payload && payload.summary) ? String(payload.summary).slice(0, 480) : '';
  logAudit_('EXPORT', 'Report', uid_(), details);
  return { ok: true };
}

/* ===== Report History (user-facing) ===== */
function saveReportHistory(payload) {
  const email = requireDomain_();
  if (!payload) throw new Error('Empty payload.');
  const rec = {
    id:             uid_(),
    generatedAt:    nowIso_(),
    generatedBy:    email,
    format:         payload.format || '',
    mallName:       payload.mallName || '',
    projectName:    payload.projectName || '',
    contractorRef:  payload.contractorRef || '',
    reportDate:     payload.reportDate || '',
    divisionIds:    (payload.divisionIds || []).join(','),
    workerIds:      (payload.workerIds || []).join(','),
    docTypes:       (payload.docTypes || []).join(','),
    workerCount:    Number(payload.workerCount || 0),
    docTypeCount:   Number(payload.docTypeCount || 0),
  };
  appendRecord_(SHEETS.REPORT_HISTORY, rec);
  logAudit_('CREATE', 'ReportHistory', rec.id,
    rec.format + ' · ' + (rec.mallName || rec.projectName || 'no project') +
    ' · ' + rec.workerCount + ' worker(s)');
  return getAllData();
}

function deleteReportHistory(id) {
  requireDomain_();
  const r = readSheet_(SHEETS.REPORT_HISTORY).find(x => x.id === id) || {};
  deleteRecordsById_(SHEETS.REPORT_HISTORY, id);
  logAudit_('DELETE', 'ReportHistory', id,
    (r.format || '') + ' · ' + (r.mallName || r.projectName || ''));
  return getAllData();
}

/* ===================== WEEKLY EMAIL DIGEST ===================== */
/**
 * Time-driven trigger entrypoint. Install via installWeeklyTrigger().
 * Sends an HTML digest of expired + soon-to-expire documents to the recipients
 * listed in the Config sheet (key: emailRecipients).
 */
function sendExpiryDigest() {
  ensureSheets_();
  const cfg = readConfigMap_();
  const recipients = (cfg.emailRecipients || DEFAULT_EMAIL_RECIPIENT)
    .split(',').map(s => s.trim()).filter(Boolean);
  if (!recipients.length) return { sent: false, reason: 'No recipients configured.' };
  const soonDays = Number(cfg.expiringSoonDays || 30);

  const workers   = readSheet_(SHEETS.WORKERS);
  const divisions = readSheet_(SHEETS.DIVISIONS);
  const docs      = readSheet_(SHEETS.DOCUMENTS);
  const permits   = readSheet_(SHEETS.WORK_PERMITS);
  const workerById   = {}; workers.forEach(w   => workerById[w.id]   = w);
  const divisionById = {}; divisions.forEach(d => divisionById[d.id] = d);
  const docTypeLabel = {}; DOC_TYPES.forEach(t => docTypeLabel[t.key] = t.label);

  const today = startOfDayLocal_(new Date());
  const expired = [];
  const expiringSoon = [];
  const expiredPermits = [];
  const expiringPermits = [];

  docs.forEach(d => {
    if (!d.expiryDate) return;
    const expiry = parseDateLocal_(d.expiryDate);
    if (!expiry) return;
    const days = Math.floor((expiry - today) / 86400000);
    const w = workerById[d.workerId];
    if (!w || w.status === 'resigned' || w.status === 'inactive') return;
    const div = divisionById[w.divisionId] || {};
    const row = {
      worker:    w.fullName,
      division:  div.name || '—',
      docType:   docTypeLabel[d.docType] || d.docType,
      subtype:   d.docSubtype || '',
      number:    d.docNumber || '',
      expiry:    d.expiryDate,
      days:      days,
    };
    if (days < 0)             expired.push(row);
    else if (days <= soonDays) expiringSoon.push(row);
  });

  permits.forEach(p => {
    if (p.status && p.status !== 'active') return;
    if (!p.validUntil) return;
    const expiry = parseDateLocal_(p.validUntil);
    if (!expiry) return;
    const days = Math.floor((expiry - today) / 86400000);
    const row = {
      title:        p.title || '(untitled permit)',
      permitNumber: p.permitNumber || '',
      mall:         p.mallName || '—',
      client:       p.contractorClient || '',
      validUntil:   p.validUntil,
      days:         days,
    };
    if (days < 0)             expiredPermits.push(row);
    else if (days <= soonDays) expiringPermits.push(row);
  });

  expired.sort((a, b) => a.days - b.days);
  expiringSoon.sort((a, b) => a.days - b.days);
  expiredPermits.sort((a, b) => a.days - b.days);
  expiringPermits.sort((a, b) => a.days - b.days);

  const totalIssues = expired.length + expiringSoon.length + expiredPermits.length + expiringPermits.length;

  if (!totalIssues) {
    const allClear = `<p>✅ No expired or near-expiry documents or work permits. All ${docs.length} document records and ${permits.length} permit(s) on file are valid.</p>`;
    MailApp.sendEmail({
      to:       recipients.join(','),
      subject:  `[Workers Docs] All clear — week of ${todayLabel_()}`,
      htmlBody: emailShell_('All compliance documents and work permits valid', allClear),
    });
    return { sent: true, expired: 0, soon: 0, expiredPermits: 0, soonPermits: 0 };
  }

  const subject = `[Workers Docs] ${expired.length} doc(s) expired · ${expiringSoon.length} expiring · ${expiredPermits.length} permit(s) expired · ${expiringPermits.length} expiring — ${todayLabel_()}`;
  const body = renderDigestHtml_(expired, expiringSoon, soonDays)
             + renderPermitDigestHtml_(expiredPermits, expiringPermits, soonDays);
  MailApp.sendEmail({
    to:       recipients.join(','),
    subject:  subject,
    htmlBody: emailShell_(subject.replace('[Workers Docs] ', ''), body),
  });
  return { sent: true, expired: expired.length, soon: expiringSoon.length, expiredPermits: expiredPermits.length, soonPermits: expiringPermits.length };
}

function renderPermitDigestHtml_(expired, soon, soonDays) {
  if (!expired.length && !soon.length) return '';
  function row(r) {
    const daysText = r.days < 0
      ? `<span style="color:#dc2626;font-weight:700;">Expired ${-r.days}d ago</span>`
      : `<span style="color:#d97706;font-weight:700;">${r.days}d left</span>`;
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;"><b>${escapeHtml_(r.title)}</b>${r.permitNumber ? '<br><small style="color:#6b7280;">' + escapeHtml_(r.permitNumber) + '</small>' : ''}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#374151;">${escapeHtml_(r.mall)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#374151;">${escapeHtml_(r.client)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#374151;font-family:monospace;">${escapeHtml_(r.validUntil)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${daysText}</td>
    </tr>`;
  }
  function table(title, rows, accent) {
    if (!rows.length) return '';
    return `
      <h2 style="font-size:16px;margin:24px 0 10px;color:${accent};">${title}</h2>
      <table style="border-collapse:collapse;width:100%;font-size:13px;">
        <thead><tr style="background:#f3f4f6;">
          <th style="padding:8px 10px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">Permit</th>
          <th style="padding:8px 10px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">Mall</th>
          <th style="padding:8px 10px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">Client</th>
          <th style="padding:8px 10px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">Valid Until</th>
          <th style="padding:8px 10px;text-align:right;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">Status</th>
        </tr></thead>
        <tbody>${rows.map(row).join('')}</tbody>
      </table>`;
  }
  return table('🔴 Work permits expired', expired, '#dc2626')
       + table(`🟡 Work permits expiring within ${soonDays} days`, soon, '#d97706');
}

function renderDigestHtml_(expired, expiringSoon, soonDays) {
  const webAppUrl = ScriptApp.getService().getUrl() || '';
  function row(r) {
    const link = webAppUrl ? `<a href="${webAppUrl}#worker=${escapeHtml_(r.workerId || '')}" style="color:#d97706;text-decoration:none;">${escapeHtml_(r.worker)}</a>` : escapeHtml_(r.worker);
    const daysText = r.days < 0
      ? `<span style="color:#dc2626;font-weight:700;">Expired ${-r.days}d ago</span>`
      : `<span style="color:#d97706;font-weight:700;">${r.days}d left</span>`;
    const docLabel = escapeHtml_(r.docType) + (r.subtype ? ' · ' + escapeHtml_(r.subtype) : '');
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${link}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#374151;">${escapeHtml_(r.division)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#374151;">${docLabel}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#374151;font-family:monospace;">${escapeHtml_(r.expiry)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${daysText}</td>
    </tr>`;
  }
  function table(title, rows, accent) {
    if (!rows.length) return '';
    return `
      <h2 style="font-size:16px;margin:24px 0 10px;color:${accent};">${title}</h2>
      <table style="border-collapse:collapse;width:100%;font-size:13px;">
        <thead><tr style="background:#f3f4f6;">
          <th style="padding:8px 10px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">Worker</th>
          <th style="padding:8px 10px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">Division</th>
          <th style="padding:8px 10px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">Document</th>
          <th style="padding:8px 10px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">Expiry</th>
          <th style="padding:8px 10px;text-align:right;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">Status</th>
        </tr></thead>
        <tbody>${rows.map(row).join('')}</tbody>
      </table>`;
  }
  const openLink = webAppUrl ? `<p style="margin-top:24px;"><a href="${webAppUrl}" style="background:#f59e0b;color:#0a0e1a;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px;">Open Workers Documentation</a></p>` : '';
  return table(`🔴 Expired — action needed`, expired, '#dc2626')
       + table(`🟡 Expiring within ${soonDays} days`, expiringSoon, '#d97706')
       + openLink;
}

function emailShell_(heading, inner) {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;max-width:720px;margin:0 auto;padding:24px;color:#111827;">
    <h1 style="font-size:18px;margin:0 0 6px;color:#0a0e1a;">Workers Documentation — Weekly Digest</h1>
    <p style="color:#6b7280;font-size:13px;margin:0 0 16px;">${escapeHtml_(heading)}</p>
    ${inner}
    <p style="color:#9ca3af;font-size:11px;margin-top:32px;border-top:1px solid #e5e7eb;padding-top:12px;">Auto-generated by Workers Documentation backend · ${escapeHtml_(todayLabel_())}</p>
  </div>`;
}

function startOfDayLocal_(d) {
  const tz = Session.getScriptTimeZone() || 'Asia/Kuala_Lumpur';
  const s = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  return parseDateLocal_(s);
}
function parseDateLocal_(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function todayLabel_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Kuala_Lumpur', 'yyyy-MM-dd');
}
function escapeHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ===================== TRIGGER INSTALLER ===================== */
/**
 * Run this ONCE from the Apps Script editor to install the weekly trigger.
 * Default: every Monday 07:00 (script timezone, Asia/Kuala_Lumpur).
 */
function installWeeklyTrigger() {
  requireDomain_();
  // Clean up any existing trigger for this function so we don't double-fire.
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'sendExpiryDigest') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendExpiryDigest')
    .timeBased()
    .everyWeeks(1)
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(7)
    .create();
  return { installed: true, function: 'sendExpiryDigest', schedule: 'Every Monday 07:00 MYT' };
}

function listTriggers() {
  return ScriptApp.getProjectTriggers().map(t => ({
    fn: t.getHandlerFunction(),
    type: String(t.getEventType()),
    source: String(t.getTriggerSource()),
  }));
}

/* ===================== DEV / TEST ===================== */
function _resetAllSheets_DANGER() {
  // Manual cleanup helper — only run from the Apps Script editor.
  const ss = ss_();
  Object.keys(HEADERS).forEach(name => {
    const s = ss.getSheetByName(name);
    if (s) ss.deleteSheet(s);
  });
  ensureSheets_();
}
