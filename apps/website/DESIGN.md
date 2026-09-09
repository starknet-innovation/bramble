# Bramble website design

The Home, Docs, and Support offline HTML exports supplied in `Bramble-Website-UI` are the
visual source. The implementation uses the existing React/Vite multipage app without the
exports’ DesignCanvas runtime, bundled React, inline scripts, or CDN loads.

## Assets and typography

`public/brand/` contains the supplied wordmark, bird mark, two mascot illustrations, landscape
photograph, Pangea Medium/Semibold OTF files, and Archivo Latin variable WOFF2. SVG titles are
added for accessibility; artwork is unchanged. Only fonts used by the site are included.
The export supplies standard-width Pangea for display and Archivo as a substitute for the
unavailable PP Neue Montreal body font. All assets are served locally.

## Visual system

- Cream `#FFF5EC`, ink `#282729`, accessible blue `#3948B5` (darkened from the supplied `#6478FF`), white cards.
- The page stays cream throughout; there are no scroll-triggered background transitions.
  The download section retains the supplied landscape photograph with a uniform dark tint.
- Pangea headings use weight 500 and tight line height; the closing headline uses weight 600.
  Body copy and controls use Archivo. Cards have 10px corners and controls are pill shaped.
- The desktop wallet example stays beside four story sections. Below 800px it follows the
  hero in normal flow. Navigation wraps at 600px; cards and documentation stack for phones.
- The documentation index stays visible on desktop. Support uses white routing, FAQ, and form
  cards. Keyboard focus, skip navigation, and reduced-motion preferences remain supported.

## Content and functional adaptations

The homepage uses the supplied copy. The funding step retains the actual explicit account
deployment flow. Docs and Support exports explicitly mark their body text as placeholder;
existing wallet guidance replaces lorem ipsum and the fake support email address.
The existing GitHub issue builder powers the support form, with a visible handoff and no email
collection or implied messaging backend. The private security reporting route remains available.
The sticky preview uses the original production-wallet screenshots and interactive hotspots.
Scrolling selects Home, review, receive, and deployment screens. The frame scales to the
available viewport height beneath the header. The landscape uses a uniform tint, with no gradients.

Placeholder anchors resolve to real local pages, Starkscan, the repository, and the configured
Chrome Web Store URL. The export’s Terms and X placeholders have no supplied destination;
the More column instead includes existing Support, Privacy Policy, and Security routes.
The existing Privacy page retains the shared shell. Chrome listing configuration and Cloudflare
security headers are unchanged.

Controls use 44px heights (48px for primary hero actions), with 14–16px labels.
Display headings are capped at 68px; the Foundation badge and bird sit side by side with their vertical centers aligned.
The redundant Open Starkscan hero action is omitted.

## Contrast

Primary button labels exceed 7:1 against the deeper blue. Secondary text uses opaque ink,
form boundaries use a dedicated darker token, and hover/disabled states never fade text.
The landscape’s uniform multiply tint caps its brightest possible pixel at #626262,
keeping cream copy above 5.6:1. Focus rings switch to cream over the dark landscape.

Section spacing follows content: middle story sections have 64px vertical padding instead
of viewport-height floors, reading chapters use 36–48px gaps, and support groups use 40–56px.
