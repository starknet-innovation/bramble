# Bramble Trade Terminal

A standalone Starknet trade terminal (Vite + React SPA). It connects to the Bramble browser extension at runtime as a dApp and reads live market data from
several public APIs.

## Scripts

```bash
bun install
bun run dev        # UI-only Vite server on http://localhost:5273
bun run dev:full   # pinned on-demand Vercel dev server, including API functions
bun run build      # tsc --noEmit && vite build
bun run build:contract # rebuild + hash-check the OpenZeppelin Punk class
bun run typecheck  # tsc --noEmit
bun run test       # vitest (mocked fetch/RPC — no network needed)
bun run check:api  # LIVE API smoke test — run on your own machine (see below)
```

Use `bun run dev:full` for the Privacy tab. Plain `bun run dev` intentionally
does not emulate Vercel Functions.

## Privacy pool and AVNU private swap

The **Privacy** tab is a Mainnet-only test surface for the deployed Starknet
privacy pool:

`0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`

It reads a minimal typed pool view (`version`, fee, fee collector, and proof
validity), provides the explicit one-time **Activate private balances** flow,
requests aggregate private balances from Bramble, and supports shield,
withdraw, private transfer, and AVNU private swap flows. Notes, viewing keys,
signing material, and proof generation remain inside the wallet.

Activation uses the Bramble-namespaced `mc_strk20Register` capability because the
standard Wallet API defines `NOT_REGISTERED` but no registration RPC. Bramble
holds that request for an explicit review and binds it to the origin, account,
network, configured pool, tracked token, and payload digest before submitting
the public one-time transaction.

AVNU private swaps are currently unavailable pending independent verification of the
executor deployment. `shared/privacy.ts` holds a null `PRIVATE_SWAP_EXECUTOR` anchor;
the client and server refuse route planning while it is unset. Enabling this path
requires a reviewed mainnet address, source/deployment provenance and upgrade-authority
assessment committed with the pin. A quote response is not an independent source for it.
Core private balances, shield, withdraw and private transfers are unaffected.

Once a reviewed executor is pinned, the AVNU private-swap flow is split:

1. A same-origin server function asks the pinned AVNU SDK for the exact private
   route and paymaster fee. The browser receives a bounded action plan and
   independently validates it, including exactly two embedded calls, their spender,
   amounts, tokens, beneficiary and enforced minimum output.
2. The Terminal shows sell amount, expected and minimum buy amounts, slippage, executor,
   pool fee, and action count.
3. Bramble independently validates the actions, checks private balances and
   privacy-leak warnings, asks for approval, and generates the proof.
4. The server submits only that pool-bound proof through AVNU's private
   paymaster. It returns a validated transaction hash.

The AVNU SDK (`4.2.0`) is imported only by Vercel Functions. It is not included
in the browser bundle.

### Server-only configuration

Copy `.env.example` to `.env.local` for local development, or add the same
names with `vercel env add`:

```bash
STRK20_DISCOVERY_UPSTREAM=
STRK20_PROVER_UPSTREAM=
STRK20_PAYMASTER_UPSTREAM=https://starknet.paymaster.avnu.fi
AVNU_PAYMASTER_API_KEY=
BRAMBLE_EXTENSION_ORIGINS=chrome-extension://<released-extension-id>
TERMINAL_ALLOWED_ORIGINS=https://mc-wallet-terminal.vercel.app,http://localhost:3000
```

Never prefix upstream URLs or the paymaster key with `VITE_`; Vite variables
are browser-readable. The public gateway URL is visible by design, while the
upstream discovery/prover URLs stay server-side.

`BRAMBLE_EXTENSION_ORIGINS` accepts only exact Chrome extension origins for the
CORS allowlist. Browser-stamped privileged extension fetches are also accepted,
including originless GETs, independently of that allowlist. This excludes normal
website fetches but does not identify a particular extension build: another
extension can use the privileged shape, and a standalone HTTP client can spoof
headers. No secret can safely be embedded in an extension. Production must additionally apply Vercel Firewall
rate limits and abuse controls to `/api/strk20/*` and
`/api/private-swap/*`. The code intentionally does not pretend an in-memory
serverless counter is durable protection.

The discovery/prover proxy permits only the protocol's required routes,
methods, and content types; caps request and response sizes; rejects redirects;
uses bounded timeouts; binds paymaster traffic to the audited pool and STRK fee
token; strips upstream error bodies; and never logs request content. OHTTP is
enabled in the bundled wallet configuration, so the gateway sees encrypted
discovery/proving envelopes when both upstream services support it.

An anonymizer is not a global pool address. It is a dapp-specific adapter that
handles private notes according to that dapp's rules, so its contract appears
as an explicit target in that dapp's reviewed action plan. AVNU private swap
uses AVNU's private executor, while Vesu or another dapp uses its own audited
adapter. Core pool operations do not configure one. The wallet's optional
`subaccountAnonymizerAddress` setting is a separate SDK module used only for
generic `subaccount_invoke` actions.

## NFT Studio

The **NFT Studio** tab is a mint-only surface for the deployed, owner-controlled
MC Punks ERC-721 collection on Starknet Mainnet:

1. Connect Bramble and select Starknet Mainnet.
2. Choose an unclaimed catalog id from `0` through `9999`.
3. Choose the recipient and review the mint through Bramble.

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
SCARB_CACHE=/tmp/bramble-scarb-cache bun run build:contract
cd contracts/punk_collection
SCARB_CACHE=/tmp/bramble-scarb-cache snforge test
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

## Vesu professional lending

The **Lending** tab is a mainnet Vesu V2 desk built around the live verified
pool inventory. It includes:

- searchable/sortable earn and borrow markets, isolated-pool liquidity,
  utilization, supply APY, and borrow APR;
- an interactive implementation of Vesu's adaptive piecewise interest-rate
  curve, with current utilization, target band, max-utilization boundary, and a
  keyboard-accessible what-if readout;
- explicit oracle heuristics on every market: Oracle contract, Pragma key,
  source count, aggregation mode, timeout, and time window;
- supply, withdraw, collateralized borrow, and repay actions;
- atomic **Multiply wind** through Ekubo exact-output routing and one-click
  **full unwind** from the Positions view;
- open position health/LTV, curated vault deposits, asynchronous redemption
  requests/claims, and proof-backed BTCFi reward claims.

Every mutation uses one Starknet account multicall. Temporary ERC-20 allowances
and Vesu delegation are revoked in that same transaction, and all calls flow
through the terminal review before the wallet opens. Multiply wind/unwind
reviews show the target multiplier or full debt, route slippage, LTV, and
delegation lifecycle.

The data boundary only accepts `protocolVersion=v2`, Vesu-verified,
non-deprecated pools. API JSON is validated and normalized before rendering;
deployed `modify_position`, `modify_delegation`, ERC-4626, and `modify_lever`
ABIs were cross-checked on Starknet Mainnet.

## Wallet request experience

All terminal mutations go through `WalletProvider.requestTransaction` instead
of calling `account.execute` from individual screens. The provider owns a
single, consistent lifecycle:

- terminal-side review with account, network, call count, and action details;
- spec-shaped `invoke_transaction` payloads with compiled calldata copied into
  plain JSON before it crosses the wallet provider trust boundary;
- explicit hand-off while Bramble is waiting for approval;
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
| Token markets and history  | `https://starknet.impulse.avnu.fi`             | `/proxy/avnu-markets` in dev |
| Swap quotes/builds         | `https://starknet.api.avnu.fi`                 | Direct (CORS-enabled)      |
| Token fallback             | `https://prod-api.ekubo.org`                   | Direct (CORS-enabled)      |
| Perps (REST)               | `https://api.starknet.extended.exchange`       | `/proxy/extended` in dev   |
| Perps (WebSocket)          | `wss://api.starknet.extended.exchange`         | `/proxy/extended-ws` in dev|
| Vesu V2 pools/positions    | `https://api.vesu.xyz`                         | Direct (CORS-enabled)      |
| Vesu Multiply routes       | `https://prod-api-quoter.ekubo.org`            | Direct (CORS-enabled)      |
| Indexed holdings/activity  | `https://starkscan.co/v1/SN_MAIN`              | `/proxy/starkscan` in dev  |
| Starknet RPC               | `https://mainnet.nodes.starknet.org/rpc/v0_10` | Direct (CORS-enabled)      |

Ekubo and Cartridge allow browser origins. AVNU market data is routed through
Vite in development for one consistent browser path. Token charts prefer a
liquid Extended index-price market when the symbol maps and otherwise use
AVNU's contract-specific line history; AVNU's legacy OHLC route fails for most
non-ETH assets. Extended REST and WebSocket traffic
are proxied because Extended rejects browser REST origins and WebSocket
handshakes unless their headers are sanitized server-side. The development
WebSocket bridge keeps its browser-facing sockets stable while it reconnects a
reset upstream connection, so transient exchange disconnects do not create a
browser error/reconnect loop.

`src/data/endpoints.ts` is the single source of truth for every base and is
**environment-aware**:

- **Dev server** (`import.meta.env.DEV`, excluding vitest): proxies Extended,
  AVNU market data, and Starkscan reads; quote/build, Ekubo, and RPC sources
  remain direct.
- **Production build / tests**: uses direct hosts, overridable with
  `VITE_AVNU_BASE`, `VITE_AVNU_MARKETS_BASE`, `VITE_EKUBO_BASE`,
  `VITE_EXTENDED_REST_BASE`, `VITE_EXTENDED_WS_BASE`, and
  `VITE_STARKSCAN_BASE`.

### Production

The persistent production deployment is
[mc-wallet-terminal.vercel.app](https://mc-wallet-terminal.vercel.app).
`vercel.json` supplies same-origin reverse-proxy routes for Extended REST, AVNU
market data, and Starkscan indexed reads, then builds their `VITE_*_BASE`
overrides into the client.
Other production hosts must provide equivalent CORS-enabled routes and set
`VITE_EXTENDED_REST_BASE` and `VITE_AVNU_MARKETS_BASE` themselves.

## Rate limits & resilience

The data layer stays within public API limits by:

- Coalesces concurrent requests for the same URL into one network call and
  serves a short-lived in-memory cache (`src/data/cache.ts`).
- Polls at calm intervals — prices every 60s, token universe every 120s, chart
  history per-timeframe (60s intraday → 30m for yearly), spot fills every 5s,
  perps stats every 20s,
  Starkscan chain activity every 5s, indexed holdings every 30s, Vesu markets
  every 60s, positions/redemptions every 30s, and vaults every 120s.
- Backs off exponentially on `429`/`5xx`, honoring `Retry-After` while keeping
  the last-good data on screen. Chart history and pair fills do not blindly
  retry because each can fall through to a shorter history or reference pair.
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

- AVNU `/v3/tokens` and multi-token line history, Ekubo `/tokens` (fallback,
  optional), and the live Ekubo spot-fill index
- AVNU v3 swap quote/build and an Extended public WebSocket frame
- verified Vesu V2 pool parsing, an Ekubo exact-output unwind route, and the
  deployed Pool/Multiply ABI entrypoints
- exact Starkscan token holdings plus recent block and transfer parsing
- Extended `/info/markets`, `/info/markets/{m}/stats`,
  `/info/candles/{m}/{type}`, `/info/{m}/funding`, `/info/markets/{m}/orderbook`
- Starknet RPC `starknet_chainId` + a sample `balanceOf`

Each request has its own timeout and its errors are caught, so one dead host
never aborts the run. It ends with a summary and exits non-zero if any
**required** endpoint failed (the Ekubo fallback is optional and only warns).
