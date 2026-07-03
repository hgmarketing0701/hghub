/**
 * HG Services — Job Completion Report
 * Google Apps Script backend for job-report.html
 *
 * What it does:
 *   1. Receives a job submission (job details + base64 photos)
 *   2. Finds/creates a root Drive folder ("HG Services — Job Reports")
 *   3. Finds/creates a sub-folder named after the lot number
 *   4. Uploads the auto-straightened photos as JPGs into that folder
 *   5. Generates a Google Doc → PDF report matching the exact HG template,
 *      with logo, dark banner, 3 numbered tables, and 2-column photo grid
 *   6. Appends a summary row to the JCR Summary tab of this Sheet
 *
 * ============ FIRST-TIME SETUP ============
 *
 * 1. Create a new Google Sheet. Name it: "HG Services — Job Completion Reports"
 * 2. Extensions → Apps Script
 * 3. Delete the placeholder code → paste THIS ENTIRE FILE
 * 4. ðŸ’¾ Save → name the project "HG JCR API"
 * 5. Function dropdown → choose "setup" → ▶ Run → approve permissions
 *    (Drive + Docs + Sheets + Script — all required)
 * 6. Deploy → New deployment
 *    - Type: Web app
 *    - Execute as: Me
 *    - Who has access: Anyone   ← important
 *    - Click Deploy → copy the Web App URL (ends with /exec)
 * 7. In job-report.html → click ☁ pill (top right) → paste URL → Save
 *
 * ============ NOTES ============
 *
 * - Default root folder: "HG Services — Job Reports" in My Drive.
 * - Lot folder name = the lot number. Re-submitting the same lot adds files
 *   into the same folder (does NOT overwrite).
 * - PDF file: "JCR-<lot>-<timestamp>.pdf" — re-submissions keep history.
 * - Summary tab: "JCR Summary". Auto-created.
 * - Logo: fetched from your Drive (set LOGO_FILE_ID below — see instructions
 *   at the bottom of this file). The fetched data URL is cached for 6 hours
 *   so it only re-reads from Drive when you replace the logo.
 */

const TZ           = 'GMT+8';
const SUMMARY_TAB  = 'JCR Summary';
const DEFAULT_ROOT = 'HG Services — Job Reports';

// Domain lock: only Google accounts ending with @hggroup.com.my can access.
// Set to '' (empty string) to disable the check and allow any Google account.
// NOTE: requires your team to be on Google Workspace at hggroup.com.my —
// Session.getActiveUser() only returns the visitor's email when they're in
// the same Workspace as the script owner.
const ALLOWED_DOMAIN = 'hggroup.com.my';

// Admin emails — only these accounts see the 🗑 Delete button on the Recent
// Submissions table and can call deleteSubmission(). Add or remove emails
// here (lowercase) and re-deploy to change who has admin power.
const ADMIN_EMAILS = [
  'lee@hggroup.com.my'
];

const COMPANY = {
  name:    'HG SERVICES (M) SDN BHD',
  tagline: 'Facilities Management & Fit-Out Contractor Support',
  footer:  'HG Services (M) Sdn Bhd  |  Confidential'
};

const SUMMARY_HEADERS = [
  'Submitted At', 'Job Date', 'Lot Number', 'Trade Name', 'Mall / Site',
  'Job Scope', 'Status',
  'Client', 'Reference',
  'Lorry No.', 'Lorry Code',
  'Supervisor', 'Hoarding Workers',
  'Visual Supervisor', 'Visual Workers',
  'Hoarding Type', 'Panel', 'Door', 'Counterweight',
  'Floor Protection', 'Fabric', 'Visual Material', 'Skirting',
  'Photo Count', 'Remarks',
  'Drive Folder', 'PDF Report',
  'Submitted By',
  'Other Workers', 'Other Materials'
];

/* ============ LIST DEFAULTS (seeded on first setup; admin can add new items
   from the form, persisted in Script Properties so all staff see the same list) ============ */

const DEFAULT_SUPERVISORS = [
  'Tim','Wai','Mion','Tuck','Arel','Red','Hadi','Baan',
  'Balan (Outsource)','Driver (Outsource)','Gabriel (Back Up)','Cheang','Thong'
];

const DEFAULT_WORKERS = [
  'Abu Bakkor','Akash','Alamin-2','Angarshah','Anwar','Arif Hossain','Azizul','Based',
  'Bijoy','Billal','Deen Islam','Ekram Shardar','Eleyas','Forid','Hasan Bepari','Hazrat Bepari',
  'Ibrahim','Ifran','Iqbal','Ismail','Liton Khan','Mahimur','Mamun','Manik',
  'Md Arif','Md Jomir','Mokarom','Nasir Uddin','Rabu Biswas','Rayhan','Sahidul','Sapan',
  'Shafiqul','Shah Ali','Shakil','Shakil-2','Shakil-3','Sohag','Sohel Sikder','Uzzal Gazi'
];

// Combined "Code - Plate" format. Edit via Manage Lists → Lorries.
const DEFAULT_LORRIES = [
  'ST02 - VCA7999','ST03 - VBK7999','ST04 - VDW7999','ST05 - VED7999',
  'ST06 - JUF7999','ST07 - NDQ7999','ST08 - TCP7999','ST09 - VKC7999',
  'ST10 - DEY7999','ST11 - QM7999R','ST12 - BSE7999','ST13 - PRW7999','ST14 - QS7999X'
];

const DEFAULT_MALLS = [
  'Central i-City','AEON Mid Valley','AEON Bukit Raja','AEON Cheras Selatan',
  'AEON One Utama','AEON Sunway Pyramid','AEON Setia Alam','AEON Shah Alam',
  'AEON Taman Maluri','AEON Tebrau City','AEON Quill City KL','AEON Wangsa Maju',
  'Mid Valley Megamall','Sunway Pyramid','Sunway Velocity','Sunway Putra Mall',
  'Pavilion KL','Pavilion Bukit Jalil','Suria KLCC','1 Utama','The Curve',
  'TRX Exchange 106','Setia City Mall','Paradigm Mall PJ','IOI City Mall','MyTown Cheras'
];

// Format: 'Category > Subscope'. UI groups them by the part before " > ".
// Anything without " > " gets shown in an "Other" group, so old flat items still work.
const DEFAULT_SCOPES = [
  'Hoarding > Installation','Hoarding > Modification','Hoarding > Rectification',
  'Hoarding > Dismantling','Hoarding > Repair','Hoarding > Relocation',
  'Hoarding > Reconfiguration (Push-In)','Hoarding > Reconfiguration (Push-Out)',
  'Hoarding > Additional Counterweight','Hoarding > Skirting Installation',
  'Visual > Sticker Installation','Visual > Tarpaulin Installation','Visual > Removal',
  'Scaffold > Installation','Scaffold > Dismantling',
  'Reinstatement > Reinstatement Work','Reinstatement > Touch Up Work',
  'Fit Out > Partition Work','Fit Out > Plaster Ceiling',
  'Fit Out > Tiling - Wall','Fit Out > Tiling - Floor',
  'Fit Out > Flooring - Cement Screeding','Fit Out > Brick Wall',
  'Fit Out > Painting Work','Fit Out > Others',
  'Sprinkler > Installation','Sprinkler > Dismantling',
  'Sprinkler > Modification','Sprinkler > Rectification',
  'Others > Project / Construction Hoarding - Installation',
  'Others > Collect Board','Others > Flushing Services',
  'Others > Wet Chemical Dismantling','Others > Temporary Storage'
];

const DEFAULT_STATUSES         = ['COMPLETE','PARTIAL','IN PROGRESS','PENDING','DEFECT'];
const DEFAULT_HOARDING_TYPES   = ['Kiosk','Island','Inline','Perimeter','Corridor','Mixed'];
const DEFAULT_PANELS           = ['MDF','Plywood','Particle Board','Metal','Fingerjoint'];
const DEFAULT_DOORS            = ['Swing','Double Swing','Sliding','Double Sliding','None'];
const DEFAULT_COUNTERWEIGHTS   = ['Yes','No','N/A'];
const DEFAULT_FLOOR_PROTECTIONS= ['Yes','No','N/A'];
const DEFAULT_FABRICS          = ['Top cover','Side cover','Full cover','None'];
const DEFAULT_VISUAL_MATERIALS = ['Sticker','Tarpaulin','Vinyl','Mesh','Wallpaper','None'];
const DEFAULT_SKIRTINGS        = ['Aluminium','Timber','N/A'];
const DEFAULT_PHOTO_STAGES     = ['Before','During','After','Other'];
const DEFAULT_OTHER_MATERIALS  = []; // empty by default — admin adds via Manage Lists

const LIST_KEYS = [
  'supervisors','workers','lorries',
  'malls','scopes','statuses',
  'hoardingTypes','panels','doors',
  'counterweights','floorProtections',
  'fabrics','visualMaterials','skirtings','otherMaterials','photoStages'
];
const LIST_DEFAULTS = {
  supervisors:      DEFAULT_SUPERVISORS,
  workers:          DEFAULT_WORKERS,
  lorries:          DEFAULT_LORRIES,
  malls:            DEFAULT_MALLS,
  scopes:           DEFAULT_SCOPES,
  statuses:         DEFAULT_STATUSES,
  hoardingTypes:    DEFAULT_HOARDING_TYPES,
  panels:           DEFAULT_PANELS,
  doors:            DEFAULT_DOORS,
  counterweights:   DEFAULT_COUNTERWEIGHTS,
  floorProtections: DEFAULT_FLOOR_PROTECTIONS,
  fabrics:          DEFAULT_FABRICS,
  visualMaterials:  DEFAULT_VISUAL_MATERIALS,
  skirtings:        DEFAULT_SKIRTINGS,
  otherMaterials:   DEFAULT_OTHER_MATERIALS,
  photoStages:      DEFAULT_PHOTO_STAGES
};

/* ============ ENDPOINTS ============ */

function doGet(e) {
  // Health-check ping (used by the "Test connection" button on local file mode)
  if (e && e.parameter && e.parameter.ping) {
    return jsonResp({ ok: true, service: 'HG-JCR', time: new Date().toISOString() });
  }
  // Domain check — block anyone outside @hggroup.com.my
  if (!isAuthorized_()) return accessDeniedHtml_();
  // Otherwise serve the HTML page (staff-facing form)
  const t = HtmlService.createTemplateFromFile('Index');
  t.logoDataUrl = getLogoDataUrl_();
  t.currentUser = Session.getActiveUser().getEmail() || '';
  t.isAdmin = isAdmin_();
  return t.evaluate()
    .setTitle('HG Services — Job Completion Report')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

/* ============ DOMAIN-LOCK HELPERS ============ */

function isAuthorized_() {
  if (!ALLOWED_DOMAIN) return true;
  const email = (Session.getActiveUser().getEmail() || '').toLowerCase();
  return email.endsWith('@' + ALLOWED_DOMAIN.toLowerCase());
}

function isAdmin_() {
  if (!isAuthorized_()) return false;
  const email = (Session.getActiveUser().getEmail() || '').toLowerCase();
  return ADMIN_EMAILS.map(s => String(s).toLowerCase()).indexOf(email) >= 0;
}

function accessDeniedHtml_() {
  const email = Session.getActiveUser().getEmail() || '(not detected — sign in to a Google account)';
  const html =
    '<!DOCTYPE html><html><head><meta charset="UTF-8"/>' +
    '<title>Access restricted</title>' +
    '<style>body{font-family:Arial,Helvetica,sans-serif;background:#0a0e1a;color:#fff;padding:60px 24px;text-align:center;margin:0}' +
    '.box{max-width:480px;margin:0 auto;background:#141926;border:1px solid #2a3245;border-radius:12px;padding:36px 28px}' +
    'h1{color:#f59e0b;margin:0 0 14px;font-size:22px}' +
    'p{color:#a0a8b8;line-height:1.55;margin:6px 0;font-size:14px}' +
    'code{background:#1c2335;padding:3px 8px;border-radius:4px;color:#f59e0b;font-size:0.92em}' +
    '</style></head><body><div class="box">' +
    '<h1>⛔ Access restricted</h1>' +
    '<p>This page is for <code>@' + ALLOWED_DOMAIN + '</code> staff only.</p>' +
    '<p>You\'re signed in as <code>' + email + '</code>.</p>' +
    '<p style="margin-top:18px">Please switch to your <code>@' + ALLOWED_DOMAIN + '</code> account and refresh, or contact your admin.</p>' +
    '</div></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('Access restricted');
}

function denyJson_() { return { ok: false, error: 'Access denied. Please sign in with your @' + ALLOWED_DOMAIN + ' account.' }; }

function doPost(e) {
  try {
    if (!isAuthorized_()) return jsonResp(denyJson_());
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    let result;
    if (action === 'submitReport') result = submitReport(data);
    else throw new Error('Unknown action: ' + action);
    return jsonResp({ ok: true, result });
  } catch (err) {
    return jsonResp({ ok: false, error: err.toString() });
  }
}

/**
 * Callable from the served HTML via google.script.run. Same logic as doPost
 * but wrapped so the front-end gets a plain {ok, result|error} object back.
 */
function submitReportApi(payload) {
  if (!isAuthorized_()) return denyJson_();
  try {
    const result = submitReport(payload);
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err.toString() };
  }
}

/* ============ DROPDOWN LISTS (server-side, shared across all staff) ============ */

function getList(key) {
  const props = PropertiesService.getScriptProperties();
  const stored = props.getProperty('list.' + key);
  if (stored) {
    try { return JSON.parse(stored); } catch (e) { /* fall through */ }
  }
  return (LIST_DEFAULTS[key] || []).slice();
}

function setList(key, items) {
  const arr = (items || []).filter(v => v !== null && v !== undefined && String(v).trim() !== '');
  // De-dupe (case-insensitive)
  const seen = new Set();
  const unique = [];
  arr.forEach(v => {
    const s = String(v).trim();
    const k = s.toLowerCase();
    if (!seen.has(k)) { seen.add(k); unique.push(s); }
  });
  PropertiesService.getScriptProperties().setProperty('list.' + key, JSON.stringify(unique));
  return unique;
}

/** Returns all selectable lists for initial page load. */
function getLists() {
  if (!isAuthorized_()) return {};
  const out = {};
  LIST_KEYS.forEach(k => out[k] = getList(k));
  return out;
}

/** Append a value to a list (no-op if already present). Returns the updated list. */
function addToList(key, value) {
  if (!isAuthorized_()) throw new Error('Access denied');
  if (LIST_KEYS.indexOf(key) < 0) throw new Error('Unknown list key: ' + key);
  const v = String(value || '').trim();
  if (!v) throw new Error('Empty value');
  const list = getList(key);
  const exists = list.some(x => String(x).trim().toLowerCase() === v.toLowerCase());
  if (!exists) {
    list.push(v);
    setList(key, list);
  }
  return list;
}

/** Remove a value from a list (no-op if not present). Returns the updated list. */
function removeFromList(key, value) {
  if (!isAuthorized_()) throw new Error('Access denied');
  if (LIST_KEYS.indexOf(key) < 0) throw new Error('Unknown list key: ' + key);
  const v = String(value || '').trim();
  if (!v) throw new Error('Empty value');
  const list = getList(key);
  const filtered = list.filter(x => String(x).trim().toLowerCase() !== v.toLowerCase());
  setList(key, filtered);
  return filtered;
}

/** Rename a value in a list (in-place, keeping its position). Errors if the
 * old value isn't found or the new value already exists somewhere else.
 * Note: this only updates the LIST. Previously-submitted reports keep the
 * old spelling in the Sheet — re-submit those to see the new value. */
function renameListItem(key, oldValue, newValue) {
  if (!isAuthorized_()) throw new Error('Access denied');
  if (LIST_KEYS.indexOf(key) < 0) throw new Error('Unknown list key: ' + key);
  const oldV = String(oldValue || '').trim();
  const newV = String(newValue || '').trim();
  if (!oldV || !newV) throw new Error('Both old and new values are required.');
  const list = getList(key);
  const idx = list.findIndex(x => String(x).trim().toLowerCase() === oldV.toLowerCase());
  if (idx < 0) throw new Error('Item not found: "' + oldV + '"');
  // Only block duplicates when the new value differs from the old (case-sensitive comparison
  // would allow "abc" → "ABC" if needed, but for safety treat case-insensitive as same).
  if (oldV.toLowerCase() !== newV.toLowerCase()) {
    const dup = list.findIndex((x, i) => i !== idx && String(x).trim().toLowerCase() === newV.toLowerCase());
    if (dup >= 0) throw new Error('"' + newV + '" already exists in this list.');
  }
  list[idx] = newV;
  setList(key, list);
  return list;
}

function jsonResp(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }

/* ============ MAIN ============ */

function submitReport(data) {
  const job = data.job || {};
  const photos = data.photos || [];
  if (!job.lot)   throw new Error('Lot number required');
  if (!job.date)  throw new Error('Installation date required');
  if (!job.trade) throw new Error('Trade name required');
  if (!photos.length) throw new Error('At least one photo required');

  const rootName = (data.root || DEFAULT_ROOT).trim() || DEFAULT_ROOT;
  const root    = findOrCreateRootFolder_(rootName);
  const lotName = sanitizeFolder_(job.lot);
  const lot     = findOrCreateChildFolder_(root, lotName);
  // Share the lot folder with the whole hggroup.com.my domain (view only).
  // Safe to call even if already shared — Drive treats it as a no-op.
  shareDomainView_(lot);

  // Upload photos
  const stamp = Utilities.formatDate(new Date(), TZ, 'yyyyMMdd-HHmmss');
  const uploaded = [];
  photos.forEach((p, idx) => {
    const safe = sanitizeFile_(p.name || ('photo-' + (idx + 1) + '.jpg'));
    const fname = stamp + '_' + safe;
    const blob = dataUrlToBlob_(p.dataUrl, fname);
    const file = lot.createFile(blob);
    shareDomainView_(file);
    uploaded.push({ file, stage: p.stage || '', caption: p.caption || '' });
  });

  // PDF: prefer a client-rendered PDF if the page sent one (matches the on-screen
  // preview pixel-for-pixel). Fall back to DocumentApp generation if not provided.
  const pdfBaseName = buildReportFileName_(job);
  let pdfFile;
  if (data.pdfDataUrl) {
    const pdfBlob = dataUrlToBlob_(data.pdfDataUrl, pdfBaseName + '.pdf');
    pdfFile = lot.createFile(pdfBlob);
  } else {
    pdfFile = buildPdf_(job, uploaded, lot, stamp, pdfBaseName);
  }
  shareDomainView_(pdfFile);

  // Append summary row
  const sh = ensureSummarySheet_();
  const m  = job.manpower  || {};
  const mt = job.materials || {};
  const submittedBy = Session.getActiveUser().getEmail() || '';

  // Lorry came in as a single combined string ("ST02 - VCA7999"). Split it
  // back into code + plate so the existing Sheet columns stay populated.
  // Fall back to whatever the client sent if the combined field is missing.
  let lorryNo   = m.lorryNo   || '';
  let lorryCode = m.lorryCode || '';
  const combined = (m.lorry || '').trim();
  if (combined) {
    const parts = combined.split(/\s*-\s*/);
    if (parts.length >= 2) {
      lorryCode = parts[0].trim();
      lorryNo   = parts.slice(1).join(' - ').trim();
    } else {
      lorryNo = combined; // unsplittable — preserve full string in the plate column
    }
  }
  sh.appendRow([
    new Date(),
    job.date  || '',
    job.lot   || '',
    job.trade || '',
    job.mall  || '',
    job.scope || '',
    job.status || '',
    job.client || '',
    job.ref    || '',
    lorryNo,
    lorryCode,
    m.hoardSup  || '',
    m.hoardWk   || '',
    m.visSup    || '',
    m.visWk     || '',
    mt.type    || '',
    mt.panel   || '',
    mt.door    || '',
    mt.counter || '',
    mt.floor   || '',
    mt.fabric  || '',
    mt.visual  || '',
    mt.skirt   || '',
    photos.length,
    job.remarks || '',
    lot.getUrl(),
    pdfFile.getUrl(),
    submittedBy,
    m.otherWk || '',
    mt.other  || ''
  ]);

  return {
    folderUrl: lot.getUrl(),
    folderId:  lot.getId(),
    pdfUrl:    pdfFile.getUrl(),
    pdfId:     pdfFile.getId(),
    sheetUrl:  ss().getUrl(),
    photoCount: photos.length,
    submittedBy: submittedBy
  };
}

/* ============ ADMIN: delete a submission row (admin only) ============ */

/**
 * Removes a single row from the JCR Summary sheet.
 * `submittedAt` is the exact value shown in the page table — formatted as
 * 'yyyy-MM-dd HH:mm' so it matches what getRecentSubmissions returns.
 * The Drive folder + PDF are NOT deleted automatically (admin can clean those
 * up manually if needed). Returns { ok, message } for the UI to display.
 */
function deleteSubmission(submittedAt) {
  if (!isAdmin_()) return { ok: false, error: 'Access denied — admin only. Contact lee@hggroup.com.my' };
  const sh = ss().getSheetByName(SUMMARY_TAB);
  if (!sh) return { ok: false, error: 'No summary sheet found.' };
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: false, error: 'No data to delete.' };
  const folderColIdx = SUMMARY_HEADERS.indexOf('Drive Folder');
  const folderCol = folderColIdx >= 0 ? folderColIdx + 1 : 0; // 1-based, 0 = not found
  const tsCol = sh.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < tsCol.length; i++) {
    const v = tsCol[i][0];
    const tsStr = (v instanceof Date)
      ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm')
      : String(v).slice(0, 16);
    if (tsStr === submittedAt) {
      const rowIdx = i + 2;
      // Try to also trash the Drive folder (which trashes all files inside it,
      // including the PDF). If anything goes wrong, we still delete the sheet
      // row but include the warning in the message.
      let folderMessage = '';
      if (folderCol) {
        const folderUrl = String(sh.getRange(rowIdx, folderCol).getValue() || '');
        const idMatch = folderUrl.match(/\/folders\/([\w-]+)/);
        if (idMatch) {
          try {
            DriveApp.getFolderById(idMatch[1]).setTrashed(true);
            folderMessage = ' Drive folder + PDF moved to Trash (recoverable for 30 days).';
          } catch (e) {
            folderMessage = ' (Warning: Drive folder could not be trashed: ' + e.message + ')';
          }
        }
      }
      sh.deleteRow(rowIdx);
      return { ok: true, message: 'Row removed.' + folderMessage };
    }
  }
  return { ok: false, error: 'Row not found (Submitted-At "' + submittedAt + '" did not match).' };
}

/* ============ RECENT SUBMISSIONS (read for in-page summary table) ============ */

/**
 * Returns one page of submissions (newest first) + total count for pagination.
 * `limit` rows per page (default 50, max 500). `offset` skips that many newest
 * rows before fetching the page.
 * Returns { rows: [...], total: N }.
 */
function getRecentSubmissions(limit, offset) {
  if (!isAuthorized_()) return { rows: [], total: 0 };
  const sh = ss().getSheetByName(SUMMARY_TAB);
  if (!sh) return { rows: [], total: 0 };
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { rows: [], total: 0 };
  const total = lastRow - 1;
  const max  = Math.min(limit || 50, 500);
  const off  = Math.max(0, offset || 0);
  // Page slice from the END (newest first). Skip `off` newest rows, take `max`.
  const endRow   = lastRow - off;             // last row of this page (1-based)
  const startRow = Math.max(2, endRow - max + 1);
  if (endRow < 2 || startRow > endRow) return { rows: [], total: total };
  const numRows = endRow - startRow + 1;
  const numCols = SUMMARY_HEADERS.length;
  const data = sh.getRange(startRow, 1, numRows, numCols).getValues();
  const out = data.map(row => {
    const o = {};
    SUMMARY_HEADERS.forEach((h, i) => {
      const v = row[i];
      o[h] = (v instanceof Date) ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm') : v;
    });
    return o;
  });
  return { rows: out.reverse(), total: total };
}

/**
 * Server-side search across the WHOLE JCR Summary sheet — used by the Recent
 * Submissions filter so a user typing "klcc" gets every matching row from any
 * page, not just the current 50.
 *  - query   : free-text, matches any column (case-insensitive)
 *  - dateFrom: yyyy-mm-dd (inclusive) — filter on Job Date column
 *  - dateTo  : yyyy-mm-dd (inclusive)
 * Returns newest-first array. Capped at 1000 matches to keep payloads sane.
 */
function searchAllSubmissions(query, dateFrom, dateTo) {
  if (!isAuthorized_()) return [];
  const sh = ss().getSheetByName(SUMMARY_TAB);
  if (!sh) return [];
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  const q    = String(query    || '').trim().toLowerCase();
  const from = String(dateFrom || '').trim();
  const to   = String(dateTo   || '').trim();
  if (!q && !from && !to) return [];
  const numCols = SUMMARY_HEADERS.length;
  const data = sh.getRange(2, 1, lastRow - 1, numCols).getValues();
  const out = [];
  const MAX = 1000;
  for (let i = 0; i < data.length && out.length < MAX; i++) {
    const row = data[i];
    const o = {};
    for (let j = 0; j < numCols; j++) {
      const v = row[j];
      o[SUMMARY_HEADERS[j]] = (v instanceof Date) ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm') : v;
    }
    // Date filter on Job Date column
    if (from || to) {
      const rd = String(o['Job Date'] || '').slice(0, 10);
      if (!rd) continue;
      if (from && rd < from) continue;
      if (to   && rd > to)   continue;
    }
    // Text filter — match any column
    if (q) {
      let hit = false;
      for (let k = 0; k < numCols; k++) {
        const v = o[SUMMARY_HEADERS[k]];
        if (v != null && String(v).toLowerCase().indexOf(q) >= 0) { hit = true; break; }
      }
      if (!hit) continue;
    }
    out.push(o);
  }
  // Newest first
  out.reverse();
  return out;
}

/* ============ FOLDER HELPERS ============ */

function findOrCreateRootFolder_(name) {
  const it = DriveApp.getRootFolder().getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.getRootFolder().createFolder(name);
}
function findOrCreateChildFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
function sanitizeFolder_(n) {
  return String(n).replace(/[\\\/:\*\?"<>\|]/g, '_').trim().slice(0, 100) || 'unnamed';
}
function sanitizeFile_(n) {
  return String(n).replace(/[\\\/:\*\?"<>\|]/g, '_').trim().slice(0, 120) || 'photo.jpg';
}

/** Builds "HG SERVICES - JOB COMPLETION REPORT (Lot, Mall, Scope)" — sanitised
 * for Drive (no slashes, etc.) and capped at ~200 chars so it never breaks. */
function buildReportFileName_(job) {
  const parts = [
    String(job.lot   || '').trim(),
    String(job.mall  || '').trim(),
    String(job.scope || '').trim()
  ].filter(Boolean);
  const tail = parts.length ? ' (' + parts.join(', ') + ')' : '';
  const raw  = 'HG SERVICES - JOB COMPLETION REPORT' + tail;
  return sanitizeFile_(raw).slice(0, 200) || 'HG SERVICES - JOB COMPLETION REPORT';
}
function dataUrlToBlob_(dataUrl, name) {
  const m = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('Bad dataUrl for ' + name);
  return Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], name);
}

/** Share a File or Folder as "anyone in the hggroup.com.my domain with the
 * link can view". Safe to call repeatedly. Silently logs (doesn't throw) on
 * failure so a single share error never blocks the rest of a submission. */
function shareDomainView_(driveItem) {
  if (!driveItem) return;
  try {
    driveItem.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    Logger.log('shareDomainView_ failed for ' + (driveItem.getName ? driveItem.getName() : '?') + ': ' + e.message);
  }
}

/* ============ PDF / DOC BUILD ============ */

function buildPdf_(job, uploaded, lotFolder, stamp, customName) {
  const docName = customName || ('JCR-' + sanitizeFile_(job.lot) + '-' + stamp);
  const doc = DocumentApp.create(docName);
  const body = doc.getBody();

  // A4 page size in points (1 pt = 1/72 inch; A4 = 595.35 × 841.89 pt)
  body.setPageWidth(595.35);
  body.setPageHeight(841.89);
  body.setMarginTop(36).setMarginBottom(40).setMarginLeft(40).setMarginRight(40);

  // Remove the initial empty paragraph so our content starts at the top
  while (body.getNumChildren() > 1) body.removeChild(body.getChild(0));

  /* ===== HEADER: logo + company name ===== */
  const headTbl = body.appendTable([['', '']]);
  styleBorderless_(headTbl);
  const logoCell = headTbl.getCell(0, 0);
  const nameCell = headTbl.getCell(0, 1);
  logoCell.setWidth(75).setPaddingTop(0).setPaddingBottom(0).setPaddingLeft(0).setPaddingRight(8);
  nameCell.setPaddingTop(0).setPaddingBottom(0).setPaddingLeft(0).setPaddingRight(0);

  // Logo — fetched from Drive (see LOGO_FILE_ID config at bottom of file)
  try {
    const logoBlob = getLogoBlob_();
    if (!logoBlob) throw new Error('Logo not configured');
    logoCell.clear();
    const logoPara = logoCell.appendParagraph('');
    const logoImg = logoPara.appendInlineImage(logoBlob);
    logoImg.setWidth(70).setHeight(38);
  } catch (e) {
    logoCell.editAsText().setText('HG').setBold(true).setFontSize(22);
  }
  // Company name + tagline — matches original sample: Arial bold 13pt + 9.5pt #555
  nameCell.clear();
  const cName = nameCell.appendParagraph(COMPANY.name);
  cName.setBold(true).setFontSize(13).setForegroundColor('#111111');
  cName.setAttributes({ FONT_FAMILY: 'Arial' });
  cName.setSpacingBefore(0).setSpacingAfter(0);
  cName.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
  const cTag = nameCell.appendParagraph(COMPANY.tagline);
  cTag.setFontSize(9.5).setForegroundColor('#555555').setItalic(false).setBold(false);
  cTag.setAttributes({ FONT_FAMILY: 'Arial' });
  cTag.setSpacingBefore(0).setSpacingAfter(0);
  cTag.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);

  // Thin dark separator line below the header table
  body.appendHorizontalRule();

  /* ===== TITLE BLOCK (white background, dark text — matches original) ===== */
  const subtitle = job.scope ? titleCase_(job.scope) : '';
  const metaLine = [job.mall, formatLongDate_(job.date), 'Status: ' + (job.status || 'COMPLETE')]
    .filter(x => x).join('  |  ');

  const bTitle = body.appendParagraph('JOB COMPLETION REPORT');
  bTitle.setBold(true).setFontSize(20).setForegroundColor('#111111');
  bTitle.setAttributes({ FONT_FAMILY: 'Arial' });
  bTitle.setSpacingBefore(10).setSpacingAfter(4);

  if (subtitle) {
    const bSub = body.appendParagraph(subtitle);
    bSub.setBold(false).setFontSize(11).setForegroundColor('#555555');
    bSub.setAttributes({ FONT_FAMILY: 'Arial' });
    bSub.setSpacingBefore(0).setSpacingAfter(2);
  }
  if (metaLine) {
    const bMeta = body.appendParagraph(metaLine);
    bMeta.setBold(false).setFontSize(10).setForegroundColor('#555555');
    bMeta.setAttributes({ FONT_FAMILY: 'Arial' });
    bMeta.setSpacingBefore(0).setSpacingAfter(12);
  }

  /* ===== SECTION 1: PROJECT INFORMATION ===== */
  const piRows = [];
  piRows.push(['Mall Name',         job.mall || '—']);
  piRows.push(['Lot Number',        job.lot  || '—']);
  piRows.push(['Trade Name',        job.trade || '—']);
  piRows.push(['Job Scope',         job.scope || '—']);
  piRows.push(['Job Date',          formatLongDate_(job.date)]);
  piRows.push(['Completion Status', job.status || 'COMPLETE']);
  if (job.client) piRows.push(['Client',    job.client]);
  if (job.ref)    piRows.push(['Reference', job.ref]);

  numberedSection_(body, '1. PROJECT INFORMATION');
  appendDataTable_(body, 'Field', 'Details', piRows);

  /* ===== SECTION 2: ON-SITE MANPOWER ===== */
  const m = job.manpower || {};
  const mpRows = [];
  // Lorry: prefer the combined single field. Fall back to legacy split fields
  // (older clients may still send them separately) by joining with " - ".
  const lorryDisplay = (m.lorry || '').trim()
    || [m.lorryCode, m.lorryNo].filter(x => x && String(x).trim()).join(' - ');
  if (lorryDisplay) mpRows.push(['Lorry',              lorryDisplay]);
  if (m.hoardSup)   mpRows.push(['Supervisor',         m.hoardSup]);
  if (m.hoardWk)   mpRows.push(['Hoarding Workers',    m.hoardWk]);
  if (m.visSup)    mpRows.push(['Visual Supervisor(s)', m.visSup]);
  if (m.visWk)     mpRows.push(['Visual Worker(s)',    m.visWk]);
  if (m.otherWk)   mpRows.push(['Other Worker(s)',     m.otherWk]);
  if (mpRows.length) {
    numberedSection_(body, '2. ON-SITE MANPOWER');
    appendDataTable_(body, 'Role', 'Name(s)', mpRows);
  }

  /* ===== SECTION 3: MATERIALS USED ===== */
  const mt = job.materials || {};
  const anyMat = Object.values(mt).some(v => v && String(v).trim());
  let sectionNum = mpRows.length ? 3 : 2;
  if (anyMat) {
    const mtRows = [
      ['Hoarding Type',                          dash_(mt.type)],
      ['Hoarding Panel',                         dash_(mt.panel)],
      ['Hoarding Door',                          dash_(mt.door)],
      ['Counterweight',                          dash_(mt.counter)],
      ['Floor Protection within Hoarding Area',  dash_(mt.floor)],
      ['Fabric',                                 dash_(mt.fabric)],
      ['Visual Material',                        dash_(mt.visual)],
      ['Skirting',                               dash_(mt.skirt)]
    ];
    if (mt.other) mtRows.push(['Other Materials', mt.other]);
    numberedSection_(body, sectionNum + '. MATERIALS USED');
    appendDataTable_(body, 'Item', 'Specification / Details', mtRows);
    sectionNum++;
  }

  /* ===== SECTION 4: SITE PHOTOGRAPHS ===== */
  if (uploaded.length) {
    numberedSection_(body, sectionNum + '. SITE PHOTOGRAPHS');
    sectionNum++;

    if (job.photoDesc) {
      const desc = body.appendParagraph(job.photoDesc);
      desc.setFontSize(9.5).setItalic(true).setForegroundColor('#444444');
      desc.setSpacingBefore(0).setSpacingAfter(8);
    }

    // 2-column grid of photos, matching the on-page preview:
    // - Thin grey border around each photo cell
    // - Photos fill the available column width (A4 - 80pt margins = 515pt;
    //   each column ~ 257pt; image scaled to ~245pt to leave room for padding)
    const colWidth = 255; // pt — half of usable A4 width minus a small gap
    const photoTbl = body.appendTable();
    photoTbl.setBorderColor('#DDDDDD').setBorderWidth(0.5);

    for (let i = 0; i < uploaded.length; i += 2) {
      const row = photoTbl.appendTableRow();
      for (let j = 0; j < 2; j++) {
        const idx = i + j;
        const cell = row.appendTableCell();
        cell.setWidth(colWidth);
        // Zero padding — image fills the cell frame edge-to-edge
        cell.setPaddingTop(0).setPaddingBottom(0).setPaddingLeft(0).setPaddingRight(0);
        cell.clear();
        if (idx < uploaded.length) {
          const u = uploaded[idx];
          try {
            const blob = u.file.getBlob();
            const imgPara = cell.appendParagraph('');
            imgPara.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
            imgPara.setSpacingBefore(0).setSpacingAfter(0);
            const img = imgPara.appendInlineImage(blob);
            // Fill the full cell width (255pt) for landscape photos, and
            // up to 330pt height for portrait photos. The image is scaled
            // by whichever dimension hits its limit first.
            const boxW = 255;
            const boxH = 330;
            const origW = img.getWidth();
            const origH = img.getHeight();
            const scale = Math.min(boxW / origW, boxH / origH);
            img.setWidth(Math.round(origW * scale)).setHeight(Math.round(origH * scale));
          } catch (e) {
            cell.appendParagraph('[image error]').setFontSize(8).setForegroundColor('#aa0000');
          }
          // Caption — sits flush under the image. Small left indent so it
          // doesn't crowd against the cell border.
          const stage  = u.stage && u.stage !== 'Other' ? u.stage : '';
          const cap    = u.caption || '';
          const capText = stage
            ? (cap ? stage + ' — ' + cap : stage)
            : (cap || ('Photo ' + (idx + 1)));
          const capPara = cell.appendParagraph(capText);
          capPara.setFontSize(8.5).setForegroundColor('#333333').setItalic(false);
          capPara.setSpacingBefore(2).setSpacingAfter(2);
          capPara.setIndentStart(6).setIndentEnd(6);
          capPara.setAttributes({ FONT_FAMILY: 'Arial' });
          if (stage) {
            const t = capPara.editAsText();
            const stageColor = stage === 'Before' ? '#1D4ED8'
                             : stage === 'During' ? '#B45309'
                             : stage === 'After'  ? '#15803D' : '#111111';
            t.setBold(0, stage.length - 1, true);
            t.setForegroundColor(0, stage.length - 1, stageColor);
          }
        } else {
          cell.appendParagraph('');
        }
      }
    }
  }

  /* ===== REMARKS ===== */
  if (job.remarks) {
    numberedSection_(body, sectionNum + '. REMARKS');
    const r = body.appendParagraph(job.remarks);
    r.setFontSize(10).setForegroundColor('#222222');
  }

  /* ===== FOOTER ===== */
  const footer = doc.addFooter();
  const fp = footer.appendParagraph(COMPANY.footer + '  |  Generated ' +
    Utilities.formatDate(new Date(), TZ, 'dd MMM yyyy HH:mm'));
  fp.setFontSize(8).setForegroundColor('#777777')
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER);

  doc.saveAndClose();

  // Convert Doc → PDF, save into the lot folder, trash the temp Doc
  const docFile = DriveApp.getFileById(doc.getId());
  const pdfBlob = docFile.getAs('application/pdf').setName(docName + '.pdf');
  const pdfFile = lotFolder.createFile(pdfBlob);
  docFile.setTrashed(true);
  return pdfFile;
}

/* ============ DOC BUILDER HELPERS ============ */

function numberedSection_(body, text) {
  const p = body.appendParagraph(text);
  p.setBold(true).setFontSize(11).setForegroundColor('#111111');
  // FONT_FAMILY is a valid paragraph attribute; BORDER_BOTTOM is NOT supported
  // in Apps Script — use appendHorizontalRule() below the heading instead.
  p.setAttributes({ FONT_FAMILY: 'Arial' });
  p.setSpacingBefore(14).setSpacingAfter(0);
  body.appendHorizontalRule();
}

function appendDataTable_(body, headK, headV, rows) {
  // Build table: header row + data rows
  const data = [[headK, headV]].concat(rows);
  const tbl = body.appendTable(data);
  tbl.setBorderColor('#CCCCCC').setBorderWidth(0.5);

  // Header row — dark fill, white bold text
  const headerRow = tbl.getRow(0);
  for (let c = 0; c < 2; c++) {
    const cell = headerRow.getCell(c);
    cell.setBackgroundColor('#2D2D2D');
    cell.setPaddingTop(5).setPaddingBottom(5).setPaddingLeft(8).setPaddingRight(8);
    if (c === 0) cell.setWidth(170);
    const t = cell.editAsText();
    t.setBold(true).setForegroundColor('#FFFFFF').setFontSize(9.5);
  }

  // Data rows
  for (let r = 1; r < tbl.getNumRows(); r++) {
    const row = tbl.getRow(r);
    const kCell = row.getCell(0);
    const vCell = row.getCell(1);
    kCell.setBackgroundColor('#F5F5F5').setWidth(170);
    kCell.setPaddingTop(4).setPaddingBottom(4).setPaddingLeft(8).setPaddingRight(8);
    vCell.setPaddingTop(4).setPaddingBottom(4).setPaddingLeft(8).setPaddingRight(8);
    kCell.editAsText().setBold(true).setForegroundColor('#444444').setFontSize(9.5);
    vCell.editAsText().setBold(false).setForegroundColor('#222222').setFontSize(9.5);
  }
}

function styleBorderless_(tbl) {
  try { tbl.setBorderWidth(0); } catch (e) {}
  try { tbl.setBorderColor('#FFFFFF'); } catch (e) {}
}

function dash_(v) { return (v && String(v).trim()) ? v : '–'; }

function titleCase_(s) {
  if (!s) return '';
  return s.replace(/\b([a-z])/g, function (_, c) { return c.toUpperCase(); })
          .replace(/\bAnd\b/g, '&');
}

function formatLongDate_(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso + 'T00:00:00');
    return Utilities.formatDate(d, TZ, 'dd MMMM yyyy');
  } catch (e) { return String(iso); }
}

/* ============ SUMMARY SHEET ============ */

function ensureSummarySheet_() {
  let sh = ss().getSheetByName(SUMMARY_TAB);
  if (!sh) sh = ss().insertSheet(SUMMARY_TAB);
  const lastCol = sh.getLastColumn();
  const cur = lastCol > 0
    ? sh.getRange(1, 1, 1, Math.max(lastCol, SUMMARY_HEADERS.length)).getValues()[0]
    : [];
  let needs = false;
  for (let i = 0; i < SUMMARY_HEADERS.length; i++) {
    if (cur[i] !== SUMMARY_HEADERS[i]) { needs = true; break; }
  }
  if (needs) {
    sh.getRange(1, 1, 1, SUMMARY_HEADERS.length).setValues([SUMMARY_HEADERS]);
    sh.getRange(1, 1, 1, SUMMARY_HEADERS.length)
      .setFontWeight('bold').setBackground('#2D2D2D').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    // Reasonable widths
    const widths = [150,100,100,140,180,200,90,140,120,90,90,160,260,160,200,
                    120,100,120,110,140,110,120,110,80,260,200,200];
    widths.forEach((w, i) => sh.setColumnWidth(i + 1, w));
  }
  return sh;
}

/* ============ SETUP ============ */

function setup() {
  ensureSummarySheet_();
  findOrCreateRootFolder_(DEFAULT_ROOT);
  // Seed selectable lists if not already set
  LIST_KEYS.forEach(k => {
    const cur = PropertiesService.getScriptProperties().getProperty('list.' + k);
    if (!cur) setList(k, LIST_DEFAULTS[k]);
  });
  const s1 = ss().getSheetByName('Sheet1');
  if (s1 && s1.getLastRow() <= 0 && ss().getSheets().length > 1) ss().deleteSheet(s1);
  Logger.log('Setup complete.');
  Logger.log('Default lists seeded: supervisors=' + getList('supervisors').length +
             ', workers=' + getList('workers').length +
             ', lorryCodes=' + getList('lorryCodes').length +
             ', lorryPlates=' + getList('lorryPlates').length);
  Logger.log('Next: Deploy → New deployment → Web app → Execute as: Me, Access: Anyone → share /exec URL with staff.');
}

/**
 * Reset a single list back to defaults. Pass the key as a string argument.
 * From the Apps Script editor's function dropdown, use one of the wrappers
 * below (resetScopes, resetSupervisors, etc.) since the Run button can't
 * pass arguments.
 */
function resetList(key) {
  if (!key) {
    Logger.log('Usage: resetList("supervisors") — or pick a wrapper from the function dropdown:');
    Logger.log('  resetScopes, resetSupervisors, resetWorkers, resetLorries, resetMalls,');
    Logger.log('  resetStatuses, resetHoardingTypes, resetPanels, resetDoors,');
    Logger.log('  resetCounterweights, resetFloorProtections, resetFabrics,');
    Logger.log('  resetVisualMaterials, resetSkirtings, resetOtherMaterials, resetPhotoStages');
    return;
  }
  if (LIST_KEYS.indexOf(key) < 0) throw new Error('Unknown list key: ' + key);
  setList(key, LIST_DEFAULTS[key] || []);
  Logger.log('✓ Reset "' + key + '" to ' + (LIST_DEFAULTS[key] || []).length + ' default items.');
}

// Zero-arg wrappers — pick any of these from the function dropdown + click Run.
function resetScopes()           { resetList('scopes'); }
function resetSupervisors()      { resetList('supervisors'); }
function resetWorkers()          { resetList('workers'); }
function resetLorries()          { resetList('lorries'); }
function resetMalls()            { resetList('malls'); }
function resetStatuses()         { resetList('statuses'); }
function resetHoardingTypes()    { resetList('hoardingTypes'); }
function resetPanels()           { resetList('panels'); }
function resetDoors()            { resetList('doors'); }
function resetCounterweights()   { resetList('counterweights'); }
function resetFloorProtections() { resetList('floorProtections'); }
function resetFabrics()          { resetList('fabrics'); }
function resetVisualMaterials()  { resetList('visualMaterials'); }
function resetSkirtings()        { resetList('skirtings'); }
function resetOtherMaterials()   { resetList('otherMaterials'); }
function resetPhotoStages()      { resetList('photoStages'); }

/**
 * Backfills the "anyone at hggroup.com.my with the link can view" share
 * permission across every lot folder + file under the root folder.
 * Run this once from the Apps Script editor after updating to this version,
 * so older reports (submitted before the auto-share was added) become
 * viewable by the rest of the team. New submissions auto-share themselves.
 *
 * Usage: function dropdown → shareAllExistingReports → ▶ Run.
 */
function shareAllExistingReports() {
  if (!isAdmin_()) {
    Logger.log('✗ Admin only (you must be in ADMIN_EMAILS).');
    return;
  }
  const root = findOrCreateRootFolder_(DEFAULT_ROOT);
  let folders = 0, files = 0, errs = 0;
  const folderIt = root.getFolders();
  while (folderIt.hasNext()) {
    const lot = folderIt.next();
    try { shareDomainView_(lot); folders++; } catch (e) { errs++; }
    const fileIt = lot.getFiles();
    while (fileIt.hasNext()) {
      const f = fileIt.next();
      try { shareDomainView_(f); files++; } catch (e) { errs++; }
    }
  }
  Logger.log('✓ Re-share complete. Folders: ' + folders + ', files: ' + files + ', errors: ' + errs);
  Logger.log('Anyone at @' + ALLOWED_DOMAIN + ' with a link can now view these items.');
}

/**
 * One-shot cleanup. Removes Script Properties that were seeded by earlier
 * versions of this script but are no longer used (split Lorry Code / Plate
 * lists, since they're now merged into a single "lorries" list).
 * Run once from the Apps Script editor after migrating, then ignore.
 */
function cleanupLegacyLists() {
  const props = PropertiesService.getScriptProperties();
  const obsolete = ['list.lorryCodes', 'list.lorryPlates'];
  let removed = 0;
  obsolete.forEach(k => {
    if (props.getProperty(k) !== null) {
      props.deleteProperty(k);
      Logger.log('✓ Removed property: ' + k);
      removed++;
    } else {
      Logger.log('· Already gone: ' + k);
    }
  });
  Logger.log('Cleanup done. Removed ' + removed + ' obsolete propert' + (removed === 1 ? 'y' : 'ies') + '.');
}

/* ============ DEV / DEBUG ============ */

function debugBuildSample() {
  // Generates a sample PDF in your Drive root using fake data + the embedded logo.
  // Run from the Apps Script editor to verify the template before going live.
  const job = {
    date: '2026-04-19',
    lot: 'GK-13',
    mall: 'Central i-City',
    trade: 'The Raw',
    status: 'COMPLETE',
    client: '',
    ref: '',
    scope: 'Hoarding and visual sticker installation',
    manpower: {
      lorryNo: 'QS7999X', lorryCode: 'ST14',
      hoardSup: 'Balan',
      hoardWk: 'Sohag, Uzzal Gazi, Eleyas, Forid, Azizul',
      visSup: 'Cheang, Thong (own transport)', visWk: ''
    },
    materials: {
      type: 'Kiosk', panel: 'MDF', door: 'Swing', counter: 'Yes',
      floor: '', fabric: 'Top cover', visual: 'Sticker', skirt: ''
    },
    photoDesc: 'Sample photo description line (debug).',
    remarks: ''
  };
  const root = findOrCreateRootFolder_(DEFAULT_ROOT);
  const lot  = findOrCreateChildFolder_(root, sanitizeFolder_('DEBUG-' + job.lot));
  const stamp = Utilities.formatDate(new Date(), TZ, 'yyyyMMdd-HHmmss');
  const pdf = buildPdf_(job, [], lot, stamp);
  Logger.log('Sample PDF: ' + pdf.getUrl());
}

/* ============ LOGO (Drive file ID — much simpler than embedding base64) ============
 *
 * Setup:
 *   1. Upload hg-logo.png to your Google Drive (anywhere — recommend a folder
 *      you won''t accidentally delete).
 *   2. Right-click the file → Get link → Copy link.
 *      Link format: https://drive.google.com/file/d/XXXXXXXXX/view?usp=sharing
 *      The XXXXXXXXX in the middle is the file ID.
 *   3. Paste the file ID into LOGO_FILE_ID below.
 *   4. Save → re-deploy (Manage deployments → ✏ → New version).
 *
 * Notes:
 *   - The script runs as you, so it can read your Drive files even if not
 *     publicly shared. No need to make the logo public.
 *   - The fetched logo is cached for 6 hours. If you replace the logo, run
 *     refreshLogoCache() from the Apps Script editor to clear the cache.
 */

const LOGO_FILE_ID = '1-fUOfz8eT8jkvPOWoWXyV5XOBG_rRRQI';  // hg-logo.png in Drive

function getLogoBlob_() {
  if (!LOGO_FILE_ID) return null;
  try {
    return DriveApp.getFileById(LOGO_FILE_ID).getBlob();
  } catch (e) {
    return null;
  }
}

function getLogoDataUrl_() {
  if (!LOGO_FILE_ID) return '';
  const cache = CacheService.getScriptCache();
  let url = cache.get('logoDataUrl');
  if (url) return url;
  const blob = getLogoBlob_();
  if (!blob) return '';
  const b64 = Utilities.base64Encode(blob.getBytes());
  url = 'data:' + blob.getContentType() + ';base64,' + b64;
  try { cache.put('logoDataUrl', url, 6 * 60 * 60); } catch (e) { /* item too large for cache, fine */ }
  return url;
}

function refreshLogoCache() {
  CacheService.getScriptCache().remove('logoDataUrl');
  Logger.log('Logo cache cleared. Next page load fetches fresh from Drive.');
}

/**
 * Run this to verify the domain check works. Function dropdown → testAuth → ▶ Run.
 * Reports your email and whether you'd be allowed in.
 */
function testAuth() {
  const email = Session.getActiveUser().getEmail();
  Logger.log('Your email (as seen by Apps Script): "' + email + '"');
  Logger.log('ALLOWED_DOMAIN: "' + ALLOWED_DOMAIN + '"');
  if (!ALLOWED_DOMAIN) {
    Logger.log('✓ Domain lock is DISABLED. Anyone with a Google account can access.');
    return;
  }
  if (!email) {
    Logger.log('⚠ No email returned. This usually means you are NOT on Google Workspace,');
    Logger.log('   or the visitor is from a different Workspace domain.');
    Logger.log('   In that case the domain check will BLOCK everyone — including you.');
    Logger.log('   → Either upgrade to Google Workspace at ' + ALLOWED_DOMAIN + ',');
    Logger.log('     or set ALLOWED_DOMAIN = "" to disable the check.');
    return;
  }
  if (isAuthorized_()) {
    Logger.log('✓ You ARE authorized. Domain check passes.');
  } else {
    Logger.log('✗ You are NOT authorized — email does not end with @' + ALLOWED_DOMAIN);
  }
}

/**
 * Run this once after setting LOGO_FILE_ID to verify the script can read the
 * logo from your Drive. Function dropdown → testLogo → ▶ Run → check the
 * Execution log for the result.
 */
function testLogo() {
  Logger.log('LOGO_FILE_ID = "' + LOGO_FILE_ID + '"');
  if (!LOGO_FILE_ID) {
    Logger.log('✗ LOGO_FILE_ID is EMPTY.');
    Logger.log('  → Scroll to the bottom of this file. Find: const LOGO_FILE_ID = \'\';');
    Logger.log('  → Paste your Drive file ID between the quotes.');
    Logger.log('  → Get the file ID from the Drive share link:');
    Logger.log('    https://drive.google.com/file/d/THIS_IS_THE_FILE_ID/view?usp=sharing');
    return;
  }
  try {
    const file = DriveApp.getFileById(LOGO_FILE_ID);
    const blob = file.getBlob();
    const bytes = blob.getBytes();
    Logger.log('✓ Logo found and readable!');
    Logger.log('  Name: ' + file.getName());
    Logger.log('  MIME: ' + blob.getContentType());
    Logger.log('  Size: ' + bytes.length + ' bytes');
    CacheService.getScriptCache().remove('logoDataUrl');
    Logger.log('  Cache cleared — refresh the staff page (Ctrl+Shift+R) to see it.');
  } catch (e) {
    Logger.log('✗ Failed to read file: ' + e.message);
    Logger.log('  Likely causes:');
    Logger.log('  1. The file ID has a typo. Double-check it matches the part between /d/ and /view in the share URL.');
    Logger.log('  2. The file was deleted or moved to trash.');
    Logger.log('  3. The file is owned by someone else and you don\'t have access.');
  }
}