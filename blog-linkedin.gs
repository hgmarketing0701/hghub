/**
 * Blog & LinkedIn Posting System — Backend (Apps Script)
 * Standalone web app. Captures a post (straightened image + job details),
 * saves the image to Drive and the record to a Google Sheet as "Pending".
 * Claude then pushes Pending rows to Wix Blog draft + Supergrow LinkedIn draft.
 *
 * SETUP (one time):
 *   1. Paste this file into Code.gs
 *   2. Paste blog-linkedin.html into an HTML file named exactly: Index
 *   3. Run setup() once, approve permissions
 *   4. Deploy > New deployment > Web app > Execute as: Me > Access: Anyone (or your domain)
 */

const SHEET_NAME = 'Posts';
const PROP = PropertiesService.getScriptProperties();

const HEADERS = [
  'ID', 'Created At', 'Job Scope', 'Mall', 'Brand', 'Job Date', 'Caption',
  'Image URL', 'Image File ID', 'Target',
  'Wix Status', 'LinkedIn Status', 'Wix Link', 'LinkedIn Link', 'Pushed At'
];

// ---- Web app entry ----
// No ?action  -> serves the HTML tool.
// ?action=... -> JSON API for Claude (guarded by &token=...).
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action) return _json(_api(p));
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Blog & LinkedIn Posting')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ---- JSON API (Claude reads Pending + writes draft links back) ----
function _api(p) {
  if (p.token !== _req('API_TOKEN')) return { error: 'unauthorized' };
  if (p.action === 'pending') return { posts: _pending() };
  if (p.action === 'mark')    return _mark(p);
  return { error: 'unknown action' };
}

function _pending() {
  const ss = SpreadsheetApp.openById(_req('SS_ID'));
  const sheet = ss.getSheetByName(SHEET_NAME);
  const v = sheet.getDataRange().getValues();
  if (v.length < 2) return [];
  const h = v.shift();
  const idx = {};
  h.forEach(function (n, i) { idx[n] = i; });
  const tz = ss.getSpreadsheetTimeZone();
  const out = [];
  v.forEach(function (r) {
    const wix = r[idx['Wix Status']], li = r[idx['LinkedIn Status']];
    if (wix !== 'Pending' && li !== 'Pending') return;
    const fids = String(r[idx['Image File ID']] || '').split(',')
      .map(function (s) { return s.trim(); }).filter(Boolean);
    out.push({
      id: r[idx['ID']],
      jobScope: r[idx['Job Scope']],
      mall: r[idx['Mall']],
      brand: r[idx['Brand']],
      jobDate: r[idx['Job Date']] instanceof Date ? Utilities.formatDate(r[idx['Job Date']], tz, 'yyyy-MM-dd') : r[idx['Job Date']],
      caption: r[idx['Caption']],
      target: r[idx['Target']],
      wixStatus: wix,
      linkedinStatus: li,
      imageFileId: fids[0] || '',
      images: fids.map(function (f) {
        return { fileId: f, downloadUrl: 'https://drive.google.com/uc?export=download&id=' + f };
      })
    });
  });
  return out;
}

function _mark(p) {
  const ss = SpreadsheetApp.openById(_req('SS_ID'));
  const sheet = ss.getSheetByName(SHEET_NAME);
  const v = sheet.getDataRange().getValues();
  const h = v[0];
  const idx = {};
  h.forEach(function (n, i) { idx[n] = i; });
  for (var r = 1; r < v.length; r++) {
    if (v[r][idx['ID']] === p.id) {
      const row = r + 1;
      if (p.channel === 'wix') {
        if (p.status) sheet.getRange(row, idx['Wix Status'] + 1).setValue(p.status);
        if (p.link)   sheet.getRange(row, idx['Wix Link'] + 1).setValue(p.link);
      } else if (p.channel === 'linkedin') {
        if (p.status) sheet.getRange(row, idx['LinkedIn Status'] + 1).setValue(p.status);
        if (p.link)   sheet.getRange(row, idx['LinkedIn Link'] + 1).setValue(p.link);
      }
      sheet.getRange(row, idx['Pushed At'] + 1)
        .setValue(Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm'));
      return { ok: true, id: p.id };
    }
  }
  return { error: 'id not found: ' + p.id };
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Run this any time to see your API token.
function getApiToken() {
  const t = PROP.getProperty('API_TOKEN');
  Logger.log(t || 'Not set yet — run setup() first.');
  return t;
}

// ---- One-time provisioning ----
function setup() {
  let ssId = PROP.getProperty('SS_ID');
  let ss;
  if (ssId) {
    ss = SpreadsheetApp.openById(ssId);
  } else {
    ss = SpreadsheetApp.create('Blog & LinkedIn Posting — Records');
    PROP.setProperty('SS_ID', ss.getId());
  }

  let sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
  const def = ss.getSheetByName('Sheet1');
  if (def && def.getSheetId() !== sheet.getSheetId()) ss.deleteSheet(def);

  let folderId = PROP.getProperty('FOLDER_ID');
  if (!folderId) {
    const folder = DriveApp.createFolder('Blog & LinkedIn Posting — Images');
    PROP.setProperty('FOLDER_ID', folder.getId());
    folderId = folder.getId();
  }

  let token = PROP.getProperty('API_TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    PROP.setProperty('API_TOKEN', token);
  }

  const info = {
    spreadsheetUrl: ss.getUrl(),
    spreadsheetId: ss.getId(),
    folderId: folderId,
    apiToken: token
  };
  Logger.log(JSON.stringify(info, null, 2));
  return info;
}

// ---- Save a new post ----
function savePost(payload) {
  const ss = SpreadsheetApp.openById(_req('SS_ID'));
  const sheet = ss.getSheetByName(SHEET_NAME);
  const folder = DriveApp.getFolderById(_req('FOLDER_ID'));
  const tz = ss.getSpreadsheetTimeZone();

  const id = 'P' + Date.now();

  // decode the edited image(s) (data URLs) and save to Drive — first = cover
  const images = (payload.images && payload.images.length)
    ? payload.images
    : (payload.imageData ? [payload.imageData] : []);
  if (!images.length) throw new Error('No image attached.');

  const urls = [], ids = [];
  images.forEach(function (d, i) {
    const m = String(d).match(/^data:(image\/\w+);base64,(.+)$/);
    if (!m) return;
    const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], id + '_' + (i + 1) + '.jpg');
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    ids.push(file.getId());
    urls.push('https://drive.google.com/uc?export=view&id=' + file.getId());
  });
  if (!ids.length) throw new Error('Could not read image data.');
  const viewUrl = urls.join(', ');

  const now = new Date();
  const target = payload.target || 'Both';
  const wixStatus = target === 'LinkedIn' ? 'N/A' : 'Pending';
  const liStatus = target === 'Wix' ? 'N/A' : 'Pending';

  sheet.appendRow([
    id,
    Utilities.formatDate(now, tz, 'yyyy-MM-dd HH:mm'),
    payload.jobScope || '',
    payload.mall || '',
    payload.brand || '',
    payload.jobDate || '',
    payload.caption || '',
    viewUrl,
    ids.join(', '),
    target,
    wixStatus,
    liStatus,
    '', '', ''
  ]);

  return { id: id, url: viewUrl, count: ids.length, fileIds: ids };
}

// ---- Read posts (client filters the rest) ----
function getPosts() {
  const ss = SpreadsheetApp.openById(_req('SS_ID'));
  const sheet = ss.getSheetByName(SHEET_NAME);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values.shift();
  const tz = ss.getSpreadsheetTimeZone();

  return values.map(function (r) {
    const o = {};
    headers.forEach(function (h, i) {
      let v = r[i];
      if (v instanceof Date) v = Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm');
      o[h] = v;
    });
    return o;
  }).reverse();
}

// ---- Edit a post's details (text fields + target) ----
function updatePost(id, d) {
  const ss = SpreadsheetApp.openById(_req('SS_ID'));
  const sheet = ss.getSheetByName(SHEET_NAME);
  const v = sheet.getDataRange().getValues();
  const h = v[0];
  const idx = {};
  h.forEach(function (n, i) { idx[n] = i; });
  for (var r = 1; r < v.length; r++) {
    if (v[r][idx['ID']] === id) {
      const row = r + 1;
      const set = function (col, val) { if (val !== undefined) sheet.getRange(row, idx[col] + 1).setValue(val); };
      set('Job Scope', d.jobScope);
      set('Mall', d.mall);
      set('Brand', d.brand);
      set('Job Date', d.jobDate);
      set('Caption', d.caption);
      if (d.target) {
        set('Target', d.target);
        const wcur = v[r][idx['Wix Status']], lcur = v[r][idx['LinkedIn Status']];
        // only flip Pending<->N/A; never overwrite Drafted/Posted
        let ws = wcur, ls = lcur;
        if (d.target === 'LinkedIn') { if (wcur === 'Pending' || wcur === 'N/A') ws = 'N/A'; }
        else { if (wcur === 'N/A') ws = 'Pending'; }
        if (d.target === 'Wix') { if (lcur === 'Pending' || lcur === 'N/A') ls = 'N/A'; }
        else { if (lcur === 'N/A') ls = 'Pending'; }
        set('Wix Status', ws);
        set('LinkedIn Status', ls);
      }
      return { ok: true, id: id };
    }
  }
  return { error: 'id not found: ' + id };
}

// ---- Delete a post (removes the row + trashes its Drive images) ----
function deletePost(id) {
  const ss = SpreadsheetApp.openById(_req('SS_ID'));
  const sheet = ss.getSheetByName(SHEET_NAME);
  const v = sheet.getDataRange().getValues();
  const h = v[0];
  const idx = {};
  h.forEach(function (n, i) { idx[n] = i; });
  for (var r = 1; r < v.length; r++) {
    if (v[r][idx['ID']] === id) {
      const fids = String(v[r][idx['Image File ID']] || '').split(',')
        .map(function (s) { return s.trim(); }).filter(Boolean);
      fids.forEach(function (f) {
        try { DriveApp.getFileById(f).setTrashed(true); } catch (e) {}
      });
      sheet.deleteRow(r + 1);
      return { ok: true, id: id };
    }
  }
  return { error: 'id not found: ' + id };
}

// ---- Helpers ----
function _req(key) {
  const v = PROP.getProperty(key);
  if (!v) throw new Error('Not set up yet. Run setup() once. Missing: ' + key);
  return v;
}
