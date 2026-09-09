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

- Cream `#FFF5EC`, ink `#282729`, blue `#6478FF`, white cards.
- Home backgrounds progress through honey `#FFE7A9`, blossom `#F9D5EE`, lavender `#AAB0F6`,
  and sage `#CDD490`, ending with the landscape photograph.
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
The wallet example is labeled; Confirm/Reject only update local demo state.

Placeholder anchors resolve to real local pages, Starkscan, the repository, and the configured
Chrome Web Store URL. The export’s Terms and X placeholders have no supplied destination;
the More column instead includes existing Support, Privacy Policy, and Security routes.
The existing Privacy page retains the shared shell. Chrome listing configuration and Cloudflare
security headers are unchanged.
