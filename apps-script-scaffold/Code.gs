/**
 * HG — Scaffold & Green Tag System (Cloud v1)
 * Google Apps Script backend, served as a Workspace-restricted web app.
 *
 * Runs the scaffold business end-to-end for 3 services:
 *   1. Aluminium mobile scaffold — rental + install + green tag (Full),
 *      or deliver-only (RentalOnly, client installs).
 *   2. Customized scaffold system — same, may engage a 3rd-party supplier.
 *   3. Green tag endorsement only — inspect & endorse client's existing scaffold.
 *
 * Captures: client details, typed charges (PE / rental / install / transport /
 * dismantle / green tag / 3rd-party), invoices & payments (SST), weekly green-tag
 * inspections, scaffold material check-out / check-back with client sign-off,
 * site/before/after/collection/defect photos, certified personnel + cert expiry,
 * and a full who-did-what audit trail.
 *
 * Storage: the Google Sheet this script is bound to (container-bound).
 * Drive:   parent folder "HG — Scaffold & Green Tag"; photo + file subfolders.
 * Auth:    Workspace domain restriction + per-call guard. Every write is stamped
 *          with the signed-in email in AuditLog.
 *
 * FIRST RUN:
 *   1. Run setupSystem()         -> builds tabs, seeds material catalogue + config
 *   2. Run installDailyTrigger() -> daily green-tag + invoice + cert reminders
 *   3. Deploy > New deployment > Web app > Execute as: Me, Access: HG domain
 */

/* ===================== CONFIG ===================== */
const ALLOWED_DOMAIN = 'hggroup.com.my';
const PARENT_FOLDER_NAME = 'HG — Scaffold & Green Tag';
const SST_RATE = 0.06;   // fallback default; live rate comes from Config.SST_RATE_PCT
function sstRate_() { const v = Number(getConfig_().SST_RATE_PCT); return (isNaN(v) ? 6 : v) / 100; }

const SUBFOLDERS = { PHOTOS: 'Site Photos', SIGNOFF: 'Signed Off', INVOICES: 'Invoices', CERTS: 'Inspection Certs' };

const SHEETS = {
  ENGAGEMENTS: 'Engagements', CHARGES: 'Charges', MATERIALS: 'Materials',
  INSPECTIONS: 'Inspections', INVOICES: 'Invoices', PAYMENTS: 'Payments',
  PERSONNEL: 'Personnel', CATALOGUE: 'Catalogue', CONFIG: 'Config', AUDIT: 'AuditLog'
};

const HEADERS = {
  Engagements: [
    'id','jobNo','serviceType','scope','status',
    'clientCompany','clientPIC','clientContact','clientEmail','clientAddress',
    'siteName','siteAddress','scaffoldDesc','thirdParty',
    'peNo','peEndorsedBy','peEndorsedDate',
    'startDate','expectedEndDate','actualReturnDate',
    'greenTag','inspectIntervalDays','assignedInspector',
    'deliverySignName','deliverySignDate','deliverySignUrl',
    'returnSignName','returnSignDate','returnSignUrl',
    'photosSite','photosBefore','photosAfter','photosCollection','photosDefect',
    'handledBy','remarks',
    'createdAt','createdBy','updatedAt','updatedBy'
  ],
  Charges: [
    'id','engagementId','type','description','qty','unit','rate','basis','amount',
    'invoiceId','createdAt','createdBy'
  ],
  Materials: [
    'id','engagementId','code','item','spec','category','unit',
    'qtyOut','qtyReturned','damageQty','damageCharge','remarks','updatedAt','updatedBy'
  ],
  Inspections: [
    'id','engagementId','inspectDate','inspector','inspectorCertNo','result','tagNo',
    'nextDueDate','findings','photosUrl','certUrl','createdAt','createdBy'
  ],
  Invoices: [
    'id','invNo','engagementId','clientCompany','invDate','dueDate',
    'description','amount','sstEnabled','sstAmount','total','status',
    'fileUrl','fileId','notes','createdAt','createdBy','updatedAt'
  ],
  Payments: ['id','invoiceId','payDate','amount','method','reference','receivedBy','notes','createdAt'],
  Personnel: ['id','name','role','certType','certNo','issuedDate','expiryDate','contact','remarks','updatedAt'],
  Catalogue: ['code','item','spec','category','unit'],
  Config: ['key','value'],
  AuditLog: ['timestamp','userEmail','action','recordType','recordId','details']
};

const DEFAULTS = {
  GREENTAG_INTERVAL_DAYS: '7', GREENTAG_DUE_SOON_DAYS: '2',
  COLLECTION_DUE_SOON_DAYS: '7',
  CERT_EXPIRY_WARN_DAYS: '45', INVOICE_DUE_SOON_DAYS: '5',
  SST_RATE_PCT: '6',
  REMINDER_TO: '', COMPANY_NAME: 'HG Services (M) Sdn Bhd',
  COMPANY_REG: '958510-M · CIDB 0120170412-WP1187072 (G7)',
  COMPANY_ADDRESS: 'Lot 12 & 13, Jalan BK 1/11, Taman Perindustrian Bandar Kinrara, Bandar Kinrara 1, 47180 Puchong, Selangor',
  COMPANY_PHONE: '03-8082 3388 / 012-6273 3524', SST_NO: '',
  INVOICE_PREFIX: 'HG-INV', INVOICE_SEQ: '0', INVOICE_TERMS_DAYS: '30',
  JOB_PREFIX: 'JOB-', JOB_SEQ: '0'
};

const SERVICE_TYPES = ['Aluminium', 'Customized', 'GreenTag'];
const ACTIVE_STATUSES = ['Active', 'Extension'];                       // scaffold is onsite — green tag + collection run
const OPEN_STATUSES = ['Quote', 'Active', 'Extension', 'OnHold'];      // not yet closed
const TERMINAL_STATUSES = ['Completed', 'Cancelled'];

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
    .setTitle('HG — Scaffold & Green Tag')
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
  const today = todayISO_();

  const engagements = readSheet_(SHEETS.ENGAGEMENTS).map(normEngagement_);
  const charges = readSheet_(SHEETS.CHARGES).map(normCharge_);
  const materials = readSheet_(SHEETS.MATERIALS).map(normMaterial_);
  const inspections = readSheet_(SHEETS.INSPECTIONS).map(normInspection_);
  const invoices = readSheet_(SHEETS.INVOICES).map(normInvoice_);
  const payments = readSheet_(SHEETS.PAYMENTS).map(normPayment_);
  const personnel = readSheet_(SHEETS.PERSONNEL).map(normPerson_);

  // index helpers
  const chByEng = groupBy_(charges, 'engagementId');
  const matByEng = groupBy_(materials, 'engagementId');
  const insByEng = groupBy_(inspections, 'engagementId');

  // invoice rollups
  const payByInv = {};
  payments.forEach(function (p) { payByInv[p.invoiceId] = (payByInv[p.invoiceId] || 0) + p.amount; });
  invoices.forEach(function (inv) {
    inv.amountPaid = round2_(payByInv[inv.id] || 0);
    inv.balance = round2_(inv.total - inv.amountPaid);
    inv.payStatus = computeInvStatus_(inv);
    inv.overdue = inv.balance > 0.005 && inv.payStatus !== 'Void' && inv.dueDate && inv.dueDate < today;
  });

  // per-engagement derived facts
  engagements.forEach(function (e) {
    const ch = chByEng[e.id] || [];
    const mt = matByEng[e.id] || [];
    const ins = (insByEng[e.id] || []).slice().sort(function (a, b) { return (a.inspectDate || '').localeCompare(b.inspectDate || ''); });
    e.chargeTotal = round2_(ch.reduce(function (s, c) { return s + c.amount; }, 0));
    e.uninvoiced = round2_(ch.filter(function (c) { return !c.invoiceId; }).reduce(function (s, c) { return s + c.amount; }, 0));
    e.materialOut = mt.reduce(function (s, m) { return s + Math.max(0, m.qtyOut - m.qtyReturned); }, 0);
    e.materialShortfall = e.status === 'Completed' ? e.materialOut : 0;
    // items still deployed onsite (what to collect back)
    e.itemsOut = mt.filter(function (m) { return m.qtyOut > m.qtyReturned; })
      .map(function (m) { return { code: m.code, item: m.item, spec: m.spec, unit: m.unit, outQty: m.qtyOut - m.qtyReturned }; });
    e.collectionDue = computeCollectionDue_(e, today);
    e.lastInspection = ins.length ? ins[ins.length - 1].inspectDate : '';
    e.lastResult = ins.length ? ins[ins.length - 1].result : '';
    e.inspectionCount = ins.length;
    e.greenTagDue = computeGreenTagDue_(e, today);
  });

  // certs: live status
  const certWarn = Number(cfg.CERT_EXPIRY_WARN_DAYS) || 45;
  personnel.forEach(function (p) {
    p.daysToExpiry = p.expiryDate ? daysBetween_(today, p.expiryDate) : null;
    p.certStatus = !p.expiryDate ? 'Open' : (p.daysToExpiry < 0 ? 'Expired' : (p.daysToExpiry <= certWarn ? 'Expiring' : 'Valid'));
  });

  return {
    currentUser: requireDomain_(),
    serverTime: nowIso_(),
    today: today,
    sstRate: sstRate_(),
    config: cfg,
    engagements: engagements,
    charges: charges,
    materials: materials,
    inspections: inspections,
    invoices: invoices,
    payments: payments,
    personnel: personnel,
    catalogue: readSheet_(SHEETS.CATALOGUE),
    stats: buildStats_(engagements, invoices, personnel, charges, today, cfg),
    alerts: buildAlerts_(engagements, invoices, personnel, today, cfg)
  };
}

/* collection due = active job with material still onsite, vs its rental return date (expectedEndDate).
   Returns {applies, days, due, overdue, noDate}. days = days until return (neg = overdue for collection). */
function computeCollectionDue_(e, today) {
  if (ACTIVE_STATUSES.indexOf(e.status) < 0 || !(e.materialOut > 0)) return { applies: false };
  if (!e.expectedEndDate) return { applies: true, days: null, due: '', noDate: true };
  const days = daysBetween_(today, e.expectedEndDate);
  return { applies: true, days: days, due: e.expectedEndDate, overdue: days < 0 };
}

/* green tag due = days since last inspection (or start) vs interval.
   Returns {applies, due, days, overdue} where days = days until next due (neg = overdue). */
function computeGreenTagDue_(e, today) {
  const wantsGreenTag = e.greenTag === 'Yes' || e.serviceType === 'GreenTag';
  if (!wantsGreenTag || ACTIVE_STATUSES.indexOf(e.status) < 0) return { applies: false };
  const interval = Number(e.inspectIntervalDays) || 7;
  const anchor = e.lastInspection || e.startDate;
  if (!anchor) return { applies: true, due: today, days: 0, overdue: false, never: true };
  const nextDue = addDays_(anchor, interval);
  const days = daysBetween_(today, nextDue);
  return { applies: true, due: nextDue, days: days, overdue: days < 0, never: !e.lastInspection };
}

function buildStats_(engagements, invoices, personnel, charges, today, cfg) {
  const active = engagements.filter(function (e) { return ACTIVE_STATUSES.indexOf(e.status) >= 0; }).length;
  const quotes = engagements.filter(function (e) { return e.status === 'Quote'; }).length;
  const onHold = engagements.filter(function (e) { return e.status === 'OnHold'; }).length;
  const dueSoonCollect = Number(cfg.COLLECTION_DUE_SOON_DAYS) || 7;
  let greenDue = 0, materialsOut = 0, itemsDeployed = 0, collectionDue = 0;
  engagements.forEach(function (e) {
    if (e.greenTagDue && e.greenTagDue.applies && e.greenTagDue.days <= 0) greenDue++;
    if (ACTIVE_STATUSES.indexOf(e.status) >= 0 && e.materialOut > 0) { materialsOut++; itemsDeployed += e.materialOut; }
    const c = e.collectionDue;
    if (c && c.applies && !c.noDate && c.days <= dueSoonCollect) collectionDue++;
  });

  let outstanding = 0, overdueAmt = 0, overdueCount = 0;
  invoices.forEach(function (inv) {
    if (inv.payStatus === 'Void') return;
    outstanding += inv.balance;
    if (inv.overdue) { overdueAmt += inv.balance; overdueCount++; }
  });

  const ym = today.slice(0, 7);
  let collected = 0;
  readSheet_(SHEETS.PAYMENTS).map(normPayment_).forEach(function (p) {
    if ((p.payDate || '').slice(0, 7) === ym) collected += p.amount;
  });

  const certExpiring = personnel.filter(function (p) { return p.certStatus === 'Expiring' || p.certStatus === 'Expired'; }).length;

  // revenue this month, by service, from charges on invoices dated this month
  const invMonth = {};
  invoices.forEach(function (i) { if ((i.invDate || '').slice(0, 7) === ym && i.status !== 'Void') invMonth[i.id] = true; });
  let billedThisMonth = 0;
  invoices.forEach(function (i) { if (invMonth[i.id]) billedThisMonth += i.total; });

  return {
    activeJobs: active, quotes: quotes, onHold: onHold, greenTagDue: greenDue, materialsOut: materialsOut,
    itemsDeployed: itemsDeployed, collectionDue: collectionDue,
    outstanding: round2_(outstanding), overdueAmt: round2_(overdueAmt), overdueCount: overdueCount,
    collectedThisMonth: round2_(collected), billedThisMonth: round2_(billedThisMonth),
    certExpiring: certExpiring, totalJobs: engagements.length
  };
}

function buildAlerts_(engagements, invoices, personnel, today, cfg) {
  const out = [];
  const dueSoonCollect = Number(cfg.COLLECTION_DUE_SOON_DAYS) || 7;
  engagements.forEach(function (e) {
    const g = e.greenTagDue;
    if (g && g.applies && g.days <= (Number(cfg.GREENTAG_DUE_SOON_DAYS) || 2)) {
      out.push({ kind: 'greentag', level: g.days < 0 ? 'expired' : 'expiring', id: e.id,
        who: e.jobNo + ' · ' + e.clientCompany + (e.siteName ? ' · ' + e.siteName : ''),
        days: g.days, msg: g.never ? 'first green tag due' : (g.days < 0 ? 'green tag OVERDUE ' + (-g.days) + 'd' : 'green tag due in ' + g.days + 'd') });
    }
    // collection of deployed scaffold material vs rental return date
    const c = e.collectionDue;
    if (c && c.applies && !c.noDate && c.days <= dueSoonCollect) {
      const items = (e.itemsOut || []).reduce(function (s, x) { return s + x.outQty; }, 0);
      out.push({ kind: 'collection', level: c.days < 0 ? 'expired' : 'expiring', id: e.id,
        who: e.jobNo + ' · ' + e.clientCompany + (e.siteName ? ' · ' + e.siteName : ''),
        days: c.days, msg: (c.days < 0 ? 'collect back OVERDUE ' + (-c.days) + 'd' : (c.days === 0 ? 'collect back TODAY' : 'collect back in ' + c.days + 'd')) + ' · ' + items + ' item(s)' });
    } else if (ACTIVE_STATUSES.indexOf(e.status) >= 0 && e.expectedEndDate && e.materialOut <= 0) {
      const d = daysBetween_(today, e.expectedEndDate);
      if (d < 0) out.push({ kind: 'job', level: 'expired', id: e.id, who: e.jobNo + ' · ' + e.clientCompany, days: d, msg: 'past return date ' + (-d) + 'd — close / extend' });
    }
    if (e.status === 'Completed' && e.materialOut > 0) {
      out.push({ kind: 'material', level: 'expired', id: e.id, who: e.jobNo + ' · ' + e.clientCompany, days: -1, msg: e.materialOut + ' item(s) not returned' });
    }
  });
  invoices.forEach(function (inv) {
    if (inv.payStatus === 'Void' || inv.balance <= 0.005 || !inv.dueDate) return;
    const d = daysBetween_(today, inv.dueDate);
    const dueSoon = Number(cfg.INVOICE_DUE_SOON_DAYS) || 5;
    if (d < 0) out.push({ kind: 'invoice', level: 'expired', id: inv.id, who: inv.invNo + ' · ' + inv.clientCompany, days: d, msg: 'overdue ' + (-d) + 'd · RM ' + money_(inv.balance) });
    else if (d <= dueSoon) out.push({ kind: 'invoice', level: 'expiring', id: inv.id, who: inv.invNo + ' · ' + inv.clientCompany, days: d, msg: 'due in ' + d + 'd · RM ' + money_(inv.balance) });
  });
  personnel.forEach(function (p) {
    if (p.certStatus === 'Expiring') out.push({ kind: 'cert', level: 'expiring', id: p.id, who: p.name + ' · ' + p.certType, days: p.daysToExpiry, msg: 'cert expires in ' + p.daysToExpiry + 'd' });
    else if (p.certStatus === 'Expired') out.push({ kind: 'cert', level: 'expired', id: p.id, who: p.name + ' · ' + p.certType, days: p.daysToExpiry, msg: 'cert EXPIRED ' + (-p.daysToExpiry) + 'd ago' });
  });
  out.sort(function (a, b) { return a.days - b.days; });
  return out;
}

/* ===================== NORMALISERS ===================== */
function normEngagement_(e) {
  return {
    id: str_(e.id), jobNo: str_(e.jobNo), serviceType: str_(e.serviceType) || 'Aluminium',
    scope: str_(e.scope) || 'Full', status: str_(e.status) || 'Active',
    clientCompany: str_(e.clientCompany), clientPIC: str_(e.clientPIC), clientContact: str_(e.clientContact),
    clientEmail: str_(e.clientEmail), clientAddress: str_(e.clientAddress),
    siteName: str_(e.siteName), siteAddress: str_(e.siteAddress), scaffoldDesc: str_(e.scaffoldDesc),
    thirdParty: str_(e.thirdParty), peNo: str_(e.peNo), peEndorsedBy: str_(e.peEndorsedBy), peEndorsedDate: dateStr_(e.peEndorsedDate),
    startDate: dateStr_(e.startDate), expectedEndDate: dateStr_(e.expectedEndDate), actualReturnDate: dateStr_(e.actualReturnDate),
    greenTag: str_(e.greenTag) || 'No', inspectIntervalDays: num_(e.inspectIntervalDays) || 7, assignedInspector: str_(e.assignedInspector),
    deliverySignName: str_(e.deliverySignName), deliverySignDate: dateStr_(e.deliverySignDate), deliverySignUrl: str_(e.deliverySignUrl),
    returnSignName: str_(e.returnSignName), returnSignDate: dateStr_(e.returnSignDate), returnSignUrl: str_(e.returnSignUrl),
    photosSite: str_(e.photosSite), photosBefore: str_(e.photosBefore), photosAfter: str_(e.photosAfter),
    photosCollection: str_(e.photosCollection), photosDefect: str_(e.photosDefect),
    handledBy: str_(e.handledBy), remarks: str_(e.remarks),
    createdBy: str_(e.createdBy), createdAt: str_(e.createdAt), updatedBy: str_(e.updatedBy), updatedAt: str_(e.updatedAt)
  };
}
function normCharge_(c) {
  return { id: str_(c.id), engagementId: str_(c.engagementId), type: str_(c.type) || 'Other', description: str_(c.description),
    qty: num_(c.qty), unit: str_(c.unit), rate: num_(c.rate), basis: str_(c.basis), amount: num_(c.amount),
    invoiceId: str_(c.invoiceId), createdBy: str_(c.createdBy), createdAt: str_(c.createdAt) };
}
function normMaterial_(m) {
  return { id: str_(m.id), engagementId: str_(m.engagementId), code: str_(m.code), item: str_(m.item), spec: str_(m.spec), category: str_(m.category),
    unit: str_(m.unit) || 'pcs', qtyOut: num_(m.qtyOut), qtyReturned: num_(m.qtyReturned),
    damageQty: num_(m.damageQty), damageCharge: num_(m.damageCharge), remarks: str_(m.remarks), updatedBy: str_(m.updatedBy) };
}
function normInspection_(i) {
  return { id: str_(i.id), engagementId: str_(i.engagementId), inspectDate: dateStr_(i.inspectDate), inspector: str_(i.inspector),
    inspectorCertNo: str_(i.inspectorCertNo), result: str_(i.result) || 'Green', tagNo: str_(i.tagNo),
    nextDueDate: dateStr_(i.nextDueDate), findings: str_(i.findings), photosUrl: str_(i.photosUrl), certUrl: str_(i.certUrl),
    createdBy: str_(i.createdBy), createdAt: str_(i.createdAt) };
}
function normInvoice_(i) {
  return { id: str_(i.id), invNo: str_(i.invNo), engagementId: str_(i.engagementId), clientCompany: str_(i.clientCompany),
    invDate: dateStr_(i.invDate), dueDate: dateStr_(i.dueDate), description: str_(i.description),
    amount: num_(i.amount), sstEnabled: bool_(i.sstEnabled), sstAmount: num_(i.sstAmount), total: num_(i.total),
    status: str_(i.status), fileUrl: str_(i.fileUrl), fileId: str_(i.fileId), notes: str_(i.notes),
    createdBy: str_(i.createdBy), createdAt: str_(i.createdAt) };
}
function normPayment_(p) {
  return { id: str_(p.id), invoiceId: str_(p.invoiceId), payDate: dateStr_(p.payDate), amount: num_(p.amount),
    method: str_(p.method), reference: str_(p.reference), receivedBy: str_(p.receivedBy), notes: str_(p.notes) };
}
function normPerson_(p) {
  return { id: str_(p.id), name: str_(p.name), role: str_(p.role), certType: str_(p.certType), certNo: str_(p.certNo),
    issuedDate: dateStr_(p.issuedDate), expiryDate: dateStr_(p.expiryDate), contact: str_(p.contact), remarks: str_(p.remarks) };
}
function computeInvStatus_(inv) {
  if (inv.status === 'Void') return 'Void';
  if (inv.total <= 0) return 'Unpaid';
  if (inv.balance <= 0.005) return 'Paid';
  if (inv.amountPaid > 0.005) return 'Partial';
  return 'Unpaid';
}

/* ===================== ENGAGEMENTS ===================== */
function saveEngagement(p) {
  const user = requireDomain_();
  const now = nowIso_();
  if (!p.clientCompany) throw new Error('Client company is required.');
  if (SERVICE_TYPES.indexOf(p.serviceType) < 0) throw new Error('Pick a service type.');
  if (p.serviceType === 'GreenTag') p.scope = 'EndorseOnly';
  if (!p.startDate) throw new Error('Start / delivery date is required.');
  if (p.expectedEndDate && p.expectedEndDate < p.startDate) throw new Error('Expected end date is before start date.');

  const existing = p.id ? readSheet_(SHEETS.ENGAGEMENTS).map(normEngagement_).filter(function (x) { return x.id === p.id; })[0] : null;
  if (p.id && !existing) throw new Error('Job not found.');

  // photos by category — keep existing, append new uploads (never wipe a category not in the form)
  const photoFields = ['photosSite','photosBefore','photosAfter','photosCollection','photosDefect'];
  const photoData = {};
  photoFields.forEach(function (f) {
    photoData[f] = (p[f] !== undefined && p[f] !== null && p[f] !== '') ? p[f] : (existing ? existing[f] : '');
  });
  if (p.photoUploads) {
    Object.keys(p.photoUploads).forEach(function (cat) {
      const arr = p.photoUploads[cat];
      if (!arr || !arr.length) return;
      const field = 'photos' + cat.charAt(0).toUpperCase() + cat.slice(1);
      if (photoFields.indexOf(field) < 0) return;
      const urls = uploadPhotos_((p.jobNo || existing && existing.jobNo || 'job') + '-' + cat, arr);
      photoData[field] = [photoData[field]].concat(urls).filter(Boolean).join(', ');
    });
  }

  if (p.id) {
    const ex = existing;
    const rec = mergeEngagement_(ex, p, photoData);
    rec.updatedBy = user; rec.updatedAt = now;
    updateRecord_(SHEETS.ENGAGEMENTS, toEngagementRow_(rec));
    logAudit_('UPDATE', 'Engagement', rec.jobNo, p.clientCompany + ' / ' + p.serviceType);
    return bootstrap();
  }

  const id = uid_();
  const rec = mergeEngagement_({}, p, photoData);
  rec.id = id;
  rec.jobNo = p.jobNo || nextJobNo_();
  rec.status = p.status || (p.serviceType === 'GreenTag' ? 'Active' : 'Active');
  rec.handledBy = p.handledBy || user;
  rec.createdBy = user; rec.createdAt = now; rec.updatedBy = user; rec.updatedAt = now;
  appendRecord_(SHEETS.ENGAGEMENTS, toEngagementRow_(rec));
  logAudit_('CREATE', 'Engagement', rec.jobNo, p.clientCompany + ' / ' + p.serviceType + ' / ' + (p.siteName || '-'));
  return bootstrap();
}
function mergeEngagement_(ex, p, photoData) {
  const r = Object.assign({}, ex);
  ['jobNo','serviceType','scope','status','clientCompany','clientPIC','clientContact','clientEmail','clientAddress',
   'siteName','siteAddress','scaffoldDesc','thirdParty','peNo','peEndorsedBy','peEndorsedDate',
   'startDate','expectedEndDate','actualReturnDate','greenTag','assignedInspector',
   'deliverySignName','deliverySignDate','returnSignName','returnSignDate','handledBy','remarks']
    .forEach(function (k) { if (p[k] !== undefined) r[k] = p[k]; });
  if (p.inspectIntervalDays !== undefined) r.inspectIntervalDays = num_(p.inspectIntervalDays) || 7;
  ['photosSite','photosBefore','photosAfter','photosCollection','photosDefect'].forEach(function (f) { r[f] = photoData[f]; });
  if (p.deliverySignUrl !== undefined) r.deliverySignUrl = p.deliverySignUrl;
  if (p.returnSignUrl !== undefined) r.returnSignUrl = p.returnSignUrl;
  return r;
}
function toEngagementRow_(r) {
  const o = {};
  HEADERS.Engagements.forEach(function (h) {
    o[h] = r[h] === undefined ? '' : (typeof r[h] === 'number' ? r[h] : r[h]);
  });
  o.inspectIntervalDays = num_(r.inspectIntervalDays) || 7;
  return o;
}
function setEngagementStatus(id, status, remark) {
  requireDomain_();
  const e = readSheet_(SHEETS.ENGAGEMENTS).map(normEngagement_).filter(function (x) { return x.id === id; })[0];
  if (!e) throw new Error('Job not found.');
  if (TERMINAL_STATUSES.indexOf(status) < 0 && OPEN_STATUSES.indexOf(status) < 0) throw new Error('Bad status.');
  e.status = status;
  if (status === 'Completed' && !e.actualReturnDate) e.actualReturnDate = todayISO_();
  if (remark) e.remarks = (e.remarks ? e.remarks + ' | ' : '') + remark;
  e.updatedBy = requireDomain_(); e.updatedAt = nowIso_();
  updateRecord_(SHEETS.ENGAGEMENTS, toEngagementRow_(e));
  logAudit_('STATUS', 'Engagement', e.jobNo, status + (remark ? ' :: ' + remark : ''));
  return bootstrap();
}
function deleteEngagement(id) {
  requireDomain_();
  const e = readSheet_(SHEETS.ENGAGEMENTS).map(normEngagement_).filter(function (x) { return x.id === id; })[0];
  const invs = readSheet_(SHEETS.INVOICES).map(normInvoice_).filter(function (i) { return i.engagementId === id; });
  if (invs.length) throw new Error('This job has ' + invs.length + ' invoice(s). Delete/void those first.');
  deleteRowsWhere_(SHEETS.CHARGES, 2, [id]);
  deleteRowsWhere_(SHEETS.MATERIALS, 2, [id]);
  deleteRowsWhere_(SHEETS.INSPECTIONS, 2, [id]);
  deleteRowsWhere_(SHEETS.ENGAGEMENTS, 1, [id]);
  logAudit_('DELETE', 'Engagement', e ? e.jobNo : id, '');
  return bootstrap();
}
function saveSignoff(p) {
  requireDomain_();
  const e = readSheet_(SHEETS.ENGAGEMENTS).map(normEngagement_).filter(function (x) { return x.id === p.id; })[0];
  if (!e) throw new Error('Job not found.');
  const which = p.which === 'return' ? 'return' : 'delivery';
  let url = '';
  if (p.signFile && p.signFile.base64) url = uploadFile_(SUBFOLDERS.SIGNOFF, e.jobNo + '-' + which + '-signoff', p.signFile).url;
  if (which === 'delivery') {
    e.deliverySignName = p.name || e.deliverySignName;
    e.deliverySignDate = p.date || todayISO_();
    if (url) e.deliverySignUrl = url;
  } else {
    e.returnSignName = p.name || e.returnSignName;
    e.returnSignDate = p.date || todayISO_();
    if (url) e.returnSignUrl = url;
  }
  e.updatedBy = requireDomain_(); e.updatedAt = nowIso_();
  updateRecord_(SHEETS.ENGAGEMENTS, toEngagementRow_(e));
  logAudit_('SIGNOFF', 'Engagement', e.jobNo, which + ' signed by ' + (p.name || '-'));
  return bootstrap();
}

/* ===================== CHARGES ===================== */
function saveCharge(p) {
  const user = requireDomain_();
  if (!p.engagementId) throw new Error('Job is required.');
  if (!p.type) throw new Error('Charge type is required.');
  const qty = num_(p.qty) || 1;
  const rate = num_(p.rate);
  const amount = p.amount !== undefined && p.amount !== '' ? round2_(num_(p.amount)) : round2_(qty * rate);
  if (p.id) {
    const ex = readSheet_(SHEETS.CHARGES).map(normCharge_).filter(function (c) { return c.id === p.id; })[0];
    if (!ex) throw new Error('Charge not found.');
    if (ex.invoiceId) throw new Error('This charge is already invoiced — edit/void the invoice instead.');
    const rec = { id: p.id, engagementId: ex.engagementId, type: p.type, description: p.description || '',
      qty: qty, unit: p.unit || '', rate: rate, basis: p.basis || '', amount: amount,
      invoiceId: '', createdAt: ex.createdAt, createdBy: ex.createdBy };
    updateRecord_(SHEETS.CHARGES, rec);
    logAudit_('UPDATE', 'Charge', p.engagementId, p.type + ' / RM ' + money_(amount));
  } else {
    const rec = { id: uid_(), engagementId: p.engagementId, type: p.type, description: p.description || '',
      qty: qty, unit: p.unit || '', rate: rate, basis: p.basis || '', amount: amount,
      invoiceId: '', createdAt: nowIso_(), createdBy: user };
    appendRecord_(SHEETS.CHARGES, rec);
    logAudit_('CREATE', 'Charge', p.engagementId, p.type + ' / RM ' + money_(amount));
  }
  return bootstrap();
}
function deleteCharge(id) {
  requireDomain_();
  const ex = readSheet_(SHEETS.CHARGES).map(normCharge_).filter(function (c) { return c.id === id; })[0];
  if (ex && ex.invoiceId) throw new Error('Charge is invoiced — cannot delete.');
  deleteRowsWhere_(SHEETS.CHARGES, 1, [id]);
  logAudit_('DELETE', 'Charge', id, '');
  return bootstrap();
}

/* ===================== MATERIALS ===================== */
function saveMaterial(p) {
  const user = requireDomain_();
  if (!p.engagementId) throw new Error('Job is required.');
  if (!p.item) throw new Error('Item is required.');
  if (p.id) {
    const ex = readSheet_(SHEETS.MATERIALS).map(normMaterial_).filter(function (m) { return m.id === p.id; })[0];
    if (!ex) throw new Error('Material row not found.');
    const rec = { id: p.id, engagementId: ex.engagementId, code: p.code !== undefined ? p.code : ex.code, item: p.item,
      spec: p.spec !== undefined ? p.spec : ex.spec, category: p.category || ex.category, unit: p.unit || ex.unit || 'pcs',
      qtyOut: num_(p.qtyOut), qtyReturned: num_(p.qtyReturned), damageQty: num_(p.damageQty), damageCharge: num_(p.damageCharge),
      remarks: p.remarks || '', updatedAt: nowIso_(), updatedBy: user };
    updateRecord_(SHEETS.MATERIALS, rec);
    logAudit_('UPDATE', 'Material', p.engagementId, p.item + ' out ' + rec.qtyOut + ' / back ' + rec.qtyReturned);
  } else {
    const rec = { id: uid_(), engagementId: p.engagementId, code: p.code || '', item: p.item, spec: p.spec || '', category: p.category || '', unit: p.unit || 'pcs',
      qtyOut: num_(p.qtyOut), qtyReturned: num_(p.qtyReturned), damageQty: num_(p.damageQty), damageCharge: num_(p.damageCharge),
      remarks: p.remarks || '', updatedAt: nowIso_(), updatedBy: user };
    appendRecord_(SHEETS.MATERIALS, rec);
    logAudit_('CREATE', 'Material', p.engagementId, p.item + ' x' + rec.qtyOut);
  }
  return bootstrap();
}
/** Bulk add several catalogue items at once when kitting out a job. */
function addMaterials(engagementId, items) {
  const user = requireDomain_();
  if (!engagementId) throw new Error('Job is required.');
  (items || []).forEach(function (it) {
    if (!it.item) return;
    appendRecord_(SHEETS.MATERIALS, { id: uid_(), engagementId: engagementId, code: it.code || '', item: it.item, spec: it.spec || '', category: it.category || '',
      unit: it.unit || 'pcs', qtyOut: num_(it.qtyOut), qtyReturned: 0, damageQty: 0, damageCharge: 0,
      remarks: '', updatedAt: nowIso_(), updatedBy: user });
  });
  logAudit_('CREATE', 'Material', engagementId, (items || []).length + ' item(s) kitted out');
  return bootstrap();
}
/** Mark everything returned in one click (sets qtyReturned = qtyOut where blank). */
function returnAllMaterials(engagementId) {
  const user = requireDomain_();
  const rows = readSheet_(SHEETS.MATERIALS).map(normMaterial_).filter(function (m) { return m.engagementId === engagementId; });
  rows.forEach(function (m) {
    if (m.qtyReturned < m.qtyOut) {
      m.qtyReturned = m.qtyOut; m.updatedAt = nowIso_(); m.updatedBy = user;
      updateRecord_(SHEETS.MATERIALS, m);
    }
  });
  logAudit_('RETURN_ALL', 'Material', engagementId, rows.length + ' item(s) marked returned');
  return bootstrap();
}
function deleteMaterial(id) {
  requireDomain_();
  deleteRowsWhere_(SHEETS.MATERIALS, 1, [id]);
  logAudit_('DELETE', 'Material', id, '');
  return bootstrap();
}

/* ===================== INSPECTIONS (GREEN TAG) ===================== */
function saveInspection(p) {
  const user = requireDomain_();
  if (!p.engagementId) throw new Error('Job is required.');
  if (!p.inspectDate) throw new Error('Inspection date is required.');
  if (!p.inspector) throw new Error('Inspector name is required.');
  const e = readSheet_(SHEETS.ENGAGEMENTS).map(normEngagement_).filter(function (x) { return x.id === p.engagementId; })[0];
  const interval = e ? (Number(e.inspectIntervalDays) || 7) : 7;
  const nextDue = p.nextDueDate || addDays_(p.inspectDate, interval);

  let photosUrl = p.photosUrl || '';
  if (p.photoFiles && p.photoFiles.length) {
    const urls = uploadPhotos_('inspect-' + (e ? e.jobNo : p.engagementId) + '-' + p.inspectDate, p.photoFiles);
    photosUrl = [photosUrl].concat(urls).filter(Boolean).join(', ');
  }
  let certUrl = p.certUrl || '';
  if (p.certFile && p.certFile.base64) certUrl = uploadFile_(SUBFOLDERS.CERTS, (e ? e.jobNo : '') + '-greentag-' + p.inspectDate, p.certFile).url;

  if (p.id) {
    const ex = readSheet_(SHEETS.INSPECTIONS).map(normInspection_).filter(function (i) { return i.id === p.id; })[0];
    if (!ex) throw new Error('Inspection not found.');
    const rec = { id: p.id, engagementId: ex.engagementId, inspectDate: p.inspectDate, inspector: p.inspector,
      inspectorCertNo: p.inspectorCertNo || '', result: p.result || 'Green', tagNo: p.tagNo || '', nextDueDate: nextDue,
      findings: p.findings || '', photosUrl: photosUrl, certUrl: certUrl || ex.certUrl, createdAt: ex.createdAt, createdBy: ex.createdBy };
    updateRecord_(SHEETS.INSPECTIONS, rec);
    logAudit_('UPDATE', 'Inspection', e ? e.jobNo : p.engagementId, p.result + ' @ ' + p.inspectDate);
  } else {
    const rec = { id: uid_(), engagementId: p.engagementId, inspectDate: p.inspectDate, inspector: p.inspector,
      inspectorCertNo: p.inspectorCertNo || '', result: p.result || 'Green', tagNo: p.tagNo || '', nextDueDate: nextDue,
      findings: p.findings || '', photosUrl: photosUrl, certUrl: certUrl, createdAt: nowIso_(), createdBy: user };
    appendRecord_(SHEETS.INSPECTIONS, rec);
    logAudit_('CREATE', 'Inspection', e ? e.jobNo : p.engagementId, p.result + ' @ ' + p.inspectDate + ' by ' + p.inspector);
  }
  return bootstrap();
}
function deleteInspection(id) {
  requireDomain_();
  deleteRowsWhere_(SHEETS.INSPECTIONS, 1, [id]);
  logAudit_('DELETE', 'Inspection', id, '');
  return bootstrap();
}

/* ===================== INVOICES ===================== */
function saveInvoice(p) {
  const user = requireDomain_();
  const now = nowIso_();
  if (!p.invNo) throw new Error('Invoice number is required.');
  if (!p.clientCompany) throw new Error('Client is required.');
  if (!p.invDate) throw new Error('Invoice date is required.');
  const amount = round2_(num_(p.amount));
  const sstEnabled = bool_(p.sstEnabled);
  const sstAmount = sstEnabled ? round2_(amount * sstRate_()) : 0;
  const total = round2_(amount + sstAmount);

  const dup = readSheet_(SHEETS.INVOICES).map(normInvoice_).filter(function (i) {
    return i.invNo.toLowerCase() === String(p.invNo).toLowerCase() && i.id !== p.id;
  });
  if (dup.length) throw new Error('Invoice number ' + p.invNo + ' already exists.');

  let fileUrl = p.fileUrl || '', fileId = p.fileId || '';
  if (p.file && p.file.base64) { const f = uploadFile_(SUBFOLDERS.INVOICES, p.invNo, p.file); fileUrl = f.url; fileId = f.id; }

  const base = { invNo: String(p.invNo).trim(), engagementId: p.engagementId || '', clientCompany: p.clientCompany,
    invDate: p.invDate, dueDate: p.dueDate || '', description: p.description || '',
    amount: amount, sstEnabled: sstEnabled, sstAmount: sstAmount, total: total,
    status: p.status === 'Void' ? 'Void' : '', fileUrl: fileUrl, fileId: fileId, notes: p.notes || '' };

  if (p.id) {
    const ex = readSheet_(SHEETS.INVOICES).map(normInvoice_).filter(function (i) { return i.id === p.id; })[0];
    if (!ex) throw new Error('Invoice not found.');
    base.id = p.id; base.createdAt = ex.createdAt; base.createdBy = ex.createdBy; base.updatedAt = now;
    updateRecord_(SHEETS.INVOICES, base);
    logAudit_('UPDATE', 'Invoice', p.invNo, p.clientCompany + ' / RM ' + money_(total));
  } else {
    base.id = uid_(); base.createdAt = now; base.createdBy = user; base.updatedAt = now;
    appendRecord_(SHEETS.INVOICES, base);
    logAudit_('CREATE', 'Invoice', p.invNo, p.clientCompany + ' / RM ' + money_(total));
  }
  return bootstrap();
}
/** Build an invoice from all uninvoiced charges on a job, then stamp them. */
function invoiceFromCharges(p) {
  const user = requireDomain_();
  const e = readSheet_(SHEETS.ENGAGEMENTS).map(normEngagement_).filter(function (x) { return x.id === p.engagementId; })[0];
  if (!e) throw new Error('Job not found.');
  const charges = readSheet_(SHEETS.CHARGES).map(normCharge_).filter(function (c) { return c.engagementId === e.id && !c.invoiceId; });
  if (!charges.length) throw new Error('No uninvoiced charges on this job.');
  const amount = round2_(charges.reduce(function (s, c) { return s + c.amount; }, 0));
  const sstEnabled = p.sstEnabled === undefined ? true : bool_(p.sstEnabled);
  const sstAmount = sstEnabled ? round2_(amount * sstRate_()) : 0;
  const total = round2_(amount + sstAmount);
  const cfg = getConfig_();
  const invDate = p.invDate || todayISO_();
  const dueDate = p.dueDate || addDays_(invDate, Number(cfg.INVOICE_TERMS_DAYS) || 30);
  const desc = charges.map(function (c) { return labelChargeType_(c.type) + (c.description ? ' (' + c.description + ')' : '') + ' — RM ' + money_(c.amount); }).join('\n');
  const id = uid_();
  const invNo = p.invNo || nextInvoiceNo_();
  appendRecord_(SHEETS.INVOICES, { id: id, invNo: invNo, engagementId: e.id, clientCompany: e.clientCompany,
    invDate: invDate, dueDate: dueDate, description: desc, amount: amount, sstEnabled: sstEnabled, sstAmount: sstAmount,
    total: total, status: '', fileUrl: '', fileId: '', notes: 'From ' + charges.length + ' charge line(s) · Job ' + e.jobNo,
    createdAt: nowIso_(), createdBy: user, updatedAt: nowIso_() });
  // stamp charges
  charges.forEach(function (c) { c.invoiceId = id; updateRecord_(SHEETS.CHARGES, c); });
  logAudit_('CREATE', 'Invoice', invNo, e.clientCompany + ' / Job ' + e.jobNo + ' / RM ' + money_(total));
  return bootstrap();
}
function voidInvoice(id, remarks) {
  requireDomain_();
  const ex = readSheet_(SHEETS.INVOICES).map(normInvoice_).filter(function (i) { return i.id === id; })[0];
  if (!ex) throw new Error('Invoice not found.');
  const paid = readSheet_(SHEETS.PAYMENTS).map(normPayment_).filter(function (p) { return p.invoiceId === id; });
  if (paid.length) throw new Error('Invoice has payments recorded — remove payments before voiding.');
  ex.status = 'Void'; ex.notes = (ex.notes ? ex.notes + ' | ' : '') + 'VOID: ' + (remarks || '');
  updateRecord_(SHEETS.INVOICES, ex);
  // release its charges
  readSheet_(SHEETS.CHARGES).map(normCharge_).filter(function (c) { return c.invoiceId === id; })
    .forEach(function (c) { c.invoiceId = ''; updateRecord_(SHEETS.CHARGES, c); });
  logAudit_('VOID', 'Invoice', ex.invNo, remarks || '');
  return bootstrap();
}
function deleteInvoice(id) {
  requireDomain_();
  deleteRowsWhere_(SHEETS.PAYMENTS, 2, [id]);
  readSheet_(SHEETS.CHARGES).map(normCharge_).filter(function (c) { return c.invoiceId === id; })
    .forEach(function (c) { c.invoiceId = ''; updateRecord_(SHEETS.CHARGES, c); });
  deleteRowsWhere_(SHEETS.INVOICES, 1, [id]);
  logAudit_('DELETE', 'Invoice', id, '');
  return bootstrap();
}

/* ===================== PAYMENTS ===================== */
function recordPayment(p) {
  const user = requireDomain_();
  if (!p.invoiceId) throw new Error('Invoice is required.');
  if (!(num_(p.amount) > 0)) throw new Error('Payment amount must be greater than 0.');
  const inv = readSheet_(SHEETS.INVOICES).map(normInvoice_).filter(function (i) { return i.id === p.invoiceId; })[0];
  if (!inv) throw new Error('Invoice not found.');
  const rec = { id: uid_(), invoiceId: p.invoiceId, payDate: p.payDate || todayISO_(), amount: round2_(num_(p.amount)),
    method: p.method || '', reference: p.reference || '', receivedBy: p.receivedBy || user, notes: p.notes || '', createdAt: nowIso_() };
  appendRecord_(SHEETS.PAYMENTS, rec);
  logAudit_('PAYMENT', 'Invoice', inv.invNo, 'RM ' + money_(rec.amount) + ' (' + (rec.method || 'n/a') + ')');
  return bootstrap();
}
function deletePayment(id) {
  requireDomain_();
  deleteRowsWhere_(SHEETS.PAYMENTS, 1, [id]);
  logAudit_('DELETE', 'Payment', id, '');
  return bootstrap();
}

/* ===================== PERSONNEL / CERTS ===================== */
function savePerson(p) {
  requireDomain_();
  if (!p.name) throw new Error('Name is required.');
  if (!p.certType) throw new Error('Cert type is required.');
  if (p.id) {
    const ex = readSheet_(SHEETS.PERSONNEL).map(normPerson_).filter(function (x) { return x.id === p.id; })[0];
    if (!ex) throw new Error('Person not found.');
    const rec = { id: p.id, name: p.name, role: p.role || '', certType: p.certType, certNo: p.certNo || '',
      issuedDate: p.issuedDate || '', expiryDate: p.expiryDate || '', contact: p.contact || '', remarks: p.remarks || '', updatedAt: nowIso_() };
    updateRecord_(SHEETS.PERSONNEL, rec);
    logAudit_('UPDATE', 'Personnel', p.name, p.certType + ' ' + (p.certNo || ''));
  } else {
    const rec = { id: uid_(), name: p.name, role: p.role || '', certType: p.certType, certNo: p.certNo || '',
      issuedDate: p.issuedDate || '', expiryDate: p.expiryDate || '', contact: p.contact || '', remarks: p.remarks || '', updatedAt: nowIso_() };
    appendRecord_(SHEETS.PERSONNEL, rec);
    logAudit_('CREATE', 'Personnel', p.name, p.certType + ' ' + (p.certNo || ''));
  }
  return bootstrap();
}
function deletePerson(id) {
  requireDomain_();
  deleteRowsWhere_(SHEETS.PERSONNEL, 1, [id]);
  logAudit_('DELETE', 'Personnel', id, '');
  return bootstrap();
}

/* ===================== NUMBERING ===================== */
function nextInvoiceNo_() { return nextSeq_('INVOICE_PREFIX', 'INVOICE_SEQ', readSheet_(SHEETS.INVOICES), 'invNo'); }
function nextJobNo_() { return nextSeq_('JOB_PREFIX', 'JOB_SEQ', readSheet_(SHEETS.ENGAGEMENTS), 'jobNo'); }
function nextSeq_(prefixKey, seqKey, rows, field) {
  const cfg = getConfig_();
  const prefix = cfg[prefixKey] || '';
  const existing = {};
  rows.forEach(function (r) { existing[String(r[field]).toLowerCase()] = true; });
  let seq = Number(cfg[seqKey]) || 0;
  let no;
  do { seq++; no = prefix + ('0000' + seq).slice(-4); } while (existing[no.toLowerCase()]);
  setConfigValue_(seqKey, seq);
  return no;
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

/* ===================== PRINTABLES ===================== */
function getJobDossier(engagementId) {
  requireDomain_();
  const e = readSheet_(SHEETS.ENGAGEMENTS).map(normEngagement_).filter(function (x) { return x.id === engagementId; })[0];
  if (!e) throw new Error('Job not found.');
  return {
    engagement: e,
    charges: readSheet_(SHEETS.CHARGES).map(normCharge_).filter(function (c) { return c.engagementId === e.id; }),
    materials: readSheet_(SHEETS.MATERIALS).map(normMaterial_).filter(function (m) { return m.engagementId === e.id; }),
    inspections: readSheet_(SHEETS.INSPECTIONS).map(normInspection_).filter(function (i) { return i.engagementId === e.id; })
      .sort(function (a, b) { return (b.inspectDate || '').localeCompare(a.inspectDate || ''); }),
    config: getConfig_(), today: todayISO_()
  };
}
function getInvoiceData(invoiceId) {
  requireDomain_();
  const inv = readSheet_(SHEETS.INVOICES).map(normInvoice_).filter(function (x) { return x.id === invoiceId; })[0];
  if (!inv) throw new Error('Invoice not found.');
  const pays = readSheet_(SHEETS.PAYMENTS).map(normPayment_).filter(function (p) { return p.invoiceId === invoiceId; });
  const paid = pays.reduce(function (s, p) { return s + p.amount; }, 0);
  inv.amountPaid = round2_(paid); inv.balance = round2_(inv.total - paid); inv.payStatus = computeInvStatus_(inv);
  const e = inv.engagementId ? readSheet_(SHEETS.ENGAGEMENTS).map(normEngagement_).filter(function (x) { return x.id === inv.engagementId; })[0] : null;
  const charges = inv.engagementId ? readSheet_(SHEETS.CHARGES).map(normCharge_).filter(function (c) { return c.invoiceId === invoiceId; }) : [];
  return { invoice: inv, payments: pays, engagement: e || {}, charges: charges, config: getConfig_(), sstRate: sstRate_() };
}

/* ===================== AUDIT ===================== */
function loadAudit() {
  requireDomain_();
  const sheet = ss_().getSheetByName(SHEETS.AUDIT);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const n = Math.min(300, last - 1);
  const vals = sheet.getRange(last - n + 1, 1, n, HEADERS.AuditLog.length).getValues();
  return vals.reverse().map(function (row) {
    return { timestamp: str_(row[0]), userEmail: row[1], action: row[2], recordType: row[3], recordId: row[4], details: row[5] };
  });
}

/* ===================== REMINDER ENGINE ===================== */
function installDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runDailyReminders') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runDailyReminders').timeBased().everyDays(1).atHour(7).create();
  return 'Trigger installed: daily green-tag + invoice + cert reminders (~7am).';
}
function runDailyReminders() {
  const cfg = getConfig_();
  const today = todayISO_();
  const base = cfg.REMINDER_TO || Session.getEffectiveUser().getEmail();
  const db = bootstrap();

  // green tag due / overdue
  db.engagements.forEach(function (e) {
    const g = e.greenTagDue;
    if (!g || !g.applies) return;
    if (g.days === 0 || g.days < 0) {
      const to = /\S+@\S+\.\S+/.test(e.handledBy || '') ? base + ',' + e.handledBy : base;
      MailApp.sendEmail(to, '[Scaffold] GREEN TAG ' + (g.days < 0 ? 'OVERDUE' : 'DUE') + ' — ' + e.jobNo + ' · ' + e.clientCompany,
        'Weekly green tag inspection is ' + (g.days < 0 ? Math.abs(g.days) + ' day(s) OVERDUE' : 'DUE TODAY') + '.\n\n' +
        'Job: ' + e.jobNo + '\nClient: ' + e.clientCompany + '\nSite: ' + (e.siteName || '-') + '\n' +
        'Last inspection: ' + (e.lastInspection || 'none yet') + '\nAssigned inspector: ' + (e.assignedInspector || '-') + '\n\n' +
        'A scaffold without a current green tag must not be used. Inspect and re-endorse today.');
      logAudit_('GREENTAG_DUE', 'Engagement', e.jobNo, g.days < 0 ? (-g.days) + 'd overdue' : 'due today');
    }
  });
  // collection of deployed material — remind ahead of and past the rental return date
  const dueSoonCollect = Number(cfg.COLLECTION_DUE_SOON_DAYS) || 7;
  db.engagements.forEach(function (e) {
    const c = e.collectionDue;
    if (!c || !c.applies || c.noDate) return;
    const days = c.days;
    if (days === dueSoonCollect || days === 3 || days === 1 || days === 0 || days === -1 || days === -3 || days === -7) {
      const to = /\S+@\S+\.\S+/.test(e.handledBy || '') ? base + ',' + e.handledBy : base;
      const list = (e.itemsOut || []).map(function (x) {
        return '  • ' + (x.code ? x.code + '  ' : '') + x.item + (x.spec && x.spec !== '—' ? ' (' + x.spec + ')' : '') + ' — ' + x.outQty + ' ' + (x.unit || 'pcs');
      }).join('\n');
      MailApp.sendEmail(to, '[Scaffold] COLLECT BACK ' + (days < 0 ? 'OVERDUE' : 'due') + ' — ' + e.jobNo + ' · ' + e.clientCompany,
        'Rented scaffold material is due for collection from site.\n\n' +
        'Job: ' + e.jobNo + '\nClient: ' + e.clientCompany + '\nSite: ' + (e.siteName || '-') + '\n' +
        'Rental return date: ' + e.expectedEndDate + '  (' + (days < 0 ? Math.abs(days) + ' day(s) OVERDUE' : days + ' day(s) left') + ')\n' +
        'Handled by: ' + (e.handledBy || '-') + '\n\nItems to collect back:\n' + list +
        '\n\nArrange lorry pickup, then update the return checklist (qty back) and the collection sign-off.');
      logAudit_('COLLECTION_DUE', 'Engagement', e.jobNo, days < 0 ? (-days) + 'd overdue' : days + 'd left');
    }
  });
  // overdue invoices
  db.invoices.forEach(function (inv) {
    if (inv.payStatus === 'Void' || inv.balance <= 0.005 || !inv.dueDate) return;
    const days = daysBetween_(today, inv.dueDate);
    if (days === -1 || days === -7 || days === -14) {
      MailApp.sendEmail(base, '[Scaffold] OVERDUE invoice ' + inv.invNo + ' — ' + inv.clientCompany,
        'Invoice ' + inv.invNo + ' for ' + inv.clientCompany + ' is ' + (-days) + ' day(s) overdue.\n' +
        'Balance: RM ' + money_(inv.balance) + ' (total RM ' + money_(inv.total) + ').\nDue date: ' + inv.dueDate);
      logAudit_('INV_OVERDUE_NUDGE', 'Invoice', inv.invNo, (-days) + 'd overdue');
    }
  });
  // cert expiry
  db.personnel.forEach(function (p) {
    if (!p.expiryDate) return;
    const days = daysBetween_(today, p.expiryDate);
    if (days === 30 || days === 14 || days === 7 || days === 0 || days === -1) {
      MailApp.sendEmail(base, '[Scaffold] CERT ' + (days < 0 ? 'EXPIRED' : 'expiring') + ' — ' + p.name + ' (' + p.certType + ')',
        p.name + "'s " + p.certType + ' (' + (p.certNo || 'no number') + ') ' +
        (days < 0 ? 'EXPIRED on ' : 'expires on ') + p.expiryDate + (days >= 0 ? ' (' + days + ' day(s) left)' : '') + '.\nRenew before assigning green tag work.');
      logAudit_('CERT_EXPIRY', 'Personnel', p.name, p.certType + ' ' + days + 'd');
    }
  });
}

/* ===================== DRIVE ===================== */
function getParentFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PARENT_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const f = DriveApp.createFolder(PARENT_FOLDER_NAME);
  props.setProperty('PARENT_FOLDER_ID', f.getId());
  return f;
}
function getSub_(name) {
  const parent = getParentFolder_();
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
function uploadPhotos_(prefix, files) {
  const folder = getSub_(SUBFOLDERS.PHOTOS);
  return files.map(function (f) {
    const blob = Utilities.newBlob(Utilities.base64Decode(stripDataUrl_(f.base64)), f.mime || 'image/jpeg',
      safeFilename_((prefix || 'photo') + '-' + (f.name || 'img')));
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();
  });
}
function uploadFile_(subName, prefix, f) {
  const folder = getSub_(subName);
  const blob = Utilities.newBlob(Utilities.base64Decode(stripDataUrl_(f.base64)), f.mime || 'application/octet-stream',
    safeFilename_(prefix + '-' + (f.name || 'file')));
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
  return { url: file.getUrl(), id: file.getId() };
}

/* ===================== CONFIG ===================== */
function getConfig_() {
  const cfg = Object.assign({}, DEFAULTS);
  readSheet_(SHEETS.CONFIG).forEach(function (row) { if (row.key) cfg[row.key] = str_(row.value); });
  return cfg;
}
function saveConfig(obj) {
  requireDomain_();
  const sheet = ss_().getSheetByName(SHEETS.CONFIG);
  Object.keys(obj).forEach(function (k) {
    const last = sheet.getLastRow();
    let found = false;
    if (last >= 2) {
      const keys = sheet.getRange(2, 1, last - 1, 1).getValues();
      for (let i = 0; i < keys.length; i++) if (String(keys[i][0]) === k) { sheet.getRange(i + 2, 2).setValue(obj[k]); found = true; break; }
    }
    if (!found) sheet.appendRow([k, obj[k]]);
  });
  logAudit_('CONFIG', 'Config', '-', Object.keys(obj).join(','));
  return bootstrap();
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
  const idCol = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < idCol.length; i++) {
    if (String(idCol[i][0]) === String(rec.id)) { sheet.getRange(i + 2, 1, 1, HEADERS[name].length).setValues([rowFromRecord_(name, rec)]); return true; }
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
function groupBy_(arr, key) { const o = {}; arr.forEach(function (x) { (o[x[key]] = o[x[key]] || []).push(x); }); return o; }
function labelChargeType_(t) {
  const map = { PE: 'PE calculation & endorsement', Rental: 'Scaffold rental', Install: 'Scaffold installation',
    Transport: 'Lorry transport (delivery/pickup)', Dismantle: 'Scaffold dismantling', GreenTag: 'Green tag endorsement',
    ThirdParty: '3rd-party supplier', Other: 'Other' };
  return map[t] || t;
}
function uid_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 12); }
function nowIso_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss'); }
function tz_() { return Session.getScriptTimeZone() || 'Asia/Kuala_Lumpur'; }
function todayISO_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }
function dateStr_(v) { if (v instanceof Date) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd'); return String(v == null ? '' : v).slice(0, 10); }
function str_(v) { return (v instanceof Date) ? Utilities.formatDate(v, tz_(), 'yyyy-MM-dd HH:mm:ss') : String(v == null ? '' : v); }
function num_(v) { return Number(v) || 0; }
function bool_(v) { return v === true || v === 'true' || v === 'TRUE' || v === 1 || v === '1'; }
function round2_(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function money_(n) { return (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function safeFilename_(s) { return String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100); }
function stripDataUrl_(b64) { const s = String(b64 || ''); const m = s.match(/^data:[^;]+;base64,(.*)$/); return m ? m[1] : s; }
function addDays_(iso, n) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + Number(n || 0)); return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd'); }
function daysBetween_(fromISO, toISO) { return Math.round((new Date(toISO + 'T00:00:00') - new Date(fromISO + 'T00:00:00')) / 86400000); }
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
  seedCatalogue_();
  logAudit_('SETUP', 'System', '-', 'Sheets created / catalogue seeded');
  return 'Setup complete. Next: run installDailyTrigger(), then Deploy as web app.';
}
function seedCatalogue_() {
  const sheet = ss_().getSheetByName(SHEETS.CATALOGUE);
  if (sheet.getLastRow() > 1) return;
  // HG aluminium scaffold material catalogue — codes + specs from the hardcopy delivery/return form.
  // Columns: code, item, spec, category, unit
  const data = [
    ['AFS05/AFD05', '5 Rung Frame',     '0.75m x 2.5m / 1.35m x 2.5m', 'Aluminium mobile', 'pcs'],
    ['AFS04/AFD04', '4 Rung Frame',     '0.75m x 2m / 1.35m x 2m',     'Aluminium mobile', 'pcs'],
    ['AFS03/AFD03', '3 Rung Frame',     '0.75m x 1.5m / 1.35m x 1.5m', 'Aluminium mobile', 'pcs'],
    ['AFS02/AFD02', 'Guardrail',        '0.75m x 1m / 1.35m x 1m',     'Aluminium mobile', 'pcs'],
    ['AHB01/AHB02', 'Horizontal Brace', '1.8m / 2.4m',                 'Aluminium mobile', 'pcs'],
    ['ADB01/ADB02', 'Diagonal Brace',   '2.4m / 3m',                   'Aluminium mobile', 'pcs'],
    ['DP01/DP02/DP03', 'Door Platform', '1.8m / 1.9m / 2.4m',          'Aluminium mobile', 'pcs'],
    ['P01/P02/P03', 'Platform',         '1.8m / 1.9m / 2.4m',          'Aluminium mobile', 'pcs'],
    ['S01',         'Stabilizer',       '3.5m',                        'Aluminium mobile', 'pcs'],
    ['TB01',        'Toe Board',        '—',                      'Aluminium mobile', 'pcs'],
    ['L01',         'Ladder',           '2.4m',                        'Aluminium mobile', 'pcs'],
    ['LH01',        'Ladder Handrail',  '2.15m',                       'Aluminium mobile', 'pcs'],
    ['CW01',        '8" Castor Wheel',  '—',                      'Aluminium mobile', 'pcs']
  ];
  sheet.getRange(2, 1, data.length, HEADERS.Catalogue.length).setValues(data);
}
