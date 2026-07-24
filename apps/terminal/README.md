# MC Wallet Trade Terminal

A standalone Starknet trade terminal (Vite + React SPA). It connects to the MC
Wallet browser extension at runtime as a dApp and reads live market data from
several public APIs.

## Scripts

```bash
bun install
bun run dev        # dev server on http://localhost:5273 (with the CORS proxy)
bun run build      # tsc --noEmit && vite build
bun run build:contract # rebuild + hash-check the OpenZeppelin Punk class
bun run typecheck  # tsc --noEmit
bun run test       # vitest (mocked fetch/RPC — no network needed)
bun run check:api  # LIVE API smoke test — run on your own machine (see below)
```

## NFT Studio

The **NFT Studio** tab is a mint-only surface for the deployed, owner-controlled
MC Punks ERC-721 collection on Starknet Mainnet:

1. Connect MC Wallet and select Starknet Mainnet.
2. Choose an unclaimed catalog id from `0` through `9999`.
3. Choose the recipient and review the mint through MC Wallet.

The UI is pinned to
`0xda8b762dcb301e6b144e521ede1e2870ce9c723e5b4e6856c870ad341098a9`.
It exposes no class declaration, collection deployment, or NFT transfer
controls. The collection contract remains owner-minted, so the connected
account must hold its owner authority.

The Cairo class in `contracts/punk_collection/` composes OpenZeppelin Contracts
for Cairo v3.0.0 `ERC721Component`, `SRC5Component`, and `OwnableComponent`.
It adds only an owner-gated `mint` entry point, a fixed catalog limit, and
per-token metadata. It is intentionally non-upgradeable.

```bash
cd apps/terminal
SCARB_CACHE=/tmp/mc-wallet-scarb-cache bun run build:contract
cd contracts/punk_collection
SCARB_CACHE=/tmp/mc-wallet-scarb-cache snforge test
```

`build:contract` uses Scarb 2.18.0, rebuilds both Sierra and CASM, verifies the
pinned hashes, and only then publishes the Sierra class to
`public/contracts/punk_collection.contract_class.json`.

- Sierra class:
  `0x5b5f364528b903513d36dce0aa5544d192c6a25865eeba9ba8a059d7f858263`
- Compiled class:
  `0x7372305f2ffd87350af2927b3e484d91ba0e594d62f5a33d8c8ac656729560a`

The Foundry tests prove the owner-only mint rule and a complete
owner → user A mint → user B transfer. The terminal separately tests calldata,
class-hash validation, declaration wrapping, and launch/mint/send UI flows.

Artwork previews and metadata reference the official per-Punk image host at
runtime. Each mint stores its JSON as a self-contained Base64 data URI for
consistent wallet and explorer parsing. No CryptoPunks artwork is copied into
this repository. This project is an unaffiliated interoperability demo; the NFT
contract and terminal code do not grant rights to the referenced artwork.

## Wallet request experience

All terminal mutations go through `WalletProvider.requestTransaction` instead
of calling `account.execute` from individual screens. The provider owns a
single, consistent lifecycle:

- terminal-side review with account, network, call count, and action details;
- spec-shaped `invoke_transaction` payloads with compiled calldata copied into
  plain JSON before it crosses the wallet provider trust boundary;
- explicit hand-off while MC Wallet is waiting for approval;
- calm rejection copy with a safe retry;
- validated transaction-hash feedback after submission.

The connected control in the top navigation is a session menu with wallet,
network, address copy, and explicit disconnect actions. A wallet-side account
or network change updates the executable account binding before the next
request.

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

The persistent production deployment is
[mc-wallet-terminal.vercel.app](https://mc-wallet-terminal.vercel.app).
`vercel.json` supplies same-origin reverse-proxy routes for Extended REST and
AVNU market data, then builds their `VITE_*_BASE` overrides into the client.
Other production hosts must provide equivalent CORS-enabled routes and set
`VITE_EXTENDED_REST_BASE` and `VITE_AVNU_MARKETS_BASE` themselves.

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
