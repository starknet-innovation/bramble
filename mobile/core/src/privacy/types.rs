//! The privacy FFI vocabulary. The types are `wallet_core::privacy::types`'s, exported here
//! through `#[uniffi::remote]` with the shapes and docs mobile's bindings already have; only the
//! step (whose body crosses FFI as plain bytes) and the plan-API errors are mobile's. Every failure
//! is a fixed variant: none carries service text, a note, a cursor or key material. The one field
//! that may hold the viewing key is the opaque `PrivacyStep::Post::body`, and its `Debug` is
//! redacted.

use std::fmt;

pub use wallet_core::privacy::types::{
    DetailAction, DetailSummary, PoolNotice, PrivacyBlocker, PrivacyCapabilities, PrivacyEntry,
    PrivacyFailure, PrivacyPurpose, PrivacyReading, PrivacyRegistration, PrivacyReply,
    PrivacyState, PrivacyStatus, PrivateBalance, PrivateLine, ShieldTile, TokenDetailPrivacy,
    UnifiedBalance,
};

use crate::networks::NetworkId;
use crate::portfolio::model::TokenBalance;

/// Whether the account has a viewing key registered with the pool.
#[uniffi::remote(Enum)]
pub enum PrivacyRegistration {
    Registered,
    Unregistered,
}

/// One bundled token's private total.
#[uniffi::remote(Record)]
pub struct PrivateBalance {
    pub token_address: String,
    pub symbol: String,
    pub decimals: u8,
    /// Base units, decimal text.
    pub balance: String,
    /// The extension's `formatTokenAmount` (full precision).
    pub formatted: String,
}

/// A settled private-balance reading for one account on one network.
#[uniffi::remote(Record)]
pub struct PrivacyState {
    pub network: NetworkId,
    /// The vault record id the reading belongs to (never an account index).
    pub account_id: String,
    pub registration: PrivacyRegistration,
    /// Every bundled token in catalog order while registered; empty otherwise.
    pub balances: Vec<PrivateBalance>,
    /// Canonical `0x` hex, `0 <= fee < 2^128`.
    pub pool_fee_fri: String,
    /// Public; for a future review's technical details.
    pub pool_address: String,
}

/// What mobile can submit. All false until an upstream privacy client exists (docs/privacy.md §9).
#[uniffi::remote(Record)]
pub struct PrivacyCapabilities {
    pub can_register: bool,
    pub can_shield: bool,
    pub can_send_privately: bool,
    pub can_unshield: bool,
}

/// What a step is for; progress copy only.
#[uniffi::remote(Enum)]
pub enum PrivacyPurpose {
    ChainId,
    PreflightCheck,
    IncomingState,
    PoolFee,
}

/// The next thing the host must do for a read plan.
#[derive(Clone, PartialEq, Eq, uniffi::Enum)]
pub enum PrivacyStep {
    /// POST `body` to `url` with `Content-Type: application/json`; no redirects, no cache, read at
    /// most `max_privacy_response_bytes()`; reply `Http` (same id) or `TransportFailure`.
    /// `body` MAY CONTAIN THE VIEWING KEY: never log, persist, display or inspect it.
    Post {
        id: u64,
        url: String,
        body: Vec<u8>,
        purpose: PrivacyPurpose,
    },
    /// JSON-RPC to the network's chain-proven endpoint (public data only).
    Rpc {
        id: u64,
        body: String,
        purpose: PrivacyPurpose,
    },
    /// Sleep, then reply `WaitElapsed`.
    Wait { delay_ms: u32 },
    /// Terminal. The plan is closed.
    Finished { state: PrivacyState },
    /// Terminal. The plan is closed.
    Failed { failure: PrivacyFailure },
}

impl fmt::Debug for PrivacyStep {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Post {
                id,
                url,
                body,
                purpose,
            } => f
                .debug_struct("Post")
                .field("id", id)
                .field("url", url)
                .field("body", &format_args!("[redacted {} bytes]", body.len()))
                .field("purpose", purpose)
                .finish(),
            Self::Rpc { id, body, purpose } => f
                .debug_struct("Rpc")
                .field("id", id)
                .field("body", body)
                .field("purpose", purpose)
                .finish(),
            Self::Wait { delay_ms } => f.debug_struct("Wait").field("delay_ms", delay_ms).finish(),
            Self::Finished { state } => f.debug_struct("Finished").field("state", state).finish(),
            Self::Failed { failure } => f.debug_struct("Failed").field("failure", failure).finish(),
        }
    }
}

impl From<wallet_core::privacy::types::PrivacyStep> for PrivacyStep {
    /// The one copy of a discovery body out of the core's zeroizing buffer, which is wiped when
    /// the core's step drops here: the FFI body is plain bytes the host owns.
    fn from(step: wallet_core::privacy::types::PrivacyStep) -> Self {
        use wallet_core::privacy::types::PrivacyStep as Core;
        match step {
            Core::Post {
                id,
                url,
                body,
                purpose,
            } => Self::Post {
                id,
                url,
                body: body.to_vec(),
                purpose,
            },
            Core::Rpc { id, body, purpose } => Self::Rpc { id, body, purpose },
            Core::Wait { delay_ms } => Self::Wait { delay_ms },
            Core::Finished { state } => Self::Finished { state },
            Core::Failed { failure } => Self::Failed { failure },
        }
    }
}

/// What the host reports back. Every reply carries the host clock; the core never reads one.
#[uniffi::remote(Enum)]
pub enum PrivacyReply {
    Start {
        now_ms: u64,
    },
    Http {
        id: u64,
        status: u16,
        body: Vec<u8>,
        now_ms: u64,
    },
    Rpc {
        id: u64,
        body: String,
        now_ms: u64,
    },
    TransportFailure {
        id: u64,
        now_ms: u64,
    },
    WaitElapsed {
        now_ms: u64,
    },
}

/// Why a read ended without a state. The UI shows each as "Unavailable" with "Try again".
#[uniffi::remote(Enum)]
pub enum PrivacyFailure {
    NotConfigured,
    WrongChain,
    RpcUnavailable,
    ServiceUnavailable,
    RateLimited,
    Reorg,
    BudgetExceeded,
    InvalidResponse,
    PoolReadFailed,
    Locked,
}

/// Refusals raised synchronously by the plan API.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error, uniffi::Error)]
pub enum PrivacyError {
    #[error("wallet is locked")]
    Locked,
    #[error("unknown account")]
    UnknownAccount,
    #[error("privacy is not configured for this network")]
    NotConfigured,
    #[error("reply out of order")]
    OutOfOrder,
    #[error("plan closed")]
    PlanClosed,
    /// A discovery override that fails the configured-URL rules.
    #[error("privacy endpoint refused")]
    InvalidEndpoint,
    /// A release build of the core never takes a discovery override.
    #[error("privacy endpoint overrides are debug-only")]
    OverrideUnavailable,
}

impl From<wallet_core::privacy::types::PrivacyError> for PrivacyError {
    fn from(error: wallet_core::privacy::types::PrivacyError) -> Self {
        use wallet_core::privacy::types::PrivacyError as Core;
        match error {
            Core::NotConfigured => Self::NotConfigured,
            Core::OutOfOrder => Self::OutOfOrder,
            Core::PlanClosed => Self::PlanClosed,
        }
    }
}

/// The extension's `PrivacyDisclosureState`, reduced to what the gates read.
#[uniffi::remote(Enum)]
pub enum PrivacyReading {
    /// Not read yet (the extension's `value === null`, not loading, no error).
    Idle,
    Loading,
    /// The read failed (a service error).
    Failed,
    /// No routing for this network (the extension's `network` blocker, reported as an error).
    Unconfigured,
    Settled {
        registration: PrivacyRegistration,
    },
}

/// The Home Shield tile (`wallet-shell.ts` `shieldTile`). Every enabled variant is labelled
/// "Shield"; the variant picks the accessible name, which carries the reason the label does not
/// spell out, and the destination.
#[uniffi::remote(Enum)]
pub enum ShieldTile {
    /// Disabled: no STRK token is tracked on this network.
    NoStrkToken,
    /// Undeployed and the loaded STRK balance is zero. Opens the privacy journey, which raises
    /// the `Fund` blocker.
    FundFirst,
    /// Undeployed (STRK funded or not yet loaded). Opens the privacy journey, which raises the
    /// `Deploy` blocker.
    DeployFirst,
    /// Deployed or deployment unknown, and not read as registered. Opens the privacy journey.
    Activate,
    /// Registered and deployed. Opens Send in Shield mode (public to private).
    Ready,
}

/// A token row's private line (`token-row.ts` `privateBreakdownLine`).
#[uniffi::remote(Enum)]
pub enum PrivateLine {
    Unavailable,
    /// Undeployed, funded or not: a "Shield" control that opens the privacy journey, which names
    /// the prerequisite in the way (deploy or fund).
    Shield,
    Discovering,
    /// A control that opens the privacy journey.
    RegisterToStart,
    /// `compactAmount(formatted, 2)` and the symbol.
    Amount {
        text: String,
    },
}

/// Receive's privacy-pool notice (`receive-view.ts` `privacyPoolNotice`).
#[uniffi::remote(Enum)]
pub enum PoolNotice {
    Hidden,
    FundFirst,
    DeployFirst,
    Register,
}

/// The extension's blocker vocabulary plus mobile's `Unsupported`.
#[uniffi::remote(Enum)]
pub enum PrivacyBlocker {
    Deploy,
    Fund,
    Ledger,
    Network,
    Pending,
    Service,
    Unsupported,
}

/// Where a privacy entry point leads (`privacy-ui.ts` `startJourney`).
#[uniffi::remote(Enum)]
pub enum PrivacyEntry {
    Blocked {
        blocker: PrivacyBlocker,
    },
    /// Read the deployment, then ask again (a failed read is the `service` blocker).
    CheckDeployment,
    /// Show the preparing screen until the reading settles, then ask again.
    Discovering,
}

/// Token detail's private summary line.
#[uniffi::remote(Enum)]
pub enum DetailSummary {
    None,
    Retry,
    Amount { text: String },
    RegisterToStart,
}

/// Token detail's privacy action (`token-flows.ts` `privacyActions`).
#[uniffi::remote(Enum)]
pub enum DetailAction {
    None,
    /// Undeployed, funded or not: one "Shield" control that opens the privacy journey, which
    /// names the prerequisite in the way (deploy or fund).
    Shield,
    /// Registered: "Shield" and "Unshield", each opening Send in its privacy mode.
    ShieldUnshield,
    /// Deployed and read as unregistered: one "Shield" (`detailShieldFirst`). The extension's
    /// first shield registers in the same transaction (789) and opens Send; mobile cannot shield
    /// yet, so hosts show it disabled with the Unsupported note, as for `ShieldUnshield`.
    ShieldFirst,
    /// Deployment unknown, or a reading not yet settled: "Go private" (`detailGoPrivate`),
    /// opening the privacy journey.
    GoPrivate,
}

/// Both halves of token detail's privacy section.
#[uniffi::remote(Record)]
pub struct TokenDetailPrivacy {
    pub summary: DetailSummary,
    pub action: DetailAction,
}

/// The header's private-data freshness (`network-status.ts` `privacyDataIssue`).
#[uniffi::remote(Enum)]
pub enum PrivacyStatus {
    Current,
    Refreshing,
    Unavailable,
}

/// One Home row with public and private summed (`home-tabs.ts` `unifiedHomeBalances`): the
/// portfolio's `TokenBalance` with its balance and formatted text covering both halves.
#[uniffi::remote(Record)]
pub struct UnifiedBalance {
    /// The row: the portfolio's token config, balance (base units) and `formatTokenAmount` of the sum.
    pub balance: TokenBalance,
    /// The public half as the breakdown shows it, `compactAmount(public, 2)`.
    pub public_compact: String,
    /// True when the token holds only a private balance (appended by the extension).
    pub private_only: bool,
}
