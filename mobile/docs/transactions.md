# Mobile transactions: design

Status: implemented on branch `mobile/transactions` (2026-09-24); review must-fix items resolved
in §3–§5 and listed in §10. This is the plan for SCOPE.md Phase 1.2. It covers sending an ERC-20 from an OpenZeppelin (OZ)
account on mainnet or Sepolia, and deploying the account automatically before its first send,
exactly as the extension does. Section 2 was rewritten on 2026-09-30 to follow the extension's
copy review.

## 1. Ground truth: what the extension actually does

The extension does **not** hash transactions with Krusty. starknet.js 10.8.0 (`Account`,
`RpcProvider`, spec 0.10.0) builds the calls, resource bounds, v3 hashes and RPC bodies. Krusty
WASM 0.11.0 only signs the finished hash (`signRaw`, then the vault's `signStarkHash`). The
mobile core therefore reproduces **starknet.js's defaults plus the extension's refusal rules**,
and uses Krusty 0.11.0 for the hash and the signature:

| Rule | Value the extension uses | Source |
| --- | --- | --- |
| Bounds margin | `addPercent(x, 50) = x + x*50/100` (integer floor) on `max_amount` (from `*_gas_consumed`) and `max_price_per_unit` (from `*_gas_price`), for L1_GAS, L2_GAS and L1_DATA | starknet.js `toOverheadResourceBounds` |
| Fixed fields | tip `0x0`; nonce/fee DA mode `L1`; `paymaster_data []`; `account_deployment_data []`; block `latest` | starknet.js `v3Details` |
| Estimate | `starknet_estimateFee`, version `0x100000000000000000000000000000003`, empty signature, `simulation_flags ["SKIP_VALIDATE"]` (OZ) | `getEstimateFee`, `buildInvocation` |
| Undeployed estimate | one bulk call `[DEPLOY_ACCOUNT nonce 0, INVOKE nonce 1]`; invoke fee is `result[1]`; missing entry fails closed | `invoke-fee.ts` |
| Fee shown and compared | `feeBoundsMaxSpend` = Σ max_amount × max_price_per_unit over the signed bounds; unit absent → FRI; unit not FRI/WEI → refuse | `fee-bounds.ts` |
| Speed | always `standard` (no UI control; `FAST_BOUND_SCALE` is never used) | `transfer-ui.ts` |
| Reviewed-fee ceiling | re-estimate at submit; refuse before signing when `actual*2 > reviewed*3`, units differ, or either is not base units; then sign exactly the re-estimated bounds | `rpc-submit.ts`, `REVIEWED_FEE_HEADROOM` |
| Deployment ceiling | same 3/2 headroom against `reviewedDeploymentFee`, separately | `deployment.ts` |
| Broadcast | endpoint must prove `starknet_chainId`; a write never fails over to another endpoint; returned hash must `sameFelt` the signed hash | `provider.ts`, `rpc-submit.ts` |
| Nonce | `getNonceSafe`: every estimate and the final `execute` re-read `starknet_getNonce`; any error reads as 0 | starknet.js `Account` |
| Deploy wait | `starknet_getTransactionStatus` every 5 s until ACCEPTED_ON_L2/L1, then `starknet_getTransactionReceipt`; starknet.js caps only failed reads at 200, mobile caps every attempt at 200 | starknet.js `waitForTransaction` |
| Confirmation checkpoints | `[0,250,500,900,1500,2500,4000,5000,7500,10000,10000,10000]` ms, then "pending" | `transfer-progress-ui.ts` |

Krusty 0.11.0 provides everything cryptographic that this needs, all of it sans-IO and already
linked: `compute_invoke_v3_hash`, `compute_deploy_account_v3_hash`, `ResourceBounds`, `DaMode`,
`sign_stark_hash`, `OpenZeppelinAccount::deployment_descriptor` with `SaltPolicy::{Zero,
PublicKey}`, and `calculate_contract_address`. Section 9 lists what it lacks. None of the gaps
needs new cryptography.

## 2. User-visible behaviour, screen by screen

All copy is the extension's, byte for byte. Section 6 describes how that is enforced. Layout
reuses `mobile/ios/Bramble/DesignSystem` (`Surfaces.swift`, `Controls.swift`, generated tokens)
and follows the `send-*` classes in `packages/presentation/wallet-ui/src/sidepanel/styles`. The
UI Lab stories in "Wallet journeys/03 Send and swap" are the visual reference for each checkpoint.

### 2.1 Home and Settings

- **Send tile.** `HomeView.swift` enables it whenever an account exists (a one-line edit). The
  extension does not gate the tile on deployment, and neither does mobile.
- **No deploy notice.** Home no longer flags an undeployed account: the "Deploy account" and
  "Fund with STRK" chips are gone, and the first send deploys the account (§3).
- **Settings › "This account".** A Settings section headed "This account" holds one row,
  "Deploy account", which opens the standalone flow (§2.7). It is shown whatever the deployment
  state, because that screen says "Account already deployed" itself.
- **Token screen.** A "Send" action opens Send on that token (no Swap: mobile has no swap flow).

### 2.2 Recipient ("Send")

The flow header reads "Send". Under the heading "Send to", typing in the search field ("Address
or saved name"; autocorrect, capitalisation, smart punctuation off) filters every list below it;
a search that matches nothing shows "No matching recipient.".

- **Send from.** The heading "Send from" over a card with the avatar (`account_avatar`), the
  account name (the accounts workstream owns naming) and a truncated address, beside a control
  "Copy sending account address" that copies the full address.
- **Address book.** The heading "Address book" over the saved contacts on this network. A typed
  address that validates and is not already listed also offers "Save", which opens the address
  book with the address filled in. There is no address-book empty state.
- **Accounts under their folders.** The wallet's accounts on the network, filed as the account
  drawer files them: the folder's glyph, name and account count, then its rows; accounts in no
  folder sit under "My accounts"; empty folders are not listed. The sending account's own row is
  listed too, marked "Current".
- **Picking a recipient.** A row sends to its address and carries its name to the review as the
  recipient label. Typed text never supplies a label, but a typed address that is already listed
  reads as the row it matches (compared as canonical felts).
- **Continue with address.** Disabled until `validate_recipient` returns a canonical felt; the
  error is "Enter a valid Starknet address.". Validation follows `normalizeFeltInput` then
  `isStarkFieldElement`: trim; when the text starts with `0x`, lowercase it and strip leading
  zeros; then apply the lowercase-hex grammar, at most 64 digits, below P.
- **Truncation.** Everywhere it uses the core's `short_address`: the first 6 characters, then
  "…", then the last 4. The extension's `shortAddress` applies this to the raw string.

### 2.3 Details ("Send")

- **Accounts receipt** (From, To, Network). **Asset trigger** (the token's glyph and symbol)
  opens "Tokens you can send", mirroring the extension's token dropdown: a sheet on iOS, a stage
  of its own on Android. It has one group, "Your tokens", listing the network's bundled
  `networks.json` tokens with the chosen one marked, and no search field. iOS adds a "Manage
  tokens" row under the list that opens the token list; Android has no token-management screen.
  STRK is preselected unless Send was opened from a token screen. Choosing a token clears the
  amount.
- **Amount.** Placeholder "0". The balance line reads "Balance <compact> SYMBOL", or "Balance
  unavailable" when the balance could not be read.
- **Half and Max.** Max is the full raw public balance, formatted exactly; it does **not**
  reserve the fee and does nothing while the balance is unread. Fiat: "Estimated value —"; the
  toggle stays hidden until the portfolio workstream supplies prices.
- **Gates.** "Enter an amount greater than zero."; the public-to-public route gate's "Checking
  your SYMBOL balance…" and "Not enough SYMBOL"; `parse_token_amount`'s "Too many decimal places".
- **Review send.** The button creates the `TransferPlan` (§3) and moves to the reviewing stage.

### 2.4 Review ("Review send")

The confirm face is a facts list, a Cost box and, only when needed, a risks panel, then the
button (`transfer-review-markup.ts` `reviewSummaryHtml` / `reviewRisksHtml`). There is no hero,
Edit button, review note or Technical details disclosure (the decoded `transfer` call, "Maximum
cost and constraints" and "What will happen" are gone); Back returns to the details.

- **Facts list.** One hairline between rows, the label on the left and the value over its
  detail line on the right. "From": the sender's name, else its truncated address, over the
  truncated address. "To": the recipient's label (the row it was picked from), else the
  truncated address, over the truncated address, beside "Copy recipient address", which copies
  the full address using the existing `ReceiveView` clipboard options (local-only, 120 s
  expiry). "Amount": the token glyph and "<amount> SYMBOL" over "Fiat estimate unavailable"
  (mobile's Send has no fiat).
- **Cost box.** The heading "Cost", then the first matching case of `reviewFeeSection`:
  1. Deployment needed and both fees known: one combined figure, "Estimated fee: X" with X the
     sum of the two, and under it "Creating this account on Starknet is Y of that." (Y the
     deployment fee). Fees in unlike units cannot be summed and fall to case 2.
  2. Deployment needed and either fee failed: "Couldn't estimate both the transaction and
     account deployment fees. Check your connection and retry before sending." with "Retry fee
     estimate".
  3. Account deployed and fee known: "Estimated fee: X".
  4. Account deployed and the estimate failed: "Couldn't estimate the network fee right now.
     Check your connection and retry before sending." with "Retry fee estimate".

  X and Y are `formatFri`: the integer part, then the fraction truncated to 6 digits with trailing
  zeros stripped, then " STRK". A non-FRI unit renders as "<n> <UNIT>".
- **Shortfall warning.** Warn-only, in the Cost box: "This account's STRK balance is less than
  this transaction needs, including the estimated network fee. The network will likely reject
  it.". It compares FRI fees only, and adds the amount when the token sent is STRK.
- **Risks panel.** Shown only when there is something to say: the heading "Risk and recovery",
  one alert line per flag, and on an account's first send the deploy note "This account is not
  deployed yet; the first send also submits its deployment." With nothing to warn about nothing
  is shown (no "No additional wallet warnings" line).
- **Flags.** `self-transfer`: "The recipient is this wallet's own address.". `address-poisoning`
  (the recipient's `short_address` matches the acting account's but the address differs; the core
  trusts only the acting account's address, so saved contacts are not an input) lists "The
  recipient closely mimics one of your saved addresses but is a different account. Re-check every
  character before sending." and blocks Confirm with "This recipient closely mimics a saved
  address. Change it and review again.", and the core refuses again at confirm.
  `unknown-contract` cannot occur: only bundled tokens are selectable.
- **Blocking.** Any fee failure disables Confirm and shows "Fee estimate unavailable. Retry
  before authorizing this transaction.". The button reads "Confirm and send".
- **Edits.** Any edit (the extension's `transferKey`) drops the plan; a new plan means a new review.

### 2.5 Working state

Authorizing, broadcasting and confirming are one screen: the flow header reads "Sending" for all
three, and the body is a progress mark under one title, "Sending your transaction…", with no body
copy, task list or liveness line (so the one wording change mobile made, "Keep this app open.",
is gone too). Underneath, broadcasting is still the automatic deployment and its wait, then the
invoke broadcast; confirming runs the checkpoints.

### 2.6 Outcomes

An outcome with a hash shows the extension's hash row (`outcomeHashRow`): the hash truncated,
linked to Starkscan when the network has one (accessible name "View this transaction on
Starkscan"; opened in the system browser), beside "Copy transaction hash". The link comes only
from the core's `explorer_transaction_url`, which returns `None` for a malformed or zero hash, so
the hash is then plain text. A receipt labels the row "Transaction".

- **Confirmed** ("Confirmed"). No kicker. Title "Send complete", summary "<amount> <SYMBOL> sent
  to <label>", the "Transaction" row, buttons "View in Activity tab" and "Back"; toast
  "Transaction confirmed on Starknet" (or "Transaction pre-confirmed on Starknet").
- **Pending** ("Confirmation pending"). "Submitted to Starknet" / "Confirmation is taking longer"
  / "The transaction has a hash and remains pending. You can check again or follow it in
  Activity.". Buttons: "Check confirmation" and "View in Activity tab".
- **Failed** ("Send failed"). No kicker. Title "Transaction not sent" over "The transaction was
  not sent. <error>", beside "Copy the error", which copies that message. The default error is
  "The transaction was not sent. Your balance is unchanged.". Buttons: "Try again" and "Edit
  transaction". Toast: "Transaction was not sent". Rejected: "Starknet rejected this
  transaction. No transfer was completed."; reverted: "Starknet reverted this transaction.
  Review its activity details before retrying." (toast "Transaction was not confirmed").

### 2.7 Deploy account (standalone, from Settings)

Opened by Settings › "This account" › "Deploy account" (§2.1). An account the core cannot deploy
(view-only) shows why instead of the form.

- **Rows.** Header "Deploy account", then Account (the name), Address (truncated) and Network.
  The Contract row, "What will happen" and "Risk and recovery" are gone.
- **Quote on open.** The fee is quoted as the screen opens: the status line reads "Estimating
  fee…", then the Cost box reads "Maximum network fee: <fee>". If the quote fails the line reads
  "Could not estimate the deployment fee"; pressing Deploy then quotes again and shows the new
  figure, and the next press submits, so no fee is spent that was never on screen.
- **One button.** "Deploy" submits under the quoted fee, with the status "Submitting
  deployment…". The earlier two-press "Review deployment" → "Confirm deployment · <fee>" is gone.
  An account already on chain reads "Account already deployed" on the disabled button.
- **Receipt.** Right after the broadcast the title is "Deployment submitted"; once the chain
  accepts or pre-confirms the deployment it firms up to "Account deployed" over "This account is
  on Starknet and can submit transactions." (a rejected or reverted deployment is a failure,
  never a deployed receipt). Rows: "Transaction" with the hash (§2.6), "View in Activity tab"
  and "Back" (Home).
- **Activity.** Kind `deploy`, summary "Deploy account contract". The automatic deployment inside
  a send **does** get its own `deploy` row on mobile, recorded before its write leaves the core
  (§3, "Pending record before every write"). The extension records none because its background
  worker always finishes the send; a phone app cannot promise that.

## 3. UniFFI surface (new; all in new files under `mobile/core/src/send/`)

**Design choice.** A core-owned state machine, not a set of free functions. The host cannot
reorder steps, skip the re-estimate, substitute bounds or hand in a hash. It only relays opaque
request bodies and their replies. The core allocates JSON-RPC ids.

```rust
// send/types.rs
#[derive(uniffi::Record)] pub struct TransferRequest {
    pub network: NetworkId, pub account_id: String,   // vault record id (merge with accounts)
    pub token_address: String,   // must be a bundled token of `network`
    pub recipient: String,       // any accepted input spelling; canonicalised in core
    pub amount: String,          // decimal text as typed
    pub fee_balance: Option<String>, // STRK base units the host last read, for the shortfall warning
}
#[derive(uniffi::Enum)] pub enum FeeUnit { Fri, Wei }
#[derive(uniffi::Record)] pub struct FeeAmount { pub max_spend: String, pub unit: FeeUnit, pub display: String }
#[derive(uniffi::Enum)] pub enum ReviewFlag { SelfTransfer, AddressPoisoning }
#[derive(uniffi::Enum)] pub enum FeeAffordability { Sufficient, Insufficient, Unknown }
#[derive(uniffi::Enum)] pub enum DeploymentState { Deployed, Undeployed, Unknown }
#[derive(uniffi::Record)] pub struct TransferReview {
    pub summary: String,            // "Send 1.5 STRK to 0x3fa7…41a3" (verifyCalls wording)
    pub recipient: String, pub recipient_short: String,
    pub amount_display: String, pub token_symbol: String,
    pub fee: Option<FeeAmount>, pub fee_estimate_failed: bool,
    pub deployment_fee: Option<FeeAmount>, pub deployment_fee_estimate_failed: bool,
    pub requires_deployment: bool, pub already_deployed: bool, pub affordability: FeeAffordability,
    pub flags: Vec<ReviewFlag>, pub can_confirm: bool,
}
#[derive(uniffi::Enum)] pub enum RpcPurpose { ChainId, ClassHashAt, Nonce, EstimateFee,
    EstimateDeploymentFee, AddDeployAccount, AddInvoke, TransactionStatus, TransactionReceipt }
#[derive(uniffi::Enum)] pub enum TxStatus { Pending, Preconfirmed, Accepted, Rejected, Reverted }
#[derive(uniffi::Enum)] pub enum SendStep {
    Rpc { id: u64, body: String, purpose: RpcPurpose, is_write: bool },
    Wait { delay_ms: u32 },
    Review,                        // read it with `TransferPlan::current_review()`
    Broadcast { hash: String },    // accepted by the node; UI moves to Confirming
    Finished { status: TxStatus, hash: String, explorer_url: Option<String> },
    Failed { failure: SendFailure },
}
#[derive(uniffi::Enum)] pub enum StepReply {
    Start, Rpc { id: u64, body: String, now_ms: u64 }, TransportFailure { id: u64, now_ms: u64 },
    WaitElapsed, RetryEstimate, Confirm, Proceed, CheckAgain,
}
#[derive(Debug, thiserror::Error, uniffi::Error)] pub enum SendError {
    InvalidRecipient, InvalidAmount { reason: SendAmountError }, UnknownToken,
    Locked, UnknownAccount, OutOfOrder, PlanClosed, UnknownTransaction,
}
#[derive(uniffi::Record)] pub struct SendFailure { pub code: SendFailureCode, pub hash: Option<String> }
// SendFailureCode: ReviewedFeeExceeded, ReviewedFeeRequired, ReviewedDeploymentFeeExceeded,
// ReviewedDeploymentFeeRequired, PoisonedRecipient, WrongChain, PreparationUnavailable,
// HashMismatch, SubmissionIndeterminate, DeploymentStatusUnknown, DeploymentUnconfirmed,
// DeploymentThenInvokeUnconfirmed, AutoDeploymentFailed, AlreadyDeployed, BoundsOutOfRange,
// UnrecognisedFeeUnit, NodeError, Locked, SigningFailed.  The host maps each code to the
// extension's copy (§6).
```

```rust
// send/plan.rs: one reviewed transfer (or standalone deployment).
#[derive(uniffi::Object)] pub struct TransferPlan { /* Mutex<PlanState>, Weak<WalletCore>, generation */ }
#[uniffi::export] impl TransferPlan {
    /// Feeds the last reply and returns the next thing the host must do. A reply whose id is not
    /// the one outstanding, or a reply kind the state does not expect, returns `OutOfOrder` and
    /// closes the plan (fail closed).
    pub fn advance(&self, reply: StepReply) -> Result<SendStep, SendError>;
    /// Stops the plan: no further signing point can be reached. Idempotent. It never erases the
    /// pending activity record of a write the plan has already handed out (§4).
    pub fn close(&self);
    /// The review the last `Review` step announced (kept out of `SendStep` to keep that enum small).
    pub fn current_review(&self) -> Option<TransferReview>;
}

// send/wallet_ext.rs: a second `#[uniffi::export] impl WalletCore` block (additive).
impl WalletCore {
    /// Requires an unlocked wallet. Validates and canonicalises every input and builds the
    /// ERC-20 call. Does no I/O. Records the session generation it was prepared under.
    pub fn prepare_transfer(self: Arc<Self>, request: TransferRequest) -> Result<Arc<TransferPlan>, SendError>;
    /// Standalone deployment for Settings' Deploy account; same state machine without the invoke.
    pub fn prepare_deployment(self: Arc<Self>, account_id: String) -> Result<Arc<TransferPlan>, SendError>;
    /// Local activity for one stored account, newest first (§4).
    pub fn activity(&self, account_id: String) -> Result<Vec<ActivityRecord>, SendError>;
    /// Starts a plan that only reads status for an existing record and settles it; never signs.
    pub fn refresh_activity(self: Arc<Self>, account_id: String, hash: String) -> Result<Arc<TransferPlan>, SendError>;
}

// send/mod.rs: pure helpers, #[uniffi::export] free functions.
pub fn validate_recipient(input: String) -> Option<String>;               // canonical felt (0x0 included, as the extension's field check) or None
pub fn parse_token_amount(amount: String, decimals: u8) -> Result<String, SendError>; // base units
pub fn explorer_transaction_url(network: NetworkId, hash: String) -> Option<String>;
pub fn confirmation_checkpoints_ms() -> Vec<u32>;
pub fn deployment_status_request(id: u64, address: String) -> Option<String>; // getClassHashAt body (the privacy gates' deployment state)
pub fn judge_deployment_status(body: String, id: u64) -> DeploymentState;     // error code 20 => Undeployed
```

The wire order below is not designed; it is the order the extension's real path produced when
recorded (§6 item 1), and the Rust fixture test replays it request by request.

**State machine (transfer plan).**

1. **Review.** `Start` → `ChainId`. The reply must name the plan's `NetworkId`; a mismatch is
   `Failed { WrongChain }`. This is the one read the extension's review does not make: mobile
   proves the endpoint before it asks anything else, and the same endpoint then serves the whole
   plan (see "Endpoint binding" below).
2. `ClassHashAt` (`latest`): any class hash means `Deployed` (the extension's OZ check is
   existence-only); JSON-RPC error 20 or `/contract not found/i` means `Undeployed`; anything else
   is `Unknown`, and the review shows both fees failed with `requires_deployment = true` (fail
   closed, as `reviewWalletFundedFees` does).
3. `Nonce` (`starknet_getNonce`, `latest`) in both cases, as starknet.js's `getNonceSafe` does:
   any JSON-RPC error reply reads as nonce 0 (how an undeployed account answers), and a transport
   failure marks the fee failed. Then **Deployed:** `EstimateFee` with one INVOKE at that nonce.
   **Undeployed:** `EstimateFee` is the bulk `[DEPLOY_ACCOUNT nonce n, INVOKE nonce n+1]` and the
   invoke fee is `result[1]` (missing: fee failed); then `Nonce` again and
   `EstimateDeploymentFee` (deploy only, `SKIP_VALIDATE`), which runs even when the invoke
   estimate failed, as the extension's two parallel estimates do.
4. The core applies the margins, computes `max_spend` and returns `Review`. `RetryEstimate`
   repeats from step 1.
5. **Confirm.** Refused with `Failed { PoisonedRecipient }` when that flag is set, with
   `Failed { Locked }` when the session generation moved (below), and with `OutOfOrder` when
   `can_confirm` is false. Otherwise the submit path re-reads everything, exactly as
   `submitInvokeTransaction` does; nothing from review is reused except the two reviewed
   ceilings:
   - `ChainId` again (the write-endpoint proof of `withRpcWrite`), then a fresh `ClassHashAt`
     and a fresh `Nonce`.
   - **Deployed now** (including an account that was deployed elsewhere after review): the
     invoke-only estimate at the fresh nonce, checked against the reviewed fee; the reviewed
     deployment fee is not consumed.
   - **Still undeployed:** the bulk estimate at the fresh nonce; invoke bounds settled first.
     Then `ensureAccountDeployed`: `ClassHashAt` once more (deployed now → skip the
     deployment), `Nonce`, `EstimateDeploymentFee`, its own 3/2 ceiling against the reviewed
     deployment fee (absent → `ReviewedDeploymentFeeRequired`), sign
     (`compute_deploy_account_v3_hash`, nonce 0), `Rpc { AddDeployAccount, is_write: true }`,
     then `Wait { 5000 }` / `TransactionStatus` until ACCEPTED_ON_L2/L1, then
     `TransactionReceipt`, as starknet.js `waitForTransaction` does. The wait gives up after
     200 attempts (`DeploymentUnconfirmed`, with the deployment hash).
   - **Invoke.** `Nonce` again (starknet.js `execute` re-reads it), sign
     (`compute_invoke_v3_hash`), `Rpc { AddInvoke, is_write: true }`.
   - **Failure mapping** follows the extension, not a blanket refusal. `ReviewedFeeExceeded`
     (and `ReviewedDeploymentFeeExceeded`) is returned only for a 3/2 ceiling breach, a unit
     mismatch or unreadable bounds. A node error reply to an estimate is `NodeError`; a
     transport failure before any write is `PreparationUnavailable` ("Transaction could not be
     prepared…"). Inside the automatic deployment, `ensureAccountDeployed`'s rules apply: a
     transport failure or an unmatched deploy hash is `DeploymentStatusUnknown`, any other
     error is `AutoDeploymentFailed`. Any failure after the deployment was accepted is
     `DeploymentThenInvokeUnconfirmed` carrying the deployment hash.
6. The broadcast reply must carry a non-zero felt equal (numerically) to the signed hash.
   Otherwise it is `HashMismatch`. A `TransportFailure` on a write is `SubmissionIndeterminate`,
   and the core never re-emits a write. A JSON-RPC error reply to a write (invoke or
   deployment) is a determinate refusal (`NodeError` / `AutoDeploymentFailed`): the transaction
   never existed, so its still-unobserved pending record is removed, as the extension records
   activity only after an accepted write. Acceptance returns `Broadcast`.
7. `Proceed` starts the confirmation checkpoints, which alternate `Wait` and
   `TransactionStatus`, settle the activity record, and end in `Finished`. `CheckAgain` re-runs
   the checkpoints from `Finished { Pending }`.

**Pending record before every write (must-fix: backgrounding and lock mid-send).** Immediately
before the core returns `Rpc { is_write: true }`, it atomically persists a `pending` activity
record keyed by the hash it just signed, with the extension's summary, amount and counterparty
(§4). Only then does the body leave the core. `close()` (lock, backgrounding, dismissal) stops
any further signing point but never deletes that record, so a transaction that reached the
chain while the app was away still has a row. Its outcome is settled later by
`refresh_activity` or the next plan's checkpoints: status moves forward only, and three
consecutive not-found answers mark it `rejected` (`NOT_FOUND_FAILURE_THRESHOLD`). A reply that
arrives after `close()` is refused (`PlanClosed`) and changes nothing; the record's status comes
from the chain, never from a reply to a closed plan. This is the mobile equivalent of the
extension's background worker, which finishes and records a send whatever the panel does.
Deviation: because a closed plan never reaches the invoke, the automatic deployment inside a
send gets its own `deploy` row ("Deploy account contract"); the extension records none, but it
also cannot lose the rest of the send.

**Closed after a write left.** `TransferPlan::interrupted_failure()` tells the host what to
report when the plan is closed (lock, backgrounding, dismissal) after a signed write was handed
out: the invoke as `SubmissionIndeterminate`, an automatic deployment as
`DeploymentUnconfirmed` (the extension's "Account deployment was broadcast as <hash>, but
confirmation is unknown"), each with its hash. It is `None` while nothing has left, the only
case in which the journey says "not sent".

**Reconciliation cadence.** Observation follows the extension's `tx-observation.ts` in two
tiers. Hosts read the status of a recorded transaction only while `activity_needs_observation`
holds (`isObserved`): pending or pre-confirmed and submitted less than `UNRESOLVED_WINDOW_MS`
(one hour) ago, the fast tier; or L2-accepted, not yet `finalizedOnL1`, and submitted less than
`L1_FINALITY_WINDOW_MS` (seven days) ago, the slow tier. Each record is read at most once per
`activity_observation_period_for(record)`: `FAST_OBSERVATION_PERIOD_MINUTES` (1) for the fast
tier, `SLOW_OBSERVATION_PERIOD_MINUTES` (15) for the slow one. Hosts tick every
`activity_observation_period_ms()` while the wallet is unlocked and in the foreground (the
mobile stand-in for the extension's two alarms), and after each pass call
`take_activity_notices(account_id, now_ms)`, which retires the account's unresolved records that
outlived their hour (`expiredObservations` + `retiredOutcome`: the status is kept and one
notice is owed) and hands every owed notice out once, marked delivered before it is returned
(`takeFailureNotices`, at most `MAX_TRANSACTION_ALERTS_PER_DRAIN` per call), in
`failureNoticeMessage`'s words. Hosts show each as an error toast, as the side panel does. The
constants, the tier and retirement decisions over a status × finality × notice × age matrix,
and the notice copy are in the status and observation fixtures and drift-checked. Status reads use the first
endpoint that proves the chain, not necessarily the one that took the write, as the extension's
observer does.

**Session generation (must-fix: lock is enforced in the core).** The generation is
vault-security's `lock_epoch` (`wallet.rs`), not a second counter: it advances on `lock()`, on
wallet deletion, and whenever a session is installed (unlock, biometric unlock, create/import),
always under the session mutex, so an idle-expired session followed by a fresh unlock is also a
new generation. `prepare_transfer` and `prepare_deployment` record it (a passive read that never
renews the idle window). `Confirm` and every signing point compare
it with the current one under the session lock and, if it moved, return `Failed { Locked }`
and close the plan, even if the same wallet has been unlocked again since. This is the
extension's `captureSessionAuthorization` / `isCurrent`. The host still calls `close()` on lock
as defence in depth.

**Signing inside the core.** At a signing point the core runs `with_session(renew = true)`, which
applies the idle lock first, checks the generation, passes the plan's record through the one
signing gate (`signing_record`: no pending discovery, no view-only record; OpenZeppelin and
Ready, accounts.md §2.7a), derives the key for the record's `account_index` as `kms::sign_hash` does (a per-call
zeroizing `SecretFelt`), checks that the returned public key equals the plan's stored
`public_key`, signs, serialises the signature for the record's family (OZ `[r, s]`; Ready
`[1, 0, public_key, r, s]`), and drops the key.

**Endpoint binding (must-fix: stated as host-enforced).** The core cannot see endpoints, so it
does not claim to. What the core enforces: each plan starts with a `ChainId` step, and the
submit path starts with another; the reply is judged against the plan's `NetworkId` before
anything else is emitted. What the host enforces, and `SendFlowModelTests` tests: every step of
a plan goes to the endpoint that answered its `ChainId`, with no failover mid-plan, and a write
is never retried or sent anywhere else (redirects are refused on write steps).

**Values the core refuses.** `max_amount` above `u64::MAX` or `max_price_per_unit` above
`u128::MAX` after the margin, which Krusty's `ResourceBounds` would otherwise truncate
(`BoundsOutOfRange`); an unknown fee unit; a token not in `networks.json`; an amount ≥ 2^256;
the zero address as recipient or token (`InvalidRecipient`, as `buildErc20TransferCall`'s
"Invalid transfer address" does before any estimate or signing).

**Chain id.** The chain id used in every hash comes from `NetworkId`, never from a node reply.

**What never crosses the FFI.** Private keys, the phrase, the passphrase and the vault key. Also
never crossing into the core: resource bounds as editable input, a raw hash for the plan to
sign, and the nonce as host input. The host sees signed request bodies, which are public on
broadcast, and the resulting hash.

**`WalletCore::sign_hash(index)` is withdrawn** (merge with accounts): plans name their account
by record id, and the only other signer, `sign_hash_for_account`, uses the same gate. Truncation
uses the core's one `account_label` rule; the separate `short_address` export was folded into it.

**Errors.** Every `SendError` and `SendFailureCode` is a fixed variant. None carries a recipient,
an amount, node text or a key. Node error messages are never forwarded.

## 4. Storage and migration

- **Vault.** Unchanged. There is no new secret and the payload shape stays the same, so the
  vault needs no migration.
- **Pending send state.** The plan itself is held in memory only (`TransferPlan`), and a signed
  body is never kept. What is persisted is the **pending activity record** of every write, keyed
  by its signed hash and written atomically *before* the body is handed to the host (§3). Lock
  and scene backgrounding call `plan.close()` (an additive line in `WalletStore.swift`), which
  stops further signing but keeps that record; `refresh_activity` settles it later.
- **Local activity: a new file `activity.v1.json`, next to `vault.json`.** The core owns it; the
  host never reads or writes it directly.
  - **Shape.** The extension's `ActivityEntry` as `{version: 1, scopes: {"<networkId>:<canonical
    address>": [entry…]}}`, where an entry is `{accountId, amount, counterparty, hash, kind:
    "transfer"|"deploy", networkId, status, submittedAt, summary, token}`.
  - **Summaries.** Byte-identical to the extension: `Send ${formatTokenAmount(raw, decimals)}
    ${symbol} to ${shortAddress(canonicalFelt(recipient))}` and "Deploy account contract".
  - **Validation.** Mirrors `isActivityEntry`: summary 1–200 characters; optional fields 1–200;
    hash a Stark felt; at most 200 entries per scope, dropping the oldest; de-duplicated by
    numeric hash equality.
  - **Status.** Moves forward only (pending < preconfirmed < accepted; rejected and reverted are
    terminal). Three consecutive not-found replies make a record `rejected`.
  - **Timestamps.** `submittedAt` is the latest `now_ms` the host passed on a `StepReply` before
    the write was emitted. The core never reads the wall clock.
  - **Protection.** The file holds public on-chain data only. It inherits the directory's
    protection: iOS `FileProtectionType.complete` and excluded from backup; Android
    `noBackupFilesDir`. It is written atomically (write, then rename) with the vault's helper.
    `delete_wallet` removes it (a one-line additive edit).
  - **Failure handling.** A storage failure never changes a send's outcome once the write has
    left, as in the extension. The pending record is written before the write; if that write
    fails the send still proceeds (the extension's `recordSubmittedActivity` is best-effort too),
    and the plan's own checkpoints report the outcome.
  - **Reading.** An unreadable, over-sized or wrong-version file is ignored when read and never
    overwritten blind: the core renames it `activity.v1.corrupt-<n>.json` and starts empty.
  - **Future versions.** `version` is the migration hook; any future shape adds exactly one
    adjacent step, as with the vault.
  - **Coordination.** The portfolio-activity workstream merges its explorer feed onto these
    records by hash. It consumes `WalletCore::activity`, and does not add a second store.

## 5. Threat model

| Threat | Mitigation |
| --- | --- |
| Compromised or buggy host code gets an arbitrary hash signed | The send path signs only inside the plan, over the structured transaction the core built and reviewed. `sign_hash` stays exported in this branch for sibling workstreams; its withdrawal is a vault-security follow-up after merge (§3). |
| Host swaps recipient, amount or token after review | The plan is immutable after `prepare_transfer`. The review, hash and activity summary are all derived from the same stored call. An edit means a new plan. |
| Hostile or faulty node inflates the fee estimate | The reviewed `max_spend` is shown. At submit the re-estimate is refused before signing when it exceeds 3/2 of the reviewed spend. Bounds are range-checked for the u64/u128 types; units are checked. |
| Node lies about deployment status | Only error code 20 or "contract not found" means undeployed. Other errors fail closed. A wrong "undeployed" answer only produces a deploy transaction the chain rejects, because the address is derived locally and must match `deployment_descriptor` (salt 0x0, then publicKeyX). |
| Node returns a different hash, or replays a write | The returned hash must equal the signed hash, and a write reply id must match. Writes are never retried or failed over, so a lost reply is reported as indeterminate. |
| Wrong network, or the host points at a node for another chain | The chain id in every hash comes from `NetworkId`. The core emits a `ChainId` step at the start of each plan and of its submit path and judges it before anything else. Binding every later step (and every write) to the endpoint that answered it is **host-enforced** and tested in `SendFlowModelTests`; the core cannot see endpoints and does not claim to. |
| Nonce reuse or a stale nonce | Confirm re-reads deployment state and the nonce, rebuilds the estimate from them, and reads the nonce once more immediately before the invoke is signed (after an auto-deploy it is read, not assumed). |
| Account deployed elsewhere between review and confirm | Confirm re-reads `ClassHashAt`; a now-deployed account takes the invoke-only path and no deployment is signed. |
| Address poisoning or a clipboard hijack | The core canonicalises the recipient; the review flags a lookalike and blocks confirm (the core refuses again). The full address sits behind a copy button; truncation follows the extension's rule. |
| Response-parsing attacks | Bodies above 64 KiB are refused, and hosts stop reading a reply at that size (`max_rpc_response_bytes`), so an endpoint cannot make the app buffer an unbounded body. Serde parses into fixed shapes, and every felt and limb is range-checked. Unknown fields are ignored and never interpreted. |
| Secrets leaking through errors or logs | Errors are fixed variants. Signed bodies hold only public data. No logging is added. |
| Signed transaction survives a lock | The core records the session generation at prepare and refuses `Confirm` and every signing point once it has moved (lock, unlock, delete), even after re-unlocking. The host also closes plans on lock and backgrounding. |
| Transaction reaches the chain while the app is backgrounded mid-send | The pending record keyed by the signed hash is persisted before the write leaves the core, and `close()` never removes it; status reconciliation settles it (not-found threshold 3 → rejected). The user sees the pending send instead of sending again. |
| Shoulder-surfing or screenshots of review | Only public data is shown. The existing iOS privacy cover and Android `FLAG_SECURE` apply. |
| Unauthorised send from an unlocked, unattended phone | The extension has no per-send re-auth either, so this is parity. The inactivity lock and a per-send presence gate (Face ID / BiometricPrompt) belong to vault-security (Phase 1.3). `Confirm` is the hook where that gate can sit. |
| Accidental mainnet broadcast by tests or agents | The only broadcasting test is opt-in behind `BRAMBLE_MOBILE_MAINNET_SEND_ACK` (§7), refused under `CI`, and never run by agents. The XCUITest stops at Review. |

Sections 6–10 (parity fixtures, test plan, files, Krusty gaps, and the review must-fix
resolutions) continue in [transactions-verification.md](transactions-verification.md).
