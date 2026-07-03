/**
 * Black Lee - Inventory, Tools/Equipment & Purchasing (Cloud v4.0)
 *
 * v4.0 ADDS file uploads on top of v3.4c's URL-link approach:
 *   - Drag/drop image uploads on every photo field
 *   - PDF or image upload on Stock IN invoice/DO field
 *   - Multi-image delivery photos on Stock IN
 *   - Multi-image collection photos on Stock OUT
 *   - Files stored in a single Drive folder you manually set up
 *   - URL paste still works as fallback
 *
 * SCOPE: drive.file ONLY (NOT full drive) — restricts script to files it creates.
 *
 * SETUP REQUIREMENT (see DEPLOY_V4.md):
 *   1. Manually create one Drive folder
 *   2. Share with @hggroup.com.my (editor)
 *   3. Set Script Property INVENTORY_DRIVE_FOLDER_ID = <folder id>
 *
 * Every public function returns a structured response. On error it returns
 * { __serverError: '...' } — the client never receives a bare null.
 */

/* ===================== CONFIG ===================== */
const ALLOWED_DOMAIN = 'hggroup.com.my';
const VERSION = 'v4.1';
const DRIVE_FOLDER_PROP = 'INVENTORY_DRIVE_FOLDER_ID';
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB per file
const SELF_CLAIM_NAME = 'Black Lee'; // who can do self-claims (v4.1)

const SHEETS = {
  MATERIALS:        'Materials',
  SUPPLIERS:        'Suppliers',
  PURCHASES:        'Purchases',
  PURCHASE_LINES:   'PurchaseLines',
  STOCKOUTS:        'StockOuts',
  STOCKOUT_LINES:   'StockOutLines',
  QUOTATIONS:       'Quotations',
  TOOLS:            'Tools',
  TOOL_ASSIGNMENTS: 'ToolAssignments',
  REPAIRS:          'Repairs',
  STOCK_COUNTS:     'StockCounts',
  PAYMENTS:             'Payments',
  PAYMENT_ALLOCATIONS:  'PaymentAllocations',
  AUDIT:            'AuditLog',
};

const HEADERS = {
  Materials:       ['id','name','unit','category','lowStockThreshold','createdAt','createdBy','updatedAt','updatedBy','photoUrl'],
  Suppliers:       ['id','name','contact','notes','createdAt','createdBy','updatedAt','updatedBy','contactPerson','category','supplierType'],
  Purchases:       ['id','date','supplierId','doNumber','notes','createdAt','createdBy','invoiceUrl','discount','delivery','tax','roundingAdjustment','deliveryPhotos','paidBy'],
  PurchaseLines:   ['id','purchaseId','materialId','qty','rate','amount','division','requestedBy','itemType'],
  StockOuts:       ['id','dnNumber','date','division','project','notes','createdAt','createdBy','requestedBy','collectionPhotos'],
  StockOutLines:   ['id','stockOutId','materialId','qty','ratePerUnit','amount'],
  Quotations:      ['id','materialId','supplierId','rate','qtyOffered','validUntil','source','notes','createdAt','createdBy','updatedAt','updatedBy','screenshotUrl','itemType'],
  Tools:           ['id','name','category','brand','unit','totalQty','serialNumber','photoUrl','notes','createdAt','createdBy','updatedAt','updatedBy'],
  ToolAssignments: ['id','toolId','qty','person','division','assignedDate','assignedNotes','returnedDate','returnedQty','returnedCondition','returnedNotes','returnedPhotoUrl','createdAt','createdBy','updatedAt','updatedBy'],
  Repairs:         ['id','toolId','assignmentId','qty','supplierId','sentDate','sentNotes','sentPhotoUrl','status','returnedDate','returnedQty','returnedNotes','returnedPhotoUrl','createdAt','createdBy','updatedAt','updatedBy'],
  StockCounts:     ['id','countDate','itemType','itemId','systemQty','countedQty','variance','reason','notes','photoUrl','createdAt','createdBy','updatedAt','updatedBy'],
  Payments:            ['id','paymentDate','payeeType','payeeId','amount','method','referenceNumber','notes','slipPhotoUrl','createdAt','createdBy','updatedAt','updatedBy'],
  PaymentAllocations:  ['id','paymentId','purchaseId','amountApplied'],
  AuditLog:        ['timestamp','userEmail','action','recordType','recordId','details'],
};

// Auto-rename legacy column headers left from any prior deployment.
const LEGACY_COLUMN_RENAMES = {
  Materials:  { 'photoFileId':      'photoUrl' },
  Purchases:  { 'invoiceFileId':    'invoiceUrl' },
  Quotations: { 'screenshotFileId': 'screenshotUrl' },
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
  try { ensureSheets_(); } catch (e2) { console.error('ensureSheets_ failed in doGet:', e2); }
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Black Lee — Inventory, Tools/Equipment & Purchasing (v4.0)')
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
      const msg = 'Access denied. You are signed in as "' + (email || 'unknown') + '". Only @' + ALLOWED_DOMAIN + ' accounts are allowed.';
      return { __serverError: msg };
    }
    const result = fn(email);
    console.log('[' + label + '] OK');
    if (result == null) return { __serverError: '[' + label + '] returned no value.' };
    return result;
  } catch (err) {
    const msg = (err && err.message) ? err.message : String(err);
    const stack = (err && err.stack) ? err.stack : '';
    console.error('[' + label + '] FAILED:', stack || msg);
    return { __serverError: '[' + label + '] ' + msg };
  }
}

/* ===================== DRIVE UPLOAD =====================
 * Uses the Advanced Drive Service (Drive API v3) so we can stay on the
 * narrow drive.file scope. drive.file does NOT allow DriveApp.getFolderById(),
 * but it DOES allow creating a file with a parent folderId via Drive.Files.create.
 * The script creates the file, so it's allowed to manage/share it afterwards.
 */
function getConfiguredFolderId_() {
  const folderId = PropertiesService.getScriptProperties().getProperty(DRIVE_FOLDER_PROP);
  if (!folderId) {
    throw new Error('Drive folder not configured. Script Property "' + DRIVE_FOLDER_PROP +
      '" is missing. See DEPLOY_V4.md step 2.');
  }
  return folderId;
}

function isUploadConfigured_() {
  const folderId = PropertiesService.getScriptProperties().getProperty(DRIVE_FOLDER_PROP);
  return !!folderId;
}

/**
 * Upload a single file (image or PDF) to the configured Drive folder.
 * payload = { base64, mimeType, fileName }
 * Returns { ok, url, id, name, mimeType }
 */
function uploadFile(payload) {
  return safeCall_('uploadFile', email => {
    if (!payload) throw new Error('Upload payload missing.');
    const base64 = String(payload.base64 || '');
    const mimeType = String(payload.mimeType || 'application/octet-stream');
    const fileName = String(payload.fileName || ('upload-' + nowIso_()));
    if (!base64) throw new Error('No file data provided.');
    // Strip data: URI prefix if present
    const cleaned = base64.indexOf(',') >= 0 ? base64.split(',').pop() : base64;
    let bytes;
    try { bytes = Utilities.base64Decode(cleaned); }
    catch (e) { throw new Error('Could not decode file data: ' + (e.message || e)); }
    if (bytes.length > MAX_UPLOAD_BYTES) {
      throw new Error('File too large (' + Math.round(bytes.length / 1024) + ' KB). Max ' + (MAX_UPLOAD_BYTES / 1024 / 1024) + ' MB.');
    }
    const folderId = getConfiguredFolderId_();
    const safeName = fileName.replace(/[\\\/:*?"<>|]/g, '_').slice(0, 100);
    const stamped = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Kuala_Lumpur', 'yyyyMMdd-HHmmss') +
      '_' + email.split('@')[0] + '_' + safeName;
    const blob = Utilities.newBlob(bytes, mimeType, stamped);

    // Ensure AuditLog sheet exists before we try to write to it
    try { ensureSheets_(); } catch (e) { console.warn('ensureSheets_ in uploadFile (non-fatal):', e); }

    // Drive API v3 create — works under drive.file because we're creating, not opening.
    let created;
    try {
      created = Drive.Files.create(
        { name: stamped, parents: [folderId], mimeType: mimeType },
        blob,
        { fields: 'id,webViewLink,name', supportsAllDrives: true }
      );
    } catch (e) {
      throw new Error('Drive upload failed. Most likely the folder ID is wrong or the folder is not shared with you (the deployer). ' +
        'Original error: ' + (e.message || e));
    }
    if (!created || !created.id) throw new Error('Drive returned no file ID.');

    // Share with the workspace domain via Drive Advanced Service — stays inside drive.file scope.
    try {
      Drive.Permissions.create(
        { role: 'reader', type: 'domain', domain: ALLOWED_DOMAIN, allowFileDiscovery: false },
        created.id,
        { supportsAllDrives: true, sendNotificationEmail: false }
      );
    } catch (shareErr) {
      // Non-fatal — file still saved. The deployer can still open it but other staff would need explicit share.
      console.warn('Drive.Permissions.create failed (non-fatal):', shareErr);
    }
    const url = created.webViewLink || ('https://drive.google.com/file/d/' + created.id + '/view');
    logAudit_('UPLOAD', 'File', created.id, stamped + ' (' + mimeType + ', ' + bytes.length + ' bytes)');
    return {
      ok: true,
      url: url,
      id: created.id,
      name: stamped,
      mimeType: mimeType,
    };
  });
}

/* ===================== SHEET HELPERS ===================== */
function ss_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No bound spreadsheet found. Open via Extensions → Apps Script from a Google Sheet.');
  return ss;
}

function renameLegacyColumns_() {
  const ss = ss_();
  Object.keys(LEGACY_COLUMN_RENAMES).forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;
    const lastCol = sheet.getLastColumn();
    if (lastCol < 1) return;
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const renames = LEGACY_COLUMN_RENAMES[sheetName];
    headers.forEach((h, i) => {
      const newName = renames[h];
      if (!newName) return;
      if (headers.indexOf(newName) !== -1) {
        console.log('[migrate] ' + sheetName + ': skipping rename, ' + newName + ' already exists');
        return;
      }
      sheet.getRange(1, i + 1).setValue(newName);
      console.log('[migrate] ' + sheetName + ': renamed column ' + h + ' -> ' + newName);
    });
  });
}

function ensureSheets_() {
  const ss = ss_();
  renameLegacyColumns_();
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
      } else if (current.length < expected.length) {
        const startCol = current.length + 1;
        const missing = expected.slice(current.length);
        sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
        sheet.getRange(1, startCol, 1, missing.length).setFontWeight('bold');
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
  const lastCol = sheet.getLastColumn();
  const actualHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  return values
    .filter(row => row.some(v => v !== '' && v !== null))
    .map(row => {
      const obj = {};
      actualHeaders.forEach((h, i) => {
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
function rowFromRecord_(name, rec) {
  return HEADERS[name].map(h => rec[h] === undefined ? '' : rec[h]);
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
function deleteRecordsById_(name, id) {
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

/* ===================== UTILS ===================== */
function uid_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 12); }
function nowIso_() { return new Date().toISOString(); }
function todayCompact_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Kuala_Lumpur', 'yyyyMMdd');
}
function logAudit_(action, recordType, recordId, details) {
  try {
    const email = currentUserEmail_() || 'unknown';
    ss_().getSheetByName(SHEETS.AUDIT).appendRow([
      nowIso_(), email, action, recordType, recordId, details || '',
    ]);
  } catch (e) { console.error('logAudit_ failed:', e); }
}

// Photo array helpers (multi-image fields stored as JSON arrays)
function parsePhotoArray_(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  const s = String(raw).trim();
  if (!s) return [];
  if (s.charAt(0) === '[') {
    try { const a = JSON.parse(s); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  // Backwards-compat: single URL stored as plain string
  return [s];
}
function stringifyPhotoArray_(arr) {
  if (!arr || !Array.isArray(arr)) return '';
  const cleaned = arr.map(s => String(s || '').trim()).filter(Boolean);
  return cleaned.length ? JSON.stringify(cleaned) : '';
}

/* ===================== BUILDERS ===================== */
function buildPurchaseRecords_() {
  const headers = readSheet_(SHEETS.PURCHASES);
  const lines = readSheet_(SHEETS.PURCHASE_LINES);
  const byId = {};
  headers.forEach(p => {
    p.lines = [];
    p.deliveryPhotos = parsePhotoArray_(p.deliveryPhotos);
    byId[p.id] = p;
  });
  lines.forEach(l => {
    if (byId[l.purchaseId]) byId[l.purchaseId].lines.push({
      materialId:  l.materialId,
      qty:         Number(l.qty || 0),
      rate:        Number(l.rate || 0),
      amount:      Number(l.amount || 0),
      division:    l.division || '',
      requestedBy: l.requestedBy || '',
      itemType:    String(l.itemType || 'material'),
    });
  });
  return headers;
}

function updateToolQty_(toolId, delta) {
  if (!toolId || !delta) return;
  const tool = readSheet_(SHEETS.TOOLS).find(t => t.id === toolId);
  if (!tool) return;
  const newQty = (Number(tool.totalQty) || 0) + Number(delta);
  tool.totalQty = newQty < 0 ? 0 : newQty;
  tool.updatedAt = nowIso_();
  updateRecord_(SHEETS.TOOLS, tool.id, tool);
}
function buildStockOutRecords_() {
  const headers = readSheet_(SHEETS.STOCKOUTS);
  const lines = readSheet_(SHEETS.STOCKOUT_LINES);
  const byId = {};
  headers.forEach(o => {
    o.lines = [];
    o.collectionPhotos = parsePhotoArray_(o.collectionPhotos);
    byId[o.id] = o;
  });
  lines.forEach(l => {
    if (byId[l.stockOutId]) byId[l.stockOutId].lines.push({
      materialId: l.materialId,
      qty: Number(l.qty || 0),
      ratePerUnit: Number(l.ratePerUnit || 0),
      amount: Number(l.amount || 0),
    });
  });
  return headers;
}
function buildPaymentRecords_() {
  const headers = readSheet_(SHEETS.PAYMENTS);
  const allocs = readSheet_(SHEETS.PAYMENT_ALLOCATIONS);
  const byId = {};
  headers.forEach(p => { p.allocations = []; byId[p.id] = p; });
  allocs.forEach(a => {
    if (byId[a.paymentId]) byId[a.paymentId].allocations.push({
      purchaseId:    a.purchaseId,
      amountApplied: Number(a.amountApplied || 0),
    });
  });
  return headers;
}

function nextDnNumber_() {
  const prefix = 'DN-' + todayCompact_() + '-';
  const sheet = ss_().getSheetByName(SHEETS.STOCKOUTS);
  const last = sheet.getLastRow();
  let max = 0;
  if (last >= 2) {
    const dnCol = HEADERS.StockOuts.indexOf('dnNumber') + 1;
    const vals = sheet.getRange(2, dnCol, last - 1, 1).getValues();
    vals.forEach(v => {
      const dn = String(v[0] || '');
      if (dn.startsWith(prefix)) {
        const seq = parseInt(dn.split('-').pop(), 10);
        if (!isNaN(seq) && seq > max) max = seq;
      }
    });
  }
  return prefix + String(max + 1).padStart(3, '0');
}

/* ===================== PUBLIC API ===================== */
function pingServer() {
  return {
    ok: true,
    version: VERSION,
    serverTime: nowIso_(),
    activeUser: (() => { try { return Session.getActiveUser().getEmail() || ''; } catch (e) { return ''; } })(),
    effectiveUser: (() => { try { return Session.getEffectiveUser().getEmail() || ''; } catch (e) { return ''; } })(),
    domain: ALLOWED_DOMAIN,
    timezone: Session.getScriptTimeZone(),
    uploadsConfigured: isUploadConfigured_(),
    uploadFolderId: PropertiesService.getScriptProperties().getProperty(DRIVE_FOLDER_PROP) || '',
  };
}

function getAllData() {
  return safeCall_('getAllData', email => {
    ensureSheets_();
    return _getAll_(email);
  });
}

function _getAll_(email) {
  return {
    currentUser: email,
    serverTime: nowIso_(),
    domain: ALLOWED_DOMAIN,
    version: VERSION,
    uploadsConfigured: isUploadConfigured_(),
    materials:        readSheet_(SHEETS.MATERIALS),
    suppliers:        readSheet_(SHEETS.SUPPLIERS),
    purchases:        buildPurchaseRecords_(),
    stockOuts:        buildStockOutRecords_(),
    quotations:       readSheet_(SHEETS.QUOTATIONS),
    tools:            readSheet_(SHEETS.TOOLS),
    toolAssignments:  readSheet_(SHEETS.TOOL_ASSIGNMENTS),
    repairs:          readSheet_(SHEETS.REPAIRS),
    stockCounts:      readSheet_(SHEETS.STOCK_COUNTS),
    payments:         buildPaymentRecords_(),
    selfClaimName:    SELF_CLAIM_NAME,
  };
}

/* ===== Materials ===== */
function saveMaterial(payload) {
  return safeCall_('saveMaterial', email => {
    if (!payload || !payload.name) throw new Error('Material name required.');
    const existing = payload.id ? readSheet_(SHEETS.MATERIALS).find(m => m.id === payload.id) : null;
    const rec = {
      id:                payload.id || uid_(),
      name:              String(payload.name).trim(),
      unit:              payload.unit || 'pc',
      category:          payload.category || '',
      lowStockThreshold: Number(payload.lowStockThreshold || 0),
      createdAt:         existing ? (existing.createdAt || nowIso_()) : nowIso_(),
      createdBy:         existing ? (existing.createdBy || email) : email,
      updatedAt:         nowIso_(),
      updatedBy:         email,
      photoUrl:          (payload.photoUrl || '').trim(),
    };
    if (existing) {
      updateRecord_(SHEETS.MATERIALS, rec.id, rec);
      logAudit_('UPDATE', 'Material', rec.id, rec.name);
    } else {
      appendRecord_(SHEETS.MATERIALS, rec);
      logAudit_('CREATE', 'Material', rec.id, rec.name);
    }
    return _getAll_(email);
  });
}
function deleteMaterial(id) {
  return safeCall_('deleteMaterial', email => {
    const m = readSheet_(SHEETS.MATERIALS).find(x => x.id === id);
    deleteRecordsById_(SHEETS.MATERIALS, id);
    logAudit_('DELETE', 'Material', id, (m && m.name) || '');
    return _getAll_(email);
  });
}

/* ===== Suppliers ===== */
function saveSupplier(payload) {
  return safeCall_('saveSupplier', email => {
    if (!payload || !payload.name) throw new Error('Supplier name required.');
    const existing = payload.id ? readSheet_(SHEETS.SUPPLIERS).find(s => s.id === payload.id) : null;
    const rec = {
      id:            payload.id || uid_(),
      name:          String(payload.name).trim(),
      contact:       payload.contact || '',
      notes:         payload.notes || '',
      createdAt:     existing ? (existing.createdAt || nowIso_()) : nowIso_(),
      createdBy:     existing ? (existing.createdBy || email) : email,
      updatedAt:     nowIso_(),
      updatedBy:     email,
      contactPerson: payload.contactPerson || '',
      category:      payload.category || '',
      supplierType:  payload.supplierType || '',
    };
    if (existing) {
      updateRecord_(SHEETS.SUPPLIERS, rec.id, rec);
      logAudit_('UPDATE', 'Supplier', rec.id, rec.name);
    } else {
      appendRecord_(SHEETS.SUPPLIERS, rec);
      logAudit_('CREATE', 'Supplier', rec.id, rec.name);
    }
    return _getAll_(email);
  });
}
function deleteSupplier(id) {
  return safeCall_('deleteSupplier', email => {
    const name = (readSheet_(SHEETS.SUPPLIERS).find(s => s.id === id) || {}).name || '';
    deleteRecordsById_(SHEETS.SUPPLIERS, id);
    logAudit_('DELETE', 'Supplier', id, name);
    return _getAll_(email);
  });
}

/* ===== Tools / Equipment / Machines ===== */
function saveTool(payload) {
  return safeCall_('saveTool', email => {
    if (!payload || !payload.name) throw new Error('Tool name required.');
    const existing = payload.id ? readSheet_(SHEETS.TOOLS).find(t => t.id === payload.id) : null;
    const rec = {
      id:           payload.id || uid_(),
      name:         String(payload.name).trim(),
      category:     (payload.category || '').trim(),
      brand:        (payload.brand || '').trim(),
      unit:         payload.unit || 'pc',
      totalQty:     Number(payload.totalQty || 0),
      serialNumber: (payload.serialNumber || '').trim(),
      photoUrl:     (payload.photoUrl || '').trim(),
      notes:        payload.notes || '',
      createdAt:    existing ? (existing.createdAt || nowIso_()) : nowIso_(),
      createdBy:    existing ? (existing.createdBy || email) : email,
      updatedAt:    nowIso_(),
      updatedBy:    email,
    };
    if (existing) {
      updateRecord_(SHEETS.TOOLS, rec.id, rec);
      logAudit_('UPDATE', 'Tool', rec.id, rec.name);
    } else {
      appendRecord_(SHEETS.TOOLS, rec);
      logAudit_('CREATE', 'Tool', rec.id, rec.name);
    }
    return _getAll_(email);
  });
}
function deleteTool(id) {
  return safeCall_('deleteTool', email => {
    const t = readSheet_(SHEETS.TOOLS).find(x => x.id === id) || {};
    deleteRecordsById_(SHEETS.TOOLS, id);
    logAudit_('DELETE', 'Tool', id, t.name || '');
    return _getAll_(email);
  });
}

/* ===== Tool Assignments ===== */
function saveAssignment(payload) {
  return safeCall_('saveAssignment', email => {
    if (!payload || !payload.toolId || !payload.person || !payload.division) {
      throw new Error('Tool, person, and division are required.');
    }
    const qty = Number(payload.qty) || 0;
    if (qty <= 0) throw new Error('Quantity must be greater than 0.');
    const rec = {
      id:                uid_(),
      toolId:            payload.toolId,
      qty:               qty,
      person:            String(payload.person).trim(),
      division:          payload.division,
      assignedDate:      payload.assignedDate || nowIso_().slice(0, 10),
      assignedNotes:     payload.assignedNotes || '',
      returnedDate:      '',
      returnedQty:       '',
      returnedCondition: '',
      returnedNotes:     '',
      returnedPhotoUrl:  '',
      createdAt:         nowIso_(),
      createdBy:         email,
      updatedAt:         nowIso_(),
      updatedBy:         email,
    };
    appendRecord_(SHEETS.TOOL_ASSIGNMENTS, rec);
    const tool = readSheet_(SHEETS.TOOLS).find(t => t.id === payload.toolId);
    logAudit_('CREATE', 'Assignment', rec.id,
      (tool ? tool.name : 'Tool') + ' x' + qty + ' -> ' + rec.person + ' (' + rec.division + ')');
    return _getAll_(email);
  });
}

function returnAssignments(payload) {
  return safeCall_('returnAssignments', email => {
    const lines = (payload && payload.lines) || [];
    if (!lines.length) throw new Error('Select at least one assignment to return.');
    const returnedDate = payload.returnedDate || nowIso_().slice(0, 10);
    const batchPhoto = payload.returnedPhotoUrl || '';
    const all = readSheet_(SHEETS.TOOL_ASSIGNMENTS);
    const toolsByName = {};
    readSheet_(SHEETS.TOOLS).forEach(t => { toolsByName[t.id] = t; });
    lines.forEach(line => {
      if (!line.assignmentId) return;
      const cur = all.find(a => a.id === line.assignmentId);
      if (!cur) return;
      if (cur.returnedDate) return;
      const returnedQty = Number(line.returnedQty);
      if (isNaN(returnedQty) || returnedQty < 0) throw new Error('Invalid returned qty for assignment ' + line.assignmentId);
      const cond = line.returnedCondition || 'OK';
      const rec = {
        id:                cur.id,
        toolId:            cur.toolId,
        qty:               Number(cur.qty) || 0,
        person:            cur.person,
        division:          cur.division,
        assignedDate:      cur.assignedDate,
        assignedNotes:     cur.assignedNotes,
        returnedDate:      returnedDate,
        returnedQty:       returnedQty,
        returnedCondition: cond,
        returnedNotes:     line.returnedNotes || '',
        returnedPhotoUrl:  line.returnedPhotoUrl || batchPhoto,
        createdAt:         cur.createdAt,
        createdBy:         cur.createdBy,
        updatedAt:         nowIso_(),
        updatedBy:         email,
      };
      updateRecord_(SHEETS.TOOL_ASSIGNMENTS, rec.id, rec);
      const t = toolsByName[rec.toolId];
      logAudit_('UPDATE', 'Assignment', rec.id,
        'Returned ' + (t ? t.name : 'tool') + ' ' + returnedQty + '/' + rec.qty + ' [' + cond + '] from ' + rec.person);
    });
    return _getAll_(email);
  });
}

function deleteAssignment(id) {
  return safeCall_('deleteAssignment', email => {
    const a = readSheet_(SHEETS.TOOL_ASSIGNMENTS).find(x => x.id === id) || {};
    deleteRecordsById_(SHEETS.TOOL_ASSIGNMENTS, id);
    logAudit_('DELETE', 'Assignment', id, (a.person || '') + ' / qty ' + (a.qty || ''));
    return _getAll_(email);
  });
}

/* ===== Repairs ===== */
function saveRepair(payload) {
  return safeCall_('saveRepair', email => {
    if (!payload || !payload.toolId) throw new Error('Tool is required.');
    const qty = Number(payload.qty) || 0;
    if (qty <= 0) throw new Error('Quantity must be greater than 0.');
    const rec = {
      id:               uid_(),
      toolId:           payload.toolId,
      assignmentId:     payload.assignmentId || '',
      qty:              qty,
      supplierId:       payload.supplierId || '',
      sentDate:         payload.sentDate || nowIso_().slice(0, 10),
      sentNotes:        payload.sentNotes || '',
      sentPhotoUrl:     payload.sentPhotoUrl || '',
      status:           'SENT',
      returnedDate:     '',
      returnedQty:      '',
      returnedNotes:    '',
      returnedPhotoUrl: '',
      createdAt:        nowIso_(),
      createdBy:        email,
      updatedAt:        nowIso_(),
      updatedBy:        email,
    };
    appendRecord_(SHEETS.REPAIRS, rec);
    const tool = readSheet_(SHEETS.TOOLS).find(t => t.id === rec.toolId);
    const sup = readSheet_(SHEETS.SUPPLIERS).find(s => s.id === rec.supplierId);
    logAudit_('CREATE', 'Repair', rec.id,
      (tool ? tool.name : 'Tool') + ' x' + qty + ' -> ' + (sup ? sup.name : 'supplier'));
    return _getAll_(email);
  });
}

function returnRepair(payload) {
  return safeCall_('returnRepair', email => {
    if (!payload || !payload.id) throw new Error('Repair ID required.');
    const cur = readSheet_(SHEETS.REPAIRS).find(r => r.id === payload.id);
    if (!cur) throw new Error('Repair record not found.');
    if (String(cur.status) === 'RETURNED') throw new Error('Repair already marked returned.');
    const returnedQty = Number(payload.returnedQty);
    if (isNaN(returnedQty) || returnedQty < 0) throw new Error('Invalid returned qty.');
    const rec = {
      id:               cur.id,
      toolId:           cur.toolId,
      assignmentId:     cur.assignmentId,
      qty:              Number(cur.qty) || 0,
      supplierId:       cur.supplierId,
      sentDate:         cur.sentDate,
      sentNotes:        cur.sentNotes,
      sentPhotoUrl:     cur.sentPhotoUrl,
      status:           'RETURNED',
      returnedDate:     payload.returnedDate || nowIso_().slice(0, 10),
      returnedQty:      returnedQty,
      returnedNotes:    payload.returnedNotes || '',
      returnedPhotoUrl: payload.returnedPhotoUrl || '',
      createdAt:        cur.createdAt,
      createdBy:        cur.createdBy,
      updatedAt:        nowIso_(),
      updatedBy:        email,
    };
    updateRecord_(SHEETS.REPAIRS, rec.id, rec);
    const tool = readSheet_(SHEETS.TOOLS).find(t => t.id === rec.toolId);
    logAudit_('UPDATE', 'Repair', rec.id,
      'Returned ' + (tool ? tool.name : 'tool') + ' ' + returnedQty + '/' + rec.qty);
    return _getAll_(email);
  });
}

function deleteRepair(id) {
  return safeCall_('deleteRepair', email => {
    const r = readSheet_(SHEETS.REPAIRS).find(x => x.id === id) || {};
    deleteRecordsById_(SHEETS.REPAIRS, id);
    logAudit_('DELETE', 'Repair', id, 'qty ' + (r.qty || ''));
    return _getAll_(email);
  });
}

/* ===== Stock Counts / Audit ===== */
function saveStockCount(payload) {
  return safeCall_('saveStockCount', email => {
    if (!payload || !payload.itemId || !payload.itemType) throw new Error('Item is required.');
    const itemType = String(payload.itemType);
    if (itemType !== 'material' && itemType !== 'tool') throw new Error('Invalid item type.');
    const countedQty = Number(payload.countedQty);
    if (isNaN(countedQty) || countedQty < 0) throw new Error('Counted quantity must be 0 or higher.');
    const systemQty = Number(payload.systemQty) || 0;
    const variance  = countedQty - systemQty;
    const existing = payload.id ? readSheet_(SHEETS.STOCK_COUNTS).find(c => c.id === payload.id) : null;
    const rec = {
      id:          payload.id || uid_(),
      countDate:   payload.countDate || nowIso_().slice(0, 10),
      itemType:    itemType,
      itemId:      payload.itemId,
      systemQty:   systemQty,
      countedQty:  countedQty,
      variance:    variance,
      reason:      payload.reason || '',
      notes:       payload.notes || '',
      photoUrl:    (payload.photoUrl || '').trim(),
      createdAt:   existing ? (existing.createdAt || nowIso_()) : nowIso_(),
      createdBy:   existing ? (existing.createdBy || email) : email,
      updatedAt:   nowIso_(),
      updatedBy:   email,
    };
    if (existing) {
      updateRecord_(SHEETS.STOCK_COUNTS, rec.id, rec);
      logAudit_('UPDATE', 'StockCount', rec.id,
        itemType + '/' + payload.itemId + ' variance ' + variance + ' (' + (rec.reason || 'no reason') + ')');
    } else {
      appendRecord_(SHEETS.STOCK_COUNTS, rec);
      logAudit_('CREATE', 'StockCount', rec.id,
        itemType + '/' + payload.itemId + ' counted ' + countedQty + ' vs system ' + systemQty + ' (variance ' + variance + ')');
    }
    return _getAll_(email);
  });
}
function deleteStockCount(id) {
  return safeCall_('deleteStockCount', email => {
    const c = readSheet_(SHEETS.STOCK_COUNTS).find(x => x.id === id) || {};
    deleteRecordsById_(SHEETS.STOCK_COUNTS, id);
    logAudit_('DELETE', 'StockCount', id,
      (c.itemType || '') + '/' + (c.itemId || '') + ' variance ' + (c.variance || 0));
    return _getAll_(email);
  });
}

/* ===== Category management ===== */
function _categorySheetFor_(type) {
  const map = {
    material: SHEETS.MATERIALS,
    supplier: SHEETS.SUPPLIERS,
    tool:     SHEETS.TOOLS,
  };
  const sheetName = map[type];
  if (!sheetName) throw new Error('Unknown category type: ' + type);
  return sheetName;
}

function renameCategory(payload) {
  return safeCall_('renameCategory', email => {
    if (!payload || !payload.type || !payload.oldName || !payload.newName) {
      throw new Error('Type, oldName, and newName are required.');
    }
    const oldName = String(payload.oldName).trim();
    const newName = String(payload.newName).trim();
    if (!oldName || !newName) throw new Error('Category names cannot be blank.');
    if (oldName === newName) return _getAll_(email);
    const sheetName = _categorySheetFor_(payload.type);
    const records = readSheet_(sheetName);
    let count = 0;
    records.forEach(rec => {
      if (String(rec.category || '') === oldName) {
        rec.category  = newName;
        rec.updatedAt = nowIso_();
        rec.updatedBy = email;
        updateRecord_(sheetName, rec.id, rec);
        count++;
      }
    });
    logAudit_('UPDATE', 'Category', payload.type,
      oldName + ' -> ' + newName + ' (' + count + ' record' + (count === 1 ? '' : 's') + ')');
    return _getAll_(email);
  });
}

function deleteCategory(payload) {
  return safeCall_('deleteCategory', email => {
    if (!payload || !payload.type || !payload.name) throw new Error('Type and name are required.');
    const name = String(payload.name).trim();
    if (!name) throw new Error('Category name cannot be blank.');
    const sheetName = _categorySheetFor_(payload.type);
    const records = readSheet_(sheetName);
    let count = 0;
    records.forEach(rec => {
      if (String(rec.category || '') === name) {
        rec.category  = '';
        rec.updatedAt = nowIso_();
        rec.updatedBy = email;
        updateRecord_(sheetName, rec.id, rec);
        count++;
      }
    });
    logAudit_('DELETE', 'Category', payload.type,
      name + ' cleared from ' + count + ' record' + (count === 1 ? '' : 's'));
    return _getAll_(email);
  });
}

/* ===== Purchases ===== */
function savePurchase(payload) {
  return safeCall_('savePurchase', email => {
    if (!payload || !payload.date || !payload.supplierId) throw new Error('Date and supplier are required.');
    const lines = (payload.lines || []).filter(l => l && l.materialId && Number(l.qty) > 0);
    if (!lines.length) throw new Error('At least one valid item line required.');
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      const purchaseId = uid_();
      const paidBy = String(payload.paidBy || 'company').toLowerCase();
      appendRecord_(SHEETS.PURCHASES, {
        id:         purchaseId,
        date:       payload.date,
        supplierId: payload.supplierId,
        doNumber:   payload.doNumber || '',
        notes:      payload.notes || '',
        createdAt:  nowIso_(),
        createdBy:  email,
        invoiceUrl:         (payload.invoiceUrl || '').trim(),
        discount:           Number(payload.discount) || 0,
        delivery:           Number(payload.delivery) || 0,
        tax:                Number(payload.tax) || 0,
        roundingAdjustment: Number(payload.roundingAdjustment) || 0,
        deliveryPhotos:     stringifyPhotoArray_(payload.deliveryPhotos),
        paidBy:             paidBy === 'self' ? 'self' : 'company',
      });
      lines.forEach(l => {
        const qty = Number(l.qty) || 0;
        const rate = Number(l.rate) || 0;
        const itemType = String(l.itemType || 'material');
        appendRecord_(SHEETS.PURCHASE_LINES, {
          id:          uid_(),
          purchaseId:  purchaseId,
          materialId:  l.materialId,
          qty:         qty,
          rate:        rate,
          amount:      qty * rate,
          division:    l.division || '',
          requestedBy: l.requestedBy || '',
          itemType:    itemType,
        });
        if (itemType === 'tool') updateToolQty_(l.materialId, qty);
      });
      const photoCount = parsePhotoArray_(stringifyPhotoArray_(payload.deliveryPhotos)).length;
      logAudit_('CREATE', 'Purchase', purchaseId,
        (payload.doNumber || '') + ' · ' + lines.length + ' item(s)' +
        (payload.invoiceUrl ? ' · invoice attached' : '') +
        (photoCount ? ' · ' + photoCount + ' delivery photo(s)' : '') +
        (paidBy === 'self' ? ' · paid by SELF (' + SELF_CLAIM_NAME + ', reimbursable)' : ''));
    } finally { lock.releaseLock(); }
    return _getAll_(email);
  });
}
function deletePurchase(id) {
  return safeCall_('deletePurchase', email => {
    const head = readSheet_(SHEETS.PURCHASES).find(p => p.id === id) || {};
    deleteRecordsById_(SHEETS.PURCHASES, id);
    const lines = readSheet_(SHEETS.PURCHASE_LINES).filter(l => l.purchaseId === id);
    lines.forEach(l => {
      if (String(l.itemType || 'material') === 'tool') {
        updateToolQty_(l.materialId, -(Number(l.qty) || 0));
      }
      deleteRecordsById_(SHEETS.PURCHASE_LINES, l.id);
    });
    // Also remove any payment allocations pointing at this purchase
    const orphanAllocs = readSheet_(SHEETS.PAYMENT_ALLOCATIONS).filter(a => a.purchaseId === id);
    orphanAllocs.forEach(a => deleteRecordsById_(SHEETS.PAYMENT_ALLOCATIONS, a.id));
    if (orphanAllocs.length) {
      logAudit_('DELETE', 'PaymentAllocation', id,
        'Removed ' + orphanAllocs.length + ' allocation(s) when purchase deleted');
    }
    logAudit_('DELETE', 'Purchase', id, head.doNumber || '');
    return _getAll_(email);
  });
}

/* ===== Payments (v4.1) ===== */
function savePayment(payload) {
  return safeCall_('savePayment', email => {
    if (!payload || !payload.paymentDate) throw new Error('Payment date is required.');
    const payeeType = String(payload.payeeType || '').toLowerCase();
    if (payeeType !== 'supplier' && payeeType !== 'self') {
      throw new Error('payeeType must be "supplier" or "self".');
    }
    const payeeId = payeeType === 'supplier' ? String(payload.payeeId || '').trim() : '';
    if (payeeType === 'supplier' && !payeeId) throw new Error('Supplier is required for supplier payment.');
    const allocs = (payload.allocations || [])
      .map(a => ({ purchaseId: String(a.purchaseId || ''), amountApplied: Number(a.amountApplied || 0) }))
      .filter(a => a.purchaseId && a.amountApplied > 0);
    if (!allocs.length) throw new Error('Allocate at least one invoice with a positive amount.');
    const total = allocs.reduce((s, a) => s + a.amountApplied, 0);
    if (total <= 0) throw new Error('Payment total must be greater than zero.');

    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      const existing = payload.id ? readSheet_(SHEETS.PAYMENTS).find(p => p.id === payload.id) : null;
      const paymentId = (existing && existing.id) || uid_();
      const rec = {
        id:              paymentId,
        paymentDate:     payload.paymentDate,
        payeeType:       payeeType,
        payeeId:         payeeId,
        amount:          total,
        method:          payload.method || '',
        referenceNumber: payload.referenceNumber || '',
        notes:           payload.notes || '',
        slipPhotoUrl:    (payload.slipPhotoUrl || '').trim(),
        createdAt:       existing ? (existing.createdAt || nowIso_()) : nowIso_(),
        createdBy:       existing ? (existing.createdBy || email) : email,
        updatedAt:       nowIso_(),
        updatedBy:       email,
      };
      if (existing) {
        updateRecord_(SHEETS.PAYMENTS, paymentId, rec);
        // Clear prior allocations
        const oldAllocs = readSheet_(SHEETS.PAYMENT_ALLOCATIONS).filter(a => a.paymentId === paymentId);
        oldAllocs.forEach(a => deleteRecordsById_(SHEETS.PAYMENT_ALLOCATIONS, a.id));
      } else {
        appendRecord_(SHEETS.PAYMENTS, rec);
      }
      // Write new allocations
      allocs.forEach(a => {
        appendRecord_(SHEETS.PAYMENT_ALLOCATIONS, {
          id:            uid_(),
          paymentId:     paymentId,
          purchaseId:    a.purchaseId,
          amountApplied: a.amountApplied,
        });
      });
      const payeeLabel = payeeType === 'supplier'
        ? ((readSheet_(SHEETS.SUPPLIERS).find(s => s.id === payeeId) || {}).name || 'Supplier')
        : ('Self-claim (' + SELF_CLAIM_NAME + ')');
      logAudit_(existing ? 'UPDATE' : 'CREATE', 'Payment', paymentId,
        payeeLabel + ' · RM ' + total.toFixed(2) + ' · ' + allocs.length + ' invoice(s)' +
        (payload.method ? ' · ' + payload.method : '') +
        (payload.slipPhotoUrl ? ' · slip attached' : ''));
    } finally { lock.releaseLock(); }
    return _getAll_(email);
  });
}

function deletePayment(id) {
  return safeCall_('deletePayment', email => {
    const p = readSheet_(SHEETS.PAYMENTS).find(x => x.id === id) || {};
    const allocs = readSheet_(SHEETS.PAYMENT_ALLOCATIONS).filter(a => a.paymentId === id);
    deleteRecordsById_(SHEETS.PAYMENTS, id);
    allocs.forEach(a => deleteRecordsById_(SHEETS.PAYMENT_ALLOCATIONS, a.id));
    logAudit_('DELETE', 'Payment', id,
      (p.payeeType === 'self' ? 'Self-claim' : 'Supplier ' + (p.payeeId || '')) +
      ' · RM ' + (Number(p.amount) || 0).toFixed(2) + ' · ' + allocs.length + ' allocation(s)');
    return _getAll_(email);
  });
}

/* ===== Stock Outs ===== */
function saveStockOut(payload) {
  return safeCall_('saveStockOut', email => {
    if (!payload || !payload.date || !payload.division) throw new Error('Date and division are required.');
    const lines = (payload.lines || []).filter(l => l && l.materialId && Number(l.qty) > 0);
    if (!lines.length) throw new Error('At least one valid item line required.');
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      const dnNumber = nextDnNumber_();
      const stockOutId = uid_();
      appendRecord_(SHEETS.STOCKOUTS, {
        id:               stockOutId,
        dnNumber:         dnNumber,
        date:             payload.date,
        division:         payload.division,
        project:          payload.project || '',
        notes:            payload.notes || '',
        createdAt:        nowIso_(),
        createdBy:        email,
        requestedBy:      payload.requestedBy || '',
        collectionPhotos: stringifyPhotoArray_(payload.collectionPhotos),
      });
      lines.forEach(l => {
        const qty = Number(l.qty) || 0;
        const rate = Number(l.ratePerUnit) || 0;
        appendRecord_(SHEETS.STOCKOUT_LINES, {
          id:          uid_(),
          stockOutId:  stockOutId,
          materialId:  l.materialId,
          qty:         qty,
          ratePerUnit: rate,
          amount:      qty * rate,
        });
      });
      const photoCount = parsePhotoArray_(stringifyPhotoArray_(payload.collectionPhotos)).length;
      logAudit_('CREATE', 'StockOut', stockOutId,
        dnNumber + ' → ' + payload.division + ' · ' + lines.length + ' item(s)' +
        (photoCount ? ' · ' + photoCount + ' collection photo(s)' : ''));
    } finally { lock.releaseLock(); }
    return _getAll_(email);
  });
}
function deleteStockOut(id) {
  return safeCall_('deleteStockOut', email => {
    const head = readSheet_(SHEETS.STOCKOUTS).find(o => o.id === id) || {};
    deleteRecordsById_(SHEETS.STOCKOUTS, id);
    const lines = readSheet_(SHEETS.STOCKOUT_LINES).filter(l => l.stockOutId === id);
    lines.forEach(l => deleteRecordsById_(SHEETS.STOCKOUT_LINES, l.id));
    logAudit_('DELETE', 'StockOut', id, head.dnNumber || '');
    return _getAll_(email);
  });
}

/* ===== Quotations ===== */
function saveQuotation(payload) {
  return safeCall_('saveQuotation', email => {
    if (!payload || !payload.materialId || !payload.supplierId) throw new Error('Material and supplier are required.');
    if (!payload.rate || Number(payload.rate) <= 0) throw new Error('Rate must be a positive number.');
    const existing = payload.id ? readSheet_(SHEETS.QUOTATIONS).find(q => q.id === payload.id) : null;
    const rec = {
      id:            payload.id || uid_(),
      materialId:    payload.materialId,
      supplierId:    payload.supplierId,
      rate:          Number(payload.rate) || 0,
      qtyOffered:    payload.qtyOffered != null ? Number(payload.qtyOffered) : '',
      validUntil:    payload.validUntil || '',
      source:        payload.source || '',
      notes:         payload.notes || '',
      createdAt:     existing ? (existing.createdAt || nowIso_()) : nowIso_(),
      createdBy:     existing ? (existing.createdBy || email) : email,
      updatedAt:     nowIso_(),
      updatedBy:     email,
      screenshotUrl: (payload.screenshotUrl || '').trim(),
      itemType:      String(payload.itemType || 'material'),
    };
    if (existing) {
      updateRecord_(SHEETS.QUOTATIONS, rec.id, rec);
      logAudit_('UPDATE', 'Quotation', rec.id, rec.materialId + '/' + rec.supplierId);
    } else {
      appendRecord_(SHEETS.QUOTATIONS, rec);
      logAudit_('CREATE', 'Quotation', rec.id, rec.materialId + '/' + rec.supplierId);
    }
    return _getAll_(email);
  });
}
function deleteQuotation(id) {
  return safeCall_('deleteQuotation', email => {
    const q = readSheet_(SHEETS.QUOTATIONS).find(x => x.id === id);
    deleteRecordsById_(SHEETS.QUOTATIONS, id);
    logAudit_('DELETE', 'Quotation', id, (q && (q.materialId + '/' + q.supplierId)) || '');
    return _getAll_(email);
  });
}

/* ===================== DEV ===================== */
function _resetAllSheets_DANGER() {
  const ss = ss_();
  Object.keys(HEADERS).forEach(name => {
    const s = ss.getSheetByName(name);
    if (s) ss.deleteSheet(s);
  });
  ensureSheets_();
}

/**
 * Manual self-test to run from the Apps Script editor after deployment.
 * Verifies Drive folder is configured and a tiny test file can be uploaded.
 */
function _selfTestUpload() {
  const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAarVyFEAAAAASUVORK5CYII=';
  const result = uploadFile({
    base64: tinyPng,
    mimeType: 'image/png',
    fileName: 'selftest.png',
  });
  console.log('Self-test result:', JSON.stringify(result));
  return result;
}
