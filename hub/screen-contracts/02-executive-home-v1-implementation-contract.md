# 02 Executive Home V1 - Implementation Contract

Status: local UI implementation complete; hosted database activated; visual review pending
Date: 2026-07-12
Screen owner: HG Hub redesign
Implementation surface: `index.html`
Target user: Black Lee / Executive Home
Branch: `ui-redesign`

Related contracts:

- `00-role-map-direction.md`
- `02-home-v1-implementation-contract.md`
- `02-executive-home-v1-data-contract.md`
- `../design-language-foundation.md`

## Purpose

Executive Home is a separate role-aware Home for Black. It must answer four questions within one scan:

1. What requires my decision?
2. Where is money exposed?
3. Is operational execution under control?
4. What changed since I last checked?

It is not a larger Operations Home, a replacement for Project P&L, or a generic analytics dashboard.

## Main-Branch Evidence

The contract was checked against `main` at commit `f372873`.

Useful main-branch patterns:

- `index.html` supplies Supabase-backed open quotations, operational alarms, and shared activity.
- `team-command.html` supplies useful executive information patterns: urgent, due this week, active work, revenue, expenses, net results, and service grouping.
- `project-pl-supabase.html` supplies the authoritative financial concepts and calculation model.

Rejected main-branch patterns:

- Do not use Team Command values on Executive Home. Its primary state is localStorage with optional Google Sheets synchronization.
- Do not restore the old `System Health` percentage. It is derived from alarm count rather than a real health measure.
- Do not copy Project P&L calculation logic into `index.html`.

## Role Resolution

Permissions and Home mode are separate concerns.

- `allowed_users.is_admin` continues to control administrative permissions.
- `allowed_users.home_mode` controls the default Home renderer.
- Initial supported values are `operations` and `executive`.
- Seed `lee@hggroup.com.my` as `executive`.
- Assign `marketing@hggroup.com.my` as an Executive Home reviewer so the UI/UX team can inspect the same live states without impersonating Black.
- Existing users default to `operations`.
- Do not use `is_admin` to select Executive Home; Developer, Marketing, and Black can all be administrators.
- Protect Home-mode assignment from the generic allowed-user update path. A non-executive administrator must not be able to promote their own Home mode.
- Black must also have Project P&L role `Admin` or `Manager` to receive financial values.

Required behavior:

- Preserve `ROLE_MODES.operations` and the existing Operations Home unchanged.
- Add `ROLE_MODES.executive`.
- Resolve Home mode after authentication.
- Keep the full catalog available from both modes.
- Tool permissions remain unchanged by Home mode.
- If Executive Home is assigned but Project P&L permission is missing, keep non-financial Home sections available and render explicit unavailable finance segments.

## Role View Switcher Contract

The role-view switcher belongs in the sidebar identity block because it changes the context of the whole Hub. It is not a navigation item and must not restyle the locked sidebar foundation.

- Display the signed-in person's real name above the active view label.
- Black's default view is `Executive`.
- Black may switch between `Executive` and `Operations / Site`.
- The switch changes Home, role-aware sidebar tools, mobile navigation, and role-specific copy.
- The switch never impersonates another person and never grants database permissions.
- All reads and writes continue under Black's authenticated identity and existing Project P&L role.
- Persist the selected view for the current browser session. A new browser session starts from the server-assigned `home_mode`.
- When an Executive-assigned user selects Operations / Site, show `Operations / Site` in the compact identity block. The persistent Home banner carries the explicit `Viewing as Operations / Site` context and provides a clear `Return to Executive` option.
- Users with one authorized view see a static role label rather than a switcher.
- On mobile, expose the same control inside the sidebar sheet opened by the menu button.
- The menu supports click-away, Escape, keyboard focus, and an explicit selected state.

Do not place the switcher beside Appearance or inside All Tools. Those controls change display settings or routes; this control changes the active work context.

## Executive Sidebar Contract

The base sidebar styling remains locked. Executive mode changes tool membership and labels only.

Order:

1. Home.
2. Project P&L.
3. Smart Quotation.
4. Readiness & Dispatch.
5. Site Tracking.
6. Workers / Permits.
7. Scaffold / Green Tag.
8. Inventory.
9. Divider.
10. All Tools.
11. Appearance.
12. System status.
13. Collapse control.

Exact tool mappings use the existing `CATS` names and launchers.

## Executive Home Information Architecture

Desktop and mobile use the same order:

1. Executive header.
2. Executive Snapshot.
3. Needs Your Decision.
4. Business Pulse.
5. Executive Activity.

### 1. Executive Header

Content:

- Date.
- `Good morning, Black` / time-appropriate greeting.
- `Review company risks, commercial exposure, and operational execution.`
- `Review decisions` action.
- `Open P&L` action.

Routes:

- `Review decisions` focuses the Home-owned Needs Your Decision section.
- `Open P&L` opens `Project Revenue vs Expenses (P&L)` using the existing tool launcher.

### 2. Executive Snapshot

Use one unified operational work unit with six aligned segments:

1. Critical Attention.
2. Open Quotations.
3. Active Projects.
4. Net Revenue MTD.
5. Client Outstanding.
6. Project Profit MTD.

Segment rules:

- Apply the shared KPI cell contract.
- Keep labels, metrics, and supporting notes on consistent baselines.
- Show the metric basis where time or scope matters.
- `Open Quotations` includes count and value.
- `Project Profit MTD` must state `Projects invoiced this month`.
- `Client Outstanding` must state `All invoiced tracked projects`.
- Never label client outstanding as overdue.
- Never render loading or unavailable data as `0`, `RM 0`, `clear`, or a green state.
- Do not show a synthetic company-health score.

When `data_quality` contains warnings:

- show a quiet notice beneath the affected snapshot segment or Commercial pulse
- summarize the issue, such as `2 projects use computed invoice values`
- route `Review data` to Project P&L
- do not silently discard the warning or replace the metric with a confidence score

### 3. Needs Your Decision

This is the primary executive action section. There is no separate decision-review page.

Each row contains:

- Decision title.
- Business domain and source.
- Owner when the source provides one.
- Financial or operational impact when supported.
- Due date when supported.
- Direct tool action.

Supported V1 decision types:

- Dispatch, worker, scaffold, or storage alarm.
- Active project with negative profit.
- Project with a client outstanding balance.
- Estimated project costs or invoices awaiting confirmation.
- Inventory item at or below its low-stock threshold.

Rules:

- Use only real records returned by the executive data contract.
- Do not infer Black as the owner.
- Do not invent a due date or financial impact.
- Sort critical before warning before watch, then earliest due date, then largest supported financial impact.
- Apply the display limit only after total counts are calculated.
- Route directly to the owning tool; do not add an intermediary review screen.

### 4. Business Pulse

Use three concise work units:

#### Commercial

- Open quotation count and value → Smart Quotation.
- Active project count → Project Revenue vs Expenses (P&L).
- Client outstanding → Project Revenue vs Expenses (P&L).
- Project profit and margin → Project Revenue vs Expenses (P&L).

#### Operations

- Active dispatch jobs.
- Ready, At risk, and Blocked.
- Open operational blockers.
- Opens Daily Readiness & Dispatch or Daily Site Tracking.

#### People & Assets

- Expired and due-soon worker records.
- Scaffold and storage action.
- Out-of-stock and low-stock items.
- Opens Workers Documentation & Permits, Scaffold & Green Tag, or Inventory.

Business Pulse summarizes exceptions. It must not reproduce complete tool dashboards.

### 5. Executive Activity

Use the shared activity output from the executive data contract.

Each item shows:

- Time.
- Readable action.
- Actor.
- Business domain.
- Short detail.
- Owning tool route when derivable.

Preserve the raw action code in data but do not expose implementation codes as the primary UI label.

## Direct Tool Routes

| Executive action | Destination |
| --- | --- |
| Open quotation | Smart Quotation |
| Open project finance | Project Revenue vs Expenses (P&L) |
| Dispatch risk | Daily Readiness & Dispatch |
| Site execution | Daily Site Tracking |
| Worker exposure | Workers Documentation & Permits |
| Scaffold exposure | Scaffold & Green Tag System |
| Storage exposure | Temporary Storage Rental |
| Inventory exposure | Inventory, Tools & Purchasing |
| Executive activity | Owning tool when derivable; otherwise Activity |

Use `openToolByName()` / `openTool()` and the current cloud launcher. Do not create another navigation system.

## State Contract

### Populated

- Show real snapshot values and real decision rows.
- Every actionable row has a real tool destination.
- Independent data sources can finish independently.

### All Clear

- Snapshot continues to show commercial and financial values.
- Needs Your Decision becomes a compact work unit:
  - `No executive decisions waiting`
  - `Operations and financial exceptions are clear right now.`
- Business Pulse and Executive Activity remain visible.

### Loading

- Use skeletons matching the final geometry.
- Do not temporarily show zero or all-clear states.
- Preserve the section order and stable snapshot geometry.
- Use representative decision-row skeletons with a sensible minimum height; do not reserve the unknown final height of a dynamic list.

### Partially Unavailable

- Preserve every successfully loaded section.
- Mark only the affected segment or section as `Unavailable`.
- Name the failed source, such as `Couldn’t load Project P&L`.
- Offer `Retry` where the request can be safely repeated.
- Do not calculate or display a combined total from incomplete sources.

### True Empty Data

Distinguish an empty source from an all-clear source:

- `No Project P&L records yet`
- `No quotations recorded`
- `No activity recorded`

Provide a real owning-tool action when one exists.

## Desktop Contract

- Keep the locked 248px sidebar.
- Use the existing Home width, typography, border, and spacing tokens.
- Header → snapshot → decisions → Business Pulse → activity.
- Business Pulse can use three columns.
- Do not require every section to fit within one viewport.
- Use one subtle border around complete operational work units and dividers inside them.
- Do not nest bordered cards.

## Mobile Contract

- Preserve the same information architecture and order.
- Snapshot uses a balanced two-column layout; wide financial values can span the full row.
- Decision rows stack owner, impact, due date, and action without horizontal scrolling.
- Business Pulse stacks Commercial, Operations, then People & Assets.
- Required Executive bottom navigation:
  1. Home.
  2. Decisions.
  3. Finance.
  4. Activity.
- The drawer continues to expose the executive tool set and All Tools.

Bottom-navigation behavior:

- Home returns to Executive Home.
- Decisions focuses Needs Your Decision.
- Finance opens Project Revenue vs Expenses (P&L).
- Activity opens the shared Activity view.

## Dark-Mode Contract

- Use the formalized Jobber-style dark tokens.
- Preserve semantic risk colors.
- Use raised surfaces only for overlays.
- Do not place a light nested card inside a dark work unit.
- Printed/PDF document surfaces remain white when they represent printed output.

## Non-Goals

- Do not replace or restyle the locked sidebar.
- Do not change the Operations Home.
- Do not use Team Command localStorage or seed data.
- Do not add company-wide overdue receivables without a reliable due-date field.
- Do not claim true accounting-period expenses or profit from incomplete booking dates.
- Do not build new finance editing features on Home.
- Do not add charts solely for decoration.
- Do not push or deploy before local review.

## Implementation Sequence

1. Implement and validate the executive data contract.
2. Add `home_mode` role resolution.
3. Add `ROLE_MODES.executive` and an isolated Executive Home renderer.
4. Build loading, populated, all-clear, partial-unavailable, and true-empty states.
5. Add direct tool routes.
6. Validate desktop, mobile, light, and dark modes.
7. Confirm Operations Home regression checks.
8. Review locally before any push.

## Acceptance Criteria

1. Black receives Executive Home through explicit `home_mode` assignment.
2. Operations users continue receiving the existing Operations Home unchanged.
3. Executive Snapshot is one aligned work unit with six supported metrics.
4. No financial metric uses Team Command localStorage data.
5. Project P&L calculations are exposed through a shared server contract rather than duplicated in `index.html`.
6. Loading never appears as zero or all clear.
7. Partial failures do not erase successfully loaded data.
8. Unsupported overdue-receivable and general-ledger claims are absent.
9. Decision rows contain only real records and route to real owning tools.
10. Populated, all-clear, loading, partial-unavailable, and true-empty states exist.
11. Desktop, mobile, light, and dark use the same information architecture.
12. Existing authentication, tool catalog, iframe, cloud launching, and Operations Home behavior do not regress.
13. No horizontal overflow occurs at the established mobile QA widths.
14. `Review decisions` and mobile Decisions focus the Home-owned decision section.
15. Attention totals are calculated before the display limit, and rows follow the required severity/date/impact sort.
16. The compact all-clear state uses the locked copy and remains smaller than a populated decision list.
17. True-empty states remain distinct from all-clear states and include their owning-tool action.
18. Executive Activity uses readable labels; raw implementation codes are not the primary label.
19. Every Business Pulse metric uses its defined single destination.
20. Data-quality warnings are visible and actionable rather than silently discarded.
21. Executive bottom navigation contains Home, Decisions, Finance, and Activity with the specified behavior.
22. Executive tool membership changes do not restyle the locked sidebar.
23. Black can switch between Executive and Operations / Site from the sidebar identity block.
24. The switch returns Home, sidebar tools, mobile navigation, and role-aware copy to the selected view without re-authentication.
25. Operations-only users do not receive a role switcher.
26. Viewing Operations / Site shows a persistent context label and a direct Return to Executive action.
27. View switching preserves Black's real identity, permissions, and audit attribution.
