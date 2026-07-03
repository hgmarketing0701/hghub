/**
 * Black Lee — Receipt Claim Submission (Cloud v1)
 * Google Apps Script backend, served as a Workspace-restricted web app.
 *
 * Storage: the Google Sheet this script is bound to (Container-bound script).
 * Drive:   parent folder "Black Lee — Claims" created on first run; each
 *          submission gets its own subfolder containing receipt(s) + PDF.
 * OCR:     Gemini Vision API (multi-lingual: en/zh/ms).
 * Auth:    Workspace domain restriction in appsscript.json + per-call guard.
 */

/* ===================== CONFIG ===================== */
const ALLOWED_DOMAIN = 'hggroup.com.my';
const PARENT_FOLDER_NAME = 'Black Lee — Claims';
const GEMINI_MODEL = 'gemini-2.5-flash';
const SST_RATE = 0.06;

const SHEETS = {
  CLAIMS:      'Claims',
  CLAIM_LINES: 'ClaimLines',
  SUMMARIES:   'Summaries',
  AUDIT:       'AuditLog',
};

const HEADERS = {
  Claims: [
    'id','claimNo','submittedAt','submittedBy','receiptDate','vendor',
    'currency','subtotal','serviceCharge','subsidyAmount','sstAmount','roundingAdjustment',
    'total','primaryCategory','status',
    'pdfUrl','folderUrl','receiptUrls','remarks',
  ],
  ClaimLines: [
    'id','claimId','description','quantity','unitPrice','lineAmount',
    'category','remarks',
  ],
  Summaries: [
    'id','summaryNo','generatedAt','generatedBy','claimNos','claimCount',
    'currency','grandTotal','periodFrom','periodTo','pdfUrl','folderUrl','title','remarks',
  ],
  AuditLog: ['timestamp','userEmail','action','recordType','recordId','details'],
};

const SUMMARIES_SUBFOLDER = 'Summaries';

const CATEGORIES = [
  'food','grocery','apparel','fuel','transport','accommodation',
  'materials','tools','office','other',
];

const PROPS = PropertiesService.getScriptProperties();
const PROP_KEYS = {
  GEMINI_KEY:       'GEMINI_API_KEY',
  PARENT_FOLDER_ID: 'PARENT_FOLDER_ID',
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
    .setTitle('Black Lee — Receipt Claims')
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
      const firstRow = sheet.getRange(1, 1, 1, HEADERS[name].length).getValues()[0];
      const empty = firstRow.every(v => v === '' || v === null);
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
    .filter(row => row.some(v => v !== '' && v !== null))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => obj[h] = row[i]);
      return obj;
    });
}

function rowFromRecord_(name, rec) {
  return HEADERS[name].map(h => rec[h] === undefined ? '' : rec[h]);
}

function appendRecord_(name, rec) {
  ss_().getSheetByName(name).appendRow(rowFromRecord_(name, rec));
}

/* ===================== UTILS ===================== */
function uid_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}
function nowIso_() { return new Date().toISOString(); }
function tz_() { return Session.getScriptTimeZone() || 'Asia/Kuala_Lumpur'; }
function todayISO_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }
function fmtRM_(n) {
  const v = Number(n) || 0;
  return 'RM ' + v.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function safeFilename_(s) {
  return String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}
function escapeHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ===================== AUDIT ===================== */
function logAudit_(action, recordType, recordId, details) {
  const email = (Session.getActiveUser().getEmail() || 'unknown').toLowerCase();
  ss_().getSheetByName(SHEETS.AUDIT).appendRow([
    nowIso_(), email, action, recordType, recordId, details || '',
  ]);
}

/* ===================== DRIVE PARENT FOLDER ===================== */
function ensureParentFolder_() {
  const cached = PROPS.getProperty(PROP_KEYS.PARENT_FOLDER_ID);
  if (cached) {
    try {
      const f = DriveApp.getFolderById(cached);
      if (f && !f.isTrashed()) return f;
    } catch (e) { /* fall through to create */ }
  }
  const it = DriveApp.getFoldersByName(PARENT_FOLDER_NAME);
  let folder;
  if (it.hasNext()) {
    folder = it.next();
  } else {
    folder = DriveApp.createFolder(PARENT_FOLDER_NAME);
  }
  PROPS.setProperty(PROP_KEYS.PARENT_FOLDER_ID, folder.getId());
  return folder;
}

/* ===================== SETUP ===================== */
/**
 * Run ONCE from the Apps Script editor before deploying.
 * - Creates the Sheets tabs (Claims, ClaimLines, AuditLog)
 * - Creates the parent Drive folder "Black Lee — Claims"
 * - Reminds you to set GEMINI_API_KEY in Script Properties
 */
function setupConfig() {
  ensureSheets_();
  const folder = ensureParentFolder_();
  const hasKey = !!PROPS.getProperty(PROP_KEYS.GEMINI_KEY);
  const msg = [
    'Sheets initialised: ' + Object.values(SHEETS).join(', '),
    'Drive parent folder: ' + folder.getName() + ' (' + folder.getId() + ')',
    'Gemini API key: ' + (hasKey ? 'SET' : 'NOT SET — add in Project Settings → Script Properties as GEMINI_API_KEY'),
    '',
    'Next: Deploy → New deployment → Web app',
    '  - Execute as: User accessing the web app',
    '  - Access:    Anyone within ' + ALLOWED_DOMAIN,
  ].join('\n');
  Logger.log(msg);
  return msg;
}

/* ===================== PUBLIC API ===================== */
function bootstrap() {
  const email = requireDomain_();
  ensureSheets_();
  return {
    currentUser: email,
    serverTime: nowIso_(),
    domain: ALLOWED_DOMAIN,
    categories: CATEGORIES,
    sstRate: SST_RATE,
    geminiConfigured: !!PROPS.getProperty(PROP_KEYS.GEMINI_KEY),
    myClaims: listMyClaims_(email, 30),
    mySummaries: listMySummaries_(email, 10),
  };
}

function listMyClaims_(email, limit) {
  const all = readSheet_(SHEETS.CLAIMS);
  return all
    .filter(c => String(c.submittedBy || '').toLowerCase() === email)
    .sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)))
    .slice(0, limit || 30);
}

function listMySummaries_(email, limit) {
  const all = readSheet_(SHEETS.SUMMARIES);
  return all
    .filter(s => String(s.generatedBy || '').toLowerCase() === email)
    .sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)))
    .slice(0, limit || 10);
}

/* ===================== OCR via Gemini ===================== */
function extractReceipt(payload) {
  requireDomain_();
  const apiKey = PROPS.getProperty(PROP_KEYS.GEMINI_KEY);
  if (!apiKey) throw new Error('GEMINI_API_KEY not set in Script Properties.');
  if (!payload || !payload.images || !payload.images.length) {
    throw new Error('No receipt image provided.');
  }

  const parts = [];
  parts.push({ text: buildExtractionPrompt_() });
  payload.images.forEach(img => {
    parts.push({
      inline_data: {
        mime_type: img.mimeType || 'image/jpeg',
        data: img.base64,
      },
    });
  });

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/'
    + GEMINI_MODEL + ':generateContent?key=' + encodeURIComponent(apiKey);

  const body = {
    contents: [{ parts: parts }],
    generationConfig: {
      response_mime_type: 'application/json',
      temperature: 0.1,
    },
  };

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });

  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Gemini API error (' + code + '): ' + text.slice(0, 500));
  }

  let parsed;
  try {
    const wrapper = JSON.parse(text);
    const out = wrapper.candidates && wrapper.candidates[0]
      && wrapper.candidates[0].content
      && wrapper.candidates[0].content.parts
      && wrapper.candidates[0].content.parts[0]
      && wrapper.candidates[0].content.parts[0].text;
    if (!out) throw new Error('Empty response');
    parsed = JSON.parse(out);
  } catch (err) {
    throw new Error('Could not parse Gemini response: ' + err.message);
  }

  return normaliseExtraction_(parsed);
}

function buildExtractionPrompt_() {
  return [
    'You are a receipt OCR + data extraction assistant for a Malaysian contractor support company.',
    'Receipts may be in English, Chinese (Simplified or Traditional), or Malay. Extract carefully.',
    '',
    'Return STRICT JSON with this shape:',
    '{',
    '  "vendor": string (merchant name),',
    '  "date": string (ISO yyyy-mm-dd; if only partial, use best guess; if unknown, ""),',
    '  "currency": string (e.g. "RM", "MYR", "USD", "SGD"; default "RM"),',
    '  "items": [',
    '    {',
    '      "description": string,',
    '      "quantity": number,',
    '      "unitPrice": number,',
    '      "lineAmount": number,',
    '      "category": one of ["food","grocery","apparel","fuel","transport","accommodation","materials","tools","office","other"]',
    '    }',
    '  ],',
    '  "subtotal": number (sum of items BEFORE service charge, subsidy, SST or rounding),',
    '  "serviceCharge": number (positive number; restaurant service charge shown on receipt, e.g. "Service Charge 10%" or "SC RM 5.00" or "Servis 10%". If shown as a percentage of subtotal, compute the amount. 0 if none),',
    '  "serviceChargePercent": number (the percentage if explicitly stated as %, e.g. 10 for "Service Charge 10%"; 0 if amount-only or no SC),',
    '  "subsidyAmount": number (positive number; Malaysian government fuel subsidy such as Budi95 / BUDI95 / Subsidi / SubsidiRON95 / Diskaun BSH that is shown deducted from the receipt; 0 if none),',
    '  "sstAmount": number (Malaysian SST/GST/service tax shown on the receipt; 0 if none. NOTE: Malaysian restaurant SST is normally 6% of (subtotal + serviceCharge)),',
    '  "roundingAdjustment": number (signed; Malaysian 5-sen cash rounding shown on receipt as "Rounding", "Round Adj", "Pelarasan", or "Adj" — usually within ±0.05; positive if amount added, negative if deducted; 0 if none),',
    '  "total": number (the NET claimable amount = subtotal + serviceCharge - subsidyAmount + sstAmount + roundingAdjustment; this MUST equal the final printed "Total"/"Bayaran"/"Total Paid"/"Tunai" on the receipt),',
    '  "primaryCategory": one of the category strings above,',
    '  "detectedLanguage": "en" | "zh" | "ms" | "mixed",',
    '  "remarks": string (one-line note if anything is unclear, otherwise "")',
    '}',
    '',
    'Rules:',
    '- All monetary values are NUMBERS, not strings. No currency symbols inside numbers.',
    '- If quantity is not shown, use 1.',
    '- If unitPrice is not shown but lineAmount is, set unitPrice = lineAmount / quantity.',
    '- MALAYSIAN PETROL RECEIPTS (Petronas, Shell, BHP, Petron, Caltex etc.) often show a Budi95 / BUDI95 / BSH / Subsidi fuel subsidy line that is DEDUCTED from the gross fuel amount. The CLAIMABLE amount is the NET (after subsidy), NOT the gross. Set subsidyAmount to the deducted amount as a positive number. The line item description should still describe the fuel (e.g. "RON95 24.5L @ RM 2.05/L"); do NOT add a separate negative line for the subsidy.',
    '- MALAYSIAN RESTAURANT RECEIPTS commonly have BOTH a service charge (usually 10%) AND SST (usually 6%, applied AFTER service charge). Capture serviceCharge as the printed RM amount. If only a percentage is printed, compute the amount: serviceCharge = subtotal * serviceChargePercent / 100. The line items should NOT include the service charge as a separate row.',
    '- MALAYSIAN CASH ROUNDING: receipts paid in cash often show a small "Rounding" / "Round Adj" / "Pelarasan" line rounding the total to the nearest 5 sen. Capture as roundingAdjustment (signed: positive if added, negative if deducted). Usually within ±0.05.',
    '- Final formula: total = subtotal + serviceCharge - subsidyAmount + sstAmount + roundingAdjustment. If this does not equal the printed total within RM 0.05, prefer the printed total and put a note in remarks.',
    '- Category should reflect the ITEM, not the merchant. (e.g. a hardware-store screwdriver = "tools".)',
    '- "primaryCategory" = the category that covers the largest share of the total.',
    '- Output JSON only. No commentary. No markdown fences.',
  ].join('\n');
}

function normaliseExtraction_(p) {
  const num = v => {
    const n = Number(String(v == null ? 0 : v).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : 0;
  };
  const cat = c => CATEGORIES.indexOf(String(c || '').toLowerCase()) >= 0
    ? String(c).toLowerCase() : 'other';
  const items = Array.isArray(p.items) ? p.items.map(it => {
    const qty = num(it.quantity) || 1;
    const line = num(it.lineAmount);
    let unit = num(it.unitPrice);
    if (!unit && line && qty) unit = line / qty;
    const computedLine = line || (unit * qty);
    return {
      description: String(it.description || '').trim(),
      quantity:    qty,
      unitPrice:   Math.round(unit * 100) / 100,
      lineAmount:  Math.round(computedLine * 100) / 100,
      category:    cat(it.category),
      remarks:     '',
    };
  }) : [];
  // Signed number for rounding adjustment (allows negative)
  const numSigned = v => {
    const s = String(v == null ? 0 : v).replace(/[^0-9.\-]/g, '');
    const n = Number(s);
    return isFinite(n) ? n : 0;
  };
  return {
    vendor:             String(p.vendor || '').trim(),
    date:               String(p.date || '').trim() || todayISO_(),
    currency:           String(p.currency || 'RM').trim() || 'RM',
    items:              items,
    subtotal:           Math.round(num(p.subtotal) * 100) / 100,
    serviceCharge:      Math.round(Math.abs(num(p.serviceCharge)) * 100) / 100,
    subsidyAmount:      Math.round(Math.abs(num(p.subsidyAmount)) * 100) / 100,
    sstAmount:          Math.round(num(p.sstAmount) * 100) / 100,
    roundingAdjustment: Math.round(numSigned(p.roundingAdjustment) * 100) / 100,
    total:              Math.round(num(p.total) * 100) / 100,
    primaryCategory:    cat(p.primaryCategory),
    detectedLanguage:   String(p.detectedLanguage || '').toLowerCase(),
    remarks:            String(p.remarks || ''),
  };
}

/* ===================== SUBMIT CLAIM(S) ===================== */
function submitClaim(payload) {
  const email = requireDomain_();
  validateClaimPayload_(payload);
  ensureSheets_();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return Object.assign({ ok: true }, submitClaimCore_(payload, email));
  } finally {
    lock.releaseLock();
  }
}

/**
 * Submit a batch of claims in one call. Each item is processed independently;
 * a failure on one does NOT roll back the others. Returns an array of results
 * in the same order as input, each shaped { ok, claimNo?, pdfUrl?, ...} or { ok:false, error }.
 */
function submitClaims(claims) {
  const email = requireDomain_();
  if (!Array.isArray(claims) || !claims.length) throw new Error('No claims to submit.');
  ensureSheets_();
  const lock = LockService.getScriptLock();
  // Allow more time for batches.
  lock.waitLock(60000);
  try {
    const sheetUrl = ss_().getUrl();
    return claims.map(p => {
      try {
        validateClaimPayload_(p);
        const r = submitClaimCore_(p, email);
        return Object.assign({ ok: true }, r);
      } catch (err) {
        return { ok: false, error: (err && err.message) ? err.message : String(err) };
      }
    }).map(r => Object.assign({ sheetUrl: sheetUrl }, r));
  } finally {
    lock.releaseLock();
  }
}

function validateClaimPayload_(payload) {
  if (!payload) throw new Error('Empty payload.');
  if (!payload.lines || !payload.lines.length) throw new Error('At least one line item required.');
  if (!payload.images || !payload.images.length) throw new Error('At least one receipt image required.');
}

/**
 * Core claim creation. Caller MUST hold the script lock — this function does
 * not acquire it, so it can be looped inside a single lock window for batch ops.
 */
function submitClaimCore_(payload, email) {
  const now = new Date();
  const claimNo = nextClaimNo_(now);
  const claimId = uid_();

  // Recompute totals server-side (don't trust client)
  let subtotal = 0;
  const lines = payload.lines.map(l => {
    const qty = Number(l.quantity) || 0;
    const unit = Number(l.unitPrice) || 0;
    const amt = Math.round(qty * unit * 100) / 100;
    subtotal += amt;
    return {
      id: uid_(),
      claimId: claimId,
      description: String(l.description || '').trim(),
      quantity: qty,
      unitPrice: unit,
      lineAmount: amt,
      category: CATEGORIES.indexOf(String(l.category || '').toLowerCase()) >= 0
        ? String(l.category).toLowerCase() : 'other',
      remarks: String(l.remarks || ''),
    };
  });
  subtotal = Math.round(subtotal * 100) / 100;
  const serviceCharge = Math.max(0, Math.round((Number(payload.serviceCharge) || 0) * 100) / 100);
  const subsidyAmount = Math.max(0, Math.round((Number(payload.subsidyAmount) || 0) * 100) / 100);
  const roundingAdjustment = Math.round((Number(payload.roundingAdjustment) || 0) * 100) / 100;
  const taxableBase = Math.max(0, subtotal + serviceCharge - subsidyAmount);
  const sstAmount = payload.sstEnabled
    ? Math.round(taxableBase * SST_RATE * 100) / 100
    : 0;
  const total = Math.round(
    (subtotal + serviceCharge - subsidyAmount + sstAmount + roundingAdjustment) * 100
  ) / 100;

  const byCat = {};
  lines.forEach(l => { byCat[l.category] = (byCat[l.category] || 0) + l.lineAmount; });
  const primaryCategory = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a])[0] || 'other';

  const vendor = String(payload.vendor || '').trim() || 'Unknown vendor';
  const receiptDate = String(payload.receiptDate || '').trim() || todayISO_();
  const currency = String(payload.currency || 'RM').trim() || 'RM';
  const remarks = String(payload.remarks || '');

  const parent = ensureParentFolder_();
  const folderName = safeFilename_(
    claimNo + ' — ' + vendor + ' — ' + currency + ' ' + total.toFixed(2)
  );
  const sub = parent.createFolder(folderName);

  const receiptUrls = [];
  let firstThumbB64 = '';
  let firstThumbMime = 'image/jpeg';
  payload.images.forEach((img, i) => {
    const mime = img.mimeType || 'image/jpeg';
    const ext = (mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const blob = Utilities.newBlob(
      Utilities.base64Decode(img.base64),
      mime,
      'Receipt-' + (i + 1) + '.' + ext
    );
    const file = sub.createFile(blob);
    receiptUrls.push(file.getUrl());
    if (i === 0) { firstThumbB64 = img.base64; firstThumbMime = mime; }
  });

  const claim = {
    id:                 claimId,
    claimNo:            claimNo,
    submittedAt:        nowIso_(),
    submittedBy:        email,
    receiptDate:        receiptDate,
    vendor:             vendor,
    currency:           currency,
    subtotal:           subtotal,
    serviceCharge:      serviceCharge,
    subsidyAmount:      subsidyAmount,
    sstAmount:          sstAmount,
    roundingAdjustment: roundingAdjustment,
    total:              total,
    primaryCategory:    primaryCategory,
    status:             'submitted',
    pdfUrl:             '',
    folderUrl:          sub.getUrl(),
    receiptUrls:        receiptUrls.join(' | '),
    remarks:            remarks,
  };

  const pdfBlob = buildClaimPdf_(claim, lines, firstThumbB64, firstThumbMime);
  const pdfFile = sub.createFile(pdfBlob);
  claim.pdfUrl = pdfFile.getUrl();

  appendRecord_(SHEETS.CLAIMS, claim);
  lines.forEach(l => appendRecord_(SHEETS.CLAIM_LINES, l));
  logAudit_('claim.create', 'Claim', claimNo,
    vendor + ' · ' + currency + ' ' + total.toFixed(2) + ' · ' + lines.length + ' line(s)');

  return {
    claimNo:            claimNo,
    pdfUrl:             claim.pdfUrl,
    folderUrl:          claim.folderUrl,
    sheetUrl:           ss_().getUrl(),
    total:              total,
    subtotal:           subtotal,
    serviceCharge:      serviceCharge,
    subsidyAmount:      subsidyAmount,
    sstAmount:          sstAmount,
    roundingAdjustment: roundingAdjustment,
    vendor:             vendor,
  };
}

function nextClaimNo_(now) {
  const year = Utilities.formatDate(now, tz_(), 'yyyy');
  const sheet = ss_().getSheetByName(SHEETS.CLAIMS);
  const last = sheet.getLastRow();
  let maxN = 0;
  if (last >= 2) {
    const nos = sheet.getRange(2, 2, last - 1, 1).getValues();
    nos.forEach(r => {
      const m = String(r[0] || '').match(/^CLM-(\d{4})-(\d+)$/);
      if (m && m[1] === year) {
        const n = parseInt(m[2], 10);
        if (n > maxN) maxN = n;
      }
    });
  }
  const seq = String(maxN + 1).padStart(3, '0');
  return 'CLM-' + year + '-' + seq;
}

/* ===================== PDF BUILDER ===================== */
function buildClaimPdf_(claim, lines, thumbB64, thumbMime) {
  const rows = lines.map(l => `
    <tr>
      <td>${escapeHtml_(l.description)}</td>
      <td class="r">${Number(l.quantity).toLocaleString('en-MY', { maximumFractionDigits: 3 })}</td>
      <td class="r">${fmtRM_(l.unitPrice)}</td>
      <td class="r">${fmtRM_(l.lineAmount)}</td>
      <td>${escapeHtml_(l.category)}</td>
      <td>${escapeHtml_(l.remarks || '')}</td>
    </tr>
  `).join('');

  const thumb = thumbB64
    ? `<img class="thumb" src="data:${thumbMime};base64,${thumbB64}" />`
    : '';

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${escapeHtml_(claim.claimNo)}</title>
<style>
  @page { size: A4; margin: 18mm; }
  body { font-family: 'Helvetica', Arial, sans-serif; color:#111; font-size: 11pt; }
  h1 { font-size: 22pt; letter-spacing: 2px; margin: 0 0 4px; }
  .sub { color:#555; font-size: 10pt; margin-bottom: 18px; }
  .meta { width:100%; border-collapse: collapse; margin-bottom: 18px; }
  .meta td { padding: 4px 0; vertical-align: top; font-size: 10pt; }
  .meta td.k { color:#666; width: 28%; text-transform: uppercase; letter-spacing: .04em; font-size: 9pt; }
  table.items { width:100%; border-collapse: collapse; margin: 8px 0 14px; }
  table.items th, table.items td {
    border-bottom: 1px solid #ddd; padding: 7px 6px; font-size: 10pt; text-align: left; vertical-align: top;
  }
  table.items th { background:#f5f5f5; font-weight: 700; text-transform: uppercase; font-size: 8.5pt; letter-spacing: .04em; }
  table.items td.r, table.items th.r { text-align: right; }
  table.totals { width: 50%; margin-left: auto; border-collapse: collapse; margin-top: 6px; }
  table.totals td { padding: 4px 6px; font-size: 10.5pt; }
  table.totals td.k { color:#666; text-align: right; }
  table.totals td.v { text-align: right; font-weight: 700; }
  tr.grand td { border-top: 2px solid #111; font-size: 12pt; padding-top: 8px; }
  .remarks { margin-top: 18px; font-size: 10pt; color:#333; white-space: pre-wrap; }
  .sigwrap { margin-top: 36px; display: flex; gap: 40px; }
  .sig { flex:1; border-top: 1px solid #333; padding-top: 6px; font-size: 9pt; color:#666; text-transform: uppercase; letter-spacing: .05em; }
  .thumb { max-width: 280px; max-height: 380px; margin-top: 22px; border: 1px solid #ccc; }
  .foot { margin-top: 28px; font-size: 8pt; color:#888; border-top: 1px solid #eee; padding-top: 8px; }
</style></head><body>

<h1>CLAIM</h1>
<div class="sub">Black Lee — Contractor Support</div>

<table class="meta">
  <tr><td class="k">Claim No.</td><td><b>${escapeHtml_(claim.claimNo)}</b></td>
      <td class="k">Submitted</td><td>${escapeHtml_(claim.submittedAt.slice(0, 19).replace('T', ' '))}</td></tr>
  <tr><td class="k">Submitted By</td><td>${escapeHtml_(claim.submittedBy)}</td>
      <td class="k">Receipt Date</td><td>${escapeHtml_(claim.receiptDate)}</td></tr>
  <tr><td class="k">Vendor</td><td>${escapeHtml_(claim.vendor)}</td>
      <td class="k">Category</td><td>${escapeHtml_(claim.primaryCategory)}</td></tr>
</table>

<table class="items">
  <thead><tr>
    <th>Description</th><th class="r">Qty</th><th class="r">Unit Price</th>
    <th class="r">Amount</th><th>Category</th><th>Remarks</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>

<table class="totals">
  <tr><td class="k">Subtotal</td><td class="v">${fmtRM_(claim.subtotal)}</td></tr>
  ${Number(claim.serviceCharge) > 0 ? `<tr><td class="k">Service charge</td><td class="v">+ ${fmtRM_(claim.serviceCharge)}</td></tr>` : ''}
  ${Number(claim.subsidyAmount) > 0 ? `<tr><td class="k">Less: Budi95 / subsidy</td><td class="v">- ${fmtRM_(claim.subsidyAmount)}</td></tr>` : ''}
  ${Number(claim.sstAmount) > 0 ? `<tr><td class="k">SST</td><td class="v">+ ${fmtRM_(claim.sstAmount)}</td></tr>` : ''}
  ${Number(claim.roundingAdjustment) !== 0 ? `<tr><td class="k">Rounding adj.</td><td class="v">${Number(claim.roundingAdjustment) >= 0 ? '+ ' : '- '}${fmtRM_(Math.abs(Number(claim.roundingAdjustment)))}</td></tr>` : ''}
  <tr class="grand"><td class="k">NET CLAIMABLE</td><td class="v">${fmtRM_(claim.total)}</td></tr>
</table>

${claim.remarks ? `<div class="remarks"><b>Remarks:</b><br>${escapeHtml_(claim.remarks)}</div>` : ''}

<div class="sigwrap">
  <div class="sig">Submitted by — ${escapeHtml_(claim.submittedBy)}</div>
  <div class="sig">Approved by</div>
</div>

${thumb}

<div class="foot">
  Generated by Black Lee Receipt Claims · ${escapeHtml_(nowIso_().slice(0, 19).replace('T',' '))}
</div>

</body></html>`;

  const blob = Utilities.newBlob(html, MimeType.HTML, claim.claimNo + '.html')
    .getAs(MimeType.PDF)
    .setName(claim.claimNo + '.pdf');
  return blob;
}

/* ===================== SUMMARY (BUNDLE) ===================== */
/**
 * Bundle N already-submitted claims into one summary PDF and Sheet row.
 * Input: { claimNos: ['CLM-2026-001', ...], title?: string, remarks?: string }
 * Returns: { summaryNo, pdfUrl, folderUrl, grandTotal, claimCount }
 */
function generateSummary(payload) {
  const email = requireDomain_();
  if (!payload || !Array.isArray(payload.claimNos) || !payload.claimNos.length) {
    throw new Error('Pick at least one claim to summarise.');
  }
  ensureSheets_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const wantedNos = payload.claimNos.map(String);
    const allClaims = readSheet_(SHEETS.CLAIMS);
    const claims = allClaims
      .filter(c => wantedNos.indexOf(String(c.claimNo)) >= 0)
      .sort((a, b) => String(a.receiptDate).localeCompare(String(b.receiptDate)));

    if (!claims.length) throw new Error('None of the selected claims were found.');

    const missing = wantedNos.filter(no => !claims.some(c => String(c.claimNo) === no));
    if (missing.length) throw new Error('Not found: ' + missing.join(', '));

    const claimIds = claims.map(c => c.id);
    const allLines = readSheet_(SHEETS.CLAIM_LINES);
    const lines = allLines.filter(l => claimIds.indexOf(l.claimId) >= 0);

    // Currency / totals
    const currencies = {};
    let grandTotal = 0;
    const byCat = {};
    let periodFrom = null, periodTo = null;
    claims.forEach(c => {
      const cur = c.currency || 'RM';
      const tot = Number(c.total) || 0;
      currencies[cur] = (currencies[cur] || 0) + tot;
      grandTotal += tot;
      byCat[c.primaryCategory || 'other'] = (byCat[c.primaryCategory || 'other'] || 0) + tot;
      const d = String(c.receiptDate || '');
      if (d) {
        if (!periodFrom || d < periodFrom) periodFrom = d;
        if (!periodTo   || d > periodTo)   periodTo   = d;
      }
    });
    grandTotal = Math.round(grandTotal * 100) / 100;

    const primaryCurrency = Object.keys(currencies)
      .sort((a, b) => currencies[b] - currencies[a])[0] || 'RM';

    const now = new Date();
    const summaryNo = nextSummaryNo_(now);

    const summary = {
      id:          uid_(),
      summaryNo:   summaryNo,
      generatedAt: nowIso_(),
      generatedBy: email,
      claimNos:    wantedNos.join(' | '),
      claimCount:  claims.length,
      currency:    primaryCurrency,
      grandTotal:  grandTotal,
      periodFrom:  periodFrom || '',
      periodTo:    periodTo || '',
      pdfUrl:      '',
      folderUrl:   '',
      title:       String(payload.title || '').trim(),
      remarks:     String(payload.remarks || '').trim(),
    };

    // --- Per-summary subfolder under Summaries/ ---
    const sumRoot = ensureSummariesFolder_();
    const folderName = safeFilename_(
      summaryNo + ' — ' + primaryCurrency + ' ' + grandTotal.toFixed(2)
      + ' — ' + claims.length + ' claim(s)'
    );
    const sumFolder = sumRoot.createFolder(folderName);
    summary.folderUrl = sumFolder.getUrl();

    const pdfBlob = buildSummaryPdf_(summary, claims, lines, byCat, currencies);
    pdfBlob.setName(summaryNo + '.pdf');
    const pdfFile = sumFolder.createFile(pdfBlob);
    summary.pdfUrl = pdfFile.getUrl();

    // Index HTML — clickable list of every claim's PDF + Drive folder, for one-click retrieval
    const indexBlob = buildSummaryIndexHtml_(summary, claims);
    sumFolder.createFile(indexBlob);

    appendRecord_(SHEETS.SUMMARIES, summary);
    logAudit_('summary.create', 'Summary', summaryNo,
      claims.length + ' claim(s) · ' + primaryCurrency + ' ' + grandTotal.toFixed(2));

    return {
      summaryNo:  summaryNo,
      pdfUrl:     summary.pdfUrl,
      folderUrl:  summary.folderUrl,
      grandTotal: grandTotal,
      currency:   primaryCurrency,
      claimCount: claims.length,
      periodFrom: summary.periodFrom,
      periodTo:   summary.periodTo,
    };
  } finally {
    lock.releaseLock();
  }
}

function buildSummaryIndexHtml_(summary, claims) {
  const rows = claims.map((c, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><b>${escapeHtml_(c.claimNo)}</b></td>
      <td>${escapeHtml_(c.receiptDate || '')}</td>
      <td>${escapeHtml_(c.vendor || '')}</td>
      <td style="text-align:right;">${escapeHtml_(c.currency || 'RM')} ${(Number(c.total) || 0).toFixed(2)}</td>
      <td>${c.pdfUrl ? `<a href="${escapeHtml_(c.pdfUrl)}" target="_blank">📄 Claim PDF</a>` : ''}</td>
      <td>${c.folderUrl ? `<a href="${escapeHtml_(c.folderUrl)}" target="_blank">📁 Receipt folder</a>` : ''}</td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${escapeHtml_(summary.summaryNo)} — index</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; max-width: 1000px; margin: 20px auto; padding: 0 20px; color:#222; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  .sub { color:#666; margin-bottom: 24px; font-size: 13px; }
  .meta { background:#f5f5f5; padding: 14px 18px; border-radius: 8px; margin-bottom: 18px; }
  .meta b { color:#333; }
  table { width:100%; border-collapse: collapse; }
  th, td { padding: 9px 8px; border-bottom: 1px solid #ddd; font-size: 13px; text-align: left; vertical-align: top; }
  th { background:#fafafa; font-weight: 700; text-transform: uppercase; font-size: 11px; letter-spacing: .04em; color:#666; }
  a { color: #f59e0b; text-decoration: none; font-weight: 600; }
  a:hover { text-decoration: underline; }
  .pdf-link { display: inline-block; margin: 12px 0; background: #f59e0b; color: #111; padding: 10px 18px; border-radius: 8px; font-weight: 700; }
  .pdf-link:hover { background: #d97706; }
</style></head><body>
<h1>${escapeHtml_(summary.summaryNo)} — Index</h1>
<div class="sub">Click any link below to open that claim's PDF or its Drive folder containing the receipt photo(s).</div>
<div class="meta">
  <div><b>Submitted by:</b> ${escapeHtml_(summary.generatedBy)}</div>
  <div><b>Generated:</b> ${escapeHtml_(summary.generatedAt.slice(0, 19).replace('T', ' '))}</div>
  <div><b>Claims included:</b> ${summary.claimCount} · <b>Grand total:</b> ${escapeHtml_(summary.currency)} ${Number(summary.grandTotal).toFixed(2)}</div>
  ${summary.title ? `<div><b>Title:</b> ${escapeHtml_(summary.title)}</div>` : ''}
</div>
<a class="pdf-link" href="${escapeHtml_(summary.pdfUrl || '#')}" target="_blank">📄 Open the official summary PDF</a>
<table>
  <thead><tr>
    <th>#</th><th>Claim No.</th><th>Date</th><th>Vendor</th><th style="text-align:right;">Total</th>
    <th>Detail PDF</th><th>Receipt folder</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
</body></html>`;

  return Utilities.newBlob(html, 'text/html', 'Receipts-index.html');
}

function nextSummaryNo_(now) {
  const year = Utilities.formatDate(now, tz_(), 'yyyy');
  const sheet = ss_().getSheetByName(SHEETS.SUMMARIES);
  const last = sheet.getLastRow();
  let maxN = 0;
  if (last >= 2) {
    const nos = sheet.getRange(2, 2, last - 1, 1).getValues();
    nos.forEach(r => {
      const m = String(r[0] || '').match(/^SUM-(\d{4})-(\d+)$/);
      if (m && m[1] === year) {
        const n = parseInt(m[2], 10);
        if (n > maxN) maxN = n;
      }
    });
  }
  return 'SUM-' + year + '-' + String(maxN + 1).padStart(3, '0');
}

function ensureSummariesFolder_() {
  const parent = ensureParentFolder_();
  const it = parent.getFoldersByName(SUMMARIES_SUBFOLDER);
  if (it.hasNext()) return it.next();
  return parent.createFolder(SUMMARIES_SUBFOLDER);
}

function buildSummaryPdf_(summary, claims, lines, byCat, currencies) {
  // Group lines by claimId
  const linesByClaim = {};
  lines.forEach(l => {
    if (!linesByClaim[l.claimId]) linesByClaim[l.claimId] = [];
    linesByClaim[l.claimId].push(l);
  });

  const fmt = n => 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const anySubsidy = claims.some(c => Number(c.subsidyAmount) > 0);
  const summaryRows = claims.map((c, idx) => {
    return `
      <tr>
        <td>${idx + 1}</td>
        <td><b>${escapeHtml_(c.claimNo)}</b></td>
        <td>${escapeHtml_(c.receiptDate || '')}</td>
        <td>${escapeHtml_(c.vendor || '')}</td>
        <td>${escapeHtml_(c.primaryCategory || '')}</td>
        <td class="r">${fmt(c.subtotal)}</td>
        ${anySubsidy ? `<td class="r">${Number(c.subsidyAmount) > 0 ? '- ' + fmt(c.subsidyAmount) : '—'}</td>` : ''}
        <td class="r">${fmt(c.sstAmount)}</td>
        <td class="r"><b>${fmt(c.total)}</b></td>
      </tr>
    `;
  }).join('');
  const grandSubsidy = claims.reduce((s, c) => s + (Number(c.subsidyAmount) || 0), 0);

  const detailSections = claims.map((c, idx) => {
    const cLines = linesByClaim[c.id] || [];
    const lineRows = cLines.map(l => `
      <tr>
        <td>${escapeHtml_(l.description)}</td>
        <td class="r">${Number(l.quantity).toLocaleString('en-MY', { maximumFractionDigits: 3 })}</td>
        <td class="r">${fmt(l.unitPrice)}</td>
        <td class="r">${fmt(l.lineAmount)}</td>
        <td>${escapeHtml_(l.category)}</td>
        <td>${escapeHtml_(l.remarks || '')}</td>
      </tr>
    `).join('');

    return `
      <div class="detail">
        <div class="detail-head">
          <b>${idx + 1}. ${escapeHtml_(c.claimNo)}</b> · ${escapeHtml_(c.receiptDate || '')} · ${escapeHtml_(c.vendor || '')}
          <span class="muted"> · ${escapeHtml_(c.primaryCategory || '')}</span>
        </div>
        <table class="lines">
          <thead><tr>
            <th>Description</th><th class="r">Qty</th><th class="r">Unit</th>
            <th class="r">Amount</th><th>Category</th><th>Remarks</th>
          </tr></thead>
          <tbody>${lineRows}</tbody>
        </table>
        <div class="detail-totals">
          Subtotal: <b>${fmt(c.subtotal)}</b> &nbsp;·&nbsp;
          SST: <b>${fmt(c.sstAmount)}</b> &nbsp;·&nbsp;
          Total: <b>${fmt(c.total)}</b>
          ${c.pdfUrl ? `&nbsp;·&nbsp; <a href="${escapeHtml_(c.pdfUrl)}">Detail PDF</a>` : ''}
          ${c.folderUrl ? `&nbsp;·&nbsp; <a href="${escapeHtml_(c.folderUrl)}">Drive folder</a>` : ''}
        </div>
        ${c.remarks ? `<div class="remarks-line"><i>Remarks:</i> ${escapeHtml_(c.remarks)}</div>` : ''}
      </div>
    `;
  }).join('');

  const currencyRows = Object.keys(currencies).map(cur => `
    <tr><td>${escapeHtml_(cur)}</td><td class="r">${currencies[cur].toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>
  `).join('');

  const catRows = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]).map(cat => `
    <tr><td>${escapeHtml_(cat)}</td><td class="r">${fmt(byCat[cat])}</td></tr>
  `).join('');

  const periodLine = summary.periodFrom && summary.periodTo
    ? (summary.periodFrom === summary.periodTo ? summary.periodFrom : (summary.periodFrom + ' → ' + summary.periodTo))
    : '—';

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${escapeHtml_(summary.summaryNo)}</title>
<style>
  @page { size: A4; margin: 16mm; }
  body { font-family: 'Helvetica', Arial, sans-serif; color:#111; font-size: 10.5pt; }
  h1 { font-size: 22pt; letter-spacing: 2px; margin: 0 0 4px; }
  .sub { color:#555; font-size: 10pt; margin-bottom: 14px; }
  .meta { width:100%; border-collapse: collapse; margin-bottom: 14px; }
  .meta td { padding: 3px 0; font-size: 9.5pt; vertical-align: top; }
  .meta td.k { color:#666; width: 22%; text-transform: uppercase; letter-spacing: .04em; font-size: 8.5pt; }
  .section-h { font-size: 9pt; text-transform: uppercase; letter-spacing: .08em; color:#666; margin: 16px 0 6px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  table { width:100%; border-collapse: collapse; }
  table.summary th, table.summary td {
    border-bottom: 1px solid #ddd; padding: 6px 5px; font-size: 9.5pt; text-align: left; vertical-align: top;
  }
  table.summary th { background:#f5f5f5; font-weight:700; text-transform: uppercase; font-size: 8pt; letter-spacing:.04em; }
  table.summary td.r, table.summary th.r { text-align: right; }
  table.totals { width: 50%; }
  table.totals td { padding: 3px 6px; font-size: 10pt; }
  table.totals td.r { text-align: right; font-weight: 700; }
  .totals-row { display:flex; gap: 20px; margin: 10px 0 14px; flex-wrap: wrap; }
  .totals-row .block { flex:1; min-width: 220px; }
  .totals-row h4 { font-size: 8.5pt; text-transform: uppercase; letter-spacing: .05em; color:#666; margin-bottom: 4px; }
  .grand {
    display:flex; justify-content: space-between; align-items: baseline;
    border-top: 3px solid #111; padding: 10px 0 6px; margin-top: 14px;
  }
  .grand .lbl { font-size: 12pt; font-weight: 700; letter-spacing: .04em; }
  .grand .val { font-size: 18pt; font-weight: 800; }
  .detail { margin: 14px 0; page-break-inside: avoid; }
  .detail-head { font-size: 10.5pt; margin-bottom: 5px; padding-bottom: 4px; border-bottom: 1px solid #eee; }
  .muted { color:#888; }
  table.lines th, table.lines td {
    border-bottom: 1px dotted #ddd; padding: 4px 5px; font-size: 9pt; text-align: left;
  }
  table.lines th { background:#fafafa; font-weight:600; text-transform: uppercase; font-size: 7.5pt; color:#666; }
  table.lines td.r, table.lines th.r { text-align: right; }
  .detail-totals { font-size: 9.5pt; margin-top: 4px; color:#333; }
  .detail-totals a { color:#0a5; text-decoration: none; }
  .remarks-line { font-size: 9pt; color:#555; margin-top: 3px; }
  .sigwrap { margin-top: 32px; display: flex; gap: 40px; page-break-inside: avoid; }
  .sig { flex:1; border-top: 1px solid #333; padding-top: 6px; font-size: 9pt; color:#666; text-transform: uppercase; letter-spacing: .05em; }
  .foot { margin-top: 22px; font-size: 8pt; color:#888; border-top: 1px solid #eee; padding-top: 8px; }
  .page-break { page-break-before: always; }
</style></head><body>

<h1>EXPENSE CLAIM SUMMARY</h1>
<div class="sub">Black Lee — Contractor Support</div>

<table class="meta">
  <tr><td class="k">Summary No.</td><td><b>${escapeHtml_(summary.summaryNo)}</b></td>
      <td class="k">Generated</td><td>${escapeHtml_(summary.generatedAt.slice(0, 19).replace('T', ' '))}</td></tr>
  <tr><td class="k">Submitted By</td><td>${escapeHtml_(summary.generatedBy)}</td>
      <td class="k">Period</td><td>${escapeHtml_(periodLine)}</td></tr>
  <tr><td class="k">Claims Included</td><td>${summary.claimCount}</td>
      <td class="k">Currency</td><td>${escapeHtml_(summary.currency)}</td></tr>
  ${summary.title ? `<tr><td class="k">Title</td><td colspan="3">${escapeHtml_(summary.title)}</td></tr>` : ''}
</table>

<div class="section-h">Claims included</div>
<table class="summary">
  <thead><tr>
    <th>#</th><th>Claim No.</th><th>Date</th><th>Vendor</th><th>Category</th>
    <th class="r">Subtotal</th>${anySubsidy ? '<th class="r">Subsidy</th>' : ''}<th class="r">SST</th><th class="r">Total</th>
  </tr></thead>
  <tbody>${summaryRows}</tbody>
</table>
${anySubsidy ? `<div style="font-size:9pt;color:#666;margin-top:4px;">Subsidy column: Malaysian fuel subsidy (Budi95 / BSH) already deducted from totals shown.</div>` : ''}

<div class="totals-row">
  <div class="block">
    <h4>By category</h4>
    <table class="totals"><tbody>${catRows}</tbody></table>
  </div>
  <div class="block">
    <h4>By currency</h4>
    <table class="totals"><tbody>${currencyRows}</tbody></table>
  </div>
</div>

<div class="grand">
  <div class="lbl">GRAND TOTAL</div>
  <div class="val">${escapeHtml_(summary.currency)} ${Number(summary.grandTotal).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
</div>

${summary.remarks ? `<div class="remarks-line" style="margin-top:14px;"><b>Notes:</b> ${escapeHtml_(summary.remarks)}</div>` : ''}

<div class="sigwrap">
  <div class="sig">Submitted by — ${escapeHtml_(summary.generatedBy)}</div>
  <div class="sig">Approved by</div>
</div>

<div class="page-break"></div>
<h1 style="font-size:14pt;letter-spacing:1px;">Receipt Details</h1>
<div class="sub">Per-receipt line items. Click the links to open each claim's full PDF or Drive folder.</div>

${detailSections}

<div class="foot">
  Generated by Black Lee Receipt Claims · ${escapeHtml_(nowIso_().slice(0, 19).replace('T',' '))} · ${escapeHtml_(summary.summaryNo)}
</div>

</body></html>`;

  const blob = Utilities.newBlob(html, MimeType.HTML, summary.summaryNo + '.html')
    .getAs(MimeType.PDF);
  return blob;
}
