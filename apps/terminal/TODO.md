# Terminal Remediation Checklist

- [x] Route Extended REST through the development server and remove browser-side `403` failures.
- [x] Normalize missing AVNU candle history without browser-visible `404`/`500` retry floods.
- [x] Populate Discover, Tokens, Perps, and Portfolio from their live data hooks with explicit loading, empty, and error states.
- [x] Make chart data follow the selected asset, market, and timeframe tabs.
- [x] Give Long/Short and order-type controls one unambiguous selected state.
- [x] Keep Extended browser WebSockets stable across upstream resets and reconnect upstream with bounded backoff.
- [x] Cover REST parsing, WebSocket lifecycle/reconnects, screen interactions, swaps, caching, and wallet reactivity with automated tests.
- [x] Wire configurable AVNU/Ekubo token swaps through quote, route selection, build, wallet approval, and execution states.
- [x] Make wallet discovery, connect requests, account changes, disconnects, and approval-surface opening reactive.
- [x] Standardize the terminal on a neutral dark product palette without gradients or pervasive blue/green tinting.
- [x] Verify the Perps page in Chromium with four live streams and no failed requests, socket errors, or console errors.
