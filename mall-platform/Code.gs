/**
 * HG MALL PLATFORM — server (Google Apps Script)
 * Door 1: Site Drawing Vault
 * Door 2: Mall Requirement Lookup + Panel Contractor rate book (full add/edit/delete)
 *
 * Setup: run setup() ONCE from the editor, approve permissions, then deploy as Web App.
 */

const PROP = PropertiesService.getScriptProperties();
const TZ = 'Asia/Kuala_Lumpur';

// Tables the web UI is allowed to read/write
const TABLES = ['Malls', 'Categories', 'Requirements', 'RequirementTypes', 'Types',
                'JobCategories', 'Panels', 'PanelRates', 'ShopTypes', 'RateBasis',
                'SwmsServices', 'SwmsSteps', 'SwmsEquipment', 'SwmsPPE',
                'MeasureRequests', 'TeamMembers', 'MeasureTypes'];

// ============================================================================
// ONE-TIME BOOTSTRAP — run this once (safe to re-run; it won't wipe your data)
// ============================================================================
function setup() {
  // 1. Root Drive folder
  let root;
  const rootId = PROP.getProperty('ROOT_FOLDER_ID');
  if (rootId) { root = DriveApp.getFolderById(rootId); }
  else {
    root = DriveApp.createFolder('HG Mall Platform — Site Drawings');
    PROP.setProperty('ROOT_FOLDER_ID', root.getId());
  }

  // 2. Database spreadsheet (bound sheet if opened via Extensions, else new)
  let ss;
  const ssId = PROP.getProperty('DB_SHEET_ID');
  if (ssId) { ss = SpreadsheetApp.openById(ssId); }
  else {
    ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.create('HG Mall Platform — Database');
    PROP.setProperty('DB_SHEET_ID', ss.getId());
  }

  // 3. Tabs
  ensureSheet(ss, 'Sketches',      ['Timestamp', 'Mall', 'Code', 'Lot No', 'Shop Type', 'Version',
                                    'File Name', 'File URL', 'File ID', 'Folder URL', 'Remarks', 'Uploaded By']);
  ensureSheet(ss, 'AuditLog',      ['Timestamp', 'User', 'Action', 'Details']);
  ensureSheet(ss, 'Categories',    ['ID', 'Name', 'Sort']);
  ensureSheet(ss, 'Requirements',  ['ID', 'Mall', 'Category', 'Requirement', 'Type', 'Value', 'Shop Type',
                                    'Notes', 'Sort', 'Updated By', 'Updated On']);
  ensureColumnAfter(ss, 'Requirements', 'Type', 'Requirement'); // add to existing installs
  ensureSheet(ss, 'RequirementTypes', ['ID', 'Category', 'Name', 'Sort']);
  ensureSheet(ss, 'Types',            ['ID', 'Category', 'Name', 'Sort']);
  ensureSheet(ss, 'JobCategories', ['ID', 'Name', 'Sort']);
  ensureSheet(ss, 'Panels',        ['ID', 'Name', 'PIC', 'Phone', 'Email', 'Notes', 'Updated By', 'Updated On']);
  ensureSheet(ss, 'PanelRates',    ['ID', 'Panel', 'Job Category', 'Mall', 'Rate Basis', 'Price From',
                                    'Price To', 'Lot Size Ref', 'Engaged On', 'Notes', 'Updated By', 'Updated On']);
  ensureSheet(ss, 'ShopTypes',     ['ID', 'Name', 'Sort']);
  ensureSheet(ss, 'RateBasis',     ['ID', 'Name', 'Sort']);
  ensureSheet(ss, 'SwmsServices',  ['ID', 'Name', 'Sort']);
  ensureSheet(ss, 'SwmsSteps',     ['ID', 'Service', 'Step No', 'Job Step', 'Method', 'Hazards', 'Impacts',
                                    'Existing Controls', 'Impact', 'Likelihood', 'Additional Controls', 'Sort']);
  ensureSheet(ss, 'SwmsEquipment', ['ID', 'Service', 'Equipment', 'Purpose', 'Sort']);
  ensureSheet(ss, 'SwmsPPE',       ['ID', 'Service', 'PPE', 'Sort']);
  ensureSheet(ss, 'TeamMembers',   ['ID', 'Name', 'Sort']);
  ensureSheet(ss, 'MeasureTypes',  ['ID', 'Name', 'Sort']);
  ensureSheet(ss, 'MeasureRequests', ['ID', 'Date', 'Requestor', 'Mall', 'Lot No', 'Client', 'Work Type',
                                      'Assigned To', 'Remarks', 'Ref Photos', 'Purpose', 'Status', 'Quote Sent On',
                                      'Notes', 'Updated By', 'Updated On']);
  ensureColumnAfter(ss, 'MeasureRequests', 'Ref Photos', 'Remarks'); // add to existing installs

  migrateMalls(ss);          // Malls → ID-based schema
  dropOldStubs(ss);          // remove the empty v1 stub tabs
  const blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1) ss.deleteSheet(blank);

  seedCategories(ss);
  seedJobCategories(ss);
  seedRequirementTypes(ss);  // the Requirement dropdown options
  seedTypes(ss);             // the Hoarding / Visual Type dropdown options
  seedShopTypes(ss);
  seedRateBasis(ss);
  seedRequirements(ss);      // real SCM example, only if empty
  seedPanels(ss);            // ABC / XYZ sample, only if empty
  seedSwmsServices(ss);
  seedSwmsSteps(ss);         // real hoarding + visual SWMS (TRX template)
  seedSwmsEquipment(ss);
  seedSwmsPPE(ss);
  seedTeamMembers(ss);
  seedMeasureTypes(ss);

  Logger.log('ROOT FOLDER:  ' + root.getUrl());
  Logger.log('DATABASE:     ' + ss.getUrl());
  return { rootFolder: root.getUrl(), database: ss.getUrl() };
}

// ============================================================================
// WEB APP ENTRY
// ============================================================================
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('HG Mall Platform')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getCurrentUser() { return getUserEmail(); }

function getConfigLinks() {
  const ssId = PROP.getProperty('DB_SHEET_ID');
  const folderId = PROP.getProperty('ROOT_FOLDER_ID');
  return {
    sheetUrl: ssId ? 'https://docs.google.com/spreadsheets/d/' + ssId + '/edit' : '',
    folderUrl: folderId ? 'https://drive.google.com/drive/folders/' + folderId : ''
  };
}

// ============================================================================
// GENERIC CRUD (used by Door 2 manage screens)
// ============================================================================
function crudList(table) {
  guardTable(table);
  return listTable(table);
}

function crudSave(table, obj) {
  guardTable(table);
  // Block duplicate mall names (case-insensitive), whether adding or renaming.
  if (table === 'Malls') {
    const nm = String(obj.Name || '').trim().toLowerCase();
    if (nm && listTable('Malls').some(m =>
        String(m.Name).trim().toLowerCase() === nm && String(m.ID) !== String(obj.ID || '')))
      throw new Error('Mall "' + String(obj.Name).trim() + '" already exists.');
  }
  const user = getUserEmail();
  const headers = headerRow(table);
  if (headers.indexOf('Updated By') >= 0) obj['Updated By'] = user;
  if (headers.indexOf('Updated On') >= 0) obj['Updated On'] = new Date();

  let id;
  if (obj.ID) { updateRow(table, obj.ID, obj); id = obj.ID; logAudit(user, 'EDIT ' + table, summarize(obj)); }
  else        { id = insertRow(table, obj);                 logAudit(user, 'ADD '  + table, summarize(obj)); }
  return id;
}

function crudDelete(table, id) {
  guardTable(table);
  deleteRow(table, id);
  logAudit(getUserEmail(), 'DELETE ' + table, String(id));
  return true;
}

// ---- Read views (staff-facing) --------------------------------------------
/** Requirements for a mall, filtered by shop type, grouped by category. */
function lookupRequirements(mall, shopType) {
  const cats = listTable('Categories').sort(bySort).map(c => c.Name);
  const rows = listTable('Requirements').filter(function (r) {
    if (String(r.Mall) !== String(mall)) return false;
    const st = r['Shop Type'];
    return !shopType || !st || st === 'All' || st === shopType;
  });
  const grouped = [];
  const order = cats.length ? cats : Array.from(new Set(rows.map(r => r.Category)));
  order.forEach(function (cat) {
    const items = rows.filter(r => r.Category === cat)
      .map(r => ({ requirement: r.Requirement, type: r.Type, value: r.Value, shopType: r['Shop Type'], notes: r.Notes }));
    if (items.length) grouped.push({ category: cat, items: items });
  });
  // any category not in the master order
  rows.map(r => r.Category).filter((c, i, a) => a.indexOf(c) === i && order.indexOf(c) < 0)
    .forEach(function (cat) {
      grouped.push({ category: cat, items: rows.filter(r => r.Category === cat)
        .map(r => ({ requirement: r.Requirement, value: r.Value, shopType: r['Shop Type'], notes: r.Notes })) });
    });
  return grouped;
}

/** Panel contractor rates for a mall + job category, cheapest first. */
function comparePanels(mall, jobCategory) {
  return listTable('PanelRates')
    .filter(r => String(r.Mall) === String(mall) &&
                 (!jobCategory || String(r['Job Category']) === String(jobCategory)))
    .sort((a, b) => (Number(a['Price From']) || 0) - (Number(b['Price From']) || 0));
}

// ============================================================================
// DOOR 4 — Measurement Request Tracker
// ============================================================================
function addMeasureRequest(p) {
  if (!p || !p.Mall) throw new Error('Mall is required.');
  if (!p['Lot No']) throw new Error('Lot No. is required.');
  if (!p.Client) throw new Error('Client is required.');
  p.Date = Utilities.formatDate(new Date(), TZ, 'dd MMM yyyy');
  p.Requestor = getUserEmail();
  p.Status = 'Requested';
  crudSave('MeasureRequests', p);
  return crudList('MeasureRequests');
}

/** Batch insert: same mall, many lots (each its own client). One round-trip. */
function addMeasureRequests(p) {
  if (!p || !p.Mall) throw new Error('Mall is required.');
  if (!p.rows || !p.rows.length) throw new Error('Add at least one lot.');
  const user = getUserEmail();
  const date = Utilities.formatDate(new Date(), TZ, 'dd MMM yyyy');
  const stamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const root = DriveApp.getFolderById(PROP.getProperty('ROOT_FOLDER_ID'));
  let n = 0;
  p.rows.forEach(function (r) {
    if (!r.lot || !r.client) return;
    let refLines = '';
    if (r.photos && r.photos.length) {
      const lotFolder = findOrCreateFolder(findOrCreateFolder(root, p.Mall), String(r.lot));
      refLines = r.photos.map(function (f) {
        const bytes = Utilities.base64Decode(f.dataBase64);
        const name = 'ref_' + stamp + '_' + String(f.name).replace(/[\\/]/g, '-');
        const file = lotFolder.createFile(Utilities.newBlob(bytes, f.mimeType, name));
        return file.getName() + '|' + file.getUrl();
      }).join('\n');
    }
    crudSave('MeasureRequests', {
      Date: date, Requestor: user, Status: 'Requested',
      Mall: p.Mall, 'Lot No': r.lot, Client: r.client,
      'Work Type': p.WorkType || '', 'Assigned To': p.Assigned || '',
      Purpose: p.Purpose || '', Remarks: r.remarks || '', 'Ref Photos': refLines
    });
    n++;
  });
  if (!n) throw new Error('Each lot needs a lot no. and a client.');
  return crudList('MeasureRequests');
}

/** How many drawings + requests already exist for a mall + lot (for the "already exists" hint). */
function countMallLot(mall, lot) {
  mall = String(mall || '').trim().toLowerCase();
  lot = String(lot || '').trim().toLowerCase();
  if (!mall || !lot) return { drawings: 0, requests: 0 };
  const sk = db().getSheetByName('Sketches').getDataRange().getValues();
  let d = 0;
  for (let i = 1; i < sk.length; i++) {
    if (String(sk[i][1]).toLowerCase() === mall && String(sk[i][3]).toLowerCase() === lot) d++;
  }
  let r = 0;
  listTable('MeasureRequests').forEach(x => {
    if (String(x.Mall).toLowerCase() === mall && String(x['Lot No']).toLowerCase() === lot) r++;
  });
  return { drawings: d, requests: r };
}

/** Advance a request through its pipeline. */
function setMeasureStatus(id, status) {
  const obj = { ID: id, Status: status };
  // stamp the quote date only when sent; clear it if reopened/moved back
  obj['Quote Sent On'] = (status === 'Quotation Sent') ? Utilities.formatDate(new Date(), TZ, 'dd MMM yyyy') : '';
  crudSave('MeasureRequests', obj);
  return crudList('MeasureRequests');
}

// ============================================================================
// DOOR 1 — Site Drawing Vault
// ============================================================================
function getMalls() {
  return listTable('Malls')
    .map(m => ({ id: m.ID, name: m.Name, code: m.Code || '', location: m.Location || '', notes: m.Notes || '' }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function addMall(name, code) {
  name = (name || '').trim();
  if (!name) throw new Error('Mall name is required.');
  if (getMalls().some(m => String(m.name).toLowerCase() === name.toLowerCase()))
    throw new Error('Mall "' + name + '" already exists.');
  crudSave('Malls', { Name: name, Code: (code || '').trim(), 'Added By': getUserEmail(), 'Added On': new Date() });
  return getMalls();
}

function uploadSketch(payload) {
  if (!payload || !payload.mallName) throw new Error('Mall is required.');
  if (!payload.lotNo) throw new Error('Lot No. is required.');
  if (!payload.files || !payload.files.length) throw new Error('No file selected.');

  const user = getUserEmail();
  const ss = db();
  const root = DriveApp.getFolderById(PROP.getProperty('ROOT_FOLDER_ID'));
  const mallFolder = findOrCreateFolder(root, payload.mallName);
  const lotFolder = findOrCreateFolder(mallFolder, String(payload.lotNo));

  const version = nextVersion(ss, payload.mallName, payload.lotNo);
  const now = new Date();
  const stamp = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  const sheet = ss.getSheetByName('Sketches');
  const saved = [];

  payload.files.forEach(function (f) {
    const bytes = Utilities.base64Decode(f.dataBase64);
    const cleanName = String(f.name).replace(/[\\/]/g, '-');
    const blob = Utilities.newBlob(bytes, f.mimeType, 'v' + version + '_' + stamp + '_' + cleanName);
    const file = lotFolder.createFile(blob);
    writeRowText(sheet, sheet.getLastRow() + 1,
      [now, payload.mallName, payload.code || '', String(payload.lotNo),
       payload.shopType || '', version, file.getName(), file.getUrl(),
       file.getId(), lotFolder.getUrl(), payload.remarks || '', user]);
    saved.push({ name: file.getName(), url: file.getUrl() });
  });

  logAudit(user, 'UPLOAD', payload.mallName + ' / ' + payload.lotNo + ' v' + version + ' (' + saved.length + ' file)');
  return { version: version, folderUrl: lotFolder.getUrl(), files: saved };
}

function getSketches(mall, lot) {
  const data = db().getSheetByName('Sketches').getDataRange().getValues();
  mall = (mall || '').trim().toLowerCase();
  lot = (lot || '').trim().toLowerCase();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[0]) continue;
    if (mall && String(r[1]).toLowerCase() !== mall) continue;
    if (lot && String(r[3]).toLowerCase().indexOf(lot) === -1) continue;
    out.push({
      timestamp: Utilities.formatDate(new Date(r[0]), TZ, 'dd MMM yyyy, HH:mm'),
      ts: new Date(r[0]).getTime(),
      mall: String(r[1]), code: String(r[2] || ''), lotNo: String(r[3]),
      shopType: String(r[4] || ''), version: Number(r[5]) || 1,
      fileName: String(r[6]), fileUrl: String(r[7]), fileId: String(r[8]),
      folderUrl: String(r[9]), remarks: String(r[10] || ''), uploadedBy: String(r[11] || '')
    });
  }
  out.sort((a, b) => b.ts - a.ts);
  return out;
}

/** Small Drive thumbnails (data URIs) for inline previews — keyed by file id. */
function getThumbnails(ids) {
  const out = {};
  (ids || []).forEach(function (id) {
    try {
      const blob = DriveApp.getFileById(id).getThumbnail();
      if (blob) out[id] = 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
    } catch (e) { /* no thumbnail for this file */ }
  });
  return out;
}

/** Fix a wrongly-filed drawing: moves the Drive file to the correct Mall/Lot folder + updates the log. */
function updateSketch(p) {
  if (!p || !p.fileId) throw new Error('Missing file.');
  if (!p.mall) throw new Error('Mall is required.');
  if (!p.lotNo) throw new Error('Lot No. is required.');
  const sh = db().getSheetByName('Sketches');
  const data = sh.getDataRange().getValues();
  // cols: 0 Timestamp 1 Mall 2 Code 3 Lot 4 Shop 5 Ver 6 Name 7 URL 8 FileID 9 FolderURL 10 Remarks 11 By
  let r = -1;
  for (let i = 1; i < data.length; i++) { if (String(data[i][8]) === String(p.fileId)) { r = i; break; } }
  if (r < 0) throw new Error('Drawing not found.');

  const code = (getMalls().filter(m => m.name === p.mall)[0] || {}).code || '';
  let folderUrl = String(data[r][9]);
  const oldMall = String(data[r][1]), oldLot = String(data[r][3]);
  if (oldMall !== p.mall || oldLot !== String(p.lotNo)) {
    const root = DriveApp.getFolderById(PROP.getProperty('ROOT_FOLDER_ID'));
    const lotFolder = findOrCreateFolder(findOrCreateFolder(root, p.mall), String(p.lotNo));
    DriveApp.getFileById(p.fileId).moveTo(lotFolder);
    folderUrl = lotFolder.getUrl();
  }
  sh.getRange(r + 1, 2).setValue(p.mall);
  sh.getRange(r + 1, 3).setValue(code);
  sh.getRange(r + 1, 4).setNumberFormat('@').setValue(String(p.lotNo)); // keep "3-15" as text
  sh.getRange(r + 1, 5).setValue(p.shopType || '');
  sh.getRange(r + 1, 10).setValue(folderUrl);
  sh.getRange(r + 1, 11).setValue(p.remarks || '');
  logAudit(getUserEmail(), 'EDIT_SKETCH', oldMall + '/' + oldLot + ' → ' + p.mall + '/' + p.lotNo);
  return true;
}

/** Delete a drawing: moves the Drive file to trash + removes the log row. */
function deleteSketch(fileId) {
  if (!fileId) throw new Error('Missing file.');
  const sh = db().getSheetByName('Sketches');
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][8]) === String(fileId)) {
      try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {}
      sh.deleteRow(i + 1);
      logAudit(getUserEmail(), 'DELETE_SKETCH', String(data[i][1]) + '/' + String(data[i][3]));
      return true;
    }
  }
  throw new Error('Drawing not found.');
}

/**
 * BATCH IMPORT — file a folder of pre-cropped sketches into the Vault in one run.
 * The Drive folder must contain the image files + a manifest.json:
 *   [{ "file":"C.01.0.png", "mall":"TRX Mall", "lotNo":"C.01.0", "shop":"Eu Yan Sang", "remarks":"..." }, ...]
 * Run once from the editor:  batchImportFromFolder('PASTE_DRIVE_FOLDER_ID')
 * Safe to re-run — rows already imported (same mall+lot+source file) are skipped.
 * Files are COPIED into TRX Mall / <Lot No> (originals in the import folder are left untouched).
 */
/** EDIT the folder ID below, then press Run on THIS function from the editor. */
function importTRXCrops() {
  return batchImportFromFolder('PASTE_FOLDER_ID_HERE');
}

function batchImportFromFolder(folderId) {
  if (!folderId) throw new Error('Pass the Drive folder ID holding the crops + manifest.json');
  const srcFolder = DriveApp.getFolderById(folderId);
  const mIt = srcFolder.getFilesByName('manifest.json');
  if (!mIt.hasNext()) throw new Error('manifest.json not found in that folder.');
  const manifest = JSON.parse(mIt.next().getBlob().getDataAsString());

  const user = getUserEmail();
  const ss = db();
  const sheet = ss.getSheetByName('Sketches');
  const root = DriveApp.getFolderById(PROP.getProperty('ROOT_FOLDER_ID'));

  // index already-imported (mall|lot|file) so re-runs don't duplicate
  const existing = {};
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const m = String(data[i][10] || '').match(/\[src:([^\]]+)\]/);
    if (m) existing[String(data[i][1]).toLowerCase() + '|' + String(data[i][3]).toLowerCase() + '|' + m[1]] = true;
  }

  let done = 0, skipped = 0; const missing = [];
  manifest.forEach(function (e) {
    const key = String(e.mall).toLowerCase() + '|' + String(e.lotNo).toLowerCase() + '|' + e.file;
    if (existing[key]) { skipped++; return; }
    const fIt = srcFolder.getFilesByName(e.file);
    if (!fIt.hasNext()) { missing.push(e.file); return; }
    const srcFile = fIt.next();

    const lotFolder = findOrCreateFolder(findOrCreateFolder(root, e.mall), String(e.lotNo));
    const version = nextVersion(ss, e.mall, e.lotNo);
    const now = new Date();
    const stamp = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
    const newFile = srcFile.makeCopy('v' + version + '_' + stamp + '_' + String(e.file).replace(/[\\/]/g, '-'), lotFolder);
    const remarks = (e.remarks || '') + (e.shop ? ' | Shop: ' + e.shop : '') + ' [src:' + e.file + ']';
    writeRowText(sheet, sheet.getLastRow() + 1,
      [now, e.mall, e.code || '', String(e.lotNo), e.shopType || '', version,
       newFile.getName(), newFile.getUrl(), newFile.getId(), lotFolder.getUrl(), remarks, user]);
    done++;
  });
  logAudit(user, 'BATCH_IMPORT', 'folder ' + folderId + ' → ' + done + ' imported, ' + skipped + ' skipped');
  const msg = 'Imported ' + done + ', skipped ' + skipped + (missing.length ? ', MISSING: ' + missing.join(', ') : '');
  Logger.log(msg);
  return msg;
}

// ============================================================================
// Generic table helpers (header-mapped, ID-based)
// ============================================================================
function db() {
  const id = PROP.getProperty('DB_SHEET_ID');
  if (!id) throw new Error('Not set up yet. Run setup() once from the editor.');
  return SpreadsheetApp.openById(id);
}
function guardTable(t) { if (TABLES.indexOf(t) < 0) throw new Error('Unknown table: ' + t); }
function tbl(name) { return db().getSheetByName(name); }
function headerRow(name) {
  const sh = tbl(name);
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
}

function listTable(name) {
  const sh = tbl(name);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (row.every(c => c === '' || c === null)) continue;
    const o = {};
    headers.forEach(function (h, c) {
      let v = row[c];
      if (v instanceof Date) v = Utilities.formatDate(v, TZ, 'dd MMM yyyy, HH:mm');
      o[h] = v;
    });
    o._id = o.ID;          // frontend edit/delete key on _id
    out.push(o);
  }
  return out;
}

/**
 * Write a row as PLAIN TEXT so Sheets never auto-converts values.
 * Without this, a lot no. like "3-15" becomes the date 15-Mar. Date objects keep a date format.
 */
function writeRowText(sh, rowIndex, rowArr) {
  const rng = sh.getRange(rowIndex, 1, 1, rowArr.length);
  rng.setNumberFormats([rowArr.map(v => (v instanceof Date) ? 'dd mmm yyyy hh:mm' : '@')]);
  rng.setValues([rowArr]);
}

function insertRow(name, obj) {
  const sh = tbl(name);
  const headers = headerRow(name);
  obj.ID = obj.ID || Utilities.getUuid();
  writeRowText(sh, sh.getLastRow() + 1, headers.map(h => (obj.hasOwnProperty(h) ? obj[h] : '')));
  return obj.ID;
}

function updateRow(name, id, obj) {
  const sh = tbl(name);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('ID');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(id)) {
      headers.forEach(function (h, c) { if (obj.hasOwnProperty(h)) data[i][c] = obj[h]; });
      writeRowText(sh, i + 1, data[i]);
      return true;
    }
  }
  throw new Error('Record not found.');
}

function deleteRow(name, id) {
  const sh = tbl(name);
  const data = sh.getDataRange().getValues();
  const idCol = data[0].indexOf('ID');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(id)) { sh.deleteRow(i + 1); return true; }
  }
  throw new Error('Record not found.');
}

function bySort(a, b) { return (Number(a.Sort) || 0) - (Number(b.Sort) || 0); }
function summarize(obj) {
  return ['Name', 'Mall', 'Category', 'Requirement', 'Value', 'Panel', 'Job Category']
    .filter(k => obj[k]).map(k => obj[k]).join(' · ').slice(0, 120);
}

// ============================================================================
// Misc helpers
// ============================================================================
function ensureSheet(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function ensureColumnAfter(ss, sheetName, colName, afterName) {
  const sh = ss.getSheetByName(sheetName);
  if (!sh) return;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  if (headers.indexOf(colName) >= 0) return;       // already there
  let idx = headers.indexOf(afterName);
  if (idx < 0) idx = headers.length - 1;
  sh.insertColumnAfter(idx + 1);
  sh.getRange(1, idx + 2).setValue(colName).setFontWeight('bold');
}

function migrateMalls(ss) {
  let sh = ss.getSheetByName('Malls');
  if (!sh) sh = ss.insertSheet('Malls');
  const data = sh.getDataRange().getValues();
  if (data.length && data[0][0] === 'ID') return; // already migrated

  const old = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) old.push({ name: data[i][0], code: data[i][1] || '' });
  }
  sh.clear();
  sh.appendRow(['ID', 'Name', 'Code', 'Location', 'Notes', 'Added By', 'Added On']);
  sh.getRange(1, 1, 1, 7).setFontWeight('bold');
  sh.setFrozenRows(1);
  if (!old.length) old.push({ name: 'SCM', code: 'SCM' });
  old.forEach(o => sh.appendRow([Utilities.getUuid(), o.name, o.code, '', '', 'system', new Date()]));
}

function dropOldStubs(ss) {
  ['Guidelines', 'PanelContractors'].forEach(function (n) {
    const sh = ss.getSheetByName(n);
    if (sh && sh.getLastRow() <= 1) ss.deleteSheet(sh); // only if empty
  });
}

function findOrCreateFolder(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function nextVersion(ss, mall, lot) {
  const data = ss.getSheetByName('Sketches').getDataRange().getValues();
  let max = 0;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) === String(mall) && String(data[i][3]) === String(lot)) {
      const v = Number(data[i][5]) || 0;
      if (v > max) max = v;
    }
  }
  return max + 1;
}

function getUserEmail() {
  const e = Session.getActiveUser().getEmail();
  return e || Session.getEffectiveUser().getEmail() || 'unknown';
}

function logAudit(user, action, details) {
  db().getSheetByName('AuditLog').appendRow([new Date(), user, action, details]);
}

// ============================================================================
// Seed data (only fills empty tabs — never overwrites your edits)
// ============================================================================
function seedCategories(ss) {
  const sh = ss.getSheetByName('Categories');
  if (sh.getLastRow() > 1) return;
  [['Hoarding', 1], ['Visual', 2], ['Reinstatement', 3], ['Renovation', 4]]
    .forEach((c, i) => sh.appendRow([Utilities.getUuid(), c[0], c[1]]));
}

function seedJobCategories(ss) {
  const sh = ss.getSheetByName('JobCategories');
  if (sh.getLastRow() > 1) return;
  ['Sprinkler dismantling', 'LPG gas piping dismantling', 'Telephone line checking',
   'Fire alarm (FAS) / PA speaker checking', 'Wet chemical system dismantling',
   'AC / exhaust ducting cleaning', 'Flushing services', 'Pest control services']
    .forEach((n, i) => sh.appendRow([Utilities.getUuid(), n, i + 1]));
}

function seedRequirementTypes(ss) {
  const sh = ss.getSheetByName('RequirementTypes');
  if (sh.getLastRow() > 1) return;
  const list = [
    ['Hoarding', 'Hoarding material'], ['Hoarding', 'Hoarding door'], ['Hoarding', 'Hoarding counterweight'],
    ['Hoarding', 'Hoarding fabric (top cover)'], ['Hoarding', 'Transparent plastic sheet'], ['Hoarding', 'Floor protection'],
    ['Visual', 'Visual material'], ['Visual', 'Visual skirting'],
    ['Reinstatement', 'Insurance (PL / CAR / Workmen Comp)'], ['Reinstatement', 'Property coverage'],
    ['Reinstatement', 'Scaffold with green tag'], ['Reinstatement', 'OSH coordinator certification'],
    ['Reinstatement', 'Work at height'], ['Reinstatement', 'CIDB CIMS registration'], ['Reinstatement', 'Rorobin'],
    ['Reinstatement', 'Permit to Work (Form C)'], ['Reinstatement', 'Hot Work Permit (Form D)'],
    ['Reinstatement', 'Fire extinguisher (ABC + CO2)'], ['Reinstatement', 'Hoarding erection timing'],
    ['Reinstatement', 'Safety signage at hoarding'], ['Reinstatement', 'Sprinkler dismantling'],
    ['Reinstatement', 'LPG gas piping dismantling'], ['Reinstatement', 'Wet chemical system dismantling']
  ];
  list.forEach((r, i) => sh.appendRow([Utilities.getUuid(), r[0], r[1], i + 1]));
}

function seedTypes(ss) {
  const sh = ss.getSheetByName('Types');
  if (sh.getLastRow() > 1) return;
  const list = [
    ['Hoarding', 'Lot (Shop Front) (Indoor)'],
    ['Hoarding', 'Lot (Shop Front) (Outdoor)'],
    ['Hoarding', 'Kiosk (Indoor)'],
    ['Hoarding', 'Kiosk (Outdoor)'],
    ['Hoarding', 'Building Facade (Outdoor)'],
    ['Visual', 'Lot (Shop Front Hoarding) (Indoor)'],
    ['Visual', 'Lot (Shop Front Hoarding) (Outdoor)'],
    ['Visual', 'Kiosk (Indoor)'],
    ['Visual', 'Kiosk (Outdoor)'],
    ['Visual', 'Glass Panel'],
    ['Visual', 'Wall (Indoor)'],
    ['Visual', 'Pillar'],
    ['Visual', 'Building Facade (Outdoor Hoarding)']
  ];
  list.forEach((r, i) => sh.appendRow([Utilities.getUuid(), r[0], r[1], i + 1]));
}

function seedShopTypes(ss) {
  const sh = ss.getSheetByName('ShopTypes');
  if (sh.getLastRow() > 1) return;
  ['All', 'F&B', 'Office', 'Others'].forEach((n, i) => sh.appendRow([Utilities.getUuid(), n, i + 1]));
}

function seedRateBasis(ss) {
  const sh = ss.getSheetByName('RateBasis');
  if (sh.getLastRow() > 1) return;
  ['Per lot', 'Per sqft', 'Per point', 'Lump sum'].forEach((n, i) => sh.appendRow([Utilities.getUuid(), n, i + 1]));
}

function seedRequirements(ss) {
  const sh = ss.getSheetByName('Requirements');
  if (sh.getLastRow() > 1) return;
  const M = 'SCM';
  // [Category, Requirement, Value, ShopType, Notes]
  const rows = [
    ['Hoarding', 'Hoarding material', 'White polyester laminated plywood (matte finish)', 'All', 'Per mall hoarding board spec'],
    ['Hoarding', 'Hoarding door', 'Single leaf 1200×2400mm, swing outward, staple & hasp + number padlock', 'All', 'Door in middle of hoarding full length; gap from floor 25mm; 3 hinges; 50×50 timber frame'],
    ['Hoarding', 'Hoarding counterweight', 'Yes', 'All', ''],
    ['Hoarding', 'Hoarding fabric (top cover)', 'Yes', 'All', 'Lot: top fabric cover. Kiosk: top surface + side handrail cover (depends on site condition)'],
    ['Hoarding', 'Transparent plastic sheet', 'Depends on mall fit-out request', 'All', ''],
    ['Hoarding', 'Floor protection', 'Plastic sheet (1st layer) + plywood (2nd layer)', 'All', 'NO nail or screw to common corridor floor. Set back 6" from sprinkler/smoke curtain/hose reel'],
    ['Visual', 'Visual material', 'Sticker', 'All', ''],
    ['Visual', 'Visual skirting', 'No (sticker)', 'All', 'Tarpaulin: Yes — sometimes No, depends on mall'],
    ['Reinstatement', 'Insurance (PL / CAR / Workmen Comp)', 'RM2,000,000', 'All', 'Public Liability / Contractor All Risk / Workmen Compensation'],
    ['Reinstatement', 'Property coverage', 'No', 'All', 'Sometimes Yes — RM5mil'],
    ['Reinstatement', 'Scaffold with green tag', 'Yes', 'All', ''],
    ['Reinstatement', 'OSH coordinator certification', 'Yes', 'All', ''],
    ['Reinstatement', 'Work at height', 'Yes', 'All', ''],
    ['Reinstatement', 'CIDB CIMS registration', 'Yes', 'All', ''],
    ['Reinstatement', 'Rorobin', 'Yes — self engage', 'All', ''],
    ['Reinstatement', 'Permit to Work (Form C)', 'Required', 'All', 'Display PTW + 24h approval letter at front of hoarding in clear folder'],
    ['Reinstatement', 'Hot Work Permit (Form D)', 'Required if hot work', 'All', ''],
    ['Reinstatement', 'Fire extinguisher (ABC + CO2)', 'Required if hot work', 'All', 'Valid license, on site'],
    ['Reinstatement', 'Hoarding erection timing', 'Full height on last day of business night', 'All', ''],
    ['Reinstatement', 'Safety signage at hoarding', 'No Smoking / Eating / Urinating; PPE & Security Pass', 'All', ''],
    ['Reinstatement', 'Sprinkler dismantling', 'Yes — panel contractor', 'All', ''],
    ['Reinstatement', 'LPG gas piping dismantling', 'Yes', 'F&B', 'Gas meter compulsory dismantle by Gas Malaysia Sdn Bhd (arranged by tenant / panel)'],
    ['Reinstatement', 'Wet chemical system dismantling', 'Yes', 'F&B', '']
  ];
  rows.forEach(function (r, i) {
    sh.appendRow([Utilities.getUuid(), M, r[0], r[1], r[2], r[3], r[4], i + 1, 'system', new Date()]);
  });
}

function seedSwmsServices(ss) {
  const sh = ss.getSheetByName('SwmsServices');
  if (sh.getLastRow() > 1) return;
  ['Hoarding', 'Visual', 'Reinstatement', 'Scaffold', 'Brick wall erection',
   'Plaster ceiling', 'Partition', 'Tiling', 'Flooring', 'Painting']
    .forEach((n, i) => sh.appendRow([Utilities.getUuid(), n, i + 1]));
}

function seedSwmsEquipment(ss) {
  const sh = ss.getSheetByName('SwmsEquipment');
  if (sh.getLastRow() > 1) return;
  const rows = [
    ['Hoarding', 'Portable power drill', 'To drive screws'],
    ['Hoarding', 'Aluminium ladder', 'Access height below 4m'],
    ['Hoarding', 'Heavy duty trolley', 'Transport materials & tools'],
    ['Hoarding', 'Floor protection mat', 'Floor protection during mobilization'],
    ['Hoarding', 'Safety barricade cones', 'Barricade and secure work area'],
    ['Hoarding', 'Laser lining machine', 'Levelling and alignment confirmation'],
    ['Visual', 'Aluminium ladder', 'Access height below 4m'],
    ['Visual', 'Heavy duty trolley', 'Transport materials & tools'],
    ['Visual', 'Floor protection mat', 'Floor protection during mobilization'],
    ['Visual', 'Safety barricade cones', 'Barricade and secure work area'],
    ['Visual', 'Staple gun', 'Fix tarpaulin to hoarding'],
    ['Visual', 'Hot gun', 'Smoothen wrinkled tarpaulin']
  ];
  rows.forEach((r, i) => sh.appendRow([Utilities.getUuid(), r[0], r[1], r[2], i + 1]));
}

function seedSwmsPPE(ss) {
  const sh = ss.getSheetByName('SwmsPPE');
  if (sh.getLastRow() > 1) return;
  ['Safety helmet', 'Safety shoes', 'Safety vest', 'Hand gloves', 'Safety glasses',
   'Ear plug (if required)', 'Dust mask (if required)']
    .forEach((n, i) => sh.appendRow([Utilities.getUuid(), 'All', n, i + 1]));
}

function seedTeamMembers(ss) {
  const sh = ss.getSheetByName('TeamMembers');
  if (sh.getLastRow() > 1) return;
  ['Calvin'].forEach((n, i) => sh.appendRow([Utilities.getUuid(), n, i + 1]));
}

function seedMeasureTypes(ss) {
  const sh = ss.getSheetByName('MeasureTypes');
  if (sh.getLastRow() > 1) return;
  ['Hoarding size', 'Reinstatement lot size'].forEach((n, i) => sh.appendRow([Utilities.getUuid(), n, i + 1]));
}

function seedSwmsSteps(ss) {
  const sh = ss.getSheetByName('SwmsSteps');
  if (sh.getLastRow() > 1) return;
  const J = a => a.join('\n');

  const common = () => ([
    { no: 1, step: 'Lorry & workers reach at loading bay',
      method: ['Change working pass at security counter before start work',
               'Bring along work permit copy & workers documents (IC, passport, visa, CIDB)',
               'Check site dilapidation, floor tiles, sprinkler head, smoke curtain, fire shutter, hose reel, AC diffuser, fire door, CCTV — avoid blocking',
               'Snap pictures of all defects before start'],
      haz: ['Lorry hit on item / premise', 'Lorry hit on person'],
      imp: ['Damage to premise', 'Injury to workers / public'],
      ctrl: ['Drive safely', 'Not driving when sleepy', 'Banksman to guide at loading bay'], i: 4, l: 2 },
    { no: 2, step: 'Unload materials, tools and equipment from lorry',
      method: ['Unload materials, tools and equipment from lorry', 'Place all items on trolley brought by HG'],
      haz: ['Back pain from manual lifting', 'Item(s) drop when carrying'],
      imp: ['Muscle strain', 'Injury to hand / leg'],
      ctrl: ['Use trolley', 'Work with buddy system', 'Use safety glove'], i: 3, l: 4 },
    { no: 3, step: 'Barricade work area and place floor protection',
      method: ['Place barricade cone around work area c/w safety signage',
               'Place floor protection on common walkway from loading bay to installation area for trolley mobilization'],
      haz: ['Fell on slippery floor', 'Trip on unclear debris', 'Step on nail / screw on floor'],
      imp: ['Slip / trip / fall injury', 'Puncture wound'],
      ctrl: ['Safety shoes', 'Use safety glove', 'Clear off debris onsite'], i: 2, l: 3 },
    { no: 4, step: 'Floor protection mat installation for materials, tools and equipment placement',
      method: ['Place materials, tools and equipment on floor protection mat for easy monitoring and installation'],
      haz: ['Fell on slippery floor', 'Trip on unclear debris', 'Step on nail / screw on floor'],
      imp: ['Slip / trip / fall injury'],
      ctrl: ['Safety shoes', 'Use safety glove', 'Clear off debris onsite'], i: 2, l: 3 },
    { no: 5, step: 'Prepare and place ladder for work at height (below 4m)',
      method: ['Use double sided step ladder / telescoping ladder', 'Inspect ladder before use'],
      haz: ['Fell from ladder', 'Drop item when working at height'],
      imp: ['Fall injury', 'Injury to person below'],
      ctrl: ['Work with buddy system', 'Use tool belt', 'Maintain 3-point contact on ladder'], i: 4, l: 3 }
  ]);
  const closing = () => ([
    { no: 20, step: 'Testing',
      method: ['Test sturdiness by pushing frontward & backward in mild force', 'If not sturdy, install additional screw, tie & structure'],
      haz: ['Structure fall', 'Flimsy structure', 'Step on nail / screw'],
      imp: ['Crush / impact injury'],
      ctrl: ['Safety shoes', 'Work with buddy system', 'Competent supervisor onsite'], i: 4, l: 3 },
    { no: 21, step: 'Packing up',
      method: ['Pack balance material and equipment on trolley and move back to lorry'],
      haz: ['Fell on slippery floor', 'Trip on debris', 'Step on nail / screw'],
      imp: ['Slip / trip / fall injury'],
      ctrl: ['Safety shoes', 'Clear off debris'], i: 2, l: 3 },
    { no: 22, step: 'Clean up',
      method: ['Sweep and clear off all debris onsite', 'Scrap off glue stain / stubborn debris',
               'Mop and clear including lift & loading bay area', 'Check with mall security & management before leaving'],
      haz: ['Fell on slippery floor'],
      imp: ['Slip / fall injury'],
      ctrl: ['Safety shoes', 'Clear off debris'], i: 2, l: 3 },
    { no: 23, step: 'Snap pictures for reporting',
      method: ['Snap pictures of completed work and working area for record and report'],
      haz: ['NA'], imp: ['NA'], ctrl: ['NA'], i: 1, l: 1 }
  ]);
  const hoardingInstall = [
    { no: 6, step: 'Hoarding marking after on-site measurement checking',
      method: ['Setup hoarding alignment & marking by referring to approved hoarding drawing using laser lining machine',
               'Onsite safety briefing to team before start work'],
      haz: ['NA'], imp: ['NA'], ctrl: ['NA'], i: 1, l: 1 },
    { no: 7, step: 'Hoarding installation onsite',
      method: ['Pre-fabricate each hoarding panel with timber structure on floor within barricaded area; join board panels with screw',
               'Push jointed panel up from floor, place within laser line (adjust to site condition)',
               'Continue joining hoarding panels until whole structure complete',
               'With concrete counterweight: install slanted timber support with timber frame base to hold counterweight until complete',
               'Install sliding / swing door for hoarding access'],
      haz: ['Hoarding fall', 'Step on nail / screw', 'Item(s) fall (tools)', 'Worker(s) fall', 'Flimsy structure on hoarding'],
      imp: ['Crush / impact injury', 'Injury to public'],
      ctrl: ['Safety shoes', 'Work with buddy system', 'Use safety glove', 'Barricade working site to keep public out',
             'Full PPE compulsory', 'Competent supervisor onsite'], i: 4, l: 3 }
  ];
  const visualInstall = [
    { no: 8, step: 'Visual tarpaulin installation onsite',
      method: ['Buddy system: worker A on ladder, worker B passes tarpaulin; A staples top edge until top complete',
               'Adjust bottom by pulling tarpaulin firm & smooth, then staple',
               'Continue until complete', 'Use hot gun to smoothen wrinkled tarpaulin (if required)',
               'Install aluminium skirting as visual frame to cover staple marks'],
      haz: ['Fall from height', 'Step on nail / screw', 'Item(s) fall (tools)', 'Worker(s) fall', 'Flimsy structure on hoarding'],
      imp: ['Crush / impact injury', 'Injury to public'],
      ctrl: ['Safety shoes', 'Work with buddy system', 'Use safety glove', 'Barricade working site to keep public out',
             'Full PPE compulsory', 'Competent supervisor onsite'], i: 4, l: 3 }
  ];

  function write(service, steps) {
    steps.forEach(function (s) {
      sh.appendRow([Utilities.getUuid(), service, s.no, s.step, J(s.method), J(s.haz), J(s.imp),
                    J(s.ctrl), s.i, s.l, '', s.no]);
    });
  }
  write('Hoarding', common().concat(hoardingInstall, closing()));
  write('Visual',   common().concat(visualInstall,   closing()));
}

function seedPanels(ss) {
  const p = ss.getSheetByName('Panels');
  const r = ss.getSheetByName('PanelRates');
  if (p.getLastRow() > 1 || r.getLastRow() > 1) return;
  const id1 = Utilities.getUuid(), id2 = Utilities.getUuid();
  p.appendRow([id1, 'ABC Engineering Sdn Bhd', 'Mr Tan', '012-3456789', 'abc@example.com', 'SAMPLE — replace with real panel', 'system', new Date()]);
  p.appendRow([id2, 'XYZ M&E Sdn Bhd', 'Ms Lim', '012-9876543', 'xyz@example.com', 'SAMPLE — replace with real panel', 'system', new Date()]);
  r.appendRow([Utilities.getUuid(), 'ABC Engineering Sdn Bhd', 'Sprinkler dismantling', 'SCM', 'Per lot', 1500, 2500, '≤ 1000 sqft', 'May 2025', 'SAMPLE', 'system', new Date()]);
  r.appendRow([Utilities.getUuid(), 'XYZ M&E Sdn Bhd', 'Sprinkler dismantling', 'SCM', 'Per lot', 1800, 2800, '≤ 1000 sqft', 'Mar 2025', 'SAMPLE', 'system', new Date()]);
}
