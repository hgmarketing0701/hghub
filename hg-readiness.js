/* HG shared readiness logic — included by BOTH job-arrangement and dispatch tools
 * so the Ready / At-risk / Blocked verdict can never disagree between views.
 * Rules replicated from the original dispatch computeJobReadiness_ (GAS) engine.
 *
 *   window.hgReadiness.of(job, r, cfg) ->
 *     { status: 'ready'|'at_risk'|'blocked'|'none', missing: [labels],
 *       gates: {sketch,quote,permit,visual,material,loc}, daysToInstall, permitAlarm }
 *
 *   job = ja_jobs row (snake_case: mall, lot, date)
 *   r   = ja_job_readiness row for that job, or null/undefined (no gates ticked yet)
 *   cfg = { atRiskDays: 3, permitLeadDays: 3 } (optional)
 */
(function () {
  function daysUntil(dateStr) {
    if (!dateStr) return null;
    var d = new Date(String(dateStr).slice(0, 10) + "T00:00:00");
    if (isNaN(d)) return null;
    var today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.round((d - today) / 86400000);
  }

  function of(job, r, cfg) {
    cfg = cfg || {};
    var atRiskDays = Number(cfg.atRiskDays || 3);
    var permitLeadDays = Number(cfg.permitLeadDays || 3);
    job = job || {};

    // no readiness row at all -> 'none' (job not yet under readiness tracking)
    if (!r) {
      return { status: "none", missing: [], gates: null,
               daysToInstall: daysUntil(job.date), permitAlarm: false };
    }

    var gates = {
      sketch:   (r.measure_status === "sketch_done" || r.measure_status === "not_required"),
      quote:    (r.quote_status === "confirmed" || r.quote_status === "not_required"),
      permit:   (r.permit_status === "approved" || r.permit_by === "already_have" ||
                 r.permit_by === "not_required" || r.permit_status === "not_required"),
      visual:   (r.needs_visual !== "yes" || r.visual_status === "approved"),
      material: (r.material_ready === "yes"),
      loc:      !!(job.mall && job.lot)
    };
    var missing = [];
    if (!gates.loc) missing.push("Lot / Mall");
    if (!gates.sketch) missing.push("Measurement sketch");
    if (!gates.quote) missing.push("Quotation");
    if (!gates.permit) missing.push("Permit");
    if (!gates.visual) missing.push("Visual artwork");
    if (!gates.material) missing.push("Material / fab");

    var days = daysUntil(job.date);
    var status = "ready";
    if (missing.length) status = (days !== null && days <= atRiskDays) ? "at_risk" : "blocked";
    var permitAlarm = !gates.permit && days !== null && days <= permitLeadDays;

    return { status: status, missing: missing, gates: gates, daysToInstall: days, permitAlarm: permitAlarm };
  }

  var api = { of: of, daysUntil: daysUntil };
  if (typeof window !== "undefined") window.hgReadiness = api;           // browser (both tools)
  if (typeof module !== "undefined" && module.exports) module.exports = api; // server (exec-home rpc)
})();
