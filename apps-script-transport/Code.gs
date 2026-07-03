/**
 * Black Lee — Transport, Mover & Rorobin (Cloud v1)
 * Google Apps Script backend, served as a Workspace-restricted web app.
 *
 * Purpose: run client engagements for three services end-to-end —
 *          1. Lorry transport  2. Mover services  3. Rorobin rental (SWCorp)
 *          One engagement groups several service jobs (mover + lorry + bin).
 *          Strict rate-card auto-calc. One invoice can cover the whole
 *          engagement (separate lines) or you split it. Payments with SST.
 *          Stage-tagged before/after photos. Bin inventory. Full audit trail.
 *
 * Storage: the Google Sheet this script is bound to (container-bound script).
 * Drive:   parent folder "Black Lee — Transport"; subfolder for job photos
 *          and invoice files.
 * Auth:    Workspace domain restriction + per-call guard. Every write is stamped
 *          with the signed-in email in AuditLog.
 *
 * FIRST RUN:
 *   1. Run setupSystem()         -> builds tabs + seeds rate card + sample bins
 *   2. Run installDailyTrigger() -> daily overstay + overdue-invoice alerts
 *   3. Deploy > New deployment > Web app > Execute as: Me, Access: HG domain
 */

/* ===================== CONFIG ===================== */
const ALLOWED_DOMAIN = 'hggroup.com.my';
const PARENT_FOLDER_NAME = 'Black Lee — Transport';
const SST_RATE = 0.06;

const SUBFOLDERS = { PHOTOS: 'Job Photos', INVOICES: 'Invoices' };

const SHEETS = {
  CLIENTS: 'Clients', ENGAGEMENTS: 'Engagements', JOBS: 'Jobs', BINS: 'Bins',
  RATES: 'Rates', INVOICES: 'Invoices', PAYMENTS: 'Payments', PHOTOS: 'Photos',
  WORKERS: 'Workers', TRIPS: 'Trips', LORRIES: 'Lorries',
  CONFIG: 'Config', AUDIT: 'AuditLog'
};

const HEADERS = {
  Clients: ['id','company','regNo','pic','contact','email','address','notes','createdAt','createdBy','updatedAt'],
  Engagements: ['id','ref','clientId','clientCompany','reason','siteName','siteAddress',
    'status','handledBy','remarks','createdAt','createdBy','updatedAt','updatedBy'],
  Jobs: ['id','engagementId','engagementRef','clientId','clientCompany','service','status',
    'startDateTime','endDateTime','fromLocation','toLocation',
    'lorryType','lorryPlate','driver','trips','collectionMoverBy','deliveryMoverBy',
    'movers','shifts','itemsDescription',
    'binId','binNo','placementType','placeDateTime','collectDateTime','permitNo','swcorpRef','maxDays',
    'rateCode','rateLabel','unitRate','quantity','amount','invoiceId',
    'handledBy','remarks','createdAt','createdBy','updatedAt','updatedBy','tripId','stopSeq',
    'internalUse','landfill','weightTons','tipFee','tippingDate','tippingReceiptUrl','stopsJson'],
  Bins: ['id','binNo','swcorpReg','size','status','notes','updatedAt'],
  Rates: ['id','service','code','label','unit','rate','active','updatedAt'],
  Workers: ['id','name','phone','role','payType','dayRate','nightRate','monthlySalary','active','notes','updatedAt'],
  Lorries: ['id','plateNo','code','type','capacity','category','active','notes','updatedAt'],
  Trips: ['id','ref','tripDate','shift','lorryPlate','driver','driverCost','lorryCost','crewJson',
    'status','notes','createdAt','createdBy','updatedAt','updatedBy','driverId'],
  Invoices: ['id','invNo','engagementId','engagementRef','clientId','clientCompany','invDate','dueDate',
    'description','amount','sstEnabled','sstAmount','total','status','fileUrl','fileId','notes',
    'createdAt','createdBy','updatedAt'],
  Payments: ['id','invoiceId','payDate','amount','method','reference','receivedBy','notes','createdAt'],
  Photos: ['id','jobId','engagementId','service','stage','url','fileId','caption','takenBy','takenAt'],
  Config: ['key','value'],
  AuditLog: ['timestamp','userEmail','action','recordType','recordId','details']
};

const DEFAULTS = {
  COMPANY_NAME: 'HG Group', COMPANY_REG: '', COMPANY_ADDRESS: '', COMPANY_PHONE: '', SST_NO: '',
  REMINDER_TO: '', INVOICE_DUE_SOON_DAYS: '5',
  ENG_PREFIX: 'ENG-', ENG_SEQ: '0',
  TRIP_PREFIX: 'RUN-', TRIP_SEQ: '0',
  DEFAULT_DAY_RATE: '90', DEFAULT_NIGHT_RATE: '120',
  ROROBIN_MAX_DAYS: '3'           // HG policy: a bin placement cannot exceed 3 days
};
const TRIP_OPEN_STATUSES = ['Planned', 'Dispatched'];

/* service + stage vocabulary (kept in sync with Index.html) */
const SERVICES = ['Lorry', 'Mover', 'Rorobin'];
const PLACEMENT_TYPES = ['Mall', 'Office Tower', 'Shop Lot', 'Roadside'];
const OVERNIGHT_PLACEMENTS = ['Mall', 'Office Tower'];   // 10pm place, before 6am collect
const REQUIRED_STAGES = {
  Lorry:   ['Lorry Reach', 'Box Before Load', 'Box After Unload', 'Lorry Leave'],
  Mover:   ['Items Before Start'],
  Rorobin: ['Placement Location', 'After Pick Up']
};
/* optional extra stages offered in the photo manager (Command Center parity) */
const SUGGESTED_STAGES = {
  Lorry:   ['Defect'],
  Mover:   ['Items After Unload', 'Defect'],
  Rorobin: ['Waste Load', 'Tipping / Landfill', 'Defect']
};
const JOB_OPEN_STATUSES = ['Scheduled', 'In Progress'];
const JOB_DONE_STATUSES = ['Completed', 'Cancelled'];

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
    .setTitle('HG — Transport, Mover & Rorobin')
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
  const now = new Date();

  const clients = readSheet_(SHEETS.CLIENTS).map(normClient_);
  const engagements = readSheet_(SHEETS.ENGAGEMENTS).map(normEngagement_);
  const jobs = readSheet_(SHEETS.JOBS).map(normJob_);
  const bins = readSheet_(SHEETS.BINS).map(normBin_);
  const rates = readSheet_(SHEETS.RATES).map(normRate_);
  const invoices = readSheet_(SHEETS.INVOICES).map(normInvoice_);
  const payments = readSheet_(SHEETS.PAYMENTS).map(normPayment_);
  const photos = readSheet_(SHEETS.PHOTOS).map(normPhoto_);
  const workers = readSheet_(SHEETS.WORKERS).map(normWorker_);
  const trips = readSheet_(SHEETS.TRIPS).map(normTrip_);
  const lorries = readSheet_(SHEETS.LORRIES).map(normLorry_);

  // photos grouped per job
  const photoByJob = {};
  photos.forEach(function (ph) { (photoByJob[ph.jobId] = photoByJob[ph.jobId] || []).push(ph); });

  // job enrichments: rorobin live status + photo compliance
  jobs.forEach(function (j) {
    j.photos = photoByJob[j.id] || [];
    j.requiredStages = REQUIRED_STAGES[j.service] || [];
    const have = {}; j.photos.forEach(function (p) { have[p.stage] = true; });
    j.missingStages = j.requiredStages.filter(function (s) { return !have[s]; });
    j.photoComplete = j.missingStages.length === 0;
    enrichRorobin_(j, now, cfg);
    enrichRorobinPhase_(j);
  });

  // engagement live status + job rollup
  const jobsByEng = {};
  jobs.forEach(function (j) { (jobsByEng[j.engagementId] = jobsByEng[j.engagementId] || []).push(j); });
  engagements.forEach(function (e) {
    const list = jobsByEng[e.id] || [];
    e.jobCount = list.length;
    e.jobTotal = round2_(list.reduce(function (s, j) { return s + j.amount; }, 0));
    e.services = uniq_(list.map(function (j) { return j.service; }));
    e.liveStatus = computeEngagementStatus_(e, list);
  });

  // bin occupancy (deployed = referenced by an open rorobin job not yet collected)
  const binHold = {};
  jobs.forEach(function (j) {
    if (j.service !== 'Rorobin' || !j.binId) return;
    if (JOB_DONE_STATUSES.indexOf(j.status) >= 0) return;
    if (j.collectDateTime) return;     // already collected
    binHold[j.binId] = j;
  });
  bins.forEach(function (b) {
    const j = binHold[b.id];
    b.live = j ? 'Deployed' : (b.status === 'Maintenance' ? 'Maintenance' : 'Available');
    b.deployedTo = j ? { jobId: j.id, engagementRef: j.engagementRef, clientCompany: j.clientCompany,
      placementType: j.placementType, placeDateTime: j.placeDateTime, overstay: j.overstay, daysOut: j.daysOut } : null;
  });

  // trip rollups (HG cost-saving / margin view of shared runs)
  const jobsByTrip = {};
  jobs.forEach(function (j) { if (j.tripId) (jobsByTrip[j.tripId] = jobsByTrip[j.tripId] || []).push(j); });
  trips.forEach(function (t) {
    const stops = (jobsByTrip[t.id] || []).slice().sort(function (a, b) { return (a.stopSeq || 0) - (b.stopSeq || 0); });
    t.stopJobIds = stops.map(function (j) { return j.id; });
    t.stopCount = stops.length;
    t.clients = uniq_(stops.map(function (j) { return j.clientCompany; }).filter(Boolean));
    t.services = uniq_(stops.map(function (j) { return j.service; }));
    t.clientRevenue = round2_(stops.reduce(function (s, j) { return s + j.amount; }, 0));
    t.crewCost = round2_((t.crew || []).reduce(function (s, c) { return s + (Number(c.rate) || 0); }, 0));
    t.totalCost = round2_(t.crewCost + num_(t.driverCost) + num_(t.lorryCost));
    t.margin = round2_(t.clientRevenue - t.totalCost);
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
    services: SERVICES,
    placementTypes: PLACEMENT_TYPES,
    requiredStages: REQUIRED_STAGES,
    suggestedStages: SUGGESTED_STAGES,
    clients: clients,
    engagements: engagements,
    jobs: jobs,
    bins: bins,
    rates: rates,
    invoices: invoices,
    payments: payments,
    workers: workers,
    trips: trips,
    lorries: lorries,
    stats: buildStats_(jobs, bins, invoices, today, trips),
    alerts: buildAlerts_(jobs, invoices, today, cfg)
  };
}

function enrichRorobin_(j, now, cfg) {
  j.overstay = false; j.daysOut = null; j.collectBy = '';
  if (j.service !== 'Rorobin') return;
  if (!j.placeDateTime) return;
  if (j.collectDateTime || JOB_DONE_STATUSES.indexOf(j.status) >= 0) return;
  const placed = parseDateTime_(j.placeDateTime);
  if (!placed) return;
  const maxDays = num_(j.maxDays) || Number(cfg.ROROBIN_MAX_DAYS) || 3;
  if (OVERNIGHT_PLACEMENTS.indexOf(j.placementType) >= 0) {
    // must collect before 6am the morning after placement
    const deadline = new Date(placed.getTime());
    deadline.setDate(deadline.getDate() + 1); deadline.setHours(6, 0, 0, 0);
    j.collectBy = Utilities.formatDate(deadline, tz_(), 'yyyy-MM-dd HH:mm');
    j.overstay = now.getTime() > deadline.getTime();
  } else {
    const deadline = new Date(placed.getTime());
    deadline.setDate(deadline.getDate() + maxDays);
    j.collectBy = Utilities.formatDate(deadline, tz_(), 'yyyy-MM-dd HH:mm');
    j.overstay = now.getTime() > deadline.getTime();
  }
  j.daysOut = Math.floor((now.getTime() - placed.getTime()) / 86400000);
}
/* Rorobin lifecycle phase: Onsite -> Collected (awaiting tipping) -> Tipped */
function enrichRorobinPhase_(j) {
  if (j.service !== 'Rorobin') { j.rorobinPhase = ''; return; }
  if (j.tippingDate) j.rorobinPhase = 'Tipped';
  else if (j.collectDateTime) j.rorobinPhase = 'Awaiting Tipping';
  else j.rorobinPhase = 'Onsite';
}

function computeEngagementStatus_(e, jobs) {
  if (e.status === 'Cancelled') return 'Cancelled';
  if (!jobs.length) return e.status || 'Open';
  const open = jobs.filter(function (j) { return JOB_OPEN_STATUSES.indexOf(j.status) >= 0; });
  if (open.length === 0) return 'Completed';
  if (jobs.some(function (j) { return j.status === 'In Progress'; })) return 'In Progress';
  return 'Scheduled';
}

function computeInvStatus_(inv) {
  if (inv.status === 'Void') return 'Void';
  if (inv.total <= 0) return 'Unpaid';
  if (inv.balance <= 0.005) return 'Paid';
  if (inv.amountPaid > 0.005) return 'Partial';
  return 'Unpaid';
}

function buildStats_(jobs, bins, invoices, today, trips) {
  const ym = today.slice(0, 7);
  const byService = { Lorry: 0, Mover: 0, Rorobin: 0 };
  const jobsByService = { Lorry: 0, Mover: 0, Rorobin: 0 };
  let monthRevenue = 0, openJobs = 0, internalJobs = 0;
  let tonsTipped = 0, tipFees = 0, awaitingTipping = 0;
  jobs.forEach(function (j) {
    if (j.status === 'Cancelled') return;
    jobsByService[j.service] = (jobsByService[j.service] || 0) + 1;
    byService[j.service] = (byService[j.service] || 0) + j.amount;
    if ((j.startDateTime || '').slice(0, 7) === ym) monthRevenue += j.amount;
    if (JOB_OPEN_STATUSES.indexOf(j.status) >= 0) openJobs++;
    if (j.internalUse) internalJobs++;
    if (j.service === 'Rorobin') {
      if (j.tippingDate) { tonsTipped += num_(j.weightTons); tipFees += num_(j.tipFee); }
      else if (j.collectDateTime) awaitingTipping++;
    }
  });

  let outstanding = 0, overdueAmt = 0, overdueCount = 0, collected = 0;
  invoices.forEach(function (inv) {
    if (inv.payStatus === 'Void') return;
    outstanding += inv.balance;
    if (inv.overdue) { overdueAmt += inv.balance; overdueCount++; }
  });
  readSheet_(SHEETS.PAYMENTS).map(normPayment_).forEach(function (p) {
    if ((p.payDate || '').slice(0, 7) === ym) collected += p.amount;
  });

  const binsTotal = bins.length;
  const binsOut = bins.filter(function (b) { return b.live === 'Deployed'; }).length;
  const binOverstay = jobs.filter(function (j) { return j.service === 'Rorobin' && j.overstay; }).length;
  const photoGaps = jobs.filter(function (j) { return j.status !== 'Cancelled' && !j.photoComplete; }).length;

  trips = trips || [];
  const runsToday = trips.filter(function (t) { return (t.tripDate || '').slice(0, 10) === today; }).length;
  let monthMargin = 0;
  trips.forEach(function (t) { if ((t.tripDate || '').slice(0, 7) === ym && t.status !== 'Cancelled') monthMargin += (t.margin || 0); });

  return {
    openJobs: openJobs,
    jobsByService: jobsByService,
    revenueByService: { Lorry: round2_(byService.Lorry), Mover: round2_(byService.Mover), Rorobin: round2_(byService.Rorobin) },
    monthRevenue: round2_(monthRevenue),
    outstanding: round2_(outstanding), overdueAmt: round2_(overdueAmt), overdueCount: overdueCount,
    collectedThisMonth: round2_(collected),
    binsTotal: binsTotal, binsOut: binsOut, binsFree: binsTotal - binsOut,
    binOverstay: binOverstay, photoGaps: photoGaps,
    runsToday: runsToday, monthMargin: round2_(monthMargin),
    internalJobs: internalJobs, awaitingTipping: awaitingTipping,
    tonsTipped: round2_(tonsTipped), tipFees: round2_(tipFees)
  };
}

function buildAlerts_(jobs, invoices, today, cfg) {
  const out = [];
  jobs.forEach(function (j) {
    if (j.service === 'Rorobin' && j.overstay) {
      out.push({ kind: 'bin', level: 'expired', id: j.id,
        who: 'Bin ' + (j.binNo || '?') + ' · ' + j.clientCompany,
        msg: 'OVERSTAY — out ' + (j.daysOut != null ? j.daysOut + 'd' : '') + ', collect by ' + j.collectBy });
    }
  });
  jobs.forEach(function (j) {
    if (j.status !== 'Cancelled' && !j.photoComplete && JOB_DONE_STATUSES.indexOf(j.status) >= 0) {
      out.push({ kind: 'photo', level: 'expiring', id: j.id,
        who: j.engagementRef + ' · ' + j.service,
        msg: 'completed but missing photos: ' + j.missingStages.join(', ') });
    }
  });
  const dueSoon = Number(cfg.INVOICE_DUE_SOON_DAYS) || 5;
  invoices.forEach(function (inv) {
    if (inv.payStatus === 'Void' || inv.balance <= 0.005 || !inv.dueDate) return;
    const d = daysBetween_(today, inv.dueDate);
    if (d < 0) out.push({ kind: 'invoice', level: 'expired', id: inv.id, who: inv.invNo + ' · ' + inv.clientCompany,
      msg: 'overdue ' + (-d) + 'd · ' + money_(inv.balance) });
    else if (d <= dueSoon) out.push({ kind: 'invoice', level: 'expiring', id: inv.id, who: inv.invNo + ' · ' + inv.clientCompany,
      msg: 'due in ' + d + 'd · ' + money_(inv.balance) });
  });
  return out;
}

/* ===================== NORMALISERS ===================== */
function normClient_(c) {
  return { id: str_(c.id), company: str_(c.company), regNo: str_(c.regNo), pic: str_(c.pic),
    contact: str_(c.contact), email: str_(c.email), address: str_(c.address), notes: str_(c.notes),
    createdBy: str_(c.createdBy), createdAt: str_(c.createdAt) };
}
function normEngagement_(e) {
  return { id: str_(e.id), ref: str_(e.ref), clientId: str_(e.clientId), clientCompany: str_(e.clientCompany),
    reason: str_(e.reason) || 'Ad-hoc', siteName: str_(e.siteName), siteAddress: str_(e.siteAddress),
    status: str_(e.status) || 'Open', handledBy: str_(e.handledBy), remarks: str_(e.remarks),
    createdBy: str_(e.createdBy), createdAt: str_(e.createdAt), updatedBy: str_(e.updatedBy), updatedAt: str_(e.updatedAt) };
}
function normJob_(j) {
  return { id: str_(j.id), engagementId: str_(j.engagementId), engagementRef: str_(j.engagementRef),
    clientId: str_(j.clientId), clientCompany: str_(j.clientCompany), service: str_(j.service),
    status: str_(j.status) || 'Scheduled', startDateTime: str_(j.startDateTime), endDateTime: str_(j.endDateTime),
    fromLocation: str_(j.fromLocation), toLocation: str_(j.toLocation),
    lorryType: str_(j.lorryType), lorryPlate: str_(j.lorryPlate), driver: str_(j.driver), trips: num_(j.trips),
    collectionMoverBy: str_(j.collectionMoverBy), deliveryMoverBy: str_(j.deliveryMoverBy),
    movers: num_(j.movers), shifts: num_(j.shifts), itemsDescription: str_(j.itemsDescription),
    binId: str_(j.binId), binNo: str_(j.binNo), placementType: str_(j.placementType),
    placeDateTime: str_(j.placeDateTime), collectDateTime: str_(j.collectDateTime),
    permitNo: str_(j.permitNo), swcorpRef: str_(j.swcorpRef), maxDays: num_(j.maxDays),
    rateCode: str_(j.rateCode), rateLabel: str_(j.rateLabel), unitRate: num_(j.unitRate),
    quantity: num_(j.quantity), amount: num_(j.amount), invoiceId: str_(j.invoiceId),
    handledBy: str_(j.handledBy), remarks: str_(j.remarks),
    createdBy: str_(j.createdBy), createdAt: str_(j.createdAt), updatedBy: str_(j.updatedBy), updatedAt: str_(j.updatedAt),
    tripId: str_(j.tripId), stopSeq: num_(j.stopSeq),
    internalUse: bool_(j.internalUse), landfill: str_(j.landfill), weightTons: num_(j.weightTons),
    tipFee: num_(j.tipFee), tippingDate: str_(j.tippingDate), tippingReceiptUrl: str_(j.tippingReceiptUrl),
    stopsJson: str_(j.stopsJson), stops: parseStops_(j.stopsJson) };
}
function parseStops_(s) { try { return s ? JSON.parse(s) : []; } catch (e) { return []; } }
function normWorker_(w) {
  return { id: str_(w.id), name: str_(w.name), phone: str_(w.phone),
    role: str_(w.role) || 'Mover', payType: str_(w.payType) || 'Per-shift',
    dayRate: num_(w.dayRate), nightRate: num_(w.nightRate), monthlySalary: num_(w.monthlySalary),
    active: w.active === '' ? true : bool_(w.active), notes: str_(w.notes) };
}
function normLorry_(l) {
  return { id: str_(l.id), plateNo: str_(l.plateNo), code: str_(l.code), type: str_(l.type),
    capacity: str_(l.capacity), category: str_(l.category) || 'in-house',
    active: l.active === '' ? true : bool_(l.active), notes: str_(l.notes) };
}
function normTrip_(t) {
  let crew = [];
  try { crew = t.crewJson ? JSON.parse(t.crewJson) : []; } catch (e) { crew = []; }
  return { id: str_(t.id), ref: str_(t.ref), tripDate: str_(t.tripDate), shift: str_(t.shift) || 'Day',
    lorryPlate: str_(t.lorryPlate), driver: str_(t.driver), driverId: str_(t.driverId),
    driverCost: num_(t.driverCost), lorryCost: num_(t.lorryCost),
    crew: crew, status: str_(t.status) || 'Planned', notes: str_(t.notes),
    createdBy: str_(t.createdBy), createdAt: str_(t.createdAt), updatedBy: str_(t.updatedBy), updatedAt: str_(t.updatedAt) };
}
function normBin_(b) {
  return { id: str_(b.id), binNo: str_(b.binNo), swcorpReg: str_(b.swcorpReg), size: str_(b.size),
    status: str_(b.status) || 'Available', notes: str_(b.notes) };
}
function normRate_(r) {
  return { id: str_(r.id), service: str_(r.service), code: str_(r.code), label: str_(r.label),
    unit: str_(r.unit), rate: num_(r.rate), active: bool_(r.active) };
}
function normInvoice_(i) {
  return { id: str_(i.id), invNo: str_(i.invNo), engagementId: str_(i.engagementId), engagementRef: str_(i.engagementRef),
    clientId: str_(i.clientId), clientCompany: str_(i.clientCompany), invDate: dateStr_(i.invDate), dueDate: dateStr_(i.dueDate),
    description: str_(i.description), amount: num_(i.amount), sstEnabled: bool_(i.sstEnabled),
    sstAmount: num_(i.sstAmount), total: num_(i.total), status: str_(i.status),
    fileUrl: str_(i.fileUrl), fileId: str_(i.fileId), notes: str_(i.notes),
    createdBy: str_(i.createdBy), createdAt: str_(i.createdAt) };
}
function normPayment_(p) {
  return { id: str_(p.id), invoiceId: str_(p.invoiceId), payDate: dateStr_(p.payDate), amount: num_(p.amount),
    method: str_(p.method), reference: str_(p.reference), receivedBy: str_(p.receivedBy), notes: str_(p.notes) };
}
function normPhoto_(p) {
  return { id: str_(p.id), jobId: str_(p.jobId), engagementId: str_(p.engagementId), service: str_(p.service),
    stage: str_(p.stage), url: str_(p.url), fileId: str_(p.fileId), caption: str_(p.caption),
    takenBy: str_(p.takenBy), takenAt: str_(p.takenAt) };
}

/* ===================== CLIENTS ===================== */
function saveClient(p) {
  const user = requireDomain_();
  if (!p.company) throw new Error('Client company is required.');
  const now = nowIso_();
  if (p.id) {
    const ex = readSheet_(SHEETS.CLIENTS).map(normClient_).filter(function (c) { return c.id === p.id; })[0];
    if (!ex) throw new Error('Client not found.');
    const rec = clientRow_(Object.assign({}, ex, p, { id: p.id, createdAt: ex.createdAt, createdBy: ex.createdBy, updatedAt: now }));
    updateRecord_(SHEETS.CLIENTS, rec);
    logAudit_('UPDATE', 'Client', p.id, p.company);
  } else {
    const rec = clientRow_(Object.assign({}, p, { id: uid_(), createdAt: now, createdBy: user, updatedAt: now }));
    appendRecord_(SHEETS.CLIENTS, rec);
    logAudit_('CREATE', 'Client', rec.id, p.company);
  }
  return bootstrap();
}
function clientRow_(c) {
  return { id: c.id, company: c.company || '', regNo: c.regNo || '', pic: c.pic || '', contact: c.contact || '',
    email: c.email || '', address: c.address || '', notes: c.notes || '',
    createdAt: c.createdAt || '', createdBy: c.createdBy || '', updatedAt: c.updatedAt || '' };
}
function deleteClient(id) {
  requireDomain_();
  const used = readSheet_(SHEETS.ENGAGEMENTS).map(normEngagement_).some(function (e) { return e.clientId === id; });
  if (used) throw new Error('Client has engagements — cannot delete.');
  deleteRowsWhere_(SHEETS.CLIENTS, 1, [id]);
  logAudit_('DELETE', 'Client', id, '');
  return bootstrap();
}

/* ===================== ENGAGEMENTS ===================== */
function saveEngagement(p) {
  const user = requireDomain_();
  const now = nowIso_();
  if (!p.clientId) throw new Error('Client is required.');
  const client = readSheet_(SHEETS.CLIENTS).map(normClient_).filter(function (c) { return c.id === p.clientId; })[0];
  if (!client) throw new Error('Client not found.');

  if (p.id) {
    const ex = readSheet_(SHEETS.ENGAGEMENTS).map(normEngagement_).filter(function (e) { return e.id === p.id; })[0];
    if (!ex) throw new Error('Engagement not found.');
    const rec = engagementRow_(Object.assign({}, ex, p, {
      id: p.id, ref: ex.ref, clientCompany: client.company,
      createdAt: ex.createdAt, createdBy: ex.createdBy, updatedAt: now, updatedBy: user }));
    updateRecord_(SHEETS.ENGAGEMENTS, rec);
    // keep job denormalised client name in sync
    syncJobsClient_(p.id, client.company, p.clientId);
    logAudit_('UPDATE', 'Engagement', ex.ref, client.company);
    return bootstrap();
  }
  const ref = nextEngRef_();
  const rec = engagementRow_(Object.assign({}, p, {
    id: uid_(), ref: ref, clientCompany: client.company, status: p.status || 'Open',
    handledBy: p.handledBy || user, createdAt: now, createdBy: user, updatedAt: now, updatedBy: user }));
  appendRecord_(SHEETS.ENGAGEMENTS, rec);
  logAudit_('CREATE', 'Engagement', ref, client.company + ' / ' + (p.reason || 'Ad-hoc'));
  return { db: bootstrap(), newEngagementId: rec.id };
}
function engagementRow_(e) {
  return { id: e.id, ref: e.ref, clientId: e.clientId || '', clientCompany: e.clientCompany || '',
    reason: e.reason || 'Ad-hoc', siteName: e.siteName || '', siteAddress: e.siteAddress || '',
    status: e.status || 'Open', handledBy: e.handledBy || '', remarks: e.remarks || '',
    createdAt: e.createdAt || '', createdBy: e.createdBy || '', updatedAt: e.updatedAt || '', updatedBy: e.updatedBy || '' };
}
function syncJobsClient_(engId, company, clientId) {
  const sheet = ss_().getSheetByName(SHEETS.JOBS);
  const last = sheet.getLastRow();
  if (last < 2) return;
  const engCol = HEADERS.Jobs.indexOf('engagementId') + 1;
  const ccCol = HEADERS.Jobs.indexOf('clientCompany') + 1;
  const ciCol = HEADERS.Jobs.indexOf('clientId') + 1;
  const ids = sheet.getRange(2, engCol, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(engId)) {
    sheet.getRange(i + 2, ccCol).setValue(company);
    sheet.getRange(i + 2, ciCol).setValue(clientId);
  }
}
function setEngagementStatus(id, status, remarks) {
  requireDomain_();
  const ex = readSheet_(SHEETS.ENGAGEMENTS).map(normEngagement_).filter(function (e) { return e.id === id; })[0];
  if (!ex) throw new Error('Engagement not found.');
  ex.status = status;
  if (remarks) ex.remarks = (ex.remarks ? ex.remarks + ' | ' : '') + remarks;
  ex.updatedBy = requireDomain_(); ex.updatedAt = nowIso_();
  updateRecord_(SHEETS.ENGAGEMENTS, engagementRow_(ex));
  logAudit_('STATUS', 'Engagement', ex.ref, status + (remarks ? ' :: ' + remarks : ''));
  return bootstrap();
}
function deleteEngagement(id) {
  requireDomain_();
  const jobs = readSheet_(SHEETS.JOBS).map(normJob_).filter(function (j) { return j.engagementId === id; });
  if (jobs.length) throw new Error('Engagement has ' + jobs.length + ' job(s). Delete the jobs first.');
  const invs = readSheet_(SHEETS.INVOICES).map(normInvoice_).filter(function (i) { return i.engagementId === id; });
  if (invs.length) throw new Error('Engagement has invoice(s). Void/delete those first.');
  const ref = (readSheet_(SHEETS.ENGAGEMENTS).map(normEngagement_).filter(function (e) { return e.id === id; })[0] || {}).ref || id;
  deleteRowsWhere_(SHEETS.ENGAGEMENTS, 1, [id]);
  logAudit_('DELETE', 'Engagement', ref, '');
  return bootstrap();
}
function nextEngRef_() {
  const cfg = getConfig_();
  const prefix = cfg.ENG_PREFIX || 'ENG-';
  const existing = {};
  readSheet_(SHEETS.ENGAGEMENTS).forEach(function (e) { existing[String(e.ref).toLowerCase()] = true; });
  let seq = Number(cfg.ENG_SEQ) || 0, ref;
  do { seq++; ref = prefix + ('0000' + seq).slice(-4); } while (existing[ref.toLowerCase()]);
  setConfigValue_('ENG_SEQ', seq);
  return ref;
}

/* ===================== JOBS ===================== */
function saveJob(p) {
  const user = requireDomain_();
  const now = nowIso_();
  if (!p.engagementId) throw new Error('Engagement is required.');
  if (SERVICES.indexOf(p.service) < 0) throw new Error('Pick a valid service.');
  const eng = readSheet_(SHEETS.ENGAGEMENTS).map(normEngagement_).filter(function (e) { return e.id === p.engagementId; })[0];
  if (!eng) throw new Error('Engagement not found.');

  const internal = bool_(p.internalUse);
  // charge can be KEYED directly (manualAmount) — rate just pre-fills a suggestion
  const hasManual = !internal && p.manualAmount !== undefined && p.manualAmount !== null && String(p.manualAmount) !== '';

  // rate-card lookup. Optional when a charge is keyed, or for internal-use jobs.
  let rate = readSheet_(SHEETS.RATES).map(normRate_).filter(function (r) { return r.code === p.rateCode; })[0] || null;
  if (!internal && !hasManual) {
    if (!rate) throw new Error('Pick a rate or key a charge amount.');
    if (!rate.active) throw new Error('Rate ' + rate.code + ' is inactive — pick an active rate.');
    if (rate.service !== p.service) throw new Error('Rate ' + rate.code + ' is for ' + rate.service + ', not ' + p.service + '.');
  }

  // quantity per service
  let quantity;
  if (p.service === 'Lorry') quantity = Math.max(1, num_(p.trips) || 1);
  else if (p.service === 'Mover') quantity = Math.max(1, (num_(p.movers) || 1) * (num_(p.shifts) || 1));
  else quantity = Math.max(1, num_(p.quantity) || 1);   // Rorobin: placements (usually 1)
  const amount = internal ? 0 : (hasManual ? round2_(num_(p.manualAmount)) : round2_((rate ? rate.rate : 0) * quantity));

  // rorobin bin handling
  let binId = p.binId || '', binNo = p.binNo || '';
  if (p.service === 'Rorobin') {
    if (!binId) throw new Error('Select a rorobin bin.');
    const bin = readSheet_(SHEETS.BINS).map(normBin_).filter(function (b) { return b.id === binId; })[0];
    if (!bin) throw new Error('Bin not found.');
    binNo = bin.binNo;
    if (!p.collectDateTime && JOB_DONE_STATUSES.indexOf(p.status) < 0) {
      // clash: same bin already out on another open job
      const clash = readSheet_(SHEETS.JOBS).map(normJob_).filter(function (j) {
        return j.service === 'Rorobin' && j.binId === binId && j.id !== p.id &&
          JOB_DONE_STATUSES.indexOf(j.status) < 0 && !j.collectDateTime;
      });
      if (clash.length) throw new Error('Bin ' + binNo + ' is already deployed (' + clash[0].engagementRef + '). Collect it first.');
    }
  }

  // multi-stop legs (lorry): clean + derive the summary from/to/time for lists & reports
  const stops = (p.stops || []).filter(function (s) {
    return s && (s.client || s.pickupLocation || s.deliveryLocation || s.notes || s.pickupDateTime || s.deliveryDateTime);
  }).map(function (s) {
    return { client: String(s.client || ''), pickupLocation: String(s.pickupLocation || ''), pickupDateTime: String(s.pickupDateTime || ''),
      deliveryLocation: String(s.deliveryLocation || ''), deliveryDateTime: String(s.deliveryDateTime || ''), notes: String(s.notes || '') };
  });
  if (p.service === 'Lorry' && stops.length) {
    const first = stops[0], last = stops[stops.length - 1];
    if (!p.startDateTime) p.startDateTime = first.pickupDateTime || '';
    if (!p.endDateTime) p.endDateTime = last.deliveryDateTime || '';
    if (!p.fromLocation) p.fromLocation = first.pickupLocation || '';
    if (!p.toLocation) p.toLocation = last.deliveryLocation || '';
  }

  const base = {
    engagementId: p.engagementId, engagementRef: eng.ref, clientId: eng.clientId, clientCompany: eng.clientCompany,
    service: p.service, status: p.status || 'Scheduled', stopsJson: JSON.stringify(stops),
    startDateTime: p.startDateTime || '', endDateTime: p.endDateTime || '',
    fromLocation: p.fromLocation || '', toLocation: p.toLocation || '',
    lorryType: p.lorryType || '', lorryPlate: p.lorryPlate || '', driver: p.driver || '', trips: num_(p.trips),
    collectionMoverBy: p.collectionMoverBy || '', deliveryMoverBy: p.deliveryMoverBy || '',
    movers: num_(p.movers), shifts: num_(p.shifts), itemsDescription: p.itemsDescription || '',
    binId: binId, binNo: binNo, placementType: p.placementType || '',
    placeDateTime: p.placeDateTime || '', collectDateTime: p.collectDateTime || '',
    permitNo: p.permitNo || '', swcorpRef: p.swcorpRef || '',
    maxDays: num_(p.maxDays) || Number(getConfig_().ROROBIN_MAX_DAYS) || 3,
    rateCode: rate ? rate.code : '', rateLabel: internal ? 'Internal use (no charge)' : (rate ? rate.label : (hasManual ? 'Keyed charge' : '')),
    unitRate: rate ? rate.rate : 0, quantity: quantity, amount: amount, internalUse: internal,
    handledBy: p.handledBy || eng.handledBy || user, remarks: p.remarks || ''
  };

  if (p.id) {
    const ex = readSheet_(SHEETS.JOBS).map(normJob_).filter(function (j) { return j.id === p.id; })[0];
    if (!ex) throw new Error('Job not found.');
    if (ex.invoiceId) throw new Error('Job is already on invoice — void/unlink the invoice before editing the charge.');
    base.id = p.id; base.invoiceId = ex.invoiceId || '';
    base.tripId = ex.tripId || ''; base.stopSeq = ex.stopSeq || '';
    // tipping fields are managed by tipRorobin() — preserve them across a form edit
    base.landfill = ex.landfill || ''; base.weightTons = ex.weightTons || ''; base.tipFee = ex.tipFee || '';
    base.tippingDate = ex.tippingDate || ''; base.tippingReceiptUrl = ex.tippingReceiptUrl || '';
    base.createdAt = ex.createdAt; base.createdBy = ex.createdBy; base.updatedAt = now; base.updatedBy = user;
    updateRecord_(SHEETS.JOBS, jobRow_(base));
    logAudit_('UPDATE', 'Job', eng.ref + '/' + p.service, internal ? 'Internal (no charge)' : money_(amount));
  } else {
    base.id = uid_(); base.invoiceId = ''; base.tripId = ''; base.stopSeq = '';
    base.landfill = ''; base.weightTons = ''; base.tipFee = ''; base.tippingDate = ''; base.tippingReceiptUrl = '';
    base.createdAt = now; base.createdBy = user; base.updatedAt = now; base.updatedBy = user;
    appendRecord_(SHEETS.JOBS, jobRow_(base));
    logAudit_('CREATE', 'Job', eng.ref + '/' + p.service, internal ? 'Internal (no charge)' : money_(amount) + ' (' + (rate ? rate.code : '-') + ' ×' + quantity + ')');
  }
  return bootstrap();
}
function jobRow_(j) {
  const o = {};
  HEADERS.Jobs.forEach(function (h) { o[h] = j[h] === undefined ? '' : j[h]; });
  return o;
}
function setJobStatus(id, status, remarks) {
  requireDomain_();
  const j = readSheet_(SHEETS.JOBS).map(normJob_).filter(function (x) { return x.id === id; })[0];
  if (!j) throw new Error('Job not found.');
  j.status = status;
  if (remarks) j.remarks = (j.remarks ? j.remarks + ' | ' : '') + remarks;
  j.updatedBy = requireDomain_(); j.updatedAt = nowIso_();
  updateRecord_(SHEETS.JOBS, jobRow_(j));
  logAudit_('STATUS', 'Job', j.engagementRef + '/' + j.service, status);
  return bootstrap();
}
function collectBin(jobId, collectDateTime) {
  requireDomain_();
  const j = readSheet_(SHEETS.JOBS).map(normJob_).filter(function (x) { return x.id === jobId; })[0];
  if (!j) throw new Error('Job not found.');
  if (j.service !== 'Rorobin') throw new Error('Not a rorobin job.');
  j.collectDateTime = collectDateTime || nowIso_();
  if (JOB_OPEN_STATUSES.indexOf(j.status) >= 0) j.status = 'Completed';
  j.updatedBy = requireDomain_(); j.updatedAt = nowIso_();
  updateRecord_(SHEETS.JOBS, jobRow_(j));
  logAudit_('BIN_COLLECT', 'Job', j.engagementRef + '/Bin ' + j.binNo, j.collectDateTime);
  return bootstrap();
}
/** Record legal landfill tipping for a collected rorobin bin (ESG closure). */
function tipRorobin(p) {
  const user = requireDomain_();
  const j = readSheet_(SHEETS.JOBS).map(normJob_).filter(function (x) { return x.id === p.jobId; })[0];
  if (!j) throw new Error('Job not found.');
  if (j.service !== 'Rorobin') throw new Error('Not a rorobin job.');
  if (!j.collectDateTime) throw new Error('Collect the bin before recording tipping.');
  j.tippingDate = p.tippingDate || todayISO_();
  j.landfill = p.landfill || j.landfill || '';
  j.weightTons = num_(p.weightTons);
  j.tipFee = num_(p.tipFee);
  if (p.receiptFile && p.receiptFile.base64) {
    j.tippingReceiptUrl = uploadFile_(SUBFOLDERS.INVOICES, 'TipReceipt-' + (j.binNo || '') + '-' + j.engagementRef, p.receiptFile).url;
  }
  if (JOB_OPEN_STATUSES.indexOf(j.status) >= 0) j.status = 'Completed';
  j.updatedBy = user; j.updatedAt = nowIso_();
  updateRecord_(SHEETS.JOBS, jobRow_(j));
  logAudit_('TIPPING', 'Job', j.engagementRef + '/Bin ' + j.binNo,
    j.weightTons + 't @ ' + (j.landfill || '-') + ' · fee ' + money_(j.tipFee));
  return bootstrap();
}
function deleteJob(id) {
  requireDomain_();
  const j = readSheet_(SHEETS.JOBS).map(normJob_).filter(function (x) { return x.id === id; })[0];
  if (!j) throw new Error('Job not found.');
  if (j.invoiceId) throw new Error('Job is on an invoice — void/delete that invoice first.');
  const photos = readSheet_(SHEETS.PHOTOS).map(normPhoto_).filter(function (ph) { return ph.jobId === id; });
  photos.forEach(function (ph) { trashFile_(ph.fileId); });
  deleteRowsWhere_(SHEETS.PHOTOS, 2, [id]);
  deleteRowsWhere_(SHEETS.JOBS, 1, [id]);
  logAudit_('DELETE', 'Job', (j.engagementRef || '') + '/' + j.service, '');
  return bootstrap();
}

/* ===================== BINS ===================== */
function saveBin(p) {
  requireDomain_();
  if (!p.binNo) throw new Error('Bin number is required.');
  const now = nowIso_();
  const dup = readSheet_(SHEETS.BINS).map(normBin_).filter(function (b) {
    return b.binNo.toLowerCase() === String(p.binNo).toLowerCase() && b.id !== p.id;
  });
  if (dup.length) throw new Error('Bin number ' + p.binNo + ' already exists.');
  const rec = { id: p.id || uid_(), binNo: String(p.binNo).trim(), swcorpReg: p.swcorpReg || '',
    size: p.size || '', status: p.status || 'Available', notes: p.notes || '', updatedAt: now };
  if (p.id && updateRecord_(SHEETS.BINS, rec)) logAudit_('UPDATE', 'Bin', rec.binNo, rec.size);
  else { appendRecord_(SHEETS.BINS, rec); logAudit_('CREATE', 'Bin', rec.binNo, rec.size); }
  return bootstrap();
}
function deleteBin(id) {
  requireDomain_();
  const used = readSheet_(SHEETS.JOBS).map(normJob_).some(function (j) {
    return j.binId === id && JOB_DONE_STATUSES.indexOf(j.status) < 0 && !j.collectDateTime;
  });
  if (used) throw new Error('Bin is currently deployed — collect it before deleting.');
  deleteRowsWhere_(SHEETS.BINS, 1, [id]);
  logAudit_('DELETE', 'Bin', id, '');
  return bootstrap();
}

/* ===================== RATES (rate card) ===================== */
function saveRate(p) {
  requireDomain_();
  if (SERVICES.indexOf(p.service) < 0) throw new Error('Pick a valid service.');
  if (!p.code) throw new Error('Rate code is required.');
  if (!p.label) throw new Error('Rate label is required.');
  const dup = readSheet_(SHEETS.RATES).map(normRate_).filter(function (r) {
    return r.code.toLowerCase() === String(p.code).toLowerCase() && r.id !== p.id;
  });
  if (dup.length) throw new Error('Rate code ' + p.code + ' already exists.');
  const rec = { id: p.id || uid_(), service: p.service, code: String(p.code).trim().toUpperCase(),
    label: p.label, unit: p.unit || 'per unit', rate: round2_(num_(p.rate)),
    active: p.active === false ? false : true, updatedAt: nowIso_() };
  if (p.id && updateRecord_(SHEETS.RATES, rec)) logAudit_('UPDATE', 'Rate', rec.code, money_(rec.rate));
  else { appendRecord_(SHEETS.RATES, rec); logAudit_('CREATE', 'Rate', rec.code, money_(rec.rate)); }
  return bootstrap();
}
function deleteRate(id) {
  requireDomain_();
  deleteRowsWhere_(SHEETS.RATES, 1, [id]);
  logAudit_('DELETE', 'Rate', id, '');
  return bootstrap();
}

/* ===================== WORKERS (mover roster, shift pay) ===================== */
function saveWorker(p) {
  requireDomain_();
  if (!p.name) throw new Error('Worker name is required.');
  const dup = readSheet_(SHEETS.WORKERS).map(normWorker_).filter(function (w) {
    return w.name.toLowerCase() === String(p.name).toLowerCase() && w.id !== p.id;
  });
  if (dup.length) throw new Error('Worker "' + p.name + '" already exists.');
  const rec = { id: p.id || uid_(), name: String(p.name).trim(), phone: p.phone || '',
    role: p.role || 'Mover', payType: p.payType === 'Monthly' ? 'Monthly' : 'Per-shift',
    dayRate: round2_(num_(p.dayRate)), nightRate: round2_(num_(p.nightRate)), monthlySalary: round2_(num_(p.monthlySalary)),
    active: p.active === false ? false : true, notes: p.notes || '', updatedAt: nowIso_() };
  const tag = rec.payType === 'Monthly' ? 'monthly ' + money_(rec.monthlySalary) : 'day ' + money_(rec.dayRate) + ' / night ' + money_(rec.nightRate);
  if (p.id && updateRecord_(SHEETS.WORKERS, rec)) logAudit_('UPDATE', 'Worker', rec.name, rec.role + ' · ' + tag);
  else { appendRecord_(SHEETS.WORKERS, rec); logAudit_('CREATE', 'Worker', rec.name, rec.role + ' · ' + tag); }
  return bootstrap();
}
function deleteWorker(id) {
  requireDomain_();
  deleteRowsWhere_(SHEETS.WORKERS, 1, [id]);
  logAudit_('DELETE', 'Worker', id, '');
  return bootstrap();
}

/* ===================== LORRY FLEET ===================== */
function saveLorry(p) {
  requireDomain_();
  if (!p.plateNo) throw new Error('Plate number is required.');
  const dup = readSheet_(SHEETS.LORRIES).map(normLorry_).filter(function (l) {
    return l.plateNo.toLowerCase() === String(p.plateNo).toLowerCase() && l.id !== p.id;
  });
  if (dup.length) throw new Error('Lorry ' + p.plateNo + ' already exists.');
  const rec = { id: p.id || uid_(), plateNo: String(p.plateNo).trim(), code: p.code || '', type: p.type || '',
    capacity: p.capacity || '', category: p.category === 'outsource' ? 'outsource' : 'in-house',
    active: p.active === false ? false : true, notes: p.notes || '', updatedAt: nowIso_() };
  if (p.id && updateRecord_(SHEETS.LORRIES, rec)) logAudit_('UPDATE', 'Lorry', rec.plateNo, rec.code + ' · ' + rec.category);
  else { appendRecord_(SHEETS.LORRIES, rec); logAudit_('CREATE', 'Lorry', rec.plateNo, rec.code + ' · ' + rec.category); }
  return bootstrap();
}
function deleteLorry(id) {
  requireDomain_();
  deleteRowsWhere_(SHEETS.LORRIES, 1, [id]);
  logAudit_('DELETE', 'Lorry', id, '');
  return bootstrap();
}

/* ===================== TRIPS / RUNS (shared lorry dispatch) ===================== */
/**
 * A Trip = one lorry + driver + crew on a date, serving several client stops.
 * Client billing is unchanged (each stop's job keeps its normal rate). The trip
 * captures HG's real cost (driver + crew shift pay + lorry) so the saving/margin
 * on a shared run is visible. p.crew = [{workerId?,name,shift,rate}].
 */
function saveTrip(p) {
  const user = requireDomain_();
  const now = nowIso_();
  const crew = (p.crew || []).filter(function (c) { return c && c.name; }).map(function (c) {
    return { workerId: c.workerId || '', name: String(c.name).trim(), shift: c.shift === 'Night' ? 'Night' : 'Day',
      rate: round2_(num_(c.rate)), payType: c.payType === 'Monthly' ? 'Monthly' : 'Per-shift' };
  });
  const base = { tripDate: p.tripDate || todayISO_(), shift: p.shift === 'Night' ? 'Night' : 'Day',
    lorryPlate: p.lorryPlate || '', driver: p.driver || '', driverId: p.driverId || '', driverCost: round2_(num_(p.driverCost)),
    lorryCost: round2_(num_(p.lorryCost)), crewJson: JSON.stringify(crew),
    status: p.status || 'Planned', notes: p.notes || '' };
  if (p.id) {
    const ex = readSheet_(SHEETS.TRIPS).map(normTrip_).filter(function (t) { return t.id === p.id; })[0];
    if (!ex) throw new Error('Trip not found.');
    base.id = p.id; base.ref = ex.ref; base.createdAt = ex.createdAt; base.createdBy = ex.createdBy;
    base.updatedAt = now; base.updatedBy = user;
    updateRecord_(SHEETS.TRIPS, base);
    logAudit_('UPDATE', 'Trip', ex.ref, (p.lorryPlate || '') + ' · ' + crew.length + ' crew');
    return bootstrap();
  }
  base.id = uid_(); base.ref = nextTripRef_();
  base.createdAt = now; base.createdBy = user; base.updatedAt = now; base.updatedBy = user;
  appendRecord_(SHEETS.TRIPS, base);
  logAudit_('CREATE', 'Trip', base.ref, (p.lorryPlate || '') + ' · ' + crew.length + ' crew');
  return { db: bootstrap(), newTripId: base.id };
}
function setTripStatus(id, status, remarks) {
  requireDomain_();
  const t = readSheet_(SHEETS.TRIPS).map(normTrip_).filter(function (x) { return x.id === id; })[0];
  if (!t) throw new Error('Trip not found.');
  const row = tripRow_(t); row.status = status; row.notes = remarks ? ((t.notes ? t.notes + ' | ' : '') + remarks) : t.notes;
  row.updatedBy = requireDomain_(); row.updatedAt = nowIso_();
  updateRecord_(SHEETS.TRIPS, row);
  logAudit_('STATUS', 'Trip', t.ref, status);
  return bootstrap();
}
function deleteTrip(id) {
  requireDomain_();
  const t = readSheet_(SHEETS.TRIPS).map(normTrip_).filter(function (x) { return x.id === id; })[0];
  // unlink any stops
  const sheet = ss_().getSheetByName(SHEETS.JOBS);
  const last = sheet.getLastRow();
  if (last >= 2) {
    const tCol = HEADERS.Jobs.indexOf('tripId') + 1, sCol = HEADERS.Jobs.indexOf('stopSeq') + 1;
    const vals = sheet.getRange(2, tCol, last - 1, 1).getValues();
    for (let i = 0; i < vals.length; i++) if (String(vals[i][0]) === String(id)) { sheet.getRange(i + 2, tCol).setValue(''); sheet.getRange(i + 2, sCol).setValue(''); }
  }
  deleteRowsWhere_(SHEETS.TRIPS, 1, [id]);
  logAudit_('DELETE', 'Trip', (t ? t.ref : id), '');
  return bootstrap();
}
function tripRow_(t) {
  return { id: t.id, ref: t.ref, tripDate: t.tripDate || '', shift: t.shift || 'Day', lorryPlate: t.lorryPlate || '',
    driver: t.driver || '', driverId: t.driverId || '', driverCost: num_(t.driverCost), lorryCost: num_(t.lorryCost),
    crewJson: JSON.stringify(t.crew || []), status: t.status || 'Planned', notes: t.notes || '',
    createdAt: t.createdAt || '', createdBy: t.createdBy || '', updatedAt: t.updatedAt || '', updatedBy: t.updatedBy || '' };
}
/** Attach jobs to a trip as stops (appended after current max stopSeq). */
function assignJobsToTrip(tripId, jobIds) {
  requireDomain_();
  const t = readSheet_(SHEETS.TRIPS).map(normTrip_).filter(function (x) { return x.id === tripId; })[0];
  if (!t) throw new Error('Trip not found.');
  const all = readSheet_(SHEETS.JOBS).map(normJob_);
  let maxSeq = 0;
  all.forEach(function (j) { if (j.tripId === tripId && j.stopSeq > maxSeq) maxSeq = j.stopSeq; });
  const sheet = ss_().getSheetByName(SHEETS.JOBS);
  const last = sheet.getLastRow();
  const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  const tCol = HEADERS.Jobs.indexOf('tripId') + 1, sCol = HEADERS.Jobs.indexOf('stopSeq') + 1;
  (jobIds || []).forEach(function (jid) {
    const j = all.filter(function (x) { return x.id === jid; })[0];
    if (!j) return;
    if (j.tripId && j.tripId !== tripId) throw new Error('A job is already on another run (' + j.engagementRef + '). Remove it first.');
    for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(jid)) { sheet.getRange(i + 2, tCol).setValue(tripId); sheet.getRange(i + 2, sCol).setValue(++maxSeq); break; }
  });
  logAudit_('TRIP_ASSIGN', 'Trip', t.ref, (jobIds || []).length + ' stop(s)');
  return bootstrap();
}
function removeJobFromTrip(jobId) {
  requireDomain_();
  const sheet = ss_().getSheetByName(SHEETS.JOBS);
  const last = sheet.getLastRow();
  const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  const tCol = HEADERS.Jobs.indexOf('tripId') + 1, sCol = HEADERS.Jobs.indexOf('stopSeq') + 1;
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(jobId)) { sheet.getRange(i + 2, tCol).setValue(''); sheet.getRange(i + 2, sCol).setValue(''); break; }
  logAudit_('TRIP_REMOVE', 'Job', jobId, '');
  return bootstrap();
}
/** Reorder stops: orderedJobIds in the desired stop sequence. */
function setTripStopOrder(tripId, orderedJobIds) {
  requireDomain_();
  const sheet = ss_().getSheetByName(SHEETS.JOBS);
  const last = sheet.getLastRow();
  const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  const sCol = HEADERS.Jobs.indexOf('stopSeq') + 1;
  (orderedJobIds || []).forEach(function (jid, idx) {
    for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(jid)) { sheet.getRange(i + 2, sCol).setValue(idx + 1); break; }
  });
  return bootstrap();
}
function nextTripRef_() {
  const cfg = getConfig_();
  const prefix = cfg.TRIP_PREFIX || 'RUN-';
  const existing = {};
  readSheet_(SHEETS.TRIPS).forEach(function (t) { existing[String(t.ref).toLowerCase()] = true; });
  let seq = Number(cfg.TRIP_SEQ) || 0, ref;
  do { seq++; ref = prefix + ('0000' + seq).slice(-4); } while (existing[ref.toLowerCase()]);
  setConfigValue_('TRIP_SEQ', seq);
  return ref;
}

/* ----- Run-first billable STOP: add a client's lorry/mover leg directly inside a run -----
 * p = { tripId, clientId, lorry:bool, lorryCharge, mover:bool, moverCharge, workers:[],
 *       pickupLocation, pickupDateTime, deliveryLocation, deliveryDateTime, notes, status }
 * Creates one billable Job per service (separate charges), linked to the run, under the
 * client's auto "Transport" engagement so it can be invoiced per client.
 */
function addRunStop(p) {
  const user = requireDomain_();
  const now = nowIso_();
  const trip = readSheet_(SHEETS.TRIPS).map(normTrip_).filter(function (t) { return t.id === p.tripId; })[0];
  if (!trip) throw new Error('Run not found.');
  if (!p.clientId) throw new Error('Select a client for this stop.');
  const client = readSheet_(SHEETS.CLIENTS).map(normClient_).filter(function (c) { return c.id === p.clientId; })[0];
  if (!client) throw new Error('Client not found.');
  const lorryCharge = round2_(num_(p.lorryCharge));
  const moverCharge = round2_(num_(p.moverCharge));
  const internal = bool_(p.internalUse);
  const wantLorry = bool_(p.lorry) || lorryCharge > 0;
  const wantMover = bool_(p.mover) || moverCharge > 0;
  if (!wantLorry && !wantMover) throw new Error('Tick Lorry and/or Mover for this stop (with a charge, or mark internal).');

  const eng = findOrCreateTransportEngagement_(client, user);
  let maxSeq = 0;
  readSheet_(SHEETS.JOBS).map(normJob_).forEach(function (j) { if (j.tripId === p.tripId && j.stopSeq > maxSeq) maxSeq = j.stopSeq; });

  if (wantLorry) buildRunStopJob_(eng, client, 'Lorry', internal ? 0 : lorryCharge, internal, p, trip, ++maxSeq, user, now);
  if (wantMover) buildRunStopJob_(eng, client, 'Mover', internal ? 0 : moverCharge, internal, p, trip, ++maxSeq, user, now);
  logAudit_('RUN_STOP', 'Trip', trip.ref, client.company + ' ·' +
    (wantLorry ? ' Lorry ' + (internal ? 'internal' : money_(lorryCharge)) : '') +
    (wantMover ? ' Mover ' + (internal ? 'internal' : money_(moverCharge)) : ''));
  return bootstrap();
}
function findOrCreateTransportEngagement_(client, user) {
  const ex = readSheet_(SHEETS.ENGAGEMENTS).map(normEngagement_).filter(function (e) {
    return e.clientId === client.id && e.reason === 'Transport' && e.status !== 'Cancelled';
  })[0];
  if (ex) return ex;
  const now = nowIso_();
  const rec = engagementRow_({ id: uid_(), ref: nextEngRef_(), clientId: client.id, clientCompany: client.company,
    reason: 'Transport', status: 'Open', handledBy: user, remarks: 'Auto-created for transport runs',
    createdAt: now, createdBy: user, updatedAt: now, updatedBy: user });
  appendRecord_(SHEETS.ENGAGEMENTS, rec);
  logAudit_('CREATE', 'Engagement', rec.ref, client.company + ' / Transport (auto)');
  return normEngagement_(rec);
}
function buildRunStopJob_(eng, client, service, amount, internal, p, trip, stopSeq, user, now) {
  const rec = {};
  HEADERS.Jobs.forEach(function (h) { rec[h] = ''; });
  rec.id = uid_();
  rec.engagementId = eng.id; rec.engagementRef = eng.ref; rec.clientId = client.id; rec.clientCompany = client.company;
  rec.service = service; rec.status = p.status || 'Scheduled';
  rec.startDateTime = p.pickupDateTime || ''; rec.endDateTime = p.deliveryDateTime || '';
  rec.fromLocation = p.pickupLocation || ''; rec.toLocation = p.deliveryLocation || '';
  rec.itemsDescription = p.notes || '';
  rec.lorryPlate = trip.lorryPlate || ''; rec.driver = trip.driver || '';
  rec.trips = service === 'Lorry' ? 1 : 0;
  rec.movers = service === 'Mover' ? ((p.workers && p.workers.length) || num_(p.moverCount) || 1) : 0;
  rec.shifts = service === 'Mover' ? 1 : 0;
  if (service === 'Mover' && p.workers && p.workers.length) rec.remarks = 'Crew: ' + p.workers.join(', ');
  rec.quantity = 1; rec.unitRate = amount; rec.amount = round2_(amount); rec.rateLabel = internal ? 'Internal use (no charge)' : 'Keyed charge';
  rec.internalUse = internal;
  rec.handledBy = p.handledBy || trip.driver || user;
  rec.tripId = trip.id; rec.stopSeq = stopSeq; rec.stopsJson = '[]';
  rec.maxDays = ''; rec.weightTons = ''; rec.tipFee = '';
  rec.createdAt = now; rec.createdBy = user; rec.updatedAt = now; rec.updatedBy = user;
  appendRecord_(SHEETS.JOBS, rec);
  return rec;
}

/* ===================== INVOICES ===================== */
/**
 * Create/update an invoice covering one or more jobs in an engagement.
 * p = { id?, invNo, engagementId, jobIds:[], invDate, dueDate, sstEnabled, notes, status?, file? }
 * Amount auto-sums the selected jobs. Selected jobs get stamped invoiceId.
 */
function saveInvoice(p) {
  const user = requireDomain_();
  const now = nowIso_();
  if (!p.invNo) throw new Error('Invoice number is required.');
  if (!p.engagementId) throw new Error('Engagement is required.');
  if (!p.invDate) throw new Error('Invoice date is required.');
  if (!p.jobIds || !p.jobIds.length) throw new Error('Select at least one job to bill.');

  const eng = readSheet_(SHEETS.ENGAGEMENTS).map(normEngagement_).filter(function (e) { return e.id === p.engagementId; })[0];
  if (!eng) throw new Error('Engagement not found.');

  // unique invoice number
  const dup = readSheet_(SHEETS.INVOICES).map(normInvoice_).filter(function (i) {
    return i.invNo.toLowerCase() === String(p.invNo).toLowerCase() && i.id !== p.id;
  });
  if (dup.length) throw new Error('Invoice number ' + p.invNo + ' already exists.');

  const allJobs = readSheet_(SHEETS.JOBS).map(normJob_);
  const picked = allJobs.filter(function (j) { return p.jobIds.indexOf(j.id) >= 0; });
  if (picked.length !== p.jobIds.length) throw new Error('Some selected jobs were not found.');
  picked.forEach(function (j) {
    if (j.engagementId !== p.engagementId) throw new Error('Job ' + j.service + ' is not in this engagement.');
    if (j.invoiceId && j.invoiceId !== p.id) throw new Error('Job ' + j.engagementRef + '/' + j.service + ' is already on another invoice.');
  });

  const amount = round2_(picked.reduce(function (s, j) { return s + j.amount; }, 0));
  const sstEnabled = bool_(p.sstEnabled);
  const sstAmount = sstEnabled ? round2_(amount * SST_RATE) : 0;
  const total = round2_(amount + sstAmount);
  const desc = p.description || ('Engagement ' + eng.ref + ' — ' +
    picked.map(function (j) { return j.service; }).join(' + '));

  let fileUrl = p.fileUrl || '', fileId = p.fileId || '';
  if (p.file && p.file.base64) { const f = uploadFile_(SUBFOLDERS.INVOICES, p.invNo, p.file); fileUrl = f.url; fileId = f.id; }

  const base = { invNo: String(p.invNo).trim(), engagementId: p.engagementId, engagementRef: eng.ref,
    clientId: eng.clientId, clientCompany: eng.clientCompany, invDate: p.invDate, dueDate: p.dueDate || '',
    description: desc, amount: amount, sstEnabled: sstEnabled, sstAmount: sstAmount, total: total,
    status: p.status === 'Void' ? 'Void' : '', fileUrl: fileUrl, fileId: fileId, notes: p.notes || '' };

  let invId;
  if (p.id) {
    const ex = readSheet_(SHEETS.INVOICES).map(normInvoice_).filter(function (i) { return i.id === p.id; })[0];
    if (!ex) throw new Error('Invoice not found.');
    invId = p.id;
    base.id = p.id; base.createdAt = ex.createdAt; base.createdBy = ex.createdBy; base.updatedAt = now;
    updateRecord_(SHEETS.INVOICES, base);
    // re-stamp: clear previous links for this invoice, then set the picked ones
    clearInvoiceLinks_(p.id);
    logAudit_('UPDATE', 'Invoice', p.invNo, eng.clientCompany + ' / ' + money_(total));
  } else {
    invId = uid_();
    base.id = invId; base.createdAt = now; base.createdBy = user; base.updatedAt = now;
    appendRecord_(SHEETS.INVOICES, base);
    logAudit_('CREATE', 'Invoice', p.invNo, eng.clientCompany + ' / ' + money_(total));
  }
  stampJobsInvoice_(p.jobIds, invId);
  return bootstrap();
}
function stampJobsInvoice_(jobIds, invId) {
  const sheet = ss_().getSheetByName(SHEETS.JOBS);
  const last = sheet.getLastRow(); if (last < 2) return;
  const invCol = HEADERS.Jobs.indexOf('invoiceId') + 1;
  const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (jobIds.indexOf(String(ids[i][0])) >= 0) sheet.getRange(i + 2, invCol).setValue(invId);
}
function clearInvoiceLinks_(invId) {
  const sheet = ss_().getSheetByName(SHEETS.JOBS);
  const last = sheet.getLastRow(); if (last < 2) return;
  const invCol = HEADERS.Jobs.indexOf('invoiceId') + 1;
  const vals = sheet.getRange(2, invCol, last - 1, 1).getValues();
  for (let i = 0; i < vals.length; i++) if (String(vals[i][0]) === String(invId)) sheet.getRange(i + 2, invCol).setValue('');
}
function voidInvoice(id, remarks) {
  requireDomain_();
  const ex = readSheet_(SHEETS.INVOICES).map(normInvoice_).filter(function (i) { return i.id === id; })[0];
  if (!ex) throw new Error('Invoice not found.');
  const paid = readSheet_(SHEETS.PAYMENTS).map(normPayment_).filter(function (p) { return p.invoiceId === id; });
  if (paid.length) throw new Error('Invoice has payments — remove payments before voiding.');
  ex.status = 'Void'; ex.notes = (ex.notes ? ex.notes + ' | ' : '') + 'VOID: ' + (remarks || '');
  updateRecord_(SHEETS.INVOICES, ex);
  clearInvoiceLinks_(id);
  logAudit_('VOID', 'Invoice', ex.invNo, remarks || '');
  return bootstrap();
}
function deleteInvoice(id) {
  requireDomain_();
  deleteRowsWhere_(SHEETS.PAYMENTS, 2, [id]);
  clearInvoiceLinks_(id);
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

/* ===================== PHOTOS ===================== */
/** savePhotos({ jobId, stage, files:[{base64,mime,name}], caption }) */
function savePhotos(p) {
  const user = requireDomain_();
  if (!p.jobId) throw new Error('Job is required.');
  if (!p.stage) throw new Error('Photo stage is required.');
  if (!p.files || !p.files.length) throw new Error('No photo provided.');
  const job = readSheet_(SHEETS.JOBS).map(normJob_).filter(function (j) { return j.id === p.jobId; })[0];
  if (!job) throw new Error('Job not found.');
  const folder = getSub_(SUBFOLDERS.PHOTOS);
  const now = nowIso_();
  p.files.forEach(function (f) {
    const name = safeFilename_(job.engagementRef + '-' + job.service + '-' + p.stage + '-' + (f.name || 'photo'));
    const blob = Utilities.newBlob(Utilities.base64Decode(stripDataUrl_(f.base64)), f.mime || 'image/jpeg', name);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
    appendRecord_(SHEETS.PHOTOS, { id: uid_(), jobId: p.jobId, engagementId: job.engagementId, service: job.service,
      stage: p.stage, url: file.getUrl(), fileId: file.getId(), caption: p.caption || '', takenBy: user, takenAt: now });
  });
  logAudit_('PHOTO', 'Job', job.engagementRef + '/' + job.service, p.stage + ' ×' + p.files.length);
  return bootstrap();
}
function deletePhoto(id) {
  requireDomain_();
  const ph = readSheet_(SHEETS.PHOTOS).map(normPhoto_).filter(function (x) { return x.id === id; })[0];
  if (ph) trashFile_(ph.fileId);
  deleteRowsWhere_(SHEETS.PHOTOS, 1, [id]);
  logAudit_('DELETE', 'Photo', (ph ? ph.stage : id), '');
  return bootstrap();
}

/* ===================== PRINTABLES ===================== */
function getInvoiceData(invoiceId) {
  requireDomain_();
  const inv = readSheet_(SHEETS.INVOICES).map(normInvoice_).filter(function (x) { return x.id === invoiceId; })[0];
  if (!inv) throw new Error('Invoice not found.');
  const jobs = readSheet_(SHEETS.JOBS).map(normJob_).filter(function (j) { return j.invoiceId === invoiceId; });
  const pays = readSheet_(SHEETS.PAYMENTS).map(normPayment_).filter(function (p) { return p.invoiceId === invoiceId; });
  const paid = pays.reduce(function (s, p) { return s + p.amount; }, 0);
  inv.amountPaid = round2_(paid); inv.balance = round2_(inv.total - paid); inv.payStatus = computeInvStatus_(inv);
  const client = readSheet_(SHEETS.CLIENTS).map(normClient_).filter(function (c) { return c.id === inv.clientId; })[0] || {};
  return { invoice: inv, jobs: jobs, payments: pays, client: client, config: getConfig_(), sstRate: SST_RATE };
}
function getJobSheetData(jobId) {
  requireDomain_();
  const j = readSheet_(SHEETS.JOBS).map(normJob_).filter(function (x) { return x.id === jobId; })[0];
  if (!j) throw new Error('Job not found.');
  const eng = readSheet_(SHEETS.ENGAGEMENTS).map(normEngagement_).filter(function (e) { return e.id === j.engagementId; })[0] || {};
  const photos = readSheet_(SHEETS.PHOTOS).map(normPhoto_).filter(function (p) { return p.jobId === jobId; });
  return { job: j, engagement: eng, photos: photos, config: getConfig_() };
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

/* ===================== ALERT ENGINE ===================== */
function installDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runDailyAlerts') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runDailyAlerts').timeBased().everyDays(1).atHour(7).create();
  return 'Daily alert trigger installed (~7am): rorobin overstays + overdue invoices.';
}
function runDailyAlerts() {
  const cfg = getConfig_();
  const to = cfg.REMINDER_TO || Session.getEffectiveUser().getEmail();
  const today = todayISO_();
  const now = new Date();
  const jobs = readSheet_(SHEETS.JOBS).map(normJob_);
  const lines = [];
  jobs.forEach(function (j) {
    enrichRorobin_(j, now, cfg);
    if (j.service === 'Rorobin' && j.overstay) {
      lines.push('OVERSTAY — Bin ' + j.binNo + ' · ' + j.clientCompany + ' (' + j.engagementRef + '), placed ' +
        j.placeDateTime + ', collect by ' + j.collectBy);
      logAudit_('BIN_OVERSTAY', 'Job', j.engagementRef + '/Bin ' + j.binNo, j.daysOut + 'd out');
    }
  });
  const invoices = readSheet_(SHEETS.INVOICES).map(normInvoice_);
  const payByInv = {};
  readSheet_(SHEETS.PAYMENTS).map(normPayment_).forEach(function (p) { payByInv[p.invoiceId] = (payByInv[p.invoiceId] || 0) + p.amount; });
  invoices.forEach(function (inv) {
    if (inv.status === 'Void' || !inv.dueDate) return;
    const bal = round2_(inv.total - (payByInv[inv.id] || 0));
    if (bal <= 0.005) return;
    const d = daysBetween_(today, inv.dueDate);
    if (d < 0) lines.push('OVERDUE invoice ' + inv.invNo + ' · ' + inv.clientCompany + ' — ' + (-d) + 'd, balance RM ' + money_(bal));
  });
  if (lines.length) {
    MailApp.sendEmail(to, '[Transport] Daily alerts — ' + today,
      (cfg.COMPANY_NAME || 'HG') + ' — Transport / Mover / Rorobin daily alerts\n' +
      '----------------------------------------\n' + lines.join('\n') + '\n');
  }
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
function uploadFile_(subName, prefix, f) {
  const folder = getSub_(subName);
  const blob = Utilities.newBlob(Utilities.base64Decode(stripDataUrl_(f.base64)), f.mime || 'application/octet-stream',
    safeFilename_(prefix + '-' + (f.name || 'file')));
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
  return { url: file.getUrl(), id: file.getId() };
}
function trashFile_(fileId) { if (!fileId) return; try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {} }

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
function parseDateTime_(s) {
  s = String(s || '').trim(); if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return null;
}
function uniq_(arr) { const seen = {}, out = []; arr.forEach(function (x) { if (!seen[x]) { seen[x] = 1; out.push(x); } }); return out; }
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
  seedRates_();
  seedBins_();
  seedLorries_();
  logAudit_('SETUP', 'System', '-', 'Sheets created / rate card + sample bins + fleet seeded');
  return 'Setup complete. Rate card + sample bins seeded. Next: run installDailyTrigger(), then deploy as web app. ' +
    'IMPORTANT: edit the seeded rates in Settings to your real prices — they are placeholders.';
}
function seedRates_() {
  const sheet = ss_().getSheetByName(SHEETS.RATES);
  if (sheet.getLastRow() > 1) return;
  const now = nowIso_();
  const data = [
    ['Lorry',   'LRY-1T',     'Lorry 1-Tonne',                  'per trip',         250],
    ['Lorry',   'LRY-3T',     'Lorry 3-Tonne',                  'per trip',         350],
    ['Lorry',   'LRY-5T',     'Lorry 5-Tonne',                  'per trip',         500],
    ['Lorry',   'LRY-LB',     'Luton Box Lorry',                'per trip',         450],
    ['Mover',   'MOV-DAY',    'Mover — Day shift',              'per mover/shift',  120],
    ['Mover',   'MOV-NIGHT',  'Mover — Night shift',            'per mover/shift',  150],
    ['Rorobin', 'BIN-6Y',     'Rorobin 6-yard',                 'per placement',    600],
    ['Rorobin', 'BIN-10Y',    'Rorobin 10-yard',                'per placement',    800],
    ['Rorobin', 'BIN-OVER',   'Overstay surcharge (per day)',   'per extra day',    100]
  ];
  const rows = data.map(function (d) { return [uid_(), d[0], d[1], d[2], d[3], d[4], true, now]; });
  sheet.getRange(2, 1, rows.length, HEADERS.Rates.length).setValues(rows);
}
function seedBins_() {
  const sheet = ss_().getSheetByName(SHEETS.BINS);
  if (sheet.getLastRow() > 1) return;
  const now = nowIso_();
  const data = [
    ['BIN-01', '', '6-yard', 'Available', 'sample — set SWCorp reg'],
    ['BIN-02', '', '6-yard', 'Available', 'sample — set SWCorp reg'],
    ['BIN-03', '', '10-yard', 'Available', 'sample — set SWCorp reg'],
    ['BIN-04', '', '10-yard', 'Available', 'sample — set SWCorp reg']
  ];
  const rows = data.map(function (d) { return [uid_(), d[0], d[1], d[2], d[3], d[4], now]; });
  sheet.getRange(2, 1, rows.length, HEADERS.Bins.length).setValues(rows);
}
function seedLorries_() {
  const sheet = ss_().getSheetByName(SHEETS.LORRIES);
  if (sheet.getLastRow() > 1) return;
  const now = nowIso_();
  const data = [
    ['VBA 1234', 'HG-01', '1-Ton Lorry', '1 ton', 'in-house', 'Primary scaffold delivery'],
    ['VBB 5678', 'HG-02', '3-Ton Lorry', '3 ton', 'in-house', 'Hoarding + rorobin'],
    ['WJK 9012', 'BALAN-A', 'Rorobin Hook-Lift', 'Bin transport', 'outsource', "Balan's fleet"]
  ];
  const rows = data.map(function (d) { return [uid_(), d[0], d[1], d[2], d[3], d[4], true, d[5], now]; });
  sheet.getRange(2, 1, rows.length, HEADERS.Lorries.length).setValues(rows);
}

/* DANGER — testing only */
function _resetAllSheets_DANGER() {
  const ss = ss_();
  Object.keys(HEADERS).forEach(function (name) { const sh = ss.getSheetByName(name); if (sh) ss.deleteSheet(sh); });
  ensureSheets_();
  return 'All sheets wiped and recreated.';
}
