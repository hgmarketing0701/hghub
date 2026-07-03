/**
 * Black Lee — Visual Works Control (Cloud v1)
 * Google Apps Script backend, served as a Workspace-restricted web app.
 *
 * Purpose: one place to run the Visual print & install subcon (B) end-to-end —
 *          job orders, panel measurements → sqft, rate cards per mall/material,
 *          work permits, B's worker docs, and B's invoice reconciliation so a
 *          measurement/installation dispute is checked in seconds, not days.
 *
 * Storage: the Google Sheet this script is bound to (container-bound script).
 * Drive:   parent folder "Black Lee — Visual Works"; subfolders for artwork
 *          proofs, completion photos, permits, worker docs, and B's invoices.
 * Auth:    Workspace domain restriction in appsscript.json + per-call guard.
 *          Every write is stamped with the signed-in email in AuditLog.
 *
 * Source of truth: HG records the job + measurement. That figure is
 *          authoritative. B's invoice is checked AGAINST it — never the reverse.
 */

/* ===================== CONFIG ===================== */
const ALLOWED_DOMAIN = 'hggroup.com.my';
const PARENT_FOLDER_NAME = 'Black Lee — Visual Works';
const SST_RATE = 0.06;

/* Invoice reconciliation tolerance. A job is flagged "VARIANCE" when B's
 * claimed amount differs from the HG-recorded amount by more than BOTH of
 * these (so tiny rounding doesn't nag). */
const RECON_TOL_RM = 5.00;     // absolute RM
const RECON_TOL_PCT = 0.01;    // 1%

/* Permit early-warning window: a permit is "EXPIRING" this many days out. */
const PERMIT_WARN_DAYS = 14;

/* Worker document early-warning window (passport / permit / insurance expiry). */
const DOC_WARN_DAYS = 30;

const SUBFOLDERS = {
  ARTWORK:   'Artwork Proofs',
  PHOTOS:    'Completion Photos',
  PERMITS:   'Work Permits',
  WORKERS:   'Worker Docs',
  INVOICES:  'B Invoices',
};

const SHEETS = {
  JOBS:     'Jobs',
  PANELS:   'JobPanels',
  RATES:    'Rates',
  MALLS:    'Malls',
  MATERIALS:'Materials',
  PERMITS:  'Permits',
  WORKERS:  'Workers',
  INVOICES: 'Invoices',
  INVJOBS:  'InvoiceJobs',
  AUDIT:    'AuditLog',
};

const HEADERS = {
  Jobs: [
    'id','jobNo','status','mall','lotNo','jobType','client','requestedBy',
    'requestDate','installDate','completedDate',
    'artworkLink','artworkProofUrl','sketchUrl','sitePhotosUrl','photosUrl','folderUrl',
    'material','totalSqft','rateId','ratePerSqft','installRate',
    'subtotal','expectedAmount',
    'permitId','proceedBy','proceedAt','notes','createdAt','createdBy','updatedAt',
  ],
  JobPanels: [
    'id','jobId','label','widthVal','heightVal','unit','qty','sqft',
    'material','ratePerSqft','amount',
  ],
  Rates: [
    'id','mall','material','jobType','ratePerSqft','installRate','minCharge',
    'effectiveFrom','notes','updatedAt','updatedBy','packageRate',
  ],
  Malls: ['id','name','notes','updatedAt'],
  Materials: ['id','name','notes','updatedAt'],
  Permits: [
    'id','mall','lotNo','permitType','permitNo','validFrom','validTo',
    'fileUrl','fileId','notes','createdAt','createdBy',
  ],
  Workers: [
    'id','name','role','phone',
    'icNo','icFileUrl','icFileId',
    'cidbNo','cidbExpiry','cidbFileUrl','cidbFileId',
    'wahNo','wahExpiry','wahFileUrl','wahFileId',
    'docType','docNo','docExpiry','docUrl','docFileId',
    'status','notes','updatedAt','updatedBy',
  ],
  Invoices: [
    'id','invNo','invDate','period','malls','claimedAmount','sstEnabled',
    'sstAmount','claimedTotal','fileUrl','fileId','status','reconVerdict',
    'reconNote','notes','createdAt','createdBy','updatedAt',
  ],
  InvoiceJobs: [
    'id','invoiceId','jobId','claimedSqft','claimedAmount',
    'recordedSqft','recordedAmount','varianceRm','flag',
  ],
  AuditLog: ['timestamp','userEmail','action','recordType','recordId','details'],
};

const PROPS = PropertiesService.getScriptProperties();
const PROP_KEYS = { PARENT_FOLDER_ID: 'PARENT_FOLDER_ID' };

/* Lifecycle — mirrors the WhatsApp flow exactly. */
const STATUSES = [
  'NEW',              // job order sent to B (sketch + lot + mall + install date + artwork)
  'DRAFT_IN',         // B sent draft back, tagged HG requestor
  'SENT_CLIENT',      // HG sent draft to client for approval
  'ARTWORK_REJECTED', // pixelated / missing font / outline — request new file from client
  'APPROVED',         // client approved → the "PROCEED" magic word given
  'PRINTING',         // B printing, standby install
  'INSTALLED',        // installed on site
  'COMPLETED',        // B shared completion photos + remarks; closed
  'CANCELLED',
];

const UNITS = ['mm', 'cm', 'm', 'in', 'ft'];
const JOB_TYPES = ['print_install', 'print_only', 'install_only'];
function normType_(t) { return JOB_TYPES.indexOf(String(t)) >= 0 ? String(t) : 'print_install'; }

/* ===================== ENTRY ===================== */
function doGet(e) {
  const email = (Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email.endsWith('@' + ALLOWED_DOMAIN)) {
    return HtmlService.createHtmlOutput(
      '<div style="font-family:sans-serif;padding:40px;max-width:600px;">' +
        '<h2>Access denied</h2>' +
        '<p>This tool is restricted to <b>@' + ALLOWED_DOMAIN + '</b> Google Workspace accounts.</p>' +
        '<p>You are signed in as: <code>' + (email || '(unknown)') + '</code></p>' +
        '<p>Sign in with your company account and reload.</p>' +
      '</div>'
    );
  }
  ensureSheets_();
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Black Lee — Visual Works')
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

/* ===================== SHEET HELPERS ===================== */
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function ensureSheets_() {
  const ss = ss_();
  Object.keys(HEADERS).forEach(function (name) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.appendRow(HEADERS[name]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, HEADERS[name].length).setFontWeight('bold');
    } else {
      // Self-heal the header row: rewrite the canonical labels so newly added
      // columns (e.g. packageRate) get their label even on an existing sheet.
      // Only touches row 1 — never the data rows below it.
      const firstRow = sheet.getRange(1, 1, 1, HEADERS[name].length).getValues()[0];
      const mismatch = HEADERS[name].some(function (h, i) { return String(firstRow[i] || '') !== h; });
      if (mismatch) {
        sheet.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]);
        sheet.setFrozenRows(1);
        sheet.getRange(1, 1, 1, HEADERS[name].length).setFontWeight('bold');
      }
    }
  });
  const def = ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() <= 1 && def.getLastColumn() <= 1 && ss.getSheets().length > 1) {
    ss.deleteSheet(def);
  }
}

function readSheet_(name) {
  const sheet = ss_().getSheetByName(name);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const headers = HEADERS[name];
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values
    .filter(function (row) { return row.some(function (v) { return v !== '' && v !== null; }); })
    .map(function (row) {
      const obj = {};
      headers.forEach(function (h, i) { obj[h] = row[i]; });
      return obj;
    });
}

function rowFromRecord_(name, rec) {
  return HEADERS[name].map(function (h) { return rec[h] === undefined ? '' : rec[h]; });
}

function appendRecord_(name, rec) {
  ss_().getSheetByName(name).appendRow(rowFromRecord_(name, rec));
}

/** Overwrite the single row whose id-column (col 1) matches rec.id. */
function updateRecord_(name, rec) {
  const sheet = ss_().getSheetByName(name);
  const last = sheet.getLastRow();
  if (last < 2) return false;
  const idCol = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < idCol.length; i++) {
    if (String(idCol[i][0]) === String(rec.id)) {
      sheet.getRange(i + 2, 1, 1, HEADERS[name].length).setValues([rowFromRecord_(name, rec)]);
      return true;
    }
  }
  return false;
}

/** Delete every row whose column-`col` value is in `ids`. col is 1-based. */
function deleteRowsWhere_(name, col, ids) {
  const sheet = ss_().getSheetByName(name);
  if (!sheet) return 0;
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const vals = sheet.getRange(2, col, last - 1, 1).getValues();
  let removed = 0;
  for (let i = vals.length - 1; i >= 0; i--) {
    if (ids.indexOf(String(vals[i][0])) >= 0) {
      sheet.deleteRow(i + 2);
      removed++;
    }
  }
  return removed;
}

/* ===================== UTILS ===================== */
function uid_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 12); }
function nowIso_() { return new Date().toISOString(); }
function tz_() { return Session.getScriptTimeZone() || 'Asia/Kuala_Lumpur'; }
function todayISO_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }
function dateStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  return String(v == null ? '' : v);
}
function str_(v) { return (v instanceof Date) ? dateStr_(v) : String(v == null ? '' : v); }
function num_(v) { return Number(v) || 0; }
function bool_(v) { return v === true || v === 'true' || v === 'TRUE' || v === 1 || v === '1'; }
function round2_(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function round3_(n) { return Math.round((Number(n) || 0) * 1000) / 1000; }
function money_(n) {
  return (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function safeFilename_(s) {
  return String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}
function stripDataUrl_(b64) {
  const s = String(b64 || '');
  const m = s.match(/^data:[^;]+;base64,(.*)$/);
  return m ? m[1] : s;
}
function daysBetween_(fromISO, toISO) {
  const a = new Date(fromISO + 'T00:00:00');
  const b = new Date(toISO + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

/* ===================== AUDIT ===================== */
function logAudit_(action, recordType, recordId, details) {
  const email = (Session.getActiveUser().getEmail() || 'unknown').toLowerCase();
  ss_().getSheetByName(SHEETS.AUDIT).appendRow([
    nowIso_(), email, action, recordType, recordId, details || '',
  ]);
}

/* ===================== DRIVE ===================== */
function ensureParentFolder_() {
  const cached = PROPS.getProperty(PROP_KEYS.PARENT_FOLDER_ID);
  if (cached) {
    try {
      const f = DriveApp.getFolderById(cached);
      if (f && !f.isTrashed()) return f;
    } catch (e) { /* fall through */ }
  }
  const it = DriveApp.getFoldersByName(PARENT_FOLDER_NAME);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(PARENT_FOLDER_NAME);
  PROPS.setProperty(PROP_KEYS.PARENT_FOLDER_ID, folder.getId());
  return folder;
}

function ensureSubfolder_(key) {
  const parent = ensureParentFolder_();
  const name = SUBFOLDERS[key];
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** Save a base64 file into a subfolder. Returns {url, id} or null if no data. */
function saveFile_(subfolderKey, base64, mime, filename) {
  if (!base64) return null;
  const raw = stripDataUrl_(base64);
  const type = mime || 'application/octet-stream';
  const blob = Utilities.newBlob(Utilities.base64Decode(raw), type, safeFilename_(filename));
  const file = ensureSubfolder_(subfolderKey).createFile(blob);
  return { url: file.getUrl(), id: file.getId() };
}

function trashFile_(fileId) {
  if (!fileId) return;
  try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) { /* best effort */ }
}

/** Ensure a child folder by name under `parent` (no duplicates). */
function childFolder_(parent, name) {
  const safe = safeFilename_(name) || '(unnamed)';
  const it = parent.getFoldersByName(safe);
  return it.hasNext() ? it.next() : parent.createFolder(safe);
}

/** The per-job folder: <Parent>/<Mall>/<Lot>/. Everything for a job lives here. */
function jobFolder_(mall, lot) {
  const mallF = childFolder_(ensureParentFolder_(), mall || '(no mall)');
  return childFolder_(mallF, lot || '(no lot)');
}

/** Save one base64 file straight into a given folder. Returns {url,id} or null. */
function saveToFolder_(folder, base64, mime, filename) {
  if (!base64) return null;
  const raw = stripDataUrl_(base64);
  const type = mime || 'application/octet-stream';
  const blob = Utilities.newBlob(Utilities.base64Decode(raw), type, safeFilename_(filename));
  const file = folder.createFile(blob);
  return { url: file.getUrl(), id: file.getId() };
}

/* ===================== SETUP (run once from editor) ===================== */
function setupConfig() {
  ensureSheets_();
  const folder = ensureParentFolder_();
  Object.keys(SUBFOLDERS).forEach(function (k) { ensureSubfolder_(k); });
  seedMaterials_();
  const msg = [
    'Sheets initialised: ' + Object.values(SHEETS).join(', '),
    'Drive parent folder: ' + folder.getName() + ' (' + folder.getId() + ')',
    'Subfolders: ' + Object.values(SUBFOLDERS).join(', '),
    '',
    'Next: Deploy → New deployment → Web app',
    '  - Execute as: User accessing the web app',
    '  - Access:    Anyone within ' + ALLOWED_DOMAIN,
  ].join('\n');
  Logger.log(msg);
  return msg;
}

/** Editor diagnostic — Run this, open Execution log; JSON output = code is fine. */
function logBootstrap() {
  const out = bootstrap();
  Logger.log('BOOTSTRAP OK → ' + JSON.stringify(out).slice(0, 500) + ' ...');
  return out;
}

/* ===================== SQFT + RATE ENGINE ===================== */
/** Convert a value in `unit` to feet. */
function toFeet_(val, unit) {
  const v = Number(val) || 0;
  switch (unit) {
    case 'mm': return v / 304.8;
    case 'cm': return v / 30.48;
    case 'm':  return v * 3.280839895;
    case 'in': return v / 12;
    case 'ft': return v;
    default:   return v; // assume feet
  }
}

/** sqft for one panel: width × height (converted to ft) × qty. */
function panelSqft_(widthVal, heightVal, unit, qty) {
  const w = toFeet_(widthVal, unit);
  const h = toFeet_(heightVal, unit);
  const q = Number(qty) || 1;
  return round2_(w * h * q);
}

/**
 * Pick the best rate for a job. Most-specific wins:
 *   mall+material+jobType > mall+material > material > mall > ANY
 * Only rates with effectiveFrom <= jobDate (or blank) are considered.
 * Returns {id, ratePerSqft, installRate, minCharge} or null.
 */
function pickRate_(mall, material, jobType, jobDate) {
  const rows = readSheet_(SHEETS.RATES).filter(function (r) {
    const eff = dateStr_(r.effectiveFrom);
    return !eff || !jobDate || eff <= jobDate;
  });
  const M = String(mall || '').toLowerCase();
  const MAT = String(material || '').toLowerCase();
  const JT = String(jobType || '').toLowerCase();
  function val(r, f) { return String(r[f] || '').toLowerCase(); }
  function isAny(s) { return s === '' || s === 'all' || s === 'any' || s === '*'; }

  function score(r) {
    const rm = val(r, 'mall'), rmat = val(r, 'material'), rjt = val(r, 'jobType');
    // must not contradict
    if (!isAny(rm) && rm !== M) return -1;
    if (!isAny(rmat) && rmat !== MAT) return -1;
    if (!isAny(rjt) && rjt !== JT) return -1;
    let s = 0;
    if (!isAny(rm)) s += 4;
    if (!isAny(rmat)) s += 2;
    if (!isAny(rjt)) s += 1;
    return s;
  }

  let best = null, bestScore = -1, bestEff = '';
  rows.forEach(function (r) {
    const s = score(r);
    if (s < 0) return;
    const eff = dateStr_(r.effectiveFrom);
    // tie-break: higher score, then most recent effectiveFrom
    if (s > bestScore || (s === bestScore && eff > bestEff)) {
      best = r; bestScore = s; bestEff = eff;
    }
  });
  if (!best) return null;
  return {
    id: str_(best.id),
    ratePerSqft: num_(best.ratePerSqft),
    installRate: num_(best.installRate),
    packageRate: num_(best.packageRate),
    minCharge: num_(best.minCharge),
  };
}

/* ===================== PUBLIC: BOOTSTRAP ===================== */
function bootstrap() {
  const email = requireDomain_();
  ensureSheets_();
  return {
    currentUser: email,
    serverTime: nowIso_(),
    domain: ALLOWED_DOMAIN,
    sstRate: SST_RATE,
    statuses: STATUSES,
    units: UNITS,
    malls: listMalls_(),
    rates: listRates_(),
    permits: listPermits_(),
    workers: listWorkers_(),
    jobs: listJobs_(150),
    invoices: listInvoices_(80),
    materials: listMaterials_(),
    jobTypes: JOB_TYPES,
    alerts: buildAlerts_(),
  };
}

/* Managed material list (master sheet). Falls back to merging any materials
 * already used on rates/jobs so nothing silently disappears. */
function listMaterials_() {
  const set = {};
  readSheet_(SHEETS.MATERIALS).forEach(function (m) {
    const n = String(m.name || '').trim(); if (n) set[n] = str_(m.id) || true;
  });
  readSheet_(SHEETS.RATES).forEach(function (r) {
    const m = String(r.material || '').trim();
    if (m && m.toLowerCase() !== 'all' && m !== '*' && !set[m]) set[m] = true;
  });
  readSheet_(SHEETS.JOBS).forEach(function (r) {
    const m = String(r.material || '').trim();
    if (m && !set[m]) set[m] = true;
  });
  return Object.keys(set).sort().map(function (n) {
    return { id: (set[n] === true ? '' : set[n]), name: n };
  });
}

/* Permit + worker-doc early warnings for the dashboard. */
function buildAlerts_() {
  const today = todayISO_();
  const out = [];
  readSheet_(SHEETS.PERMITS).forEach(function (p) {
    const to = dateStr_(p.validTo);
    if (!to) return;
    const d = daysBetween_(today, to);
    if (d < 0) out.push({ kind: 'permit', level: 'expired', mall: str_(p.mall), label: str_(p.permitNo), days: d });
    else if (d <= PERMIT_WARN_DAYS) out.push({ kind: 'permit', level: 'expiring', mall: str_(p.mall), label: str_(p.permitNo), days: d });
  });
  readSheet_(SHEETS.WORKERS).forEach(function (w) {
    if (String(w.status || '').toLowerCase() === 'inactive') return;
    [['CIDB Green Card', w.cidbExpiry], ['Work at Height (WAH)', w.wahExpiry], [str_(w.docType) || 'Document', w.docExpiry]]
    .forEach(function (pair) {
      const ex = dateStr_(pair[1]);
      if (!ex) return;
      const d = daysBetween_(today, ex);
      if (d < 0) out.push({ kind: 'worker', level: 'expired', name: str_(w.name), label: pair[0], days: d });
      else if (d <= DOC_WARN_DAYS) out.push({ kind: 'worker', level: 'expiring', name: str_(w.name), label: pair[0], days: d });
    });
  });
  out.sort(function (a, b) { return a.days - b.days; });
  return out;
}

/* ===================== JOBS ===================== */
function listJobs_(limit) {
  return readSheet_(SHEETS.JOBS)
    .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); })
    .slice(0, limit || 150)
    .map(jobBrief_);
}

function jobBrief_(r) {
  return {
    id: str_(r.id), jobNo: str_(r.jobNo), status: str_(r.status),
    mall: str_(r.mall), lotNo: str_(r.lotNo), jobType: str_(r.jobType),
    client: str_(r.client), requestedBy: str_(r.requestedBy),
    requestDate: dateStr_(r.requestDate), installDate: dateStr_(r.installDate),
    completedDate: dateStr_(r.completedDate),
    material: str_(r.material), totalSqft: num_(r.totalSqft),
    ratePerSqft: num_(r.ratePerSqft), expectedAmount: num_(r.expectedAmount),
    artworkLink: str_(r.artworkLink), artworkProofUrl: str_(r.artworkProofUrl),
    sketchUrl: str_(r.sketchUrl), sitePhotosUrl: str_(r.sitePhotosUrl),
    photosUrl: str_(r.photosUrl), folderUrl: str_(r.folderUrl),
    permitId: str_(r.permitId), proceedBy: str_(r.proceedBy), proceedAt: str_(r.proceedAt),
    notes: str_(r.notes), createdBy: str_(r.createdBy),
  };
}

function listJobs(limit) { requireDomain_(); return listJobs_(limit); }

function getJob(id) {
  requireDomain_();
  const j = readSheet_(SHEETS.JOBS).filter(function (r) { return r.id === id; })[0];
  if (!j) throw new Error('Job not found.');
  const panels = readSheet_(SHEETS.PANELS)
    .filter(function (p) { return p.jobId === id; })
    .map(function (p) {
      return {
        id: str_(p.id), label: str_(p.label),
        widthVal: num_(p.widthVal), heightVal: num_(p.heightVal),
        unit: str_(p.unit) || 'mm', qty: num_(p.qty) || 1, sqft: num_(p.sqft),
        material: str_(p.material), ratePerSqft: num_(p.ratePerSqft), amount: num_(p.amount),
      };
    });
  const out = jobBrief_(j);
  out.panels = panels;
  out.subtotal = num_(j.subtotal);
  out.installRate = num_(j.installRate);
  out.rateId = str_(j.rateId);
  return out;
}

/**
 * Create or update a job. Server recomputes every sqft + amount.
 * payload: { id?, jobNo?, status, mall, lotNo, jobType, client, requestedBy,
 *            requestDate, installDate, material, notes, permitId,
 *            panels:[{label,widthVal,heightVal,unit,qty,material?,ratePerSqft?}],
 *            artworkLink?,
 *            artworkProofBase64?, artworkProofMime?, artworkProofName?,
 *            sketchBase64?, sketchMime?, sketchName? }
 */
function saveJob(payload) {
  const email = requireDomain_();
  if (!payload) throw new Error('Empty payload.');
  if (!String(payload.mall || '').trim()) throw new Error('Mall is required.');
  if (!String(payload.lotNo || '').trim()) throw new Error('Lot number is required.');
  ensureSheets_();

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const editing = !!payload.id;
    const existing = editing
      ? readSheet_(SHEETS.JOBS).filter(function (r) { return r.id === payload.id; })[0]
      : null;
    if (editing && !existing) throw new Error('Job not found for edit.');

    const jobId = editing ? payload.id : uid_();
    const jobNo = editing ? str_(existing.jobNo) : nextJobNo_(new Date());
    const jobType = normType_(payload.jobType);
    const jobDate = String(payload.requestDate || '').trim() || todayISO_();
    const mall = String(payload.mall).trim();
    const lotNo = String(payload.lotNo).trim();
    const jobMaterial = String(payload.material || '').trim();

    // Recompute panels server-side
    const rawPanels = (payload.panels || []).filter(function (p) {
      return Number(p.widthVal) || Number(p.heightVal);
    });
    // Job-level rate snapshot. A package (supply+install) rate, when present on
    // a print+install job, prices the whole panel at one all-in rate — no
    // separate install line.
    const jobRate = pickRate_(mall, jobMaterial, jobType, jobDate);
    const usePackage = jobType === 'print_install' && jobRate && jobRate.packageRate > 0;

    let totalSqft = 0, subtotal = 0;
    const panels = rawPanels.map(function (p) {
      const unit = UNITS.indexOf(p.unit) >= 0 ? p.unit : 'mm';
      const sqft = panelSqft_(p.widthVal, p.heightVal, unit, p.qty);
      const mat = String(p.material || jobMaterial || '').trim();
      // per-panel rate: explicit > install-only(install rate) > package > print rate
      let rate = Number(p.ratePerSqft) || 0;
      if (!rate) {
        if (jobType === 'install_only') {
          const r = pickRate_(mall, mat, jobType, jobDate);
          rate = r ? r.installRate : 0;
        } else if (usePackage) {
          rate = jobRate.packageRate;
        } else {
          const r = pickRate_(mall, mat, jobType, jobDate);
          rate = r ? r.ratePerSqft : 0;
        }
      }
      const amount = round2_(sqft * rate);
      totalSqft = round2_(totalSqft + sqft);
      subtotal = round2_(subtotal + amount);
      return {
        id: uid_(), jobId: jobId, label: String(p.label || '').trim(),
        widthVal: Number(p.widthVal) || 0, heightVal: Number(p.heightVal) || 0,
        unit: unit, qty: Number(p.qty) || 1, sqft: sqft,
        material: mat, ratePerSqft: rate, amount: amount,
      };
    });

    const ratePerSqft = (jobType === 'install_only') ? (jobRate ? jobRate.installRate : 0)
                       : usePackage ? jobRate.packageRate : (jobRate ? jobRate.ratePerSqft : 0);
    const installRate = jobRate ? jobRate.installRate : 0;
    // separate install line only for print+install on the split (non-package) rate;
    // install_only already prices every panel at the install rate above.
    const installAmount = (jobType === 'print_install' && !usePackage) ? round2_(totalSqft * installRate) : 0;
    let expectedAmount = round2_(subtotal + installAmount);
    if (jobRate && jobRate.minCharge && expectedAmount < jobRate.minCharge) {
      expectedAmount = round2_(jobRate.minCharge);
    }

    // Per-job Drive folder: <Parent>/<Mall>/<Lot>/. All files for this job live here.
    const folder = jobFolder_(mall, lotNo);
    const folderUrl = folder.getUrl();

    // Sketch & proof: new upload > pasted link > existing value.
    let artworkProofUrl = editing ? str_(existing.artworkProofUrl) : '';
    let sketchUrl = editing ? str_(existing.sketchUrl) : '';
    if (payload.artworkProofBase64) {
      const f = saveToFolder_(folder, payload.artworkProofBase64, payload.artworkProofMime,
        jobNo + ' — proof — ' + safeFilename_(payload.artworkProofName || 'artwork'));
      if (f) artworkProofUrl = f.url;
    } else if (String(payload.artworkProofLink || '').trim()) {
      artworkProofUrl = String(payload.artworkProofLink).trim();
    }
    if (payload.sketchBase64) {
      const f = saveToFolder_(folder, payload.sketchBase64, payload.sketchMime,
        jobNo + ' — sketch — ' + safeFilename_(payload.sketchName || 'measurement'));
      if (f) sketchUrl = f.url;
    } else if (String(payload.sketchLink || '').trim()) {
      sketchUrl = String(payload.sketchLink).trim();
    }

    // Site reference pictures (multiple) → "Site Reference" subfolder.
    let sitePhotosUrl = editing ? str_(existing.sitePhotosUrl) : '';
    const sitePhotos = payload.sitePhotos || [];
    if (sitePhotos.length) {
      const siteF = childFolder_(folder, 'Site Reference');
      sitePhotos.forEach(function (p, i) {
        saveToFolder_(siteF, p.base64, p.mime, jobNo + ' — site ' + (i + 1) + ' — ' + safeFilename_(p.name || ''));
      });
      sitePhotosUrl = siteF.getUrl();
    }

    const status = STATUSES.indexOf(payload.status) >= 0 ? payload.status : (editing ? str_(existing.status) : 'NEW');

    const rec = {
      id: jobId, jobNo: jobNo, status: status,
      mall: mall, lotNo: lotNo, jobType: jobType,
      client: String(payload.client || '').trim(),
      requestedBy: String(payload.requestedBy || '').trim() || email,
      requestDate: jobDate,
      installDate: String(payload.installDate || '').trim(),
      completedDate: editing ? str_(existing.completedDate) : '',
      artworkLink: String(payload.artworkLink || '').trim(),
      artworkProofUrl: artworkProofUrl,
      sketchUrl: sketchUrl,
      sitePhotosUrl: sitePhotosUrl,
      photosUrl: editing ? str_(existing.photosUrl) : '',
      folderUrl: folderUrl,
      material: jobMaterial,
      totalSqft: totalSqft, rateId: jobRate ? jobRate.id : '',
      ratePerSqft: ratePerSqft, installRate: installRate,
      subtotal: subtotal, expectedAmount: expectedAmount,
      permitId: String(payload.permitId || '').trim(),
      proceedBy: editing ? str_(existing.proceedBy) : '',
      proceedAt: editing ? str_(existing.proceedAt) : '',
      notes: String(payload.notes || '').trim(),
      createdAt: editing ? str_(existing.createdAt) : nowIso_(),
      createdBy: editing ? str_(existing.createdBy) : email,
      updatedAt: nowIso_(),
    };

    if (editing) {
      updateRecord_(SHEETS.JOBS, rec);
      deleteRowsWhere_(SHEETS.PANELS, 2, [jobId]); // replace panels
    } else {
      appendRecord_(SHEETS.JOBS, rec);
    }
    panels.forEach(function (p) { appendRecord_(SHEETS.PANELS, p); });
    rememberMall_(mall);

    logAudit_(editing ? 'job.update' : 'job.create', 'Job', jobNo,
      mall + ' · Lot ' + rec.lotNo + ' · ' + totalSqft.toFixed(2) + ' sqft · RM ' + expectedAmount.toFixed(2));

    return { ok: true, id: jobId, jobNo: jobNo, totalSqft: totalSqft, expectedAmount: expectedAmount };
  } finally {
    lock.releaseLock();
  }
}

function nextJobNo_(now) {
  const year = Utilities.formatDate(now, tz_(), 'yyyy');
  const sheet = ss_().getSheetByName(SHEETS.JOBS);
  const last = sheet.getLastRow();
  let maxN = 0;
  if (last >= 2) {
    const nos = sheet.getRange(2, 2, last - 1, 1).getValues();
    nos.forEach(function (r) {
      const m = String(r[0] || '').match(/^VIS-(\d{4})-(\d+)$/);
      if (m && m[1] === year) maxN = Math.max(maxN, parseInt(m[2], 10));
    });
  }
  return 'VIS-' + year + '-' + String(maxN + 1).padStart(4, '0');
}

/** Status transition (the PROCEED magic word, printing, installed, etc.). */
function updateJobStatus(id, status, note) {
  const email = requireDomain_();
  if (STATUSES.indexOf(status) < 0) throw new Error('Unknown status: ' + status);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const j = readSheet_(SHEETS.JOBS).filter(function (r) { return r.id === id; })[0];
    if (!j) throw new Error('Job not found.');
    j.status = status;
    j.updatedAt = nowIso_();
    if (status === 'APPROVED') { j.proceedBy = email; j.proceedAt = nowIso_(); }
    if (status === 'COMPLETED' && !dateStr_(j.completedDate)) j.completedDate = todayISO_();
    if (note) j.notes = (str_(j.notes) ? str_(j.notes) + '\n' : '') + '[' + status + '] ' + note;
    updateRecord_(SHEETS.JOBS, j);
    logAudit_('job.status', 'Job', str_(j.jobNo), status + (note ? ' · ' + note : '') + (status === 'APPROVED' ? ' · PROCEED by ' + email : ''));
    return { ok: true, status: status };
  } finally {
    lock.releaseLock();
  }
}

/** Attach completion photos (base64 array) to a job and mark COMPLETED. */
function addCompletionPhotos(id, photos, remark) {
  const email = requireDomain_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const j = readSheet_(SHEETS.JOBS).filter(function (r) { return r.id === id; })[0];
    if (!j) throw new Error('Job not found.');
    const arr = photos || [];
    let folderUrl = str_(j.photosUrl);
    if (arr.length) {
      // Into the same per-job folder: <Parent>/<Mall>/<Lot>/Completion/
      const sub = childFolder_(jobFolder_(str_(j.mall), str_(j.lotNo)), 'Completion');
      arr.forEach(function (p, i) {
        const raw = stripDataUrl_(p.base64);
        const blob = Utilities.newBlob(Utilities.base64Decode(raw), p.mime || 'image/jpeg',
          safeFilename_(str_(j.jobNo) + ' — done ' + (i + 1) + ' — ' + (p.name || '')));
        sub.createFile(blob);
      });
      folderUrl = sub.getUrl();
    }
    j.photosUrl = folderUrl;
    j.status = 'COMPLETED';
    if (!dateStr_(j.completedDate)) j.completedDate = todayISO_();
    if (remark) j.notes = (str_(j.notes) ? str_(j.notes) + '\n' : '') + '[COMPLETED] ' + remark;
    j.updatedAt = nowIso_();
    updateRecord_(SHEETS.JOBS, j);
    logAudit_('job.complete', 'Job', str_(j.jobNo), arr.length + ' photo(s)' + (remark ? ' · ' + remark : ''));
    return { ok: true, photosUrl: folderUrl };
  } finally {
    lock.releaseLock();
  }
}

function deleteJob(id) {
  const email = requireDomain_();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const j = readSheet_(SHEETS.JOBS).filter(function (r) { return r.id === id; })[0];
    if (!j) throw new Error('Job not found.');
    deleteRowsWhere_(SHEETS.PANELS, 2, [id]);
    deleteRowsWhere_(SHEETS.JOBS, 1, [id]);
    logAudit_('job.delete', 'Job', str_(j.jobNo), 'by ' + email);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/* ===================== RATES ===================== */
function listRates_() {
  return readSheet_(SHEETS.RATES)
    .sort(function (a, b) { return String(a.mall).localeCompare(String(b.mall)) || String(a.material).localeCompare(String(b.material)); })
    .map(function (r) {
      return {
        id: str_(r.id), mall: str_(r.mall), material: str_(r.material), jobType: str_(r.jobType),
        ratePerSqft: num_(r.ratePerSqft), installRate: num_(r.installRate),
        packageRate: num_(r.packageRate), minCharge: num_(r.minCharge),
        effectiveFrom: dateStr_(r.effectiveFrom), notes: str_(r.notes), updatedBy: str_(r.updatedBy),
      };
    });
}
function listRates() { requireDomain_(); return listRates_(); }

function saveRate(payload) {
  const email = requireDomain_();
  if (!payload) throw new Error('Empty payload.');
  if (!Number(payload.ratePerSqft) && !Number(payload.installRate) && !Number(payload.packageRate)) {
    throw new Error('Enter a print rate, install rate, and/or a package rate.');
  }
  ensureSheets_();
  const editing = !!payload.id;
  const rec = {
    id: editing ? payload.id : uid_(),
    mall: String(payload.mall || 'ALL').trim() || 'ALL',
    material: String(payload.material || 'ALL').trim() || 'ALL',
    jobType: String(payload.jobType || 'ALL').trim() || 'ALL',
    ratePerSqft: round2_(payload.ratePerSqft),
    installRate: round2_(payload.installRate),
    packageRate: round2_(payload.packageRate),
    minCharge: round2_(payload.minCharge),
    effectiveFrom: String(payload.effectiveFrom || '').trim(),
    notes: String(payload.notes || '').trim(),
    updatedAt: nowIso_(), updatedBy: email,
  };
  if (editing && updateRecord_(SHEETS.RATES, rec)) {
    logAudit_('rate.update', 'Rate', rec.mall + '/' + rec.material, 'RM ' + rec.ratePerSqft + '/sqft');
  } else {
    appendRecord_(SHEETS.RATES, rec);
    logAudit_('rate.create', 'Rate', rec.mall + '/' + rec.material, 'RM ' + rec.ratePerSqft + '/sqft');
  }
  rememberMall_(rec.mall);
  return { ok: true, id: rec.id };
}

function deleteRate(id) {
  requireDomain_();
  deleteRowsWhere_(SHEETS.RATES, 1, [id]);
  logAudit_('rate.delete', 'Rate', id, '');
  return { ok: true };
}

/** Live preview helper for the New Job form. */
function quoteJob(mall, material, jobType, jobDate, panels) {
  requireDomain_();
  const jt = normType_(jobType);
  const jd = String(jobDate || '').trim() || todayISO_();
  const jobRate = pickRate_(mall, material, jt, jd);
  const usePackage = jt === 'print_install' && jobRate && jobRate.packageRate > 0;
  let totalSqft = 0, subtotal = 0;
  const out = (panels || []).map(function (p) {
    const unit = UNITS.indexOf(p.unit) >= 0 ? p.unit : 'mm';
    const sqft = panelSqft_(p.widthVal, p.heightVal, unit, p.qty);
    const mat = String(p.material || material || '').trim();
    let rate = Number(p.ratePerSqft) || 0;
    if (!rate) {
      if (jt === 'install_only') { const r = pickRate_(mall, mat, jt, jd); rate = r ? r.installRate : 0; }
      else if (usePackage) { rate = jobRate.packageRate; }
      else { const r = pickRate_(mall, mat, jt, jd); rate = r ? r.ratePerSqft : 0; }
    }
    const amount = round2_(sqft * rate);
    totalSqft = round2_(totalSqft + sqft);
    subtotal = round2_(subtotal + amount);
    return { sqft: sqft, ratePerSqft: rate, amount: amount };
  });
  const installRate = jobRate ? jobRate.installRate : 0;
  const installAmount = (jt === 'print_install' && !usePackage) ? round2_(totalSqft * installRate) : 0;
  let expected = round2_(subtotal + installAmount);
  let minApplied = false;
  if (jobRate && jobRate.minCharge && expected < jobRate.minCharge) { expected = round2_(jobRate.minCharge); minApplied = true; }
  return {
    panels: out, totalSqft: totalSqft, subtotal: subtotal,
    installRate: installRate, installAmount: installAmount,
    usePackage: usePackage, packageRate: usePackage ? jobRate.packageRate : 0,
    expectedAmount: expected, minApplied: minApplied,
    rateFound: !!jobRate,
  };
}

/* ===================== MALLS ===================== */
function listMalls_() {
  return readSheet_(SHEETS.MALLS)
    .map(function (m) { return { id: str_(m.id), name: str_(m.name), notes: str_(m.notes) }; })
    .sort(function (a, b) { return a.name.localeCompare(b.name); });
}
function rememberMall_(name) {
  const n = String(name || '').trim();
  if (!n || n.toLowerCase() === 'all') return;
  const exists = readSheet_(SHEETS.MALLS).some(function (m) { return String(m.name).toLowerCase() === n.toLowerCase(); });
  if (!exists) appendRecord_(SHEETS.MALLS, { id: uid_(), name: n, notes: '', updatedAt: nowIso_() });
}
function listMalls() { requireDomain_(); return listMalls_(); }

/** Add or rename a mall. {id?, name} → returns the list. */
function saveMall(payload) {
  requireDomain_();
  const name = String(payload && payload.name || '').trim();
  if (!name) throw new Error('Mall name is required.');
  const editing = !!(payload && payload.id);
  const all = readSheet_(SHEETS.MALLS);
  const clash = all.filter(function (m) {
    return String(m.name).toLowerCase() === name.toLowerCase() && String(m.id) !== String(payload.id);
  })[0];
  if (clash) throw new Error('A mall named "' + name + '" already exists.');
  if (editing) {
    const rec = { id: payload.id, name: name, notes: String(payload.notes || '').trim(), updatedAt: nowIso_() };
    updateRecord_(SHEETS.MALLS, rec);
    logAudit_('mall.update', 'Mall', name, '');
  } else {
    appendRecord_(SHEETS.MALLS, { id: uid_(), name: name, notes: String(payload.notes || '').trim(), updatedAt: nowIso_() });
    logAudit_('mall.create', 'Mall', name, '');
  }
  return listMalls_();
}
function deleteMall(id) {
  requireDomain_();
  const m = readSheet_(SHEETS.MALLS).filter(function (r) { return r.id === id; })[0];
  deleteRowsWhere_(SHEETS.MALLS, 1, [id]);
  if (m) logAudit_('mall.delete', 'Mall', str_(m.name), '');
  return listMalls_();
}

/* ===================== MATERIALS ===================== */
function seedMaterials_() {
  if (readSheet_(SHEETS.MATERIALS).length) return;
  ['Tarpaulin', 'Sticker', 'Fabric', 'Vinyl', 'Forex Board'].forEach(function (n) {
    appendRecord_(SHEETS.MATERIALS, { id: uid_(), name: n, notes: '', updatedAt: nowIso_() });
  });
}
function listMaterials() { requireDomain_(); return listMaterials_(); }
function saveMaterial(payload) {
  requireDomain_();
  const name = String(payload && payload.name || '').trim();
  if (!name) throw new Error('Material name is required.');
  const editing = !!(payload && payload.id);
  const all = readSheet_(SHEETS.MATERIALS);
  const clash = all.filter(function (m) {
    return String(m.name).toLowerCase() === name.toLowerCase() && String(m.id) !== String(payload.id);
  })[0];
  if (clash) throw new Error('A material named "' + name + '" already exists.');
  if (editing) {
    updateRecord_(SHEETS.MATERIALS, { id: payload.id, name: name, notes: String(payload.notes || '').trim(), updatedAt: nowIso_() });
    logAudit_('material.update', 'Material', name, '');
  } else {
    appendRecord_(SHEETS.MATERIALS, { id: uid_(), name: name, notes: String(payload.notes || '').trim(), updatedAt: nowIso_() });
    logAudit_('material.create', 'Material', name, '');
  }
  return listMaterials_();
}
function deleteMaterial(id) {
  requireDomain_();
  const m = readSheet_(SHEETS.MATERIALS).filter(function (r) { return r.id === id; })[0];
  if (id) deleteRowsWhere_(SHEETS.MATERIALS, 1, [id]);
  if (m) logAudit_('material.delete', 'Material', str_(m.name), '');
  return listMaterials_();
}

/* ===================== PERMITS ===================== */
function listPermits_() {
  const today = todayISO_();
  return readSheet_(SHEETS.PERMITS)
    .map(function (p) {
      const to = dateStr_(p.validTo);
      const d = to ? daysBetween_(today, to) : null;
      let state = 'ok';
      if (d !== null) { if (d < 0) state = 'expired'; else if (d <= PERMIT_WARN_DAYS) state = 'expiring'; }
      return {
        id: str_(p.id), mall: str_(p.mall), lotNo: str_(p.lotNo),
        permitType: str_(p.permitType), permitNo: str_(p.permitNo),
        validFrom: dateStr_(p.validFrom), validTo: to, fileUrl: str_(p.fileUrl),
        notes: str_(p.notes), daysLeft: d, state: state,
      };
    })
    .sort(function (a, b) { return String(a.mall).localeCompare(String(b.mall)) || String(b.validTo).localeCompare(String(a.validTo)); });
}
function listPermits() { requireDomain_(); return listPermits_(); }

function savePermit(payload) {
  const email = requireDomain_();
  if (!String(payload.mall || '').trim()) throw new Error('Mall is required.');
  ensureSheets_();
  const editing = !!payload.id;
  const existing = editing ? readSheet_(SHEETS.PERMITS).filter(function (r) { return r.id === payload.id; })[0] : null;
  let fileUrl = existing ? str_(existing.fileUrl) : '';
  let fileId = existing ? str_(existing.fileId) : '';
  if (payload.fileBase64) {
    if (fileId) trashFile_(fileId);
    const f = saveFile_('PERMITS', payload.fileBase64, payload.fileMime,
      safeFilename_(payload.mall + ' — ' + (payload.permitNo || 'permit') + ' — ' + (payload.fileName || '')));
    if (f) { fileUrl = f.url; fileId = f.id; }
  }
  const rec = {
    id: editing ? payload.id : uid_(),
    mall: String(payload.mall).trim(),
    lotNo: String(payload.lotNo || '').trim(),
    permitType: String(payload.permitType || '').trim(),
    permitNo: String(payload.permitNo || '').trim(),
    validFrom: String(payload.validFrom || '').trim(),
    validTo: String(payload.validTo || '').trim(),
    fileUrl: fileUrl, fileId: fileId,
    notes: String(payload.notes || '').trim(),
    createdAt: existing ? str_(existing.createdAt) : nowIso_(), createdBy: existing ? str_(existing.createdBy) : email,
  };
  if (editing && updateRecord_(SHEETS.PERMITS, rec)) logAudit_('permit.update', 'Permit', rec.mall, rec.permitNo);
  else { appendRecord_(SHEETS.PERMITS, rec); logAudit_('permit.create', 'Permit', rec.mall, rec.permitNo); }
  rememberMall_(rec.mall);
  return { ok: true, id: rec.id };
}

function deletePermit(id) {
  requireDomain_();
  const p = readSheet_(SHEETS.PERMITS).filter(function (r) { return r.id === id; })[0];
  if (p && p.fileId) trashFile_(str_(p.fileId));
  deleteRowsWhere_(SHEETS.PERMITS, 1, [id]);
  logAudit_('permit.delete', 'Permit', id, '');
  return { ok: true };
}

/* ===================== WORKERS ===================== */
/* Each worker carries dedicated document slots: IC, CIDB Green Card, WAH, plus a
 * generic "Other". CIDB/WAH/Other can expire and feed the early-warning. */
function listWorkers_() {
  const today = todayISO_();
  return readSheet_(SHEETS.WORKERS)
    .map(function (w) {
      // soonest upcoming expiry across the dated docs drives the badge
      let soonest = null, soonestLabel = '';
      [['CIDB', w.cidbExpiry], ['WAH', w.wahExpiry], [str_(w.docType) || 'Doc', w.docExpiry]].forEach(function (pair) {
        const ex = dateStr_(pair[1]); if (!ex) return;
        const d = daysBetween_(today, ex);
        if (soonest === null || d < soonest) { soonest = d; soonestLabel = pair[0]; }
      });
      let docState = 'ok';
      if (soonest !== null) { if (soonest < 0) docState = 'expired'; else if (soonest <= DOC_WARN_DAYS) docState = 'expiring'; }
      return {
        id: str_(w.id), name: str_(w.name), role: str_(w.role), phone: str_(w.phone),
        icNo: str_(w.icNo), icFileUrl: str_(w.icFileUrl),
        cidbNo: str_(w.cidbNo), cidbExpiry: dateStr_(w.cidbExpiry), cidbFileUrl: str_(w.cidbFileUrl),
        wahNo: str_(w.wahNo), wahExpiry: dateStr_(w.wahExpiry), wahFileUrl: str_(w.wahFileUrl),
        docType: str_(w.docType), docNo: str_(w.docNo), docExpiry: dateStr_(w.docExpiry), docUrl: str_(w.docUrl),
        status: str_(w.status) || 'active', notes: str_(w.notes),
        daysLeft: soonest, soonestLabel: soonestLabel, docState: docState,
      };
    })
    .sort(function (a, b) { return a.name.localeCompare(b.name); });
}
function listWorkers() { requireDomain_(); return listWorkers_(); }

function saveWorker(payload) {
  const email = requireDomain_();
  if (!String(payload.name || '').trim()) throw new Error('Worker name is required.');
  ensureSheets_();
  const editing = !!payload.id;
  const existing = editing ? readSheet_(SHEETS.WORKERS).filter(function (r) { return r.id === payload.id; })[0] : null;
  const folder = childFolder_(ensureSubfolder_('WORKERS'), String(payload.name).trim());

  // For each doc slot: new upload replaces the old file; otherwise keep existing.
  function docSlot(label, baseField) {
    let url = existing ? str_(existing[baseField + 'FileUrl'] || existing[baseField + 'Url']) : '';
    let id = existing ? str_(existing[baseField + 'FileId']) : '';
    const b64 = payload[baseField + 'Base64'];
    if (b64) {
      if (id) trashFile_(id);
      const f = saveToFolder_(folder, b64, payload[baseField + 'Mime'],
        safeFilename_(payload.name + ' — ' + label + ' — ' + (payload[baseField + 'Name'] || '')));
      if (f) { url = f.url; id = f.id; }
    }
    return { url: url, id: id };
  }
  const ic = docSlot('IC', 'ic');
  const cidb = docSlot('CIDB Green Card', 'cidb');
  const wah = docSlot('WAH', 'wah');
  // generic "other" doc keeps its legacy field names docUrl/docFileId
  let docUrl = existing ? str_(existing.docUrl) : '';
  let docFileId = existing ? str_(existing.docFileId) : '';
  if (payload.docBase64) {
    if (docFileId) trashFile_(docFileId);
    const f = saveToFolder_(folder, payload.docBase64, payload.docMime,
      safeFilename_(payload.name + ' — ' + (payload.docType || 'doc') + ' — ' + (payload.docName || '')));
    if (f) { docUrl = f.url; docFileId = f.id; }
  }

  const rec = {
    id: editing ? payload.id : uid_(),
    name: String(payload.name).trim(), role: String(payload.role || '').trim(),
    phone: String(payload.phone || '').trim(),
    icNo: String(payload.icNo || '').trim(), icFileUrl: ic.url, icFileId: ic.id,
    cidbNo: String(payload.cidbNo || '').trim(), cidbExpiry: String(payload.cidbExpiry || '').trim(),
    cidbFileUrl: cidb.url, cidbFileId: cidb.id,
    wahNo: String(payload.wahNo || '').trim(), wahExpiry: String(payload.wahExpiry || '').trim(),
    wahFileUrl: wah.url, wahFileId: wah.id,
    docType: String(payload.docType || '').trim(), docNo: String(payload.docNo || '').trim(),
    docExpiry: String(payload.docExpiry || '').trim(), docUrl: docUrl, docFileId: docFileId,
    status: String(payload.status || 'active').trim() || 'active',
    notes: String(payload.notes || '').trim(),
    updatedAt: nowIso_(), updatedBy: email,
  };
  if (editing && updateRecord_(SHEETS.WORKERS, rec)) logAudit_('worker.update', 'Worker', rec.name, '');
  else { appendRecord_(SHEETS.WORKERS, rec); logAudit_('worker.create', 'Worker', rec.name, ''); }
  return { ok: true, id: rec.id };
}

function deleteWorker(id) {
  requireDomain_();
  const w = readSheet_(SHEETS.WORKERS).filter(function (r) { return r.id === id; })[0];
  if (w) {
    ['icFileId', 'cidbFileId', 'wahFileId', 'docFileId'].forEach(function (f) { if (w[f]) trashFile_(str_(w[f])); });
  }
  deleteRowsWhere_(SHEETS.WORKERS, 1, [id]);
  logAudit_('worker.delete', 'Worker', id, '');
  return { ok: true };
}

/* ===================== INVOICES + RECONCILIATION ===================== */
function listInvoices_(limit) {
  return readSheet_(SHEETS.INVOICES)
    .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); })
    .slice(0, limit || 80)
    .map(function (r) {
      return {
        id: str_(r.id), invNo: str_(r.invNo), invDate: dateStr_(r.invDate), period: str_(r.period),
        malls: str_(r.malls), claimedTotal: num_(r.claimedTotal), status: str_(r.status),
        reconVerdict: str_(r.reconVerdict), reconNote: str_(r.reconNote),
        fileUrl: str_(r.fileUrl), createdBy: str_(r.createdBy),
      };
    });
}
function listInvoices() { requireDomain_(); return listInvoices_(); }

/** Full invoice with its job lines + a fresh reconciliation. */
function getInvoice(id) {
  requireDomain_();
  const inv = readSheet_(SHEETS.INVOICES).filter(function (r) { return r.id === id; })[0];
  if (!inv) throw new Error('Invoice not found.');
  const links = readSheet_(SHEETS.INVJOBS).filter(function (l) { return l.invoiceId === id; });
  const jobsById = {};
  readSheet_(SHEETS.JOBS).forEach(function (j) { jobsById[j.id] = j; });
  const lines = links.map(function (l) {
    const j = jobsById[str_(l.jobId)] || {};
    const recordedSqft = num_(j.totalSqft);
    const recordedAmount = num_(j.expectedAmount);
    const claimedSqft = num_(l.claimedSqft);
    const claimedAmount = num_(l.claimedAmount);
    const variance = round2_(claimedAmount - recordedAmount);
    return {
      id: str_(l.id), jobId: str_(l.jobId), jobNo: str_(j.jobNo || '(deleted)'),
      mall: str_(j.mall), lotNo: str_(j.lotNo), status: str_(j.status),
      recordedSqft: recordedSqft, recordedAmount: recordedAmount,
      claimedSqft: claimedSqft, claimedAmount: claimedAmount,
      varianceRm: variance, flag: flagFor_(claimedAmount, recordedAmount),
      sqftGap: round2_(claimedSqft - recordedSqft),
    };
  });
  return {
    id: str_(inv.id), invNo: str_(inv.invNo), invDate: dateStr_(inv.invDate), period: str_(inv.period),
    malls: str_(inv.malls), claimedAmount: num_(inv.claimedAmount),
    sstEnabled: bool_(inv.sstEnabled), sstAmount: num_(inv.sstAmount), claimedTotal: num_(inv.claimedTotal),
    status: str_(inv.status), reconVerdict: str_(inv.reconVerdict), reconNote: str_(inv.reconNote),
    fileUrl: str_(inv.fileUrl), notes: str_(inv.notes), lines: lines,
    summary: reconSummary_(lines, num_(inv.claimedAmount)),
  };
}

function flagFor_(claimed, recorded) {
  const diff = Math.abs((Number(claimed) || 0) - (Number(recorded) || 0));
  const pct = recorded ? diff / Math.abs(recorded) : (diff ? 1 : 0);
  if (diff <= RECON_TOL_RM || pct <= RECON_TOL_PCT) return 'OK';
  return (Number(claimed) || 0) > (Number(recorded) || 0) ? 'OVER' : 'UNDER';
}

function reconSummary_(lines, claimedHeader) {
  let recorded = 0, claimed = 0, flagged = 0;
  lines.forEach(function (l) {
    recorded = round2_(recorded + l.recordedAmount);
    claimed = round2_(claimed + l.claimedAmount);
    if (l.flag !== 'OK') flagged++;
  });
  const headerClaim = Number(claimedHeader) || claimed;
  return {
    jobCount: lines.length, flagged: flagged,
    recordedTotal: recorded, claimedTotal: claimed,
    varianceRm: round2_(claimed - recorded),
    headerVsLines: round2_(headerClaim - claimed),
    verdict: flagged ? 'CHECK' : 'MATCH',
  };
}

/**
 * Save B's submitted invoice + its job lines, run reconciliation, store the file.
 * payload: { id?, invNo, invDate, period, status?, notes,
 *            claimedAmount, sstEnabled,
 *            lines:[{jobId, claimedSqft, claimedAmount}],
 *            fileBase64?, fileMime?, fileName? }
 */
function saveInvoice(payload) {
  const email = requireDomain_();
  if (!String(payload.invNo || '').trim()) throw new Error("B's invoice number is required.");
  ensureSheets_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const editing = !!payload.id;
    const existing = editing ? readSheet_(SHEETS.INVOICES).filter(function (r) { return r.id === payload.id; })[0] : null;
    const invId = editing ? payload.id : uid_();

    // Build job lines + recon
    const jobsById = {};
    readSheet_(SHEETS.JOBS).forEach(function (j) { jobsById[j.id] = j; });
    const rawLines = (payload.lines || []).filter(function (l) { return l.jobId; });
    const malls = {};
    let lineClaimTotal = 0, lineRecordedTotal = 0, flagged = 0;
    const linkRecs = rawLines.map(function (l) {
      const j = jobsById[String(l.jobId)] || {};
      if (j.mall) malls[str_(j.mall)] = true;
      const recordedSqft = num_(j.totalSqft);
      const recordedAmount = num_(j.expectedAmount);
      const claimedAmount = round2_(l.claimedAmount);
      const claimedSqft = round2_(l.claimedSqft);
      lineClaimTotal = round2_(lineClaimTotal + claimedAmount);
      lineRecordedTotal = round2_(lineRecordedTotal + recordedAmount);
      const flag = flagFor_(claimedAmount, recordedAmount);
      if (flag !== 'OK') flagged++;
      return {
        id: uid_(), invoiceId: invId, jobId: String(l.jobId),
        claimedSqft: claimedSqft, claimedAmount: claimedAmount,
        recordedSqft: recordedSqft, recordedAmount: recordedAmount,
        varianceRm: round2_(claimedAmount - recordedAmount), flag: flag,
      };
    });

    const claimedAmount = Number(payload.claimedAmount) ? round2_(payload.claimedAmount) : lineClaimTotal;
    const sstEnabled = !!payload.sstEnabled;
    const sstAmount = sstEnabled ? round2_(claimedAmount * SST_RATE) : 0;
    const claimedTotal = round2_(claimedAmount + sstAmount);
    const verdict = flagged ? 'CHECK' : 'MATCH';
    const reconNote = flagged
      ? (flagged + ' of ' + linkRecs.length + ' job(s) differ from HG record · claimed RM ' + money_(lineClaimTotal) + ' vs recorded RM ' + money_(lineRecordedTotal))
      : (linkRecs.length + ' job(s) tally with HG record');

    // File
    let fileUrl = existing ? str_(existing.fileUrl) : '';
    let fileId = existing ? str_(existing.fileId) : '';
    if (payload.fileBase64) {
      if (fileId) trashFile_(fileId);
      const f = saveFile_('INVOICES', payload.fileBase64, payload.fileMime,
        safeFilename_('B INV ' + payload.invNo + ' — ' + (payload.fileName || '')));
      if (f) { fileUrl = f.url; fileId = f.id; }
    }

    const rec = {
      id: invId, invNo: String(payload.invNo).trim(),
      invDate: String(payload.invDate || '').trim() || todayISO_(),
      period: String(payload.period || '').trim(),
      malls: Object.keys(malls).join(', '),
      claimedAmount: claimedAmount, sstEnabled: sstEnabled, sstAmount: sstAmount, claimedTotal: claimedTotal,
      fileUrl: fileUrl, fileId: fileId,
      status: String(payload.status || (verdict === 'MATCH' ? 'verified' : 'checking')).trim(),
      reconVerdict: verdict, reconNote: reconNote,
      notes: String(payload.notes || '').trim(),
      createdAt: existing ? str_(existing.createdAt) : nowIso_(),
      createdBy: existing ? str_(existing.createdBy) : email,
      updatedAt: nowIso_(),
    };

    if (editing) {
      updateRecord_(SHEETS.INVOICES, rec);
      deleteRowsWhere_(SHEETS.INVJOBS, 2, [invId]);
    } else {
      appendRecord_(SHEETS.INVOICES, rec);
    }
    linkRecs.forEach(function (l) { appendRecord_(SHEETS.INVJOBS, l); });

    logAudit_(editing ? 'invoice.update' : 'invoice.create', 'Invoice', rec.invNo,
      verdict + ' · ' + linkRecs.length + ' job(s) · claimed RM ' + money_(claimedAmount) + ' · ' + reconNote);

    return { ok: true, id: invId, verdict: verdict, flagged: flagged,
             claimedTotal: claimedTotal, reconNote: reconNote };
  } finally {
    lock.releaseLock();
  }
}

/** Mark an invoice paid / disputed / verified — for the dispute trail. */
function setInvoiceStatus(id, status, note) {
  const email = requireDomain_();
  const inv = readSheet_(SHEETS.INVOICES).filter(function (r) { return r.id === id; })[0];
  if (!inv) throw new Error('Invoice not found.');
  inv.status = String(status || '').trim();
  if (note) inv.reconNote = (str_(inv.reconNote) ? str_(inv.reconNote) + ' | ' : '') + '[' + status + '] ' + note + ' (' + email + ')';
  inv.updatedAt = nowIso_();
  updateRecord_(SHEETS.INVOICES, inv);
  logAudit_('invoice.status', 'Invoice', str_(inv.invNo), status + (note ? ' · ' + note : ''));
  return { ok: true };
}

function deleteInvoice(id) {
  requireDomain_();
  const inv = readSheet_(SHEETS.INVOICES).filter(function (r) { return r.id === id; })[0];
  if (inv && inv.fileId) trashFile_(str_(inv.fileId));
  deleteRowsWhere_(SHEETS.INVJOBS, 2, [id]);
  deleteRowsWhere_(SHEETS.INVOICES, 1, [id]);
  logAudit_('invoice.delete', 'Invoice', inv ? str_(inv.invNo) : id, '');
  return { ok: true };
}

/** Jobs that are installed/completed but not yet on any invoice — ready to bill. */
function unbilledJobs() {
  requireDomain_();
  const billed = {};
  readSheet_(SHEETS.INVJOBS).forEach(function (l) { billed[str_(l.jobId)] = true; });
  return readSheet_(SHEETS.JOBS)
    .filter(function (j) {
      const s = str_(j.status);
      return (s === 'INSTALLED' || s === 'COMPLETED' || s === 'PRINTING') && !billed[str_(j.id)];
    })
    .map(jobBrief_);
}

/* ===================== AUDIT REPORT ===================== */
function getAudit(limit) {
  requireDomain_();
  const sheet = ss_().getSheetByName(SHEETS.AUDIT);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const n = Math.min(limit || 200, last - 1);
  const vals = sheet.getRange(last - n + 1, 1, n, HEADERS.AuditLog.length).getValues();
  return vals.map(function (r) {
    return { timestamp: str_(r[0]), userEmail: str_(r[1]), action: str_(r[2]),
             recordType: str_(r[3]), recordId: str_(r[4]), details: str_(r[5]) };
  }).reverse();
}
