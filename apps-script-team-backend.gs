/**
 * HG TEAM COMMAND — Apps Script Backend (Option B: Apps Script-hosted)
 * =====================================================================
 *
 * TWO FILES IN THIS APPS SCRIPT PROJECT (single-file approach — PROVEN WORKING):
 *   1. Code.gs       ← this file (server logic + sheet I/O)
 *   2. Index.html    ← the ENTIRE app (HTML + CSS + all JS inline)
 *                      = a copy of apps-script-Index.html (identical to team-command.html)
 *
 * HOW IT SERVES:
 *   doGet() returns HtmlService.createTemplateFromFile('Index').evaluate().
 *   All JavaScript lives INLINE inside Index.html in one <script> block.
 *   This is the same pattern as the other working HG projects (workers, project-pl).
 *   NOTE: never put a `<?` sequence anywhere in Index.html — createTemplateFromFile
 *   treats `<? ?>` as server scriptlets and will break the page. (Verified clean.)
 *
 * SETUP (ONE-TIME):
 *   1. Paste this file into Code.gs (Apps Script editor)
 *   2. Set SHEET_ID below to your Google Sheet's ID
 *   3. Run setupSheet() once to create the entity tabs
 *   4. (Optional) Run authorizeDriveAccess() once to enable photo uploads
 *   5. Add an HTML file named exactly  Index  and paste the FULL contents of
 *      apps-script-Index.html into it.
 *      ⚠ It is ~340KB. Paste must complete fully — if the editor cuts it off the
 *        page will hang on load. After pasting, scroll to the bottom and confirm
 *        the last lines are  })();  </script>  </body>  </html>.
 *   6. Deploy → New deployment → Web app
 *        Execute as: Me
 *        Who has access: Anyone within hggroup.com.my  (max security)
 *        — OR — Anyone (if your @hggroup.com.my isn't a Workspace domain)
 *   7. Copy the Web App URL. Share with @hggroup.com.my staff only.
 *
 * SAFE UPDATE / ROLLBACK:
 *   All data lives in the Google Sheet (SHEET_ID), NOT in the deployment.
 *   So redeploying never touches data. To roll back to a known-good build:
 *     Deploy → Manage deployments → pencil/Edit → Version → pick the good version → Deploy.
 *   (Version 23 is the last confirmed-working snapshot.)
 *
 *   The API_TOKEN below is only used by the legacy local-file fetch mode
 *   (handleLegacyApi). The hosted app uses google.script.run + the domain guard.
 */

// ==================== CONFIG (EDIT THESE) ====================

const SHEET_ID       = '13RyP32dcy7NZgriK4jPx-4XxfVB9vI6LsHGKWEIyBBc';
const API_TOKEN      = 'mA7HJNuYGHmXhLXRnUMcMA0fkA4HTHxDiC3HfwSHrpHq69xc';
const ALLOWED_DOMAIN = 'hggroup.com.my'; // set to '' to disable domain check

// ==================== END CONFIG ====================

const ENTITIES = [
  'jobs', 'scaffoldMaterials', 'greenTagLogs', 'rorobinEvents',
  'storageReminders', 'hoardingQuotes', 'expenses',
  'clients', 'sites', 'team', 'lorries'
];

const PHOTO_FOLDER_NAME = 'HG Team Command — Photos';

// ==================== HTTP HANDLERS ====================

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.action) return handleLegacyApi(e); // legacy local-file mode

  // Apps Script-hosted mode — serve the full single-file app (all JS inline).
  // createTemplateFromFile + evaluate() is the proven pattern (same as your other
  // working projects). Inline <script> JS passes through fine — the validator only
  // chokes when raw JS is read via createHtmlOutputFromFile separately.
  try {
    checkDomainOrThrow();
    return HtmlService.createTemplateFromFile('Index')
      .evaluate()
      .setTitle('HG Team Command Center')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  } catch (err) {
    const safeMsg = String(err.message || err)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return HtmlService.createHtmlOutput(
      '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Access Denied</title></head>' +
      '<body style="font-family:-apple-system,Arial;padding:40px;background:#0a0e1a;color:#fff;text-align:center">' +
      '<h1 style="color:#ef4444;font-size:48px;margin-bottom:16px">&#128683;</h1>' +
      '<h2 style="color:#ef4444">Access Denied</h2>' +
      '<p style="font-size:16px;margin-top:20px;max-width:600px;margin-left:auto;margin-right:auto;word-wrap:break-word">' + safeMsg + '</p>' +
      '<p style="color:#a0a8b8;font-size:14px;margin-top:30px">Restricted to @' + ALLOWED_DOMAIN + ' users.</p>' +
      '</body></html>'
    );
  }
}

function doPost(e) { return handleLegacyApi(e); }

// (No separate JS loader. All app JS is inline in Index.html, served by doGet above.)

// ==================== DOMAIN GUARD ====================

function checkDomainOrThrow() {
  if (!ALLOWED_DOMAIN) return;
  const email = (Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email) {
    throw new Error('Not signed in to Google. Please sign in with your @' + ALLOWED_DOMAIN + ' account.');
  }
  if (!email.endsWith('@' + ALLOWED_DOMAIN.toLowerCase())) {
    throw new Error('Access restricted to @' + ALLOWED_DOMAIN + '. You are signed in as: ' + email);
  }
}

// ==================== SERVER FUNCTIONS (called via google.script.run) ====================

function serverInfo() {
  checkDomainOrThrow();
  return {
    ok: true,
    sheetId: SHEET_ID,
    sheetIdShort: SHEET_ID.slice(0, 8) + '...',
    signedInAs: Session.getActiveUser().getEmail() || '(no session)',
    appliedUser: Session.getActiveUser().getEmail() || 'Unknown',
    entities: ENTITIES,
    timestamp: new Date().toISOString(),
    domainCheck: ALLOWED_DOMAIN || 'disabled',
    mode: 'apps-script-hosted'
  };
}

function serverPull() {
  checkDomainOrThrow();
  const user = Session.getActiveUser().getEmail() || 'Unknown';
  return { ok: true, state: pullState(), user: user, timestamp: new Date().toISOString() };
}

function serverPush(state) {
  checkDomainOrThrow();
  if (!state) throw new Error('Missing state payload');
  const user = Session.getActiveUser().getEmail() || 'Unknown';
  pushState(state, user);
  return { ok: true, savedAt: new Date().toISOString(), user: user, recordCount: countRecords(state) };
}

// ==================== LEGACY FETCH API (for local-file mode, kept for backwards compat) ====================

function handleLegacyApi(e) {
  try {
    const params = (e && e.parameter) || {};
    let body = {};
    if (e && e.postData && e.postData.contents) {
      try { body = JSON.parse(e.postData.contents); } catch (_) {}
    }
    const token = params.token || body.token;
    if (!token || token !== API_TOKEN) return reply({ error: 'Invalid or missing API token' });

    const sessionEmail = (Session.getActiveUser().getEmail() || '').toLowerCase();
    if (ALLOWED_DOMAIN && sessionEmail && !sessionEmail.endsWith('@' + ALLOWED_DOMAIN.toLowerCase())) {
      return reply({ error: 'Access restricted to @' + ALLOWED_DOMAIN + ' (signed-in as ' + sessionEmail + ')' });
    }

    const action = params.action || body.action;
    const user = sessionEmail || params.user || body.user || 'Unknown';

    if (action === 'info') {
      return reply({ ok: true, sheetId: SHEET_ID, sheetIdShort: SHEET_ID.slice(0,8)+'...', signedInAs: sessionEmail || '(not signed in)', appliedUser: user, entities: ENTITIES, timestamp: new Date().toISOString(), domainCheck: ALLOWED_DOMAIN || 'disabled', drivePhotos: 'enabled' });
    }
    if (action === 'pull') return reply({ ok: true, state: pullState(), user: user, timestamp: new Date().toISOString() });
    if (action === 'push') {
      if (!body.state) return reply({ error: 'Missing state' });
      pushState(body.state, user);
      return reply({ ok: true, savedAt: new Date().toISOString(), user: user, recordCount: countRecords(body.state) });
    }
    if (action === 'upload-photo') {
      if (!body.payload) return reply({ error: 'Missing payload' });
      try {
        const result = uploadPhotoToDrive(body.payload, user);
        return reply({ ok: true, ...result });
      } catch (e) {
        return reply({ error: 'Upload failed: ' + e.message });
      }
    }
    return reply({ error: 'Unknown action: ' + action });
  } catch (err) {
    return reply({ error: String(err && err.message || err) });
  }
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ==================== SHEET I/O ====================

function getSheet(name) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function pullState() {
  const state = {};
  ENTITIES.forEach(ent => { state[ent] = readEntity(ent); });
  state.settings = readSettings();
  return state;
}

function pushState(state, user) {
  ENTITIES.forEach(ent => {
    if (Array.isArray(state[ent])) writeEntity(ent, state[ent]);
  });
  if (state.settings) writeSettings(state.settings);
  logSync(user, 'push', state);
}

function readEntity(name) {
  const sh = getSheet(name);
  const last = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (last < 2 || lastCol < 1) return [];
  const range = sh.getRange(1, 1, last, lastCol).getValues();
  const headers = range[0];
  return range.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      const v = row[i];
      if (!h) return;
      if (h === '_json' && v) {
        try { Object.assign(obj, JSON.parse(v)); } catch (_) {}
      } else {
        if (v === '') return;
        if (v instanceof Date) obj[h] = v.toISOString();
        else obj[h] = v;
      }
    });
    return obj;
  }).filter(o => o.id);
}

function writeEntity(name, records) {
  const sh = getSheet(name);
  sh.clear();
  if (!records || records.length === 0) return;

  const allKeys = new Set();
  records.forEach(r => Object.keys(r).forEach(k => allKeys.add(k)));
  const keys = Array.from(allKeys);

  const simpleKeys = [];
  const complexKeys = [];
  keys.forEach(k => {
    const allSimple = records.every(r => {
      const v = r[k];
      return v === null || v === undefined || typeof v !== 'object';
    });
    if (allSimple) simpleKeys.push(k); else complexKeys.push(k);
  });

  const priority = ['id','no','service','invoiceNo','invoiceDate','status','clientName','location','pic','value','createdAt','createdBy','updatedAt','updatedBy'];
  simpleKeys.sort((a, b) => {
    const ai = priority.indexOf(a), bi = priority.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  const headers = [...simpleKeys];
  if (complexKeys.length) headers.push('_json');

  const rows = records.map(r => {
    const row = simpleKeys.map(k => {
      let v = r[k];
      if (v === undefined || v === null) return '';
      if (typeof v === 'string' && v.startsWith('data:image/')) return '[photo-local]';
      return v;
    });
    if (complexKeys.length) {
      const cx = {};
      complexKeys.forEach(k => {
        const stripped = stripHeavyDeep(r[k]);
        if (stripped !== undefined && stripped !== null) cx[k] = stripped;
      });
      row.push(JSON.stringify(cx));
    }
    return row;
  });

  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#1c2335').setFontColor('#ffffff');
  if (rows.length) sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sh.setFrozenRows(1);
}

function stripHeavyDeep(v) {
  if (v === null || v === undefined) return v;
  if (typeof v === 'string') {
    if (v.startsWith('data:image/')) return '[photo-local]';
    return v;
  }
  if (Array.isArray(v)) return v.map(stripHeavyDeep);
  if (typeof v === 'object') {
    const out = {};
    Object.keys(v).forEach(k => {
      if (k === 'issuedBySignature' || k === 'receivedBySignature') {
        if (typeof v[k] === 'string' && v[k].startsWith('data:')) {
          out[k] = '[signature-local]';
          return;
        }
      }
      out[k] = stripHeavyDeep(v[k]);
    });
    return out;
  }
  return v;
}

function readSettings() {
  const sh = getSheet('settings');
  const last = sh.getLastRow();
  if (last < 2) return null;
  const v = sh.getRange(2, 2).getValue();
  if (!v) return null;
  try { return JSON.parse(v); } catch (_) { return null; }
}

function writeSettings(settings) {
  const sh = getSheet('settings');
  sh.clear();
  sh.getRange(1, 1, 1, 2).setValues([['key', 'value']]).setFontWeight('bold').setBackground('#1c2335').setFontColor('#ffffff');
  sh.getRange(2, 1, 1, 2).setValues([['_settings', JSON.stringify(stripHeavyDeep(settings))]]);
}

function logSync(user, action, state) {
  const sh = getSheet('_SyncLog');
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, 5).setValues([['timestamp', 'user', 'action', 'jobCount', 'totalRecords']]).setFontWeight('bold').setBackground('#1c2335').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  sh.appendRow([new Date().toISOString(), user, action, state.jobs ? state.jobs.length : 0, countRecords(state)]);
}

function countRecords(state) {
  return ENTITIES.reduce((s, e) => s + (state[e] ? state[e].length : 0), 0);
}

// ==================== DRIVE PHOTO UPLOAD (v2.1) ====================
/**
 * Accepts a base64 data URL + metadata, uploads to a Drive folder named
 * "HG Team Command — Photos", sets domain-shareable, returns thumbnail URL.
 * Called via fetch action='upload-photo'.
 */
function uploadPhotoToDrive(payload, user) {
  if (!payload || !payload.dataUrl) throw new Error('Missing dataUrl');
  // Accept any file type — images, PDFs, etc.
  const m = String(payload.dataUrl).match(/^data:([\w.\-+/]+);base64,(.+)$/);
  if (!m) throw new Error('Invalid data URL format');
  const mimeType = m[1];
  // Derive file extension from MIME type
  const extMap = {'image/jpeg':'jpg','image/jpg':'jpg','image/png':'png','image/gif':'gif','image/webp':'webp','application/pdf':'pdf'};
  const ext = extMap[mimeType] || (mimeType.split('/').pop() || 'bin');
  const bytes = Utilities.base64Decode(m[2]);
  const stamp = Utilities.formatDate(new Date(), 'GMT+8', 'yyyyMMdd_HHmmss');
  const rand = Math.floor(Math.random() * 10000);
  const prefix = String(payload.prefix || 'photo').replace(/[^a-zA-Z0-9_-]/g, '');
  const filename = prefix + '_' + stamp + '_' + rand + '.' + ext;

  const blob = Utilities.newBlob(bytes, mimeType, filename);
  const folder = getOrCreatePhotoFolder();
  const file = folder.createFile(blob);

  // Sharing: prefer domain-only, fall back to anyone-with-link
  try {
    file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (_) {}
  }

  // Optional description with who uploaded
  try { file.setDescription('Uploaded by ' + (user || 'unknown') + ' on ' + new Date().toISOString()); } catch (_) {}

  const id = file.getId();
  return {
    id: id,
    url: 'https://drive.google.com/thumbnail?id=' + id + '&sz=w1200',
    viewUrl: file.getUrl(),
    filename: filename
  };
}

function getOrCreatePhotoFolder() {
  const folders = DriveApp.getFoldersByName(PHOTO_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  const folder = DriveApp.createFolder(PHOTO_FOLDER_NAME);
  try { folder.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW); } catch (_) {}
  return folder;
}

// ==================== ONE-TIME SETUP HELPERS ====================

function generateToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let t = '';
  for (let i = 0; i < 48; i++) t += chars[Math.floor(Math.random() * chars.length)];
  Logger.log('---- COPY THIS TOKEN ----');
  Logger.log(t);
  Logger.log('-------------------------');
  return t;
}

/**
 * Run this ONCE (Run → authorizeDriveAccess) to grant the script Drive access.
 * Until this runs, photo uploads will fail with "permission denied".
 * Creates the photo folder if it doesn't exist.
 */
function authorizeDriveAccess() {
  const folder = getOrCreatePhotoFolder();
  Logger.log('---- DRIVE ACCESS AUTHORIZED ----');
  Logger.log('Photo folder: ' + folder.getName());
  Logger.log('Folder URL: ' + folder.getUrl());
  Logger.log('All future photo uploads will land here.');
  Logger.log('----------------------------------');
}

function setupSheet() {
  if (SHEET_ID === 'PASTE_YOUR_GOOGLE_SHEET_ID_HERE' || !SHEET_ID) {
    throw new Error('Set SHEET_ID first (top of this file).');
  }
  const ss = SpreadsheetApp.openById(SHEET_ID);
  ENTITIES.forEach(name => {
    if (!ss.getSheetByName(name)) ss.insertSheet(name);
  });
  if (!ss.getSheetByName('settings')) ss.insertSheet('settings');
  if (!ss.getSheetByName('_SyncLog')) {
    const log = ss.insertSheet('_SyncLog');
    log.getRange(1, 1, 1, 5).setValues([['timestamp', 'user', 'action', 'jobCount', 'totalRecords']]).setFontWeight('bold');
    log.setFrozenRows(1);
  }
  const s1 = ss.getSheetByName('Sheet1');
  if (s1 && s1.getLastRow() <= 1 && s1.getLastColumn() <= 1) ss.deleteSheet(s1);
  Logger.log('Setup complete. ' + (ENTITIES.length + 2) + ' tabs ready.');
}
