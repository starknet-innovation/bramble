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

| Purpose             | Host                                        | Dev proxy prefix       |
| ------------------- | ------------------------------------------- | ---------------------- |
| Token/majors prices | `https://api.coingecko.com`                 | `/proxy/coingecko`     |
| Token universe      | `https://starknet.api.avnu.fi`              | `/proxy/avnu`          |
| Token fallback      | `https://mainnet-api.ekubo.org`             | `/proxy/ekubo`         |
| Perps (REST)        | `https://api.starknet.extended.exchange`    | `/proxy/extended`      |
| Perps (WebSocket)   | `wss://api.starknet.extended.exchange`      | `/proxy/extended-ws`   |
| Starknet RPC        | `https://api.cartridge.gg/x/starknet/mainnet` | `/proxy/rpc`         |

These APIs do **not** send an `Access-Control-Allow-Origin` header, so a direct
browser `fetch` from `http://localhost:5273` is blocked by CORS (and CoinGecko
also rate-limits anonymous callers with `429`). To fix this in development,
`vite.config.ts` defines a `server.proxy` that maps the `/proxy/<name>` prefixes
above onto the real hosts (`changeOrigin: true`, prefix stripped via `rewrite`,
plus `ws: true` for the WebSocket). The browser talks same-origin to Vite, which
forwards the request server-side where there is no CORS.

`src/data/endpoints.ts` is the single source of truth for every base and is
**environment-aware**:

- **Dev server** (`import.meta.env.DEV`, excluding vitest): uses the relative
  `/proxy/...` paths → no CORS.
- **Production build / tests**: uses the direct hosts, each overridable via
  `import.meta.env.VITE_<NAME>_BASE` (`VITE_COINGECKO_BASE`, `VITE_AVNU_BASE`,
  `VITE_EKUBO_BASE`, `VITE_EXTENDED_REST_BASE`, `VITE_EXTENDED_WS_BASE`).

### Production

The Vite dev proxy only runs under `bun run dev`. A production deployment will
hit the same CORS wall unless you either (a) front these APIs with a real
reverse proxy (nginx, a CDN edge worker, etc.) that adds CORS headers, or (b)
use CORS-enabled hosting — then set the `VITE_*_BASE` vars to point at it.

## Rate limits & resilience

CoinGecko's free tier is the main source of `429`s. To stay under it the data
layer:

- Coalesces concurrent requests for the same URL into one network call and
  serves a short-lived in-memory cache (`src/data/cache.ts`).
- Polls at calm intervals — prices every 60s, token universe every 120s, candles
  per-timeframe (60s intraday → 1h for multi-year), perps stats every 20s.
- Backs off exponentially on `429`/`5xx`, honoring a `Retry-After` header when
  present, while keeping the last-good data on screen.

### CoinGecko API key (optional)

Set a [CoinGecko demo key](https://www.coingecko.com/en/api) to lift the harsh
anonymous limit. Create `apps/terminal/.env.local`:

```
VITE_COINGECKO_API_KEY=CG-xxxxxxxxxxxx
```

It is sent as the `x-cg-demo-api-key` header (which rides through the dev proxy).

## Live API check (`bun run check:api`)

`scripts/check-api.ts` verifies the live upstreams from **Node/Bun**, where
`fetch` has no CORS and full network egress — this is how you diagnose remaining
shape/rate/host issues that unit tests (which mock `fetch`) cannot catch.

```bash
cd apps/terminal
bun run check:api
# with a CoinGecko key:
VITE_COINGECKO_API_KEY=CG-xxxx bun run check:api
```

For each endpoint it hits the **direct** host (bypassing the dev proxy), prints a
`PASS`/`FAIL`/`WARN` line with the HTTP status, latency, and a sample of the
parsed result, and feeds the real response through the app's own
parser/normalizer (`toEntry`, `toAvnuRows`, `toEkuboRows`, `bucketCandles`, and
the `data/extended/parse.ts` functions). It covers:

- CoinGecko `simple/token_price/starknet` and `simple/price`
- Avnu `/swap/v2/tokens`, Ekubo `/tokens` (fallback, optional)
- Extended `/info/markets`, `/info/markets/{m}/stats`,
  `/info/candles/{m}/{type}`, `/info/{m}/funding`, `/info/markets/{m}/orderbook`
- Starknet RPC `starknet_chainId` + a sample `balanceOf`

Each request has its own timeout and its errors are caught, so one dead host
never aborts the run. It ends with a summary and exits non-zero if any
**required** endpoint failed (the Ekubo fallback is optional and only warns).
