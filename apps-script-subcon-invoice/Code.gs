/**
 * Black Lee — Subcon Invoice Generator (Cloud v1)
 * Google Apps Script backend, served as a Workspace-restricted web app.
 *
 * Purpose: generate an invoice ON BEHALF of an individual worker / subcon who
 *          does not issue their own invoice when they submit a claim.
 *
 * Storage: the Google Sheet this script is bound to (container-bound script).
 * Drive:   parent folder "Black Lee — Subcon Invoices"; each invoice gets its
 *          own subfolder containing the generated PDF. Subcon logos live in a
 *          "Logos" subfolder and are reused across invoices.
 * Auth:    Workspace domain restriction in appsscript.json + per-call guard.
 */

/* ===================== CONFIG ===================== */
const ALLOWED_DOMAIN = 'hggroup.com.my';
const PARENT_FOLDER_NAME = 'Black Lee — Subcon Invoices';
const LOGOS_SUBFOLDER = 'Logos';
const SST_RATE = 0.06;

/* ----------------------------------------------------------------------------
 * INVOICE FOOTER — edit the sentence between the quotes to whatever you want.
 * Leave it as '' (empty) to print no footer at all.
 * -------------------------------------------------------------------------- */
const INVOICE_FOOTER = 'Thank you for your business.';

const SHEETS = {
  INVOICES: 'Invoices',
  LINES:    'InvoiceLines',
  SUBCONS:  'Subcons',
  AUDIT:    'AuditLog',
};

const HEADERS = {
  Invoices: [
    'id','invNo','invDate','ref','issuerType','issuerName','issuerIc',
    'issuerAddr','issuerPhone','issuerEmail','billToName','billToAddr',
    'subtotal','sstEnabled','sstAmount','total','payInfo','notes',
    'pdfUrl','folderUrl','createdAt','createdBy',
  ],
  InvoiceLines: ['id','invoiceId','description','quantity','unitPrice','lineAmount'],
  Subcons: ['id','type','name','ic','addr','phone','email','payInfo','logoFileId','updatedAt'],
  AuditLog: ['timestamp','userEmail','action','recordType','recordId','details'],
};

const PROPS = PropertiesService.getScriptProperties();
const PROP_KEYS = {
  PARENT_FOLDER_ID: 'PARENT_FOLDER_ID',
  MY_COMPANY:       'MY_COMPANY',
};

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
    .setTitle('Black Lee — Subcon Invoices')
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
      const firstRow = sheet.getRange(1, 1, 1, HEADERS[name].length).getValues()[0];
      const empty = firstRow.every(function (v) { return v === '' || v === null; });
      if (empty) {
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
/* Sheets returns date-looking cells as Date objects; google.script.run can't
 * serialize those and silently delivers null. Coerce any Date to a plain
 * yyyy-MM-dd string before returning anything to the browser. */
function dateStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  return String(v == null ? '' : v);
}
function str_(v) { return (v instanceof Date) ? dateStr_(v) : String(v == null ? '' : v); }
function money_(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtRM_(n) { return 'RM ' + money_(n); }
function round2_(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function safeFilename_(s) {
  return String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);
}
function escapeHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function stripDataUrl_(b64) {
  const s = String(b64 || '');
  const m = s.match(/^data:[^;]+;base64,(.*)$/);
  return m ? m[1] : s;
}

/* ===================== AUDIT ===================== */
function logAudit_(action, recordType, recordId, details) {
  const email = (Session.getActiveUser().getEmail() || 'unknown').toLowerCase();
  ss_().getSheetByName(SHEETS.AUDIT).appendRow([
    nowIso_(), email, action, recordType, recordId, details || '',
  ]);
}

/* ===================== DRIVE FOLDERS ===================== */
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

function ensureLogosFolder_() {
  const parent = ensureParentFolder_();
  const it = parent.getFoldersByName(LOGOS_SUBFOLDER);
  return it.hasNext() ? it.next() : parent.createFolder(LOGOS_SUBFOLDER);
}

/* ===================== SETUP (run once) ===================== */
function setupConfig() {
  ensureSheets_();
  const folder = ensureParentFolder_();
  ensureLogosFolder_();
  const msg = [
    'Sheets initialised: ' + Object.values(SHEETS).join(', '),
    'Drive parent folder: ' + folder.getName() + ' (' + folder.getId() + ')',
    '',
    'Next: Deploy → New deployment → Web app',
    '  - Execute as: User accessing the web app',
    '  - Access:    Anyone within ' + ALLOWED_DOMAIN,
  ].join('\n');
  Logger.log(msg);
  return msg;
}

/* ===================== DIAGNOSTIC (run from editor) ===================== */
/**
 * Select this function in the editor → Run → open "Execution log".
 * If it prints a JSON object with "currentUser", the code is correct and the
 * problem is purely the deployment (publish a NEW VERSION).
 * If it throws, the paste is incomplete — re-paste the whole Code.gs.
 */
function logBootstrap() {
  var out = bootstrap();
  Logger.log('BOOTSTRAP OK → ' + JSON.stringify(out));
  return out;
}

/* ===================== PUBLIC API ===================== */
function bootstrap() {
  const email = requireDomain_();
  ensureSheets_();
  return {
    currentUser: email,
    serverTime:  nowIso_(),
    domain:      ALLOWED_DOMAIN,
    sstRate:     SST_RATE,
    myCompany:   getMyCompany_(),
    invoices:    listInvoices_(60),
    subcons:     listSubcons_(),
  };
}

function getMyCompany_() {
  try {
    const raw = PROPS.getProperty(PROP_KEYS.MY_COMPANY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return { name: '', addr: '' };
}

function setMyCompany(name, addr) {
  requireDomain_();
  const c = { name: String(name || '').trim(), addr: String(addr || '').trim() };
  PROPS.setProperty(PROP_KEYS.MY_COMPANY, JSON.stringify(c));
  return c;
}

function listInvoices_(limit) {
  return readSheet_(SHEETS.INVOICES)
    .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); })
    .slice(0, limit || 60)
    .map(function (r) {
      return {
        id: str_(r.id), invNo: str_(r.invNo), invDate: dateStr_(r.invDate), ref: str_(r.ref),
        issuerType: str_(r.issuerType), issuerName: str_(r.issuerName),
        subtotal: Number(r.subtotal) || 0,
        sstEnabled: r.sstEnabled === true || r.sstEnabled === 'true' || r.sstEnabled === 'TRUE',
        sstAmount: Number(r.sstAmount) || 0,
        total: Number(r.total) || 0,
        pdfUrl: str_(r.pdfUrl), folderUrl: str_(r.folderUrl), createdBy: str_(r.createdBy),
      };
    });
}

function listSubcons_() {
  return readSheet_(SHEETS.SUBCONS).map(function (s) {
    return {
      id: str_(s.id), type: str_(s.type), name: str_(s.name), ic: str_(s.ic), addr: str_(s.addr),
      phone: str_(s.phone), email: str_(s.email), payInfo: str_(s.payInfo),
      logo: s.logoFileId ? logoBase64_(s.logoFileId) : '',
    };
  });
}

function logoBase64_(fileId) {
  try {
    const blob = DriveApp.getFileById(fileId).getBlob();
    return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
  } catch (e) {
    return '';
  }
}

/* ----- full invoice (for the "Open" / edit action) ----- */
function getInvoice(id) {
  requireDomain_();
  const inv = readSheet_(SHEETS.INVOICES).filter(function (r) { return r.id === id; })[0];
  if (!inv) throw new Error('Invoice not found.');
  const lines = readSheet_(SHEETS.LINES)
    .filter(function (l) { return l.invoiceId === id; })
    .map(function (l) {
      return { description: str_(l.description), quantity: Number(l.quantity) || 0, unitPrice: Number(l.unitPrice) || 0 };
    });
  // find logo via matching subcon
  let logo = '';
  const sc = readSheet_(SHEETS.SUBCONS).filter(function (s) {
    return String(s.type) === String(inv.issuerType) &&
           String(s.name).toLowerCase() === String(inv.issuerName).toLowerCase();
  })[0];
  if (sc && sc.logoFileId) logo = logoBase64_(sc.logoFileId);
  return {
    id: str_(inv.id), invNo: str_(inv.invNo), invDate: dateStr_(inv.invDate), ref: str_(inv.ref),
    issuerType: str_(inv.issuerType), issuerName: str_(inv.issuerName), issuerIc: str_(inv.issuerIc),
    issuerAddr: str_(inv.issuerAddr), issuerPhone: str_(inv.issuerPhone), issuerEmail: str_(inv.issuerEmail),
    billToName: str_(inv.billToName), billToAddr: str_(inv.billToAddr),
    sstEnabled: inv.sstEnabled === true || inv.sstEnabled === 'true' || inv.sstEnabled === 'TRUE',
    payInfo: str_(inv.payInfo), notes: str_(inv.notes),
    pdfUrl: str_(inv.pdfUrl), folderUrl: str_(inv.folderUrl),
    lines: lines, logo: str_(logo),
  };
}

/* ===================== SAVE INVOICE ===================== */
function saveInvoice(payload) {
  const email = requireDomain_();
  if (!payload) throw new Error('Empty payload.');
  if (!String(payload.issuerName || '').trim()) throw new Error('Issuer name is required.');
  if (!payload.lines || !payload.lines.length) throw new Error('At least one line item is required.');
  ensureSheets_();

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const now = new Date();
    const invId = uid_();
    const invNo = String(payload.invNo || '').trim() || nextInvNo_(now);

    // Recompute totals server-side (don't trust client)
    let subtotal = 0;
    const lines = payload.lines
      .filter(function (l) { return String(l.description || '').trim() || Number(l.unitPrice) || Number(l.quantity); })
      .map(function (l) {
        const qty = Number(l.quantity) || 0;
        const unit = Number(l.unitPrice) || 0;
        const amt = round2_(qty * unit);
        subtotal += amt;
        return {
          id: uid_(), invoiceId: invId,
          description: String(l.description || '').trim(),
          quantity: qty, unitPrice: unit, lineAmount: amt,
        };
      });
    if (!lines.length) throw new Error('At least one line item with an amount is required.');
    subtotal = round2_(subtotal);
    const sstEnabled = !!payload.sstEnabled;
    const sstAmount = sstEnabled ? round2_(subtotal * SST_RATE) : 0;
    const total = round2_(subtotal + sstAmount);

    const issuerType = (payload.issuerType === 'co') ? 'co' : 'ind';
    const issuerName = String(payload.issuerName || '').trim();

    // Remember / update subcon + logo (returns base64 to embed)
    const logoB64 = upsertSubcon_({
      type: issuerType, name: issuerName,
      ic: String(payload.issuerIc || '').trim(),
      addr: String(payload.issuerAddr || '').trim(),
      phone: String(payload.issuerPhone || '').trim(),
      email: String(payload.issuerEmail || '').trim(),
      payInfo: String(payload.payInfo || ''),
      logoBase64: payload.logoBase64 || '',
      logoMime: payload.logoMime || '',
    });

    const inv = {
      id: invId, invNo: invNo,
      invDate: String(payload.invDate || '').trim() || todayISO_(),
      ref: String(payload.ref || '').trim(),
      issuerType: issuerType, issuerName: issuerName,
      issuerIc: String(payload.issuerIc || '').trim(),
      issuerAddr: String(payload.issuerAddr || '').trim(),
      issuerPhone: String(payload.issuerPhone || '').trim(),
      issuerEmail: String(payload.issuerEmail || '').trim(),
      billToName: String(payload.billToName || '').trim(),
      billToAddr: String(payload.billToAddr || '').trim(),
      subtotal: subtotal, sstEnabled: sstEnabled, sstAmount: sstAmount, total: total,
      payInfo: String(payload.payInfo || ''), notes: String(payload.notes || ''),
      pdfUrl: '', folderUrl: '',
      createdAt: nowIso_(), createdBy: email,
    };

    // Persist company default for next time
    if (inv.billToName || inv.billToAddr) setMyCompany(inv.billToName, inv.billToAddr);

    // Build PDF → Drive subfolder
    const parent = ensureParentFolder_();
    const folder = parent.createFolder(safeFilename_(invNo + ' — ' + issuerName + ' — RM ' + total.toFixed(2)));
    const pdfBlob = buildInvoicePdf_(inv, lines, logoB64);
    const pdfFile = folder.createFile(pdfBlob);
    inv.pdfUrl = pdfFile.getUrl();
    inv.folderUrl = folder.getUrl();

    appendRecord_(SHEETS.INVOICES, inv);
    lines.forEach(function (l) { appendRecord_(SHEETS.LINES, l); });
    logAudit_('invoice.create', 'Invoice', invNo,
      issuerName + ' · RM ' + total.toFixed(2) + ' · ' + lines.length + ' line(s)');

    return {
      ok: true, id: invId, invNo: invNo,
      pdfUrl: inv.pdfUrl, folderUrl: inv.folderUrl,
      subtotal: subtotal, sstAmount: sstAmount, total: total,
      sheetUrl: ss_().getUrl(),
    };
  } finally {
    lock.releaseLock();
  }
}

function nextInvNo_(now) {
  const year = Utilities.formatDate(now, tz_(), 'yyyy');
  const sheet = ss_().getSheetByName(SHEETS.INVOICES);
  const last = sheet.getLastRow();
  let maxN = 0;
  if (last >= 2) {
    const nos = sheet.getRange(2, 2, last - 1, 1).getValues();
    nos.forEach(function (r) {
      const m = String(r[0] || '').match(/^SUB-(\d{4})-(\d+)$/);
      if (m && m[1] === year) maxN = Math.max(maxN, parseInt(m[2], 10));
    });
  }
  return 'SUB-' + year + '-' + String(maxN + 1).padStart(4, '0');
}

/* ----- subcon upsert + logo storage; returns logo base64 (or '') ----- */
function upsertSubcon_(s) {
  const sheet = ss_().getSheetByName(SHEETS.SUBCONS);
  const all = readSheet_(SHEETS.SUBCONS);
  const key = (s.type + '|' + s.name).toLowerCase();
  const existing = all.filter(function (r) { return (r.type + '|' + r.name).toLowerCase() === key; })[0];

  let logoFileId = existing ? existing.logoFileId : '';
  let logoB64 = '';

  if (s.logoBase64) {
    const raw = stripDataUrl_(s.logoBase64);
    const mime = s.logoMime || 'image/png';
    const ext = (mime.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const blob = Utilities.newBlob(Utilities.base64Decode(raw), mime, safeFilename_(s.name) + '.' + ext);
    // remove old logo file if present
    if (logoFileId) { try { DriveApp.getFileById(logoFileId).setTrashed(true); } catch (e) {} }
    const file = ensureLogosFolder_().createFile(blob);
    logoFileId = file.getId();
    logoB64 = 'data:' + mime + ';base64,' + raw;
  } else if (logoFileId) {
    logoB64 = logoBase64_(logoFileId);
  }

  const rec = {
    id: existing ? existing.id : uid_(),
    type: s.type, name: s.name, ic: s.ic, addr: s.addr,
    phone: s.phone, email: s.email, payInfo: s.payInfo,
    logoFileId: logoFileId, updatedAt: nowIso_(),
  };

  if (existing) {
    // find its row and overwrite
    const last = sheet.getLastRow();
    const idCol = sheet.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < idCol.length; i++) {
      if (String(idCol[i][0]) === String(existing.id)) {
        sheet.getRange(i + 2, 1, 1, HEADERS.Subcons.length).setValues([rowFromRecord_('Subcons', rec)]);
        break;
      }
    }
  } else {
    appendRecord_(SHEETS.SUBCONS, rec);
  }
  return logoB64;
}

/* ===================== DELETE INVOICE ===================== */
function deleteInvoice(id) {
  const email = requireDomain_();
  if (!id) throw new Error('No invoice id.');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const inv = readSheet_(SHEETS.INVOICES).filter(function (r) { return r.id === id; })[0];
    if (!inv) throw new Error('Invoice not found.');
    // trash the Drive subfolder (best effort)
    if (inv.folderUrl) {
      const m = String(inv.folderUrl).match(/folders\/([A-Za-z0-9_\-]+)/);
      if (m) { try { DriveApp.getFolderById(m[1]).setTrashed(true); } catch (e) {} }
    }
    deleteRowsWhere_(SHEETS.LINES, 2, [id]);   // InvoiceLines.invoiceId is col 2
    deleteRowsWhere_(SHEETS.INVOICES, 1, [id]); // Invoices.id is col 1
    logAudit_('invoice.delete', 'Invoice', inv.invNo, 'by ' + email);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/* ===================== PDF BUILDER ===================== */
function buildInvoicePdf_(inv, lines, logoB64) {
  const rows = lines.map(function (l) {
    return '<tr>' +
      '<td>' + escapeHtml_(l.description) + '</td>' +
      '<td class="r">' + (Number(l.quantity).toLocaleString('en-MY', { maximumFractionDigits: 3 })) + '</td>' +
      '<td class="r">' + fmtRM_(l.unitPrice) + '</td>' +
      '<td class="r">' + fmtRM_(l.lineAmount) + '</td>' +
    '</tr>';
  }).join('');

  const issuerMeta = [];
  if (inv.issuerType === 'ind' && inv.issuerIc) issuerMeta.push('IC/Passport: ' + inv.issuerIc);
  if (inv.issuerAddr) issuerMeta.push(inv.issuerAddr);
  if (inv.issuerPhone) issuerMeta.push('Tel: ' + inv.issuerPhone);
  if (inv.issuerEmail) issuerMeta.push(inv.issuerEmail);

  const logoTag = logoB64 ? '<img class="logo" src="' + logoB64 + '" />' : '';

  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + escapeHtml_(inv.invNo) + '</title>' +
  '<style>' +
  '@page { size: A4; margin: 16mm; }' +
  'body { font-family: Helvetica, Arial, sans-serif; color:#111; font-size: 11pt; }' +
  '.head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #111; padding-bottom:14px; margin-bottom:16px; }' +
  '.logo { max-height:64px; max-width:180px; margin-bottom:8px; display:block; }' +
  '.iss-name { font-size:15pt; font-weight:800; }' +
  '.iss-meta { font-size:9.5pt; color:#444; white-space:pre-line; margin-top:4px; }' +
  '.title { text-align:right; }' +
  '.title h1 { font-size:26pt; letter-spacing:3px; margin:0; }' +
  '.title .meta { font-size:9.5pt; color:#444; margin-top:8px; line-height:1.7; }' +
  '.title .meta b { color:#111; }' +
  '.billto { margin-bottom:14px; }' +
  '.billto .lbl { font-size:8pt; text-transform:uppercase; letter-spacing:1px; color:#888; font-weight:700; margin-bottom:3px; }' +
  '.billto .who { font-size:11.5pt; font-weight:700; }' +
  '.billto .addr { font-size:9.5pt; color:#444; white-space:pre-line; }' +
  'table.items { width:100%; border-collapse:collapse; margin:8px 0 12px; }' +
  'table.items th { background:#111; color:#fff; font-size:8.5pt; text-transform:uppercase; letter-spacing:.04em; padding:8px 9px; text-align:left; }' +
  'table.items th.r, table.items td.r { text-align:right; }' +
  'table.items td { padding:8px 9px; border-bottom:1px solid #e3e3e3; font-size:10pt; vertical-align:top; }' +
  '.totals { width:46%; margin-left:auto; margin-top:6px; }' +
  '.totals .tr { display:flex; justify-content:space-between; padding:4px 0; font-size:10.5pt; }' +
  '.totals .grand { border-top:2px solid #111; margin-top:6px; padding-top:8px; font-size:13pt; font-weight:800; }' +
  '.pay { margin-top:22px; font-size:9.5pt; color:#333; border-top:1px solid #e3e3e3; padding-top:12px; white-space:pre-line; }' +
  '.pay .lbl { font-size:8pt; text-transform:uppercase; letter-spacing:1px; color:#888; font-weight:700; margin-bottom:4px; }' +
  '.sign { display:flex; justify-content:space-between; gap:40px; margin-top:40px; }' +
  '.sign .box { flex:1; border-top:1px solid #111; padding-top:6px; font-size:8.5pt; color:#666; text-align:center; text-transform:uppercase; letter-spacing:.05em; }' +
  '.foot { text-align:center; font-size:8pt; color:#aaa; margin-top:26px; border-top:1px solid #eee; padding-top:8px; }' +
  '</style></head><body>' +
  '<div class="head">' +
    '<div>' + logoTag +
      '<div class="iss-name">' + escapeHtml_(inv.issuerName) + '</div>' +
      (issuerMeta.length ? '<div class="iss-meta">' + escapeHtml_(issuerMeta.join('\n')) + '</div>' : '') +
    '</div>' +
    '<div class="title"><h1>INVOICE</h1><div class="meta">' +
      '<div><b>No:</b> ' + escapeHtml_(inv.invNo) + '</div>' +
      '<div><b>Date:</b> ' + escapeHtml_(inv.invDate) + '</div>' +
      (inv.ref ? '<div><b>Ref:</b> ' + escapeHtml_(inv.ref) + '</div>' : '') +
    '</div></div>' +
  '</div>' +
  '<div class="billto"><div class="lbl">Bill to</div>' +
    '<div class="who">' + escapeHtml_(inv.billToName || '—') + '</div>' +
    '<div class="addr">' + escapeHtml_(inv.billToAddr || '') + '</div></div>' +
  '<table class="items"><thead><tr>' +
    '<th>Description</th><th class="r">Qty</th><th class="r">Unit Price</th><th class="r">Amount</th>' +
  '</tr></thead><tbody>' + rows + '</tbody></table>' +
  '<div class="totals">' +
    '<div class="tr"><span>Subtotal</span><span>' + fmtRM_(inv.subtotal) + '</span></div>' +
    (inv.sstEnabled ? '<div class="tr"><span>SST 6%</span><span>' + fmtRM_(inv.sstAmount) + '</span></div>' : '') +
    '<div class="tr grand"><span>TOTAL</span><span>' + fmtRM_(inv.total) + '</span></div>' +
  '</div>' +
  (inv.payInfo ? '<div class="pay"><div class="lbl">Payment details</div>' + escapeHtml_(inv.payInfo) + '</div>' : '') +
  (inv.notes ? '<div class="pay"><div class="lbl">Notes</div>' + escapeHtml_(inv.notes) + '</div>' : '') +
  '<div class="sign"><div class="box">Issued by — ' + escapeHtml_(inv.issuerName) + '</div>' +
    '<div class="box">Received / Approved</div></div>' +
  (INVOICE_FOOTER ? '<div class="foot">' + escapeHtml_(INVOICE_FOOTER) + '</div>' : '') +
  '</body></html>';

  return Utilities.newBlob(html, MimeType.HTML, inv.invNo + '.html')
    .getAs(MimeType.PDF)
    .setName(inv.invNo + '.pdf');
}
