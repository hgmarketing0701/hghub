/**
 * Black Lee — Temporary Storage Rental (Cloud v1)
 * Google Apps Script backend, served as a Workspace-restricted web app.
 *
 * Purpose: one place to run the temporary storage rental business end-to-end —
 *          lot inventory (from floor plans), client engagements, internal HG use,
 *          invoices & payments (with SST), security deposits, item photos, CCTV,
 *          a 2-notice renewal engine + sell-off, and a full audit trail.
 *
 * Storage: the Google Sheet this script is bound to (container-bound script).
 * Drive:   parent folder "Black Lee — Temporary Storage"; subfolders for item
 *          photos and invoice files.
 * Auth:    Workspace domain restriction + per-call guard. Every write is stamped
 *          with the signed-in email in AuditLog.
 *
 * FIRST RUN:
 *   1. Run setupSystem()        -> builds tabs + seeds 32 lots from floor plans
 *   2. Run installDailyTrigger() -> daily renewal + payment reminder engine
 *   3. Deploy > New deployment > Web app > Execute as: Me, Access: HG domain
 */

/* ===================== CONFIG ===================== */
const ALLOWED_DOMAIN = 'hggroup.com.my';
const PARENT_FOLDER_NAME = 'Black Lee — Temporary Storage';
const SST_RATE = 0.06;

const SUBFOLDERS = { PHOTOS: 'Item Photos', INVOICES: 'Invoices', AGREEMENTS: 'Signed Agreements' };

const SHEETS = {
  LOTS: 'Lots', RENTALS: 'Rentals', INVOICES: 'Invoices',
  PAYMENTS: 'Payments', CONFIG: 'Config', AUDIT: 'AuditLog'
};

const HEADERS = {
  Lots: ['id','zone','floor','type','lockset','widthMm','depthMm','areaSqm','notes','updatedAt'],
  Rentals: [
    'id','engagementType','lotId','clientCompany','department','clientPIC','clientContact','clientEmail',
    'startDate','endDate','monthlyRate','deposit','depositStatus',
    'status','notice1Sent','notice2Sent','agreementSigned',
    'cctvNo','cctvUrl','itemsDescription','photosUrl',
    'handledBy','remarks','createdAt','createdBy','updatedAt','updatedBy','agreementUrl'
  ],
  Invoices: [
    'id','invNo','rentalId','lotId','clientCompany','invDate','dueDate','periodFrom','periodTo',
    'description','amount','sstEnabled','sstAmount','total','amountPaid','status',
    'fileUrl','fileId','notes','createdAt','createdBy','updatedAt'
  ],
  Payments: ['id','invoiceId','payDate','amount','method','reference','receivedBy','notes','createdAt'],
  Config: ['key','value'],
  AuditLog: ['timestamp','userEmail','action','recordType','recordId','details']
};

const DEFAULTS = {
  NOTICE1_DAYS: '30', NOTICE2_DAYS: '7', INVOICE_DUE_SOON_DAYS: '5', NEW_CLIENT_DAYS: '60',
  REMINDER_TO: '', COMPANY_NAME: 'HG Group',
  COMPANY_REG: '', COMPANY_ADDRESS: '', COMPANY_PHONE: '', SST_NO: '',
  // auto monthly invoicing
  INVOICE_PREFIX: 'STR-', INVOICE_SEQ: '0', INVOICE_TERMS_DAYS: '7', AUTO_INVOICE_SST: '1'
};

const HOLDS_LOT = ['Active', 'Expiring', 'Expired', 'Internal'];   // statuses that hold a lot
const TERMINAL  = ['Vacated', 'SoldOff', 'Released'];               // lot freed

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
    .setTitle('HG — Temporary Storage Rental')
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
  const n1 = Number(cfg.NOTICE1_DAYS) || 30;

  const lots = readSheet_(SHEETS.LOTS).map(normLot_);
  const rentals = readSheet_(SHEETS.RENTALS).map(normRental_);
  const invoices = readSheet_(SHEETS.INVOICES).map(normInvoice_);
  const payments = readSheet_(SHEETS.PAYMENTS).map(normPayment_);

  // rentals: live status + days to expiry
  rentals.forEach(function (r) {
    r.daysToExpiry = r.endDate ? daysBetween_(today, r.endDate) : null;
    r.liveStatus = computeRentalStatus_(r, today, n1);
  });

  // lot occupancy
  const held = {};
  rentals.forEach(function (r) { if (HOLDS_LOT.indexOf(r.liveStatus) >= 0) held[r.lotId] = r; });
  lots.forEach(function (l) {
    const r = held[l.id];
    l.lotStatus = r ? (r.engagementType === 'Internal' ? 'Internal' : 'Occupied') : 'Available';
    l.holder = r ? { id: r.id, engagementType: r.engagementType, clientCompany: r.clientCompany,
                     department: r.department, endDate: r.endDate, liveStatus: r.liveStatus } : null;
  });

  // invoice rollups
  const payByInv = {};
  payments.forEach(function (p) { payByInv[p.invoiceId] = (payByInv[p.invoiceId] || 0) + p.amount; });
  invoices.forEach(function (inv) {
    inv.amountPaid = round2_(payByInv[inv.id] || 0);
    inv.balance = round2_(inv.total - inv.amountPaid);
    inv.payStatus = computeInvStatus_(inv);
    inv.overdue = inv.balance > 0.005 && inv.payStatus !== 'Void' && inv.dueDate && inv.dueDate < today;
  });

  return {
    currentUser: requireDomain_(),
    serverTime: nowIso_(),
    today: today,
    sstRate: SST_RATE,
    config: cfg,
    lots: lots,
    rentals: rentals,
    invoices: invoices,
    payments: payments,
    stats: buildStats_(lots, rentals, invoices, today),
    alerts: buildAlerts_(rentals, invoices, today, cfg)
  };
}

function buildStats_(lots, rentals, invoices, today) {
  const free = lots.filter(function (l) { return l.lotStatus === 'Available'; }).length;
  const occ  = lots.filter(function (l) { return l.lotStatus === 'Occupied'; }).length;
  const intl = lots.filter(function (l) { return l.lotStatus === 'Internal'; }).length;
  const expiring = rentals.filter(function (r) { return r.liveStatus === 'Expiring'; }).length;
  const expired  = rentals.filter(function (r) { return r.liveStatus === 'Expired'; }).length;

  let outstanding = 0, overdueAmt = 0, overdueCount = 0;
  invoices.forEach(function (inv) {
    if (inv.payStatus === 'Void') return;
    outstanding += inv.balance;
    if (inv.overdue) { overdueAmt += inv.balance; overdueCount++; }
  });
  // recurring revenue from active client rentals
  let mrr = 0, deposits = 0;
  rentals.forEach(function (r) {
    if (r.engagementType !== 'Internal' && ['Active', 'Expiring'].indexOf(r.liveStatus) >= 0) mrr += r.monthlyRate;
    if (TERMINAL.indexOf(r.liveStatus) < 0 && r.depositStatus !== 'Refunded') deposits += r.deposit;
  });
  // collected this month
  const ym = today.slice(0, 7);
  let collected = 0;
  readSheet_(SHEETS.PAYMENTS).map(normPayment_).forEach(function (p) {
    if ((p.payDate || '').slice(0, 7) === ym) collected += p.amount;
  });

  return {
    lotsTotal: lots.length, free: free, occupied: occ, internal: intl,
    expiring: expiring, expired: expired,
    outstanding: round2_(outstanding), overdueAmt: round2_(overdueAmt), overdueCount: overdueCount,
    mrr: round2_(mrr), deposits: round2_(deposits), collectedThisMonth: round2_(collected),
    occupancyPct: lots.length ? Math.round(((occ + intl) / lots.length) * 100) : 0
  };
}

function buildAlerts_(rentals, invoices, today, cfg) {
  const out = [];
  const n1 = Number(cfg.NOTICE1_DAYS) || 30;
  rentals.forEach(function (r) {
    if (r.engagementType === 'Internal') return;
    if (TERMINAL.indexOf(r.liveStatus) >= 0) return;
    if (!r.endDate) return;
    const d = daysBetween_(today, r.endDate);
    if (d < 0) out.push({ kind: 'rental', level: 'expired', id: r.id, who: r.clientCompany + ' · Lot ' + r.lotId, days: d, msg: 'expired ' + (-d) + 'd ago' });
    else if (d <= n1) out.push({ kind: 'rental', level: 'expiring', id: r.id, who: r.clientCompany + ' · Lot ' + r.lotId, days: d, msg: 'expires in ' + d + 'd' });
  });
  invoices.forEach(function (inv) {
    if (inv.payStatus === 'Void' || inv.balance <= 0.005) return;
    if (!inv.dueDate) return;
    const d = daysBetween_(today, inv.dueDate);
    const dueSoon = Number(cfg.INVOICE_DUE_SOON_DAYS) || 5;
    if (d < 0) out.push({ kind: 'invoice', level: 'expired', id: inv.id, who: inv.invNo + ' · ' + inv.clientCompany, days: d, msg: 'overdue ' + (-d) + 'd · ' + money_(inv.balance) });
    else if (d <= dueSoon) out.push({ kind: 'invoice', level: 'expiring', id: inv.id, who: inv.invNo + ' · ' + inv.clientCompany, days: d, msg: 'due in ' + d + 'd · ' + money_(inv.balance) });
  });
  out.sort(function (a, b) { return a.days - b.days; });
  return out;
}

/* normalisers (dates → strings, numbers → numbers) */
function normLot_(l) {
  return { id: str_(l.id), zone: str_(l.zone), floor: str_(l.floor), type: str_(l.type),
    lockset: str_(l.lockset), widthMm: num_(l.widthMm), depthMm: num_(l.depthMm),
    areaSqm: num_(l.areaSqm), notes: str_(l.notes) };
}
function normRental_(r) {
  return { id: str_(r.id), engagementType: str_(r.engagementType) || 'Client', lotId: str_(r.lotId),
    clientCompany: str_(r.clientCompany), department: str_(r.department), clientPIC: str_(r.clientPIC),
    clientContact: str_(r.clientContact), clientEmail: str_(r.clientEmail),
    startDate: dateStr_(r.startDate), endDate: dateStr_(r.endDate),
    monthlyRate: num_(r.monthlyRate), deposit: num_(r.deposit), depositStatus: str_(r.depositStatus) || 'None',
    status: str_(r.status), notice1Sent: str_(r.notice1Sent), notice2Sent: str_(r.notice2Sent),
    agreementSigned: str_(r.agreementSigned), cctvNo: str_(r.cctvNo), cctvUrl: str_(r.cctvUrl),
    itemsDescription: str_(r.itemsDescription), photosUrl: str_(r.photosUrl),
    handledBy: str_(r.handledBy), remarks: str_(r.remarks), agreementUrl: str_(r.agreementUrl),
    createdBy: str_(r.createdBy), createdAt: str_(r.createdAt), updatedBy: str_(r.updatedBy), updatedAt: str_(r.updatedAt) };
}
function normInvoice_(i) {
  return { id: str_(i.id), invNo: str_(i.invNo), rentalId: str_(i.rentalId), lotId: str_(i.lotId),
    clientCompany: str_(i.clientCompany), invDate: dateStr_(i.invDate), dueDate: dateStr_(i.dueDate),
    periodFrom: dateStr_(i.periodFrom), periodTo: dateStr_(i.periodTo), description: str_(i.description),
    amount: num_(i.amount), sstEnabled: bool_(i.sstEnabled), sstAmount: num_(i.sstAmount), total: num_(i.total),
    status: str_(i.status), fileUrl: str_(i.fileUrl), fileId: str_(i.fileId), notes: str_(i.notes),
    createdBy: str_(i.createdBy), createdAt: str_(i.createdAt) };
}
function normPayment_(p) {
  return { id: str_(p.id), invoiceId: str_(p.invoiceId), payDate: dateStr_(p.payDate), amount: num_(p.amount),
    method: str_(p.method), reference: str_(p.reference), receivedBy: str_(p.receivedBy), notes: str_(p.notes) };
}

function computeRentalStatus_(r, today, n1) {
  if (TERMINAL.indexOf(r.status) >= 0) return r.status;
  if (r.engagementType === 'Internal') {
    if (!r.endDate) return 'Internal';
    return daysBetween_(today, r.endDate) < 0 ? 'Expired' : 'Internal';
  }
  if (!r.endDate) return r.status || 'Active';
  const d = daysBetween_(today, r.endDate);
  if (d < 0) return 'Expired';
  if (d <= n1) return 'Expiring';
  return 'Active';
}
function computeInvStatus_(inv) {
  if (inv.status === 'Void') return 'Void';
  if (inv.total <= 0) return 'Unpaid';
  if (inv.balance <= 0.005) return 'Paid';
  if (inv.amountPaid > 0.005) return 'Partial';
  return 'Unpaid';
}

/* ===================== LOTS ===================== */
function saveLot(p) {
  requireDomain_();
  if (!p.id) throw new Error('Lot ID is required.');
  const w = num_(p.widthMm), d = num_(p.depthMm);
  const rec = { id: String(p.id).trim(), zone: p.zone || '', floor: p.floor || '', type: p.type || 'Standard',
    lockset: p.lockset || '', widthMm: w, depthMm: d, areaSqm: (w && d) ? round2_(w * d / 1e6) : num_(p.areaSqm),
    notes: p.notes || '', updatedAt: nowIso_() };
  const exists = readSheet_(SHEETS.LOTS).some(function (l) { return String(l.id) === rec.id; });
  if (exists && !p._isEdit) {
    // allow update of existing lot
    updateRecord_(SHEETS.LOTS, rec);
    logAudit_('UPDATE', 'Lot', rec.id, rec.zone + ' / ' + rec.lockset);
  } else if (exists) {
    updateRecord_(SHEETS.LOTS, rec);
    logAudit_('UPDATE', 'Lot', rec.id, rec.zone + ' / ' + rec.lockset);
  } else {
    appendRecord_(SHEETS.LOTS, rec);
    logAudit_('CREATE', 'Lot', rec.id, rec.zone + ' / ' + rec.lockset);
  }
  return bootstrap();
}
function deleteLot(id) {
  requireDomain_();
  const used = readSheet_(SHEETS.RENTALS).map(normRental_).some(function (r) {
    return r.lotId === id && TERMINAL.indexOf(r.status) < 0;
  });
  if (used) throw new Error('Lot ' + id + ' has an active engagement — cannot delete.');
  deleteRowsWhere_(SHEETS.LOTS, 1, [id]);
  logAudit_('DELETE', 'Lot', id, '');
  return bootstrap();
}

/* ===================== RENTALS ===================== */
function saveRental(p) {
  const user = requireDomain_();
  const now = nowIso_();
  const internal = p.engagementType === 'Internal';

  if (!p.lotId) throw new Error('Lot is required.');
  if (!p.startDate) throw new Error('Start date is required.');
  if (internal) {
    if (!p.department) throw new Error('HG department/team is required for internal use.');
  } else {
    if (!p.clientCompany) throw new Error('Client company is required.');
    if (!p.endDate) throw new Error('Storage end date is required.');
  }
  if (p.endDate && p.endDate < p.startDate) throw new Error('End date is before start date.');

  // lot clash
  const today = todayISO_();
  const n1 = Number(getConfig_().NOTICE1_DAYS) || 30;
  const clash = readSheet_(SHEETS.RENTALS).map(normRental_).filter(function (r) {
    return r.lotId === p.lotId && r.id !== p.id && HOLDS_LOT.indexOf(computeRentalStatus_(r, today, n1)) >= 0;
  });
  if (clash.length) throw new Error('Lot ' + p.lotId + ' is already taken by ' +
    (clash[0].engagementType === 'Internal' ? 'HG ' + clash[0].department + ' (internal)' : clash[0].clientCompany) + '.');

  // photos (uploaded as base64 array)
  let photosUrl = p.photosUrl || '';
  if (p.photoFiles && p.photoFiles.length) {
    const urls = uploadPhotos_(p.lotId, p.photoFiles);
    photosUrl = [photosUrl].concat(urls).filter(Boolean).join(', ');
  }
  // signed agreement file (single upload)
  let agreementUrl = p.agreementUrl || '';
  if (p.agreementFile && p.agreementFile.base64) {
    agreementUrl = uploadFile_(SUBFOLDERS.AGREEMENTS, 'Agreement-' + p.lotId + '-' + (p.clientCompany || p.department || ''), p.agreementFile).url;
  }

  if (p.id) {
    const existing = readSheet_(SHEETS.RENTALS).map(normRental_).filter(function (r) { return r.id === p.id; })[0];
    if (!existing) throw new Error('Rental not found.');
    const rec = mergeRental_(existing, p, photosUrl);
    rec.agreementUrl = agreementUrl || existing.agreementUrl;
    rec.updatedBy = user; rec.updatedAt = now;
    updateRecord_(SHEETS.RENTALS, toRentalRow_(rec));
    logAudit_('UPDATE', 'Rental', p.id, p.lotId + ' / ' + (internal ? 'HG ' + p.department : p.clientCompany));
    return bootstrap();
  }

  const id = uid_();
  const rec = mergeRental_({}, p, photosUrl);
  rec.agreementUrl = agreementUrl;
  rec.id = id;
  rec.engagementType = internal ? 'Internal' : 'Client';
  rec.status = internal ? 'Internal' : 'Active';
  rec.depositStatus = num_(p.deposit) > 0 ? 'Held' : 'None';
  rec.handledBy = p.handledBy || user;
  rec.createdBy = user; rec.createdAt = now; rec.updatedBy = user; rec.updatedAt = now;
  appendRecord_(SHEETS.RENTALS, toRentalRow_(rec));
  logAudit_('CREATE', 'Rental', id, p.lotId + ' / ' + (internal ? 'HG ' + p.department : p.clientCompany + ' / Inv ' + (p.invoiceHint || '-')));
  return bootstrap();
}
function mergeRental_(existing, p, photosUrl) {
  const r = Object.assign({}, existing);
  ['engagementType','lotId','clientCompany','department','clientPIC','clientContact','clientEmail',
   'startDate','endDate','agreementSigned','cctvNo','cctvUrl','itemsDescription','handledBy','remarks','status','depositStatus']
    .forEach(function (k) { if (p[k] !== undefined) r[k] = p[k]; });
  if (p.monthlyRate !== undefined) r.monthlyRate = num_(p.monthlyRate);
  if (p.deposit !== undefined) r.deposit = num_(p.deposit);
  r.photosUrl = photosUrl;
  return r;
}
function toRentalRow_(r) {
  return { id: r.id, engagementType: r.engagementType, lotId: r.lotId, clientCompany: r.clientCompany || '',
    department: r.department || '', clientPIC: r.clientPIC || '', clientContact: r.clientContact || '',
    clientEmail: r.clientEmail || '', startDate: r.startDate || '', endDate: r.endDate || '',
    monthlyRate: num_(r.monthlyRate), deposit: num_(r.deposit), depositStatus: r.depositStatus || 'None',
    status: r.status || 'Active', notice1Sent: r.notice1Sent || '', notice2Sent: r.notice2Sent || '',
    agreementSigned: r.agreementSigned || '', cctvNo: r.cctvNo || '', cctvUrl: r.cctvUrl || '',
    itemsDescription: r.itemsDescription || '', photosUrl: r.photosUrl || '', handledBy: r.handledBy || '',
    remarks: r.remarks || '', createdAt: r.createdAt || '', createdBy: r.createdBy || '',
    updatedAt: r.updatedAt || '', updatedBy: r.updatedBy || '', agreementUrl: r.agreementUrl || '' };
}

function renewRental(id, newEndDate) {
  requireDomain_();
  const r = readSheet_(SHEETS.RENTALS).map(normRental_).filter(function (x) { return x.id === id; })[0];
  if (!r) throw new Error('Rental not found.');
  if (!newEndDate) throw new Error('New end date required.');
  if (newEndDate <= r.endDate) throw new Error('New end date must be after current end date.');
  r.endDate = newEndDate; r.status = 'Active'; r.notice1Sent = ''; r.notice2Sent = '';
  r.updatedBy = requireDomain_(); r.updatedAt = nowIso_();
  updateRecord_(SHEETS.RENTALS, toRentalRow_(r));
  logAudit_('RENEW', 'Rental', id, 'Extended to ' + newEndDate);
  return bootstrap();
}
function vacateRental(id, remarks) { return setRentalStatus_(id, 'Vacated', 'VACATE', remarks); }
function sellOffRental(id, remarks) {
  return setRentalStatus_(id, 'SoldOff', 'SELL_OFF',
    'Items unclaimed after 2 notices — disposed/sold, ownership transferred to HG. ' + (remarks || ''));
}
function releaseInternal(id, remarks) { return setRentalStatus_(id, 'Released', 'RELEASE', 'Internal use ended — lot released. ' + (remarks || '')); }
function refundDeposit(id, remarks) {
  requireDomain_();
  const r = readSheet_(SHEETS.RENTALS).map(normRental_).filter(function (x) { return x.id === id; })[0];
  if (!r) throw new Error('Rental not found.');
  r.depositStatus = 'Refunded';
  r.remarks = (r.remarks ? r.remarks + ' | ' : '') + 'Deposit RM ' + money_(r.deposit) + ' refunded. ' + (remarks || '');
  r.updatedBy = requireDomain_(); r.updatedAt = nowIso_();
  updateRecord_(SHEETS.RENTALS, toRentalRow_(r));
  logAudit_('DEPOSIT_REFUND', 'Rental', id, 'RM ' + money_(r.deposit));
  return bootstrap();
}
function setRentalStatus_(id, status, action, remarks) {
  requireDomain_();
  const r = readSheet_(SHEETS.RENTALS).map(normRental_).filter(function (x) { return x.id === id; })[0];
  if (!r) throw new Error('Rental not found.');
  r.status = status;
  if (remarks) r.remarks = (r.remarks ? r.remarks + ' | ' : '') + remarks;
  r.updatedBy = requireDomain_(); r.updatedAt = nowIso_();
  updateRecord_(SHEETS.RENTALS, toRentalRow_(r));
  logAudit_(action, 'Rental', id, status + ' :: ' + (remarks || ''));
  return bootstrap();
}
function deleteRental(id) {
  requireDomain_();
  const invs = readSheet_(SHEETS.INVOICES).map(normInvoice_).filter(function (i) { return i.rentalId === id; });
  if (invs.length) throw new Error('This engagement has ' + invs.length + ' invoice(s). Delete/void those first.');
  deleteRowsWhere_(SHEETS.RENTALS, 1, [id]);
  logAudit_('DELETE', 'Rental', id, '');
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
  const sstAmount = sstEnabled ? round2_(amount * SST_RATE) : 0;
  const total = round2_(amount + sstAmount);

  // unique invoice number
  const dup = readSheet_(SHEETS.INVOICES).map(normInvoice_).filter(function (i) {
    return i.invNo.toLowerCase() === String(p.invNo).toLowerCase() && i.id !== p.id;
  });
  if (dup.length) throw new Error('Invoice number ' + p.invNo + ' already exists.');

  let fileUrl = p.fileUrl || '', fileId = p.fileId || '';
  if (p.file && p.file.base64) {
    const f = uploadFile_(SUBFOLDERS.INVOICES, p.invNo, p.file);
    fileUrl = f.url; fileId = f.id;
  }

  const base = { invNo: String(p.invNo).trim(), rentalId: p.rentalId || '', lotId: p.lotId || '',
    clientCompany: p.clientCompany, invDate: p.invDate, dueDate: p.dueDate || '',
    periodFrom: p.periodFrom || '', periodTo: p.periodTo || '', description: p.description || '',
    amount: amount, sstEnabled: sstEnabled, sstAmount: sstAmount, total: total,
    status: p.status === 'Void' ? 'Void' : '', fileUrl: fileUrl, fileId: fileId, notes: p.notes || '' };

  if (p.id) {
    const ex = readSheet_(SHEETS.INVOICES).map(normInvoice_).filter(function (i) { return i.id === p.id; })[0];
    if (!ex) throw new Error('Invoice not found.');
    base.id = p.id; base.createdAt = ex.createdAt; base.createdBy = ex.createdBy; base.updatedAt = now;
    updateRecord_(SHEETS.INVOICES, base);
    logAudit_('UPDATE', 'Invoice', p.invNo, p.clientCompany + ' / ' + money_(total));
  } else {
    base.id = uid_(); base.createdAt = now; base.createdBy = user; base.updatedAt = now;
    appendRecord_(SHEETS.INVOICES, base);
    logAudit_('CREATE', 'Invoice', p.invNo, p.clientCompany + ' / ' + money_(total));
  }
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
  logAudit_('VOID', 'Invoice', ex.invNo, remarks || '');
  return bootstrap();
}
function deleteInvoice(id) {
  requireDomain_();
  deleteRowsWhere_(SHEETS.PAYMENTS, 2, [id]);   // remove its payments (col 2 = invoiceId)
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

/* ===================== AUTO MONTHLY INVOICING ===================== */
/**
 * Generate one invoice per active CLIENT rental (monthlyRate > 0) for the
 * given month. Skips internal use, terminated rentals, rentals not active in
 * that month, and any rental that already has an invoice for the same period.
 * Returns a summary + a fresh bootstrap for the UI.
 */
function generateMonthlyInvoices(targetMonth) {
  requireDomain_();
  const s = genMonthly_(targetMonth || todayISO_().slice(0, 7));
  return { month: s.month, count: s.count, created: s.created, db: bootstrap() };
}
/** Trigger entrypoint — invoices the current month, no bootstrap needed. */
function onMonthStart() { genMonthly_(todayISO_().slice(0, 7)); }

function genMonthly_(month) {
  const cfg = getConfig_();
  const from = month + '-01';
  const to = lastDayOfMonth_(month);
  const terms = Number(cfg.INVOICE_TERMS_DAYS) || 7;
  const due = addDays_(from, terms);
  const autoSst = bool_(cfg.AUTO_INVOICE_SST);
  const who = (Session.getActiveUser().getEmail() || 'auto').toLowerCase();

  const rentals = readSheet_(SHEETS.RENTALS).map(normRental_);
  const invoices = readSheet_(SHEETS.INVOICES).map(normInvoice_);
  const created = [];

  rentals.forEach(function (r) {
    if (r.engagementType === 'Internal') return;
    if (TERMINAL.indexOf(r.status) >= 0) return;
    if (!(r.monthlyRate > 0)) return;
    if (r.startDate && r.startDate > to) return;           // starts after this month
    if (r.endDate && r.endDate < from) return;             // ended before this month
    const dup = invoices.some(function (i) { return i.rentalId === r.id && i.periodFrom === from && i.status !== 'Void'; });
    if (dup) return;

    const amount = round2_(r.monthlyRate);
    const sstAmount = autoSst ? round2_(amount * SST_RATE) : 0;
    const total = round2_(amount + sstAmount);
    const rec = { id: uid_(), invNo: nextInvoiceNo_(), rentalId: r.id, lotId: r.lotId, clientCompany: r.clientCompany,
      invDate: todayISO_(), dueDate: due, periodFrom: from, periodTo: to,
      description: 'Storage rental — Lot ' + r.lotId + ' · ' + monthLabel_(month),
      amount: amount, sstEnabled: autoSst, sstAmount: sstAmount, total: total, status: '',
      fileUrl: '', fileId: '', notes: 'Auto-generated', createdAt: nowIso_(), createdBy: 'auto/' + who, updatedAt: nowIso_() };
    appendRecord_(SHEETS.INVOICES, rec);
    invoices.push(rec);  // keep dedup correct within this run
    created.push(rec.invNo + ' · ' + r.clientCompany + ' (Lot ' + r.lotId + ')');
    logAudit_('AUTO_INVOICE', 'Invoice', rec.invNo, r.clientCompany + ' / ' + monthLabel_(month) + ' / ' + money_(total));
  });
  return { month: month, count: created.length, created: created };
}

function nextInvoiceNo_() {
  const cfg = getConfig_();
  const prefix = cfg.INVOICE_PREFIX || 'STR-';
  const existing = {};
  readSheet_(SHEETS.INVOICES).forEach(function (i) { existing[String(i.invNo).toLowerCase()] = true; });
  let seq = Number(cfg.INVOICE_SEQ) || 0;
  let no;
  do { seq++; no = prefix + ('0000' + seq).slice(-4); } while (existing[no.toLowerCase()]);
  setConfigValue_('INVOICE_SEQ', seq);
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
function lastDayOfMonth_(month) { const p = month.split('-'); return Utilities.formatDate(new Date(+p[0], +p[1], 0), tz_(), 'yyyy-MM-dd'); }
function addDays_(iso, n) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd'); }
function monthLabel_(month) { return Utilities.formatDate(new Date(month + '-01T00:00:00'), tz_(), 'MMM yyyy'); }

/* ===================== PRINTABLES ===================== */
function getAgreementData(rentalId) {
  requireDomain_();
  const r = readSheet_(SHEETS.RENTALS).map(normRental_).filter(function (x) { return x.id === rentalId; })[0];
  if (!r) throw new Error('Rental not found.');
  const lot = readSheet_(SHEETS.LOTS).map(normLot_).filter(function (x) { return x.id === r.lotId; })[0] || {};
  return { rental: r, lot: lot, config: getConfig_(), today: todayISO_() };
}
function getInvoiceData(invoiceId) {
  requireDomain_();
  const inv = readSheet_(SHEETS.INVOICES).map(normInvoice_).filter(function (x) { return x.id === invoiceId; })[0];
  if (!inv) throw new Error('Invoice not found.');
  const pays = readSheet_(SHEETS.PAYMENTS).map(normPayment_).filter(function (p) { return p.invoiceId === invoiceId; });
  const paid = pays.reduce(function (s, p) { return s + p.amount; }, 0);
  inv.amountPaid = round2_(paid); inv.balance = round2_(inv.total - paid); inv.payStatus = computeInvStatus_(inv);
  const lot = readSheet_(SHEETS.LOTS).map(normLot_).filter(function (x) { return x.id === inv.lotId; })[0] || {};
  return { invoice: inv, payments: pays, lot: lot, config: getConfig_(), sstRate: SST_RATE };
}

/* ===================== AUDIT ===================== */
function loadAudit() {
  requireDomain_();
  const sheet = ss_().getSheetByName(SHEETS.AUDIT);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const n = Math.min(200, last - 1);
  const vals = sheet.getRange(last - n + 1, 1, n, HEADERS.AuditLog.length).getValues();
  return vals.reverse().map(function (row) {
    return { timestamp: str_(row[0]), userEmail: row[1], action: row[2], recordType: row[3], recordId: row[4], details: row[5] };
  });
}

/* ===================== REMINDER ENGINE ===================== */
function installDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const h = t.getHandlerFunction();
    if (h === 'runDailyReminders' || h === 'onMonthStart') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runDailyReminders').timeBased().everyDays(1).atHour(8).create();
  ScriptApp.newTrigger('onMonthStart').timeBased().onMonthDay(1).atHour(7).create();
  return 'Triggers installed: daily reminders (~8am) + monthly auto-invoicing (1st of month, ~7am).';
}
function runDailyReminders() {
  const cfg = getConfig_();
  const n1 = Number(cfg.NOTICE1_DAYS) || 30;
  const n2 = Number(cfg.NOTICE2_DAYS) || 7;
  const today = todayISO_();
  const base = cfg.REMINDER_TO || Session.getEffectiveUser().getEmail();
  const sheet = ss_().getSheetByName(SHEETS.RENTALS);
  const rentals = readSheet_(SHEETS.RENTALS).map(normRental_);

  rentals.forEach(function (r) {
    if (r.engagementType === 'Internal') return;
    if (TERMINAL.indexOf(r.status) >= 0) return;
    if (!r.endDate) return;
    const days = daysBetween_(today, r.endDate);
    const to = /\S+@\S+\.\S+/.test(r.handledBy || '') ? base + ',' + r.handledBy : base;

    if (days <= n1 && days > n2 && !r.notice1Sent) {
      sendRenewal_(to, r, days, 'NOTICE 1 of 2 — Renewal due', cfg);
      setRentalCell_(sheet, r.id, 'notice1Sent', nowIso_());
      setRentalCell_(sheet, r.id, 'status', 'Expiring');
      logAudit_('NOTICE1', 'Rental', r.id, days + 'd to expiry');
    }
    if (days <= n2 && days >= 0 && !r.notice2Sent) {
      sendRenewal_(to, r, days, 'NOTICE 2 of 2 — FINAL renewal notice', cfg);
      setRentalCell_(sheet, r.id, 'notice2Sent', nowIso_());
      setRentalCell_(sheet, r.id, 'status', 'Expiring');
      logAudit_('NOTICE2', 'Rental', r.id, days + 'd to expiry');
    }
    if (days < 0 && r.status !== 'Expired') {
      sendRenewal_(to, r, days, 'EXPIRED — no renewal. Decide: sell-off / dispose (items become HG)', cfg);
      setRentalCell_(sheet, r.id, 'status', 'Expired');
      logAudit_('EXPIRED', 'Rental', r.id, (-days) + 'd overdue');
    }
  });

  // overdue invoice reminders
  const invoices = readSheet_(SHEETS.INVOICES).map(normInvoice_);
  const payByInv = {};
  readSheet_(SHEETS.PAYMENTS).map(normPayment_).forEach(function (p) { payByInv[p.invoiceId] = (payByInv[p.invoiceId] || 0) + p.amount; });
  invoices.forEach(function (inv) {
    if (inv.status === 'Void') return;
    const bal = round2_(inv.total - (payByInv[inv.id] || 0));
    if (bal <= 0.005 || !inv.dueDate) return;
    const days = daysBetween_(today, inv.dueDate);
    if (days === -1 || days === -7 || days === -14) {  // nudge at 1, 7, 14 days overdue
      MailApp.sendEmail(base, '[Storage] OVERDUE invoice ' + inv.invNo + ' — ' + inv.clientCompany,
        'Invoice ' + inv.invNo + ' for ' + inv.clientCompany + ' is ' + (-days) + ' day(s) overdue.\n' +
        'Balance: RM ' + money_(bal) + ' (total RM ' + money_(inv.total) + ').\nDue date: ' + inv.dueDate + '\n');
      logAudit_('INV_OVERDUE_NUDGE', 'Invoice', inv.invNo, (-days) + 'd overdue');
    }
  });
}
function sendRenewal_(to, r, days, tag, cfg) {
  const company = cfg.COMPANY_NAME || 'HG Group';
  const when = days < 0 ? Math.abs(days) + ' day(s) OVERDUE' : days + ' day(s) left';
  const wa = days < 0
    ? 'Hi ' + (r.clientPIC || r.clientCompany) + ',\nYour storage at ' + company + ' (Lot ' + r.lotId + ') expired on ' + r.endDate + '.\nNo renewal received. As per the signed agreement, unclaimed items may be disposed or sold off and ownership passes to HG.\nPlease contact us immediately to renew or collect.\nThanks'
    : 'Hi ' + (r.clientPIC || r.clientCompany) + ',\nReminder: your storage at ' + company + ' (Lot ' + r.lotId + ') expires on ' + r.endDate + ' (' + days + ' day(s) left).\nTo renew, reply with the new period and we will issue the invoice.\nIf not renewed by the end date, items may be disposed/sold off as per the agreement.\nThanks';
  MailApp.sendEmail(to, '[Storage] ' + tag + ' — ' + r.clientCompany + ' (Lot ' + r.lotId + ')',
    company + ' — Temporary Storage Renewal\n--------------------------------------\n' +
    'Lot: ' + r.lotId + '\nClient: ' + r.clientCompany + (r.clientPIC ? ' (' + r.clientPIC + ')' : '') + '\n' +
    'Contact: ' + (r.clientContact || '-') + '\nPeriod: ' + r.startDate + ' to ' + r.endDate + '\n' +
    'Status: ' + when + '\nHandled by: ' + (r.handledBy || '-') + '\n\nWhatsApp draft:\n--------------------------------------\n' + wa + '\n');
}
function setRentalCell_(sheet, id, header, value) {
  const col = HEADERS.Rentals.indexOf(header) + 1;
  const last = sheet.getLastRow();
  const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) { sheet.getRange(i + 2, col).setValue(value); return; }
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
function uploadPhotos_(lotId, files) {
  const folder = getSub_(SUBFOLDERS.PHOTOS);
  return files.map(function (f) {
    const blob = Utilities.newBlob(Utilities.base64Decode(stripDataUrl_(f.base64)), f.mime || 'image/jpeg',
      safeFilename_((lotId || 'lot') + '-' + (f.name || 'photo')));
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
      // make room if new columns were added to HEADERS since the sheet was made
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
  seedLots_();
  logAudit_('SETUP', 'System', '-', 'Sheets created / lots seeded');
  return 'Setup complete. Lots seeded. Next: run installDailyTrigger(), then deploy as web app.';
}
function seedLots_() {
  const sheet = ss_().getSheetByName(SHEETS.LOTS);
  if (sheet.getLastRow() > 1) return;
  const V = 'verify dimensions on site';
  const data = [
    ['A-01','A','Ground','Standard','34579',6000,6000,V],
    ['A-02','A','Ground','Standard','24679',6000,6000,V],
    ['A-03','A','Ground','Standard','23568',6000,6000,V],
    ['A-04','A','Ground','Standard','25789',6000,6000,'labelled "ZONE A B04"; '+V],
    ['A-05','A','Ground','Standard','24590',6000,6000,'lockset 24590 also on B-S01 — confirm'],
    ['A-06','A','Ground','Standard','24567',6000,6000,V],
    ['A-07','A','Ground','Standard','12340',6000,6000,V],
    ['A-08','A','Ground','Standard','45890',6000,6000,V],
    ['A-09','A','Ground','Standard','12690',6000,6000,V],
    ['B-01','B','Level 1','Standard','26790',6000,6000,''],
    ['B-02','B','Level 1','Standard','24568',6000,6000,''],
    ['B-03','B','Level 1','Standard','12578',6000,6000,''],
    ['B-04','B','Level 1','Standard','13569',6000,6000,''],
    ['B-05','B','Level 1','Standard','23569',6000,6000,''],
    ['B-S01','B','Level 1','Small','24590',0,0,'lockset 24590 also on A-05 — confirm; '+V],
    ['B-S02','B','Level 1','Small','13789',0,0,V],
    ['B-S03','B','Level 1','Small','26890',0,0,V],
    ['B-S04','B','Level 1','Small','36789',0,0,V],
    ['B-S05','B','Level 1','Small','24689',0,0,V],
    ['B-S06','B','Level 1','Small','24789',0,0,V],
    ['B-S07','B','Level 1','Small','24578',0,0,V],
    ['C-01','C','Level 1','Standard','12689',4765,4700,''],
    ['C-02','C','Level 1','Standard','13568',6000,4700,''],
    ['C-03','C','Level 1','Large','12457',6000,7000,''],
    ['C-04','C','Level 1','Standard','24680',6000,4770,''],
    ['D-01','D','Level 2','Standard','23590',6000,6000,''],
    ['D-02','D','Level 2','Standard','23670',6000,6000,''],
    ['D-03','D','Level 2','Standard','35790',6000,6000,''],
    ['D-S01','D','Level 2','Small','36780',6000,3000,''],
    ['D-S02','D','Level 2','Standard','34578',8500,3000,''],
    ['D-S03','D','Level 2','Small','25680',3000,6000,''],
    ['D-S04','D','Level 2','Small','13680',4000,6000,'']
  ];
  const rows = data.map(function (d) {
    const area = (d[5] && d[6]) ? round2_(d[5] * d[6] / 1e6) : '';
    return [d[0], d[1], d[2], d[3], d[4], d[5] || '', d[6] || '', area, d[7], nowIso_()];
  });
  sheet.getRange(2, 1, rows.length, HEADERS.Lots.length).setValues(rows);
}
