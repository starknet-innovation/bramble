//! The send path's FFI vocabulary. Every error and failure is a fixed variant: none carries a
//! recipient, an amount, node text or key material, so nothing a user typed or a node said can
//! reach a log through an error.

use crate::networks::NetworkId;

/// One ERC-20 transfer as the user entered it. Every field is untrusted and re-validated.
#[derive(Debug, Clone, uniffi::Record)]
pub struct TransferRequest {
    pub network: NetworkId,
    pub account_index: u32,
    /// Must be one of the network's bundled tokens.
    pub token_address: String,
    /// Any spelling `validate_recipient` accepts; canonicalised in the core.
    pub recipient: String,
    /// Decimal text as typed.
    pub amount: String,
    /// STRK base units the host last read for this account, for the shortfall warning only.
    pub fee_balance: Option<String>,
}

/// The unit a fee is quoted in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum FeeUnit {
    Fri,
    Wei,
}

/// A fee as the spend its resource bounds authorise, with its display text.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct FeeAmount {
    /// Base-10 base units.
    pub max_spend: String,
    pub unit: FeeUnit,
    /// The extension's `formatFeeEstimate` text, e.g. "0.008053 STRK".
    pub display: String,
}

/// A reviewable risk the verifier raised.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum ReviewFlag {
    SelfTransfer,
    AddressPoisoning,
}

/// Whether the account's STRK covers the fee (and the amount, when STRK is sent).
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum FeeAffordability {
    Sufficient,
    Insufficient,
    Unknown,
}

/// What a `getClassHashAt` answer says about an account contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum DeploymentState {
    Deployed,
    Undeployed,
    Unknown,
}

/// Everything the review screen shows, derived from the one stored call.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct TransferReview {
    /// The verifier's summary, e.g. "Send 1.5 STRK to 0x3fa7…41a3", or "Deploy account contract".
    pub summary: String,
    pub recipient: String,
    pub recipient_short: String,
    pub amount_display: String,
    pub token_symbol: String,
    pub fee: Option<FeeAmount>,
    pub fee_estimate_failed: bool,
    pub deployment_fee: Option<FeeAmount>,
    pub deployment_fee_estimate_failed: bool,
    pub requires_deployment: bool,
    pub already_deployed: bool,
    pub affordability: FeeAffordability,
    pub flags: Vec<ReviewFlag>,
    pub can_confirm: bool,
}

/// What a JSON-RPC step is for; the host uses it only for progress copy and to refuse redirects
/// on writes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum RpcPurpose {
    ChainId,
    ClassHashAt,
    Nonce,
    EstimateFee,
    EstimateDeploymentFee,
    AddDeployAccount,
    AddInvoke,
    TransactionStatus,
    TransactionReceipt,
}

/// A transaction's chain status as the wallet reports it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum TxStatus {
    Pending,
    Preconfirmed,
    Accepted,
    Rejected,
    Reverted,
}

/// The next thing the host must do for a plan.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum SendStep {
    /// POST `body` to the plan's endpoint and reply with `StepReply::Rpc` (same `id`) or
    /// `StepReply::TransportFailure`. A write is sent exactly once and never redirected.
    Rpc {
        id: u64,
        body: String,
        purpose: RpcPurpose,
        is_write: bool,
    },
    /// Wait, then reply `WaitElapsed`.
    Wait { delay_ms: u32 },
    /// Show `TransferPlan::current_review`; reply `Confirm` or `RetryEstimate`.
    Review,
    /// The node accepted the transaction; reply `Proceed` to confirm it on chain.
    Broadcast { hash: String },
    /// Terminal for now; `CheckAgain` re-runs the checkpoints from `Pending`.
    Finished {
        status: TxStatus,
        hash: String,
        explorer_url: Option<String>,
    },
    /// Terminal. The plan is closed.
    Failed { failure: SendFailure },
}

/// What the host reports back.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum StepReply {
    Start,
    Rpc { id: u64, body: String, now_ms: u64 },
    TransportFailure { id: u64, now_ms: u64 },
    WaitElapsed,
    RetryEstimate,
    Confirm,
    Proceed,
    CheckAgain,
}

/// Why an amount was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum SendAmountError {
    /// "Invalid transfer amount"
    Invalid,
    /// "Too many decimal places"
    TooManyDecimals,
    /// "Transfer amount must be greater than zero"
    NotPositive,
    /// At or above 2^256: no ERC-20 can carry it.
    TooLarge,
}

/// Refusals raised synchronously by the plan API.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error, uniffi::Error)]
pub enum SendError {
    #[error("invalid recipient")]
    InvalidRecipient,
    #[error("invalid amount")]
    InvalidAmount { reason: SendAmountError },
    #[error("unknown token")]
    UnknownToken,
    #[error("wallet is locked")]
    Locked,
    #[error("unknown account")]
    UnknownAccount,
    #[error("reply out of order")]
    OutOfOrder,
    #[error("plan closed")]
    PlanClosed,
    #[error("unknown transaction")]
    UnknownTransaction,
}

/// Why a plan ended without a confirmed transaction. The host maps each code to the extension's
/// copy (`extension-transactions-*.json`, `copy`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum SendFailureCode {
    ReviewedFeeExceeded,
    ReviewedFeeRequired,
    ReviewedDeploymentFeeExceeded,
    ReviewedDeploymentFeeRequired,
    PoisonedRecipient,
    WrongChain,
    PreparationUnavailable,
    HashMismatch,
    SubmissionIndeterminate,
    DeploymentStatusUnknown,
    DeploymentUnconfirmed,
    DeploymentThenInvokeUnconfirmed,
    AutoDeploymentFailed,
    AlreadyDeployed,
    BoundsOutOfRange,
    UnrecognisedFeeUnit,
    NodeError,
    Locked,
    /// Krusty failed to sign, or signed under a key that is not the account's.
    SigningFailed,
}

/// A failure, with the hash of anything already accepted (a deployment, or an ambiguous write).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct SendFailure {
    pub code: SendFailureCode,
    pub hash: Option<String>,
}

/// Kind of a locally recorded transaction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum ActivityKind {
    Transfer,
    Deploy,
}

/// One locally recorded transaction; public on-chain data only.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct ActivityRecord {
    pub hash: String,
    pub kind: ActivityKind,
    pub status: TxStatus,
    pub summary: String,
    pub amount: Option<String>,
    pub counterparty: Option<String>,
    pub token: Option<String>,
    pub submitted_at_ms: u64,
    pub explorer_url: Option<String>,
}
