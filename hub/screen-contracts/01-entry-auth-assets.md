# 01 Entry Auth Generated Assets

Status: generated for design prototype
Generation mode: built-in imagegen
Canvas: Cowart at `http://127.0.0.1:43217`

## Assets

### Logo Assets

Files:

- `../../hg-logo.png`
- `assets/logos/google-g-logo.png`
- `assets/logos/supabase-logo-icon.png`

Use:

- HG logo placement in the auth state UI
- Google PNG in the normal login primary action
- Supabase PNG in the config/setup state

### Desktop Background

File: `assets/entry-auth-bg-construction-v1.png`

Use:

- desktop `01-entry-auth` login/config/denied background
- centered auth card overlays on the clean middle area

Prompt summary:

- Acttual-inspired spacious login background
- original HG construction/operations objects near the edges
- quotation sheet, scaffold tag, measuring tape, dispatch card, work permit, lorry/fleet document, subtle tool cards
- bright off-white studio background
- no finance objects, no money, no people, no login form

### Mobile Background

File: `assets/entry-auth-bg-construction-mobile-v1.png`

Use:

- mobile `01-entry-auth` login/config/denied background
- central vertical space reserved for auth card

Prompt summary:

- portrait construction/operations login background
- objects near top, bottom, and side edges
- clear center for form overlay
- same material language as desktop

### Transparent Object Kit

File: `assets/entry-auth-object-kit-transparent-v1.png`

Source: `assets/entry-auth-object-kit-chromakey-v1.png`

Use:

- optional flexible object placement in prototypes
- tuning desktop/mobile composition without regenerating a full background

Prompt summary:

- separate construction objects on a chroma-key background
- quotation sheet, scaffold tag, measuring tape, dispatch/job clipboard, work permit, HG Hub tool cards
- chroma key removed locally into transparent PNG

## Cowart Placement

Placed into the Cowart canvas:

- Desktop Background
- Mobile Background
- Transparent Object Kit

The object kit preview may show a dark background in some viewers, but the saved file has transparency.

### Annotation Revision: More Center Space

File: `assets/annotation-edit-20260707-150732-entry-auth-more-center-space.png`

Use:

- revised desktop auth background based on Cowart annotation
- moves construction/operations assets farther left and right to create more open center space for the login card

Cowart:

- inserted beside the annotated original as a new image
- original image and annotations were not replaced or deleted

### Paper Editable Layer Crops

Files:

- `assets/paper-layers/entry-auth-left-objects-feathered-v1.png`
- `assets/paper-layers/entry-auth-right-objects-feathered-v1.png`

Use:

- Paper auth artboard object layers
- left and right construction/operations groups can be moved independently
- center auth safe zone stays clear for login, config gate, and not-authorized states

Paper:

- added to current Paper file on the `HG` page
- artboard name: `HG Hub 01 Entry Auth - Editable Object Layers`

### Paper Mobile Editable Layer Crops

Files:

- `assets/paper-layers/entry-auth-mobile-top-left-objects-feathered-v1.png`
- `assets/paper-layers/entry-auth-mobile-right-objects-feathered-v1.png`
- `assets/paper-layers/entry-auth-mobile-bottom-objects-feathered-v1.png`

Use:

- Paper mobile auth artboard object layers
- right-side construction/operations group can be moved independently
- bottom construction/form group can be moved independently
- center mobile auth safe zone stays clear for login, config gate, and not-authorized states

Paper:

- added to current Paper file on the `HG` page
- artboard name: `HG Hub 01 Entry Auth Mobile - Editable Object Layers`

## Paper State References

Added to the current Paper file on the `HG` page:

- `01 Entry Auth Desktop - Google Login`
- `01 Entry Auth Desktop - Supabase Config Gate`
- `01 Entry Auth Desktop - Not Authorized`
- `01 Entry Auth Mobile - Google Login`
- `01 Entry Auth Mobile - Supabase Config Gate`
- `01 Entry Auth Mobile - Not Authorized`

State behavior:

- Google login uses the Google PNG inside the primary action.
- Supabase config gate uses the Supabase PNG and includes project URL, public anon key, and Connect.
- Not-authorized state shows the signed-in email and a different-account action.
- Desktop and mobile variants preserve the approved Paper object-layer positions.
