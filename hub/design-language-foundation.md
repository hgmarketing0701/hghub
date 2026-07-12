# HG Hub Design Language Foundation

Status: Implemented tool rules v0.2
Date: 2026-07-11
Scope: HG Hub UI/UX improvement, with future white-label readiness

## Purpose

The immediate priority is to improve HG Hub as a real working product for HG's daily operations. The design language should make the current hub cleaner, faster to use, more consistent, and more friendly for the team.

White-label service potential is a second phase. We should avoid hardcoding unnecessary HG-specific decisions into reusable components, but we should not slow down the HG Hub redesign by over-abstracting too early.

## Product Strategy

Use an HG-first, white-label-ready approach.

### Phase 1: Make HG Hub Excellent

Design and implement the best version of HG Hub for the current team and current workflows.

Focus on:

- cleaner shell navigation
- faster access to tools
- clearer dashboard priorities
- better mobile usability
- consistent embedded tools
- friendlier status and action language
- fewer visual distractions

### Phase 2: Extract The Reusable Product System

Once the improved HG Hub patterns are working, extract the repeatable system:

- shared components
- page templates
- token structure
- tenant settings
- configurable branding
- reusable module model

### Phase 3: White-Label The Service

Only after the HG experience is stable, formalize white-label behavior:

- swap logo/name/colors
- configure modules per tenant
- configure document headers and domains
- remove remaining HG-only assumptions
- package the product for other contractor/service businesses

## Product Category

Primary category: contractor operations platform.
Secondary category: internal business operating system.
UI pattern family: modern B2B SaaS command center.

The product helps a service/contractor business manage:

- leads and client records
- quotations and pricing
- job/site readiness
- dispatch and daily operations
- inventory, tools, fleet, workers, permits, documents
- invoices, claims, payments, project P&L
- reports, evidence, and follow-up workflows

## Brand Architecture

Use three layers.

### 1. HG Product Experience

This is the current implementation target. It can use HG context where that helps the team, but it should avoid unnecessary one-off styling.

It owns:

- shell layout
- sidebar and topbar behavior
- typography
- spacing
- components
- tables and forms
- status patterns
- mobile drawer behavior
- embedded tool shell
- accessibility and focus rules

### 2. Operational Semantics

These are business meanings, not brand colors.

- Success: ready, completed, paid, approved, active
- Warning: needs review, expiring soon, pending, partial
- Danger: blocked, overdue, failed, rejected, missing
- Info: in progress, quoted, reference, synced
- Neutral: draft, inactive, archived, unknown

### 3. Tenant Theme

This is replaceable per customer.

It owns:

- logo
- company name
- primary brand color
- accent color
- login copy
- document headers
- email and domain defaults
- print/export company details

HG can be the default tenant theme during Phase 1. The key is to keep brand values easy to extract later.

## Design Principles

### Operations Before Presentation

The first screen should answer: what needs attention, what is active, and where do I go next. Avoid hero-heavy, marketing-style composition inside the app.

### Scan Speed Over Decoration

The UI should support daily repeated work. Favor clear hierarchy, compact labels, readable tables, predictable controls, and direct actions.

### One Shell, Many Tools

Every embedded tool should feel like it belongs inside the same product. The parent shell provides context. Inner tools should avoid repeating heavy branding.

### HG First, Configurable Later

Improve the current HG workflow first. When a choice is obviously tenant-specific, isolate it so it can become configuration later.

### Mobile Is A Field Workflow

Mobile users need fast navigation, readable status, large touch targets, and a drawer that clearly takes focus. Mobile should not be a squeezed desktop.

### Accessibility Is Structural

Interactive elements should be real buttons, links, inputs, selects, and dialogs. Keyboard focus, visible labels, and semantic markup are part of the design language.

## Visual Direction

The product should feel:

- quiet
- structured
- trustworthy
- fast
- operational
- modern, but not flashy

Avoid:

- decorative gradient orbs
- heavy aurora backgrounds
- marketing heroes inside the app
- excessive glow
- one-off colors per page
- long card copy
- nested cards
- app screens that feel stitched together

## Color System

Use neutral product surfaces and reserve brand color for identity and primary actions.

### Core Neutrals

- Current HG app background: white
- Surface: panels, tables, cards, drawers
- Muted surface: warm off-white
- Surface raised: white modals, popovers, and command palette
- Border: subtle structure
- Text strong: headings, key values
- Text muted: secondary metadata
- Text faint: placeholders, disabled labels

The current HG light theme uses these canonical values:

- App background and primary surface: `#ffffff`
- Muted surface: `#f8f7f4`
- Border: `#e4ded6`
- Strong border and hover border: `#cfc8bd`
- Strong text: `#171717`
- Muted text: `#817970`
- Primary operational accent: `#143d4a`
- Primary hover: `#0e303b`

The companion dark theme preserves the same hierarchy rather than reviving the old high-contrast dashboard aesthetic:

- app background: `#101417`
- primary surface: `#171c20`
- muted surface: `#1d2328`
- border: `#30383e`
- strong text: `#f1f3f2`
- muted text: `#adb6b8`
- operational accent: `#4b83a1`

Theme preference is a shell-level choice. Offer `Light`, `Dark`, and `System`; use `System` on first load and persist the user's explicit choice. Semantic status meanings must remain unchanged between themes.

### Brand Tokens

Brand tokens are tenant-controlled.

- Brand primary
- Brand accent
- Brand soft background
- Brand contrast text

### Semantic Tokens

Semantic tokens are not tenant-controlled by default because they carry workflow meaning.

- Success
- Warning
- Danger
- Info
- Neutral

Tenant themes may tune exact shades, but the meaning must stay stable.

Current HG semantic meanings and colours are:

- Success `#15945d`: ready, completed, paid, approved, active
- Warning `#a66b00`: attention, expiring, pending, partial
- Danger `#d84d4f`: blocked, overdue, failed, rejected, missing
- Info `#2f7fa5`: in progress, quoted, reference, synced
- Neutral `#6d756f`: draft, inactive, archived, unknown

## Typography

Use Manrope across the HG Hub shell and operational tools. Keep the system UI stack as the fallback.

Recommended stack:

```css
font-family: "Manrope", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
```

Use one type system across the app:

- Page title: 24px to 28px
- Section title: 18px to 20px
- Card title: 15px to 16px
- Body: 14px
- Table: 13px to 14px
- Metadata: 12px to 13px
- Badge: 11px to 12px

Body copy and headings use `0` letter spacing. Compact uppercase field labels, badges, and status labels may use restrained tracking between `0.04em` and `0.08em` to improve scan separation.

## Spacing

Use a 4px base scale.

- 4px: tiny gap
- 8px: tight control gap
- 12px: standard inline gap
- 16px: card inner rhythm
- 20px: section inner rhythm
- 24px: page rhythm
- 32px: major section gap
- 40px: large layout separation

## Radius

Use restrained radii so the product feels professional and operational.

- Inputs and buttons: 8px
- Cards and panels: 8px
- Dropdown options: 6px within the 8px menu shell
- Modals and drawers: 12px
- Pills and badges: fully rounded only when the shape communicates status or selection

## Elevation

Default UI should rely on borders and surface contrast. Shadows should be subtle and reserved for overlays.

- Cards: no heavy shadow
- Sticky shell: border separation
- Popovers and command palette: medium shadow
- Modals and drawers: strong shadow plus backdrop

## Surface And Border Contract

HG Hub uses a border-minimal system. Borders communicate structure or interaction; they are not decoration.

### Core Rule

No border for page layout. Use one subtle border for a complete operational work unit or record. Use dividers inside it. Never place one bordered card inside another bordered card.

### Border-Free Surfaces

- page and section headings
- tabs and navigation rows, except for the active indicator or shell divider
- filters and action rows
- short settings forms
- subsections inside one longer form workflow
- supporting copy and helper content

Separate border-free sections with spacing or a single horizontal divider when the transition needs reinforcement.

### Bordered Surfaces

- KPI and operational snapshots
- repeated job, site, photo, document, and selectable records
- operational tables and registers
- upload and drop targets
- report previews and generated-document surfaces
- dropdown menus, popovers, dialogs, and drawers
- standalone empty states that are not already inside a work unit

### Internal Treatment

- use row or section dividers within a bordered work unit
- do not add another dashed or solid empty-state border inside a card or table
- retain input and control borders because they communicate interaction
- retain semantic status edges, such as readiness or risk indicators
- use shadows only for overlays; ordinary work units remain flat

### Decision Test

Before adding a border, ask: does this line identify where a task, record, selection, data register, or overlay begins and ends? If not, use spacing or a divider instead.

## Operational Tool Page Contract

Use this page structure across HG Hub operational tools.

### Tool Identity And View Modes

- use the same Lucide icon for a tool in the sidebar, embedded shell, and direct-view header
- direct tool views show the tool title, icon, and `Live` badge
- embedded views hide duplicate inner branding because the parent shell already provides tool context
- direct and embedded views retain the same information architecture, content, tabs, spacing, data, and functionality
- do not repeat the same tool title or description immediately below the tool header
- use the shared parent-shell search, help, settings, Ask HG, reload, and open-in-new-tab actions instead of recreating them inside every tool

### Page Header

- border-free title and one-line operational description
- primary create action at the top right
- export or secondary actions beside it
- actions stack or share the row evenly on mobile
- place the date beside the relevant page or board heading only when the workflow is explicitly date-based

### Snapshot

- one bordered snapshot work unit when summary metrics improve decisions
- label above the metric row
- internal dividers between metrics instead of individual metric cards
- semantic colour only on values that communicate status
- omit the snapshot when it does not help the workflow
- leave enough bottom padding beneath internal metric dividers so the dividers never sit against the card edge
- use one shared KPI anatomy within a snapshot: label zone, primary value line, then status or context line
- reserve the same two-line label height for every segment so all primary values begin on one horizontal level
- keep primary numbers and compact currency values on one line with tabular numerals
- align compound metrics, such as Ready / At risk / Blocked, to the same value and context rows as single metrics
- do not mix inline and stacked status treatments within the same snapshot card

### Filters

- border-free filter row between the page header or snapshot and the register
- search first, followed by the most important filters
- shared dropdown arrow, spacing, focus, and open-menu treatment
- horizontal controls become stacked full-width controls on mobile

### Tabs And Long-Form Navigation

- tool tabs remain one horizontal, non-wrapping row and scroll horizontally when space is limited
- use muted inactive labels and a 3px primary-colour underline for the active tab
- preserve the same tab order and information architecture on desktop and mobile
- long sequential forms may use a sticky section navigator when it materially improves orientation
- the active long-form step follows the section currently in view and exposes `aria-current="step"`
- sticky section navigation remains horizontally scrollable on narrow screens

### Dropdowns

- use the shared HG Hub dropdown shell for selects in page filters, forms, repeated line items, and modals
- retain the native select as the underlying value source so existing validation, change handlers, and data payloads remain intact
- use one control border only; do not place an inner select border inside an outer field shell
- use a minimum 42px control height and place the arrow 16px from the right edge
- open a same-width menu 4px below the control, with one subtle border and overlay shadow
- highlight the selected option with the shared muted surface treatment
- clicking the trigger again closes its menu; selecting an option, clicking outside, or pressing Escape also closes it
- allow only one dropdown menu to remain open at a time
- refresh the visible trigger and menu whenever options are added or replaced dynamically
- never invoke the browser-native select menu in redesigned mobile tools; use the same HG Hub custom trigger and menu as desktop
- on mobile, keep option rows at least 44px high and limit the menu to `45vh` or `260px`, whichever is smaller
- keep the menu the same width as its trigger and scroll options inside the menu instead of extending beyond the viewport
- open the menu upward when there is not enough usable space beneath the trigger
- for a single-select control, replace the placeholder with the selected value; never display both together
- for a multi-select control, show the shared `Pick or type new names` placeholder only while no values are selected
- display selected multi-select values as removable chips within the same single-border field
- grow a multi-select field only when selected chips genuinely wrap onto another row; do not reserve an empty second row

### Operational Register

- one bordered register containing the table
- muted table header and divider rows
- hover treatment for interactive rows
- right-align numeric and financial columns
- allow horizontal scrolling on narrow screens instead of compressing columns
- use a table for analytical or operational records with several comparable columns
- use a simple divided-row list for short, personal lists such as three to ten team members

### Empty And Clear States

- an empty state inside a register has no additional border
- state the missing record or result directly and add one supporting sentence
- do not repeat a create button when the same primary action is already visible in the page header
- keep a contextual recovery action such as Clear filters or Clear search
- use the green shield `All clear` pattern only when zero items means zero risk
- let empty-state and parent-card height fit the message; do not impose a large empty minimum height
- containers expand only when records or wrapped content require the additional space

### Repeated Operational Records

- one subtle border per job, site, assignment, or other independent record
- record heading and actions share a header row
- metadata is separated with internal dividers
- status edges or colours carry meaning and are retained

### Settings And Administrative Lists

- short settings forms are border-free sections with dividers
- short team-access lists use member rows, not analytical table headers
- audit history uses a quiet operational table with human-readable action labels
- translate technical audit codes into concise verb-object phrases such as `Added worker`, `Removed invoice`, or `Updated permit`
- keep audit columns aligned as `When`, `Who`, `Action`, and `Details`

### Modals

- one raised bordered overlay with a clear title
- fields remain border-defined
- long forms scroll within the modal
- action footer remains visible when the form scrolls
- primary action uses a specific verb; destructive actions remain visually separate

### Actions And Operational Copy

- use one primary create or save action per surface
- place export and other secondary actions beside the primary action with lower visual emphasis
- keep destructive actions separate and use the danger treatment
- do not repeat an Add action inside an empty register when the same primary action is already visible in the page header
- use specific primary labels such as `Save site`, `Assign tool`, or `Generate report` instead of generic `Submit`
- use `Action items` for owned follow-up work; do not use ambiguous labels such as `Owner action`
- use direct empty-state and status language; avoid internal database names, codes, and implementation terminology

### Responsive Tool Behaviour

- header actions share available width or stack on mobile
- filters and short forms stack into full-width controls on mobile
- operational tables scroll horizontally instead of squeezing columns below a readable width
- repeated row lists reflow metadata and actions without changing their information order
- controls retain at least a 42px field height and important mobile touch targets retain at least 44px
- content-fit rules remain in force on mobile; do not add blank height merely to imitate desktop proportions

## Layout System

### App Shell

The shell has:

- persistent sidebar on desktop
- topbar with page context and global actions
- content area with page templates
- mobile drawer with backdrop
- command palette as a global shortcut

### Sidebar

The base sidebar styling is locked. Future changes may add or remove role tools, but must not restyle the sidebar foundation. A compact appearance selector may sit with the sidebar utilities above system status and offer `Light`, `Dark`, and `System`.

- expanded width: `248px`
- collapsed width: `72px`
- collapsed state is icon-only and retains accessible labels or tooltips
- role-aware navigation exposes the same core information architecture on desktop and mobile
- mobile uses a full-height drawer with a backdrop

Sidebar should prioritize product modules and role tools, not every individual action.

Recommended module groups:

- Dashboard
- Sales
- Jobs
- Operations
- Finance
- Assets
- People
- Documents
- Reports
- Settings

Tool-level links can sit under modules, but the first scan should be simple.

### Topbar

Topbar should show:

- current page/module
- search or command action
- key global actions
- user/account menu
- the current tool icon must match its sidebar icon
- Ask HG uses the purple four-point sparkle with two small sparkles and does not use a separate Ask HG pill

Avoid long greetings and large text blocks in the topbar.

### Mobile Shell

Mobile shell should use:

- compact topbar
- clear menu button
- full-height drawer
- backdrop/scrim
- close on backdrop and Escape
- fewer visible actions
- touch targets at least 44px high

## Component Foundation

### Buttons

Button variants:

- Primary: one main action per surface
- Secondary: normal action
- Tertiary: low-emphasis action
- Danger: destructive action
- Icon: compact toolbar action

Buttons should use icons when the action is common and recognizable.

Use one primary action per surface. Secondary, tertiary, and destructive actions must not compete with it.

### Cards And Panels

Cards should be used for repeated items or distinct content blocks. Do not put cards inside cards.

Cards and panels fit their content. Do not set oversized minimum heights for short records, clear states, or empty states.

Cards should contain:

- short title
- one-line summary or key metric
- status
- primary action
- secondary metadata

### Tables

Tables are central to operations. They should support:

- sticky headers when useful
- clear row hover and focus
- status badges
- compact actions
- filters
- sorting
- empty states
- responsive fallback for mobile

Use table headers only when users need to compare multiple records across stable columns. Use divided rows for short people, access, or administrative lists.

### Forms

Forms should support:

- clear labels
- helper text only when needed
- grouped sections
- inline validation
- save/cancel placement
- dirty state
- loading state

Long forms use border-free sections separated by spacing or dividers. A sticky step navigator is reserved for genuinely sequential workflows. Single-select and multi-select fields follow the shared dropdown and content-fit rules.

### Badges

Badges should communicate status, type, or role. Keep badge language short.

Examples:

- Ready
- Blocked
- Due Soon
- Overdue
- Draft
- Paid
- Pending
- Approved

### Modals And Drawers

Use modals for focused confirmation or small tasks. Use drawers for detail views, editing, filters, and settings panels.

Every modal/drawer needs:

- title
- close button
- backdrop
- keyboard close
- clear primary action
- safe cancel path

### Command Palette

The command palette is a core pattern and should stay.

It should search:

- tools
- modules
- records when available
- quick actions
- settings

Results should be grouped and keyboard navigable.

### Embedded Tool Shell

Embedded tools should inherit the parent product language.

The embedded shell should provide:

- tool title
- module breadcrumb
- reload
- open in new tab
- help or info
- consistent content padding
- consistent loading and error states

Inner tools hide duplicate top branding when opened inside the hub. Opening the same tool directly restores its icon, title, and `Live` badge without changing the tool's content or information architecture.

## Page Templates

### Command Center

Used for dashboard/home.

Contains:

- urgent work
- KPIs
- recent activity
- shortcuts
- alerts
- active jobs or queues

### Module Directory

Used for the all-tools view.

Contains:

- module groups
- short tool descriptions
- status
- search/filter
- primary launch action

### Record List

Used for clients, jobs, invoices, workers, assets, claims, and inventory.

Contains:

- table or list
- filters
- saved views
- batch actions when needed
- create action

### Record Detail

Used for one client, job, project, invoice, worker, or asset.

Contains:

- header summary
- status
- tabs or sections
- activity/history
- related records
- primary workflow actions

### Board View

Used for dispatch, readiness, and job progress.

Contains:

- columns or lanes
- status counts
- drag or move actions when supported
- quick filters
- compact job cards

### Settings

Used for tenant, team, access, links, integrations, and theme.

Contains:

- clear sections
- status-first rows
- hidden raw technical values unless expanded
- copy/reveal actions

## Future White-Label Requirements

For Phase 1, these items can remain where they already exist if changing them would distract from the UI/UX pass. For new shared components and new shell work, avoid hardcoding:

- `HG`
- `HG Group`
- `HG Services`
- `Black Lee`
- `@hggroup.com.my`
- staff names
- customer names
- logo file paths
- document issuer names
- tenant-specific URLs

Long term, use config instead:

```js
tenant = {
  name: "HG Group",
  productName: "HG Hub",
  logo: "hg-logo.png",
  primaryColor: "#143d4a",
  accentColor: "#143d4a",
  askHgAccent: "#7067d9",
  emailDomain: "hggroup.com.my",
  documentIssuer: "HG Group"
}
```

## HG Theme Direction

For the current redesign, HG should use:

- logo: `hg-logo.png`
- tenant name: `HG Group`
- product name: `HG Hub`
- product font: Manrope
- app and tool background: white
- muted surface: warm off-white
- primary operational accent: deep teal `#143d4a`
- semantic amber: warning and attention only
- Ask HG accent: purple
- text: near-black `#171717`
- border: warm neutral `#e4ded6`

The current HG Hub remains light by default, with a companion dark operational theme that preserves the same hierarchy, semantics, and component structure.

## Implementation Order

1. Redesign the main HG Hub shell.
2. Redesign dashboard/home as an operations command center.
3. Redesign tool directory and command palette.
4. Create the embedded tool shell.
5. Introduce shared tokens and component primitives as the shell is rebuilt.
6. Migrate high-use tools one by one.
7. Extract tenant configuration after the HG experience works well.

## Success Criteria

The redesign is working when:

- the app looks like one product across hub and tools
- HG branding can be swapped without redesigning UI
- mobile navigation is clean and focused
- users can scan status faster
- operational pages use consistent tables, forms, badges, and actions
- embedded tools no longer feel like separate apps
