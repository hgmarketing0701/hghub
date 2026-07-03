/**
 * Black Lee — Lorry Fleet Management (Cloud v1)
 * Google Apps Script backend, served as a Workspace-restricted web app.
 *
 * Storage:
 *   - Google Sheet (this script is container-bound) — Lorries, FuelLogs, TollParkLogs, MaintLogs, AuditLog
 *   - Google Drive folder "Black Lee — Lorry Photos" — receipt + pump-display photos
 * Auth:
 *   - Workspace domain restriction via appsscript.json (access: DOMAIN)
 *   - Defence-in-depth domain check on every server call
 */

/* ===================== CONFIG ===================== */
const ALLOWED_DOMAIN = 'hggroup.com.my';
const PHOTO_FOLDER_NAME = 'Black Lee — Lorry Photos';

const SHEETS = {
  LORRIES:    'Lorries',
  FUEL:       'FuelLogs',
  TOLLPARK:   'TollParkLogs',
  MAINT:      'MaintLogs',
  COMPLIANCE: 'ComplianceLogs',
  INCIDENTS:  'IncidentLogs',
  DRIVERS:    'Drivers',
  SUMMONS:    'SummonLogs',
  AUDIT:      'AuditLog',
};

const COMPLIANCE_TYPES = ['roadtax', 'insurance', 'puspakom'];
const VEHICLE_TYPES    = ['lorry','van','car','pickup','motorcycle','bus','machinery','other'];

const HEADERS = {
  Lorries: [
    'id','plate','vehicleCode','model','year','active','notes','vehicleCardPhotoId',
    'createdAt','createdBy','updatedAt','updatedBy',
    'vehicleType'
  ],
  ComplianceLogs: [
    'id','plate','type','issuedDate','expiryDate','amountRM',
    'coverageRM','insurer','policyNumber',
    'agencyName','agencyChargesRM',
    'notes',
    'mainDocIds','receiptIds','agentInvoiceIds','paymentSlipIds',
    'createdAt','createdBy','updatedAt','updatedBy',
    'status','renewedById','prevId',
    'paymentRef','paidDate'
  ],
  FuelLogs: [
    'id','date','plate','odometer','litres','amountRM','station','paidBy',
    'driver','notes','pumpPhotoId','receiptPhotoId',
    'createdAt','createdBy','updatedAt','updatedBy'
  ],
  TollParkLogs: [
    'id','date','plate','type','amountRM','location','paidBy',
    'driver','jobRef','duration','notes','receiptPhotoId',
    'createdAt','createdBy','updatedAt','updatedBy'
  ],
  MaintLogs: [
    'id','date','plate','odometer','type','itemsReplaced','workshop','costRM',
    'nextServiceKm','notes','receiptPhotoId','receiptPhotoIds',
    'lineItems','subTotal','taxable','taxRate','taxAmount','discountAmount',
    'beforePhotoIds','afterPhotoIds',
    'createdAt','createdBy','updatedAt','updatedBy',
    'nextServiceDate','paymentSlipIds',
    'paymentRef','paidDate',
    'invoiceNumber','paidRM'
  ],
  IncidentLogs: [
    'id','date','time','plate','driverName','location','locationGps',
    'type','collisionType','collisionOther',
    'thirdPartyPlates','thirdPartyName','thirdPartyContact','thirdPartyInsurer',
    'faultParty','details','damagedAsset','witnesses',
    'towed','towCompany','towCostRM',
    'injuryAny','injuryAction','injuredPersonName','hospitalName','injuryDetails',
    'policeReportStatus','policeReportNumber','policeStation','followUpNeeded','followUpNotes',
    'incidentPhotoIds','policeReportIds','quotationIds',
    'compensationPaidRM','compensationPaidTo','compensationPaidIds',
    'compensationReceivedRM','compensationReceivedFrom','compensationReceivedIds',
    'insuranceClaimFiled','insuranceCompany','claimNumber','claimAmountRM','claimStatus',
    'repairAction','linkedMaintId',
    'status','notes',
    'createdAt','createdBy','updatedAt','updatedBy'
  ],
  Drivers: [
    'id','name','icNumber','staffId','phone','email','active',
    'licenseClass','licenseNumber','licenseIssueDate','licenseExpiryDate',
    'gdlExpiryDate',
    'address','emergencyContactName','emergencyContactPhone',
    'hireDate','assignedPlate','status','notes',
    'photoId','licenseDocIds',
    'createdAt','createdBy','updatedAt','updatedBy',
    'icDocIds','category'
  ],
  SummonLogs: [
    'id','summonNumber','issuedDate','issuedBy','plate','driverName','driverId',
    'location','offenceType','offenceDetails',
    'fineRM','discountRM','discountDeadline','paymentDeadline',
    'status','paidRM','paidDate','paymentRef','paymentProofIds',
    'courtDate','responsibleParty','notes',
    'summonCopyIds',
    'createdAt','createdBy','updatedAt','updatedBy'
  ],
  AuditLog: [
    'timestamp','userEmail','action','recordType','recordId','details'
  ],
};

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
    .setTitle('Black Lee — Lorry Fleet')
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
    const expected = HEADERS[name];
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.appendRow(expected);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, expected.length).setFontWeight('bold');
      return;
    }
    const existingWidth = sheet.getLastColumn();
    if (existingWidth === 0) {
      sheet.getRange(1, 1, 1, expected.length).setValues([expected]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, expected.length).setFontWeight('bold');
      return;
    }
    const firstRow = sheet.getRange(1, 1, 1, Math.max(existingWidth, expected.length)).getValues()[0];
    // Append any missing columns at the end (schema migration)
    if (existingWidth < expected.length) {
      const newCols = expected.slice(existingWidth);
      sheet.getRange(1, existingWidth + 1, 1, newCols.length)
        .setValues([newCols])
        .setFontWeight('bold');
    }
    // Repair header row if blank or mismatched
    const headerSlice = firstRow.slice(0, expected.length);
    const mismatch = headerSlice.some((v, i) => v !== expected[i]);
    if (mismatch) {
      sheet.getRange(1, 1, 1, expected.length).setValues([expected]).setFontWeight('bold');
      sheet.setFrozenRows(1);
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
    .filter(row => row.some(v => v !== '' && v !== null))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        let v = row[i];
        // Dates from Sheet cells may come back as Date objects — normalise YYYY-MM-DD columns to string
        if ((h === 'date' || h === 'issuedDate' || h === 'expiryDate' || h === 'nextServiceDate' ||
             h === 'licenseIssueDate' || h === 'licenseExpiryDate' || h === 'gdlExpiryDate' ||
             h === 'hireDate' || h === 'summonIssuedDate' || h === 'discountDeadline' ||
             h === 'paymentDeadline' || h === 'paidDate' || h === 'courtDate') && v instanceof Date) {
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
  return HEADERS[name].map(h => rec[h] === undefined || rec[h] === null ? '' : rec[h]);
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

function deleteRecordById_(name, id) {
  const sheet = ss_().getSheetByName(name);
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const vals = sheet.getRange(2, 1, last - 1, 1).getValues();
  let deleted = 0;
  for (let i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][0]) === String(id)) {
      sheet.deleteRow(i + 2);
      deleted++;
    }
  }
  return deleted;
}

function deleteRowsByPlate_(name, plate) {
  const sheet = ss_().getSheetByName(name);
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const plateCol = HEADERS[name].indexOf('plate') + 1;
  if (plateCol < 1) return 0;
  const vals = sheet.getRange(2, plateCol, last - 1, 1).getValues();
  let deleted = 0;
  for (let i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][0]) === String(plate)) {
      sheet.deleteRow(i + 2);
      deleted++;
    }
  }
  return deleted;
}

function updatePlateAcrossLogs_(oldPlate, newPlate) {
  let count = 0;
  [SHEETS.FUEL, SHEETS.TOLLPARK, SHEETS.MAINT, SHEETS.COMPLIANCE, SHEETS.INCIDENTS, SHEETS.SUMMONS].forEach(name => {
    const sheet = ss_().getSheetByName(name);
    const last = sheet.getLastRow();
    if (last < 2) return;
    const plateCol = HEADERS[name].indexOf('plate') + 1;
    const range = sheet.getRange(2, plateCol, last - 1, 1);
    const vals = range.getValues();
    let changed = false;
    for (let i = 0; i < vals.length; i++) {
      if (String(vals[i][0]) === String(oldPlate)) {
        vals[i][0] = newPlate;
        changed = true;
        count++;
      }
    }
    if (changed) range.setValues(vals);
  });
  return count;
}

/* ===================== UTILS ===================== */
function uid_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}
function nowIso_() {
  return new Date().toISOString();
}
function todayCompact_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Kuala_Lumpur', 'yyyyMMdd');
}

/* ===================== AUDIT ===================== */
function logAudit_(action, recordType, recordId, details) {
  const email = (Session.getActiveUser().getEmail() || 'unknown').toLowerCase();
  ss_().getSheetByName(SHEETS.AUDIT).appendRow([
    nowIso_(), email, action, recordType, recordId, details || '',
  ]);
}

/* ===================== PHOTO STORAGE (DRIVE) ===================== */
function getPhotoFolder_() {
  const props = PropertiesService.getScriptProperties();
  let folderId = props.getProperty('PHOTO_FOLDER_ID');
  let folder = null;
  if (folderId) {
    try { folder = DriveApp.getFolderById(folderId); }
    catch (e) { folder = null; }
  }
  if (!folder) {
    folder = DriveApp.createFolder(PHOTO_FOLDER_NAME);
    try {
      folder.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (e) {
      // Some Workspaces restrict DOMAIN_WITH_LINK. Fallback to ANYONE_WITH_LINK
      // (still gated by Workspace SSO on the photo URL itself for viewers).
    }
    props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  }
  return folder;
}

function getMonthlySubfolder_() {
  const root = getPhotoFolder_();
  const ym = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Kuala_Lumpur', 'yyyy-MM');
  const it = root.getFoldersByName(ym);
  if (it.hasNext()) return it.next();
  return root.createFolder(ym);
}

/**
 * getVehicleFolder_(plate)
 *   Returns (creates if missing) a subfolder dedicated to one vehicle.
 *   Structure:  Black Lee — Lorry Photos / Vehicles / {PLATE}
 *   All photos uploaded with a plate parameter land here, consolidating each
 *   lorry's full history (compliance, maintenance, receipts) under one folder.
 */
function getVehicleFolder_(plate) {
  const safePlate = String(plate || '').replace(/[\\/:?"<>|]/g, '_').trim();
  if (!safePlate) return getMonthlySubfolder_();
  const root = getPhotoFolder_();
  let vehRoot;
  const vIter = root.getFoldersByName('Vehicles');
  if (vIter.hasNext()) vehRoot = vIter.next();
  else vehRoot = root.createFolder('Vehicles');
  const sub = vehRoot.getFoldersByName(safePlate);
  if (sub.hasNext()) return sub.next();
  return vehRoot.createFolder(safePlate);
}

/** Optional: expose vehicle folder URL to client for the Lorries tab */
function getVehicleFolderUrl(plate) {
  requireDomain_();
  if (!plate) return '';
  return getVehicleFolder_(plate).getUrl();
}

/**
 * uploadPhoto({dataUrl, name})
 *   Accepts a data: URL for an image OR PDF, saves it to Drive,
 *   returns { fileId }. Client computes the view/thumb URL from fileId.
 */
function uploadPhoto(payload) {
  requireDomain_();
  if (!payload || !payload.dataUrl) throw new Error('No file data');
  const match = String(payload.dataUrl).match(/^data:(image\/[a-z0-9+]+|application\/pdf);base64,(.+)$/i);
  if (!match) throw new Error('Only images and PDFs are supported.');
  const mime = match[1];
  const ext = mime === 'application/pdf' ? 'pdf' : mime.split('/')[1].replace('jpeg', 'jpg');
  const bytes = Utilities.base64Decode(match[2]);
  const safeName = (payload.name || 'file').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 60);
  const filename = todayCompact_() + '_' + safeName + '_' + uid_().slice(0, 6) + '.' + ext;
  const blob = Utilities.newBlob(bytes, mime, filename);
  // Route to per-vehicle folder when caller supplies plate, else fall back to monthly bucket
  const folder = payload.plate ? getVehicleFolder_(payload.plate) : getMonthlySubfolder_();
  const file = folder.createFile(blob);
  return { fileId: file.getId() };
}

function deletePhoto_(fileId) {
  if (!fileId) return;
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
  } catch (e) {
    // file may already be gone; swallow
  }
}

/* ===================== HEADER SELF-HEAL ===================== */
/**
 * forceHeaderAlignment_()
 *   Idempotent. On every read, force row 1 of each known sheet to match
 *   the canonical HEADERS list. Fixes any legacy sheets where an earlier
 *   bad migration inserted columns in the middle and shifted labels.
 *   Data rows are never touched — only labels are realigned.
 *   Safe to run repeatedly: if labels already match, it's a no-op.
 */
function forceHeaderAlignment_() {
  const ss = ss_();
  Object.keys(HEADERS).forEach(function(name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    const expected = HEADERS[name];
    const lastCol = sheet.getLastColumn();
    // Empty sheet — write headers fresh
    if (lastCol === 0) {
      sheet.getRange(1, 1, 1, expected.length).setValues([expected]).setFontWeight('bold');
      sheet.setFrozenRows(1);
      return;
    }
    // Read current headers (pad to expected length if shorter)
    const readCols = Math.max(lastCol, expected.length);
    const current = sheet.getRange(1, 1, 1, readCols).getValues()[0];
    let needsRewrite = false;
    for (let i = 0; i < expected.length; i++) {
      if (String(current[i] || '') !== expected[i]) { needsRewrite = true; break; }
    }
    if (!needsRewrite) return;
    sheet.getRange(1, 1, 1, expected.length).setValues([expected]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  });
}

/**
 * repairHeadersNow()
 *   Public, editor-callable safety net. Forces row 1 of every sheet to
 *   match HEADERS. Returns a short summary string so the Apps Script
 *   editor's Logger panel can render it without choking.
 */
function repairHeadersNow() {
  const email = requireDomain_();
  ensureSheets_();
  forceHeaderAlignment_();
  const summary = Object.keys(HEADERS).map(function(name) {
    const s = ss_().getSheetByName(name);
    return name + ': ' + (s ? s.getLastColumn() + ' cols' : 'missing');
  }).join(' · ');
  Logger.log('Headers repaired by ' + email + ' — ' + summary);
  return 'OK — ' + summary;
}

/* ===================== PUBLIC API — READ ===================== */
function getAllData() {
  const email = requireDomain_();
  ensureSheets_();
  // Self-heal headers on every load — guarantees the labels match HEADERS
  // even after legacy sheets carried over a broken middle-insertion migration.
  forceHeaderAlignment_();
  return {
    currentUser: email,
    serverTime:  nowIso_(),
    domain:      ALLOWED_DOMAIN,
    lorries:     readSheet_(SHEETS.LORRIES),
    fuel:        readSheet_(SHEETS.FUEL),
    toll:        readSheet_(SHEETS.TOLLPARK),
    maint:       readSheet_(SHEETS.MAINT),
    compliance:  readSheet_(SHEETS.COMPLIANCE),
    incidents:   readSheet_(SHEETS.INCIDENTS),
    drivers:     readSheet_(SHEETS.DRIVERS),
    summons:     readSheet_(SHEETS.SUMMONS),
  };
}

/* ===================== LORRIES ===================== */
function saveLorry(payload) {
  const email = requireDomain_();
  if (!payload || !payload.plate) throw new Error('Plate is required.');
  const plate = String(payload.plate).trim();
  const id = payload.id || uid_();

  // Detect plate-rename to update existing logs
  let oldPlate = null;
  const cur = readSheet_(SHEETS.LORRIES).find(l => l.id === id);
  if (cur) oldPlate = cur.plate;

  // If vehicle card photo was replaced, trash the old one
  if (cur && cur.vehicleCardPhotoId && cur.vehicleCardPhotoId !== payload.vehicleCardPhotoId) {
    deletePhoto_(cur.vehicleCardPhotoId);
  }

  const rec = {
    id,
    plate,
    vehicleCode: String(payload.vehicleCode || '').trim(),
    model: String(payload.model || '').trim(),
    year:  payload.year ? Number(payload.year) : '',
    active: payload.active === false ? false : true,
    notes: String(payload.notes || '').trim(),
    vehicleCardPhotoId: payload.vehicleCardPhotoId || '',
    vehicleType: VEHICLE_TYPES.indexOf(payload.vehicleType) >= 0 ? payload.vehicleType : 'lorry',
    createdAt: (cur && cur.createdAt) ? cur.createdAt : nowIso_(),
    createdBy: (cur && cur.createdBy) ? cur.createdBy : email,
    updatedAt: nowIso_(),
    updatedBy: email,
  };

  const existingRow = findRowIndexById_(SHEETS.LORRIES, id);
  if (existingRow >= 2) {
    updateRecord_(SHEETS.LORRIES, id, rec);
    if (oldPlate && oldPlate !== plate) {
      const n = updatePlateAcrossLogs_(oldPlate, plate);
      logAudit_('UPDATE', 'Lorry', id, 'Plate ' + oldPlate + ' → ' + plate + ' (' + n + ' logs migrated)');
    } else {
      logAudit_('UPDATE', 'Lorry', id, plate);
    }
  } else {
    appendRecord_(SHEETS.LORRIES, rec);
    logAudit_('CREATE', 'Lorry', id, plate);
  }
  return getAllData();
}

/**
 * deleteLorry(id, mode)
 *   mode = 'soft' → set active=false, keep logs
 *   mode = 'hard' → remove lorry + all its logs + all its photos
 */
function deleteLorry(id, mode) {
  const email = requireDomain_();
  const lorry = readSheet_(SHEETS.LORRIES).find(l => l.id === id);
  if (!lorry) throw new Error('Lorry not found.');
  const plate = lorry.plate;

  if (mode === 'soft') {
    const rec = Object.assign({}, lorry, { active: false, updatedAt: nowIso_(), updatedBy: email });
    updateRecord_(SHEETS.LORRIES, id, rec);
    logAudit_('SOFT_DELETE', 'Lorry', id, plate);
    return getAllData();
  }

  // Hard delete: trash all photos, delete all logs, delete lorry
  if (lorry.vehicleCardPhotoId) deletePhoto_(lorry.vehicleCardPhotoId);
  ['fuel','toll','maint','compliance','incidents','summons'].forEach(kind => {
    let rows = [];
    let sheetName = '';
    if (kind === 'fuel')       { rows = readSheet_(SHEETS.FUEL).filter(r => r.plate === plate);       sheetName = SHEETS.FUEL; }
    if (kind === 'toll')       { rows = readSheet_(SHEETS.TOLLPARK).filter(r => r.plate === plate);   sheetName = SHEETS.TOLLPARK; }
    if (kind === 'maint')      { rows = readSheet_(SHEETS.MAINT).filter(r => r.plate === plate);      sheetName = SHEETS.MAINT; }
    if (kind === 'compliance') { rows = readSheet_(SHEETS.COMPLIANCE).filter(r => r.plate === plate); sheetName = SHEETS.COMPLIANCE; }
    if (kind === 'incidents')  { rows = readSheet_(SHEETS.INCIDENTS).filter(r => r.plate === plate);  sheetName = SHEETS.INCIDENTS; }
    if (kind === 'summons')    { rows = readSheet_(SHEETS.SUMMONS).filter(r => r.plate === plate);    sheetName = SHEETS.SUMMONS; }
    rows.forEach(r => {
      if (r.pumpPhotoId)    deletePhoto_(r.pumpPhotoId);
      if (r.receiptPhotoId) deletePhoto_(r.receiptPhotoId);
      ['receiptPhotoIds','beforePhotoIds','afterPhotoIds','mainDocIds','receiptIds','agentInvoiceIds','paymentSlipIds',
       'incidentPhotoIds','policeReportIds','quotationIds','compensationPaidIds','compensationReceivedIds',
       'paymentProofIds','summonCopyIds'].forEach(field => {
        if (r[field]) {
          try {
            const a = JSON.parse(r[field]);
            if (Array.isArray(a)) a.forEach(deletePhoto_);
          } catch (e) {}
        }
      });
    });
    deleteRowsByPlate_(sheetName, plate);
  });
  deleteRecordById_(SHEETS.LORRIES, id);
  logAudit_('HARD_DELETE', 'Lorry', id, plate);
  return getAllData();
}

/* ===================== FUEL ===================== */
function saveFuel(payload) {
  const email = requireDomain_();
  if (!payload || !payload.date || !payload.plate) throw new Error('Date and plate required.');
  const amount = Number(payload.amountRM);
  if (isNaN(amount) || amount < 0) throw new Error('Amount (RM) required.');

  const id = payload.id || uid_();
  const cur = readSheet_(SHEETS.FUEL).find(r => r.id === id);

  // If photo IDs changed (old photo removed/replaced) trash the old file
  if (cur) {
    if (cur.pumpPhotoId    && cur.pumpPhotoId    !== payload.pumpPhotoId)    deletePhoto_(cur.pumpPhotoId);
    if (cur.receiptPhotoId && cur.receiptPhotoId !== payload.receiptPhotoId) deletePhoto_(cur.receiptPhotoId);
  }

  const rec = {
    id,
    date:           String(payload.date),
    plate:          String(payload.plate),
    odometer:       payload.odometer != null && payload.odometer !== '' ? Number(payload.odometer) : '',
    litres:         payload.litres   != null && payload.litres   !== '' ? Number(payload.litres)   : '',
    amountRM:       amount,
    station:        String(payload.station || '').trim(),
    paidBy:         String(payload.paidBy || '').trim(),
    driver:         String(payload.driver || '').trim(),
    notes:          String(payload.notes || '').trim(),
    pumpPhotoId:    payload.pumpPhotoId    || '',
    receiptPhotoId: payload.receiptPhotoId || '',
    createdAt:      (cur && cur.createdAt) ? cur.createdAt : nowIso_(),
    createdBy:      (cur && cur.createdBy) ? cur.createdBy : email,
    updatedAt:      nowIso_(),
    updatedBy:      email,
  };

  if (findRowIndexById_(SHEETS.FUEL, id) >= 2) {
    updateRecord_(SHEETS.FUEL, id, rec);
    logAudit_('UPDATE', 'Fuel', id, rec.plate + ' ' + rec.date + ' RM' + rec.amountRM);
  } else {
    appendRecord_(SHEETS.FUEL, rec);
    logAudit_('CREATE', 'Fuel', id, rec.plate + ' ' + rec.date + ' RM' + rec.amountRM);
  }
  return getAllData();
}

function deleteFuel(id) {
  requireDomain_();
  const cur = readSheet_(SHEETS.FUEL).find(r => r.id === id);
  if (!cur) return getAllData();
  if (cur.pumpPhotoId)    deletePhoto_(cur.pumpPhotoId);
  if (cur.receiptPhotoId) deletePhoto_(cur.receiptPhotoId);
  deleteRecordById_(SHEETS.FUEL, id);
  logAudit_('DELETE', 'Fuel', id, cur.plate + ' ' + cur.date);
  return getAllData();
}

/* ===================== TOLL & PARKING ===================== */
function saveToll(payload) {
  const email = requireDomain_();
  if (!payload || !payload.date || !payload.plate || !payload.type) {
    throw new Error('Date, plate, and type required.');
  }
  const amount = Number(payload.amountRM);
  if (isNaN(amount) || amount < 0) throw new Error('Amount (RM) required.');

  const id = payload.id || uid_();
  const cur = readSheet_(SHEETS.TOLLPARK).find(r => r.id === id);

  if (cur && cur.receiptPhotoId && cur.receiptPhotoId !== payload.receiptPhotoId) {
    deletePhoto_(cur.receiptPhotoId);
  }

  const rec = {
    id,
    date:           String(payload.date),
    plate:          String(payload.plate),
    type:           String(payload.type), // 'toll' | 'parking'
    amountRM:       amount,
    location:       String(payload.location || '').trim(),
    paidBy:         String(payload.paidBy || '').trim(),
    driver:         String(payload.driver || '').trim(),
    jobRef:         String(payload.jobRef || '').trim(),
    duration:       String(payload.duration || '').trim(),
    notes:          String(payload.notes || '').trim(),
    receiptPhotoId: payload.receiptPhotoId || '',
    createdAt:      (cur && cur.createdAt) ? cur.createdAt : nowIso_(),
    createdBy:      (cur && cur.createdBy) ? cur.createdBy : email,
    updatedAt:      nowIso_(),
    updatedBy:      email,
  };

  if (findRowIndexById_(SHEETS.TOLLPARK, id) >= 2) {
    updateRecord_(SHEETS.TOLLPARK, id, rec);
    logAudit_('UPDATE', 'TollPark', id, rec.plate + ' ' + rec.type + ' RM' + rec.amountRM);
  } else {
    appendRecord_(SHEETS.TOLLPARK, rec);
    logAudit_('CREATE', 'TollPark', id, rec.plate + ' ' + rec.type + ' RM' + rec.amountRM);
  }
  return getAllData();
}

function deleteToll(id) {
  requireDomain_();
  const cur = readSheet_(SHEETS.TOLLPARK).find(r => r.id === id);
  if (!cur) return getAllData();
  if (cur.receiptPhotoId) deletePhoto_(cur.receiptPhotoId);
  deleteRecordById_(SHEETS.TOLLPARK, id);
  logAudit_('DELETE', 'TollPark', id, cur.plate + ' ' + cur.type);
  return getAllData();
}

/* ===================== MAINTENANCE ===================== */
function saveMaint(payload) {
  const email = requireDomain_();
  if (!payload || !payload.date || !payload.plate) throw new Error('Date and plate required.');
  const odo = Number(payload.odometer);
  if (isNaN(odo) || odo < 0) throw new Error('Odometer is required for maintenance.');

  // Normalise line items (new) — falls back to legacy itemsReplaced text if empty
  let lineItems = Array.isArray(payload.lineItems) ? payload.lineItems : [];
  lineItems = lineItems
    .map(l => ({
      desc: String(l.desc || '').trim(),
      qty:  Number(l.qty)  || 0,
      rate: Number(l.rate) || 0,
      tax:  Math.max(0, Number(l.tax) || 0),  // per-line tax % (e.g. 0, 6, 8)
    }))
    .filter(l => l.desc || l.qty > 0 || l.rate > 0);

  // Recompute totals server-side (don't trust client math). Per-line tax model.
  const subTotal     = lineItems.reduce((s, l) => s + l.qty * l.rate, 0);
  const perLineTax   = lineItems.reduce((s, l) => s + l.qty * l.rate * (l.tax / 100), 0);
  const discountAmount = Math.max(0, Number(payload.discountAmount) || 0);

  // Legacy invoice-level toggle still honoured if no per-line tax is set
  const taxable     = !!payload.taxable;
  const legacyRate  = Number(payload.taxRate);
  const safeTaxRate = (isNaN(legacyRate) || legacyRate < 0) ? 0.06 : legacyRate;
  const legacyTax   = (perLineTax === 0 && taxable) ? subTotal * safeTaxRate : 0;
  const taxAmount   = perLineTax > 0 ? perLineTax : legacyTax;

  let cost;
  if (lineItems.length > 0) {
    cost = Math.max(0, subTotal + taxAmount - discountAmount);
  } else {
    // No line items — accept a raw costRM from client (legacy flow)
    cost = Number(payload.costRM);
    if (isNaN(cost) || cost < 0) throw new Error('Either add line items or fill the Cost (RM) field.');
  }

  // Derive a flat itemsReplaced string for searchability in the Sheet
  const itemsReplacedStr = lineItems.length
    ? lineItems.map(l => l.qty > 1 ? (l.qty + 'x ' + l.desc) : l.desc).filter(Boolean).join('\n')
    : String(payload.itemsReplaced || '').trim();

  const id = payload.id || uid_();
  const cur = readSheet_(SHEETS.MAINT).find(r => r.id === id);

  // Normalise incoming photo IDs (supports both new array + legacy single field)
  let newIds = [];
  if (Array.isArray(payload.receiptPhotoIds)) {
    newIds = payload.receiptPhotoIds.filter(x => x);
  } else if (payload.receiptPhotoId) {
    newIds = [payload.receiptPhotoId];
  }
  const newBeforeIds  = Array.isArray(payload.beforePhotoIds)  ? payload.beforePhotoIds.filter(x => x)  : [];
  const newAfterIds   = Array.isArray(payload.afterPhotoIds)   ? payload.afterPhotoIds.filter(x => x)   : [];
  const newPaySlipIds = Array.isArray(payload.paymentSlipIds)  ? payload.paymentSlipIds.filter(x => x)  : [];

  // Detect removed photos in any list and trash them in Drive
  function diffTrash_(curJsonField, curSingleField, newArr) {
    let oldIds = [];
    if (cur && cur[curJsonField]) {
      try { const a = JSON.parse(cur[curJsonField]); if (Array.isArray(a)) oldIds = a; } catch (e) {}
    }
    if (!oldIds.length && cur && curSingleField && cur[curSingleField]) oldIds = [cur[curSingleField]];
    const keep = {};
    newArr.forEach(x => { keep[x] = true; });
    oldIds.forEach(oldId => { if (!keep[oldId]) deletePhoto_(oldId); });
  }
  if (cur) {
    diffTrash_('receiptPhotoIds', 'receiptPhotoId', newIds);
    diffTrash_('beforePhotoIds',  null,             newBeforeIds);
    diffTrash_('afterPhotoIds',   null,             newAfterIds);
    diffTrash_('paymentSlipIds',  null,             newPaySlipIds);
  }

  const rec = {
    id,
    date:            String(payload.date),
    plate:           String(payload.plate),
    odometer:        odo,
    type:            String(payload.type || 'service'),
    itemsReplaced:   itemsReplacedStr,
    workshop:        String(payload.workshop || '').trim(),
    costRM:          cost,
    nextServiceKm:   payload.nextServiceKm != null && payload.nextServiceKm !== '' ? Number(payload.nextServiceKm) : '',
    nextServiceDate: String(payload.nextServiceDate || '').trim(),
    notes:           String(payload.notes || '').trim(),
    receiptPhotoId:  newIds[0] || '',                              // legacy single field — first ID
    receiptPhotoIds: newIds.length ? JSON.stringify(newIds) : '',  // canonical list
    beforePhotoIds:  newBeforeIds.length  ? JSON.stringify(newBeforeIds)  : '',
    afterPhotoIds:   newAfterIds.length   ? JSON.stringify(newAfterIds)   : '',
    paymentSlipIds:  newPaySlipIds.length ? JSON.stringify(newPaySlipIds) : '',
    lineItems:       lineItems.length ? JSON.stringify(lineItems) : '',
    subTotal:        lineItems.length ? subTotal : '',
    // taxable now derived: true if any line has tax > 0, OR legacy invoice-level toggle is on
    taxable:         lineItems.length ? (perLineTax > 0 || taxable) : '',
    taxRate:         lineItems.length && perLineTax === 0 && taxable ? safeTaxRate : '',
    taxAmount:       lineItems.length ? taxAmount : '',
    discountAmount:  lineItems.length ? discountAmount : '',
    invoiceNumber:   String(payload.invoiceNumber || '').trim(),
    paidRM:          payload.paidRM != null && payload.paidRM !== '' ? Math.max(0, Number(payload.paidRM) || 0) : '',
    // Preserve any prior bulk-pay metadata if not in payload
    paymentRef:      payload.paymentRef != null ? String(payload.paymentRef || '').trim() : (cur && cur.paymentRef ? cur.paymentRef : ''),
    paidDate:        payload.paidDate   != null ? String(payload.paidDate   || '').trim() : (cur && cur.paidDate   ? cur.paidDate   : ''),
    createdAt:       (cur && cur.createdAt) ? cur.createdAt : nowIso_(),
    createdBy:       (cur && cur.createdBy) ? cur.createdBy : email,
    updatedAt:       nowIso_(),
    updatedBy:       email,
  };

  if (findRowIndexById_(SHEETS.MAINT, id) >= 2) {
    updateRecord_(SHEETS.MAINT, id, rec);
    logAudit_('UPDATE', 'Maint', id, rec.plate + ' ' + rec.type + ' RM' + rec.costRM);
  } else {
    appendRecord_(SHEETS.MAINT, rec);
    logAudit_('CREATE', 'Maint', id, rec.plate + ' ' + rec.type + ' RM' + rec.costRM);
  }
  return getAllData();
}

function deleteMaint(id) {
  requireDomain_();
  const cur = readSheet_(SHEETS.MAINT).find(r => r.id === id);
  if (!cur) return getAllData();
  function collectIds_(jsonField, singleField) {
    let arr = [];
    if (cur[jsonField]) {
      try { const a = JSON.parse(cur[jsonField]); if (Array.isArray(a)) arr = a; } catch (e) {}
    }
    if (!arr.length && singleField && cur[singleField]) arr = [cur[singleField]];
    return arr;
  }
  collectIds_('receiptPhotoIds', 'receiptPhotoId').forEach(deletePhoto_);
  collectIds_('beforePhotoIds',  null).forEach(deletePhoto_);
  collectIds_('afterPhotoIds',   null).forEach(deletePhoto_);
  collectIds_('paymentSlipIds',  null).forEach(deletePhoto_);
  deleteRecordById_(SHEETS.MAINT, id);
  logAudit_('DELETE', 'Maint', id, cur.plate + ' ' + cur.type);
  return getAllData();
}

/* ===================== COMPLIANCE (Road Tax / Insurance / Puspakom) ===================== */
function saveCompliance(payload) {
  const email = requireDomain_();
  if (!payload || !payload.plate || !payload.type) throw new Error('Plate and type required.');
  if (COMPLIANCE_TYPES.indexOf(payload.type) < 0) throw new Error('Invalid compliance type: ' + payload.type);
  if (!payload.issuedDate || !payload.expiryDate) throw new Error('Issued date and expiry date required.');

  const id = payload.id || uid_();
  const cur = readSheet_(SHEETS.COMPLIANCE).find(r => r.id === id);

  const mainDocIds      = Array.isArray(payload.mainDocIds)      ? payload.mainDocIds.filter(x => x)      : [];
  const receiptIds      = Array.isArray(payload.receiptIds)      ? payload.receiptIds.filter(x => x)      : [];
  const agentInvoiceIds = Array.isArray(payload.agentInvoiceIds) ? payload.agentInvoiceIds.filter(x => x) : [];
  const paymentSlipIds  = Array.isArray(payload.paymentSlipIds)  ? payload.paymentSlipIds.filter(x => x)  : [];

  // Diff trash removed photos
  function diffTrash_(field, newArr) {
    if (!cur || !cur[field]) return;
    let oldIds = [];
    try { const a = JSON.parse(cur[field]); if (Array.isArray(a)) oldIds = a; } catch (e) {}
    const keep = {};
    newArr.forEach(x => { keep[x] = true; });
    oldIds.forEach(oldId => { if (!keep[oldId]) deletePhoto_(oldId); });
  }
  diffTrash_('mainDocIds', mainDocIds);
  diffTrash_('receiptIds', receiptIds);
  diffTrash_('agentInvoiceIds', agentInvoiceIds);
  diffTrash_('paymentSlipIds', paymentSlipIds);

  // Status defaults to 'active' for new entries; preserve existing on edit unless explicitly set
  const allowedStatuses = ['active','renewed','cancelled','lost','archived'];
  let status = String(payload.status || (cur && cur.status) || 'active').toLowerCase();
  if (allowedStatuses.indexOf(status) < 0) status = 'active';

  const rec = {
    id,
    plate:            String(payload.plate),
    type:             String(payload.type),
    status:           status,
    issuedDate:       String(payload.issuedDate),
    expiryDate:       String(payload.expiryDate),
    amountRM:         Number(payload.amountRM) || 0,
    coverageRM:       payload.coverageRM != null && payload.coverageRM !== '' ? Number(payload.coverageRM) : '',
    insurer:          String(payload.insurer || '').trim(),
    policyNumber:     String(payload.policyNumber || '').trim(),
    agencyName:       String(payload.agencyName || '').trim(),
    agencyChargesRM:  payload.agencyChargesRM != null && payload.agencyChargesRM !== '' ? Number(payload.agencyChargesRM) : '',
    notes:            String(payload.notes || '').trim(),
    renewedById:      String(payload.renewedById || (cur && cur.renewedById) || ''),
    prevId:           String(payload.prevId || (cur && cur.prevId) || ''),
    mainDocIds:       mainDocIds.length      ? JSON.stringify(mainDocIds)      : '',
    receiptIds:       receiptIds.length      ? JSON.stringify(receiptIds)      : '',
    agentInvoiceIds:  agentInvoiceIds.length ? JSON.stringify(agentInvoiceIds) : '',
    paymentSlipIds:   paymentSlipIds.length  ? JSON.stringify(paymentSlipIds)  : '',
    createdAt:        cur && cur.createdAt ? cur.createdAt : nowIso_(),
    createdBy:        cur && cur.createdBy ? cur.createdBy : email,
    updatedAt:        nowIso_(),
    updatedBy:        email,
  };

  if (findRowIndexById_(SHEETS.COMPLIANCE, id) >= 2) {
    updateRecord_(SHEETS.COMPLIANCE, id, rec);
    logAudit_('UPDATE', 'Compliance', id, rec.plate + ' ' + rec.type + ' ' + rec.status + ' exp ' + rec.expiryDate);
  } else {
    appendRecord_(SHEETS.COMPLIANCE, rec);
    logAudit_('CREATE', 'Compliance', id, rec.plate + ' ' + rec.type + ' exp ' + rec.expiryDate);
  }

  // If this new entry was created via "Renew" workflow → mark the old one as 'renewed' and link
  if (payload.prevId) {
    const prevRow = readSheet_(SHEETS.COMPLIANCE).find(r => r.id === payload.prevId);
    if (prevRow) {
      const updated = Object.assign({}, prevRow, {
        status:      'renewed',
        renewedById: id,
        updatedAt:   nowIso_(),
        updatedBy:   email,
      });
      updateRecord_(SHEETS.COMPLIANCE, prevRow.id, updated);
      logAudit_('STATUS', 'Compliance', prevRow.id, 'renewed → ' + id);
    }
  }
  return getAllData();
}

/**
 * setComplianceStatus(id, status)
 *   Lightweight status-only change (renewed / cancelled / lost / archived / active).
 *   For "Renew" workflow use saveCompliance with payload.prevId instead.
 */
function setComplianceStatus(id, status) {
  const email = requireDomain_();
  const allowed = ['active','renewed','cancelled','lost','archived'];
  if (allowed.indexOf(status) < 0) throw new Error('Invalid status: ' + status);
  const cur = readSheet_(SHEETS.COMPLIANCE).find(r => r.id === id);
  if (!cur) throw new Error('Entry not found.');
  const rec = Object.assign({}, cur, { status: status, updatedAt: nowIso_(), updatedBy: email });
  updateRecord_(SHEETS.COMPLIANCE, id, rec);
  logAudit_('STATUS', 'Compliance', id, cur.plate + ' ' + cur.type + ' → ' + status);
  return getAllData();
}

function deleteCompliance(id) {
  requireDomain_();
  const cur = readSheet_(SHEETS.COMPLIANCE).find(r => r.id === id);
  if (!cur) return getAllData();
  ['mainDocIds','receiptIds','agentInvoiceIds','paymentSlipIds'].forEach(field => {
    if (cur[field]) {
      try { const a = JSON.parse(cur[field]); if (Array.isArray(a)) a.forEach(deletePhoto_); } catch (e) {}
    }
  });
  deleteRecordById_(SHEETS.COMPLIANCE, id);
  logAudit_('DELETE', 'Compliance', id, cur.plate + ' ' + cur.type);
  return getAllData();
}

/* ===================== DRIVERS ===================== */
const DRIVER_STATUSES   = ['active','on-leave','resigned','terminated'];
const DRIVER_CATEGORIES = ['in-house','outsourced','relief','contract'];

/** Per-driver Drive folder so license + ID docs stay grouped */
function getDriverFolder_(driverNameOrId) {
  const safe = String(driverNameOrId || 'unknown').replace(/[\\/:?"<>|]/g, '_').trim();
  if (!safe) return getMonthlySubfolder_();
  const root = getPhotoFolder_();
  let drvRoot;
  const it = root.getFoldersByName('Drivers');
  if (it.hasNext()) drvRoot = it.next();
  else drvRoot = root.createFolder('Drivers');
  const sub = drvRoot.getFoldersByName(safe);
  if (sub.hasNext()) return sub.next();
  return drvRoot.createFolder(safe);
}

function saveDriver(payload) {
  const email = requireDomain_();
  if (!payload || !payload.name) throw new Error('Driver name is required.');

  const id  = payload.id || uid_();
  const cur = readSheet_(SHEETS.DRIVERS).find(function(r) { return r.id === id; });

  // Multi-file fields: diff and trash removed photos
  function diffDriverDocs_(field, newArr) {
    if (!cur || !cur[field]) return;
    let oldArr = [];
    try { const a = JSON.parse(cur[field]); if (Array.isArray(a)) oldArr = a; } catch (e) {}
    const keep = {};
    newArr.forEach(function(x) { keep[x] = true; });
    oldArr.forEach(function(oldId) { if (!keep[oldId]) deletePhoto_(oldId); });
  }
  const newLicenseDocs = Array.isArray(payload.licenseDocIds)
    ? payload.licenseDocIds.filter(function(x) { return x; }) : [];
  const newIcDocs = Array.isArray(payload.icDocIds)
    ? payload.icDocIds.filter(function(x) { return x; }) : [];
  diffDriverDocs_('licenseDocIds', newLicenseDocs);
  diffDriverDocs_('icDocIds',      newIcDocs);
  // Single photo
  if (cur && cur.photoId && cur.photoId !== payload.photoId) {
    deletePhoto_(cur.photoId);
  }

  function clean(v) { return v == null ? '' : String(v).trim(); }
  const status   = DRIVER_STATUSES.indexOf(payload.status) >= 0 ? payload.status : 'active';
  const category = DRIVER_CATEGORIES.indexOf(payload.category) >= 0 ? payload.category : 'in-house';
  const isActive = status === 'active' || status === 'on-leave';

  const rec = {
    id,
    name:                  clean(payload.name),
    icNumber:              clean(payload.icNumber),
    staffId:               clean(payload.staffId),
    phone:                 clean(payload.phone),
    email:                 clean(payload.email),
    active:                isActive,
    licenseClass:          clean(payload.licenseClass),
    licenseNumber:         clean(payload.licenseNumber),
    licenseIssueDate:      clean(payload.licenseIssueDate),
    licenseExpiryDate:     clean(payload.licenseExpiryDate),
    gdlExpiryDate:         clean(payload.gdlExpiryDate),
    address:               clean(payload.address),
    emergencyContactName:  clean(payload.emergencyContactName),
    emergencyContactPhone: clean(payload.emergencyContactPhone),
    hireDate:              clean(payload.hireDate),
    assignedPlate:         clean(payload.assignedPlate),
    status:                status,
    notes:                 clean(payload.notes),
    photoId:               payload.photoId || '',
    licenseDocIds:         newLicenseDocs.length ? JSON.stringify(newLicenseDocs) : '',
    icDocIds:              newIcDocs.length      ? JSON.stringify(newIcDocs)      : '',
    category:              category,
    createdAt:             cur && cur.createdAt ? cur.createdAt : nowIso_(),
    createdBy:             cur && cur.createdBy ? cur.createdBy : email,
    updatedAt:             nowIso_(),
    updatedBy:             email,
  };

  if (findRowIndexById_(SHEETS.DRIVERS, id) >= 2) {
    updateRecord_(SHEETS.DRIVERS, id, rec);
    logAudit_('UPDATE', 'Driver', id, rec.name + ' ' + rec.status);
  } else {
    appendRecord_(SHEETS.DRIVERS, rec);
    logAudit_('CREATE', 'Driver', id, rec.name);
  }
  return getAllData();
}

function deleteDriver(id) {
  requireDomain_();
  const cur = readSheet_(SHEETS.DRIVERS).find(function(r) { return r.id === id; });
  if (!cur) return getAllData();
  if (cur.photoId) deletePhoto_(cur.photoId);
  ['licenseDocIds','icDocIds'].forEach(function(f) {
    if (cur[f]) {
      try { const a = JSON.parse(cur[f]); if (Array.isArray(a)) a.forEach(deletePhoto_); } catch (e) {}
    }
  });
  deleteRecordById_(SHEETS.DRIVERS, id);
  logAudit_('DELETE', 'Driver', id, cur.name);
  return getAllData();
}

function getDriverFolderUrl(driverNameOrId) {
  requireDomain_();
  if (!driverNameOrId) return '';
  return getDriverFolder_(driverNameOrId).getUrl();
}

/* ===================== SUMMONS (Traffic Offences) ===================== */
const SUMMON_STATUSES = ['outstanding','paid','partially-paid','disputed','court','cancelled','blacklisted'];
const SUMMON_ISSUERS  = ['PDRM','JPJ','MBPJ','DBKL','MPSJ','MBPP','MBSA','AES','Other'];
const OFFENCE_TYPES   = ['speeding','illegal-parking','red-light','aes','no-helmet','lane-discipline','wrong-way','no-license','expired-road-tax','overload','other'];
const RESPONSIBLE_PARTIES = ['company','driver','shared'];

function saveSummon(payload) {
  const email = requireDomain_();
  if (!payload || !payload.summonNumber || !payload.issuedDate) {
    throw new Error('Summon number and issued date are required.');
  }

  const id  = payload.id || uid_();
  const cur = readSheet_(SHEETS.SUMMONS).find(function(r) { return r.id === id; });

  // Diff trash photo IDs
  function diffTrash(field, newArr) {
    if (!cur || !cur[field]) return;
    let oldIds = [];
    try { const a = JSON.parse(cur[field]); if (Array.isArray(a)) oldIds = a; } catch (e) {}
    const keep = {};
    newArr.forEach(function(x) { keep[x] = true; });
    oldIds.forEach(function(oldId) { if (!keep[oldId]) deletePhoto_(oldId); });
  }
  const newProof = Array.isArray(payload.paymentProofIds) ? payload.paymentProofIds.filter(function(x) { return x; }) : [];
  const newCopy  = Array.isArray(payload.summonCopyIds)   ? payload.summonCopyIds.filter(function(x) { return x; }) : [];
  diffTrash('paymentProofIds', newProof);
  diffTrash('summonCopyIds',   newCopy);

  function clean(v) { return v == null ? '' : String(v).trim(); }
  function num(v)   { return v == null || v === '' ? '' : (Number(v) || 0); }

  const status = SUMMON_STATUSES.indexOf(payload.status) >= 0 ? payload.status : 'outstanding';
  const responsible = RESPONSIBLE_PARTIES.indexOf(payload.responsibleParty) >= 0 ? payload.responsibleParty : 'company';

  const rec = {
    id,
    summonNumber:      clean(payload.summonNumber),
    issuedDate:        clean(payload.issuedDate),
    issuedBy:          clean(payload.issuedBy),
    plate:             clean(payload.plate),
    driverName:        clean(payload.driverName),
    driverId:          clean(payload.driverId),
    location:          clean(payload.location),
    offenceType:       clean(payload.offenceType),
    offenceDetails:    clean(payload.offenceDetails),
    fineRM:            num(payload.fineRM),
    discountRM:        num(payload.discountRM),
    discountDeadline:  clean(payload.discountDeadline),
    paymentDeadline:   clean(payload.paymentDeadline),
    status:            status,
    paidRM:            num(payload.paidRM),
    paidDate:          clean(payload.paidDate),
    paymentRef:        clean(payload.paymentRef),
    paymentProofIds:   newProof.length ? JSON.stringify(newProof) : '',
    courtDate:         clean(payload.courtDate),
    responsibleParty:  responsible,
    notes:             clean(payload.notes),
    summonCopyIds:     newCopy.length  ? JSON.stringify(newCopy)  : '',
    createdAt:         cur && cur.createdAt ? cur.createdAt : nowIso_(),
    createdBy:         cur && cur.createdBy ? cur.createdBy : email,
    updatedAt:         nowIso_(),
    updatedBy:         email,
  };

  if (findRowIndexById_(SHEETS.SUMMONS, id) >= 2) {
    updateRecord_(SHEETS.SUMMONS, id, rec);
    logAudit_('UPDATE', 'Summon', id, rec.plate + ' ' + rec.summonNumber + ' ' + rec.status);
  } else {
    appendRecord_(SHEETS.SUMMONS, rec);
    logAudit_('CREATE', 'Summon', id, rec.plate + ' ' + rec.summonNumber + ' RM' + rec.fineRM);
  }
  return getAllData();
}

function deleteSummon(id) {
  requireDomain_();
  const cur = readSheet_(SHEETS.SUMMONS).find(function(r) { return r.id === id; });
  if (!cur) return getAllData();
  ['paymentProofIds','summonCopyIds'].forEach(function(f) {
    if (cur[f]) {
      try { const a = JSON.parse(cur[f]); if (Array.isArray(a)) a.forEach(deletePhoto_); } catch (e) {}
    }
  });
  deleteRecordById_(SHEETS.SUMMONS, id);
  logAudit_('DELETE', 'Summon', id, cur.plate + ' ' + cur.summonNumber);
  return getAllData();
}

/* ===================== INCIDENTS (Accident / Theft / Vandalism / Special) ===================== */
const INCIDENT_TYPES        = ['accident','theft-vehicle','theft-parts','vandalism','parking-damage','break-in','fire','breakdown','traffic-violation','other'];
const COLLISION_TYPES       = ['none','human','car','lorry','bicycle','bus','motorcycle','building','parking-post','divider','animal','other'];
const FAULT_PARTIES         = ['ours','third-party','shared','disputed','n-a'];
const TOW_OPTIONS           = ['none','by-authority','our-arrangement','third-party'];
const INJURY_ACTIONS        = ['none','first-aid','clinic','hospital','deceased'];
const POLICE_REPORT_STATUS  = ['not-filed','to-file','filed','not-required'];
const CLAIM_STATUSES        = ['none','to-submit','submitted','approved','paid','rejected'];
const REPAIR_ACTIONS        = ['not-required','to-quote','quoted','in-progress','done'];
const INCIDENT_STATUSES     = ['open','police-pending','claim-pending','awaiting-payment-out','awaiting-payment-in','repair-pending','settled','closed'];

function saveIncident(payload) {
  const email = requireDomain_();
  if (!payload || !payload.plate || !payload.date || !payload.type) {
    throw new Error('Date, lorry, and incident type are required.');
  }
  if (INCIDENT_TYPES.indexOf(payload.type) < 0) throw new Error('Invalid incident type.');

  const id  = payload.id || uid_();
  const cur = readSheet_(SHEETS.INCIDENTS).find(function(r) { return r.id === id; });

  // Photo file ID lists — normalise to arrays and detect removed files
  const photoFields = ['incidentPhotoIds','policeReportIds','quotationIds','compensationPaidIds','compensationReceivedIds'];
  const newLists = {};
  photoFields.forEach(function(f) {
    newLists[f] = Array.isArray(payload[f]) ? payload[f].filter(function(x) { return x; }) : [];
  });
  if (cur) {
    photoFields.forEach(function(f) {
      let oldIds = [];
      if (cur[f]) {
        try { const a = JSON.parse(cur[f]); if (Array.isArray(a)) oldIds = a; } catch (e) {}
      }
      const keep = {};
      newLists[f].forEach(function(x) { keep[x] = true; });
      oldIds.forEach(function(oldId) { if (!keep[oldId]) deletePhoto_(oldId); });
    });
  }

  function clean(v) { return v == null ? '' : String(v).trim(); }
  function num(v)   { return v == null || v === '' ? '' : (Number(v) || 0); }
  function bool(v)  { return v === true || v === 'true' || v === 'TRUE' || v === 1 || v === '1'; }

  // Validate enums (fall back to safe defaults if invalid)
  const type            = INCIDENT_TYPES.indexOf(payload.type) >= 0 ? payload.type : 'other';
  const collisionType   = COLLISION_TYPES.indexOf(payload.collisionType) >= 0 ? payload.collisionType : 'none';
  const faultParty      = FAULT_PARTIES.indexOf(payload.faultParty) >= 0 ? payload.faultParty : 'n-a';
  const towed           = TOW_OPTIONS.indexOf(payload.towed) >= 0 ? payload.towed : 'none';
  const injuryAction    = INJURY_ACTIONS.indexOf(payload.injuryAction) >= 0 ? payload.injuryAction : 'none';
  const policeStatus    = POLICE_REPORT_STATUS.indexOf(payload.policeReportStatus) >= 0 ? payload.policeReportStatus : 'not-filed';
  const claimStatus     = CLAIM_STATUSES.indexOf(payload.claimStatus) >= 0 ? payload.claimStatus : 'none';
  const repairAction    = REPAIR_ACTIONS.indexOf(payload.repairAction) >= 0 ? payload.repairAction : 'not-required';
  const status          = INCIDENT_STATUSES.indexOf(payload.status) >= 0 ? payload.status : 'open';

  const rec = {
    id,
    date:                      clean(payload.date),
    time:                      clean(payload.time),
    plate:                     clean(payload.plate),
    driverName:                clean(payload.driverName),
    location:                  clean(payload.location),
    locationGps:               clean(payload.locationGps),
    type:                      type,
    collisionType:             collisionType,
    collisionOther:            clean(payload.collisionOther),
    thirdPartyPlates:          clean(payload.thirdPartyPlates),
    thirdPartyName:            clean(payload.thirdPartyName),
    thirdPartyContact:         clean(payload.thirdPartyContact),
    thirdPartyInsurer:         clean(payload.thirdPartyInsurer),
    faultParty:                faultParty,
    details:                   clean(payload.details),
    damagedAsset:              clean(payload.damagedAsset),
    witnesses:                 clean(payload.witnesses),
    towed:                     towed,
    towCompany:                clean(payload.towCompany),
    towCostRM:                 num(payload.towCostRM),
    injuryAny:                 bool(payload.injuryAny),
    injuryAction:              injuryAction,
    injuredPersonName:         clean(payload.injuredPersonName),
    hospitalName:              clean(payload.hospitalName),
    injuryDetails:             clean(payload.injuryDetails),
    policeReportStatus:        policeStatus,
    policeReportNumber:        clean(payload.policeReportNumber),
    policeStation:             clean(payload.policeStation),
    followUpNeeded:            bool(payload.followUpNeeded),
    followUpNotes:             clean(payload.followUpNotes),
    incidentPhotoIds:          newLists.incidentPhotoIds.length      ? JSON.stringify(newLists.incidentPhotoIds)      : '',
    policeReportIds:           newLists.policeReportIds.length       ? JSON.stringify(newLists.policeReportIds)       : '',
    quotationIds:              newLists.quotationIds.length          ? JSON.stringify(newLists.quotationIds)          : '',
    compensationPaidRM:        num(payload.compensationPaidRM),
    compensationPaidTo:        clean(payload.compensationPaidTo),
    compensationPaidIds:       newLists.compensationPaidIds.length   ? JSON.stringify(newLists.compensationPaidIds)   : '',
    compensationReceivedRM:    num(payload.compensationReceivedRM),
    compensationReceivedFrom:  clean(payload.compensationReceivedFrom),
    compensationReceivedIds:   newLists.compensationReceivedIds.length ? JSON.stringify(newLists.compensationReceivedIds) : '',
    insuranceClaimFiled:       bool(payload.insuranceClaimFiled),
    insuranceCompany:          clean(payload.insuranceCompany),
    claimNumber:               clean(payload.claimNumber),
    claimAmountRM:             num(payload.claimAmountRM),
    claimStatus:               claimStatus,
    repairAction:              repairAction,
    linkedMaintId:             clean(payload.linkedMaintId),
    status:                    status,
    notes:                     clean(payload.notes),
    createdAt:                 cur && cur.createdAt ? cur.createdAt : nowIso_(),
    createdBy:                 cur && cur.createdBy ? cur.createdBy : email,
    updatedAt:                 nowIso_(),
    updatedBy:                 email,
  };

  if (findRowIndexById_(SHEETS.INCIDENTS, id) >= 2) {
    updateRecord_(SHEETS.INCIDENTS, id, rec);
    logAudit_('UPDATE', 'Incident', id, rec.plate + ' ' + rec.type + ' ' + rec.status);
  } else {
    appendRecord_(SHEETS.INCIDENTS, rec);
    logAudit_('CREATE', 'Incident', id, rec.plate + ' ' + rec.type + ' ' + rec.date);
  }
  return getAllData();
}

function deleteIncident(id) {
  requireDomain_();
  const cur = readSheet_(SHEETS.INCIDENTS).find(function(r) { return r.id === id; });
  if (!cur) return getAllData();
  ['incidentPhotoIds','policeReportIds','quotationIds','compensationPaidIds','compensationReceivedIds'].forEach(function(f) {
    if (cur[f]) {
      try { const a = JSON.parse(cur[f]); if (Array.isArray(a)) a.forEach(deletePhoto_); } catch (e) {}
    }
  });
  deleteRecordById_(SHEETS.INCIDENTS, id);
  logAudit_('DELETE', 'Incident', id, cur.plate + ' ' + cur.type);
  return getAllData();
}

/* ===================== BULK PAY (knock off multiple invoices with one slip) ===================== */
/**
 * bulkMarkPaid(payload)
 *   payload = {
 *     entries:        [{ kind: 'compliance'|'maint', id: '...' }, ...],
 *     paymentSlipIds: [fileId, fileId, ...],   // slip file(s) uploaded once, applied to all
 *     paymentRef:     'CHQ-2026-0428' (optional, free-text reference),
 *     paidDate:       '2026-05-28'   (optional, defaults to today)
 *   }
 *   For each selected entry: append the slip file IDs to that entry's
 *   paymentSlipIds (dedupe), and stamp paymentRef + paidDate.
 *   The same slip can clear N bills at once — Drive file is not duplicated,
 *   only its fileId is referenced from each row.
 */
function bulkMarkPaid(payload) {
  const email = requireDomain_();
  if (!payload) throw new Error('Empty payload.');

  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  if (!entries.length) throw new Error('Select at least one bill to pay.');

  const newSlipIds = Array.isArray(payload.paymentSlipIds)
    ? payload.paymentSlipIds.filter(function(x) { return x; })
    : [];
  if (!newSlipIds.length) throw new Error('Attach at least one payment slip.');

  const paymentRef = String(payload.paymentRef || '').trim();
  const paidDate   = String(payload.paidDate || '').trim() ||
                     Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Kuala_Lumpur', 'yyyy-MM-dd');

  let updated = 0, totalRM = 0;
  const lines = [];

  entries.forEach(function(e) {
    if (!e || !e.id || !e.kind) return;
    const sheetName = e.kind === 'compliance' ? SHEETS.COMPLIANCE
                    : e.kind === 'maint'      ? SHEETS.MAINT
                    : e.kind === 'summon'     ? SHEETS.SUMMONS
                    : null;
    if (!sheetName) return;

    const cur = readSheet_(sheetName).find(function(r) { return r.id === e.id; });
    if (!cur) return;

    // Summons store payment slips under paymentProofIds (different field name)
    const slipField = e.kind === 'summon' ? 'paymentProofIds' : 'paymentSlipIds';

    // Merge with any existing slip IDs (dedupe)
    let existingSlips = [];
    if (cur[slipField]) {
      try {
        const a = JSON.parse(cur[slipField]);
        if (Array.isArray(a)) existingSlips = a;
      } catch (err) {}
    }
    const existingSet = {};
    existingSlips.forEach(function(id) { existingSet[id] = true; });
    const merged = existingSlips.concat(newSlipIds.filter(function(id) { return !existingSet[id]; }));

    const updates = Object.assign({}, cur, {
      paymentRef: paymentRef || cur.paymentRef || '',
      paidDate:   paidDate,
      updatedAt:  nowIso_(),
      updatedBy:  email,
    });
    updates[slipField] = JSON.stringify(merged);

    // For summons, also flip status to 'paid' and stamp the paid amount
    let amt = 0;
    if (e.kind === 'summon') {
      // Use discounted amount if discount deadline hasn't passed AND a discount is set
      const fine     = Number(cur.fineRM) || 0;
      const discount = Number(cur.discountRM) || 0;
      const today    = paidDate || Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Kuala_Lumpur', 'yyyy-MM-dd');
      const discountValid = cur.discountDeadline && today <= cur.discountDeadline;
      amt = discount > 0 && discountValid ? Math.max(0, fine - discount) : fine;
      updates.paidRM = amt;
      updates.status = 'paid';
    } else if (e.kind === 'compliance') {
      amt = (Number(cur.amountRM) || 0) + (Number(cur.agencyChargesRM) || 0);
    } else {
      // Maintenance — settle the full outstanding (cost − already paid). Stamps paidRM at full cost.
      const cost     = Number(cur.costRM) || 0;
      const priorPaid = Number(cur.paidRM)  || 0;
      amt = Math.max(0, cost - priorPaid);
      updates.paidRM = cost;
    }

    updateRecord_(sheetName, e.id, updates);
    totalRM += amt;
    updated++;
    lines.push((e.kind === 'compliance' ? 'C' : e.kind === 'summon' ? 'S' : 'M') + ':' + cur.plate + ':' + amt.toFixed(2));
  });

  logAudit_('BULK_PAY', 'Payment', paymentRef || 'no-ref',
    updated + ' bill(s) · RM ' + totalRM.toFixed(2) + ' · ' + paidDate + ' · ' + lines.join(', '));

  return getAllData();
}

/* ===================== MIGRATION HELPERS ===================== */
/**
 * migrateSchema()
 *   Tiny function safe to run from the Apps Script editor — it triggers
 *   sheet creation + column-append migration and returns a one-line summary.
 *   Avoids the "unknown error" you'd get if Run dropdown picks getAllData,
 *   which returns a huge object the editor can't always display.
 */
function migrateSchema() {
  const email = requireDomain_();
  ensureSheets_();
  const summary = Object.keys(HEADERS).map(function(name) {
    const s = ss_().getSheetByName(name);
    return name + ': ' + (s ? s.getLastColumn() + ' cols' : 'missing');
  }).join(' · ');
  Logger.log('User: ' + email);
  Logger.log('Sheets: ' + summary);
  return 'OK — ' + summary;
}

/**
 * pingAuth()
 *   Cheapest possible callable — returns the signed-in email.
 *   Use this to confirm the editor authorization step worked without
 *   triggering anything expensive.
 */
function pingAuth() {
  return requireDomain_();
}

/* ===================== DEV / TEST ===================== */
function _resetAllSheets_DANGER() {
  // Manual cleanup — only run from the Apps Script editor.
  // Does NOT delete photos from Drive (those stay in the photo folder).
  const ss = ss_();
  Object.keys(HEADERS).forEach(name => {
    const s = ss.getSheetByName(name);
    if (s) ss.deleteSheet(s);
  });
  ensureSheets_();
}

function _trashAllPhotos_DANGER() {
  // Trashes the entire photo folder (recoverable from Drive trash for 30 days).
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty('PHOTO_FOLDER_ID');
  if (folderId) {
    try { DriveApp.getFolderById(folderId).setTrashed(true); } catch (e) {}
    props.deleteProperty('PHOTO_FOLDER_ID');
  }
}
