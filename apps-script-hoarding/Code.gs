/**
 * HG — Hoarding Pricing System (Cloud v1)
 * Google Apps Script backend, served as a Workspace-restricted web app.
 *
 * Construction hoarding (metal deck) quoting for Lee + Sun's team.
 * Calc engine is a verified exact port of "HG Metal Deck Calculator (3).xlsx"
 * (test case L160/H2.4/CC3/1door reproduces Hoarding 47,860.14, Gate 5,740.26,
 *  Grand ex-tax 53,600.39 — to the cent).
 *
 * Covers all six requirements:
 *   1. Prepare pricing for a client          -> computeQuote_ / saveQuote
 *   2. Store client + project + quote records -> Quotes sheet (full snapshot)
 *   3. Amend material price, show WHEN it changed -> editMaterialPrice + PriceHistory
 *   4. Multiple supplier prices for comparison    -> SupplierPrices sheet (apply optional)
 *   5. Reporting (retrieve everything quoted)      -> bootstrap feeds front-end reports
 *   6. Audit log of every action                   -> AuditLog (server-stamped email)
 *
 * Storage: the Google Sheet this script is bound to (container-bound).
 * Auth:    Workspace domain restriction + per-call guard. Every write stamps the
 *          signed-in email in AuditLog.
 *
 * FIRST RUN:
 *   1. Run setupSystem()  -> builds tabs, seeds 28-material catalog + config
 *   2. Deploy > New deployment > Web app > Execute as: Me, Access: HG domain
 */

/* ===================== CONFIG ===================== */
const ALLOWED_DOMAIN = 'hggroup.com.my';

const SHEETS = {
  MATERIALS: 'Materials', QUOTES: 'Quotes', SUPPLIERS: 'SupplierPrices',
  PRICEHIST: 'PriceHistory', CONFIG: 'Config', AUDIT: 'AuditLog'
};

const HEADERS = {
  Materials: ['code','type','size','thickness','barQty','unit','costPrice','markup','updatedAt','updatedBy'],
  Quotes: [
    'id','quoteNo','date','client','contact','project','mall','lot','location','validity','status',
    'length','height','doors','hoardingTotal','gateTotal','subtotal','sstPct','sstAmount','grandTotal',
    'dataJson','createdAt','createdBy','updatedAt','updatedBy'
  ],
  SupplierPrices: ['id','code','supplier','costPrice','note','recordedAt','recordedBy'],
  PriceHistory: ['ts','code','field','oldVal','newVal','user','reason'],
  Config: ['key','value'],
  AuditLog: ['timestamp','userEmail','action','recordType','recordId','details']
};

const DEFAULTS = {
  COMPANY_NAME: 'HG Services (M) Sdn Bhd',
  COMPANY_REG: 'Co. No. 958510-M',
  COMPANY_ADDRESS: 'Bandar Kinrara, Puchong, Selangor',
  COMPANY_EMAIL: 'info@hggroup.com.my',
  COMPANY_WEB: 'www.hggroup.com.my',
  SST_PCT: '6',                         // Excel labelled "8%" but computed 6% — 6% is HG standard
  DEFAULT_MARKUP: '40',
  QUOTE_PREFIX: 'HG-Q-', QUOTE_SEQ: '0',
  // fixed costing material codes (defaults from the Excel; editable in Config)
  CODE_GI: 'GI-4x8-0.4', CODE_DECK_MAIN: 'DECK-0.23', CODE_DECK_GATE: 'DECK-0.48',
  CODE_FOOTING: 'FOOTING-450x450x750', CODE_BASE: 'BASE-200x200x5', CODE_XBRACE: 'MS-50x50x5',
  XBRACE_LEN: '10.8',
  // default labor rates (RM) — also editable per quote in the builder
  L_FAB_POST: '150', L_PRELIM: '1200', L_INSTALL: '1500', L_FAB_GATE: '1200', L_INSTALL_GATE: '1500',
  // quotation footer — editable in Settings (one term per line)
  SIGNATORY: 'Lee Chun Hui (Black) — Director',
  TERMS: [
    '1. Validity: As stated above from quote date.',
    '2. Payment: 50% deposit on confirmation, 50% on completion. Payment within 30 days of invoice.',
    '3. Lead time: Mobilization within 7 working days of confirmed PO and site readiness.',
    '4. Site requirements: Client to provide unobstructed access, water & power, and necessary permits.',
    '5. Variations: Any scope changes quoted separately, require written approval before execution.',
    '6. Warranty: Workmanship warranty of 6 months from completion against manufacturing defects.',
    '7. Force majeure: HG not liable for delays from weather, mall restrictions, or third-party works.',
    '8. Insurance: Public liability coverage included as per HG Group standard policy.'
  ].join('\n')
};

const QUOTE_STATUSES = ['Draft', 'Sent', 'Won', 'Lost'];

/* ===================== ENTRY ===================== */
function doGet() {
  const email = (Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email.endsWith('@' + ALLOWED_DOMAIN)) {
    return HtmlService.createHtmlOutput(
      '<div style="font-family:sans-serif;padding:40px;max-width:600px;">' +
      '<h2>Access denied</h2><p>This tool is restricted to <b>@' + ALLOWED_DOMAIN +
      '</b> accounts.</p><p>You are signed in as: <code>' + (email || '(unknown)') +
      '</code></p><p>Sign in with your company account and reload.</p></div>');
  }
  ensureSheets_();
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('HG — Hoarding Pricing')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function include(filename) { return HtmlService.createHtmlOutputFromFile(filename).getContent(); }

function requireDomain_() {
  const email = (Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email.endsWith('@' + ALLOWED_DOMAIN)) throw new Error('Access denied. Only @' + ALLOWED_DOMAIN + ' accounts allowed.');
  return email;
}

/* ===================== BOOTSTRAP ===================== */
function bootstrap() {
  requireDomain_();
  ensureSheets_();
  const cfg = getConfig_();
  const materials = readSheet_(SHEETS.MATERIALS).map(normMaterial_).map(withRates_);
  const quotes = readSheet_(SHEETS.QUOTES).map(normQuote_);
  const suppliers = readSheet_(SHEETS.SUPPLIERS).map(normSupplier_);
  const priceHistory = readSheet_(SHEETS.PRICEHIST).map(normPriceHist_).reverse(); // newest first

  return {
    currentUser: requireDomain_(),
    serverTime: nowIso_(),
    today: todayISO_(),
    config: cfg,
    materials: materials,
    quotes: quotes.sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); }),
    suppliers: suppliers,
    priceHistory: priceHistory,
    audit: loadAudit_(300),
    stats: buildStats_(quotes)
  };
}

function buildStats_(quotes) {
  let total = 0, won = 0, open = 0;
  quotes.forEach(function (q) {
    total += q.totals.grand;
    if (q.status === 'Won') won += q.totals.grand;
    if (q.status === 'Draft' || q.status === 'Sent') open += q.totals.grand;
  });
  const clients = {};
  quotes.forEach(function (q) { if (q.client) clients[q.client] = true; });
  return { quoteCount: quotes.length, totalValue: round2_(total), wonValue: round2_(won),
    openValue: round2_(open), clientCount: Object.keys(clients).length };
}

/* ===================== MATERIAL HELPERS ===================== */
function withRates_(m) {
  m.costPerUnit = m.barQty ? (m.costPrice / m.barQty) : m.costPrice;
  m.clientRate = m.costPerUnit * (1 + (m.markup || 0));
  return m;
}
function materialMap_() {
  const map = {};
  readSheet_(SHEETS.MATERIALS).map(normMaterial_).map(withRates_).forEach(function (m) { map[m.code] = m; });
  return map;
}

/* ===================== CALC ENGINE (ports the Excel) ===================== */
function roundUp_(x) { return Math.ceil(x - 1e-9); }

/**
 * Authoritative server-side cost computation. `inputs` mirrors the builder form.
 * Rates resolved from the live Materials catalog (snapshot taken at save time).
 */
function computeQuote_(inputs, cfg) {
  const i = inputs || {};
  const map = materialMap_();
  const rate = function (code) { return map[code] ? map[code].clientRate : 0; };
  const n = function (v) { return Number(v) || 0; };

  const length = n(i.length), height = n(i.height), cc = n(i.cc) || 1, doors = n(i.doors);
  const horizLines = n(i.horizLines), footPerPost = n(i.footPerPost);
  const pInstall = n(i.pInstall) || 1, pFab = n(i.pFab) || 1, gateDays = n(i.gateDays);
  const sqftF = n(i.sqftF), gStruct = n(i.gStruct), gPanel = n(i.gPanel), gPosts = n(i.gPosts), gFoot = n(i.gFoot);
  const oXbrace = n(i.oXbrace);
  const xbraceLen = (i.xbraceLen != null && i.xbraceLen !== '') ? n(i.xbraceLen) : (Number(cfg.XBRACE_LEN) || 10.8);
  const lFabPost = n(i.lFabPost), lPrelim = n(i.lPrelim), lInstall = n(i.lInstall),
        lFabGate = n(i.lFabGate), lInstallGate = n(i.lInstallGate);
  const sst = n(i.sst);

  // Category-driven material selection (backward compatible with old cladding/fixed-code quotes):
  // 3. Hoarding panel = selected GI or DECK ;  4. Base/footing = selected BASE or FOOTING.
  const panelCode = i.panelCode || (i.cladding === 'gi' ? (i.giCode || cfg.CODE_GI) : (i.deckMain || cfg.CODE_DECK_MAIN));
  const foundCode = i.foundCode || i.footCode || cfg.CODE_FOOTING;
  const deckGate = i.deckGate || cfg.CODE_DECK_GATE, xbraceCode = i.xbraceCode || cfg.CODE_XBRACE;

  const postPerPost = 2 * Math.sqrt(Math.pow(height - 0.3, 2) + Math.pow(1.2, 2)) + 2.1;
  const posts = roundUp_(length / cc);
  const installDays = roundUp_(posts / pInstall);
  const fabDays = roundUp_(posts / pFab);
  const deckSqft = roundUp_(length * height * sqftF);
  const rPost = rate(i.postCode), rHoriz = rate(i.horizCode);
  const unitOf = function (code) { return map[code] ? map[code].unit : ''; };

  function L(item, code, r, sub, qty, unit) { return { item: item, code: code, rate: r, sub: sub, qty: qty, unit: unit, total: sub * qty }; }

  const H = [];
  H.push(L('Vertical Post + Brace', i.postCode, rPost, postPerPost * rPost, posts, 'set'));
  H.push(L('Horizontal', i.horizCode, rHoriz, rHoriz, length * horizLines, 'm'));
  H.push(L('Labor Fabrication (Post)', '—', lFabPost, lFabPost, posts, 'set'));
  H.push(L('Preliminaries', '—', lPrelim, lPrelim, installDays, 'day'));
  H.push(L('Labor Installation (Onsite)', '—', lInstall, lInstall, installDays, 'day'));
  H.push(L('Hoarding Panel', panelCode, rate(panelCode), rate(panelCode), deckSqft, unitOf(panelCode)));
  H.push(L('Base / Footing', foundCode, rate(foundCode), rate(foundCode), posts * footPerPost, unitOf(foundCode)));
  H.push(L('ADD ON: X Brace', xbraceCode, rate(xbraceCode), xbraceLen * rate(xbraceCode), oXbrace, 'set'));
  const hoardTotal = H.reduce(function (s, r) { return s + r.total; }, 0);

  const G = [];
  G.push(L('Gate Post', i.postCode, rPost, postPerPost * rPost, doors * gPosts, 'nos'));
  G.push(L('Gate Structure', i.horizCode, rHoriz, rHoriz, doors * gStruct, 'm'));
  G.push(L('Gate Panel', deckGate, rate(deckGate), rate(deckGate), doors * gPanel, unitOf(deckGate)));
  G.push(L('Base / Footing (Gate)', foundCode, rate(foundCode), rate(foundCode), doors * gFoot, unitOf(foundCode)));
  G.push(L('Labor Fabrication (Post-Gate)', '—', lFabPost, lFabPost, doors * gPosts, 'nos'));
  G.push(L('Labor Fabrication (Gate)', '—', lFabGate, lFabGate, doors, 'nos'));
  G.push(L('Labor Installation (Gate Onsite)', '—', lInstallGate, lInstallGate, doors * gateDays, 'day'));
  const gateTotal = G.reduce(function (s, r) { return s + r.total; }, 0);

  const sub = hoardTotal + gateTotal;
  const sstAmt = sub * (sst / 100);
  const grand = sub + sstAmt;

  return {
    H: H, G: G,
    hoardTotal: round2_(hoardTotal), gateTotal: round2_(gateTotal),
    sub: round2_(sub), sst: round2_(sstAmt), grand: round2_(grand), sstPct: sst,
    metrics: {
      posts: posts, postPerPost: postPerPost, vert: posts * postPerPost, horiz: length * horizLines,
      foot: posts * footPerPost, sqft: deckSqft, installDays: installDays, fabDays: fabDays,
      projectDays: Math.max(installDays, fabDays) + doors * gateDays
    }
  };
}

/** Live preview used by the builder while typing — no write, just numbers. */
function previewQuote(inputs) {
  requireDomain_();
  return computeQuote_(inputs, getConfig_());
}

/* ===================== QUOTES ===================== */
function saveQuote(p) {
  const user = requireDomain_();
  const now = nowIso_();
  const cfg = getConfig_();
  if (!p.client) throw new Error('Client name is required.');
  const inputs = p.inputs || {};
  const r = computeQuote_(inputs, cfg);

  const existing = p.id ? readSheet_(SHEETS.QUOTES).map(normQuote_).filter(function (x) { return x.id === p.id; })[0] : null;
  if (p.id && !existing) throw new Error('Quote not found.');

  const quoteNo = p.quoteNo || (existing ? existing.quoteNo : nextQuoteNo_());
  const rec = {
    id: p.id || uid_(),
    quoteNo: quoteNo,
    date: p.date || todayISO_(),
    client: p.client, contact: p.contact || '', project: p.project || '', mall: p.mall || '',
    lot: p.lot || '', location: p.location || '', validity: num_(p.validity) || 0,
    status: QUOTE_STATUSES.indexOf(p.status) >= 0 ? p.status : 'Draft',
    length: num_(inputs.length), height: num_(inputs.height), doors: num_(inputs.doors),
    hoardingTotal: r.hoardTotal, gateTotal: r.gateTotal, subtotal: r.sub,
    sstPct: r.sstPct, sstAmount: r.sst, grandTotal: r.grand,
    dataJson: JSON.stringify({ inputs: inputs, lines: { H: r.H, G: r.G }, metrics: r.metrics }),
    createdAt: existing ? existing.createdAt : now, createdBy: existing ? existing.createdBy : user,
    updatedAt: now, updatedBy: user
  };

  if (existing) {
    updateRecord_(SHEETS.QUOTES, rec);
    logAudit_('UPDATE', 'Quote', rec.quoteNo, rec.client + ' / RM ' + money_(rec.grandTotal));
  } else {
    appendRecord_(SHEETS.QUOTES, rec);
    bumpQuoteSeq_(quoteNo);
    logAudit_('CREATE', 'Quote', rec.quoteNo, rec.client + ' / RM ' + money_(rec.grandTotal));
  }
  return bootstrap();
}
function setQuoteStatus(id, status) {
  requireDomain_();
  if (QUOTE_STATUSES.indexOf(status) < 0) throw new Error('Bad status.');
  const q = readSheet_(SHEETS.QUOTES).map(normQuoteRow_).filter(function (x) { return x.id === id; })[0];
  if (!q) throw new Error('Quote not found.');
  q.status = status; q.updatedAt = nowIso_(); q.updatedBy = requireDomain_();
  updateRecord_(SHEETS.QUOTES, q);
  logAudit_('STATUS', 'Quote', q.quoteNo, status);
  return bootstrap();
}
function deleteQuote(id) {
  requireDomain_();
  const q = readSheet_(SHEETS.QUOTES).map(normQuoteRow_).filter(function (x) { return x.id === id; })[0];
  if (!q) throw new Error('Quote not found.');
  deleteRowsWhere_(SHEETS.QUOTES, 1, [id]);
  logAudit_('DELETE', 'Quote', q.quoteNo, q.client + ' / RM ' + money_(q.grandTotal));
  return bootstrap();
}
function nextQuoteNo() { requireDomain_(); return peekQuoteNo_(); }
function peekQuoteNo_() {
  const cfg = getConfig_();
  const yr = new Date().getFullYear();
  const existing = {};
  readSheet_(SHEETS.QUOTES).forEach(function (r) { existing[String(r.quoteNo).toLowerCase()] = true; });
  let seq = Number(cfg.QUOTE_SEQ) || 0, no;
  do { seq++; no = (cfg.QUOTE_PREFIX || 'HG-Q-') + yr + '-' + ('000' + seq).slice(-3); } while (existing[no.toLowerCase()]);
  return no;
}
function nextQuoteNo_() { return peekQuoteNo_(); }
function bumpQuoteSeq_(quoteNo) {
  const m = String(quoteNo).match(/(\d+)\s*$/);
  if (!m) return;
  const cfg = getConfig_();
  const cur = Number(cfg.QUOTE_SEQ) || 0;
  const used = Number(m[1]) || 0;
  if (used > cur) setConfigValue_('QUOTE_SEQ', used);
}

/* ===================== MATERIALS ===================== */
function editMaterialPrice(code, field, value, reason) {
  const user = requireDomain_();
  if (field !== 'costPrice' && field !== 'markup') throw new Error('Bad field.');
  const sheet = ss_().getSheetByName(SHEETS.MATERIALS);
  const rows = readSheet_(SHEETS.MATERIALS).map(normMaterial_);
  const m = rows.filter(function (x) { return x.code === code; })[0];
  if (!m) throw new Error('Material not found.');
  let nv = Number(value) || 0;
  if (field === 'markup') nv = nv / 100;        // form sends % (40), store as fraction (0.4)
  const old = m[field];
  if (Math.abs(old - nv) < 1e-9) return bootstrap();
  m[field] = nv; m.updatedAt = nowIso_(); m.updatedBy = user;
  updateRecord_(SHEETS.MATERIALS, m);
  const oldDisp = field === 'markup' ? old * 100 : old;
  const newDisp = field === 'markup' ? nv * 100 : nv;
  appendRecord_(SHEETS.PRICEHIST, { ts: nowIso_(), code: code, field: field === 'markup' ? 'Markup %' : 'Cost Price',
    oldVal: oldDisp, newVal: newDisp, user: user, reason: reason || '' });
  logAudit_('PRICE-CHANGE', 'Material', code,
    (field === 'markup' ? oldDisp + '%->' + newDisp + '%' : 'RM' + oldDisp + '->RM' + newDisp) + (reason ? ' (' + reason + ')' : ''));
  return bootstrap();
}
function saveMaterial(p) {
  const user = requireDomain_();
  const code = String(p.code || '').trim();
  if (!code) throw new Error('Material code is required.');
  const rows = readSheet_(SHEETS.MATERIALS).map(normMaterial_);
  const existing = rows.filter(function (x) { return x.code === code; })[0];
  const rec = {
    code: code, type: p.type || '', size: p.size || '', thickness: p.thickness === '' || p.thickness == null ? '' : num_(p.thickness),
    barQty: num_(p.barQty) || 1, unit: p.unit || 'm', costPrice: num_(p.costPrice),
    markup: (num_(p.markup) || 0) / 100, updatedAt: nowIso_(), updatedBy: user
  };
  if (existing) {
    updateRecord_(SHEETS.MATERIALS, rec);
    logAudit_('UPDATE', 'Material', code, p.type + ' ' + p.size);
  } else {
    appendRecord_(SHEETS.MATERIALS, rec);
    logAudit_('CREATE', 'Material', code, p.type + ' ' + p.size);
  }
  return bootstrap();
}
function deleteMaterial(code) {
  requireDomain_();
  deleteRowsWhere_(SHEETS.MATERIALS, 1, [code]);
  logAudit_('DELETE', 'Material', code, '');
  return bootstrap();
}

/* ===================== SUPPLIER PRICES (comparison) ===================== */
function saveSupplierPrice(p) {
  const user = requireDomain_();
  if (!p.code) throw new Error('Material is required.');
  if (!p.supplier) throw new Error('Supplier name is required.');
  appendRecord_(SHEETS.SUPPLIERS, { id: uid_(), code: p.code, supplier: p.supplier,
    costPrice: num_(p.costPrice), note: p.note || '', recordedAt: nowIso_(), recordedBy: user });
  logAudit_('CREATE', 'SupplierPrice', p.code, p.supplier + ' / RM ' + money_(num_(p.costPrice)));
  return bootstrap();
}
function deleteSupplierPrice(id) {
  requireDomain_();
  const s = readSheet_(SHEETS.SUPPLIERS).map(normSupplier_).filter(function (x) { return x.id === id; })[0];
  deleteRowsWhere_(SHEETS.SUPPLIERS, 1, [id]);
  logAudit_('DELETE', 'SupplierPrice', s ? s.code : id, s ? s.supplier : '');
  return bootstrap();
}
/** Push a supplier's price into the catalog cost (logs a price change too). */
function applySupplierToCatalog(id) {
  const user = requireDomain_();
  const s = readSheet_(SHEETS.SUPPLIERS).map(normSupplier_).filter(function (x) { return x.id === id; })[0];
  if (!s) throw new Error('Supplier price not found.');
  const m = readSheet_(SHEETS.MATERIALS).map(normMaterial_).filter(function (x) { return x.code === s.code; })[0];
  if (!m) throw new Error('Material ' + s.code + ' not in catalog.');
  const old = m.costPrice;
  m.costPrice = s.costPrice; m.updatedAt = nowIso_(); m.updatedBy = user;
  updateRecord_(SHEETS.MATERIALS, m);
  appendRecord_(SHEETS.PRICEHIST, { ts: nowIso_(), code: s.code, field: 'Cost Price',
    oldVal: old, newVal: s.costPrice, user: user, reason: 'Applied supplier: ' + s.supplier });
  logAudit_('PRICE-CHANGE', 'Material', s.code, 'RM' + old + '->RM' + s.costPrice + ' (supplier ' + s.supplier + ')');
  return bootstrap();
}

/* ===================== PRINT ===================== */
function getQuoteForPrint(id) {
  requireDomain_();
  const q = readSheet_(SHEETS.QUOTES).map(normQuote_).filter(function (x) { return x.id === id; })[0];
  if (!q) throw new Error('Quote not found.');
  logAudit_('PRINT', 'Quote', q.quoteNo, q.client);
  return { quote: q, config: getConfig_() };
}

/* ===================== AUDIT ===================== */
function loadAudit_(limit) {
  const sheet = ss_().getSheetByName(SHEETS.AUDIT);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const n = Math.min(limit || 300, last - 1);
  const vals = sheet.getRange(last - n + 1, 1, n, HEADERS.AuditLog.length).getValues();
  return vals.reverse().map(function (row) {
    return { ts: str_(row[0]), user: row[1], action: row[2], entity: row[3], recordId: row[4], detail: row[5] };
  });
}

/* ===================== NORMALISERS ===================== */
function normMaterial_(m) {
  return { code: str_(m.code), type: str_(m.type), size: str_(m.size),
    thickness: m.thickness === '' || m.thickness == null ? '' : num_(m.thickness),
    barQty: num_(m.barQty) || 1, unit: str_(m.unit) || 'm', costPrice: num_(m.costPrice),
    markup: num_(m.markup), updatedAt: str_(m.updatedAt), updatedBy: str_(m.updatedBy) };
}
function normQuoteRow_(q) {
  return { id: str_(q.id), quoteNo: str_(q.quoteNo), date: dateStr_(q.date), client: str_(q.client),
    contact: str_(q.contact), project: str_(q.project), mall: str_(q.mall), lot: str_(q.lot),
    location: str_(q.location), validity: num_(q.validity), status: str_(q.status) || 'Draft',
    length: num_(q.length), height: num_(q.height), doors: num_(q.doors),
    hoardingTotal: num_(q.hoardingTotal), gateTotal: num_(q.gateTotal), subtotal: num_(q.subtotal),
    sstPct: num_(q.sstPct), sstAmount: num_(q.sstAmount), grandTotal: num_(q.grandTotal),
    dataJson: str_(q.dataJson), createdAt: str_(q.createdAt), createdBy: str_(q.createdBy),
    updatedAt: str_(q.updatedAt), updatedBy: str_(q.updatedBy) };
}
function normQuote_(q) {
  const base = normQuoteRow_(q);
  let data = { inputs: {}, lines: { H: [], G: [] }, metrics: {} };
  try { if (base.dataJson) data = JSON.parse(base.dataJson); } catch (e) {}
  base.inputs = data.inputs || {};
  base.lines = data.lines || { H: [], G: [] };
  base.metrics = data.metrics || {};
  base.totals = { hoard: base.hoardingTotal, gate: base.gateTotal, sub: base.subtotal,
    sst: base.sstAmount, grand: base.grandTotal, sstPct: base.sstPct };
  delete base.dataJson;
  return base;
}
function normSupplier_(s) {
  return { id: str_(s.id), code: str_(s.code), supplier: str_(s.supplier), costPrice: num_(s.costPrice),
    note: str_(s.note), recordedAt: str_(s.recordedAt), recordedBy: str_(s.recordedBy) };
}
function normPriceHist_(p) {
  return { ts: str_(p.ts), code: str_(p.code), field: str_(p.field), oldVal: num_(p.oldVal),
    newVal: num_(p.newVal), user: str_(p.user), reason: str_(p.reason) };
}

/* ===================== CONFIG ===================== */
function getConfig_() {
  const cfg = Object.assign({}, DEFAULTS);
  readSheet_(SHEETS.CONFIG).forEach(function (row) { if (row.key) cfg[row.key] = str_(row.value); });
  return cfg;
}
function saveConfig(obj) {
  requireDomain_();
  Object.keys(obj).forEach(function (k) { setConfigValue_(k, obj[k]); });
  logAudit_('CONFIG', 'Config', '-', Object.keys(obj).join(','));
  return bootstrap();
}
function setConfigValue_(key, value) {
  const sheet = ss_().getSheetByName(SHEETS.CONFIG);
  const last = sheet.getLastRow();
  if (last >= 2) {
    const keys = sheet.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < keys.length; i++) if (String(keys[i][0]) === key) { sheet.getRange(i + 2, 2).setValue(value); return; }
  }
  sheet.appendRow([key, value]);
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
      if (sheet.getMaxColumns() < HEADERS[name].length) {
        sheet.insertColumnsAfter(sheet.getMaxColumns(), HEADERS[name].length - sheet.getMaxColumns());
      }
      const firstRow = sheet.getRange(1, 1, 1, HEADERS[name].length).getValues()[0];
      const mismatch = HEADERS[name].some(function (h, i) { return String(firstRow[i] || '') !== h; });
      if (mismatch) {
        sheet.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]);
        sheet.setFrozenRows(1);
        sheet.getRange(1, 1, 1, HEADERS[name].length).setFontWeight('bold');
      }
    }
  });
  const def = ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() <= 1 && def.getLastColumn() <= 1 && ss.getSheets().length > 1) ss.deleteSheet(def);
}
function readSheet_(name) {
  const sheet = ss_().getSheetByName(name);
  if (!sheet) return [];
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const headers = HEADERS[name];
  const values = sheet.getRange(2, 1, last - 1, headers.length).getValues();
  return values.filter(function (row) { return row.some(function (v) { return v !== '' && v !== null; }); })
    .map(function (row) { const o = {}; headers.forEach(function (h, i) { o[h] = row[i]; }); return o; });
}
function rowFromRecord_(name, rec) { return HEADERS[name].map(function (h) { return rec[h] === undefined ? '' : rec[h]; }); }
function appendRecord_(name, rec) { ss_().getSheetByName(name).appendRow(rowFromRecord_(name, rec)); }
function updateRecord_(name, rec) {
  const sheet = ss_().getSheetByName(name);
  const last = sheet.getLastRow();
  if (last < 2) return false;
  const keyCol = sheet.getRange(2, 1, last - 1, 1).getValues();   // col A is the key (id or code)
  const key = rec.id !== undefined ? rec.id : rec.code;
  for (let i = 0; i < keyCol.length; i++) {
    if (String(keyCol[i][0]) === String(key)) { sheet.getRange(i + 2, 1, 1, HEADERS[name].length).setValues([rowFromRecord_(name, rec)]); return true; }
  }
  return false;
}
function deleteRowsWhere_(name, col, ids) {
  const sheet = ss_().getSheetByName(name);
  if (!sheet) return 0;
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const vals = sheet.getRange(2, col, last - 1, 1).getValues();
  let removed = 0;
  for (let i = vals.length - 1; i >= 0; i--) { if (ids.indexOf(String(vals[i][0])) >= 0) { sheet.deleteRow(i + 2); removed++; } }
  return removed;
}

/* ===================== UTILS ===================== */
function uid_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 12); }
function nowIso_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss'); }
function tz_() { return Session.getScriptTimeZone() || 'Asia/Kuala_Lumpur'; }
function todayISO_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }
function dateStr_(v) { if (v instanceof Date) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd'); return String(v == null ? '' : v).slice(0, 10); }
function str_(v) { return (v instanceof Date) ? Utilities.formatDate(v, tz_(), 'yyyy-MM-dd HH:mm:ss') : String(v == null ? '' : v); }
function num_(v) { return Number(v) || 0; }
function round2_(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function money_(n) { return (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function logAudit_(action, recordType, recordId, details) {
  ss_().getSheetByName(SHEETS.AUDIT).appendRow([nowIso_(), (Session.getActiveUser().getEmail() || 'unknown').toLowerCase(), action, recordType, recordId, details || '']);
}

/* ===================== SETUP / SEED ===================== */
function setupSystem() {
  ensureSheets_();
  const cfgSh = ss_().getSheetByName(SHEETS.CONFIG);
  if (cfgSh.getLastRow() < 2) {
    const rows = Object.keys(DEFAULTS).map(function (k) { return [k, DEFAULTS[k]]; });
    cfgSh.getRange(2, 1, rows.length, 2).setValues(rows);
  }
  seedMaterials_();
  logAudit_('SETUP', 'System', '-', 'Sheets created / catalog seeded');
  return 'Setup complete. Next: Deploy > New deployment > Web app (Execute as Me, Access: HG domain).';
}
function seedMaterials_() {
  const sheet = ss_().getSheetByName(SHEETS.MATERIALS);
  if (sheet.getLastRow() > 1) return;
  // 28-material catalog ported from HG Metal Deck Calculator (3).xlsx — all markup 0.4 (40%).
  // [code, type, size, thickness, barQty, unit, costPrice, markup]
  const data = [
    ['MS-25x25x2.8','MS Square Hollow','25x25',2.8,6,'m',18,0.4],
    ['MS-38x38x2.8','MS Square Hollow','38x38',2.8,6,'m',26.5,0.4],
    ['MS-50x50x2.8','MS Square Hollow','50x50',2.8,6,'m',39,0.4],
    ['MS-100x100x2.3','MS Square Hollow','100x100',2.3,6,'m',111,0.4],
    ['MS-150x150x3','MS Square Hollow','150x150',3,6,'m',272,0.4],
    ['MS-150x100x3','MS Rect Hollow','150x100',3,6,'m',200,0.4],
    ['MS-100x75x3','MS Rect Hollow','100x75',3,6,'m',120,0.4],
    ['MS-50x100x6','MS Rect Hollow','50x100',6,6,'m',233,0.4],
    ['MS-65x38x3','MS Rect Hollow','65x38',3,6,'m',73,0.4],
    ['MS-50x50x6','MS Square Hollow','50x50',6,6,'m',193,0.4],
    ['MS-25x25x1','MS Square Hollow','25x25',1,6,'m',12,0.4],
    ['MS-38x38x1.6','MS Square Hollow','38x38',1.6,6,'m',28.5,0.4],
    ['MS-25x50x1.5','MS Rect Hollow','25x50',1.5,6,'m',26,0.4],
    ['MS-50x50x1.5','MS Square Hollow','50x50',1.5,6,'m',38,0.4],
    ['MS-50x75x1.5','MS Rect Hollow','50x75',1.5,6,'m',48,0.4],
    ['MS-75x75x1.6','MS Square Hollow','75x75',1.6,6,'m',59,0.4],
    ['MS-75x75x4','MS Square Hollow','75x75',4,6,'m',155,0.4],
    ['MS-100x75x1.9','MS Rect Hollow','100x75',1.9,6,'m',79,0.4],
    ['MS-50x50x5','MS Square Solid','50x50',5,6,'m',205.71,0.4],
    ['GI-4x8-0.4','GI Sheet','4x8 ft',0.4,32,'sqft',52,0.4],
    ['BASE-200x200x5','MS Base Plate','200x200',5,1,'nos',28,0.4],
    ['DECK-0.23','Metal Deck','762mm x 8ft',0.23,20,'sqft',21.2,0.4],
    ['DECK-0.35','Metal Deck','762mm x 8ft',0.35,20,'sqft',42,0.4],
    ['DECK-0.48','Metal Deck','762mm x 8ft',0.48,20,'sqft',46,0.4],
    ['FOOTING-3000x300x600','Concrete Footing','3000x300x600','',1,'nos',35,0.4],
    ['FOOTING-450x450x750','Concrete Footing','450x450x750','',1,'nos',40,0.4],
    ['BESI-BIRU-0.45x121','Besi Biru','0.45x121',0.75,6,'m',15,0.4],
    ['BESI-BIRU-0.73x153','Besi Biru','0.73x153',1.55,6,'m',25,0.4]
  ];
  const now = nowIso_();
  const rows = data.map(function (r) { return r.concat([now, 'seed']); });
  sheet.getRange(2, 1, rows.length, HEADERS.Materials.length).setValues(rows);
}
