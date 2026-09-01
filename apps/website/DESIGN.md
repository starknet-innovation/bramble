---
name: Bramble Website
description: A daylight-paper editorial system grounded by the real Bramble wallet surface.
colors:
  daylight-paper: "#f5f5f3"
  ink: "#171717"
  white-surface: "#ffffff"
  light-on-ink: "#fafafa"
  secondary-wash: "#e9e9e6"
  muted-surface: "#ececea"
  muted-ink: "#62625e"
  hairline: "#d6d6d2"
  reading-ink: "#4f4f4b"
typography:
  display:
    fontFamily: "Instrument Sans Variable, Helvetica Neue, sans-serif"
    fontSize: "clamp(4rem, 8.3vw, 6rem)"
    fontWeight: 650
    lineHeight: 0.9
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Instrument Sans Variable, Helvetica Neue, sans-serif"
    fontSize: "clamp(2.5rem, 5vw, 5rem)"
    fontWeight: 640
    lineHeight: 0.98
    letterSpacing: "-0.04em"
  body:
    fontFamily: "Instrument Sans Variable, Helvetica Neue, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Instrument Sans Variable, Helvetica Neue, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, SF Mono, Menlo, monospace"
    fontSize: "0.7rem"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0.04em"
rounded:
  sm: "0.5rem"
  md: "0.6875rem"
  lg: "0.875rem"
  xl: "1.375rem"
  product: "1rem"
  pill: "999px"
spacing:
  page-gutter: "clamp(1.25rem, 4vw, 4.5rem)"
  section-block: "clamp(4rem, 7vw, 7rem)"
  reading-block: "clamp(4rem, 7vw, 6rem)"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.light-on-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 1.25rem"
  button-outline:
    backgroundColor: "{colors.daylight-paper}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 1.25rem"
  support-field:
    backgroundColor: "{colors.white-surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "1.15rem"
  wallet-preview:
    backgroundColor: "#090909"
    textColor: "{colors.light-on-ink}"
    rounded: "{rounded.product}"
    width: "min(20rem, 82vw)"
---

# Design System: Bramble Website

## Overview

**Creative North Star: "The Daylight Bramble"**

Bramble lives in a quiet monochrome world of daylight paper, the dark production wallet, ink, and
hairlines. The structure is editorial and unboxed: hierarchy, spacing, and rules organize the page
instead of a stack of generic crypto cards. The current production wallet surface is the hero's
visual proof.

The home route tells one continuous story from understanding to evidence to setup to download.
Reading routes keep the same visual world but recede into calm, legible guidance. Product language
is direct and specific; the interface must not invent adoption, safety, or performance claims.

**Key Characteristics:**

- Daylight-paper monochrome with the dark wallet capture as the hero's only strong contrast.
- Large, tightly set sans-serif headlines balanced against restrained reading copy.
- Full-width editorial sections separated by hairlines, not boxed cards.
- The real production wallet is the singular visual object; icons remain functional and quiet.
- Direction provenance: grounded structure 5, seed `acdb1a2d`; finish review passed.

## Colors

The palette is achromatic but warm enough to feel like paper rather than a software-gray canvas.

### Primary

- **Ink:** Primary text, filled actions, focus rings, selections, and the strongest rules.
- **Light on Ink:** Text and icons placed on filled Ink controls.

### Neutral

- **Daylight Paper:** The continuous page background and default outline-button surface.
- **White Surface:** The support textarea; use sparingly so writable surfaces read as physical
  objects against the page.
- **Secondary Wash:** Hover feedback for unboxed support routes.
- **Muted Surface:** Hover feedback for ghost and outline controls.
- **Muted Ink:** Supporting copy, metadata, inactive navigation, and secondary preview information.
- **Reading Ink:** Long-form documentation text, softer than headings but darker than metadata.
- **Hairline:** Section boundaries, list divisions, input borders, and structural rules.
**The No Accent Rule.** Do not introduce decorative crypto gradients, glow, or brand color. Contrast,
scale, and the production wallet carry emphasis.

**The White Is an Object Rule.** White indicates a raised or writable object, not an alternate page
background.

## Typography

**Display Font:** Instrument Sans Variable (Helvetica Neue, then sans-serif)

**Body Font:** Instrument Sans Variable (Helvetica Neue, then sans-serif)

**Label/Mono Font:** System monospace for technical microcopy only

**Character:** One variable sans family keeps the site direct and contemporary. Editorial character
comes from tight tracking, short balanced lines, and strong scale contrast rather than a decorative
display face.

### Hierarchy

- **Display:** Tightly tracked and compressed for the home and reading heroes; keep lines short and
  balanced.
- **Headline:** Section-level statements with nearly solid line height and a maximum width around
  11–13 characters.
- **Documentation heading:** A smaller fluid headline
  (`clamp(2.3rem, 4vw, 3.75rem)`, weight 640, line-height 1) for article sections.
- **Lead:** Supporting introductions use fluid type around 1.1–1.35rem and line-height 1.55.
- **Body:** Editorial copy uses 1rem with line-height 1.6; documentation extends to 1.72 in a
  48rem reading column.
- **Label:** Buttons, field labels, row titles, and navigation use compact semibold sans text.
- **Mono:** Counters and technical status microcopy use tabular or uppercase system mono at small
  sizes; do not use mono decoratively.

**The One Family Rule.** Create hierarchy with variable weight, scale, tracking, and measure before
introducing another typeface.

## Layout

The canvas is centered and capped at 90rem with a fluid page gutter. Major home sections use large
vertical bands and a single hairline at each boundary. On desktop, the home route is one asymmetric
story: copy advances in the left column while the production wallet remains viewport-pinned in the
right.
Reading routes pair statements with explanations and setup context with ordered steps. Whitespace is
structural; do not fill it with containers.

### Responsive behavior

- Above 900px, the header is a balanced three-column grid, the home narrative keeps its wallet stage
  fixed at viewport center beside the active section, and Docs and Support use dedicated reading
  grids.
- At 900px and below, the header navigation moves to a centered second row; hero, Docs hero, and
  Support composer stack; the wallet stage returns to normal document flow; the footer becomes two
  columns.
- At 680px and below, primary compositions, capability lists, Docs layout, and footer become one
  column. The Docs index becomes a non-sticky two-column list and support routes grow taller for
  wrapping copy.
- The document supports a 20rem minimum viewport. Fluid display sizes and the page gutter preserve
  hierarchy without forcing desktop proportions onto narrow screens.

### Route intent

- **`/` — Persuade:** Lead with the thesis and current production wallet, then move through
  capability decisions, the first-open path, and a final download action.
- **`/docs/` — Read:** Pair a short orientation with download access, then use a sticky local index
  and a narrow, generously led article column. Hairlines distinguish chapters without card chrome.
- **`/support/` — Read and route:** Explain the public GitHub handoff, offer a labeled question field,
  then expose direct documentation, bug, and private security-reporting routes. End with the secret
  warning; there is no implied support backend.

## Elevation & Depth

The system is flat by default. Depth comes from paper contrast, hairlines, and the wallet's ambient
elevation (`0 1.5rem 4rem rgb(23 23 23 / 10%), 0 0.2rem 0.8rem rgb(23 23 23 / 5%)`). The focused
support field uses one small shadow (`0 0.25rem 1rem rgb(23 23 23 / 6%)`).

**The Product Gets the Shadow Rule.** Reserve ambient elevation for the wallet object and active
field focus; editorial sections and route rows stay flat.

## Shapes

Controls are fully pill-shaped and meet a 2.75rem minimum height. Fields use the shared soft corner,
while the wallet capture keeps its production radius. The rest of the page remains rectilinear and
open, defined by 1px rules rather than rounded containers.

## Components

### Site shell and navigation

The shared header centers Docs and Support between the Bramble lockup and Download action. Inactive
links use Muted Ink; hover and `aria-current="page"` return to Ink, with the active route marked by a
1px underline. The footer repeats the lockup and keeps the route links compact.

### Buttons and links

- Filled buttons use Ink with Light on Ink; outline buttons keep Daylight Paper and a Hairline border;
  ghost buttons gain only Muted Surface on hover.
- Buttons are compact pills with at least 44px height, 1.25rem horizontal padding, semibold labels,
  and a 1px downward active press.
- Text links remain underlined, align any arrow icon to the label, and are preferred where a filled
  action would overstate hierarchy.

### Editorial lists and routes

Capability columns, ordered setup steps, documentation notes, and support destinations are unboxed
and separated by rules. Support destinations use a pale wash plus a small horizontal inset on hover;
capability and setup content remains still.

### Wallet preview

The preview uses current UI Lab captures of the real production Home, send review, deployment,
confirmation, swap, receive, collectibles, and token-management screens, never a separately designed
facsimile. On desktop it stays pinned at viewport center while the Home narrative selects the screen
that proves each section's message. The visible Home controls expose bounded hotspots for Send,
Swap, Receive,
Starkscan, Collectibles, and Manage tokens; flow screens expose a single return-to-Home action.

### Support field

Use a persistent label, native vertical resize, required validation, a 2,000-character maximum, and
a live visible character count in tabular mono. Focus darkens the border and adds only the small field
shadow. Placeholder text must remain secondary to the label.

### Interaction and motion

Use the shared expressive ease (`cubic-bezier(0.16, 1, 0.3, 1)`). Navigation and field feedback run
at 180ms and support-route feedback at 220ms. Wallet screen changes reuse the production wallet's
spatial model: the prior screen exits 8px toward its place in the journey while the next settles
from 12px over 260ms. Scroll and click use the same transition so the preview feels like one
persistent product surface.

With `prefers-reduced-motion: reduce`, restore automatic scrolling and remove nonessential
transitions from navigation, the support field, and support routes. New interaction states must
remain understandable with motion removed.

### Accessibility conventions

- Preserve semantic landmarks, heading order, labeled navigation, and `aria-current` route state.
- Keep the global 2px Ink focus outline with a 3px offset; do not substitute hover for focus.
- Mark decorative Lucide icons `aria-hidden`; give meaningful product captures useful alternative
  text.
- Maintain the 44px minimum control height, readable contrast, resizable support field, and text
  labels alongside icons.
- Keep safety copy explicit, especially the public nature of support issues and the prohibition on
  sharing wallet secrets.

## Do's and Don'ts

### Do

- **Do** let typography, whitespace, and hairlines organize the page.
- **Do** keep the home narrative ordered from understanding to proof to setup to download.
- **Do** update the hero capture from UI Lab when the production Home screen materially changes.
- **Do** retain explicit focus, active-route, hover, and reduced-motion behavior.
- **Do** keep product previews current and claims evidence-bound.

### Don't

- **Don't** wrap every capability, document section, or support route in a card.
- **Don't** add gradients, neon glow, glass effects, decorative color, or generic crypto imagery.
- **Don't** invent a separate wallet visual language for marketing surfaces.
- **Don't** use white indiscriminately; it should continue to identify an object or writable surface.
- **Don't** hide critical navigation, form labels, focus indicators, or risk language for visual
  cleanliness.
