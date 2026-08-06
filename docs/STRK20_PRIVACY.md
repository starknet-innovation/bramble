---
layout: default
title: STRK20 privacy integration
permalink: /strk20-privacy/
---

# STRK20 privacy integration

MC Wallet implements the Wallet API `0.10.4-rc.0` STRK20 surface through the official Starknet
Privacy SDK browser bundle. It supports shielded balance discovery, action preparation, private
submission, dapp-scoped sub-account commitments, explicit account registration, and reviewed
public-to-private token deposits.

## Pinned runtime

The source revision and emitted bundle digest are both pinned. Run:

```bash
bun run vendor:privacy
bun run check:privacy
```

Only the checked browser bundle is copied to `dist/vendor/starknet-privacy/`; the SDK's npm build
tree is not packaged. The extension imports this bundle only from its own origin under the MV3
content-security policy.

## Required network configuration

Each enabled network needs one complete routing configuration:

- Discovery Service URL implementing `/health`, `/v1/history`,
  `/v1/sync/incoming_state`, `/v1/sync/outgoing_state`, and
  `/v1/sync/preflight_check`.
- Transaction Prover URL implementing `starknet_specVersion` and
  `starknet_proveTransaction`.
- STRK20 pool contract address.
- Optional SDK sub-account anonymizer module, used only by `subaccount_invoke`. Core registration,
  discovery, shield, withdraw, and transfer operations do not need it.
- Dapp-specific anonymizers/executors are not global pool configuration. A Vesu, Ekubo, or other
  integration supplies its audited contract as an explicit invoke target inside the reviewed action
  plan, where it handles notes according to that dapp's rules.
- OHTTP enabled at both the discovery and proving services. A separate OHTTP relay URL is optional.
- Optional private paymaster/relayer URL and its pool fee token.

The bundled Mainnet configuration points only at the wallet-owned AWS gateway and the
deployed pool
`0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`.
The private discovery and prover upstream URLs and any paymaster key are server-only ECS runtime
configuration. They never appear in the extension source, preferences, source maps, logs, or
browser requests. The public gateway URL is necessarily visible to clients.

An extension cannot protect a shared API secret or prove to a server that its JavaScript came from
an official build: anything embedded in the bundle is extractable, and a non-browser client can
spoof HTTP headers. The gateway therefore uses layered controls:

- exact `chrome-extension://<production-id>` Origin allowlisting for browser requests;
- a fixed method/path/content-type allowlist and fixed Mainnet pool/paymaster fee token;
- request/response size caps, timeouts, no redirects, generic upstream failures, and no request
  body logging;
- OHTTP envelopes so the gateway relays discovery/proving traffic without seeing its contents;
- AWS WAF coarse edge limits plus DynamoDB-backed per-route client limits.

Origin allowlisting is a browser isolation control, not cryptographic build attestation. A
production deployment must not describe it as attestation. Stronger client authenticity requires
an external enrollment or platform-attestation system; no generic Chrome Web Store attestation is
available to this protocol today.

The Discovery Service and Transaction Prover are required for live registration, balance
discovery, and shielding. The paymaster is optional for entering the pool: registration and a
deposit-only batch can use the selected account's ordinary Starknet transaction path. A private
paymaster is required for wallet-API transfers, withdrawals, invokes, and unlinkable relay fees.

## Wallet journey

Private state is never read during the ordinary portfolio refresh. The user must enable the
**Private balances** switch for the current account and network. That disclosure is ephemeral and
is reset on lock, account switch, network switch, side-panel reload, or extension restart.

1. Enabling the switch asks the SDK whether the account is registered and, only when registered,
   discovers private note totals for tracked tokens on the active network.
2. An unregistered account gets an **Activate private balances** action. Its immutable review
   identifies the network, pool, public account route, and public link between the wallet address
   and its viewing-key commitment. No registration is silent.
3. After activation, each tracked asset detail has a **Shield SYMBOL** action. The composer keeps
   token identity, public balance, amount shortcuts, and destination network together.
4. The shielding review freezes the amount, token metadata, pool, actions, submission route, and
   payload digest. It explicitly states that the deposit is public even though the resulting notes
   can later be spent privately.
5. Confirmation consumes that preparation once, revalidates account, network, configuration,
   token metadata, registration, public balance, and digest, then generates the proof and requests
   account authorization. Progress names proof generation, authorization, broadcast, and
   discovery; failures never retry automatically.

The UI Lab contains deterministic checkpoints under **Wallet journeys / 04 Private balances** for
disclosure off, discovery, registration, empty notes, asset entry, compose, public shielding,
Wallet API private-relay review, proving, success, service failure, missing configuration, and the
unsupported Ledger boundary. Fixtures never call a real vault, SDK service, RPC, or hardware
device.

## Privileged data flow

1. The content/provider bridge strictly parses bounded actions, token lists, proof envelopes, and
   dapp-scoped sub-account requests. A connected origin sees only its granted active account.
2. Dapp-requested registration, private balance reads, proof preparation (including simulation),
   and sub-account commitments each create a dedicated approval. Registration uses the explicitly
   MC-namespaced `mc_strk20Register` capability because the Wallet API has no registration RPC. The
   queue retains the exact private request and
   exposes display-safe summaries plus the exact action parameters and an account/network/payload
   digest. Invoke calldata, sub-account call targets and entry points, nonce, and collect policy
   remain expandable in the approval. A private-relay review also lists the relayer-fee withdrawal
   as a separately labelled action with its exact token, amount, and recipient. Denial returns
   `USER_REFUSED_OP`; account, network, grant, or payload changes invalidate the request.
3. Only after approval does the background lazily derive a domain-separated viewing key through
   Krusty from the selected account's encrypted signing key. The derivation matches the pinned SDK
   reference: deterministic Stark ECDSA over the canonical `chainId:poolAddress`, Poseidon of
   `(r,s)`, and the privacy pool's lower-half curve-order fold. This produces a distinct identity
   for every chain and pool. The key is never persisted, logged, or returned through a browser
   message. Keyless Ledger accounts cannot currently use STRK20 and fail closed.
4. The SDK performs note discovery, transaction assembly, and proving. `USER_LINKAGE` warnings map
   to the Wallet API privacy-leak error; every other non-empty or malformed warning fails closed.
5. Before a dapp invoke approval appears, the wallet runs only public/pure action checks, rejects a
   deposit/withdraw correlation, and requests and freezes the relayer fee action and any typed
   data. It never discovers private balances, generates a proof, or signs before approval.
6. After approval, the wallet reads and validates the required private balances, checks the
   combined user spend plus relay fee, and asks the SDK to prove the exact frozen action batch plus
   fee action. Any paymaster outside-execution envelope is reconstructed from the exact public
   approval calls and bound to the active account and chain; substituted calls or an invalid
   execution window fail before signing. The SNIP-9 timestamps must fit `u64`, be live at quote
   time, and retain at least ten seconds when revalidated immediately before signing. Its caller,
   execution window, call count, fee, account, network, and payload digest are visible in review.
7. The wallet requires the configured pool's `apply_actions` call and submits once through the
   configured private paymaster. The SDK signer binds account, chain, and complete call set using
   the protocol SNIP-12 hash. Every accepted privacy write is recorded in browser-session storage;
   a later proof waits until that accepted block is older than the SDK's historical proving block.
   Writes for the same account, network, and pool are serialized across proof, submission, and
   receipt acceptance. A `submitting` reservation is persisted immediately before broadcast; it
   is replaced by the returned hash before receipt polling. An indeterminate broadcast or receipt
   keeps the scope blocked, while only a receipt-proven rejection clears it. Production privacy
   operations fail closed if that restart-safe session store is unavailable.
8. The proof base is ten blocks behind the finalized RPC head. Registration polls until the
   account contract exists at that exact historical block, and deposits poll until every
   aggregate ERC20 amount is visible there. This automatically covers freshly deployed and
   recently funded accounts instead of producing a knowingly stale proof.

The Wallet API allows a dapp to submit the result of `wallet_strk20PrepareInvoke`; therefore a
non-simulated prepare request does not sign or generate that submittable proof until the user
approves its exact action list. Private balances and the deterministic, origin-scoped sub-account
commitment are likewise never disclosed under the general account connection grant alone.

The standard dapp Wallet API still returns `NOT_REGISTERED` when a site requests an operation
before registration. The Terminal can initiate registration only through the MC-specific
`mc_strk20Register` capability. It enters the same content-script trust boundary as other dapp
requests, opens the wallet approval surface immediately, and cannot derive a viewing key or submit
until the user approves the account/network/pool/token-bound payload.

The wallet-owned side-panel journey currently exposes registration and deposit-only shielding.
Private transfer, withdrawal, generic invoke, proof preparation, and sub-account commitment remain
Wallet API/dapp approval journeys; they do not appear as standalone portfolio actions yet.

The generic `wallet_addInvokeTransaction` path also preserves an optional prepared proof. Such a
request must contain exactly one call, receives the normal decoded approval review, and can submit
only a non-empty proof to the configured pool's `apply_actions` entry point. The proof and call are
included in the approval digest and are never silently converted into an ordinary public invoke.

## Failure and trust boundaries

The wallet has no fallback proving, discovery, or signing. Direct public broadcast is narrowly
available for explicit registration and deposit-only action batches because a new account has no
private note with which to pay a relay fee. A public deposit grants the configured pool only the
exact aggregate reviewed token amount, includes the SDK proof, and submits the pool's validated
`apply_actions` call in the same account transaction. Transfer, withdrawal, invoke, mixed, or empty
batches can never use this route.

SDK, discovery, prover, paymaster, OHTTP, RPC, and contract responses are untrusted and validated
at their boundaries. Unknown or malformed privacy warnings, an unexpected fee token, insufficient
fee balance, a mismatched pool or entry point, an empty proof, changed account/network/token
metadata, a stale or reused preparation, a changed registration state, or unavailable services all
fail closed.

The upstream SDK and remote service implementations are external trust dependencies. Their pinned
artifact integrity and wallet-facing behavior are checked here; their internal cryptography and
production deployments require their own audits and operations monitoring.

## Operator checklist

- Set the discovery/prover upstream URLs only in the `mc-backend` ECS task configuration.
- Store a valid `AVNU_PAYMASTER_API_KEY` in the backend runtime secret before enabling private
  transfer or withdrawal; the gateway adds it server-side and never returns it to the extension.
- Set `allowed_extension_origins` to the exact released extension origin(s). The gateway fails
  closed when this is absent or malformed.
- Confirm both services expose OHTTP at `/ohttp-keys` and their service root before enabling the
  bundled Mainnet route.
- Keep AWS WAF and the backend's DynamoDB rate-limit table enabled for `/rpc/*` and
  `/api/strk20/*`. Configure Vercel Firewall independently for Terminal-only
  `/api/private-swap/*` routes.
- Configure the SDK sub-account module only when supporting `subaccount_invoke`; keep each
  dapp-specific anonymizer/executor in that dapp's reviewed action plan.
- Supply a private paymaster/relayer and fee token to enable private transfers, withdrawals,
  invokes, and private relay-fee submission. Registration and deposit-only entry remain available
  without it.
- Put credentials, quotas, and abuse controls behind a wallet-owned HTTPS relay; never add a shared
  API key to the extension.
- Supply an OHTTP relay only when the discovery/prover deployment requires a separate relay.
- Verify service health and network/contract alignment before enabling the configuration.
- The adapter automatically waits for recently deployed or funded accounts at the SDK's safe
  historical block (currently ten blocks behind the RPC head), waits for each submitted privacy
  transaction to reach a successful receipt, and prevents a dependent proof until that accepted
  block is older than the next proving block.
- Run `bun run check`, `bun run build`, `bun run test:e2e`, and `bun run package:extension`.

Fixture tests intentionally use no real vault, private notes, signing material, hardware, or
production service.

## Opt-in Mainnet lifecycle test

`tests/mainnet/strk20-lifecycle.mainnet.ts` is a separate, local-only Playwright core-lifecycle suite
for the real deployed pool and configured discovery/proving services. It imports a dedicated funded
account into a disposable Chromium profile, confirms that the derived address matches the expected
address, connects that one account to a loopback dapp, and exercises registration, deposit,
transfer to self, and withdrawal to self. It prepares real proofs, but deliberately submits them
from the public account instead of a relayer. This validates the protocol without AVNU while
publicly linking the account to every action; it is not a privacy-preserving production route.

The suite is deliberately excluded from `bun run test:e2e` and CI. Its Playwright configuration
disables traces, screenshots, video, retries, and parallel workers so entered signing material
cannot enter a browser artifact. It also refuses deposits above 1 STRK. Build first, then export
the values in the current shell without putting them in a repository file or shell history:

```bash
bun run build
export MC_STRK20_E2E_ACCOUNT_ADDRESS='<dedicated test account address>'
export MC_STRK20_E2E_DEPOSIT_STRK='0.1'
export MC_STRK20_E2E_DISCOVERY_URL='<direct discovery service URL>'
export MC_STRK20_E2E_PROVER_URL='<direct proving service URL>'
export MC_STRK20_E2E_RPC_URL='<RPC 0.10 endpoint with proof-facts support>'
export MC_STRK20_E2E_MAINNET_ACK='I_UNDERSTAND_THIS_WRITES_TO_MAINNET'
export MC_STRK20_E2E_PUBLIC_CALLER_ACK='I_UNDERSTAND_THIS_LINKS_PRIVATE_ACTIONS'
read -rs 'MC_STRK20_E2E_PRIVATE_KEY?Dedicated test signing key: '
export MC_STRK20_E2E_PRIVATE_KEY
bun run test:e2e:mainnet
unset MC_STRK20_E2E_ACCOUNT_ADDRESS MC_STRK20_E2E_PRIVATE_KEY \
  MC_STRK20_E2E_DEPOSIT_STRK MC_STRK20_E2E_DISCOVERY_URL \
  MC_STRK20_E2E_PROVER_URL MC_STRK20_E2E_RPC_URL MC_STRK20_E2E_MAINNET_ACK \
  MC_STRK20_E2E_PUBLIC_CALLER_ACK MC_STRK20_E2E_RESUME_AFTER_DEPOSIT_ACK
```

If a proof-bearing deposit reached the RPC but its response was lost, first
verify that the private balance increased, then set
`MC_STRK20_E2E_RESUME_AFTER_DEPOSIT_ACK=I_UNDERSTAND_DEPOSIT_ALREADY_SUCCEEDED`
to resume at self-transfer without submitting a second deposit. This recovery
gate is not part of the default full-lifecycle run.

Use a dedicated disposable account, inspect its public and private balances before running, and
rotate its key after a test campaign. The suite reads the pool's live fee and aborts when it exceeds
5 STRK per action. At the current 4 STRK pool fee it spends roughly 12 STRK plus transaction gas
for an already-registered account, or 16 STRK plus gas when registration is needed. It leaves the
remainder of the deposited amount private and does not attempt a risky max withdrawal.
