/**
 * Black Lee — Expenses Receipt System (Cloud v1)
 * Google Apps Script backend, served as a Workspace-restricted web app.
 *
 * What it does (the 7 asks):
 *   1. Upload multiple receipts AND/OR snap photos.
 *   2. Gemini Vision reads each receipt (vendor / date / amount / description / category).
 *   3. Results land in one organised table.
 *   4. Table filters by month.
 *   5. Table prints to PDF (saved to Drive + browser print).
 *   6. Per-row Personal / Business dropdown; the Business-only PDF is your HR claim.
 *   7. Private access — each staff sees ONLY their own rows; admin (you) sees everyone's.
 *
 * Storage: the Google Sheet this script is bound to (Container-bound script).
 * Drive:   parent folder "Black Lee — Expenses" created on first run.
 * OCR:     Gemini Vision API (multi-lingual: en / zh / ms).
 * Auth:    Workspace domain restriction + per-call guard + per-row ownership.
 */

/* ===================== CONFIG ===================== */
const ALLOWED_DOMAIN = 'hggroup.com.my';
const ADMIN_EMAILS = ['lee@hggroup.com.my'];      // sees everyone's receipts
const PARENT_FOLDER_NAME = 'Black Lee — Expenses';
const GEMINI_MODEL = 'gemini-2.5-flash';

const SHEETS = {
  EXPENSES: 'Expenses',
  AUDIT:    'AuditLog',
};

const HEADERS = {
  Expenses: [
    'id', 'createdAt', 'submittedBy', 'receiptDate', 'monthKey',
    'vendor', 'description', 'category', 'currency', 'amount',
    'type', 'status', 'imageUrl', 'remarks',
  ],
  AuditLog: ['timestamp', 'userEmail', 'action', 'recordId', 'details'],
};

// Default seed list. The live list is admin-editable and stored in Script Properties
// (see getCategories_ / setCategories_). 'other' is always kept as the fallback.
const CATEGORIES = [
  'food', 'grocery', 'fuel', 'transport', 'accommodation', 'parking', 'toll',
  'materials', 'tools', 'office', 'utilities', 'phone', 'other',
];

const TYPES = ['business', 'personal'];

const PROPS = PropertiesService.getScriptProperties();
const PROP_KEYS = {
  GEMINI_KEY:       'GEMINI_API_KEY',
  PARENT_FOLDER_ID: 'PARENT_FOLDER_ID',
  CATEGORIES:       'CATEGORIES_JSON',
};

/* ===================== CATEGORY STORE (admin-editable) ===================== */
function normCat_(s) {
  return String(s == null ? '' : s).toLowerCase().trim().replace(/\s+/g, ' ');
}
/** Live category list — stored list if present, else the seed. Always includes 'other'. */
function getCategories_() {
  let list = null;
  const raw = PROPS.getProperty(PROP_KEYS.CATEGORIES);
  if (raw) { try { const a = JSON.parse(raw); if (Array.isArray(a) && a.length) list = a; } catch (e) {} }
  if (!list) list = CATEGORIES.slice();
  list = list.map(normCat_).filter(Boolean);
  list = list.filter((c, i) => list.indexOf(c) === i);   // dedupe
  if (list.indexOf('other') === -1) list.push('other');   // fallback always present
  return list;
}
function setCategories_(arr) {
  PROPS.setProperty(PROP_KEYS.CATEGORIES, JSON.stringify(arr));
}
function requireAdmin_() {
  const email = requireDomain_();
  if (!isAdmin_(email)) throw new Error('Only the admin can manage categories.');
  return email;
}

/** Read for everyone (to populate dropdowns). */
function listCategories() {
  requireDomain_();
  return getCategories_();
}

function addCategory(payload) {
  requireAdmin_();
  const name = normCat_(payload && payload.name);
  if (!name) throw new Error('Enter a category name.');
  if (!/^[a-z0-9 &/-]+$/.test(name)) throw new Error('Use letters, numbers, spaces, & / - only.');
  if (name.length > 24) throw new Error('Keep it under 24 characters.');
  const cats = getCategories_();
  if (cats.indexOf(name) !== -1) throw new Error('"' + name + '" already exists.');
  cats.push(name);
  setCategories_(cats);
  logAudit_('category-add', '', name);
  return { categories: getCategories_() };
}

function renameCategory(payload) {
  requireAdmin_();
  const oldN = normCat_(payload && payload.oldName);
  const newN = normCat_(payload && payload.newName);
  if (!oldN || !newN) throw new Error('Missing name.');
  if (oldN === 'other') throw new Error('"other" is the fallback category — it cannot be renamed.');
  if (!/^[a-z0-9 &/-]+$/.test(newN)) throw new Error('Use letters, numbers, spaces, & / - only.');
  if (newN.length > 24) throw new Error('Keep it under 24 characters.');
  const cats = getCategories_();
  if (cats.indexOf(oldN) === -1) throw new Error('"' + oldN + '" not found.');
  if (oldN !== newN && cats.indexOf(newN) !== -1) throw new Error('"' + newN + '" already exists.');
  cats[cats.indexOf(oldN)] = newN;
  setCategories_(cats);
  const moved = reassignCategory_(oldN, newN);   // keep existing receipts consistent
  logAudit_('category-rename', '', oldN + ' -> ' + newN + ' (' + moved + ' rows)');
  return { categories: getCategories_(), reassigned: moved };
}

function deleteCategory(payload) {
  requireAdmin_();
  const name = normCat_(payload && payload.name);
  if (name === 'other') throw new Error('"other" cannot be deleted — it is the fallback.');
  const cats = getCategories_();
  const i = cats.indexOf(name);
  if (i === -1) throw new Error('"' + name + '" not found.');
  cats.splice(i, 1);
  setCategories_(cats);
  const moved = reassignCategory_(name, 'other');   // affected receipts -> other
  logAudit_('category-delete', '', name + ' (' + moved + ' rows -> other)');
  return { categories: getCategories_(), reassigned: moved };
}

/** Re-tag every Expenses row using oldN to newN. Returns count changed. */
function reassignCategory_(oldN, newN) {
  const sheet = ss_().getSheetByName(SHEETS.EXPENSES);
  if (!sheet) return 0;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const catCol = HEADERS.Expenses.indexOf('category') + 1;
    const rng = sheet.getRange(2, catCol, lastRow - 1, 1);
    const vals = rng.getValues();
    let n = 0;
    for (let r = 0; r < vals.length; r++) {
      if (normCat_(vals[r][0]) === oldN) { vals[r][0] = newN; n++; }
    }
    if (n) rng.setValues(vals);
    return n;
  } finally {
    lock.releaseLock();
  }
}

/* ===================== ENTRY ===================== */
function doGet(e) {
  const email = currentEmail_();
  if (!email.endsWith('@' + ALLOWED_DOMAIN)) {
    return HtmlService.createHtmlOutput(
      `<div style="font-family:sans-serif;padding:40px;max-width:600px;">
         <h2>Access denied</h2>
         <p>This tool is restricted to <b>@${ALLOWED_DOMAIN}</b> Google Workspace accounts.</p>
         <p>You are signed in as: <code>${escapeHtml_(email || '(unknown)')}</code></p>
         <p>Sign in with your company account and reload.</p>
       </div>`
    );
  }
  ensureSheets_();
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Black Lee — Expenses')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/* ===================== AUTH ===================== */
function currentEmail_() {
  return (Session.getActiveUser().getEmail() || '').toLowerCase();
}

function requireDomain_() {
  const email = currentEmail_();
  if (!email.endsWith('@' + ALLOWED_DOMAIN)) {
    throw new Error('Access denied. Only @' + ALLOWED_DOMAIN + ' accounts allowed.');
  }
  return email;
}

function isAdmin_(email) {
  return ADMIN_EMAILS.map(s => s.toLowerCase()).indexOf(String(email).toLowerCase()) !== -1;
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
      if (firstRow.every(v => v === '' || v === null)) {
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

/** Find the 1-based sheet row for a record id. Returns -1 if not found. */
function findRowById_(name, id) {
  const sheet = ss_().getSheetByName(name);
  if (!sheet) return -1;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

/* ===================== UTILS ===================== */
function uid_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 12); }
function nowIso_() { return new Date().toISOString(); }
function tz_() { return Session.getScriptTimeZone() || 'Asia/Kuala_Lumpur'; }
function todayISO_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }

function monthKeyOf_(dateStr) {
  const s = String(dateStr || '');
  const m = s.match(/^(\d{4})-(\d{2})/);
  if (m) return m[1] + '-' + m[2];
  return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM');
}

function fmtRM_(n) {
  const v = Number(n) || 0;
  return 'RM ' + v.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/** Normalised fingerprint for duplicate detection: date + vendor + amount. */
function dupKey_(date, vendor, amount) {
  const v = String(vendor || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const a = (Number(amount) || 0).toFixed(2);
  return String(date || '') + '|' + v + '|' + a;
}
function safeFilename_(s) {
  return String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}
function escapeHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function logAudit_(action, recordId, details) {
  try {
    appendRecord_(SHEETS.AUDIT, {
      timestamp: nowIso_(), userEmail: currentEmail_(),
      action: action, recordId: recordId || '', details: details || '',
    });
  } catch (err) { /* never block on audit */ }
}

function ensureParentFolder_() {
  const cached = PROPS.getProperty(PROP_KEYS.PARENT_FOLDER_ID);
  if (cached) {
    try { return DriveApp.getFolderById(cached); } catch (e) { /* recreate */ }
  }
  const it = DriveApp.getFoldersByName(PARENT_FOLDER_NAME);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(PARENT_FOLDER_NAME);
  PROPS.setProperty(PROP_KEYS.PARENT_FOLDER_ID, folder.getId());
  return folder;
}

/** One subfolder per person so receipts stay tidy & private in Drive too. */
function userFolder_(email) {
  const parent = ensureParentFolder_();
  const name = safeFilename_(email) || 'unknown';
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/* ===================== SETUP (run once from editor) ===================== */
function setupConfig() {
  ensureSheets_();
  const folder = ensureParentFolder_();
  const hasKey = !!PROPS.getProperty(PROP_KEYS.GEMINI_KEY);
  const msg = [
    'Sheets initialised: ' + Object.values(SHEETS).join(', '),
    'Drive parent folder: ' + folder.getName() + ' (' + folder.getId() + ')',
    'Gemini API key: ' + (hasKey ? 'SET' : 'NOT SET — add in Project Settings → Script Properties as GEMINI_API_KEY'),
    'Admin(s): ' + ADMIN_EMAILS.join(', '),
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
    isAdmin: isAdmin_(email),
    serverTime: nowIso_(),
    domain: ALLOWED_DOMAIN,
    categories: getCategories_(),
    types: TYPES,
    geminiConfigured: !!PROPS.getProperty(PROP_KEYS.GEMINI_KEY),
  };
}

/**
 * Rows the caller is allowed to see.
 *  - normal user: only own rows
 *  - admin: everyone's rows (optionally narrowed to opts.person)
 */
function listExpenses(opts) {
  const email = requireDomain_();
  const admin = isAdmin_(email);
  opts = opts || {};

  const raw = readSheet_(SHEETS.EXPENSES);
  let rows = raw.map(normalizeExpenseRow_);   // Date cells -> clean strings; safe to serialize

  if (!admin) {
    rows = rows.filter(r => r.submittedBy.toLowerCase() === email);
  } else if (opts.person) {
    rows = rows.filter(r => r.submittedBy.toLowerCase() === String(opts.person).toLowerCase());
  }

  rows.sort((a, b) => {
    const d = b.receiptDate.localeCompare(a.receiptDate);
    return d !== 0 ? d : b.createdAt.localeCompare(a.createdAt);
  });

  const months = Array.from(new Set(rows.map(r => r.monthKey).filter(Boolean))).sort().reverse();
  const people = admin
    ? Array.from(new Set(raw.map(r => String(r.submittedBy || '')).filter(Boolean))).sort()
    : [email];

  return { rows: rows, months: months, people: people, isAdmin: admin, currentUser: email };
}

/**
 * Make one Expenses row safe + consistent for the client.
 * Google Sheets often coerces "2026-06-21" into a real Date object; left raw it
 * breaks month filtering and JSON transport. Here we force every field to a clean
 * primitive and recompute monthKey from the (normalized) receipt date.
 */
function normalizeExpenseRow_(r) {
  const dateStr = v => {
    if (v instanceof Date) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
    const s = String(v == null ? '' : v);
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : s.slice(0, 10);
  };
  const stampStr = v => {
    if (v instanceof Date) return Utilities.formatDate(v, tz_(), "yyyy-MM-dd'T'HH:mm:ss");
    return String(v == null ? '' : v);
  };
  const receiptDate = dateStr(r.receiptDate);
  return {
    id: String(r.id || ''),
    createdAt: stampStr(r.createdAt),
    submittedBy: String(r.submittedBy || ''),
    receiptDate: receiptDate,
    monthKey: monthKeyOf_(receiptDate),
    vendor: String(r.vendor || ''),
    description: String(r.description || ''),
    category: String(r.category || ''),
    currency: String(r.currency || 'RM'),
    amount: Number(r.amount) || 0,
    type: String(r.type || 'business').toLowerCase(),
    status: String(r.status || ''),
    imageUrl: String(r.imageUrl || ''),
    remarks: String(r.remarks || ''),
  };
}

/* ===================== ANALYZE (Gemini Vision) ===================== */
/**
 * Analyze a batch of receipt images. Each image = one receipt.
 * payload.images = [{ base64, mimeType, name }]
 * Returns [{ name, ok, vendor, date, amount, currency, description, category, suggestedType, remarks }]
 * Images are NOT echoed back — the client keeps them and re-sends on save.
 */
function analyzeReceipts(payload) {
  requireDomain_();
  const apiKey = PROPS.getProperty(PROP_KEYS.GEMINI_KEY);
  if (!apiKey) throw new Error('GEMINI_API_KEY not set in Script Properties.');
  if (!payload || !payload.images || !payload.images.length) {
    throw new Error('No receipt image provided.');
  }

  return payload.images.map(img => {
    try {
      const parsed = analyzeOne_(img, apiKey);
      return Object.assign({ name: img.name || '', ok: true }, parsed);
    } catch (err) {
      return {
        name: img.name || '', ok: false,
        vendor: '', date: todayISO_(), amount: 0, currency: 'RM',
        description: '', category: 'other', suggestedType: 'business',
        remarks: 'Could not read: ' + err.message,
      };
    }
  });
}

function analyzeOne_(img, apiKey) {
  const parts = [
    { text: buildExtractionPrompt_() },
    { inline_data: { mime_type: img.mimeType || 'image/jpeg', data: img.base64 } },
  ];
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/'
    + GEMINI_MODEL + ':generateContent?key=' + encodeURIComponent(apiKey);
  const body = {
    contents: [{ parts: parts }],
    generationConfig: { response_mime_type: 'application/json', temperature: 0.1 },
  };
  const res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify(body), muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code < 200 || code >= 300) throw new Error('Gemini ' + code + ': ' + text.slice(0, 300));

  const wrapper = JSON.parse(text);
  const out = wrapper.candidates && wrapper.candidates[0] && wrapper.candidates[0].content
    && wrapper.candidates[0].content.parts && wrapper.candidates[0].content.parts[0]
    && wrapper.candidates[0].content.parts[0].text;
  if (!out) throw new Error('Empty response');
  return normaliseExtraction_(JSON.parse(out));
}

function buildExtractionPrompt_() {
  return [
    'You read expense receipts for a Malaysian contractor support company.',
    'Receipts may be in English, Chinese (Simplified/Traditional) or Malay. Read carefully.',
    '',
    'Return STRICT JSON only (no markdown fences, no commentary):',
    '{',
    '  "vendor": string (merchant/shop name),',
    '  "date": string (ISO yyyy-mm-dd; best guess if partial; "" if unknown),',
    '  "currency": string ("RM" default; or "USD","SGD" etc.),',
    '  "amount": number (the NET amount ACTUALLY PAID — after tax, service charge, rounding AND after any fuel subsidy is deducted),',
    '  "description": string (one short line describing what was bought, e.g. "Lunch for 3 site crew" or "RON95 fuel 24.5L"),',
    '  "category": one of [' + getCategories_().map(c => '"' + c + '"').join(',') + '] (pick the closest; use "other" if none fit),',
    '  "suggestedType": "business" or "personal" (guess from the items: site/work supplies, fuel, tools, client meals = business; clearly personal items = personal),',
    '  "remarks": string (one-line note if anything is unclear, else "")',
    '}',
    '',
    'Rules:',
    '- amount is a NUMBER, no currency symbol. Use the printed grand total / "Total" / "Bayaran" / "Tunai".',
    '- FUEL / BUDI95 SUBSIDY (CRITICAL for Malaysian petrol receipts — Petronas, Shell, BHP, Petron, Caltex):',
    '    Petrol receipts show a government fuel subsidy line labelled "Budi95", "BUDI95", "BSH", "Subsidi", "SubsidiRON95",',
    '    "Diskaun" or similar, which is DEDUCTED from the gross fuel amount. The driver only pays the NET (after subsidy).',
    '    * Set "amount" = the NET paid (gross fuel MINUS the Budi95 subsidy) = the final printed amount paid. NOT the gross.',
    '    * In "description", spell out the breakdown so it is auditable, format exactly:',
    '        "RON95 <litres>L — gross RM<gross> less Budi95 RM<subsidy> = RM<net> net"',
    '      (drop the litres part if not printed). Example: "RON95 24.5L — gross RM50.00 less Budi95 RM10.00 = RM40.00 net".',
    '    * category = "fuel". If you cannot find a subsidy line on a petrol receipt, just use the printed total as amount and note it in remarks.',
    '- category reflects WHAT was bought, not the shop name.',
    '- When in doubt on type, choose "business".',
  ].join('\n');
}

function normaliseExtraction_(p) {
  const num = v => {
    const n = Number(String(v == null ? 0 : v).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : 0;
  };
  const date = String(p.date || '').match(/^\d{4}-\d{2}-\d{2}$/) ? p.date : (p.date || todayISO_());
  let cat = normCat_(p.category || 'other');
  if (getCategories_().indexOf(cat) === -1) cat = 'other';
  let type = String(p.suggestedType || 'business').toLowerCase();
  if (TYPES.indexOf(type) === -1) type = 'business';
  return {
    vendor: String(p.vendor || '').trim(),
    date: date,
    currency: String(p.currency || 'RM').trim() || 'RM',
    amount: num(p.amount),
    description: String(p.description || '').trim(),
    category: cat,
    suggestedType: type,
    remarks: String(p.remarks || '').trim(),
  };
}

/* ===================== SAVE ===================== */
/**
 * Save a batch of (analysed + user-edited) rows, storing each receipt image to Drive.
 * payload.rows = [{ receiptDate, vendor, description, category, currency, amount,
 *                   type, remarks, image:{base64,mimeType,name} }]
 * Returns the full refreshed list for the caller.
 */
function saveExpenses(payload) {
  const email = requireDomain_();
  if (!payload || !Array.isArray(payload.rows) || !payload.rows.length) {
    throw new Error('Nothing to save.');
  }
  ensureSheets_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // Duplicate guard — same person + same date + same vendor + same amount.
    // Returns the suspects WITHOUT saving; the client asks you to confirm, then re-calls force:true.
    if (!payload.force) {
      const existing = readSheet_(SHEETS.EXPENSES)
        .map(normalizeExpenseRow_)
        .filter(r => r.submittedBy.toLowerCase() === email)
        .map(r => dupKey_(r.receiptDate, r.vendor, r.amount));
      const seen = {};
      existing.forEach(k => seen[k] = true);
      const dups = [];
      payload.rows.forEach((r, i) => {
        const date = String(r.receiptDate || '').match(/^\d{4}-\d{2}-\d{2}$/) ? r.receiptDate : todayISO_();
        const k = dupKey_(date, r.vendor, r.amount);
        if (seen[k]) {
          dups.push({ index: i, receiptDate: date, vendor: String(r.vendor || ''), amount: Number(r.amount) || 0, reason: 'already in your records' });
        } else {
          seen[k] = true;   // also catches duplicates WITHIN this same batch
        }
      });
      if (dups.length) {
        return { needConfirm: true, duplicates: dups, total: payload.rows.length };
      }
    }

    const folder = userFolder_(email);
    const liveCats = getCategories_();
    payload.rows.forEach(r => {
      const id = uid_();
      let imageUrl = '';
      if (r.image && r.image.base64) {
        const ext = (r.image.mimeType || 'image/jpeg').split('/')[1] || 'jpg';
        const fname = safeFilename_([r.receiptDate, r.vendor].filter(Boolean).join(' ')) || 'receipt';
        const blob = Utilities.newBlob(
          Utilities.base64Decode(r.image.base64),
          r.image.mimeType || 'image/jpeg',
          fname + ' ' + id + '.' + ext
        );
        const file = folder.createFile(blob);
        imageUrl = file.getUrl();
      }
      const date = String(r.receiptDate || '').match(/^\d{4}-\d{2}-\d{2}$/) ? r.receiptDate : todayISO_();
      let type = String(r.type || 'business').toLowerCase();
      if (TYPES.indexOf(type) === -1) type = 'business';
      let cat = normCat_(r.category || 'other');
      if (liveCats.indexOf(cat) === -1) cat = 'other';

      appendRecord_(SHEETS.EXPENSES, {
        id: id,
        createdAt: nowIso_(),
        submittedBy: email,
        receiptDate: date,
        monthKey: monthKeyOf_(date),
        vendor: String(r.vendor || '').trim(),
        description: String(r.description || '').trim(),
        category: cat,
        currency: String(r.currency || 'RM').trim() || 'RM',
        amount: Number(r.amount) || 0,
        type: type,
        status: 'recorded',
        imageUrl: imageUrl,
        remarks: String(r.remarks || '').trim(),
      });
      logAudit_('create', id, type + ' ' + fmtRM_(r.amount));
    });
  } finally {
    lock.releaseLock();
  }
  return listExpenses({});
}

/* ===================== EDIT / DELETE ===================== */
/** Owner (or admin) sets a single row's fields. Used by the Personal/Business dropdown + inline edits. */
function updateExpense(payload) {
  const email = requireDomain_();
  if (!payload || !payload.id) throw new Error('Missing id.');

  // Lock so two quick edits on the same row can't read-then-overwrite each other
  // (that race is what flipped Business/Personal back). Edits are now serialized.
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const rowNum = findRowById_(SHEETS.EXPENSES, payload.id);
    if (rowNum === -1) throw new Error('Record not found.');

    const sheet = ss_().getSheetByName(SHEETS.EXPENSES);
    const headers = HEADERS.Expenses;
    const cur = sheet.getRange(rowNum, 1, 1, headers.length).getValues()[0];
    const rec = {};
    headers.forEach((h, i) => rec[h] = cur[i]);

    if (!isAdmin_(email) && String(rec.submittedBy || '').toLowerCase() !== email) {
      throw new Error('You can only edit your own receipts.');
    }

    // Only fields the client actually sent are touched; everything else is preserved as-is.
    const editable = ['receiptDate', 'vendor', 'description', 'currency', 'amount', 'remarks'];
    editable.forEach(f => {
      if (payload[f] !== undefined && payload[f] !== null) rec[f] = payload[f];
    });
    if (payload.type !== undefined && payload.type !== null) {
      let t = String(payload.type).toLowerCase();
      if (TYPES.indexOf(t) !== -1) rec.type = t;
    }
    if (payload.category !== undefined && payload.category !== null) {
      let c = normCat_(payload.category);
      if (getCategories_().indexOf(c) !== -1) rec.category = c;
    }
    rec.amount = Number(rec.amount) || 0;
    rec.receiptDate = String(rec.receiptDate || '').match(/^\d{4}-\d{2}-\d{2}$/)
      ? rec.receiptDate
      : (rec.receiptDate instanceof Date ? Utilities.formatDate(rec.receiptDate, tz_(), 'yyyy-MM-dd') : todayISO_());
    rec.monthKey = monthKeyOf_(rec.receiptDate);

    sheet.getRange(rowNum, 1, 1, headers.length).setValues([rowFromRecord_(SHEETS.EXPENSES, rec)]);
    logAudit_('update', payload.id, JSON.stringify(payload).slice(0, 120));
    return { ok: true, type: rec.type, category: rec.category };
  } finally {
    lock.releaseLock();
  }
}

function deleteExpense(payload) {
  const email = requireDomain_();
  const id = payload && payload.id;
  if (!id) throw new Error('Missing id.');
  const rowNum = findRowById_(SHEETS.EXPENSES, id);
  if (rowNum === -1) throw new Error('Record not found.');
  const sheet = ss_().getSheetByName(SHEETS.EXPENSES);
  const owner = String(sheet.getRange(rowNum, 3, 1, 1).getValue() || '').toLowerCase(); // submittedBy
  if (!isAdmin_(email) && owner !== email) {
    throw new Error('You can only delete your own receipts.');
  }
  sheet.deleteRow(rowNum);
  logAudit_('delete', id, '');
  return { ok: true };
}

/* ===================== PDF REPORT ===================== */
/**
 * Build a PDF expense report from the caller's visible rows, filtered.
 * payload = { month?: 'yyyy-MM' | 'all', type?: 'business'|'personal'|'all', category?: 'fuel'|'all', person?: email(admin) }
 * Returns { fileUrl, fileName, count, total, currency }
 */
function generatePdf(payload) {
  const email = requireDomain_();
  payload = payload || {};
  const data = listExpenses({ person: payload.person });
  let rows = data.rows;

  if (payload.month && payload.month !== 'all') {
    rows = rows.filter(r => r.monthKey === payload.month);
  }
  if (payload.type && payload.type !== 'all') {
    rows = rows.filter(r => String(r.type).toLowerCase() === String(payload.type).toLowerCase());
  }
  if (payload.category && payload.category !== 'all') {
    rows = rows.filter(r => String(r.category).toLowerCase() === String(payload.category).toLowerCase());
  }
  if (!rows.length) throw new Error('No receipts match this filter — nothing to print.');

  rows.sort((a, b) => String(a.receiptDate).localeCompare(String(b.receiptDate)));

  const who = payload.person ? payload.person : email;
  const meta = {
    who: who,
    generatedBy: email,
    month: payload.month && payload.month !== 'all' ? payload.month : 'All months',
    type: payload.type && payload.type !== 'all' ? payload.type : 'All',
    category: payload.category && payload.category !== 'all' ? payload.category : 'All',
  };
  const blob = buildReportPdf_(rows, meta);

  const folder = ensureReportsFolder_();
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.VIEW);

  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  logAudit_('pdf', '', meta.type + ' / ' + meta.month + ' / ' + rows.length + ' rows');
  return {
    fileUrl: file.getUrl(),
    fileName: file.getName(),
    count: rows.length,
    total: total,
    currency: rows[0] ? rows[0].currency : 'RM',
  };
}

function ensureReportsFolder_() {
  const parent = ensureParentFolder_();
  const it = parent.getFoldersByName('_Reports');
  return it.hasNext() ? it.next() : parent.createFolder('_Reports');
}

function buildReportPdf_(rows, meta) {
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  // group totals by category for the summary block
  const byCat = {};
  rows.forEach(r => {
    const c = r.category || 'other';
    byCat[c] = (byCat[c] || 0) + (Number(r.amount) || 0);
  });
  const catRows = Object.keys(byCat).sort().map(c =>
    `<tr><td>${escapeHtml_(c)}</td><td class="r">${fmtRM_(byCat[c])}</td></tr>`
  ).join('');

  const itemRows = rows.map((r, i) => `
    <tr>
      <td class="r">${i + 1}</td>
      <td>${escapeHtml_(r.receiptDate)}</td>
      <td>${escapeHtml_(r.vendor)}</td>
      <td>${escapeHtml_(r.description)}</td>
      <td>${escapeHtml_(r.category)}</td>
      <td>${escapeHtml_(r.type)}</td>
      <td class="r">${fmtRM_(r.amount)}</td>
    </tr>`).join('');

  const title = meta.type && meta.type.toLowerCase() === 'business'
    ? 'EXPENSE CLAIM' : 'EXPENSE REPORT';

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${title}</title>
<style>
  @page { size: A4; margin: 16mm; }
  body { font-family: 'Helvetica', Arial, sans-serif; color:#111; font-size: 10.5pt; }
  h1 { font-size: 22pt; letter-spacing: 2px; margin: 0 0 2px; }
  .sub { color:#555; font-size: 10pt; margin-bottom: 16px; }
  table.meta { width:100%; border-collapse:collapse; margin-bottom:14px; }
  table.meta td { padding: 3px 0; font-size: 9.5pt; vertical-align: top; }
  table.meta td.k { color:#666; width: 22%; text-transform: uppercase; letter-spacing:.04em; font-size: 8.5pt; }
  table.items { width:100%; border-collapse: collapse; margin: 6px 0 12px; }
  table.items th, table.items td { border-bottom: 1px solid #ddd; padding: 6px 5px; font-size: 9.5pt; text-align:left; vertical-align: top; }
  table.items th { background:#f3f3f3; font-weight:700; text-transform:uppercase; font-size: 8pt; letter-spacing:.04em; }
  table.items td.r, table.items th.r { text-align:right; }
  tr.grand td { border-top: 2px solid #111; font-size: 12pt; font-weight:700; padding-top: 8px; }
  table.cat { width: 45%; border-collapse: collapse; margin-top: 4px; }
  table.cat td { padding: 4px 5px; font-size: 9.5pt; border-bottom: 1px solid #eee; }
  table.cat td.r { text-align:right; }
  .sigwrap { margin-top: 40px; display:flex; gap:40px; }
  .sig { flex:1; border-top:1px solid #333; padding-top:6px; font-size: 9pt; color:#666; text-transform:uppercase; letter-spacing:.05em; }
  .foot { margin-top: 24px; font-size: 8pt; color:#888; border-top:1px solid #eee; padding-top:8px; }
  h3 { font-size: 10pt; text-transform: uppercase; letter-spacing:.05em; color:#444; margin: 18px 0 4px; }
</style></head><body>

<h1>${title}</h1>
<div class="sub">Black Lee — Contractor Support</div>

<table class="meta">
  <tr><td class="k">Staff</td><td><b>${escapeHtml_(meta.who)}</b></td>
      <td class="k">Period</td><td>${escapeHtml_(meta.month)}</td></tr>
  <tr><td class="k">Type</td><td>${escapeHtml_(meta.type)}</td>
      <td class="k">Category</td><td>${escapeHtml_(meta.category || 'All')}</td></tr>
  <tr><td class="k">Receipts</td><td>${rows.length}</td>
      <td class="k">Generated</td><td>${escapeHtml_(nowIso_().slice(0,19).replace('T',' '))}</td></tr>
  <tr><td class="k">By</td><td>${escapeHtml_(meta.generatedBy)}</td>
      <td class="k"></td><td></td></tr>
</table>

<table class="items">
  <thead><tr>
    <th class="r">#</th><th>Date</th><th>Vendor</th><th>Description</th>
    <th>Category</th><th>Type</th><th class="r">Amount</th>
  </tr></thead>
  <tbody>
    ${itemRows}
    <tr class="grand"><td colspan="6">TOTAL — ${rows.length} receipt(s)</td><td class="r">${fmtRM_(total)}</td></tr>
  </tbody>
</table>

<h3>Breakdown by category</h3>
<table class="cat"><tbody>${catRows}</tbody></table>

<div class="sigwrap">
  <div class="sig">Submitted by — ${escapeHtml_(meta.who)}</div>
  <div class="sig">Approved by</div>
</div>

<div class="foot">
  Generated by Black Lee Expenses · ${escapeHtml_(nowIso_().slice(0,19).replace('T',' '))} ·
  ${title === 'EXPENSE CLAIM' ? 'Attach original receipts for HR claim.' : 'Internal record.'}
</div>

</body></html>`;

  const name = safeFilename_([title, meta.who.split('@')[0], meta.month].join(' ')) + '.pdf';
  return Utilities.newBlob(html, MimeType.HTML, name.replace(/\.pdf$/, '.html'))
    .getAs(MimeType.PDF)
    .setName(name);
}
