---
layout: default
title: STRK20 privacy integration
permalink: /strk20-privacy/
---

# STRK20 privacy integration

Bramble implements the Wallet API `0.10.4` STRK20 surface through the official Starknet
Privacy SDK browser bundle. It supports shielded balance discovery, action preparation, private
submission, dapp-scoped shadow-account commitments, explicit account registration, and reviewed
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
- Optional SDK shadow-account anonymizer (`shadowAccountAnonymizerAddress`), used only by
  `shadow_account_invoke` and `wallet_strk20ShadowAccountCommitment`. Core registration, discovery,
  shield, withdraw, and transfer operations do not need it. The anonymizer address is an input to
  every shadow-account identity, so changing it moves every shadow account; accounts made under the
  old one can only be reached through the old one. A preferences record from before Wallet API
  0.10.4 that still carries `subaccountAnonymizerAddress` loads with that key dropped, not carried
  over: it names an old-class anonymizer the pinned SDK only half-drives.
- Dapp-specific anonymizers/executors are not global pool configuration. A Vesu, Ekubo, or other
  integration supplies its audited contract as an explicit invoke target inside the reviewed action
  plan, where it handles notes according to that dapp's rules.
- Optional OHTTP, which must be supported by both the discovery and proving services. The bundled
  Mainnet route has OHTTP disabled because the deployed proving service currently accepts standard
  JSON-RPC only. A separate OHTTP relay URL is optional when OHTTP is enabled.
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

- credential-free wildcard CORS, so the extension can call the gateway before it has a stable
  Chrome extension ID. This is compatibility behavior, not client authentication;
- a fixed method/path/content-type allowlist and fixed Mainnet pool/paymaster fee token;
- request/response size caps, timeouts, no redirects, generic upstream failures, and no request
  body logging;
- OHTTP is disabled for the bundled route until both privacy upstreams support it. The gateway
  therefore forwards standard discovery and proving requests and can observe their contents;
- AWS WAF coarse edge limits plus DynamoDB-backed per-route client limits.

Neither CORS nor an HTTP `Origin` header authenticates an extension: non-browser clients can
spoof headers. Stronger client authenticity requires an extension-ID allowlist or an external
enrollment or platform-attestation system; no generic Chrome Web Store attestation is available to
this protocol today.

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
   and its viewing-key commitment. The same batch opens the account's own private channel, so a
   later shield to another wallet opens only that recipient's channel. No registration is silent.
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
disclosure off, discovery, registration, the registration funding shortfall, empty notes, asset
entry, compose, public shielding,
Wallet API private-relay review, proving, success, service failure, missing configuration, and the
unsupported Ledger boundary. Fixtures never call a real vault, SDK service, RPC, or hardware
device.

## Privileged data flow

1. The content/provider bridge strictly parses bounded actions, token lists, proof envelopes, and
   dapp-scoped shadow-account requests (Wallet API 0.10.4 names only; the pre-0.10.4
   `wallet_strk20SubaccountCommitment` and `subaccount_invoke` have no alias). A connected origin
   sees only its granted active account.
   Before any approval is queued, the background refuses batch shapes the pinned SDK or pool
   rejects only later (`strk20-batch.ts`): more than one `invoke`/`shadow_account_invoke`, a `0x…`
   shadow-account `entry_point` (the SDK hashes it as a name), an `OPEN` transfer with no invoke or
   after it, two `OPEN` transfers in one token beside a `shadow_account_invoke`, and a public deposit
   beside a `shadow_account_invoke` that settles open notes (`MULTIPLE_SCREENING_SUBJECTS`). The site
   gets `INVALID_REQUEST_PAYLOAD` with the rule as `data`.
   A shadow-account commitment, or a batch with a `shadow_account_invoke`, on a network with no
   anonymizer configured never reaches an approval card. It is not refused at once either, since
   an instant answer would let any site probe whether the user has private services set up: the
   wallet holds it on a notice ("Private services aren't set up for this network.") with only a
   Close control, and the site receives the same `UNKNOWN_ERROR` (`strk20 services unavailable: …`)
   only when the user closes it. If the queue's expiry drops it first, the site gets
   `USER_REFUSED_OP` ("request rejected"), exactly as for any expired approval, so waiting out the
   expiry does not reveal the configuration. With an anonymizer configured, a shadow invoke's fee is
   quoted before its card is built; if that quote fails, the request is held on the same notice
   (with its own line) and the site receives the quote's error only on Close, so a configured and an
   unconfigured network look the same to the site.
2. Dapp-requested registration, private balance reads, proof preparation (including simulation),
   and shadow-account commitments each create a dedicated approval. Registration uses the explicitly
   Bramble-namespaced `mc_strk20Register` capability because the Wallet API has no registration RPC.
   A registration that cannot reach its card — a Ledger account, a network without private
   services, or a public balance below the pool fee — is held on the same close-only notice, and the
   site receives the refusal only on Close (audit L1). The
   queue retains the exact private request and
   exposes display-safe summaries plus the exact action parameters and an account/network/payload
   digest. Invoke calldata, shadow-account call targets and entry points, nonce, and collect policy
   remain expandable in the approval. A `shadow_account_invoke` is summarized by what it does: the
   calls it runs through which shadow account (#nonce) for which site, the anonymizer, which tokens
   settle back into private notes (or that none do), and who can move what the calls leave behind.
   "Back into private notes" is said only for an `OPEN` note whose recipient is this account; a note
   for anyone else names that recipient, and under `collect_policy: all` the card also says the
   shadow account's whole balance of that token goes to them
   (this card copy is proposed and pending review). The anonymizer the card names is bound into the
   approval; execution refuses if the network's configured anonymizer changed after review. A private-relay review also lists the relayer-fee withdrawal
   as a separately labelled action with its exact token, amount, and recipient. Denial returns
   `USER_REFUSED_OP`; account, network, grant, or payload changes invalidate the request.
3. Only after approval does the background resolve a domain-separated viewing key. Software
   accounts derive it lazily through Krusty from the selected account's encrypted signing key. The
   derivation matches the pinned SDK reference: deterministic Stark ECDSA over the canonical
   `chainId:poolAddress`, Poseidon of `(r,s)`, and the privacy pool's lower-half curve-order fold.
   Software-derived keys are never persisted. A Ledger account may resolve only an exact
   account/chain/pool-scoped key retained in encrypted vault `accountSecrets`; if none exists it
   fails closed. The typed-data hardware ceremony that provisions such a key is deliberately not
   implemented until its domain, message, reduction, confirmation UI, and test vectors are
   formally reviewed. No viewing key is logged or returned through a browser message.
4. The SDK performs note discovery, transaction assembly, and proving. `USER_LINKAGE` warnings map
   to the Wallet API privacy-leak error; every other non-empty or malformed warning fails closed.
   A simulation (`simulate: true`) is proved by the configured prover exactly like a real proof,
   and its proof is then replaced by an empty one so it cannot be submitted. The wallet never
   calls the SDK's own `simulate`: it sends the viewing-key-bearing `compile_actions` invocation
   to the JSON-RPC node, which may be a user-set override. A simulation skips the final
   pre-proof policy gate, since it produces nothing submittable, and counts against the prover's
   rate limits and proving budget like any other proof.
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
approves its exact action list. Private balances and the deterministic, origin-scoped shadow-account
commitment are likewise never disclosed under the general account connection grant alone.

The standard dapp Wallet API still returns `NOT_REGISTERED` when a site requests an operation
before registration. The Terminal can initiate registration only through the Bramble-specific
`mc_strk20Register` capability. It enters the same content-script trust boundary as other dapp
requests, opens the wallet approval surface immediately, and cannot derive a viewing key or submit
until the user approves the account/network/pool/token-bound payload.

The wallet-owned side-panel journey currently exposes registration and deposit-only shielding.
Private transfer, withdrawal, generic invoke, proof preparation, and shadow-account commitment remain
Wallet API/dapp approval journeys; they do not appear as standalone portfolio actions yet.

## Shadow accounts: records, recovery, and sweep

A shadow account is derived from the user's identity key (account address, viewing key,
anonymizer), the origin-bound scope (`bramble/strk20-shadow-account/v1`, the verified origin, and
the site's label, cut to 30 hex characters), and a nonce the site chooses. Only this wallet,
deriving that scope, can drive it. If the site disappears, or a `diff`/`exact` collect policy leaves
a remainder, the funds stay in the shadow account until this wallet moves them.

So the wallet records every scope it uses, in the encrypted vault (schema v12,
`shadowAccountScopes`), never in preferences: account, chain, pool, anonymizer, origin, label, and
the exact nonces used. A scope is recorded when its commitment is shared (a site can fund a
precomputed address before the account is deployed), when a submittable proof names it, and before
a shadow invoke is submitted. Recording happens first and fails closed: a request whose record cannot
be written does not run. The record reveals which sites someone used privately. It is bounded to 128
scopes, 64 nonces per scope, and half of the vault's capacity in all (`SHADOW_ACCOUNT_SCOPES_BUDGET`,
derived from the provider JSON budget), so records can never fill the vault and block its other
writes; past a bound the request is refused rather than a record dropped. The bounds and the vault's
own capacity are checked before a card is queued, so the user is not asked to approve a request the
record would refuse (the record after approval still re-checks). Such a request is held on the same
close-only notice as a network with no anonymizer, with its own line, so the site learns nothing
until the user sees it: Close returns the record refusal, and expiry returns `USER_REFUSED_OP`. There is no way yet to remove
a record, so a full table stays full.
Shadow accounts used before this record existed are not in it.

Settings → Shadow accounts lists the records without any network read. Balances are read only when
the user asks, and the screen says why: the read sends the scope's partial commitment to the RPC node
(`get_shadow_accounts` on the anonymizer) and then each address's balances, so the node can link
those addresses to each other and to this client. The read covers the recorded nonces plus the
first 16 (undeployed included, since they may already hold funds); recorded nonces from 2^64 − 1
up are reported as not listable, because the view's exclusive `u64` end bound cannot include them,
and the scope's other nonces still list. A scope recorded under another anonymizer is listed but not
reachable.

A sweep is one `OPEN` transfer to this account per tracked token the shadow account holds, then a
`shadow_account_invoke` with `collect_policy: all` and no calls (the anonymizer accepts this). It is
always relayed, so the relay fee comes from the private balance. The collected amount is the balance
at execution, not the one shown at review. Activity records a settled sweep as "Sweep shadow
account", with no site, label, or nonce, since activity is plain browser storage and part of the CSV
export.

Limits of the sweep:

- **Tracked tokens only.** Balances are read, and `OPEN` transfers built, only for tokens in the
  wallet's token list for the network. A token the shadow account holds that is not tracked is not
  shown and not swept; a listed shadow account holding only untracked tokens shows "No tracked tokens" and
  has no Sweep control. Track the token first. What the anonymizer does with an untracked token's
  balance under `collect_policy: all` is not yet confirmed on a live network.
- **The relay fee needs a private balance in the fee token.** The fee is a private withdrawal in the
  token the relay quotes, checked against the private balance before the review is built. Funds in
  the shadow account do not count, so a user whose only funds of that token are in the shadow
  account cannot sweep until they hold some privately. The Sweep tap is then refused with the
  existing "Insufficient private balance" error, before any review or Confirm appears.

The settled open notes are screened against the shadow
account's own address (`Delegated`); whether the prover behind mc-backend performs that screening is
not yet confirmed (issue 443).

The generic `wallet_addInvokeTransaction` path also accepts an optional SNIP-36 proof, which must be
submittable (a simulate-mode, all-empty proof is refused at intake). The request receives the normal
decoded approval review, and the proof and calls are included in the approval digest. A pool-shaped
batch (any call to `apply_actions` or to the configured pool) is submitted only through the STRK20
lane, which requires `approve` calls followed by exactly one `apply_actions` on the configured pool;
it is never converted into an ordinary public invoke. Any other proof-bearing batch, such as a SNIP-36
application proof, is submitted as an ordinary invoke with `proof` and `proof_facts` attached, under the
same fee review and reviewed-fee ceiling.

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
- The gateway uses credential-free wildcard CORS and does not require an extension origin or ID.
  Treat it as a public endpoint and rely on the WAF and per-client rate limits for abuse control.
- Keep OHTTP disabled until both privacy upstreams expose OHTTP at `/ohttp-keys` and their service
  root. The current proving service does not, so the bundled Mainnet configuration uses JSON-RPC.
- Keep AWS WAF and the backend's DynamoDB rate-limit table enabled for `/rpc/*` and
  `/api/strk20/*`. Configure Vercel Firewall independently for Terminal-only
  `/api/private-swap/*` routes.
- Configure the SDK shadow-account anonymizer only when supporting `shadow_account_invoke`, and
  pick it once: changing it moves every user's shadow accounts. Keep each
  dapp-specific anonymizer/executor in that dapp's reviewed action plan.
- Supply a private paymaster/relayer and fee token to enable private transfers, withdrawals,
  invokes, and private relay-fee submission. Registration and deposit-only entry remain available
  without it.
- Put credentials, quotas, and abuse controls behind a wallet-owned HTTPS relay; never add a shared
  API key to the extension.
- Supply an OHTTP relay only when enabling OHTTP and the discovery/prover deployment requires a
  separate relay.
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
export BRAMBLE_STRK20_E2E_ACCOUNT_ADDRESS='<dedicated test account address>'
export BRAMBLE_STRK20_E2E_DEPOSIT_STRK='0.1'
export BRAMBLE_STRK20_E2E_DISCOVERY_URL='<direct discovery service URL>'
export BRAMBLE_STRK20_E2E_PROVER_URL='<direct proving service URL>'
export BRAMBLE_STRK20_E2E_RPC_URL='<RPC 0.10 endpoint with proof-facts support>'
export BRAMBLE_STRK20_E2E_MAINNET_ACK='I_UNDERSTAND_THIS_WRITES_TO_MAINNET'
export BRAMBLE_STRK20_E2E_PUBLIC_CALLER_ACK='I_UNDERSTAND_THIS_LINKS_PRIVATE_ACTIONS'
read -rs 'BRAMBLE_STRK20_E2E_PRIVATE_KEY?Dedicated test signing key: '
export BRAMBLE_STRK20_E2E_PRIVATE_KEY
bun run test:e2e:mainnet
unset BRAMBLE_STRK20_E2E_ACCOUNT_ADDRESS BRAMBLE_STRK20_E2E_PRIVATE_KEY \
  BRAMBLE_STRK20_E2E_DEPOSIT_STRK BRAMBLE_STRK20_E2E_DISCOVERY_URL \
  BRAMBLE_STRK20_E2E_PROVER_URL BRAMBLE_STRK20_E2E_RPC_URL BRAMBLE_STRK20_E2E_MAINNET_ACK \
  BRAMBLE_STRK20_E2E_PUBLIC_CALLER_ACK BRAMBLE_STRK20_E2E_RESUME_AFTER_DEPOSIT_ACK
```

If a proof-bearing deposit reached the RPC but its response was lost, first
verify that the private balance increased, then set
`BRAMBLE_STRK20_E2E_RESUME_AFTER_DEPOSIT_ACK=I_UNDERSTAND_DEPOSIT_ALREADY_SUCCEEDED`
to resume at self-transfer without submitting a second deposit. This recovery
gate is not part of the default full-lifecycle run.

Use a dedicated disposable account, inspect its public and private balances before running, and
rotate its key after a test campaign. The suite reads the pool's live fee and aborts when it exceeds
5 STRK per action. At the current 4 STRK pool fee it spends roughly 12 STRK plus transaction gas
for an already-registered account, or 16 STRK plus gas when registration is needed. It leaves the
remainder of the deposited amount private and does not attempt a risky max withdrawal.
