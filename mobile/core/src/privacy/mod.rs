//! STRK20 privacy, read-only: the account's scoped viewing key derived inside the core, private
//! balance discovery through the privacy service as a sans-IO plan, and the extension's privacy
//! gates for Home, Receive, token detail and the journey. Nothing is submitted: registration,
//! shielding, private sends and unshielding need an upstream privacy client that Krusty 0.11.0 does
//! not provide (mobile/docs/privacy.md §1, §9), so `privacy_capabilities()` is all false.
//!
//! The viewing key never crosses FFI as a value. It exists only while one discovery body is built
//! (`plan_steps`), and leaves the device only inside that opaque body, for the configured
//! non-OHTTP discovery URL (docs/privacy.md §1.1).

mod bodies;
mod config;
pub(crate) mod gates;
pub(crate) mod home;
mod json;
mod judge;
mod notes;
pub(crate) mod plan;
mod plan_steps;
pub(crate) mod types;
mod wallet_ext;

use gates::Outcome;
use types::{
    PoolNotice, PrivacyBlocker, PrivacyCapabilities, PrivacyEntry, PrivacyReading, PrivacyState,
    PrivacyStatus, PrivateLine, ShieldTile, TokenDetailPrivacy, UnifiedBalance,
};

use crate::networks::NetworkId;
use crate::portfolio::model::TokenBalance;
use crate::send::types::DeploymentState;

/// What mobile can submit today: nothing (docs/privacy.md §9).
pub(crate) const CAPABILITIES: PrivacyCapabilities = PrivacyCapabilities {
    can_register: false,
    can_shield: false,
    can_send_privately: false,
    can_unshield: false,
};

/// Whether `network` has plain (non-OHTTP) privacy routing, so a read plan can exist for it.
#[uniffi::export]
pub fn privacy_configured(network: NetworkId) -> bool {
    config::route_for(network).is_some()
}

/// DEBUG builds only: points `network`'s discovery service at `url` for this process, or with
/// `None` restores the generated URL. The URL must pass the rules the generated routing does
/// (`https`, at most 2048 bytes, no credentials, query, fragment or trailing slash), and the
/// network must already be routed, so an override never re-enables Sepolia or an OHTTP network.
/// A release build of the core refuses every call with `OverrideUnavailable`. Hosts call this
/// only from a DEBUG launch argument or environment variable (mobile/README.md), before any read;
/// a plan already prepared keeps the URL it was prepared with. A refusal changes nothing.
#[uniffi::export]
pub fn set_privacy_discovery_override(
    network: NetworkId,
    url: Option<String>,
) -> Result<(), types::PrivacyError> {
    config::set_override(network, url.as_deref()).map_err(|refusal| match refusal {
        config::OverrideRefusal::ReleaseBuild => types::PrivacyError::OverrideUnavailable,
        config::OverrideRefusal::NotRouted => types::PrivacyError::NotConfigured,
        config::OverrideRefusal::InvalidUrl => types::PrivacyError::InvalidEndpoint,
    })
}

/// The discovery URL a read on `network` would post to now (the generated one, or a DEBUG
/// override); `None` when the network is not routed. Public routing only; carries no key.
#[uniffi::export]
pub fn privacy_discovery_url(network: NetworkId) -> Option<String> {
    config::route_for(network).map(|route| route.discovery_url)
}

/// Which privacy writes mobile supports; every surface branches on these, never on a literal.
#[uniffi::export]
pub fn privacy_capabilities() -> PrivacyCapabilities {
    CAPABILITIES
}

/// Longest `Post` reply the core parses. Hosts stop reading at this many bytes and report a longer
/// reply as a transport failure.
#[uniffi::export]
pub fn max_privacy_response_bytes() -> u64 {
    judge::MAX_RESPONSE_BYTES as u64
}

/// The Home Shield tile. `strk_funded`: the loaded public STRK balance is above zero; `None`
/// while it has not loaded. Only the tile's accessible name depends on it (`FundFirst`).
#[uniffi::export]
pub fn shield_tile(
    network: NetworkId,
    deployment: DeploymentState,
    strk_funded: Option<bool>,
    reading: PrivacyReading,
) -> ShieldTile {
    gates::shield_tile(network, deployment, strk_funded, reading)
}

/// A Home row's private line. A reading from another network is ignored.
#[uniffi::export]
pub fn private_line(
    network: NetworkId,
    deployment: DeploymentState,
    reading: PrivacyReading,
    token_address: String,
    state: Option<PrivacyState>,
) -> PrivateLine {
    gates::private_line(network, deployment, reading, &token_address, state.as_ref())
}

/// Receive's "Public transfers only" notice.
#[uniffi::export]
pub fn receive_pool_notice(
    deployment: DeploymentState,
    strk_funded: Option<bool>,
    reading: PrivacyReading,
) -> PoolNotice {
    gates::receive_pool_notice(deployment, strk_funded, reading)
}

/// Where a privacy entry point leads on mobile. `after_read` is false on the tap and true once the
/// host has run the read a `Discovering` answer asked for. `strk_funded` is the loaded public STRK
/// balance being above zero, `None` while it has not loaded: only a loaded zero turns an
/// undeployed account's `Deploy` blocker into `Fund`. The extension's "Send in Shield mode" and
/// "activation" become the `Unsupported` blocker while the capabilities are false.
#[uniffi::export]
pub fn privacy_entry(
    network: NetworkId,
    deployment: DeploymentState,
    strk_funded: Option<bool>,
    reading: PrivacyReading,
    after_read: bool,
) -> PrivacyEntry {
    match gates::entry_outcome(network, deployment, strk_funded, reading, after_read) {
        Outcome::Blocked(blocker) => PrivacyEntry::Blocked { blocker },
        Outcome::CheckDeployment => PrivacyEntry::CheckDeployment,
        Outcome::Discovering => PrivacyEntry::Discovering,
        // When §9 lands these gain their own variants (open Send in Shield mode, run activation)
        // behind `CAPABILITIES`; until then there is nothing mobile can do but say so.
        Outcome::OpenShield | Outcome::Activate => PrivacyEntry::Blocked {
            blocker: PrivacyBlocker::Unsupported,
        },
    }
}

/// Token detail's private summary and action. A reading from another network is ignored.
#[uniffi::export]
pub fn token_detail_privacy(
    network: NetworkId,
    deployment: DeploymentState,
    reading: PrivacyReading,
    token_address: String,
    state: Option<PrivacyState>,
) -> TokenDetailPrivacy {
    gates::token_detail(network, deployment, reading, &token_address, state.as_ref())
}

/// The header's private-data freshness on Home.
#[uniffi::export]
pub fn privacy_status(network: NetworkId, reading: PrivacyReading) -> PrivacyStatus {
    gates::status(network, reading)
}

/// Whether Home shows "Includes shielded balances".
#[uniffi::export]
pub fn shielded_balances_included(
    reading: PrivacyReading,
    state: Option<PrivacyState>,
    hidden_token_addresses: Vec<String>,
) -> bool {
    home::visible_private(reading, state.as_ref(), &hidden_token_addresses)
        .iter()
        .any(|entry| !entry.balance.trim_start_matches('0').is_empty())
}

/// Home rows with private value summed in, the list the hero total is computed from: the
/// portfolio's visible Home rows (`HomeRows.visible`) with each private balance added by token id.
#[uniffi::export]
pub fn unified_home_balances(
    network: NetworkId,
    visible: Vec<TokenBalance>,
    hidden_token_addresses: Vec<String>,
    reading: PrivacyReading,
    state: Option<PrivacyState>,
) -> Vec<UnifiedBalance> {
    home::unified(
        network,
        &visible,
        &hidden_token_addresses,
        reading,
        state.as_ref(),
    )
}

/// Test-only hooks; not part of the FFI surface, and compiled only for tests.
#[cfg(any(test, feature = "testing"))]
#[doc(hidden)]
pub mod testing {
    /// `compactAmount` (the portfolio's one implementation), for the parity suite.
    pub fn compact_amount(formatted: &str, places: Option<usize>) -> String {
        super::home::compact(formatted, places.map(|p| p as u32))
    }

    /// The extension's journey outcome before mobile's capabilities apply, spelled as the
    /// fixture records it (`open-shield`, `activate`, `blocked:<kind>`, `check`, `discovering`).
    pub fn entry_outcome(
        network: crate::networks::NetworkId,
        deployment: crate::send::types::DeploymentState,
        strk_funded: Option<bool>,
        reading: super::types::PrivacyReading,
        after_read: bool,
    ) -> String {
        use super::gates::Outcome;
        match super::gates::entry_outcome(network, deployment, strk_funded, reading, after_read) {
            Outcome::OpenShield => "open-shield".into(),
            Outcome::Activate => "activate".into(),
            Outcome::CheckDeployment => "check".into(),
            Outcome::Discovering => "discovering".into(),
            Outcome::Blocked(blocker) => {
                format!("blocked:{}", format!("{blocker:?}").to_lowercase())
            }
        }
    }

    /// Parses a routing file as the loader does and says which networks it routes.
    pub fn routed_networks(text: &str) -> Option<Vec<crate::networks::NetworkId>> {
        super::config::parse(text).map(|r| r.routes.iter().map(|route| route.network).collect())
    }
}
