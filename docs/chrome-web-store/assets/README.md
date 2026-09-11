# Store asset sources

The Bramble mark has one vector source, `apps/website/public/brand/mark.svg` (also the website
favicon). Everything here that shows the mark is rendered from it:

```bash
bun run scripts/render-brand-assets.ts
```

which writes `icon.svg` (the composed 128×128 icon: cream ground, ink bird), the five extension
icons in `apps/extension/public/icons/`, the `icon-128.png` listing copy, refreshes the `#mark`
path inside `promo-small-source.svg`, and renders `promo-small-440x280.png`. It rasterises with the
Playwright Chromium the E2E suite installs (`bun run test:e2e:install`), one page per size so the
16px toolbar icon is a true render rather than a downscale. Hand-edit the promo's composition in
its SVG; never edit the mark path there by hand.

Screenshots must be recaptured from the production UI template for each store submission; never
retouch transaction or account content into a screenshot.

Expected upload dimensions:

- `icon-128.png`: 128×128
- `promo-small-440x280.png`: 440×280
- `screenshot-*-1280x800.png`: 1280×800
