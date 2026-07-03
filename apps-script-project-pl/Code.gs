/**
 * Black Lee - Project Revenue vs Expenses (v2.0)
 *
 * v2.0 adds:
 *   - Master lists: Clients, Buildings, Subcons, Suppliers, MaterialItems
 *   - Lookups sheet: Category, ProjectStatus, JobStatus, ClientPaymentStatus,
 *                    JobScopeUnit, MaterialUnit  (all add/edit/delete from UI)
 *   - Supervisor on Projects
 *   - Subcon invoice URL on JobScopes
 *   - Supplier invoice URL on Materials
 *   - Slip URLs on Client / Subcon / Supplier payments
 *   - Supplier Payments (money out) — new sheet
 *   - SubconCharges (lump-sum subcon arrangements over multiple scopes)
 *   - Cascade safety: deleting a master record is blocked if referenced
 *
 * Backwards-compatible with v1: existing columns kept; new columns appended
 * via ensureSheets_; defaults seeded only when Lookups sheet is empty.
 */

/* ===================== CONFIG ===================== */
const ALLOWED_DOMAIN = 'hggroup.com.my';

// Bootstrap admin: ALWAYS treated as Admin regardless of UserRoles sheet.
// Keeps the owner from being accidentally locked out. Add more emails if you
// want a backup admin from day one.
const BOOTSTRAP_ADMINS = ['lee@hggroup.com.my'];

/* ===================== ROLES & PERMISSIONS =====================
 * 4 roles:
 *   Admin   — full access, including user/role management
 *   Manager — everything except user/role management (day-to-day owner)
 *   Editor  — operations only: projects, scopes, materials, manpower, photos,
 *             daily reports, file uploads. CANNOT see money (payments, profit,
 *             margin, outstanding) or manage master lists / users.
 *   Viewer  — read-only on operational data, no money visibility, no edits.
 */
const ROLES = ['Admin', 'Manager', 'Editor', 'Viewer'];

const PERMS = {
  MANAGE_USERS:        'MANAGE_USERS',         // add/edit/delete UserRoles
  MANAGE_MASTER_LISTS: 'MANAGE_MASTER_LISTS',  // clients/buildings/subcons/suppliers/items/workers/supervisors/lookups
  DELETE_PROJECT:      'DELETE_PROJECT',
  EDIT_PROJECT:        'EDIT_PROJECT',         // create/edit Projects records (info, dates, etc.)
  EDIT_OPERATIONS:     'EDIT_OPERATIONS',      // job scopes, materials, manpower, photos, daily reports, lump charges
  EDIT_PAYMENTS:       'EDIT_PAYMENTS',        // client/subcon/supplier payments
  VIEW_MONEY:          'VIEW_MONEY',           // see profit/margin/outstanding/payments at all
  VIEW_AUDIT:          'VIEW_AUDIT',           // audit log panels
  UPLOAD_FILES:        'UPLOAD_FILES',         // upload files to Drive
};

const ROLE_PERMS = {
  Admin: [
    PERMS.MANAGE_USERS, PERMS.MANAGE_MASTER_LISTS,
    PERMS.DELETE_PROJECT, PERMS.EDIT_PROJECT, PERMS.EDIT_OPERATIONS, PERMS.EDIT_PAYMENTS,
    PERMS.VIEW_MONEY, PERMS.VIEW_AUDIT, PERMS.UPLOAD_FILES,
  ],
  Manager: [
    PERMS.MANAGE_MASTER_LISTS,
    PERMS.DELETE_PROJECT, PERMS.EDIT_PROJECT, PERMS.EDIT_OPERATIONS, PERMS.EDIT_PAYMENTS,
    PERMS.VIEW_MONEY, PERMS.VIEW_AUDIT, PERMS.UPLOAD_FILES,
  ],
  Editor: [
    PERMS.EDIT_PROJECT, PERMS.EDIT_OPERATIONS, PERMS.UPLOAD_FILES,
  ],
  Viewer: [],
};

function getUserRole_(email) {
  if (!email) return 'Viewer';
  const lower = String(email).toLowerCase();
  if (BOOTSTRAP_ADMINS.indexOf(lower) !== -1) return 'Admin';
  // Look up in UserRoles sheet
  try {
    const rows = readSheet_(SHEETS.USER_ROLES);
    const row = rows.find(r => String(r.email || '').toLowerCase() === lower);
    if (row && ROLES.indexOf(row.role) !== -1) return row.role;
  } catch (e) {
    console.warn('getUserRole_ readSheet failed:', e);
  }
  // Default: unknown @hggroup.com.my user is a Viewer
  return 'Viewer';
}

function permsForRole_(role) {
  return ROLE_PERMS[role] || [];
}

function hasPerm_(email, perm) {
  const role = getUserRole_(email);
  return permsForRole_(role).indexOf(perm) !== -1;
}

// Throws an Access denied error inside safeCall_ when the caller lacks the perm.
function requirePerm_(email, perm) {
  if (!hasPerm_(email, perm)) {
    const role = getUserRole_(email);
    throw new Error('Access denied. Your role "' + role + '" does not have permission "' + perm +
      '". Ask an Admin to update your access via Setup → User Roles.');
  }
}

const SHEETS = {
  PROJECTS:          'Projects',
  JOB_SCOPES:        'JobScopes',
  MATERIALS:         'Materials',
  CLIENT_PAYMENTS:   'ClientPayments',
  SUBCON_PAYMENTS:   'SubconPayments',
  SUPPLIER_PAYMENTS: 'SupplierPayments',
  SUBCON_CHARGES:    'SubconCharges',
  DAILY_REPORTS:     'DailyReports',
  MANPOWER:          'Manpower',
  PROJECT_PHOTOS:    'ProjectPhotos',
  CREDIT_NOTES:      'CreditNotes',
  CLIENTS:           'Clients',
  BUILDINGS:         'Buildings',
  SUBCONS:           'Subcons',
  SUPPLIERS:         'Suppliers',
  MATERIAL_ITEMS:    'MaterialItems',
  DIVISIONS:         'Divisions',
  WORKERS:           'Workers',
  SUPERVISORS:       'Supervisors',
  LOOKUPS:           'Lookups',
  USER_ROLES:        'UserRoles',
  AUDIT:             'AuditLog',
};

const HEADERS = {
  Projects: [
    'id','code','category','subCategory','clientId','clientName',
    'buildingId','buildingName','address','lotNumber',
    'supervisorIds','supervisorName',
    'poNumber','invoiceNumber','invoiceDate','invoiceAmount','clientInvoiceUrl',
    'discount','adjustment','sstApplicable','sstRate',
    'parentProjectId',
    'startDate','endDate','durationDays','status','notes',
    'createdAt','createdBy','updatedAt','updatedBy'
  ],
  JobScopes: [
    'id','projectId','description','qty','unit',
    'clientRate','clientAmount',
    'performedBy',
    'subconId','subconName','subconRate','subconAmount',
    'divisionId','divisionName','internalCost',
    'costConfirmation',
    'subconInvoiceNumber','subconInvoiceDate','subconInvoiceUrl',
    'completionReportUrl','supportingDocsUrl',
    'jobStatus','clientPaymentStatus','notes',
    'createdAt','createdBy','updatedAt','updatedBy'
  ],
  Materials: [
    'id','projectId','jobScopeId',
    'itemId','itemName',
    'qty','unit','unitCost','totalCost',
    'supplierId','supplierName','poNumber',
    'invoiceNumber','invoiceDate','invoiceUrl',
    'deliveryOrderUrl','materialPhotosUrl','notes',
    'materialSource','chargedToSubconId','chargedToSubconName',
    'createdAt','createdBy','updatedAt','updatedBy'
  ],
  ClientPayments: [
    'id','projectId','paymentDate','amount','reference','slipUrl','notes',
    'createdAt','createdBy'
  ],
  SubconPayments: [
    'id','projectId','jobScopeId','subconId','subconName',
    'paymentDate','amount','reference','slipUrl','notes',
    'createdAt','createdBy'
  ],
  SupplierPayments: [
    'id','projectId','materialId','supplierId','supplierName',
    'paymentDate','amount','reference','slipUrl','notes',
    'createdAt','createdBy'
  ],
  SubconCharges: [
    'id','projectId','subconId','subconName','lumpAmount',
    'jobScopeIds','invoiceNumber','invoiceDate','invoiceUrl',
    'completionReportUrl','supportingDocsUrl','notes',
    'createdAt','createdBy','updatedAt','updatedBy'
  ],
  DailyReports: [
    'id','projectId','reportDate','title','reportUrl','notes',
    'createdAt','createdBy','updatedAt','updatedBy'
  ],
  Manpower: [
    'id','projectId','jobScopeId',
    'workerType',    // 'inhouse' or 'subcon'
    'workerId','workerName',
    'workDate','durationDays','rate','totalCost','notes',
    'createdAt','createdBy','updatedAt','updatedBy'
  ],
  ProjectPhotos: [
    'id','projectId','kind',  // 'before' or 'after'
    'photoUrl','caption','takenDate',
    'createdAt','createdBy','updatedAt','updatedBy'
  ],
  CreditNotes: [
    'id','projectId',
    'type',                  // 'credit' | 'refund'
    'creditNoteNumber','creditNoteDate','amount','reason','status',
    // Refund-only:
    'bankName','bankAccountName','bankAccountNumber','refundPaidDate',
    'creditNoteUrl','notes',
    'createdAt','createdBy','updatedAt','updatedBy'
  ],
  Workers: [
    'id','name','role','contactNumber','notes',
    'createdAt','createdBy','updatedAt','updatedBy'
  ],
  Supervisors: [
    'id','name','role','contactNumber','notes',
    'createdAt','createdBy','updatedAt','updatedBy'
  ],
  Clients: [
    'id','name','contactPerson','contactNumber','email','address','notes',
    'createdAt','createdBy','updatedAt','updatedBy'
  ],
  Buildings: [
    'id','name','address','notes',
    'createdAt','createdBy','updatedAt','updatedBy'
  ],
  Subcons: [
    'id','name','trade','contactPerson','contactNumber','notes',
    'createdAt','createdBy','updatedAt','updatedBy'
  ],
  Suppliers: [
    'id','name','category','contactPerson','contactNumber','address','notes',
    'createdAt','createdBy','updatedAt','updatedBy'
  ],
  MaterialItems: [
    'id','name','defaultUnit','notes',
    'createdAt','createdBy','updatedAt','updatedBy'
  ],
  Divisions: [
    'id','name','head','contactNumber','notes',
    'createdAt','createdBy','updatedAt','updatedBy'
  ],
  Lookups: [
    'id','type','value','sortOrder',
    'createdAt','createdBy','updatedAt','updatedBy'
  ],
  UserRoles: [
    'id','email','role','notes',
    'createdAt','createdBy','updatedAt','updatedBy'
  ],
  AuditLog: ['timestamp','userEmail','action','recordType','recordId','details'],
};

// Lookup types
const LOOKUP_TYPES = [
  'Category',
  'SubCategory',
  'ProjectStatus',
  'JobStatus',
  'ClientPaymentStatus',
  'JobScopeUnit',
  'MaterialUnit',
];

// Default seed values (only if Lookups sheet is empty after ensure)
const LOOKUP_DEFAULTS = {
  Category: [
    'Hoarding','Visual Print & Install','Scaffold',
    'Temporary Storage Rental','Reinstatement','Fit-Out',
    'In-House Building Maintenance',
  ],
  SubCategory:          ['Upgrading','Repair','Replacement','New'],
  ProjectStatus:        ['Quoted','Active','Completed','On Hold','Cancelled'],
  JobStatus:            ['Not Started','In Progress','Completed','On Hold','Cancelled'],
  ClientPaymentStatus:  ['Unbilled','Invoiced','Partially Paid','Fully Paid','Overdue'],
  JobScopeUnit:         ['lm','sqm','lot','pc','nos','cum','set','day'],
  MaterialUnit:         ['pcs','sqm','kg','m','lm','box','roll','litre','bag'],
};

/* ===================== ENTRY ===================== */
function doGet(e) {
  const email = currentUserEmail_();
  if (!email.endsWith('@' + ALLOWED_DOMAIN)) {
    return HtmlService.createHtmlOutput(
      '<div style="font-family:sans-serif;padding:40px;max-width:600px;">' +
        '<h2>Access denied</h2>' +
        '<p>This tool is restricted to <b>@' + ALLOWED_DOMAIN + '</b> Google Workspace accounts.</p>' +
        '<p>You are signed in as: <code>' + (email || '(unknown)') + '</code></p>' +
      '</div>'
    );
  }
  try { ensureSheets_(); seedLookupsIfEmpty_(); }
  catch (err) { console.error('ensureSheets_/seed failed in doGet:', err); }
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Black Lee — Project Revenue vs Expenses')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ===================== AUTH ===================== */
function currentUserEmail_() {
  try { const a = Session.getActiveUser().getEmail(); if (a) return a.toLowerCase(); }
  catch (e) { console.warn('getActiveUser failed:', e); }
  try { const ef = Session.getEffectiveUser().getEmail(); if (ef) return ef.toLowerCase(); }
  catch (e) { console.warn('getEffectiveUser failed:', e); }
  return '';
}

function safeCall_(label, fn) {
  console.log('[' + label + '] start');
  try {
    const email = currentUserEmail_();
    if (!email.endsWith('@' + ALLOWED_DOMAIN)) {
      return { __serverError:
        'Access denied. You are signed in as "' + (email || 'unknown') +
        '". Only @' + ALLOWED_DOMAIN + ' accounts are allowed.' };
    }
    const result = fn(email);
    console.log('[' + label + '] OK');
    if (result == null) return { __serverError: '[' + label + '] returned no value.' };
    return result;
  } catch (err) {
    const msg = (err && err.message) ? err.message : String(err);
    console.error('[' + label + '] FAILED:', (err && err.stack) || msg);
    return { __serverError: '[' + label + '] ' + msg };
  }
}

/* ===================== SHEET HELPERS ===================== */
function ss_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No bound spreadsheet found. Open via Extensions → Apps Script from a Google Sheet.');
  return ss;
}

function ensureSheets_() {
  const ss = ss_();
  Object.keys(HEADERS).forEach(name => {
    let sheet = ss.getSheetByName(name);
    const expected = HEADERS[name];
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.appendRow(expected);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, expected.length).setFontWeight('bold');
    } else {
      const lastCol = Math.max(1, sheet.getLastColumn());
      const current = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      const empty = current.every(v => v === '' || v === null);
      if (empty) {
        sheet.getRange(1, 1, 1, expected.length).setValues([expected]);
        sheet.setFrozenRows(1);
        sheet.getRange(1, 1, 1, expected.length).setFontWeight('bold');
      } else {
        // append any missing columns
        const missing = expected.filter(h => current.indexOf(h) === -1);
        if (missing.length) {
          const startCol = lastCol + 1;
          sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
          sheet.getRange(1, startCol, 1, missing.length).setFontWeight('bold');
        }
      }
    }
  });
  const def = ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() <= 1 && def.getLastColumn() <= 1 && ss.getSheets().length > 1) {
    ss.deleteSheet(def);
  }
}

function seedLookupsIfEmpty_() {
  const sheet = ss_().getSheetByName(SHEETS.LOOKUPS);
  if (!sheet) return;
  if (sheet.getLastRow() > 1) return; // already has data
  const rows = [];
  const email = currentUserEmail_() || 'system';
  const ts = nowIso_();
  Object.keys(LOOKUP_DEFAULTS).forEach(type => {
    LOOKUP_DEFAULTS[type].forEach((v, idx) => {
      rows.push([uid_(), type, v, idx + 1, ts, email, ts, email]);
    });
  });
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, HEADERS.Lookups.length).setValues(rows);
  }
}

function readSheet_(name) {
  const sheet = ss_().getSheetByName(name);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const values  = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  return values
    .filter(row => row.some(v => v !== '' && v !== null))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        if (!h) return;
        const v = row[i];
        obj[h] = (v instanceof Date) ? v.toISOString() : v;
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

// Read the live sheet's header row — NOT the in-code HEADERS constant.
// This matters during schema upgrades, where ensureSheets_ appends missing
// columns at the end (preserving existing data) but the in-code HEADERS
// order may have new columns inserted in the middle. Writes must always
// match the SHEET'S column order, not the constant's.
function actualHeaders_(name) {
  const sheet = ss_().getSheetByName(name);
  if (!sheet) throw new Error('Sheet not found: ' + name);
  const lastCol = Math.max(1, sheet.getLastColumn());
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0];
}

function rowFromRecord_(name, rec) {
  return actualHeaders_(name).map(h => (h && rec[h] !== undefined) ? rec[h] : '');
}

function appendRecord_(name, rec) {
  ss_().getSheetByName(name).appendRow(rowFromRecord_(name, rec));
}

function updateRecord_(name, id, rec) {
  const row = findRowIndexById_(name, id);
  if (row < 2) throw new Error('Record not found: ' + name + '/' + id);
  const sheet = ss_().getSheetByName(name);
  const lastCol = Math.max(1, sheet.getLastColumn());
  sheet.getRange(row, 1, 1, lastCol).setValues([rowFromRecord_(name, rec)]);
}
function deleteRecordsById_(name, id) {
  const sheet = ss_().getSheetByName(name);
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const vals = sheet.getRange(2, 1, last - 1, 1).getValues();
  let deleted = 0;
  for (let i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][0]) === String(id)) {
      sheet.deleteRow(i + 2); deleted++;
    }
  }
  return deleted;
}
function deleteRecordsByField_(name, fieldName, value) {
  const sheet = ss_().getSheetByName(name);
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const colIdx = headers.indexOf(fieldName);
  if (colIdx < 0) return 0;
  const vals = sheet.getRange(2, 1, last - 1, lastCol).getValues();
  let deleted = 0;
  for (let i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][colIdx]) === String(value)) {
      sheet.deleteRow(i + 2); deleted++;
    }
  }
  return deleted;
}
function countRecordsByField_(name, fieldName, value) {
  const sheet = ss_().getSheetByName(name);
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const colIdx = headers.indexOf(fieldName);
  if (colIdx < 0) return 0;
  const vals = sheet.getRange(2, 1, last - 1, lastCol).getValues();
  let c = 0;
  vals.forEach(row => { if (String(row[colIdx]) === String(value)) c++; });
  return c;
}

/* ===================== UTILS ===================== */
function uid_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 12); }
function nowIso_() { return new Date().toISOString(); }
function num_(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function logAudit_(action, recordType, recordId, details) {
  try {
    const email = currentUserEmail_() || 'unknown';
    ss_().getSheetByName(SHEETS.AUDIT).appendRow([
      nowIso_(), email, action, recordType, recordId, details || '',
    ]);
  } catch (e) { console.error('logAudit_ failed:', e); }
}
function findById_(records, id) { return records.find(r => String(r.id) === String(id)); }

/* ===================== PUBLIC API ===================== */

function bootstrap() {
  return safeCall_('bootstrap', function (email) {
    ensureSheets_();
    seedLookupsIfEmpty_();
    const userRole  = getUserRole_(email);
    const userPerms = permsForRole_(userRole);
    const canManageUsers = userPerms.indexOf(PERMS.MANAGE_USERS) !== -1;
    return {
      email: email,
      userRole:  userRole,
      userPerms: userPerms,
      userRoles: canManageUsers ? readSheet_(SHEETS.USER_ROLES) : [],
      availableRoles: ROLES,
      isBootstrapAdmin: BOOTSTRAP_ADMINS.indexOf(String(email).toLowerCase()) !== -1,
      projects:         readSheet_(SHEETS.PROJECTS),
      jobScopes:        readSheet_(SHEETS.JOB_SCOPES),
      materials:        readSheet_(SHEETS.MATERIALS),
      clientPayments:   readSheet_(SHEETS.CLIENT_PAYMENTS),
      subconPayments:   readSheet_(SHEETS.SUBCON_PAYMENTS),
      supplierPayments: readSheet_(SHEETS.SUPPLIER_PAYMENTS),
      subconCharges:    readSheet_(SHEETS.SUBCON_CHARGES),
      dailyReports:     readSheet_(SHEETS.DAILY_REPORTS),
      manpower:         readSheet_(SHEETS.MANPOWER),
      projectPhotos:    readSheet_(SHEETS.PROJECT_PHOTOS),
      creditNotes:      readSheet_(SHEETS.CREDIT_NOTES),
      workers:          readSheet_(SHEETS.WORKERS),
      supervisors:      readSheet_(SHEETS.SUPERVISORS),
      clients:          readSheet_(SHEETS.CLIENTS),
      buildings:        readSheet_(SHEETS.BUILDINGS),
      subcons:          readSheet_(SHEETS.SUBCONS),
      suppliers:        readSheet_(SHEETS.SUPPLIERS),
      materialItems:    readSheet_(SHEETS.MATERIAL_ITEMS),
      divisions:        readSheet_(SHEETS.DIVISIONS),
      lookups:          readSheet_(SHEETS.LOOKUPS),
      lookupTypes:      LOOKUP_TYPES,
      audit:            recentAudit_(200),
    };
  });
}

function recentAudit_(limit) {
  // Read only the LAST N rows (huge audit logs were stalling bootstrap).
  const n = Math.min(Math.max(Number(limit)||200, 1), 1000);
  const sheet = ss_().getSheetByName(SHEETS.AUDIT);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  // Start row = max(2, lastRow - n + 1) → only the last N rows of data
  const startRow = Math.max(2, lastRow - n + 1);
  const numRows  = lastRow - startRow + 1;
  if (numRows <= 0) return [];
  const values = sheet.getRange(startRow, 1, numRows, lastCol).getValues();
  const out = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    if (!row.some(v => v !== '' && v !== null)) continue;
    const obj = {};
    headers.forEach((h, j) => {
      if (!h) return;
      const v = row[j];
      obj[h] = (v instanceof Date) ? v.toISOString() : v;
    });
    out.push(obj);
  }
  return out.reverse(); // newest first
}

function getAudit(limit) {
  return safeCall_('getAudit', function () { return recentAudit_(limit); });
}

// Return ALL audit entries (no truncation) whose recordId is in the given list.
// Used by Project Detail / Vendor screens so create-records older than the
// last-200 dashboard window are still visible.
function getAuditForRecords(recordIds) {
  return safeCall_('getAuditForRecords', function () {
    const ids = (recordIds || []).map(String).filter(Boolean);
    if (!ids.length) return [];
    const wanted = {};
    ids.forEach(id => { wanted[id] = true; });
    const sheet = ss_().getSheetByName(SHEETS.AUDIT);
    if (!sheet) return [];
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    const lastCol = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const values  = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    const recordIdCol = headers.indexOf('recordId');
    const out = [];
    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      if (recordIdCol >= 0 && !wanted[String(row[recordIdCol])]) continue;
      const obj = {};
      headers.forEach((h, j) => {
        if (!h) return;
        const v = row[j];
        obj[h] = (v instanceof Date) ? v.toISOString() : v;
      });
      out.push(obj);
    }
    return out.reverse(); // newest first
  });
}

function refreshAll() {
  return safeCall_('refreshAll', function () {
    return {
      projects:         readSheet_(SHEETS.PROJECTS),
      jobScopes:        readSheet_(SHEETS.JOB_SCOPES),
      materials:        readSheet_(SHEETS.MATERIALS),
      clientPayments:   readSheet_(SHEETS.CLIENT_PAYMENTS),
      subconPayments:   readSheet_(SHEETS.SUBCON_PAYMENTS),
      supplierPayments: readSheet_(SHEETS.SUPPLIER_PAYMENTS),
      subconCharges:    readSheet_(SHEETS.SUBCON_CHARGES),
      dailyReports:     readSheet_(SHEETS.DAILY_REPORTS),
      manpower:         readSheet_(SHEETS.MANPOWER),
      projectPhotos:    readSheet_(SHEETS.PROJECT_PHOTOS),
      creditNotes:      readSheet_(SHEETS.CREDIT_NOTES),
      workers:          readSheet_(SHEETS.WORKERS),
      supervisors:      readSheet_(SHEETS.SUPERVISORS),
      clients:          readSheet_(SHEETS.CLIENTS),
      buildings:        readSheet_(SHEETS.BUILDINGS),
      subcons:          readSheet_(SHEETS.SUBCONS),
      suppliers:        readSheet_(SHEETS.SUPPLIERS),
      materialItems:    readSheet_(SHEETS.MATERIAL_ITEMS),
      divisions:        readSheet_(SHEETS.DIVISIONS),
      lookups:          readSheet_(SHEETS.LOOKUPS),
      audit:            recentAudit_(200),
    };
  });
}

/* -------- PROJECTS -------- */
function saveProject(rec) {
  return safeCall_('saveProject', function (email) {
    requirePerm_(email, PERMS.EDIT_PROJECT);
    if (!rec) throw new Error('Missing project record.');
    // denormalize names from FK ids if provided
    if (rec.clientId)   { const c = findById_(readSheet_(SHEETS.CLIENTS),   rec.clientId);   if (c) rec.clientName   = c.name; }
    if (rec.buildingId) { const b = findById_(readSheet_(SHEETS.BUILDINGS), rec.buildingId); if (b) rec.buildingName = b.name; }
    // Supervisors: accept array OR pipe-joined string; denormalize names.
    if (rec.supervisorIds !== undefined) {
      const ids = Array.isArray(rec.supervisorIds)
        ? rec.supervisorIds
        : String(rec.supervisorIds || '').split('|').map(s => s.trim()).filter(Boolean);
      rec.supervisorIds = ids.join('|');
      if (ids.length) {
        const all = readSheet_(SHEETS.SUPERVISORS);
        const names = ids.map(id => {
          const s = all.find(x => String(x.id) === String(id));
          return s ? s.name : '';
        }).filter(Boolean);
        rec.supervisorName = names.join(' | ');
      } else if (!rec.supervisorName) {
        rec.supervisorName = '';
      }
    }
    // Invoice breakdown — coerce numbers, normalize SST flags
    rec.discount   = num_(rec.discount);
    rec.adjustment = num_(rec.adjustment);
    // sstApplicable comes in as boolean or 'true'/'false' string — store as boolean
    rec.sstApplicable = (rec.sstApplicable === true || rec.sstApplicable === 'true' || rec.sstApplicable === 1);
    rec.sstRate = num_(rec.sstRate);
    if (rec.sstApplicable && rec.sstRate <= 0) rec.sstRate = 6; // Malaysia SST default
    rec.updatedAt = nowIso_();
    rec.updatedBy = email;
    if (!rec.id) {
      rec.id = uid_();
      rec.createdAt = nowIso_();
      rec.createdBy = email;
      if (!rec.code) {
        if (rec.parentProjectId) {
          // Add-on: derive code from parent's code
          const parent = findById_(readSheet_(SHEETS.PROJECTS), rec.parentProjectId);
          rec.code = parent ? autoProjectCodeForAddon_(parent.code) : autoProjectCode_();
        } else {
          rec.code = autoProjectCode_();
        }
      }
      appendRecord_(SHEETS.PROJECTS, rec);
      logAudit_('create', 'Project', rec.id, rec.code || rec.clientName || '');
    } else {
      updateRecord_(SHEETS.PROJECTS, rec.id, rec);
      logAudit_('update', 'Project', rec.id, rec.code || rec.clientName || '');
    }
    return rec;
  });
}

function deleteProject(id) {
  return safeCall_('deleteProject', function (email) {
    requirePerm_(email, PERMS.DELETE_PROJECT);
    if (!id) throw new Error('Missing id.');
    deleteRecordsByField_(SHEETS.JOB_SCOPES,        'projectId', id);
    deleteRecordsByField_(SHEETS.MATERIALS,         'projectId', id);
    deleteRecordsByField_(SHEETS.CLIENT_PAYMENTS,   'projectId', id);
    deleteRecordsByField_(SHEETS.SUBCON_PAYMENTS,   'projectId', id);
    deleteRecordsByField_(SHEETS.SUPPLIER_PAYMENTS, 'projectId', id);
    deleteRecordsByField_(SHEETS.SUBCON_CHARGES,    'projectId', id);
    deleteRecordsByField_(SHEETS.DAILY_REPORTS,     'projectId', id);
    deleteRecordsByField_(SHEETS.MANPOWER,          'projectId', id);
    deleteRecordsByField_(SHEETS.PROJECT_PHOTOS,    'projectId', id);
    deleteRecordsByField_(SHEETS.CREDIT_NOTES,      'projectId', id);
    deleteRecordsById_(SHEETS.PROJECTS, id);
    logAudit_('delete', 'Project', id, 'cascade');
    return { ok: true };
  });
}

function autoProjectCode_() {
  const yyyymm = Utilities.formatDate(new Date(),
    Session.getScriptTimeZone() || 'Asia/Kuala_Lumpur', 'yyyyMM');
  const projects = readSheet_(SHEETS.PROJECTS);
  let max = 0;
  projects.forEach(p => {
    const m = String(p.code || '').match(/^PRJ-(\d{6})-(\d+)$/);
    if (m && m[1] === yyyymm) max = Math.max(max, parseInt(m[2], 10) || 0);
  });
  return 'PRJ-' + yyyymm + '-' + String(max + 1).padStart(3, '0');
}

// For add-on jobs: append next letter (A, B, C, ...) to the parent's code.
// Example: parent PRJ-202606-003 → first add-on PRJ-202606-003-A, second 003-B, etc.
function autoProjectCodeForAddon_(parentCode) {
  if (!parentCode) return autoProjectCode_();
  const projects = readSheet_(SHEETS.PROJECTS);
  const prefix = String(parentCode) + '-';
  let maxLetter = '@'; // ASCII just before 'A'
  projects.forEach(p => {
    const code = String(p.code || '');
    if (code.indexOf(prefix) === 0) {
      const suffix = code.substring(prefix.length);
      if (/^[A-Z]$/.test(suffix) && suffix > maxLetter) maxLetter = suffix;
    }
  });
  const next = String.fromCharCode(maxLetter.charCodeAt(0) + 1);
  // Cap at 'Z' — extremely unlikely a single job has 26+ add-ons, but be safe.
  return prefix + (next > 'Z' ? 'Z' + uid_().slice(0, 2) : next);
}

/* -------- JOB SCOPES -------- */
function saveJobScope(rec) {
  return safeCall_('saveJobScope', function (email) {
    requirePerm_(email, PERMS.EDIT_OPERATIONS);
    if (!rec) throw new Error('Missing job scope record.');
    if (!rec.projectId) throw new Error('Missing projectId on job scope.');
    // Performed-By: 'Subcon' (external) | 'InHouseTeam' (this project's crew)
    // | 'OtherDivision' (another HG division). Default = Subcon for back-compat.
    if (['Subcon','InHouseTeam','OtherDivision'].indexOf(rec.performedBy) === -1) {
      rec.performedBy = 'Subcon';
    }
    // Cost confirmation status: Confirmed (default) — actual invoice received.
    // Estimated — cost is a placeholder, awaiting invoice (e.g. monthly insurance bill).
    // Absorbed — cost covered elsewhere (e.g. mall annual insurance policy).
    // None — pure-margin line, no cost ever expected.
    if (['Confirmed','Estimated','Absorbed','None'].indexOf(rec.costConfirmation) === -1) {
      rec.costConfirmation = 'Confirmed';
    }
    if (rec.performedBy === 'Subcon') {
      if (rec.subconId) { const s = findById_(readSheet_(SHEETS.SUBCONS), rec.subconId); if (s) rec.subconName = s.name; }
      rec.divisionId = ''; rec.divisionName = ''; rec.internalCost = 0;
    } else if (rec.performedBy === 'OtherDivision') {
      if (rec.divisionId) { const d = findById_(readSheet_(SHEETS.DIVISIONS), rec.divisionId); if (d) rec.divisionName = d.name; }
      rec.subconId = ''; rec.subconName = ''; rec.subconRate = 0;
      rec.internalCost = num_(rec.internalCost);
    } else {
      // InHouseTeam — cost is captured in the Manpower section; nothing to denormalize here
      rec.subconId = ''; rec.subconName = ''; rec.subconRate = 0;
      rec.divisionId = ''; rec.divisionName = ''; rec.internalCost = 0;
    }
    rec.qty           = num_(rec.qty);
    rec.clientRate    = num_(rec.clientRate);
    rec.subconRate    = num_(rec.subconRate);
    // Lumpsum semantic: when qty is 0/empty but a rate is set, treat as qty=1 so the
    // rate IS the line amount. Avoids the "0 × 1800 = 0" confusion for lumpsum items.
    if (rec.qty <= 0 && (rec.clientRate > 0 || rec.subconRate > 0)) {
      rec.qty = 1;
    }
    rec.clientAmount  = +(rec.qty * rec.clientRate).toFixed(2);
    rec.subconAmount  = +(rec.qty * rec.subconRate).toFixed(2);
    rec.updatedAt = nowIso_();
    rec.updatedBy = email;
    if (!rec.id) {
      rec.id = uid_();
      rec.createdAt = nowIso_();
      rec.createdBy = email;
      appendRecord_(SHEETS.JOB_SCOPES, rec);
      logAudit_('create', 'JobScope', rec.id, rec.description || '');
    } else {
      updateRecord_(SHEETS.JOB_SCOPES, rec.id, rec);
      logAudit_('update', 'JobScope', rec.id, rec.description || '');
    }
    return rec;
  });
}

function deleteJobScope(id) {
  return safeCall_('deleteJobScope', function (email) {
    requirePerm_(email, PERMS.EDIT_OPERATIONS);
    if (!id) throw new Error('Missing id.');
    deleteRecordsByField_(SHEETS.MATERIALS,       'jobScopeId', id);
    deleteRecordsByField_(SHEETS.SUBCON_PAYMENTS, 'jobScopeId', id);
    // Note: SubconCharges store jobScopeIds as a list — strip this id out of any matching rows
    const charges = readSheet_(SHEETS.SUBCON_CHARGES);
    charges.forEach(c => {
      const ids = parseList_(c.jobScopeIds);
      if (ids.includes(id)) {
        c.jobScopeIds = ids.filter(x => x !== id).join('|');
        c.updatedAt = nowIso_();
        updateRecord_(SHEETS.SUBCON_CHARGES, c.id, c);
      }
    });
    deleteRecordsById_(SHEETS.JOB_SCOPES, id);
    logAudit_('delete', 'JobScope', id, 'cascade');
    return { ok: true };
  });
}
function parseList_(s) {
  if (!s) return [];
  return String(s).split('|').map(x => x.trim()).filter(Boolean);
}

/* -------- MATERIALS -------- */
function saveMaterial(rec) {
  return safeCall_('saveMaterial', function (email) {
    requirePerm_(email, PERMS.EDIT_OPERATIONS);
    if (!rec) throw new Error('Missing material record.');
    if (!rec.projectId) throw new Error('Missing projectId on material.');
    if (rec.itemId)     { const i = findById_(readSheet_(SHEETS.MATERIAL_ITEMS), rec.itemId);     if (i) rec.itemName     = i.name; }
    if (rec.supplierId) { const s = findById_(readSheet_(SHEETS.SUPPLIERS),      rec.supplierId); if (s) rec.supplierName = s.name; }
    // Material source: 'Supplier' (default — purchased from external supplier)
    // or 'InHouseSubcon' (HG factory stock sold to a subcon, deducted from subcon's bill).
    if (rec.materialSource !== 'InHouseSubcon') rec.materialSource = 'Supplier';
    if (rec.materialSource === 'InHouseSubcon') {
      rec.supplierId = '';
      rec.supplierName = '';
      if (rec.chargedToSubconId) {
        const s = findById_(readSheet_(SHEETS.SUBCONS), rec.chargedToSubconId);
        if (s) rec.chargedToSubconName = s.name;
      }
    } else {
      rec.chargedToSubconId = '';
      rec.chargedToSubconName = '';
    }
    rec.qty       = num_(rec.qty);
    rec.unitCost  = num_(rec.unitCost);
    rec.totalCost = +(rec.qty * rec.unitCost).toFixed(2);
    rec.updatedAt = nowIso_();
    rec.updatedBy = email;
    if (!rec.id) {
      rec.id = uid_();
      rec.createdAt = nowIso_();
      rec.createdBy = email;
      appendRecord_(SHEETS.MATERIALS, rec);
      logAudit_('create', 'Material', rec.id, rec.itemName || '');
    } else {
      updateRecord_(SHEETS.MATERIALS, rec.id, rec);
      logAudit_('update', 'Material', rec.id, rec.itemName || '');
    }
    return rec;
  });
}
function deleteMaterial(id) {
  return safeCall_('deleteMaterial', function (email) {
    requirePerm_(email, PERMS.EDIT_OPERATIONS);
    if (!id) throw new Error('Missing id.');
    deleteRecordsByField_(SHEETS.SUPPLIER_PAYMENTS, 'materialId', id);
    deleteRecordsById_(SHEETS.MATERIALS, id);
    logAudit_('delete', 'Material', id, '');
    return { ok: true };
  });
}

/* -------- PAYMENT HELPERS -------- */
function savePayment_(sheetName, type, rec) {
  return safeCall_('save' + type, function (email) {
    requirePerm_(email, PERMS.EDIT_PAYMENTS);
    if (!rec) throw new Error('Missing payment record.');
    if (!rec.projectId) throw new Error('Missing projectId.');
    rec.amount = num_(rec.amount);
    if (!rec.id) {
      rec.id = uid_();
      rec.createdAt = nowIso_();
      rec.createdBy = email;
      appendRecord_(sheetName, rec);
      logAudit_('create', type, rec.id, 'RM ' + rec.amount);
    } else {
      updateRecord_(sheetName, rec.id, rec);
      logAudit_('update', type, rec.id, 'RM ' + rec.amount);
    }
    return rec;
  });
}
function deletePayment_(sheetName, type, id) {
  return safeCall_('delete' + type, function (email) {
    requirePerm_(email, PERMS.EDIT_PAYMENTS);
    if (!id) throw new Error('Missing id.');
    deleteRecordsById_(sheetName, id);
    logAudit_('delete', type, id, '');
    return { ok: true };
  });
}

function saveClientPayment(rec)   { return savePayment_(SHEETS.CLIENT_PAYMENTS,   'ClientPayment',   rec); }
function deleteClientPayment(id)  { return deletePayment_(SHEETS.CLIENT_PAYMENTS, 'ClientPayment',   id); }

function saveSubconPayment(rec) {
  if (rec && rec.subconId) {
    const s = findById_(readSheet_(SHEETS.SUBCONS), rec.subconId);
    if (s) rec.subconName = s.name;
  }
  return savePayment_(SHEETS.SUBCON_PAYMENTS, 'SubconPayment', rec);
}
function deleteSubconPayment(id)  { return deletePayment_(SHEETS.SUBCON_PAYMENTS, 'SubconPayment',   id); }

function saveSupplierPayment(rec) {
  if (rec && rec.supplierId) {
    const s = findById_(readSheet_(SHEETS.SUPPLIERS), rec.supplierId);
    if (s) rec.supplierName = s.name;
  }
  return savePayment_(SHEETS.SUPPLIER_PAYMENTS, 'SupplierPayment', rec);
}
function deleteSupplierPayment(id){ return deletePayment_(SHEETS.SUPPLIER_PAYMENTS, 'SupplierPayment', id); }

/* -------- SUBCON CHARGES (lump-sum) -------- */
function saveSubconCharge(rec) {
  return safeCall_('saveSubconCharge', function (email) {
    requirePerm_(email, PERMS.EDIT_OPERATIONS);
    if (!rec) throw new Error('Missing subcon charge record.');
    if (!rec.projectId) throw new Error('Missing projectId.');
    if (rec.subconId) { const s = findById_(readSheet_(SHEETS.SUBCONS), rec.subconId); if (s) rec.subconName = s.name; }
    rec.lumpAmount = num_(rec.lumpAmount);
    // jobScopeIds expected as array — store pipe-joined
    if (Array.isArray(rec.jobScopeIds)) rec.jobScopeIds = rec.jobScopeIds.join('|');
    rec.updatedAt = nowIso_();
    rec.updatedBy = email;
    if (!rec.id) {
      rec.id = uid_();
      rec.createdAt = nowIso_();
      rec.createdBy = email;
      appendRecord_(SHEETS.SUBCON_CHARGES, rec);
      logAudit_('create', 'SubconCharge', rec.id, rec.subconName + ' RM ' + rec.lumpAmount);
    } else {
      updateRecord_(SHEETS.SUBCON_CHARGES, rec.id, rec);
      logAudit_('update', 'SubconCharge', rec.id, rec.subconName + ' RM ' + rec.lumpAmount);
    }
    return rec;
  });
}
function deleteSubconCharge(id) {
  return safeCall_('deleteSubconCharge', function (email) {
    requirePerm_(email, PERMS.EDIT_OPERATIONS);
    if (!id) throw new Error('Missing id.');
    deleteRecordsById_(SHEETS.SUBCON_CHARGES, id);
    logAudit_('delete', 'SubconCharge', id, '');
    return { ok: true };
  });
}

/* -------- DAILY REPORTS -------- */
function saveDailyReport(rec) {
  return safeCall_('saveDailyReport', function (email) {
    requirePerm_(email, PERMS.EDIT_OPERATIONS);
    if (!rec) throw new Error('Missing daily report record.');
    if (!rec.projectId) throw new Error('Missing projectId.');
    if (!rec.reportUrl) throw new Error('Report URL is required (paste Drive share link).');
    rec.updatedAt = nowIso_();
    rec.updatedBy = email;
    if (!rec.id) {
      rec.id = uid_();
      rec.createdAt = nowIso_();
      rec.createdBy = email;
      appendRecord_(SHEETS.DAILY_REPORTS, rec);
      logAudit_('create', 'DailyReport', rec.id, (rec.title || rec.reportDate || ''));
    } else {
      updateRecord_(SHEETS.DAILY_REPORTS, rec.id, rec);
      logAudit_('update', 'DailyReport', rec.id, (rec.title || rec.reportDate || ''));
    }
    return rec;
  });
}

function deleteDailyReport(id) {
  return safeCall_('deleteDailyReport', function (email) {
    requirePerm_(email, PERMS.EDIT_OPERATIONS);
    if (!id) throw new Error('Missing id.');
    deleteRecordsById_(SHEETS.DAILY_REPORTS, id);
    logAudit_('delete', 'DailyReport', id, '');
    return { ok: true };
  });
}

/* -------- MANPOWER -------- */
function saveManpower(rec) {
  return safeCall_('saveManpower', function (email) {
    requirePerm_(email, PERMS.EDIT_OPERATIONS);
    if (!rec) throw new Error('Missing manpower record.');
    if (!rec.projectId) throw new Error('Missing projectId.');
    // Denormalize worker name from FK
    if (rec.workerType === 'inhouse' && rec.workerId) {
      const w = findById_(readSheet_(SHEETS.WORKERS), rec.workerId);
      if (w) rec.workerName = w.name;
    } else if (rec.workerType === 'subcon' && rec.workerId) {
      const s = findById_(readSheet_(SHEETS.SUBCONS), rec.workerId);
      if (s) rec.workerName = s.name;
    }
    rec.durationDays = num_(rec.durationDays);
    rec.rate         = num_(rec.rate);
    rec.totalCost    = +(rec.durationDays * rec.rate).toFixed(2);
    rec.updatedAt = nowIso_();
    rec.updatedBy = email;
    if (!rec.id) {
      rec.id = uid_();
      rec.createdAt = nowIso_();
      rec.createdBy = email;
      appendRecord_(SHEETS.MANPOWER, rec);
      logAudit_('create', 'Manpower', rec.id, (rec.workerName || '') + ' · ' + rec.durationDays + 'd');
    } else {
      updateRecord_(SHEETS.MANPOWER, rec.id, rec);
      logAudit_('update', 'Manpower', rec.id, (rec.workerName || '') + ' · ' + rec.durationDays + 'd');
    }
    return rec;
  });
}
function deleteManpower(id) {
  return safeCall_('deleteManpower', function (email) {
    requirePerm_(email, PERMS.EDIT_OPERATIONS);
    if (!id) throw new Error('Missing id.');
    deleteRecordsById_(SHEETS.MANPOWER, id);
    logAudit_('delete', 'Manpower', id, '');
    return { ok: true };
  });
}

/* -------- PROJECT PHOTOS -------- */
function saveProjectPhoto(rec) {
  return safeCall_('saveProjectPhoto', function (email) {
    requirePerm_(email, PERMS.EDIT_OPERATIONS);
    if (!rec) throw new Error('Missing photo record.');
    if (!rec.projectId) throw new Error('Missing projectId.');
    if (!rec.photoUrl)  throw new Error('Missing photo URL.');
    if (!rec.kind) rec.kind = 'before';
    rec.updatedAt = nowIso_();
    rec.updatedBy = email;
    if (!rec.id) {
      rec.id = uid_();
      rec.createdAt = nowIso_();
      rec.createdBy = email;
      appendRecord_(SHEETS.PROJECT_PHOTOS, rec);
      logAudit_('create', 'ProjectPhoto', rec.id, rec.kind + ': ' + (rec.caption || ''));
    } else {
      updateRecord_(SHEETS.PROJECT_PHOTOS, rec.id, rec);
      logAudit_('update', 'ProjectPhoto', rec.id, rec.kind + ': ' + (rec.caption || ''));
    }
    return rec;
  });
}
function deleteProjectPhoto(id) {
  return safeCall_('deleteProjectPhoto', function (email) {
    requirePerm_(email, PERMS.EDIT_OPERATIONS);
    if (!id) throw new Error('Missing id.');
    deleteRecordsById_(SHEETS.PROJECT_PHOTOS, id);
    logAudit_('delete', 'ProjectPhoto', id, '');
    return { ok: true };
  });
}

/* -------- WORKERS (in-house staff) -------- */
function saveWorker(rec) { return saveMaster_(SHEETS.WORKERS, 'Worker', rec, 'name'); }
function deleteWorker(id) { return deleteMaster_(SHEETS.WORKERS, 'Worker', id, [
  { sheet: SHEETS.MANPOWER, field: 'workerId', label: 'manpower entry' }
]); }

/* -------- SUPERVISORS -------- */
function saveSupervisor(rec) { return saveMaster_(SHEETS.SUPERVISORS, 'Supervisor', rec, 'name'); }
function deleteSupervisor(id) {
  return safeCall_('deleteSupervisor', function () {
    if (!id) throw new Error('Missing id.');
    // supervisorIds on Projects is a pipe-joined string. Manual scan for membership.
    const projects = readSheet_(SHEETS.PROJECTS);
    let refs = 0;
    projects.forEach(p => {
      const ids = String(p.supervisorIds || '').split('|').map(s => s.trim()).filter(Boolean);
      if (ids.indexOf(String(id)) !== -1) refs++;
    });
    if (refs > 0) {
      throw new Error('Cannot delete: still referenced by ' + refs + ' project(s). Remove the supervisor from those projects first, or rename instead.');
    }
    deleteRecordsById_(SHEETS.SUPERVISORS, id);
    logAudit_('delete', 'Supervisor', id, '');
    return { ok: true };
  });
}

/* -------- DRIVE FILE UPLOAD (for drag-and-drop) --------
 * Uploads land in a per-project sub-folder of the master "ProjectPL_Photos" folder.
 * Folder name is built from Lot # and Building so each project's files stay together.
 */
function uploadFileToDrive(data) {
  return safeCall_('uploadFileToDrive', function (email) {
    requirePerm_(email, PERMS.UPLOAD_FILES);
    if (!data || !data.base64 || !data.name) throw new Error('Missing file data.');
    let folder = getOrCreateMasterFolder_();
    if (data.projectId) {
      const project = findById_(readSheet_(SHEETS.PROJECTS), data.projectId);
      if (project) folder = getOrCreateProjectFolder_(project);
    }
    const raw = String(data.base64).split(',').pop();
    const blob = Utilities.newBlob(Utilities.base64Decode(raw),
                                   data.mimeType || 'application/octet-stream',
                                   data.name);
    const file = folder.createFile(blob);
    try {
      file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (e) {
      console.warn('setSharing failed (file still uploaded):', e);
    }
    return { url: file.getUrl(), id: file.getId(), name: file.getName(), folder: folder.getName() };
  });
}

// Back-compat alias: existing client calls to uploadPhotoToDrive still work.
function uploadPhotoToDrive(data) { return uploadFileToDrive(data); }

function getOrCreateMasterFolder_() {
  // We can't call DriveApp.getFoldersByName under the narrow drive.file scope
  // (it requires drive.readonly / drive). Instead we cache the folder ID in
  // Script Properties once and access it directly via getFolderById, which
  // drive.file does allow for files the script itself created.
  const props = PropertiesService.getScriptProperties();
  const cachedId = props.getProperty('MASTER_FOLDER_ID');
  if (cachedId) {
    try { return DriveApp.getFolderById(cachedId); }
    catch (e) {
      console.warn('Cached MASTER_FOLDER_ID unreachable, will create a new folder:', e);
      props.deleteProperty('MASTER_FOLDER_ID');
    }
  }
  const folder = DriveApp.createFolder('ProjectPL_Photos');
  props.setProperty('MASTER_FOLDER_ID', folder.getId());
  try {
    folder.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) { console.warn('master folder setSharing failed:', e); }
  return folder;
}

function projectFolderName_(project) {
  const lot  = String(project.lotNumber   || '').trim();
  const bld  = String(project.buildingName || '').trim();
  const code = String(project.code        || '').trim();
  const parts = [];
  if (lot) parts.push('Lot ' + lot);
  if (bld) parts.push(bld);
  if (!parts.length) parts.push(code || 'Project-' + (project.id || 'unknown'));
  // Drive folder names cannot contain forward / backslash — replace with hyphen.
  return parts.join(' - ').replace(/[\/\\]/g, '-').slice(0, 200);
}

function getOrCreateProjectFolder_(project) {
  // Same drive.file constraint as the master folder — we can't search by
  // name. Per-project folder IDs are cached in Script Properties under the
  // key PROJECT_FOLDER_<projectId>. First call creates and caches; later
  // uploads for the same project reuse the cached ID via getFolderById.
  const props = PropertiesService.getScriptProperties();
  const key = 'PROJECT_FOLDER_' + project.id;
  const cachedId = props.getProperty(key);
  if (cachedId) {
    try { return DriveApp.getFolderById(cachedId); }
    catch (e) {
      console.warn('Cached project folder ID unreachable, creating fresh:', e);
      props.deleteProperty(key);
    }
  }
  const master = getOrCreateMasterFolder_();
  const folder = master.createFolder(projectFolderName_(project));
  props.setProperty(key, folder.getId());
  try {
    folder.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) { console.warn('project folder setSharing failed:', e); }
  return folder;
}

// Keep the old name callable in case anything else references it.
function getOrCreatePhotoFolder_() { return getOrCreateMasterFolder_(); }

/* -------- DRIVE FOLDER ADMIN HELPERS --------
 * Run these once from the Apps Script editor (Run menu) when migrating off the
 * old behaviour. They are NOT exposed via the web app — only the owner running
 * the editor can call them.
 */

// Point the script at an existing master folder (the one already containing
// your historical uploads). Right-click the folder in Drive → Get link, the
// last segment of the URL is the folder ID. Then in Apps Script:
//   adminSetMasterFolderId('1AbCdEfGhIjKlMnOp...')
// Reply value is the folder name (for sanity check).
function adminSetMasterFolderId(folderId) {
  if (!folderId) throw new Error('Pass the folder ID (the last segment of the Drive URL).');
  const folder = DriveApp.getFolderById(folderId);
  PropertiesService.getScriptProperties().setProperty('MASTER_FOLDER_ID', folderId);
  return 'OK — master folder now: ' + folder.getName() + ' (' + folderId + ')';
}

// Point the script at an existing per-project folder.
// adminSetProjectFolderId('PROJECT_ID_HERE', 'FOLDER_ID_HERE')
function adminSetProjectFolderId(projectId, folderId) {
  if (!projectId) throw new Error('Pass the project ID.');
  if (!folderId)  throw new Error('Pass the folder ID.');
  const folder = DriveApp.getFolderById(folderId);
  PropertiesService.getScriptProperties().setProperty('PROJECT_FOLDER_' + projectId, folderId);
  return 'OK — project ' + projectId + ' now uses folder: ' + folder.getName() + ' (' + folderId + ')';
}

// Force the Drive OAuth prompt. Running this once (after expanding the manifest
// scope from drive.file to drive) makes Google ask you to grant the broader
// scope. Once granted, the deployed web app's uploadFileToDrive will work.
// Returns the name of your Drive root folder as proof the scope is live.
function adminTriggerDriveAuth() {
  const root = DriveApp.getRootFolder();
  return 'Drive scope is now authorized. Root folder: ' + root.getName();
}

// Show what's currently cached (for debugging).
function adminShowDriveFolderState() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const out = {};
  Object.keys(props).forEach(k => {
    if (k.indexOf('MASTER_FOLDER_ID') === 0 || k.indexOf('PROJECT_FOLDER_') === 0) {
      out[k] = props[k];
    }
  });
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

// Wipe all cached IDs — the next upload will create fresh folders. Use only if
// folders were deleted in Drive or you want a clean reset.
function adminClearDriveFolderCache() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  let cleared = 0;
  Object.keys(all).forEach(k => {
    if (k === 'MASTER_FOLDER_ID' || k.indexOf('PROJECT_FOLDER_') === 0) {
      props.deleteProperty(k);
      cleared++;
    }
  });
  return 'Cleared ' + cleared + ' cached folder ID(s).';
}

/* -------- MASTER LIST GENERIC SAVE/DELETE -------- */
function saveMaster_(sheetName, type, rec, requireField) {
  return safeCall_('save' + type, function (email) {
    requirePerm_(email, PERMS.MANAGE_MASTER_LISTS);
    if (!rec) throw new Error('Missing ' + type + ' record.');
    if (requireField && !rec[requireField]) throw new Error(requireField + ' is required.');
    // Defensive: make sure the target sheet (and all schema sheets) exist before we write.
    ensureSheets_();
    rec.updatedAt = nowIso_();
    rec.updatedBy = email;
    if (!rec.id) {
      rec.id = uid_();
      rec.createdAt = nowIso_();
      rec.createdBy = email;
      appendRecord_(sheetName, rec);
      logAudit_('create', type, rec.id, rec[requireField] || '');
    } else {
      updateRecord_(sheetName, rec.id, rec);
      logAudit_('update', type, rec.id, rec[requireField] || '');
    }
    return rec;
  });
}

function deleteMaster_(sheetName, type, id, referencedBy) {
  return safeCall_('delete' + type, function (email) {
    requirePerm_(email, PERMS.MANAGE_MASTER_LISTS);
    if (!id) throw new Error('Missing id.');
    // block delete if referenced
    for (const ref of (referencedBy || [])) {
      const c = countRecordsByField_(ref.sheet, ref.field, id);
      if (c > 0) {
        throw new Error('Cannot delete: still referenced by ' + c + ' ' + ref.label +
                        ' record(s). Edit those records first, or rename this entry.');
      }
    }
    deleteRecordsById_(sheetName, id);
    logAudit_('delete', type, id, '');
    return { ok: true };
  });
}

function saveClient(rec)     { return saveMaster_(SHEETS.CLIENTS,   'Client',   rec, 'name'); }
function deleteClient(id)    { return deleteMaster_(SHEETS.CLIENTS, 'Client',   id, [
  { sheet: SHEETS.PROJECTS, field: 'clientId', label: 'project' }
]); }

function saveBuilding(rec)   { return saveMaster_(SHEETS.BUILDINGS, 'Building', rec, 'name'); }
function deleteBuilding(id)  { return deleteMaster_(SHEETS.BUILDINGS, 'Building', id, [
  { sheet: SHEETS.PROJECTS, field: 'buildingId', label: 'project' }
]); }

function saveSubcon(rec)     { return saveMaster_(SHEETS.SUBCONS,   'Subcon',   rec, 'name'); }
function deleteSubcon(id)    { return deleteMaster_(SHEETS.SUBCONS, 'Subcon',   id, [
  { sheet: SHEETS.JOB_SCOPES,      field: 'subconId', label: 'job scope' },
  { sheet: SHEETS.SUBCON_PAYMENTS, field: 'subconId', label: 'subcon payment' },
  { sheet: SHEETS.SUBCON_CHARGES,  field: 'subconId', label: 'lump-sum charge' },
]); }

function saveSupplier(rec)   { return saveMaster_(SHEETS.SUPPLIERS, 'Supplier', rec, 'name'); }
function deleteSupplier(id)  { return deleteMaster_(SHEETS.SUPPLIERS, 'Supplier', id, [
  { sheet: SHEETS.MATERIALS,         field: 'supplierId', label: 'material' },
  { sheet: SHEETS.SUPPLIER_PAYMENTS, field: 'supplierId', label: 'supplier payment' },
]); }

function saveMaterialItem(rec)  { return saveMaster_(SHEETS.MATERIAL_ITEMS, 'MaterialItem', rec, 'name'); }
function deleteMaterialItem(id) { return deleteMaster_(SHEETS.MATERIAL_ITEMS, 'MaterialItem', id, [
  { sheet: SHEETS.MATERIALS, field: 'itemId', label: 'material' }
]); }

function saveDivision(rec)   { return saveMaster_(SHEETS.DIVISIONS, 'Division', rec, 'name'); }
function deleteDivision(id)  { return deleteMaster_(SHEETS.DIVISIONS, 'Division', id, [
  { sheet: SHEETS.JOB_SCOPES, field: 'divisionId', label: 'job scope' },
]); }

/* -------- LOOKUPS (Category, ProjectStatus, JobStatus, etc.) -------- */
function saveLookup(rec) {
  return safeCall_('saveLookup', function (email) {
    requirePerm_(email, PERMS.MANAGE_MASTER_LISTS);
    if (!rec) throw new Error('Missing lookup record.');
    if (!rec.type)  throw new Error('type is required.');
    if (!rec.value) throw new Error('value is required.');
    if (LOOKUP_TYPES.indexOf(rec.type) < 0) throw new Error('Unknown lookup type: ' + rec.type);
    rec.sortOrder = num_(rec.sortOrder);
    rec.updatedAt = nowIso_();
    rec.updatedBy = email;
    if (!rec.id) {
      rec.id = uid_();
      rec.createdAt = nowIso_();
      rec.createdBy = email;
      appendRecord_(SHEETS.LOOKUPS, rec);
      logAudit_('create', 'Lookup', rec.id, rec.type + ': ' + rec.value);
    } else {
      updateRecord_(SHEETS.LOOKUPS, rec.id, rec);
      logAudit_('update', 'Lookup', rec.id, rec.type + ': ' + rec.value);
    }
    return rec;
  });
}
function deleteLookup(id) {
  return safeCall_('deleteLookup', function (email) {
    requirePerm_(email, PERMS.MANAGE_MASTER_LISTS);
    if (!id) throw new Error('Missing id.');
    // soft check: warn if value is referenced. For lookups we identify by VALUE not id
    // (Projects.status stores the string "Active", not the lookup id).
    // So we read the row to find its value first.
    const lookups = readSheet_(SHEETS.LOOKUPS);
    const target = findById_(lookups, id);
    if (!target) throw new Error('Lookup not found.');
    // map type -> [{sheet, field, label}]
    const refMap = {
      Category:            [{ sheet: SHEETS.PROJECTS, field: 'category', label: 'project' }],
      ProjectStatus:       [{ sheet: SHEETS.PROJECTS, field: 'status',   label: 'project' }],
      JobStatus:           [{ sheet: SHEETS.JOB_SCOPES, field: 'jobStatus', label: 'job scope' }],
      ClientPaymentStatus: [{ sheet: SHEETS.JOB_SCOPES, field: 'clientPaymentStatus', label: 'job scope' }],
      JobScopeUnit:        [{ sheet: SHEETS.JOB_SCOPES, field: 'unit', label: 'job scope' }],
      MaterialUnit:        [{ sheet: SHEETS.MATERIALS, field: 'unit', label: 'material' }],
    };
    const refs = refMap[target.type] || [];
    for (const r of refs) {
      const c = countRecordsByField_(r.sheet, r.field, target.value);
      if (c > 0) {
        throw new Error('Cannot delete: "' + target.value + '" still used by ' + c + ' ' + r.label + ' record(s).');
      }
    }
    deleteRecordsById_(SHEETS.LOOKUPS, id);
    logAudit_('delete', 'Lookup', id, target.type + ': ' + target.value);
    return { ok: true };
  });
}

/* -------- USER ROLES (Admin only) -------- */
function saveUserRole(rec) {
  return safeCall_('saveUserRole', function (email) {
    requirePerm_(email, PERMS.MANAGE_USERS);
    if (!rec) throw new Error('Missing user role record.');
    if (!rec.email) throw new Error('Email is required.');
    if (ROLES.indexOf(rec.role) === -1) throw new Error('Invalid role: ' + rec.role + '. Must be one of ' + ROLES.join(', '));
    rec.email = String(rec.email).toLowerCase().trim();
    // Block setting role for the same record's email differently to a bootstrap admin
    if (BOOTSTRAP_ADMINS.indexOf(rec.email) !== -1 && rec.role !== 'Admin') {
      throw new Error('Cannot demote a bootstrap admin (' + rec.email + ') — their Admin role is hardcoded.');
    }
    // De-dup: if updating, allow; if creating and email already exists, refuse
    const existing = readSheet_(SHEETS.USER_ROLES);
    const dupe = existing.find(r => r.email === rec.email && r.id !== rec.id);
    if (dupe) throw new Error('A role already exists for ' + rec.email + '. Edit that row instead.');
    rec.updatedAt = nowIso_();
    rec.updatedBy = email;
    if (!rec.id) {
      rec.id = uid_();
      rec.createdAt = nowIso_();
      rec.createdBy = email;
      appendRecord_(SHEETS.USER_ROLES, rec);
      logAudit_('create', 'UserRole', rec.id, rec.email + ' → ' + rec.role);
    } else {
      updateRecord_(SHEETS.USER_ROLES, rec.id, rec);
      logAudit_('update', 'UserRole', rec.id, rec.email + ' → ' + rec.role);
    }
    return rec;
  });
}

/* -------- CREDIT NOTES / REFUNDS -------- */
function saveCreditNote(rec) {
  return safeCall_('saveCreditNote', function (email) {
    requirePerm_(email, PERMS.EDIT_PAYMENTS);
    if (!rec) throw new Error('Missing credit note record.');
    if (!rec.projectId) throw new Error('Missing projectId.');
    if (rec.type !== 'credit' && rec.type !== 'refund') {
      throw new Error('Type must be either "credit" or "refund".');
    }
    rec.amount = num_(rec.amount);
    if (rec.amount <= 0) throw new Error('Amount must be greater than 0.');
    // Refund validation: bank details + paid date required
    if (rec.type === 'refund') {
      if (!rec.bankName)          throw new Error('Refund requires Bank Name.');
      if (!rec.bankAccountName)   throw new Error('Refund requires Bank Account Name.');
      if (!rec.bankAccountNumber) throw new Error('Refund requires Bank Account Number.');
    } else {
      // Credit type: clear refund-only fields so they don't linger
      rec.bankName = '';
      rec.bankAccountName = '';
      rec.bankAccountNumber = '';
      rec.refundPaidDate = '';
    }
    if (!rec.status) rec.status = (rec.type === 'refund') ? 'Pending' : 'Issued';
    rec.updatedAt = nowIso_();
    rec.updatedBy = email;
    if (!rec.id) {
      rec.id = uid_();
      rec.createdAt = nowIso_();
      rec.createdBy = email;
      appendRecord_(SHEETS.CREDIT_NOTES, rec);
      logAudit_('create', 'CreditNote', rec.id,
        rec.type + ' RM ' + rec.amount + (rec.creditNoteNumber ? ' (' + rec.creditNoteNumber + ')' : ''));
    } else {
      updateRecord_(SHEETS.CREDIT_NOTES, rec.id, rec);
      logAudit_('update', 'CreditNote', rec.id, rec.type + ' RM ' + rec.amount);
    }
    return rec;
  });
}

function deleteCreditNote(id) {
  return safeCall_('deleteCreditNote', function (email) {
    requirePerm_(email, PERMS.EDIT_PAYMENTS);
    if (!id) throw new Error('Missing id.');
    deleteRecordsById_(SHEETS.CREDIT_NOTES, id);
    logAudit_('delete', 'CreditNote', id, '');
    return { ok: true };
  });
}

function deleteUserRole(id) {
  return safeCall_('deleteUserRole', function (email) {
    requirePerm_(email, PERMS.MANAGE_USERS);
    if (!id) throw new Error('Missing id.');
    const all = readSheet_(SHEETS.USER_ROLES);
    const target = all.find(r => String(r.id) === String(id));
    if (target && BOOTSTRAP_ADMINS.indexOf(String(target.email).toLowerCase()) !== -1) {
      throw new Error('Cannot delete a bootstrap admin (' + target.email + ').');
    }
    deleteRecordsById_(SHEETS.USER_ROLES, id);
    logAudit_('delete', 'UserRole', id, target ? target.email : '');
    return { ok: true };
  });
}
