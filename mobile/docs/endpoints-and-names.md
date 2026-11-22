# Custom RPC endpoint and Starknet names

Mobile's adoption of wallet-core `v0.6.0`'s P4 (custom RPC) and P5 (Starknet names); the core's
rules and their departures from the extension are wallet-core's `docs/PLAN.md`, P4 and P5. The
apps render and wire; every rule is the core's.

## 1. Custom RPC endpoint (P4)

- **Where endpoints come from.** Every RPC read and send takes its `NetworkInfo` from
  `endpointNetwork` (iOS `App/NetworkEndpoints.swift`, Android `NetworkEndpoints.kt`), which is the
  wallet's `networks()`: the bundled networks with the override, when one is set, tried before
  the bundled endpoints, which stay as failover. `WalletStore.networkInfo` is the one caller;
  balances, deployment state, the send and deploy plans, the portfolio and token reads, private
  balances, account discovery and the multisig reads all take it from there. `supported_networks()`
  is still used for network names only.
- **Locked or no wallet.** The override lives in the vault, so `networks()` refuses while locked
  and before a wallet exists; `endpointNetwork` then uses the bundled record. Onboarding and
  "Find your accounts" (which runs unlocked, after import) are unchanged, and no account read runs
  while locked.
- **Chain check.** Unchanged: an endpoint is used only after `rpc_verify_chain_id` proves the
  network's chain, so a Sepolia URL saved for Mainnet is skipped like any wrong-chain endpoint; the
  send plan probes the chain again. Saving probes nothing, as in the extension.
- **Settings.** Settings → Network → "RPC endpoint" (summary "Custom" or "Default"), above the
  coordination relay: field "Custom endpoint for {network}" (placeholder "https://…", hint "Each
  service sees the requests sent to it. Use only ones you trust. Clear a field to restore the
  default."), button "Save endpoint". It edits the selected network's override
  (`set_rpc_override`: trimmed, empty clears). Success toasts "RPC endpoint saved" / "RPC endpoint
  reset"; a refusal shows the core's reason ("Mobile RPC endpoints must use https", "Invalid RPC
  endpoint") under the field and as a toast; anything else is "RPC endpoint update failed".
  A save enters the portfolio's scope again (`saveRpcOverride` on both platforms), since the scope
  holds the endpoint list it was entered with: no read goes to the old endpoints afterwards.
  The extension puts the field one screen deeper ("Advanced endpoints" → "Endpoints"); mobile keeps
  it on the Network screen beside the relay, as it already did for the relay.
- **Explorer fallback.** Already wired: the history lane asks `explorer_fallback_allowed`, which is
  off for a network with an override. Mobile has no toggle.
- **Redaction.** An override may carry an API key. The text that can reach the screen from a core
  or node failure goes through `redact_endpoints`: `describe`'s one pass-through (a core
  `InvalidInput` reason) on both platforms, and the token add and scan failure lines. Transport
  errors themselves are never shown (they collapse to fixed copy). No code logs a `NetworkInfo`;
  Kotlin's data-class `toString` and Swift's `description` would print `rpc_urls`.

## 2. Starknet names on Send (P5)

- **When lookup runs.** On "Continue with address" (or the keyboard's submit) for text that is not
  an address, as the extension's `commitTyped`: first a listed contact or account the text names
  is taken as that row (an exact name first, else the search; more than one match commits
  nothing), so a name is never resolved over a row on screen; then, if `stark_name_normalize`
  says the text is a name, it is resolved; otherwise the invalid-address error shows as before.
- **The read** (iOS `Send/StarkNameLookup.swift`, Android `send/StarkNameLookup.kt`). For each
  endpoint in order: prove the chain (`rpc_verify_chain_id`), then send
  `stark_name_address_request` and judge with `stark_name_judge_address`. `TryNextEndpoint` and
  transport failures move on; `NotFound`, `UnsupportedNetwork` and `Failed` stop. An endpoint on
  another chain is never asked the name.
- **Lines** (the extension's, under the field, muted): "Resolving {name}…" while the read runs
  (Continue is disabled meanwhile); "No address found for {name}."; "Starknet names are not
  available on this network."; "Could not resolve {name}." for `Failed`, a refused request, or
  when every endpoint served another chain; "Could not reach the network to resolve {name}." when
  every endpoint failed otherwise. Both last cases fail closed. A keystroke clears the line.
- **Stale answers.** An answer is dropped if the field no longer spells the name or the wallet's
  network changed while the read was in flight.
- **Resolved.** The recipient is the core-canonical address under the canonical name (never the
  typed spelling). The review's "To" row shows the name over the full address with "Resolved from
  Starknet ID" under it (no reveal disclosure), and, when no listed row has that address, the risks
  panel leads with "New recipient. Check the full address before you send.".

## 3. Tests

| Behaviour | iOS (`BrambleTests`) | Android |
| --- | --- | --- |
| Override tried first, bundled as failover; cleared; bundled while locked or with no wallet | `RpcOverrideTests` | `NetworkEndpointsTest` (JVM), `CoreBridgeTest.rpcOverrideFirstAndRedacted` |
| Core refusal shown; other failures | `RpcOverrideTests.testTheCoresRefusalIsShown` | `CoreBridgeTest` |
| Failure text naming an override is redacted | `RpcOverrideTests.testAnErrorTextNamingAnOverrideIsRedacted` | `ErrorTextTest.passThroughTextIsRedacted` (JVM), `CoreBridgeTest` |
| Name resolves; chain proven first; wrong-chain endpoint never asked; failover; lines; fail closed | `StarkNameLookupTests` | `StarkNameLookupTest` (JVM, core calls stood in for) |
| Stale answer dropped (field edited, network changed) | `StarkNameLookupTests.testAStaleResultIsDropped` | `StarkNameFlowTest` (instrumented) |
| Listed row wins over a name; review facts and warning | `StarkNameLookupTests` | `RecipientBookTest`, `ReviewFactsTest` (JVM) |

The Android JVM suite has no native core, so tests there stand in for the core's calls; the
instrumented tests run the real ones.
