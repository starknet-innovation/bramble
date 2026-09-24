//! The privacy FFI vocabulary. Every failure is a fixed variant: none carries service text, a
//! note, a cursor or key material. The one field that may hold the viewing key is the opaque
//! `PrivacyStep::Post::body`, and its `Debug` is redacted.

use std::fmt;

use crate::networks::NetworkId;
use crate::portfolio::model::TokenBalance;

/// Whether the account has a viewing key registered with the pool.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum PrivacyRegistration {
    Registered,
    Unregistered,
}

/// One bundled token's private total.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
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
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Record)]
pub struct PrivacyCapabilities {
    pub can_register: bool,
    pub can_shield: bool,
    pub can_send_privately: bool,
    pub can_unshield: bool,
}

/// What a step is for; progress copy only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
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

/// What the host reports back. Every reply carries the host clock; the core never reads one.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
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

/// The extension's `PrivacyDisclosureState`, reduced to what the gates read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
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

/// The Home Shield tile (`wallet-shell.ts` `shieldTile`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum ShieldTile {
    NoStrkToken,
    FundFirst,
    DeployAndEnable,
    Activate,
    Ready,
}

/// A token row's private line (`token-row.ts` `privateBreakdownLine`).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum PrivateLine {
    Unavailable,
    FundWithStrk,
    DeployAndEnable,
    Discovering,
    RegisterToStart,
    /// `compactAmount(formatted, 2)` and the symbol.
    Amount {
        text: String,
    },
}

/// Receive's privacy-pool notice (`receive-view.ts` `privacyPoolNotice`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum PoolNotice {
    Hidden,
    FundFirst,
    DeployFirst,
    Register,
}

/// The extension's blocker vocabulary plus mobile's `Unsupported`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
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
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum DetailSummary {
    None,
    Retry,
    Amount { text: String },
    RegisterToStart,
}

/// Token detail's privacy action (`token-flows.ts` `privacyActions`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum DetailAction {
    None,
    FundWithStrk,
    DeployAndEnable,
    ShieldUnshield,
    GoPrivate,
}

/// Both halves of token detail's privacy section.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct TokenDetailPrivacy {
    pub summary: DetailSummary,
    pub action: DetailAction,
}

/// The header's private-data freshness (`network-status.ts` `privacyDataIssue`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum PrivacyStatus {
    Current,
    Refreshing,
    Unavailable,
}

/// One Home row with public and private summed (`home-tabs.ts` `unifiedHomeBalances`): the
/// portfolio's `TokenBalance` with its balance and formatted text covering both halves.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct UnifiedBalance {
    /// The row: the portfolio's token config, balance (base units) and `formatTokenAmount` of the sum.
    pub balance: TokenBalance,
    /// The public half as the breakdown shows it, `compactAmount(public, 2)`.
    pub public_compact: String,
    /// True when the token holds only a private balance (appended by the extension).
    pub private_only: bool,
}
