# MC Wallet Trade Terminal

A standalone Starknet trade terminal (Vite + React SPA). It connects to the MC
Wallet browser extension at runtime as a dApp and reads live market data from
several public APIs.

## Scripts

```bash
bun install
bun run dev        # dev server on http://localhost:5273 (with the CORS proxy)
bun run build      # tsc --noEmit && vite build
bun run typecheck  # tsc --noEmit
bun run test       # vitest (mocked fetch/RPC — no network needed)
bun run check:api  # LIVE API smoke test — run on your own machine (see below)
```

## Data sources & the CORS dev proxy

The terminal reads from these hosts:

| Purpose                    | Host                                           | Browser access             |
| -------------------------- | ---------------------------------------------- | -------------------------- |
| Token markets and candles  | `https://starknet.impulse.avnu.fi`             | `/proxy/avnu-markets` in dev |
| Swap quotes/builds         | `https://starknet.api.avnu.fi`                 | Direct (CORS-enabled)      |
| Token fallback             | `https://prod-api.ekubo.org`                   | Direct (CORS-enabled)      |
| Perps (REST)               | `https://api.starknet.extended.exchange`       | `/proxy/extended` in dev   |
| Perps (WebSocket)          | `wss://api.starknet.extended.exchange`         | `/proxy/extended-ws` in dev|
| Starknet RPC               | `https://api.cartridge.gg/x/starknet/mainnet`  | Direct (CORS-enabled)      |

Ekubo and Cartridge allow browser origins. AVNU market data is still routed
through Vite in development so its `404`/`5xx` response for an asset with no
candle history becomes a clean empty series. Extended REST and WebSocket traffic
are proxied because Extended rejects browser REST origins and WebSocket
handshakes unless their headers are sanitized server-side. The development
WebSocket bridge keeps its browser-facing sockets stable while it reconnects a
reset upstream connection, so transient exchange disconnects do not create a
browser error/reconnect loop.

`src/data/endpoints.ts` is the single source of truth for every base and is
**environment-aware**:

- **Dev server** (`import.meta.env.DEV`, excluding vitest): proxies Extended and
  AVNU market data; quote/build, Ekubo, and RPC sources remain direct.
- **Production build / tests**: uses direct hosts, overridable with
  `VITE_AVNU_BASE`, `VITE_AVNU_MARKETS_BASE`, `VITE_EKUBO_BASE`,
  `VITE_EXTENDED_REST_BASE`, and `VITE_EXTENDED_WS_BASE`.

### Production

The Vite dev proxy only runs under `bun run dev`. A production deployment must
front Extended REST with a reverse proxy that adds CORS headers, then set
`VITE_EXTENDED_REST_BASE` to it. To retain no-history candle normalization in a
deployed build, expose AVNU market data through the same reverse proxy and set
`VITE_AVNU_MARKETS_BASE` to it.

## Rate limits & resilience

The data layer stays within public API limits by:

- Coalesces concurrent requests for the same URL into one network call and
  serves a short-lived in-memory cache (`src/data/cache.ts`).
- Polls at calm intervals — prices every 60s, token universe every 120s, candles
  per-timeframe (60s intraday → 1h for multi-year), perps stats every 20s.
- Backs off exponentially on `429`/`5xx`, honoring `Retry-After` while keeping
  the last-good data on screen. Candle history does not retry because the AVNU
  service uses `5xx` for some assets that simply have no series.
- Letting each caller cancel its own wait without aborting the shared request
  used by other tabs or React Strict Mode remounts.

## Live API check (`bun run check:api`)

`scripts/check-api.ts` verifies the live upstreams from **Node/Bun**, where
`fetch` has no CORS and full network egress — this is how you diagnose remaining
shape/rate/host issues that unit tests (which mock `fetch`) cannot catch.

```bash
cd apps/terminal
bun run check:api
```

For each endpoint it hits the **direct** host (bypassing the dev proxy), prints a
`PASS`/`FAIL`/`WARN` line with the HTTP status, latency, and a sample of the
parsed result, and feeds the real response through the app's own
parser/normalizer (`toAvnuRows`, `toEkuboRows`, `toAvnuCandles`, and
the `data/extended/parse.ts` functions). It covers:

- AVNU `/v3/tokens` and token OHLC, Ekubo `/tokens` (fallback, optional)
- AVNU v3 swap quote/build and an Extended public WebSocket frame
- Extended `/info/markets`, `/info/markets/{m}/stats`,
  `/info/candles/{m}/{type}`, `/info/{m}/funding`, `/info/markets/{m}/orderbook`
- Starknet RPC `starknet_chainId` + a sample `balanceOf`

Each request has its own timeout and its errors are caught, so one dead host
never aborts the run. It ends with a summary and exits non-zero if any
**required** endpoint failed (the Ekubo fallback is optional and only warns).
