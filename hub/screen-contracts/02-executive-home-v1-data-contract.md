# 02 Executive Home V1 - Data Contract

Status: hosted SQL implementation applied and authorization-verified; visual review pending
Date: 2026-07-12
Data owner: HG Hub / Project P&L
Consumer: `02 Executive Home V1`

## Decision

Executive Home V1 is feasible as a server-defined, read-only Supabase summary.

Do not:

- read Team Command localStorage for executive metrics
- duplicate Project P&L calculations inside `index.html`
- aggregate only the first 20 alarm rows
- expose financial metrics based only on `is_admin`
- describe client outstanding as overdue without a due date

## Source Compatibility

The audited `main` and `ui-redesign` branches use the same Supabase and Project P&L schema for the relevant sources. No schema reconciliation is required before designing the executive contract.

Authoritative sources:

- `quotes`
- `dsp_jobs`
- `dsp_alarms`
- `wkr_alarms`
- `scf_alarms`
- `str_alarms`
- Inventory tables prefixed `inv_`
- Project P&L tables prefixed `pl_`
- shared `audit_log`

Non-authoritative source for Executive Home:

- `team-command.html` localStorage / optional Google Sheets state

## Role And Security Contract

Extend `allowed_users` additively:

```sql
home_mode text not null default 'operations'
  check (home_mode in ('operations', 'executive'))
```

Initial assignment:

- `lee@hggroup.com.my` → `executive`
- `marketing@hggroup.com.my` → `executive` for UI/UX review, with real Marketing identity retained
- every existing user without an explicit assignment → `operations`

Required helpers:

- `hub_my_home_mode()` returns the signed-in user’s allowed Home mode.
- `hub_is_executive()` returns true only when the signed-in allowlisted user has `home_mode = 'executive'`.
- `hub_my_home_mode()` accepts no email parameter and returns null or an authorization error for a non-allowlisted JWT user. It must not silently default an unauthorized user to Operations Home.

Assignment protection:

- Seed Black’s Executive Home assignment through the migration.
- Exclude `home_mode` from the generic allowed-user management path.
- Block direct authenticated changes to `home_mode` unless the current user was already Executive before the update.
- If an assignment UI is added later, use a dedicated `hub_set_home_mode()` security-definer RPC that requires `hub_is_executive()`.
- A foundation administrator who is not already Executive must not be able to promote themselves.

Money access requirements:

- Executive financial aggregation requires `hub_is_executive()`.
- It also requires Project P&L role `Admin` or `Manager`.
- Do not use foundation `is_admin()` alone.
- Revoke RPC execution from `public` and grant it only to `authenticated`.
- Use a fixed `search_path = public` for any security-definer function.

Home mode is a product-persona assignment, not a secret or a substitute for RLS.

## Active View Context Contract

The server-assigned `allowed_users.home_mode` is the user's default and authorization boundary. The temporary active view is presentation state, not a database role.

- `hub_my_home_mode()` returns the server-assigned default view.
- Only a user whose server-assigned mode is `executive` may activate the `operations` view locally.
- Store the active view in `sessionStorage` under an email-scoped Hub key and discard it when the signed-in account changes or signs out.
- Validate the stored value against the views permitted by `hub_my_home_mode()` before rendering.
- Switching views must not update `allowed_users.home_mode`, `pl_user_roles`, JWT metadata, RLS policy inputs, or the authenticated session.
- Database authorization always evaluates the real signed-in user through `current_email()`, `is_allowed()`, `hub_is_executive()`, and `pl_role()`.
- Sensitive actions remain attributable to the real email in `audit_log` and `pl_audit_log` regardless of the active view.
- A non-executive user may never unlock Executive Home by writing browser storage or calling the Executive Home RPC.
- A sign-out clears the temporary active-view key.

## Recommended Data Objects

### 1. Project Financial View

`hub_pl_project_financials_v1`

- One row per `pl_projects` record.
- `security_invoker = on`.
- Exact SQL equivalent of the proven `projectMetrics()` behavior.
- Parent projects and add-on projects remain separate rows.
- Do not combine parent and children in the executive aggregate; doing so would double count add-on invoices.
- Revoke direct `SELECT` on this internal view from `public`, `anon`, and `authenticated`. Only the protected executive aggregation path may expose its financial output.

### 2. Executive Home RPC

`hub_executive_home_v1(p_as_of date default null, p_attention_limit int default 20) returns jsonb`

Rules:

- Use Asia/Kuala_Lumpur.
- Default `p_as_of` to the Kuala Lumpur calendar date.
- Check Executive Home and Project P&L permissions before reading money data.
- Calculate complete source totals before limiting attention items.
- Return partial-source errors explicitly rather than replacing them with zero.
- Clamp `p_attention_limit` to an accepted range of 1–100.
- Use isolated PL/pgSQL exception blocks per source domain so one failed source can be reported in `unavailable` without aborting every successful domain. Separate protected RPCs composed by the client are acceptable only if they preserve the same partial-failure contract.

## Project Financial Formula Contract

The SQL view must match the existing Project P&L result for every project.

### Revenue

- Effective scope client amount uses `client_amount`.
- When client amount is zero, quantity is zero, and client rate is positive, use client rate as the fallback amount.
- Subtotal is the sum of effective scope client amounts.
- After-adjustment value is subtotal minus project discount plus project adjustment.
- SST is applied only when `sst_applicable` is true.
- Computed total is after-adjustment value plus SST.
- Gross invoiced uses non-zero `invoice_amount`; otherwise computed total; otherwise subtotal.
- Credit and refund notes reduce invoiced value.
- Net revenue is effective invoiced value minus SST.

### Client Money In

- Received is the sum of `pl_client_payments.amount`.
- Client outstanding is effective invoiced value minus received.
- Executive totals use `greatest(client_outstanding, 0)`.

### Costs

- Subcontractor effective cost applies only to Subcon scopes.
- Blank legacy `performed_by` is treated as Subcon.
- `Absorbed` and `None` cost-confirmation scopes contribute zero.
- Subcontractor committed equals scope subcontractor cost plus lump-sum subcontractor charges minus in-house-subcontractor material deductions.
- Supplier material cost includes material rows whose source is not `InHouseSubcon`.
- Manpower cost is the sum of `pl_manpower.total_cost`.
- Internal-division cost applies only to `OtherDivision` scopes and excludes `Absorbed` and `None`.
- Total cost is subcontractor committed plus supplier materials plus manpower plus internal-division cost.

### Outstanding And Profit

- Subcontractor outstanding is committed subcontractor cost minus subcontractor payments.
- Supplier outstanding is supplier material cost minus supplier payments.
- Profit is net revenue minus total cost.
- Margin is profit divided by net revenue when net revenue is positive; otherwise zero.
- Estimated cost includes effective costs from scopes with `cost_confirmation = 'Estimated'` and returns both amount and scope count.

Parity requirement:

- Before releasing the SQL view, compare its output with the current JavaScript `projectMetrics()` output over the same projects.
- Any variance blocks release of executive finance metrics.

## Snapshot Metric Contract

All snapshot metrics use this conceptual structure:

```json
{
  "value": 0,
  "count": 0,
  "unit": "count|MYR|percent",
  "status": "clear|watch|warning|critical|unavailable",
  "basis": "human-readable scope",
  "source": "source identifier"
}
```

Omit keys that do not apply.

### Critical Attention

- Value: count of normalized attention rows with `severity = critical`.
- Basis: `As of YYYY-MM-DD`.
- Source: all supported attention domains.

### Open Quotations

- Count and sum of `quotes.total` where status is `Draft` or `Sent`.
- No date window.
- Basis: `Draft and sent`.

### Active Projects

- Count of Project P&L projects with normalized active status.
- Initial exact rule: `lower(status) = 'active'`.
- Add-on project invoices remain separate project rows.
- Basis: `Project P&L`.

### Net Revenue MTD

- Sum Project P&L net revenue for projects whose `invoice_date` is in the Kuala Lumpur calendar month containing `p_as_of`.
- Month interval is inclusive month start and exclusive next-month start.
- Basis: `Invoice-date cohort · ex-SST`.

### Client Outstanding

- Include only non-cancelled projects with evidence of invoicing: an invoice date, a non-empty invoice number, or an explicitly entered non-zero invoice amount.
- Sum positive client outstanding across those invoiced projects.
- Return the number of projects contributing a positive balance.
- Basis: `All invoiced tracked projects`.
- Label must be `Client outstanding`, never `Overdue receivables`.
- Projects using a computed invoice fallback remain visible in `data_quality`.

### Project Profit MTD

- Sum project profit for the same invoice-date cohort used by Net Revenue MTD.
- Margin is cohort profit divided by cohort net revenue.
- Basis: `Projects invoiced this month · full project-to-date cost`.
- This is not accounting-period profit.

## Execution Pulse Contract

### Dispatch

- Active: `dsp_jobs` excluding `done` and `cancelled`.
- Permit alarms: `dsp_alarms.alarm_type = permit_alarm`.
- At risk: `alarm_type = at_risk`.
- Blocked: `alarm_type = blocked`.
- Ready: active distinct jobs minus distinct alarm job references, floored at zero.

### Workforce

From `wkr_alarms`:

- Expired: `due_date < p_as_of`.
- Due within 7 days: `p_as_of <= due_date <= p_as_of + 7`.
- Due within 30 days: `p_as_of + 7 < due_date <= p_as_of + 30`.

These buckets are exclusive. Due today belongs to the 7-day bucket.

### Scaffold And Storage

From `scf_alarms` and `str_alarms`:

- Overdue: due date before `p_as_of` or an explicit overdue/expired alarm type.
- Due: due today or within the source’s configured warning window.
- Retain separate source counts.

### Inventory

- On hand equals purchased material quantity minus stock-out material quantity, matching the current Inventory UI.
- Low stock: on hand less than or equal to `inv_materials.low_stock_threshold`.
- Critical: on hand less than or equal to zero.
- Warning: positive on hand at or below threshold.
- Do not incorporate stock-count records until Inventory itself uses stock counts to alter on-hand quantity.

## Attention Item Contract

```json
{
  "item_key": "deterministic-presentation-key",
  "domain": "dispatch|workforce|scaffold|storage|inventory|finance",
  "severity": "critical|warning|watch",
  "type": "normalized-type",
  "title": "readable decision title",
  "detail": "source-supported detail",
  "owner": null,
  "due_date": null,
  "amount": null,
  "source": "source table or view",
  "source_ref": "source reference",
  "tool_id": "exact CATS tool name",
  "tool_tab": null,
  "action_label": "Open …"
}
```

Severity normalization:

- Dispatch permit alarm overdue or due today: critical.
- Dispatch at-risk: warning.
- Dispatch blocked: warning; critical when due today or overdue.
- Worker record expired: critical.
- Worker record due within 7 days: warning.
- Later worker warning-window record: watch.
- Scaffold overdue invoice, green tag, collection, or certificate: critical.
- Scaffold due today: warning.
- Future scaffold warning: watch.
- Storage rental expired or invoice overdue: critical.
- Storage due/notice: warning or watch according to date.
- Active Project P&L project with positive net revenue and negative profit: critical.
- Positive client outstanding: warning; never overdue without a due date.
- Estimated project costs: warning.
- Inventory on hand at or below zero: critical.
- Inventory positive but at or below threshold: warning.

Owner rules:

- Use only an explicit responsible field obtained from the source record, such as `handled_by` or `assigned_inspector`.
- Otherwise return null and display `Unassigned`.
- Alarm notification recipients are not owners and must not populate this field.
- Do not infer Black as owner.

Presentation-key rule:

- Current alarm views do not provide stable source record IDs.
- Build `item_key` deterministically from source, normalized type, reference, and due date.
- Treat it as a render/deduplication key, not a permanent record identifier; it changes when one of those fields changes.

Sort order:

1. Critical, warning, watch.
2. Overdue first, then due date ascending.
3. Supported financial impact descending.
4. Stable source identifier.

## Activity Contract

Use shared `audit_log`, ordered newest first, limit 25.

Project P&L logging already mirrors actions into shared `audit_log` with a P&L marker. Do not query and merge `pl_audit_log` into the same feed without deduplication.

Output:

```json
{
  "at": "timestamp",
  "actor": "email or readable user",
  "action_code": "raw source code",
  "action_label": "readable action",
  "detail": "short detail",
  "domain": "business domain",
  "tool_id": "exact CATS tool name or null"
}
```

## RPC Output Shape

```json
{
  "version": "executive-home-v1",
  "as_of": "YYYY-MM-DD",
  "timezone": "Asia/Kuala_Lumpur",
  "generated_at": "timestamp",
  "role": {
    "home_mode": "executive",
    "finance_role": "Admin|Manager"
  },
  "snapshot": {
    "urgent_exceptions": {},
    "open_quotations": {},
    "active_projects": {},
    "net_revenue_mtd": {},
    "client_outstanding": {},
    "profit_mtd": {}
  },
  "execution": {
    "dispatch": {},
    "workforce": {},
    "scaffold_storage": {},
    "inventory": {}
  },
  "attention": {
    "total": 0,
    "critical": 0,
    "warning": 0,
    "watch": 0,
    "items": []
  },
  "activity": [],
  "data_quality": [],
  "unavailable": []
}
```

## Partial Failure And Data Quality

- `generated_at` states query time, not source freshness.
- Return source failures in `unavailable`.
- Return successfully calculated domains even when another domain fails.
- Do not substitute unavailable metrics with zero.
- Flag projects using computed invoice fallback.
- Flag projects missing invoice date.
- Flag executive aggregates excluded by permission.
- Do not calculate a synthetic freshness or health score.

## Known Gaps

### Overdue Receivables

`pl_projects` has invoice date but no client invoice due date. Company-wide overdue receivables are unsupported.

Future requirement:

- Add `invoice_due_date` to the Project P&L model.
- Define aging buckets before adding overdue metrics.

### True Accounting-Period Profit And Expenses

Project P&L records project economics, but not every cost has a shared accounting booking date. True MTD expenses and accounting-period profit are unsupported.

V1 uses an explicitly labeled invoice-date project cohort.

### Inventory Adjustments

Stock-count records do not currently alter Inventory on-hand calculations. Executive Inventory must match the current tool behavior until that workflow changes.

### Exact Record Deep Links

Alarm views do not expose stable source record IDs consistently. V1 routes to the owning tool or tab. Exact record deep links require source-view changes.

## Data Acceptance Criteria

1. Executive RPC rejects a non-executive user.
2. Executive money output also requires Project P&L Admin or Manager.
3. SQL project-financial values match JavaScript `projectMetrics()` fixtures.
4. Open quotation count/value matches direct `quotes` queries.
5. Alarm totals include all rows before attention limiting.
6. Unsupported sources return unavailable status rather than zero.
7. Client outstanding is never labeled overdue.
8. Project Profit MTD carries the invoice-cohort basis.
9. Team Command localStorage is never read.
10. Operations Home data behavior remains unchanged.
11. Browser storage cannot unlock Executive Home for an Operations-only user.
12. Switching to Operations / Site does not update `allowed_users`, P&L roles, JWT metadata, or audit identity.
13. Signing out clears the temporary active-view context.
