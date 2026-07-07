# 01 Entry Auth References

Status: reference shortlist for direction selection
Source: Mobbin MCP, web screens
Screen contract target: `01-entry-auth.md`

## Approved Entry Auth Direction

Approved reference:

- [Acttual welcome back login](https://mobbin.com/screens/4acd76c7-c9c0-4738-ad2e-44e325d0f469?utm_source=copy_link&utm_medium=link&utm_campaign=screen_sharing)

Use this direction for:

- Google login
- Supabase config gate
- not-authorised state

Direction:

- centered login
- bright, spacious background
- light product-object context around the form/state card
- minimal chrome
- one dominant primary action per state

HG Hub adaptation:

- keep the calm, open composition
- replace finance-specific objects with HG Hub construction and operations imagery
- generate original PNG assets for the surrounding objects
- use references such as construction documents, site photos, quotation sheets, dispatch cards, worker permits, scaffold tags, hoarding panels, measuring tools, PPE, lorry/fleet details, and tool command cards
- avoid email/password fields unless HG Hub adds password auth later
- avoid customer logo strips; HG Hub is internal/white-label-ready, so social proof is not needed on the auth gate
- keep the product mark and workspace name visible but restrained

State adaptation:

- Google login uses the approved centered form with `Continue with Google`.
- Supabase config gate uses the same composition but swaps the central card content to setup fields.
- Not-authorised uses the same composition but swaps the central card content to a clear permission message and `Use a different account`.

## What This Screen Must Cover

HG Hub entry auth has four states:

- Supabase config gate
- Google login
- not-authorised state
- signed-in transition into the hub

The references below are not for copying directly. They are pattern references for choosing the direction.

## Direction A: Quiet Centered Login

Best for: the normal Google sign-in screen.

Pattern:

- centered auth card
- very little visual noise
- clear product name
- one dominant sign-in action
- small helper text for admin allowlist expectation

References:

- [Jobber sign-in](https://mobbin.com/screens/ba495aa2-addb-47e0-aab9-693534600294)
- [Workable sign-in](https://mobbin.com/screens/5acd1e36-68e7-4263-b74f-e21b89eb679e)
- [Mixpanel sign-in](https://mobbin.com/screens/80d98293-0bc4-48be-a191-96880a9596da)
- [ClickUp sign-in](https://mobbin.com/screens/cb749a98-2d8c-456b-b40a-0ed027676504)

Why it fits HG Hub:

- HG Hub is an internal operations product, not a marketing site.
- Users need to sign in quickly and trust that they are in the correct workspace.
- The UI should feel calm, official, and low-friction.

Risk:

- If too plain, it can feel unfinished. The HG identity needs to appear through spacing, typography, and a confident product mark.

## Direction B: Split Auth With Product Context

Best for: a more polished entry screen that introduces the hub before sign-in.

Pattern:

- login form on one side
- product context or value message on the other side
- more brand surface than a pure centered card
- useful when users need reassurance about what they are entering

References:

- [AutoSend sign-in](https://mobbin.com/screens/219e6607-a8a1-4763-a821-1e44bf388283)
- [Air sign-in](https://mobbin.com/screens/45e9c439-6c40-46b9-8429-0dd6fb1ab124)
- [Jobber alternate sign-in](https://mobbin.com/screens/2e20f104-676c-454b-abf9-ef95375c6dc1)

Why it fits HG Hub:

- It can show that HG Hub is the operating system for tools, teams, and daily work.
- It gives the product a stronger first impression.

Risk:

- If the context panel becomes decorative, it slows down the login and makes the hub feel like a landing page.

## Direction C: Technical Setup Gate

Best for: Supabase config missing state.

Pattern:

- direct setup form
- clear fields
- short helper copy
- visible progress or validation feedback
- no marketing language

References:

- [OpenAI Platform setup/admin screen](https://mobbin.com/screens/8959c016-ec2e-41bf-8eed-02dc0d41df00)
- [OpenAI Platform configuration screen](https://mobbin.com/screens/3be9f24f-9cd4-4150-935a-7ece11551473)
- [Resend setup screen](https://mobbin.com/screens/0488ff1a-dbd5-4b95-a4e9-5f9fe32c280a)

Why it fits HG Hub:

- The Supabase config gate is a technical setup state, not a normal user login.
- It should be obvious that this state is for setup/admin recovery only.

Risk:

- Normal users should not feel like they are responsible for technical setup.

## Direction D: Plain Permission State

Best for: not-authorised / not allowlisted.

Pattern:

- concise denial message
- explain which account is blocked
- give one next action
- avoid alarming language

References:

- [Notion permission state](https://mobbin.com/screens/46abb577-0502-4c57-b90d-6d96ffa05115)
- [Todoist access/error state](https://mobbin.com/screens/f4cf854e-0fce-4633-82c1-6169deadeb98)
- [Whereby permission/error state](https://mobbin.com/screens/98b1c0c3-5648-48e9-b8e0-0ca5f79e56bd)
- [Mixpanel permission/error state](https://mobbin.com/screens/8bc4ab67-6d62-4d1e-944c-05bc5bff956b)

Why it fits HG Hub:

- Not-authorised is not a failure of the product.
- The user needs to know which email was used and what to ask an admin to do.

Risk:

- Too much error styling can make a simple allowlist issue feel like a security incident.

## Final Reference Decision

Use one consistent entry-auth system based on the approved Acttual direction:

- Google login: Acttual-inspired centered entry screen
- Supabase config gate: same layout, technical setup content
- Not-authorised: same layout, permission-state content
- Background/object imagery: original HG construction/operations PNG assets

This keeps entry auth fast, practical, and internal-tool appropriate.
