# Portfolio and activity: mobile design

Status: implemented (see §11), revised after review (the seven must-fix items are resolved in place and listed in §10), branch `mobile/portfolio-activity`, 2026-09-24. Scope: fiat values, token management, the explorer-connected activity feed, and loading/stale/offline/error states on iOS (built and tested) and Android (written against the generated Kotlin bindings, **not compiled** here). Sending belongs to transactions, account management to accounts. **The extension's TypeScript is the specification**: the Rust core ports its rules as sans-IO request builders and response judges, parity fixtures from the extension's own code pin them, and Swift/Kotlin render output and move bytes.

## 1. Sources in the extension

Prices: `packages/features/portfolio/src/tokens/{prices-feed,prices}.ts`. Transport bounds: `packages/foundation/core/src/http-json.ts`, `packages/platform/starknet/src/rpc/rpc-transport.ts`. Tokens: `token-registry.ts`, `wallet-model/src/preferences/preferences.ts`, `features/settings/src/preferences.ts`, `apps/extension/src/background/portfolio/{token-ops,token-inputs,balance-snapshots}.ts`. History: `packages/features/transactions/src/history/{starkscan*,tx-history-scan,tx-history}.ts`, `activity/activity.ts`, `apps/extension/src/background/accounts/activity-ops.ts`. Presentation: `packages/presentation/wallet-ui/src/sidepanel/shared/{fiat,network-status,timestamp}.ts`, `journeys/portfolio/*`, `journeys/settings/settings-views.ts`. Stories: `apps/ui-lab/src/stories/journeys/portfolio.stories.ts`, `apps/ui-lab/src/scenarios/scenarios.ts`.

## 2. User-visible behaviour, screen by screen

### 2.1 Home (Portfolio tab)

Source `mobile/ios/Bramble/Screens/Wallet/HomeView.swift` (hero and rows are a hard-coded "—" today).

- **Hero total** (`home-view.ts`): `formatFiat(portfolioTotal)` over the visible rows (hidden and spam excluded), only when an account is present, balances have loaded and the price map is not empty; otherwise "—". Private balances and "Includes shielded balances" belong to privacy (§9).
- **24h line** (`portfolioDelta`): `↑|↓ <formatFiat(abs)>` in `positive`/`danger`, then `<pct.toFixed(2)>% · 24h` in `muted` weight 500; hidden when the delta is null. The change is **always CoinGecko's `usd_24h_change`** whatever the display currency: deliberate parity.
- **Token rows** (`token-row.ts`): glyph, symbol, `compactAmount(formatted, 2)`; right side `formatFiat(value)` or "—", and the badge `↑|↓ <|c|.toFixed(2)>%` (`up` when c ≥ 0, caption, semibold, absent when the change is missing). Glyph is the bundled logo or a letter badge `symbol.prefix(3)` with tone `BigInt(address) % 4`. Order: STRK first, rest stable.
- **"Manage tokens · N not shown"** (`home-tabs.ts`): N = loaded − visible balances (user-hidden and likely-spam both count); `coins` icon; opens Tokens. No rows: "No tracked balances yet. Add or detect tokens to see them here." Overflow menu: Manage tokens, Wallet settings, Refresh portfolio. States (§2.6) use the header network pill (`degraded` pulse plus a spoken description) and the Home balance-error panel.

### 2.2 Tokens, Add token, Find held tokens, Token detail

These are new screens under `Screens/Wallet/Portfolio/`.

- **Tokens** (`tokensFlow`): header "Tokens", subtitle "<n> tracked" (active network only); action rows "Add by contract" (plus) and "Find held tokens" (search); eyebrow "Tracked tokens"; each row has glyph, symbol, name, compact amount, fiat, then a "Show"/"Hide" secondary button or a "Likely spam" flag in its place. Empty: "No tokens tracked on this network yet." Hint: "Hidden and likely-spam tokens stay off home but remain listed here." Toasts: "Token shown", "Token hidden", "Token update failed".
- **Add token** (`tokenAddFlow`): header "Add token", subtitle "Track a token by its contract"; field "Contract address", placeholder `0x…`, hint "Name, symbol, and decimals are read from the contract before it is saved.", button "Read and add token". Errors "Couldn't reach the network, try again" (transport) and "could not read token metadata"; toasts "Token added", "Add token failed". A likely-spam token is saved **and** hidden, as in the extension.
- **Find held tokens** (`tokenDiscoverFlow`): header "Find held tokens", subtitle "Scan the Starknet token registry", hint "Nothing is added until the scan identifies a balance. Likely-spam tokens remain hidden from Home.", button "Scan for tokens". One result row per token with "Add"; status "No new tokens found." or "<n> found."; empty list "No new tokens found in this account." Errors are never shown as an empty result: "Couldn't reach the network, try again" or "Token scan failed, try again".
- **Token detail** (`tokenDetailFlow`): eyebrow "Price" with the fiat price or "Unavailable"; a
  7-day sparkline (100×32 viewBox, points rounded to 2 places, trend from first vs last point) or "Price history unavailable." under 2 finite points; hint "7-day price from CoinGecko. Shown for information only."; "Your balance"; a "Contract" receipt: Address (truncated, with copy), Symbol, Decimals, Network.

### 2.3 Activity tab

The Dock's `activity` tab already exists in `WalletShell.swift`. Its placeholder `ActivityView` moves out of `HomeView.swift` into `Portfolio/ActivityScreen.swift`.

- **Header** (`activityScreen`): h1 "Activity", accessibility label "Activity on <network>", icon button "Refresh transactions" (forces a history read). "Export CSV" is out of scope (§9) and is not shown at all, since a control that can never work would mislead.
- **Unavailable notice** above the list when the history read failed: "Couldn't load on-chain history. Showing transactions recorded on this device only — check your connection or RPC endpoint and refresh."
- **Empty copy** (`activityEmptyCopy`): "No activity yet. On-chain transactions for this account, and transactions you submit from this wallet, appear here."; when unavailable, "No transactions recorded on this device yet."
- **Rows** (`activity-format.ts`): title and icon from `activityAppearance`'s ordered ten rules (Swapped, Unstaked, Claimed rewards, Staked, private, Approved/Revoked, Received/Sent, Deployed, Declared, Interacted). Amount `<compactActivityAmount> <SYM>` (≤4 fraction places) or "—". Fiat signed "+", "−" (U+2212) or unsigned via `formatFiat`, only when exactly one tracked token on the entry's network has that symbol and is priced. Detail `From|To|With <0x1234…abcd>` with an inline copy button ("Copy sender|recipient|counterparty address") copying the full address, a swap pair "A to B", or the rest of the summary. Accepted rows show no status word; others show one with the extension's hint; icon tint secondary / warning / positive at 0.68 / danger. Time is not printed: it goes into the accessibility label as `<Status> · HH:MM UTC`. Rows group by UTC day under "Today", "Yesterday", `DD Mon YYYY` (en-GB) or "Undated".
- **Explorer link**: the verb opens `explorer_transaction_url(network, hash)` in the **system browser** (`openURL`; Android `ACTION_VIEW`), never an in-app web view; the label ends "View transaction on Starkscan". When the URL is `None` (devnet or invalid hash) the verb is plain text.
- **Cadence** (`hydrate.ts`, `activity-ops.ts`): cached log first, then live. Opening the tab asks for a refresh; a read is *due* with no previous sync, `syncedAt` in the future, ≥5 min since the last sync (60 s if it was unavailable), or a local row newer than the sync. Refresh forces a read. Poll every 60 s while foregrounded, with a burst 3 s after opening.
- **Scope** is account + network; switching clears the list before the new scope renders (ui-lab `activity` scenario: account-a, scope-cleared, account-b, account-a-restored).

### 2.4 Settings: Appearance & currency

The extension has one row, "Appearance & currency" (value = the currency uppercased), whose screen holds both the Theme and the Values sections (`settings-views.ts`). `SettingsViews.swift` already declares `struct AppearanceView` (Theme) behind an "Appearance" row, so the existing screen is **extended, not duplicated**: one small edit to `SettingsViews.swift` renames the row to "Appearance & currency" with the currency value, sets the FlowHeader title/subtitle to "Appearance & currency" / "How the wallet looks and values assets", and appends `CurrencySection()` from the new file `Portfolio/CurrencySection.swift`. The Theme section stays. The Values section: eyebrow "Values", picker "Display currency" (USD, EUR, GBP), hint "Prices and portfolio totals use this display currency. Token balances remain unchanged.", toasts "Currency: <CUR>" or "Currency update failed". Switching currency never blanks a priced row, because each cache entry holds all three currencies.

### 2.5 Explorer-account drift fix
`explorer_account_url` in `lib.rs` canonicalises ("0x00ab" → `/contract/0xab`); the extension keeps the given spelling (`/contract/0x00ab`). It is repointed (one line) to the new explorer module, which follows the extension (§3.6), and its test takes the extension's expectation. Callers pass stored canonical addresses, so no link users see today changes.

### 2.6 Loading, saved, offline and error states (`network-status.ts`, stories)
| Story | Condition | Mobile rendering |
| --- | --- | --- |
| loading | no snapshot yet | hero "—"; list follows `home-tabs.ts` loading rendering (no new component) |
| saved-data | balances stale (asOf) / prices stale (asOf) | values kept; pill degraded; description `Using saved balances (<DD Mon>, <HH:MM> UTC). Using saved prices (<DD Mon>, <HH:MM> UTC).` |
| prices-offline | prices stale, map empty | hero "—", rows "—", no delta; description "Live prices are temporarily unavailable." |
| balance-error | refresh failed, no snapshot | panel `friendlyNetworkError(error) ?? error` + ghost "Try again" (label "Retry loading balances"); description "Balances are temporarily unavailable." |
| empty-network | no tracked balances | "No tracked balances yet. Add or detect tokens to see them here." |
| off-mainnet | Sepolia (`priceFeedPlatform` null) | **no request**; the address-keyed cache is projected with `stale = false`, `asOf = null` (`getPrices`' `!platform` branch). Sepolia ETH/STRK share mainnet addresses, so after a mainnet visit they show the cached fiat, hero total and 24h delta, exactly as the extension; before one, "—". Never stale, never degrades the pill |

A failed live balance refresh marks existing balances stale, never blanks them.

## 3. New UniFFI surface (Rust)

New modules `mobile/core/src/portfolio/{mod,http,prices,fiat,tokens,token_meta,registry,snapshots}.rs` and `mobile/core/src/history/{mod,starkscan,events,activity,appearance,time,explorer}.rs`, each under 500 lines, each holding its own `#[uniffi::export]` items; `lib.rs` gains only `mod` lines and re-exports. `CoreError` is unchanged: new failures use `Rpc { reason }` / `InvalidInput { reason }` with fixed reasons, never input text.

### 3.1 Shared records

```rust
#[derive(uniffi::Enum)] pub enum DisplayCurrency { Usd, Eur, Gbp }
#[derive(uniffi::Enum)] pub enum HttpMethod { Get, Post }
/// One exchange the host must perform exactly as described; the host adds nothing.
#[derive(uniffi::Record)] pub struct HttpRequest { pub method: HttpMethod, pub url: String,
    pub headers: Vec<HttpHeader>, pub body: Option<String>, pub max_body_bytes: u64, pub deadline_ms: u64 }
#[derive(uniffi::Record)] pub struct HttpHeader { pub name: String, pub value: String }
/// What the host saw. `body` is `None` for a transport failure, a deadline, a refused redirect or
/// an over-budget body; the host never passes a truncated body.
#[derive(uniffi::Record)] pub struct HttpOutcome { pub status: u16, pub retry_after: Option<String>, pub body: Option<Vec<u8>> }
#[derive(uniffi::Record)] pub struct TokenConfig { pub id: String, pub network: NetworkId,
    pub address: String, pub symbol: String, pub name: String, pub decimals: u8 }
```

Bounds come from the extension's constants, emitted by `generate-mobile-assets.ts` into `core/generated/http-limits.json`: price body 512 KiB, Starkscan body 2 MiB, error detail 8 KiB, event pages `RPC_BODY_LIMIT_BYTES` 32 MiB, exchange deadline 15 s, Starkscan deadline 8 s. The existing 64 KiB balance cap in `rpc.rs` is unchanged. The CoinGecko and Starkscan bases are emitted into `networks.json`; no Swift or Kotlin literal holds them.

### 3.2 Prices (`portfolio/prices.rs`, `portfolio/fiat.rs`)

```rust
#[derive(uniffi::Object)] pub struct PriceBook { /* Mutex<PriceCache>, charts */ }
#[uniffi::export] impl PriceBook {
    /// Loads a persisted cache; anything that fails the known-keys validator becomes empty.
    #[uniffi::constructor] pub fn new(persisted: Option<String>) -> Arc<Self>;
    /// getPrices decision order (§1 prices.ts). Serve = no I/O needed.
    pub fn plan(&self, network: NetworkId, wanted: Vec<String>, now_ms: u64, cached_only: bool) -> PricePlan;
    /// Judges each outcome (status, bound, finite usd/eur/gbp, key == requested canonical address)
    /// and merges per the fetchedAt/asOf/stale rules; returns the view to render.
    pub fn apply(&self, network: NetworkId, wanted: Vec<String>, outcomes: Vec<PriceOutcome>, attempted_at_ms: u64) -> PriceView;
    pub fn chart_plan(&self, network: NetworkId, address: String, currency: DisplayCurrency, now_ms: u64) -> ChartPlan;
    pub fn chart_apply(&self, address: String, currency: DisplayCurrency, outcome: HttpOutcome, now_ms: u64) -> Vec<f64>;
    /// JSON the host writes verbatim to `prices.json`; never contains anything but public prices.
    pub fn persisted(&self) -> String;
    pub fn clear(&self);
}
pub enum PricePlan { Serve { view: PriceView }, Fetch { requests: Vec<PriceRequest> } }
pub struct PriceRequest { pub address: String, pub request: HttpRequest }
pub struct PriceOutcome { pub address: String, pub outcome: HttpOutcome }
pub enum ChartPlan { Serve { points: Vec<f64> }, Fetch { request: HttpRequest } }
pub struct PriceView { pub rows: Vec<TokenPrice>, pub as_of_ms: Option<u64>, pub stale: bool }
pub struct TokenPrice { pub address: String /* caller's spelling */, pub usd: f64, pub eur: f64, pub gbp: f64, pub change_24h: Option<f64> }

#[uniffi::export] pub fn format_fiat(value: f64, currency: DisplayCurrency) -> String;
#[uniffi::export] pub fn compact_amount(formatted: String, places: Option<u8>) -> String;
#[uniffi::export] pub fn portfolio_summary(rows: Vec<FiatInput>, currency: DisplayCurrency) -> PortfolioSummary;
#[uniffi::export] pub fn token_row_fiat(input: FiatInput, currency: DisplayCurrency) -> TokenRowFiat;
pub struct FiatInput { pub formatted_amount: String, pub price: Option<TokenPrice> }
pub struct PortfolioSummary { pub total_text: Option<String>, pub delta: Option<FiatDelta> }
pub struct FiatDelta { pub up: bool, pub amount_text: String, pub window_text: String }
pub struct TokenRowFiat { pub value_text: String, pub change: Option<ChangeBadge> }
pub struct ChangeBadge { pub up: bool, pub text: String }
```

Price rules: `MAX_ADDRESSES` 50 after de-duplication; `PRICE_TTL_MS` 5 min; back-off 60 s; `CHART_TTL_MS` 30 min; `MAX_CHART_ENTRIES` 50 (oldest evicted); `PRICE_CHART_POINT_LIMIT` 2048. Only SN_MAIN fetches (platform `starknet`). Off mainnet `plan` returns `Serve` with the cached projection (`stale = false`, `as_of = None`), exactly `getPrices`' `!platform` branch: the cache is keyed by address, and Sepolia's ETH/STRK addresses equal mainnet's, so a mainnet visit prices them. Charts follow `cachedChartPoints`' `!platform` rule the same way (cached points, never a fetch). Keys are normalised with `canonicalAddress`, falling back to trim + lowercase as `normalizePriceAddress` does; the response keeps the caller's spelling.

**Number input.** Every untrusted or persisted JSON body (CoinGecko, Starkscan, RPC, and the `*.json` caches) is read by the core's own bounded JSON reader (`js/json.rs`), which keeps each number's **raw text** and converts it with `str::parse::<f64>` (correctly rounded, as `JSON.parse`; an overflowing literal becomes ±Infinity and then fails the finite check, as in JavaScript, instead of failing the whole body). serde_json's default float parser is best-effort and can be 1 ULP off, so it never reads a number the output depends on. Duplicate keys resolve last-wins and a leading UTF-8 BOM is stripped, as `TextDecoder` + `JSON.parse` do. A `prices.bodies` fixture carries a 17-significant-digit literal on which the default serde_json parser mis-rounds.

**Rounding.** `toFixed` rounds the exact binary value half up (on the magnitude); `Intl` (`toLocaleString`) first takes the shortest round-trip decimal and then rounds half-expand, so `formatFiat(1.005)` is `$1.01` while `(1.005).toFixed(2)` is `1.00`. `fiat.rs` implements both exactly (exact expansion via Rust's exact `{:.N}` formatting; shortest digits via `{:e}`), pinned by cases 0.125, 1.005, 2.675, 0.005, 1e21 and large grouped values. `Number(formatted)` is a strict JavaScript `StringToNumber` grammar check followed by `str::parse::<f64>`.

### 3.3 Tokens (`portfolio/tokens.rs`, `registry.rs`, `token_meta.rs`)

```rust
#[derive(uniffi::Object)] pub struct TokenPreferences { /* Mutex<PortfolioPrefs> */ }
#[uniffi::export] impl TokenPreferences {
    /// Validates with the ported `isTokenConfig` + hiddenTokens + displayCurrency validators;
    /// absent → extension defaults (DEFAULT_TOKENS via generated networks.json, usd).
    #[uniffi::constructor] pub fn new(persisted: Option<String>) -> Result<Arc<Self>, CoreError>;
    pub fn tracked(&self, network: NetworkId) -> Vec<TrackedToken>;           // active network only
    pub fn set_hidden(&self, token_id: String, hidden: bool) -> Result<(), CoreError>;
    pub fn add(&self, token: TokenConfig) -> AddTokenOutcome;                 // upsert; spam → also hidden
    pub fn display_currency(&self) -> DisplayCurrency;
    pub fn set_display_currency(&self, currency: DisplayCurrency);
    pub fn discovery_candidates(&self, network: NetworkId) -> Vec<TokenConfig>; // registry − tracked (sameFelt)
    pub fn persisted(&self) -> String;
}
pub struct TrackedToken { pub token: TokenConfig, pub hidden: bool, pub likely_spam: bool, pub spam_reasons: Vec<SpamReason> }
pub enum SpamReason { EmptyName, AbsurdDecimals, SymbolSpoof }
pub struct AddTokenOutcome { pub token: TokenConfig, pub hidden_as_spam: bool }

#[uniffi::export] pub fn token_config_id(network: NetworkId, symbol: String, address: String) -> Result<String, CoreError>;
#[uniffi::export] pub fn hidden_from_home_count(tracked: Vec<TrackedToken>, loaded_ids: Vec<String>) -> u32;
/// Three starknet_call bodies (name, symbol, decimals) with ids first_id..first_id+2.
#[uniffi::export] pub fn token_metadata_requests(first_id: u64, address: String) -> Result<Vec<String>, CoreError>;
#[uniffi::export] pub fn token_metadata_judge(network: NetworkId, address: String, first_id: u64, replies: Vec<RpcReply>) -> TokenMetaOutcome;
#[uniffi::export] pub fn token_discovery_requests(first_id: u64, account: String, candidates: Vec<TokenConfig>) -> Result<Vec<RpcRequest>, CoreError>;
#[uniffi::export] pub fn token_discovery_judge(first_id: u64, candidates: Vec<TokenConfig>, replies: Vec<RpcReply>) -> DiscoveryOutcome;
pub struct RpcReply { pub id: u64, pub status: u16, pub body: Option<String> } // body None = no answer
pub enum TokenMetaOutcome { Token { token: TokenConfig, hidden_as_spam: bool }, Transport, Failed { message: String } }
pub enum DiscoveryOutcome { Found { tokens: Vec<TokenBalanceRow> }, Transport, Failed { message: String } }
```

**Add-token errors** are the extension's, verbatim: a transport-class failure on the endpoint (`Transport`, see §3.9) → "Couldn't reach the network, try again" once every endpoint failed; a node error or unusable decimals → "could not read token metadata"; and, after a successful read, an uppercased trimmed on-chain symbol that fails `isTokenSymbol` → "unsupported token symbol" (`token-ops.ts buildTokenRecord`). Discovery: "Couldn't reach the network, try again" or "Token scan failed, try again". All three add-token outcomes are in the `tokenMeta` fixtures.

**Validation.** Ids are `<networkId>:<symbol>:<canonicalAddress>` (`tokenConfigId` is the only builder); symbol `^[A-Z0-9]{2,12}$`; name 1..64 printable ASCII without angle brackets (an invalid name falls back to the symbol); decimals a safe integer 0..36. Symbol folding, `LEGITIMATE_ALIASES` and `tokenSpamReasons` are ported with every `token-registry-spam.test.ts` case as a fixture. The registry (mainnet ETH, STRK, USDC, USDC.e, USDT, DAI, WBTC; Sepolia and devnet empty) is generated into `core/generated/token-registry.json`.

**Metadata decoding.** Short-string and Cairo ByteArray decoding is **ported from the extension's `json.ts`**, since the output must match the extension's and starknet-rust-core's `ByteArray` would not guarantee that; the port also adds no direct dependency. The `name`, `symbol` and `decimals` selectors are hard-coded and Keccak-tested, as `rpc.rs` already does (dev-dependency `sha3 =0.12.0`, already pinned). Discovery reuses `rpc_balance_request`/`rpc_parse_balance`; a transport failure on any balance fails the whole scan, never a partial result posing as complete.

### 3.4 Balance snapshots (`portfolio/snapshots.rs`)

```rust
#[derive(uniffi::Object)] pub struct BalanceSnapshots { /* ≤50 scopes */ }
#[uniffi::export] impl BalanceSnapshots {
    #[uniffi::constructor] pub fn new(persisted: Option<String>) -> Arc<Self>;
    pub fn read(&self, account_id: String, network: NetworkId, now_ms: u64) -> Option<SnapshotView>; // stale = age ≥ 60 s
    pub fn record(&self, account_id: String, network: NetworkId, balances: Vec<TokenBalance>, now_ms: u64);
    pub fn on_failure /* stale snapshot, or None → caller surfaces the error */(&self, account_id: String, network: NetworkId) -> Option<SnapshotView>;
    pub fn persisted(&self) -> String;
    pub fn clear(&self);
}
#[uniffi::export] pub fn network_data_issue(input: DataHealth) -> Option<String>; // network-status.ts copy
#[uniffi::export] pub fn friendly_network_error(reason: String) -> Option<String>;
```

### 3.5 History (`history/starkscan.rs`, `history/events.rs`, `history/activity.rs`)

```rust
#[derive(uniffi::Object)] pub struct ActivityBook { /* over the core's one log (activity.v1.json); Starkscan cooldown in memory */ }
// Obtained with WalletCore::activity_book(); the host never persists activity.
#[uniffi::export] impl ActivityBook {
    #[uniffi::constructor] pub fn new(persisted: Option<String>) -> Arc<Self>;
    pub fn cached(&self, account_id: String, network: NetworkId) -> ActivityView;
    /// activity-ops.ts "due" rules; `force` = Refresh button.
    pub fn history_due(&self, account_id: String, network: NetworkId, force: bool, now_ms: u64) -> bool;
    /// explorerFallbackAllowed (§3.7) + cooldown + devnet skip; None → go straight to the RPC scan.
    pub fn starkscan_request(&self, account_id: String, network: NetworkId, now_ms: u64) -> Option<HttpRequest>;
    /// Strict starkscan-parsers.ts + toActivity. Any failure is Err → caller falls through to the
    /// RPC scan. A cooldown (Retry-After, default 30 s, cap 5 min) is recorded **only** for the
    /// outcomes `explorerCooldownMilliseconds` cools on: 429, any 5xx, timeout, transport failure
    /// (no status) or an invalid 2xx body. Any other 4xx (e.g. 404) records none.
    pub fn starkscan_apply(&self, account_id: String, network: NetworkId, tracked: Vec<TokenConfig>, outcome: HttpOutcome, now_ms: u64) -> Result<ActivityView, CoreError>;
    /// Merges chain rows from a finished RPC scan (mergeActivity), marks synced.
    pub fn scan_apply(&self, account_id: String, network: NetworkId, rows: Vec<ActivityEntry>, now_ms: u64) -> ActivityView;
    /// Seam for the transactions workstream (stubbed here): a locally submitted row, validated.
    /// Both lanes failed: keep the local log, mark unavailable (60 s retry).
    pub fn mark_unavailable(&self, account_id: String, network: NetworkId, now_ms: u64) -> ActivityView;
    pub fn persisted(&self) -> String;
    pub fn clear(&self);
}
pub struct ActivityView { pub entries: Vec<ActivityEntry>, pub history_unavailable: bool }

/// Sans-IO step machine for scanTransactionHistory: blockNumber → getEvents (2 filters × token,
/// chunk 100, ≤3 pages, 20 000-block retry window when truncated) → block timestamps.
#[derive(uniffi::Object)] pub struct HistoryScan { /* state */ }
#[uniffi::export] impl HistoryScan {
    #[uniffi::constructor] pub fn new(account_id: String, network: NetworkId, tracked: Vec<TokenConfig>) -> Result<Arc<Self>, CoreError>;
    /// Next JSON-RPC bodies to send (events one at a time, timestamps ≤4 at once, as the
    /// extension); empty = done.
    pub fn next_calls(&self) -> Vec<RpcRequest>;
    /// Judges one reply. Semantic JSON-RPC errors skip that token (or drop that row);
    /// `Transport` means this endpoint failed at transport level.
    pub fn accept(&self, reply: RpcReply) -> ScanStep;   // Continue | Transport
    /// Discards all progress so the same scan runs again from `blockNumber` on the next endpoint.
    pub fn restart(&self);
    pub fn finish(&self) -> Result<Vec<ActivityEntry>, CoreError>;  // ≤25, deduped, block desc
}
// The core's one `RpcRequest { id, body, max_response_bytes }` (rpc.rs), bounded here by RPC_BODY_LIMIT_BYTES.
```

**Endpoint failover (§3.9).** The extension wraps the whole scan in `withRpcFallback` (`tx-history-scan.ts scanTransactionHistory`): a transport error restarts the scan on the next URL, and only when every URL has failed is history unavailable. Mobile does the same: the host walks `rpc_urls` in order, proves `starknet_chainId` on each endpoint before sending it any scan call, and on `ScanStep::Transport` (or a transport failure, or a chain-id mismatch) calls `restart()` and moves to the next URL. `mark_unavailable` is called only when every endpoint has failed. A Rust replay test covers "first endpoint transport-fails, second answers". **Account ids.** `#[uniffi::export] fn activity_account_id(network, address) -> Result<String, CoreError>` is the only builder of `<networkId>:<canonicalFelt(address)>` (`SN_MAIN`/`SN_SEPOLIA`, **unpadded** address, `accounts.ts canonicalAccountId`); token ids, by contrast, use the padded `canonicalAddress`. `ActivityBook`, `BalanceSnapshots` and `HistoryScan` take ids made by it, and it is pinned in the `activity` parity block. Swift and Kotlin never assemble the string.

`ActivityEntry` mirrors the extension's fields and `isActivityEntry` validator (`accountId`, `amount?`, `counterparty?`, `failureNotice?`, `finalizedOnL1?`, `hash`, `kind`, `networkId`, `notFoundCount?`, `status`, `submittedAt`, `summary`, `token?`). **One activity list and store (merge decision).** Transactions this wallet submits are recorded by the send plans into the core's `activity.v1.json`; history reads merge on-chain rows into the same scope under the store's lock (`activity/feed.rs`), with the sync bookkeeping in the same file. Scopes are account record ids, which equal `activity_account_id(network, address)`. `WalletCore::activity(account_id)` and `ActivityBook::cached` return the same rows; kind and status are the transactions' `ActivityKind` (declare/deploy/invoke/transfer) and `TxStatus`. The `Transfer` key is `selector("Transfer")`, hard-coded and Keccak-tested; `decodeTransferEvent` is ported for Cairo 1 and legacy layouts with each u256 limb below `UINT128_LIMIT`; a null block timestamp drops the row.

**Starkscan timestamps.** JavaScript's `Date.parse` accepts non-ISO strings; Rust accepts only `YYYY-MM-DDTHH:MM:SS(.f{1,9})?(Z|±HH:MM)` and drops any other row. This narrowing is deliberate and fails closed; the fixture holds ISO strings (where both agree) plus labelled `mobileRejects` cases.

### 3.6 Presentation of rows (`history/appearance.rs`, `history/time.rs`, `history/explorer.rs`)

```rust
#[uniffi::export] pub fn activity_groups(entries: Vec<ActivityEntry>, tracked: Vec<TokenConfig>, prices: PriceView, currency: DisplayCurrency, now_ms: u64) -> Vec<ActivityDayGroup>;
pub struct ActivityDayGroup { pub heading: String, pub rows: Vec<ActivityRow> }
pub struct ActivityRow { pub hash: String, pub title: String, pub icon: String /* BrambleIconName */,
    pub direction: Option<ActivityDirection>, pub amount_text: String, pub fiat_text: String,
    pub detail_prefix: Option<String>, pub counterparty: Option<String>, pub counterparty_short: Option<String>,
    pub copy_label: Option<String>, pub detail_text: Option<String>, pub status_word: Option<String>,
    pub status_hint: Option<String>, pub tone: ActivityTone, pub accessibility_label: String, pub explorer_url: Option<String>,
    /// activityRowModel's tokenSymbol / tokenAddress, and the resolved `.tx-avatar` glyph:
    /// `token_glyph(tokenAddress ?? "0x0", tokenSymbol)` or, with no symbol, the Starknet mark.
    pub token_symbol: Option<String>, pub token_address: Option<String>, pub avatar: TokenGlyph }
/// tokenGlyph: the bundled logo (64-digit key) or a letter badge of `symbol.slice(0, 3)` toned
/// `BigInt(address) % 4` (0 when the address does not parse).
pub struct TokenGlyph { pub logo_address: Option<String>, pub letters: String, pub tone: u8 }
#[uniffi::export] pub fn token_glyph(address: String, symbol: String) -> TokenGlyph;
#[uniffi::export] pub fn activity_empty_copy(history_unavailable: bool) -> String;
/// explorerTransactionUrl: lowercase-hex grammar, < field prime, non-zero, **no canonicalisation**,
/// base from generated networks.json; None for devnet or any other input.
#[uniffi::export] pub fn explorer_transaction_url(network: NetworkId, hash: String) -> Option<String>;
#[uniffi::export] pub fn token_sparkline(points: Vec<f64>) -> Option<Sparkline>; // path + trend, None if <2 finite
// Every `icon` is a member of the generated `BrambleIconName` set (checked by a Rust test).
```

### 3.7 Explorer lane permission
`explorerFallbackAllowed(prefs, net)` = `explorerFallback[net] ?? (rpcOverride[net] === undefined)`. Mobile has no RPC or explorer override UI, so the lane is allowed on built-in endpoints; the `explorerFallback` map is still persisted and honoured so a later setting needs no migration. A failed preferences read means **not** permitted. An answering Starkscan page is authoritative, even when empty; any Starkscan failure falls through silently to the RPC scan. No API key is shipped, so no `X-Starkscan-Api-Key` header is sent.

### 3.8 What never crosses the FFI boundary

No new call reads the vault. Every input is public (addresses, token configs, JSON bodies, clock values); the phrase, private keys, viewing keys and vault key are never inputs or outputs. No Starkscan API key exists; if one is ever added it goes to the Keychain/Keystore, never into a document or log (vault-security). URLs are never taken from response bodies. Errors hold fixed reasons, never response text; Starkscan `message`/`requestId` fields are bounds-checked then discarded.

### 3.9 Endpoint failover and chain-id proof

The extension's reads go through `withRpcFallback`: endpoints in `rpcUrls` order, a transport failure moves to the next endpoint, a semantic failure stops. Mobile applies that rule to every RPC read in this workstream: tracked-token balances, the history scan, token metadata, and discovery balances. Before an endpoint receives any of these calls the host proves it with `rpc_chain_id_request` / `rpc_verify_chain_id` (`networks.rs`: the host must verify the chain id before trusting any response); a mismatch is treated as that endpoint failing. Transport class, as the extension's `isTransportRpcError` + `timedRpcFetch`: no answer, HTTP 429, a body that is not JSON or not a JSON-RPC envelope for the request id, a refusal (`error` is a string or code -32005), or an `error` without a numeric code. A JSON-RPC error with a numeric code is semantic. The judges return that classification (`ScanStep::Transport`, `TokenMetaOutcome::Transport`, `DiscoveryOutcome::Transport`); the host never classifies. Event traffic uses the bounded client (§5 T1) **and** the chain-id proof.

## 4. Storage and migration

Persisted state is public-but-private metadata; the core produces and validates each document and the host writes it verbatim (atomic write-then-rename):

| File (under `Application Support/Bramble/portfolio/`; Android `noBackupFilesDir/portfolio/`) | Producer | Extension key |
| --- | --- | --- |
| `preferences.json` — `{schema, tokens[], hiddenTokens[], displayCurrency, explorerFallback{}}` | `TokenPreferences::persisted` | `preferences.tokens/hiddenTokens/displayCurrency/explorerFallback` |
| `prices.json` — `{schema, fetchedAt, prices, changes, checked, attempted, charts}` | `PriceBook::persisted` | `bramble:prices`, `bramble:charts` |
| `snapshots.json` | `BalanceSnapshots::persisted` | `bramble:balance-snapshots` |
| `activity.v1.json` (core-owned, beside the vault) — `{version, scopes{…≤200}, sync[…≤50]}` | `activity::store` / `activity::feed` | `bramble:activity`, `bramble:activity-history-sync` |

- **Location and protection.** Created like `VaultDirectory.prepare`: `FileProtectionType.complete` and `isExcludedFromBackup`, set per file because `INFOPLIST_KEY_NSFileProtectionComplete` in `project.yml` is probably ineffective (the entitlement question goes to vault-security). Never `UserDefaults`, which is backed up.
- **Schema** `"bramble.mobile.portfolio.v1"` in every document; there is no earlier mobile state, so v1 needs no migration. An unknown or invalid **cache** (prices, snapshots, activity) reads as empty and is overwritten on the next persist, as in the extension. An unknown `preferences.json` schema (a newer app) reads as defaults but is marked `read_only` and **not overwritten**, so token choices survive a downgrade. A later change bumps the schema and adds exactly one adjacent step with old, current and invalid tests, mirroring the vault rule in AGENTS.md. Nothing is added to the vault or its schema.
- **Lifecycle.** On lock the Swift `PortfolioStore` drops its view state and cancels in-flight tasks; the files stay, as the extension keeps these caches in unencrypted storage, and the app-switcher cover and `FLAG_SECURE` already hide the screens. **Delete wallet** removes the whole `portfolio/` directory (one additive call in the existing delete path).

## 5. Threat model and mitigations

| # | Threat | Mitigation |
| --- | --- | --- |
| T1 | Hostile/compromised price or history endpoint sends a huge or slow body (memory/CPU DoS) | New `BoundedHttp.swift`/`BoundedHttp.kt`: streams (`URLSession.bytes(for:)` / bounded buffer) and aborts past `max_body_bytes`; checks a declared all-digit Content-Length first; enforces a whole-exchange deadline (`deadline_ms`), not just an idle timeout; the core re-checks length before parsing. Existing `RpcClient` is not modified (shared file); event-scan traffic uses the bounded client after the endpoint proved `starknet_chainId`. |
| T2 | Redirect to an attacker host, credentials or referrer leakage | The bounded client refuses redirects (`willPerformHTTPRedirection` → nil; `instanceFollowRedirects=false`), uses an ephemeral session with no cookie storage, and sends no Referer. ATS / `usesCleartextTraffic=false` enforce HTTPS. |
| T3 | Forged prices: NaN, Infinity, injected keys for other tokens, a missing currency | Finite numbers only; an entry requires all of usd, eur and gbp; only the requested canonical key is read; 50-address cap; chart points capped at 2048 and finite only. |
| T4 | Forged history rows, fake transfers, address poisoning | Strict Starkscan parsers with every length and grammar bound; erc20 only; the direction must involve the account (sameFelt); rows are display-only and **never** a source for a send recipient (a note for the transactions workstream); counterparties are shown truncated with the full address copied, exactly as the extension does. |
| T5 | Phishing links from rows | The explorer URL is built on the device from a validated hash and a generated base, never from a body; it opens in the system browser, never in an in-app web view. |
| T6 | Spam or symbol-spoof tokens (a fake "USDC") | `tokenSpamReasons` is ported; spam is hidden from Home and flagged on Tokens; add-token hides spam automatically; discovery only proposes registry tokens. |
| T7 | Tampered or corrupt cache files | Known-keys validators on load; an invalid cache becomes empty; invalid preferences become defaults and are kept read-only; caps (50 scopes, 200 rows, 50 charts) bound growth. |
| T8 | Stale data presented as current | The stale/asOf rules are ported exactly; the pill shows degraded with a timestamped description; a failed refresh never blanks or fakes values; off mainnet the cached projection is served as the extension serves it (never "stale", never fetched). |
| T9 | A response from an old account, network or session lands after a switch or lock | Every view is keyed by `(accountId, network)`. The Swift store holds a generation counter that is bumped on switch and on lock, and a result carrying an old generation is dropped. `HistoryScan` validates the id from `activity_account_id` before any call. |
| T10 | Privacy: third parties learn holdings | Parity with the extension: CoinGecko sees token addresses (mainnet only) and never the account address; Starkscan sees the account address only when `explorerFallback` permits it. Both are recorded for the Phase 3 privacy labels. No bodies, addresses or URLs are logged. |
| T11 | Rate limiting or bans | The Starkscan cooldown (Retry-After, default 30 s, cap 5 min) is kept in core memory only, like `createStarkscanClient`, so a restart or a skewed clock never leaves the lane blocked; the price back-off (60 s) is kept in core state and persisted; history reads follow the due-rules, not every render. |
| T12 | Secret leakage through the new surface | None of the inputs are secret (§3.8); `key-boundary`-style Rust test: no new export takes `WalletCore` or returns anything derived from the vault. |

## 6. Parity fixtures

New `scripts/mobile-parity-portfolio.ts` exports `computePortfolioParity()`, which runs the **real** extension functions (`getPrices` over in-memory storage with a fake fetch and clock, `parsePriceBody`, `formatFiat`, …). `generate-mobile-parity-vectors.ts` gains one key, `portfolio`; `bun run mobile:parity` regenerates it and `mobile-generated.test.ts` byte-compares it in `bun run check`.

| Block | Cases (input → extension output) |
| --- | --- |
| `prices.bodies` | valid; missing gbp; NaN/"1"/Infinity-like; injected second address; non-canonical key; huge exponent; a 17-digit literal serde_json's default parser mis-rounds; empty object → `{prices, changes}` |
| `prices.plans` | scripted `getPrices` timelines: fresh cover, `checked` cover, back-off window, partial answer with/without cached price, none answered, non-mainnet **seeded with a mainnet STRK price** (served, `stale:false`, `asOf:null`, no request), `cached:true` → `{asOf, stale, prices}` + requested URLs |
| `prices.urls` | exact CoinGecko URLs for token and chart requests (encoding, canonical address) |
| `charts` | valid, >2048 points, non-array, mixed non-finite |
| `fiat` | `formatFiat` (0, negative, 0.004, 0.005, 0.125, 1.005, 2.675, 1e6, 1e21, per currency), `portfolioTotal`, `portfolioDelta` (flat, ≤−100 %, down, missing change), `compactAmount` (places, sub-unit, floor, grouping), `tokenFiatValue` |
| `tokens` | `tokenConfigId`, `isTokenConfig` accept/reject, `tokenSpamReasons` (all spam test cases), folding, registry JSON, `hiddenFromHome` counts, `DEFAULT_TOKENS` |
| `tokenMeta` | short-string, ByteArray (pending word, multi-word, bad length), decimals felts, symbol/name fallbacks → config, "could not read token metadata", or "unsupported token symbol" |
| `starkscan` | request URL and headers; page/transfer parser accept and reject (each bound); `toActivity` rows including synthetic "Untracked token"; Retry-After parsing (delta, HTTP date, over cap); cooldown per outcome (429, 500, 503, timeout, transport, invalid body → cooldown; **404 → none**) |
| `events` | `decodeTransferEvent` for Cairo 1 and legacy layouts, limb ≥ 2^128, mint/burn, bad hash; scan window arithmetic; dedup/cap |
| `activity` | `activity_account_id` (`canonicalAccountId`: unpadded, SN_MAIN/SN_SEPOLIA), `isActivityEntry`, `onChainActivityEntry` summaries, `mergeActivity` promotion/dedup, due-rules timeline |
| `appearance` | `activityAppearance` for a summary corpus covering every rule; `tokenSymbol`/`tokenAddress` and the `tokenGlyph` avatar (logo, tone 0–3, Starknet fallback); fiat sign; detail line; status word/hint; day headings at fixed `now`; `HH:MM UTC` labels |
| `explorer` | `explorerTransactionUrl` and `explorerAccountUrl` (0x00ab, uppercase, zero, ≥ prime, devnet) |
| `status` | `networkDataIssue` for each story state; `friendlyNetworkError`; `activityEmptyCopy` |

Rust (`tests/portfolio_parity.rs`) and Swift (through FFI, proving `f64`/`Option`/`u64` survive the bindings) both assert the whole block.

## 7. Test plan

**Rust** (`cargo test --locked`, `cargo clippy --all-targets --locked`): Module unit tests for every bound and rule above; Keccak checks for the `Transfer`, `name`, `symbol` and `decimals` selectors; the icon-name check; `HistoryScan` replay of fixture RPC bodies (truncation retry, per-token semantic skip, transport → `restart()`, and "first endpoint transport-fails, second answers"); persisted-document round trips, tampered/unknown-schema rejection and the read-only preferences guard; a property test that no `format_fiat` output contains "e" or "NaN"; `tests/portfolio_parity.rs` (§6). Opt-in `tests/portfolio_live.rs` (`#[ignore]`) runs only with `BRAMBLE_MOBILE_LIVE_PORTFOLIO=1`, refuses when `CI` is set, and makes read-only GETs to CoinGecko and Starkscan for a public address.

**Swift unit** (`BrambleTests`): `BoundedHttpTests` (`URLProtocol` stub): redirect refused, oversized declared and streamed bodies aborted, deadline fires on a trickling body, no cookies or Referer. `PortfolioStoreTests` (stub transport, fixture bodies): hero total and delta; currency switch keeps rows priced; Sepolia serves the cached mainnet STRK price, never fetches, never stale; "N not shown" count; hide/show persisted; add-token spam auto-hide; discovery errors surfaced, not emptied; late responses after lock or account switch dropped (generation); a failed refresh keeps values and marks them stale. `PortfolioFilesTests`: protection and backup exclusion set; delete-wallet removes the directory. Plus the §6 parity assertions through FFI.

**XCUITest** (`BrambleUITests/PortfolioActivityTests.swift`) on the simulator "Bramble portfolio-activity" (created if missing; never "iPhone 16"): `mobile/scripts/build-core-ios.sh debug`, `cd mobile/ios && xcodegen generate`, then `xcodebuild … -destination 'platform=iOS Simulator,name=Bramble portfolio-activity' test`. The launch argument `-BrambleUITestNetworkStub <scenario>` installs a `URLProtocol` serving fixture bodies; it is compiled only under `#if DEBUG`, so a release build cannot be pointed at fake data. Scenarios mirror the ui-lab stories (ready, saved-data, prices-offline, balance-error, empty-network). Flows: (1) hero total and "% · 24h", row fiat and badges; (2) "Manage tokens · 1 not shown" → Tokens → Show → row on Home; (3) Add by contract (stubbed metadata) → "Token added"; Find held tokens → "1 found." → Add; (4) Settings → Appearance & currency (the existing screen, Theme section intact) → EUR → hero shows "€"; (5) Activity: grouped "Received"/"Sent" rows, the explorer link's accessibility value equals the expected Starkscan URL (asserted, not opened), copy copies the full counterparty; (6) history unavailable → notice plus "No transactions recorded on this device yet."; (7) each degraded story → the pill's accessibility value holds the extension copy. The mainnet onboarding suite is untouched; nothing broadcasts.

**Android**: `PortfolioStore.kt`, the screens and `BoundedHttp.kt` are written against the generated Kotlin bindings, are **uncompiled** here, and are marked so in the PR. No instrumented tests are claimed.

## 8. File plan and shared-file edits

- **Rust**: §3 modules, `js/{num,json,regex}.rs` (JavaScript number, JSON and word-boundary semantics; the regex matcher has a hard per-search budget of 300 000 steps and 1 500 nested calls, and an exhausted search fails as a whole — `Exhausted` — so hostile explorer or price text is never classified on a partial search), `tests/portfolio_{parity,live}.rs`; `Cargo.toml`: **no new dependencies and no new features** (the raw-text JSON reader makes `float_roundtrip` unnecessary).
- **Generated** (additive emitters in `scripts/generate-mobile-assets.ts`): `core/generated/{http-limits,token-registry}.json`, price/explorer API bases in `networks.json`, and token logos the extension bundles.
- **iOS, new**: `App/{BoundedHttp,PortfolioFiles,PortfolioStore}.swift` and `Screens/Wallet/Portfolio/{PortfolioHero,TokenRows,TokensView,AddTokenView,DiscoverTokensView,TokenDetailView,Sparkline,ActivityScreen,ActivityRowView,CurrencySection}.swift`, all on `DesignSystem` components and generated tokens, with no hard-coded colours.
- **Shared, additive only**: `lib.rs` (`mod` lines, re-exports, explorer repoint §2.5); `WalletStore.swift` (owns a `PortfolioStore`, calls `portfolio.lock()` in `lock()`, delete hook); `WalletShell.swift` (activity tab renders `ActivityScreen`; the pill reads health); `SettingsViews.swift` (the existing row renamed "Appearance & currency" with the currency value, the existing `AppearanceView` header subtitle, and one `CurrencySection()` line); `HomeView.swift` (hero and rows swapped for the new views, call sites only, since design-mobile likely edits it too).

## 9. Out of scope, deferred, and krusty-kms

- **Out of scope**: sending, pending-transaction reconciliation and finality tiers (transactions; both write the one core-owned log); account management (accounts); privacy/STRK20 balances and "Includes shielded balances"; collectibles; allowances; watch-asset; activity CSV export; explorer API URL/key settings; the RPC-override UI; idle auto-lock and entitlement-level data protection (vault-security).
- **Mobile-specific narrowing**: Starkscan `timestampIso` is ISO 8601 only (§3.5).
- **Inherited quirk**: `USDC.e` fails `isTokenSymbol`, so a discovered USDC.e is stored under the symbol its contract reports, as in the extension; a fixture records it.
- **krusty-kms 0.11.0: nothing is blocked.** This is protocol and presentation logic, not wallet crypto, and adds no fallback crypto. krusty's `NetworkPreset` explorer (Voyager), token presets and u128 `Amount` conflict with the extension and are not used. `krusty-kms-client` and `krusty-kms-wallet-api` are **not** linked (they bring tokio and reqwest into the sans-IO core). Optional, non-blocking upstream proposals: public u256-capable pure ERC-20 and ByteArray decoders in `krusty-kms-common`; a pure `Transfer` event decoder; a configurable explorer on `NetworkPreset` that returns an `Option`.

## 10. Review resolutions

1. **Off-mainnet prices** follow `getPrices`' `!platform` branch: the cached projection, never a fetch, never stale (§2.6, §3.2, T8, §6 `prices.plans`, §7). No divergence is claimed.
2. **Endpoint failover** is part of the sans-IO contract (§3.5, §3.9): `HistoryScan::restart`, transport-classified judge outcomes for metadata and discovery, chain-id proof before any scan, metadata or discovery call, and `mark_unavailable` only after every endpoint failed.
3. **Appearance** extends the existing `AppearanceView` (§2.4, §8): no second struct, one row.
4. **Number parsing** reads raw numeric text with `str::parse::<f64>` in the core's own JSON reader (§3.2); a fixture pins a literal the default serde_json parser mis-rounds.
5. **Activity avatar**: `ActivityRow` carries `token_symbol`, `token_address` and a resolved `TokenGlyph` (§3.6), pinned in `appearance`.
6. **`activity_account_id`** is the one builder of activity/snapshot ids (§3.5), pinned in `activity`.
7. **Smaller departures**: "unsupported token symbol" (§3.3, `tokenMeta`); Starkscan cooldown classification ported exactly with a 404 case (§3.5, `starkscan`).

## 11. Implementation status (2026-09-24)

- **Rust core** (`src/js`, `src/portfolio`, `src/history`): every §3 surface, plus `portfolio_amount`, `fiat_value_text`, `balance_requests`/`balance_judge`, `balance_failure_copy`, `rpc_limits`. `cargo test --locked` and `cargo clippy --all-targets --locked` are clean. Parity: `tests/{portfolio,token,history,row}_parity.rs` assert the whole `tests/fixtures/portfolio-parity.jsonl` (JSON Lines, so the generated file stays within the line budget and the formatter leaves it alone); `tests/portfolio_state.rs` covers persistence, schema guards, cadences, lane authority, the `format_fiat` exponent property and the key boundary.
- **Deliberate mobile narrowings** (asserted as such, never claimed as parity): no devnet (a `SN_DEVNET` token or account id is refused); Starkscan timestamps ISO 8601 with a zone only; Retry-After HTTP dates in IMF-fixdate form only; a malformed JSON-RPC envelope, a mismatched reply id or a non-integer block number is transport-class (fail over) where starknet.js would fail later with a `TypeError` that `withRpcFallback` also treats as transport; UTC month names follow the fixture's ICU (`Sep`; Chrome's newer ICU prints `Sept`).
- **Extension edits**: `bundledTokenLogoAddresses()` (token-logos.ts) and `DEFAULT_EXPLORER_API_URL` exported for the generators; `generate-mobile-assets.ts` emits `core/generated/token-registry.json` and every bundled token logo; `bun run mobile:parity` writes the new fixture; `tests/conformance/mobile-portfolio-parity.test.ts` byte-compares it.
- **iOS**: `Bramble/Portfolio/*` (transport, endpoints, files, store, debug fixture network) and `Screens/Wallet/Portfolio/*`; shared files touched additively as §8 lists (plus one label in `OnboardingFlowTests.swift`, since the settings row is now "Appearance & currency"). Unit tests (22) and `PortfolioActivityTests` pass on "Bramble portfolio-activity". Success toasts are not shown (the mobile toast is the error surface); balance-error copy for a node error is a fixed line, not the library message.
- **Android**: `portfolio/{BoundedHttp,PortfolioStore,PortfolioScreens}.kt`, written against the generated Kotlin bindings, **uncompiled**, and not yet wired into `ui/Screens.kt`.
- **Not done**: the opt-in live test (`tests/portfolio_live.rs`) — the sans-IO core has no HTTP client and adding one only for a test was not justified; Token-detail privacy actions and CSV export (out of scope).

