# 01 Entry Auth Screen Contract

Status: direction approved
Approved visual reference: Acttual welcome back login
Reference notes: `01-entry-auth-references.md`

## Purpose

Define the entry and authentication experience before a user reaches HG Hub.

This contract covers only auth and entry states. Home IA, role command centers, navigation, embedded tool shell, and mobile UX are separate contracts.

## Approved Design Direction

Use the Acttual-style entry composition:

- bright, spacious canvas
- centered state card
- restrained HG Hub identity
- custom floating PNG objects around the card
- minimal chrome
- one dominant primary action per state

Do not copy the Acttual finance objects, customer logo strip, email/password fields, sign-up links, or exact brand treatment.

HG Hub should use original construction and operations imagery instead:

- quotation sheet fragments
- dispatch/job cards
- worker permit/document fragments
- scaffold tag or safety tag details
- hoarding panel or site measurement details
- measuring tape, binder clips, PPE, tools, lorry/fleet detail, or site-document objects
- subtle command-center/tool cards

The imagery should support the feeling of a construction operations hub without making the login feel busy.

## Current Code Anchors

Current entry states are in `index.html`:

- `gateConfig`: Supabase URL/key setup
- `gateLogin`: Google sign-in
- `gateDenied`: not-authorised state
- `route()`: decides which gate or shell to show
- `hubSignIn()`: starts Google auth
- `hubSignOut()`: signs out or changes account

## States

### Supabase Config Gate

Shown when Supabase URL/key is missing or Supabase cannot initialize.

Required content:

- HG Hub identity
- Supabase logo icon
- heading: Connect HG Hub
- short explanation that this is an admin/setup state
- Project URL field
- public anon key field
- primary action: Connect
- inline validation or error message

UX rule:

- This state should feel like a technical setup panel using the same visual shell, not a separate app.
- Normal users should understand they need admin help if they see this.

### Google Login

Shown when Supabase is configured but no user session exists.

Required content:

- HG Hub identity
- Google logo inside the primary action
- heading: Welcome back
- short helper copy: sign in with the Google account approved by admin
- primary action: Continue with Google
- no email/password fields for V1
- no sign-up link for V1

UX rule:

- Google sign-in is the only normal login path.
- Keep the card compact and centered.

### Not Authorised

Shown when Google login succeeds but the email is not in `allowed_users`.

Required content:

- HG Hub identity
- heading: Access not approved
- show the signed-in email
- explain that an admin must add the email to team access
- primary action: Use a different account

UX rule:

- This is a permission state, not a product error.
- Avoid alarming security language.

### Signed-In Transition

Shown briefly while moving from auth into the hub shell.

Required behavior:

- avoid flashing multiple gates
- show a calm loading state when needed
- preserve the same visual direction if a loading state is visible

## Layout Rules

Desktop:

- centered auth/state card
- generous white/light background
- original PNG objects placed near edges and corners
- objects must not cover the card or primary action
- primary button width should match the form field/card rhythm
- card content should remain readable at common laptop widths

Mobile:

- central card remains the focus
- decorative objects reduce or move behind edges
- primary action remains above the fold
- no horizontal scrolling
- fields and buttons use comfortable tap targets

## Asset Rules

Generate original PNG assets for HG Hub entry auth.

Asset direction:

- construction operations
- clean document fragments
- real-world office/site objects
- light shadows
- calm neutral background
- no finance-specific tokens, coins, banknotes, crypto icons, or unrelated SaaS objects

Avoid:

- busy construction photo backgrounds
- dark hero treatment
- stock-like hardhat imagery
- decorative gradients as the main visual
- copying Acttual's object layout exactly

## Copy Direction

Use short, friendly, operational copy.

Recommended login copy:

- Heading: Welcome back
- Helper: Sign in to open your HG Hub command center.
- Button: Continue with Google

Recommended config copy:

- Heading: Connect HG Hub
- Helper: Add the Supabase project details to start this workspace.
- Button: Connect

Recommended denied copy:

- Heading: Access not approved
- Helper: This Google account is not on the HG Hub access list.
- Email display: `user@company.com`
- Button: Use a different account

## Paper State References

The current Paper file contains six state references on the `HG` page:

- `01 Entry Auth Desktop - Google Login`
- `01 Entry Auth Desktop - Supabase Config Gate`
- `01 Entry Auth Desktop - Not Authorized`
- `01 Entry Auth Mobile - Google Login`
- `01 Entry Auth Mobile - Supabase Config Gate`
- `01 Entry Auth Mobile - Not Authorized`

## Acceptance Criteria

- All three entry states use one consistent visual system.
- The Google login path has one clear primary action.
- The Supabase config gate is clearly a setup/admin state.
- The not-authorised state explains the issue and next action without panic language.
- The design does not include password login, sign-up, or customer logo strips.
- Custom PNG construction/operations assets replace the Acttual finance objects.
- The screen works on desktop and mobile without covering form controls.
