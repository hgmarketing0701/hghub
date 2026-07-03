/**
 * HG SMART QUOTATION — server (Google Apps Script)
 * One master PriceBook drives every dropdown and every quote line.
 *
 * Flow:  Mall → Service → Sub-Scope → compulsory items auto-load →
 *        enter L×H (auto sqft) → pick client type (Mall/Contractor/Tenant) →
 *        quotation built, remove what client doesn't need → save / print / WhatsApp.
 *
 * Setup: run setup() ONCE from the editor, approve permissions, then deploy as Web App.
 *        Re-running setup() is safe — it never wipes existing data.
 */

const PROP = PropertiesService.getScriptProperties();
const TZ = 'Asia/Kuala_Lumpur';

// "(All Malls)" rows apply to every mall; a mall-specific row overrides them.
const ALL_MALLS = '(All Malls)';

// Tables the web UI is allowed to read/write through the generic CRUD.
const TABLES = ['Malls', 'Services', 'PriceBook', 'Settings'];

// ============================================================================
// ONE-TIME BOOTSTRAP — run once (safe to re-run; never wipes your data)
// ============================================================================
function setup() {
  let ss;
  const ssId = PROP.getProperty('DB_SHEET_ID');
  if (ssId) { ss = SpreadsheetApp.openById(ssId); }
  else {
    ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.create('HG Smart Quotation — Database');
    PROP.setProperty('DB_SHEET_ID', ss.getId());
  }

  ensureSheet(ss, 'Malls',     ['ID', 'Name', 'Code', 'Location', 'Notes']);
  ensureSheet(ss, 'Services',  ['ID', 'Name', 'IsExtra', 'Sort']);
  ensureSheet(ss, 'PriceBook', ['ID', 'Mall', 'Service', 'SubScope', 'Item', 'Unit', 'Compulsory',
                                'MinQty', 'MinCharge', 'PriceMall', 'PriceContractor', 'PriceTenant',
                                'Sort', 'Notes', 'Updated By', 'Updated On']);
  ensureSheet(ss, 'Settings',  ['Key', 'Value']);
  ensureSheet(ss, 'Quotes',    ['ID', 'QuoteNo', 'Date', 'Mall', 'Client', 'ClientType', 'Attention',
                                'Project', 'Subtotal', 'SST %', 'SST', 'Total', 'Status', 'Notes',
                                'Created By', 'Created On']);
  ensureSheet(ss, 'QuoteLines', ['ID', 'QuoteID', 'Service', 'SubScope', 'Item', 'Unit', 'Qty',
                                 'Rate', 'Amount', 'Note', 'Sort']);
  ensureSheet(ss, 'AuditLog',  ['Timestamp', 'User', 'Action', 'Details']);

  const blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1) ss.deleteSheet(blank);

  seedSettings(ss);
  seedServices(ss);
  seedMalls(ss);
  seedPriceBook(ss);   // realistic SAMPLE rates — replace with your real numbers

  Logger.log('DATABASE: ' + ss.getUrl());
  return { database: ss.getUrl() };
}

// ============================================================================
// WEB APP ENTRY
// ============================================================================
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('HG Smart Quotation')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getCurrentUser() { return getUserEmail(); }

function getConfigLinks() {
  const ssId = PROP.getProperty('DB_SHEET_ID');
  return { sheetUrl: ssId ? 'https://docs.google.com/spreadsheets/d/' + ssId + '/edit' : '' };
}

// ============================================================================
// BOOTSTRAP DATA FOR THE UI (one round-trip)
// ============================================================================
function getBootstrap() {
  // services from the Services tab, plus any service that only exists in the price book
  const services = listTable('Services').sort(bySort)
    .map(s => ({ id: s.ID, name: s.Name, isExtra: yes(s.IsExtra) }));
  const have = {};
  services.forEach(s => { have[String(s.name).trim().toLowerCase()] = 1; });
  listTable('PriceBook').forEach(function (r) {
    const n = String(r.Service || '').trim();
    if (n && !have[n.toLowerCase()]) { have[n.toLowerCase()] = 1; services.push({ id: '', name: n, isExtra: false }); }
  });
  return {
    user: getUserEmail(),
    malls: listTable('Malls').map(m => ({ id: m.ID, name: m.Name, code: m.Code || '' }))
             .sort((a, b) => String(a.name).localeCompare(String(b.name))),
    services: services,
    settings: settingsObj(),
    clientTypes: ['Mall', 'Contractor', 'Tenant']
  };
}

/** Add a mall from the web app. Returns a fresh bootstrap. */
function addMall(name, code, location) {
  name = String(name || '').trim();
  if (!name) throw new Error('Mall name is required.');
  if (listTable('Malls').some(m => String(m.Name).trim().toLowerCase() === name.toLowerCase()))
    throw new Error('Mall "' + name + '" already exists.');
  insertRow('Malls', { Name: name, Code: String(code || '').trim(), Location: String(location || '').trim(), Notes: '' });
  logAudit(getUserEmail(), 'ADD Malls', name);
  return getBootstrap();
}

/** Add a service from the web app. Returns a fresh bootstrap. */
function addService(name, isExtra) {
  name = String(name || '').trim();
  if (!name) throw new Error('Service name is required.');
  if (listTable('Services').some(s => String(s.Name).trim().toLowerCase() === name.toLowerCase()))
    throw new Error('Service "' + name + '" already exists.');
  const sorts = listTable('Services').map(s => Number(s.Sort) || 0);
  const sort = (sorts.length ? Math.max.apply(null, sorts) : 0) + 1;
  insertRow('Services', { Name: name, IsExtra: (isExtra ? 'Y' : 'N'), Sort: sort });
  logAudit(getUserEmail(), 'ADD Services', name);
  return getBootstrap();
}

function settingsObj() {
  const o = {};
  listTable('Settings').forEach(r => { if (r.Key) o[r.Key] = r.Value; });
  return o;
}

// ============================================================================
// THE ENGINE — resolve PriceBook for a mall (mall-specific overrides (All Malls))
// ============================================================================
/**
 * All price rows that apply to a mall, with mall-specific rows overriding
 * the shared "(All Malls)" defaults on matching Service|SubScope|Item.
 */
function resolvedPrices(mall) {
  const rows = listTable('PriceBook');
  const map = {};                                   // key -> row, mall-specific wins
  rows.forEach(function (r) {
    const m = String(r.Mall || '').trim();
    if (m !== ALL_MALLS && m !== String(mall)) return;
    const key = keyOf(r.Service, r.SubScope, r.Item);
    const existing = map[key];
    // mall-specific (m === mall) always beats the (All Malls) default
    if (!existing || (m === String(mall) && existing._mall !== String(mall))) {
      r._mall = m;
      map[key] = r;
    }
  });
  return Object.keys(map).map(k => map[k]);
}

function keyOf(service, subScope, item) {
  return [service, subScope, item].map(x => String(x || '').trim().toLowerCase()).join('|');
}

/** Sub-scopes available for a mall + service (in price-book order). */
function getSubScopes(mall, service) {
  const seen = {};
  const out = [];
  resolvedPrices(mall)
    .filter(r => String(r.Service) === String(service))
    .sort(bySort)
    .forEach(function (r) {
      const s = String(r.SubScope || '').trim();
      if (s && !seen[s.toLowerCase()]) { seen[s.toLowerCase()] = 1; out.push(s); }
    });
  return out;
}

/**
 * Items for a mall + service + sub-scope, ready to drop into a quote.
 * Returns rate for the chosen client type, plus compulsory flag and min rules.
 */
function getItems(mall, service, subScope, clientType) {
  const priceCol = clientPriceCol(clientType);
  return resolvedPrices(mall)
    .filter(r => String(r.Service) === String(service) &&
                 String(r.SubScope) === String(subScope))
    .sort(bySort)
    .map(function (r) {
      return {
        item: r.Item,
        unit: String(r.Unit || 'nos'),
        compulsory: yes(r.Compulsory),
        minQty: num(r.MinQty),
        minCharge: num(r.MinCharge),
        rate: num(r[priceCol]),
        rates: { Mall: num(r.PriceMall), Contractor: num(r.PriceContractor), Tenant: num(r.PriceTenant) },
        notes: r.Notes || ''
      };
    });
}

function clientPriceCol(clientType) {
  if (clientType === 'Contractor') return 'PriceContractor';
  if (clientType === 'Tenant') return 'PriceTenant';
  return 'PriceMall';
}

/**
 * Apply minimum rules to a single line.
 *  - MinQty:   if qty < MinQty, bill at MinQty (e.g. min 100 sqft)
 *  - MinCharge: if amount < MinCharge, bill MinCharge (e.g. min RM 800)
 */
function computeLine(qty, rate, minQty, minCharge, unit) {
  qty = num(qty); rate = num(rate); minQty = num(minQty); minCharge = num(minCharge);
  let effQty = qty, notes = [];
  if (minQty > 0 && qty > 0 && qty < minQty) { effQty = minQty; notes.push('min ' + minQty + ' ' + (unit || '')); }
  let amount = round2(effQty * rate);
  if (minCharge > 0 && amount < minCharge) { amount = round2(minCharge); notes.push('min charge RM' + minCharge); }
  return { qty: effQty, amount: amount, note: notes.join('; ') };
}

// ============================================================================
// SAVE / LIST / GET / DELETE QUOTES
// ============================================================================
/**
 * payload = { mall, client, clientType, attention, project, notes, applySST(bool),
 *             lines:[{service,subScope,item,unit,qty,rate,minQty,minCharge,note}] }
 * Server recomputes every amount + total (never trusts client maths).
 */
function saveQuote(payload) {
  if (!payload) throw new Error('Nothing to save.');
  if (!payload.mall) throw new Error('Select a mall.');
  if (!payload.client) throw new Error('Enter the client name.');
  const lines = (payload.lines || []).filter(l => l && l.item);
  if (!lines.length) throw new Error('Add at least one line item.');

  const user = getUserEmail();
  const now = new Date();
  const sst = settingsObj();
  const sstPct = payload.applySST ? num(sst.SST_PERCENT || 6) : 0;

  let subtotal = 0;
  const computed = lines.map(function (l, i) {
    const c = computeLine(l.qty, l.rate, l.minQty, l.minCharge, l.unit);
    subtotal += c.amount;
    return {
      Service: l.service || '', SubScope: l.subScope || '', Item: l.item,
      Unit: l.unit || '', Qty: c.qty, Rate: num(l.rate), Amount: c.amount,
      Note: [l.note, c.note].filter(Boolean).join('; '), Sort: i + 1
    };
  });
  subtotal = round2(subtotal);
  const sstAmt = round2(subtotal * sstPct / 100);
  const total = round2(subtotal + sstAmt);

  const quoteId = Utilities.getUuid();
  const quoteNo = (payload.quoteNo && String(payload.quoteNo).trim()) || nextQuoteNo();

  insertRow('Quotes', {
    ID: quoteId, QuoteNo: quoteNo, Date: Utilities.formatDate(now, TZ, 'dd MMM yyyy'),
    Mall: payload.mall, Client: payload.client, ClientType: payload.clientType || 'Mall',
    Attention: payload.attention || '', Project: payload.project || '',
    Subtotal: subtotal, 'SST %': sstPct, SST: sstAmt, Total: total,
    Status: 'Draft', Notes: payload.notes || '', 'Created By': user, 'Created On': now
  });
  computed.forEach(function (c) {
    insertRow('QuoteLines', Object.assign({ ID: Utilities.getUuid(), QuoteID: quoteId }, c));
  });

  logAudit(user, 'SAVE QUOTE', quoteNo + ' · ' + payload.mall + ' · ' + payload.client + ' · RM' + total);
  return getQuote(quoteId);
}

function nextQuoteNo() {
  const yr = Utilities.formatDate(new Date(), TZ, 'yyyy');
  const prefix = (settingsObj().QUOTE_PREFIX || 'HG-Q') + '-' + yr + '-';
  const nums = listTable('Quotes')
    .map(q => String(q.QuoteNo || ''))
    .filter(n => n.indexOf(prefix) === 0)
    .map(n => parseInt(n.slice(prefix.length), 10) || 0);
  const next = (nums.length ? Math.max.apply(null, nums) : 0) + 1;
  return prefix + ('000' + next).slice(-3);
}

function listQuotes() {
  return listTable('Quotes')
    .map(q => ({
      id: q.ID, quoteNo: q.QuoteNo, date: q.Date, mall: q.Mall, client: q.Client,
      clientType: q.ClientType, project: q.Project, total: num(q.Total),
      status: q.Status, createdBy: q['Created By'], createdOn: q['Created On']
    }))
    .sort((a, b) => String(b.quoteNo).localeCompare(String(a.quoteNo)));
}

function getQuote(id) {
  const q = listTable('Quotes').find(r => String(r.ID) === String(id));
  if (!q) throw new Error('Quote not found.');
  const lines = listTable('QuoteLines')
    .filter(r => String(r.QuoteID) === String(id))
    .sort(bySort)
    .map(r => ({
      service: r.Service, subScope: r.SubScope, item: r.Item, unit: r.Unit,
      qty: num(r.Qty), rate: num(r.Rate), amount: num(r.Amount), note: r.Note
    }));
  return {
    id: q.ID, quoteNo: q.QuoteNo, date: q.Date, mall: q.Mall, client: q.Client,
    clientType: q.ClientType, attention: q.Attention, project: q.Project,
    subtotal: num(q.Subtotal), sstPct: num(q['SST %']), sst: num(q.SST), total: num(q.Total),
    status: q.Status, notes: q.Notes, createdBy: q['Created By'], lines: lines,
    company: settingsObj()
  };
}

function setQuoteStatus(id, status) {
  updateRow('Quotes', id, { ID: id, Status: status });
  logAudit(getUserEmail(), 'STATUS', String(id).slice(0, 8) + ' → ' + status);
  return true;
}

function deleteQuote(id) {
  // delete lines first
  const sh = tbl('QuoteLines');
  const data = sh.getDataRange().getValues();
  const qidCol = data[0].indexOf('QuoteID');
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][qidCol]) === String(id)) sh.deleteRow(i + 1);
  }
  deleteRow('Quotes', id);
  logAudit(getUserEmail(), 'DELETE QUOTE', String(id).slice(0, 8));
  return true;
}

// ============================================================================
// GENERIC CRUD (Price Book / Malls / Services / Settings management)
// ============================================================================
function crudList(table) { guardTable(table); return listTable(table); }

function crudSave(table, obj) {
  guardTable(table);
  const user = getUserEmail();
  const headers = headerRow(table);
  if (headers.indexOf('Updated By') >= 0) obj['Updated By'] = user;
  if (headers.indexOf('Updated On') >= 0) obj['Updated On'] = new Date();

  let id;
  if (obj.ID) { updateRow(table, obj.ID, obj); id = obj.ID; logAudit(user, 'EDIT ' + table, summarize(obj)); }
  else        { id = insertRow(table, obj);                 logAudit(user, 'ADD ' + table, summarize(obj)); }
  return id;
}

function crudDelete(table, id) {
  guardTable(table);
  deleteRow(table, id);
  logAudit(getUserEmail(), 'DELETE ' + table, String(id));
  return true;
}

/** Settings save by key (Settings has no ID column). */
function saveSetting(key, value) {
  const sh = tbl('Settings');
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(key)) { sh.getRange(i + 1, 2).setValue(value); return true; }
  }
  sh.appendRow([key, value]);
  return true;
}

/** Copy every (All Malls) default into a specific mall as editable overrides. */
function cloneDefaultsToMall(mall) {
  if (!mall) throw new Error('Pick a mall.');
  const existing = {};
  resolvedPrices(mall).forEach(r => { if (r._mall === String(mall)) existing[keyOf(r.Service, r.SubScope, r.Item)] = 1; });
  let n = 0;
  listTable('PriceBook').filter(r => String(r.Mall).trim() === ALL_MALLS).forEach(function (r) {
    if (existing[keyOf(r.Service, r.SubScope, r.Item)]) return;  // don't duplicate
    insertRow('PriceBook', {
      Mall: mall, Service: r.Service, SubScope: r.SubScope, Item: r.Item, Unit: r.Unit,
      Compulsory: r.Compulsory, MinQty: r.MinQty, MinCharge: r.MinCharge,
      PriceMall: r.PriceMall, PriceContractor: r.PriceContractor, PriceTenant: r.PriceTenant,
      Sort: r.Sort, Notes: r.Notes, 'Updated By': getUserEmail(), 'Updated On': new Date()
    });
    n++;
  });
  logAudit(getUserEmail(), 'CLONE DEFAULTS', mall + ' (' + n + ' rows)');
  return n;
}

// ============================================================================
// GENERIC DATA LAYER
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
    o._id = o.ID;
    out.push(o);
  }
  return out;
}

/** Write a row as PLAIN TEXT so Sheets never auto-converts (e.g. lot "3-15" → a date). */
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

// ============================================================================
// SMALL HELPERS
// ============================================================================
function bySort(a, b) { return (Number(a.Sort) || 0) - (Number(b.Sort) || 0); }
function num(v) { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }
function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
function yes(v) { return String(v).trim().toUpperCase() === 'Y' || v === true; }
function summarize(obj) {
  return ['Name', 'Mall', 'Service', 'SubScope', 'Item', 'Key']
    .filter(k => obj[k]).map(k => obj[k]).join(' · ').slice(0, 120);
}
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
function getUserEmail() {
  const e = Session.getActiveUser().getEmail();
  return e || Session.getEffectiveUser().getEmail() || 'unknown';
}
function logAudit(user, action, details) {
  db().getSheetByName('AuditLog').appendRow([new Date(), user, action, details]);
}
function include(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }

// ============================================================================
// SEED DATA — only writes when a tab is empty, so it never clobbers your edits
// ============================================================================
function seedSettings(ss) {
  const sh = ss.getSheetByName('Settings');
  if (sh.getLastRow() > 1) return;
  [['COMPANY_NAME', 'HG Group'],
   ['COMPANY_REG', '(your SSM reg no.)'],
   ['COMPANY_ADDRESS', '(your address)'],
   ['COMPANY_PHONE', '(your phone)'],
   ['COMPANY_EMAIL', 'lee@hggroup.com.my'],
   ['SST_PERCENT', '6'],
   ['QUOTE_PREFIX', 'HG-Q'],
   ['VALIDITY_DAYS', '14'],
   ['QUOTE_FOOTER', 'Prices are sample figures — replace in the Price Book tab. Subject to site condition. Validity 14 days.']
  ].forEach(r => sh.appendRow(r));
}

function seedServices(ss) {
  const sh = ss.getSheetByName('Services');
  if (sh.getLastRow() > 1) return;
  [['Hoarding', 'N', 1],
   ['Reinstatement', 'N', 2],
   ['Visual Print & Install', 'N', 3],
   ['Fit-Out', 'Y', 4],
   ['Scaffold', 'Y', 5],
   ['Temporary Storage', 'Y', 6]
  ].forEach(r => sh.appendRow([Utilities.getUuid(), r[0], r[1], r[2]]));
}

function seedMalls(ss) {
  const sh = ss.getSheetByName('Malls');
  if (sh.getLastRow() > 1) return;
  [['KLCC', 'KLCC', 'Kuala Lumpur'],
   ['Pavilion KL', 'PAV', 'Bukit Bintang'],
   ['Mid Valley', 'MV', 'Kuala Lumpur'],
   ['Sunway Pyramid', 'SP', 'Petaling Jaya']
  ].forEach(r => sh.appendRow([Utilities.getUuid(), r[0], r[1], r[2], '']));
}

/**
 * SAMPLE price book — every row is (All Malls) except a couple of KLCC overrides
 * to demonstrate per-mall pricing. Columns: Mall,Service,SubScope,Item,Unit,
 * Compulsory,MinQty,MinCharge,PriceMall,PriceContractor,PriceTenant,Sort,Notes
 * RATES ARE PLACEHOLDERS — replace with your real numbers.
 */
function seedPriceBook(ss) {
  const sh = ss.getSheetByName('PriceBook');
  if (sh.getLastRow() > 1) return;
  const A = ALL_MALLS;
  const rows = [
    // ---- HOARDING · Installation -------------------------------------------
    [A, 'Hoarding', 'Installation', 'Hoarding panel (plywood + metal frame)', 'sqft', 'Y', 0, 0, 18, 15, 22, 1, 'L×H per run'],
    [A, 'Hoarding', 'Installation', 'Visual tarpaulin print & install', 'sqft', 'Y', 0, 0, 8, 6, 10, 2, ''],
    [A, 'Hoarding', 'Installation', 'Skirting', 'ft', 'Y', 0, 0, 12, 10, 14, 3, 'linear ft'],
    [A, 'Hoarding', 'Installation', 'Sliding door', 'nos', 'Y', 0, 0, 850, 750, 1000, 4, ''],
    [A, 'Hoarding', 'Installation', 'Counterweight', 'nos', 'Y', 0, 0, 120, 100, 150, 5, ''],
    [A, 'Hoarding', 'Installation', 'Anti-climb capping', 'ft', 'N', 0, 0, 9, 7, 11, 6, 'optional'],
    [A, 'Hoarding', 'Installation', 'Inspection door / hatch', 'nos', 'N', 0, 0, 350, 300, 420, 7, 'optional'],
    // ---- HOARDING · Modification -------------------------------------------
    [A, 'Hoarding', 'Modification', 'Hoarding relocation / modification', 'sqft', 'Y', 0, 0, 10, 8, 12, 1, ''],
    [A, 'Hoarding', 'Modification', 'Door relocation', 'nos', 'N', 0, 0, 450, 400, 550, 2, ''],
    [A, 'Hoarding', 'Modification', 'Re-print tarpaulin', 'sqft', 'N', 0, 0, 7, 5, 9, 3, ''],
    // ---- HOARDING · Dismantling --------------------------------------------
    [A, 'Hoarding', 'Dismantling', 'Hoarding dismantling', 'sqft', 'Y', 0, 0, 6, 5, 8, 1, ''],
    [A, 'Hoarding', 'Dismantling', 'Disposal & cart away', 'lot', 'Y', 0, 350, 0, 0, 0, 2, 'min charge lot'],
    // ---- REINSTATEMENT (sub-scope = trade + lot/kiosk; min sqft applies) ----
    [A, 'Reinstatement', 'F&B Lot', 'Hacking & removal of existing finishes', 'sqft', 'Y', 200, 0, 9, 7, 11, 1, 'min 200 sqft'],
    [A, 'Reinstatement', 'F&B Lot', 'Floor screed & leveling', 'sqft', 'Y', 200, 0, 8, 6, 10, 2, 'min 200 sqft'],
    [A, 'Reinstatement', 'F&B Lot', 'Repaint to base / original', 'sqft', 'Y', 200, 0, 4, 3, 5, 3, 'min 200 sqft'],
    [A, 'Reinstatement', 'F&B Lot', 'Make good & handover cleaning', 'lot', 'Y', 0, 800, 0, 0, 0, 4, 'min charge RM800'],
    [A, 'Reinstatement', 'F&B Kiosk', 'Hacking & removal', 'sqft', 'Y', 50, 600, 11, 9, 13, 1, 'min 50 sqft / RM600'],
    [A, 'Reinstatement', 'F&B Kiosk', 'Make good & handover cleaning', 'lot', 'Y', 0, 500, 0, 0, 0, 2, 'min charge RM500'],
    [A, 'Reinstatement', 'Other Trades Lot', 'Hacking & removal', 'sqft', 'Y', 150, 0, 7, 5, 9, 1, 'min 150 sqft'],
    [A, 'Reinstatement', 'Other Trades Lot', 'Repaint to base / original', 'sqft', 'Y', 150, 0, 4, 3, 5, 2, 'min 150 sqft'],
    [A, 'Reinstatement', 'Other Trades Lot', 'Make good & handover cleaning', 'lot', 'Y', 0, 600, 0, 0, 0, 3, 'min charge RM600'],
    [A, 'Reinstatement', 'Other Trades Kiosk', 'Hacking & removal', 'sqft', 'Y', 40, 450, 9, 7, 11, 1, 'min 40 sqft / RM450'],
    [A, 'Reinstatement', 'Other Trades Kiosk', 'Make good & handover cleaning', 'lot', 'Y', 0, 400, 0, 0, 0, 2, 'min charge RM400'],
    // ---- VISUAL PRINT & INSTALL --------------------------------------------
    [A, 'Visual Print & Install', 'Tarpaulin', 'Tarpaulin print & install', 'sqft', 'Y', 0, 0, 8, 6, 10, 1, ''],
    [A, 'Visual Print & Install', 'Sticker', 'Sticker print & install', 'sqft', 'Y', 0, 0, 10, 8, 13, 1, ''],
    [A, 'Visual Print & Install', 'Sticker', 'Lamination', 'sqft', 'N', 0, 0, 3, 2, 4, 2, 'optional'],
    // ---- FIT-OUT (extra) ----------------------------------------------------
    [A, 'Fit-Out', 'Partition', 'Plaster board partition (both sides)', 'sqft', 'Y', 0, 0, 14, 11, 17, 1, ''],
    [A, 'Fit-Out', 'Plaster Ceiling', 'Plaster ceiling', 'sqft', 'Y', 0, 0, 12, 10, 15, 1, ''],
    [A, 'Fit-Out', 'Tiling', 'Floor / wall tiling (excl. tiles)', 'sqft', 'Y', 0, 0, 9, 7, 12, 1, 'labour only'],
    [A, 'Fit-Out', 'Flooring', 'Vinyl / laminate flooring', 'sqft', 'Y', 0, 0, 7, 5, 9, 1, ''],
    [A, 'Fit-Out', 'Brick Wall', 'Brick wall erection & plaster', 'sqft', 'Y', 0, 0, 16, 13, 20, 1, ''],
    [A, 'Fit-Out', 'Painting', 'Painting (1 coat primer + 2 coats)', 'sqft', 'Y', 0, 0, 3.5, 2.8, 4.5, 1, ''],
    // ---- SCAFFOLD (extra) ---------------------------------------------------
    [A, 'Scaffold', 'Erection', 'Scaffold erection', 'sqft', 'Y', 0, 0, 6, 5, 8, 1, 'face area'],
    [A, 'Scaffold', 'Erection', 'Green tag inspection', 'nos', 'N', 0, 0, 150, 120, 180, 2, 'weekly'],
    [A, 'Scaffold', 'Hire', 'Scaffold hire', 'day', 'Y', 0, 0, 2.5, 2, 3, 1, 'per sqft per day'],
    [A, 'Scaffold', 'Dismantling', 'Scaffold dismantling', 'sqft', 'Y', 0, 0, 3, 2.5, 4, 1, ''],
    // ---- TEMPORARY STORAGE (extra) -----------------------------------------
    [A, 'Temporary Storage', 'Lot Rental', 'Storage lot rental', 'month', 'Y', 0, 0, 800, 700, 1000, 1, 'per lot per month'],
    [A, 'Temporary Storage', 'Lot Rental', 'Transport in/out', 'trip', 'N', 0, 0, 350, 300, 420, 2, 'optional'],
    // ---- KLCC OVERRIDES (demonstrate per-mall pricing) ---------------------
    ['KLCC', 'Hoarding', 'Installation', 'Hoarding panel (plywood + metal frame)', 'sqft', 'Y', 0, 0, 22, 19, 26, 1, 'KLCC premium'],
    ['KLCC', 'Hoarding', 'Installation', 'Visual tarpaulin print & install', 'sqft', 'Y', 0, 0, 10, 8, 13, 2, 'KLCC premium']
  ];
  rows.forEach(function (r) {
    sh.appendRow([Utilities.getUuid(), r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7],
                  r[8], r[9], r[10], r[11], r[12], 'seed', new Date()]);
  });
}
