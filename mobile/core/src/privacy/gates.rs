//! Privacy gates: pure functions over public facts. Each first computes the extension's own
//! outcome (pinned by `extension-privacy-rules.json` `gates`), then `privacy_entry` applies mobile's
//! capabilities, which turn "Send in Shield mode" and "activation" into the `Unsupported` blocker.
//!
//! Sources: `wallet-shell.ts` `shieldTile`, `home-tabs.ts` `privateBreakdownFor`, `receive-view.ts`
//! `privacyPoolNotice` + `flows.ts` `poolNoticeAction`, `token-flows.ts` `tokenDetailFlow` +
//! `privacyActions`, `privacy-ui.ts` `startJourney`/`continueJourney`, `network-status.ts`
//! `privacyDataIssue`, and `privacy-model.ts` `deploymentKnownFromPrivacy`.

use super::config;
use super::home::{compact_amount, PORTFOLIO_FRACTION_PLACES};
use super::types::{
    DetailAction, DetailSummary, PoolNotice, PrivacyBlocker, PrivacyReading, PrivacyRegistration,
    PrivacyState, PrivacyStatus, PrivateLine, ShieldTile, TokenDetailPrivacy,
};
use crate::felt;
use crate::networks::{self, NetworkId};
use crate::send::types::DeploymentState;

/// The extension's journey outcome before mobile's capabilities are applied.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Blocked(PrivacyBlocker),
    CheckDeployment,
    Discovering,
    /// `openBucketSend(public → private)`.
    OpenShield,
    /// `runActivation`.
    Activate,
}

/// The reading, with an unrouted network always read as the extension's `network` refusal.
pub fn effective(network: NetworkId, reading: PrivacyReading) -> PrivacyReading {
    if config::route_for(network).is_none() {
        PrivacyReading::Unconfigured
    } else {
        reading
    }
}

fn registered(reading: PrivacyReading) -> bool {
    reading
        == PrivacyReading::Settled {
            registration: PrivacyRegistration::Registered,
        }
}

fn is_error(reading: PrivacyReading) -> bool {
    matches!(
        reading,
        PrivacyReading::Failed | PrivacyReading::Unconfigured
    )
}

fn settled(reading: PrivacyReading) -> bool {
    matches!(reading, PrivacyReading::Settled { .. })
}

/// `deploymentKnownFromPrivacy`: a registered reading implies a deployed account.
fn deployed(deployment: DeploymentState, reading: PrivacyReading) -> Option<bool> {
    if registered(reading) {
        return Some(true);
    }
    match deployment {
        DeploymentState::Deployed => Some(true),
        DeploymentState::Undeployed => Some(false),
        DeploymentState::Unknown => None,
    }
}

fn symbol_of(network: NetworkId, token_address: &str) -> String {
    let wanted = felt::parse(token_address);
    networks::info(network)
        .tokens
        .iter()
        .find(|t| wanted.is_some() && felt::parse(&t.address) == wanted)
        .map(|t| t.symbol.clone())
        .unwrap_or_else(|| "Token".into())
}

/// The extension's scope guard: a reading taken on another network never feeds this network's
/// rows (ETH and STRK share addresses on Mainnet and Sepolia, so an address match is not enough).
/// The host also resets the reading synchronously on a network or account switch.
pub fn in_scope(network: NetworkId, state: Option<&PrivacyState>) -> Option<&PrivacyState> {
    state.filter(|state| state.network == network)
}

fn private_formatted(state: Option<&PrivacyState>, token_address: &str) -> String {
    let wanted = felt::parse(token_address);
    state
        .and_then(|state| {
            state
                .balances
                .iter()
                .find(|entry| wanted.is_some() && felt::parse(&entry.token_address) == wanted)
        })
        .map(|entry| entry.formatted.clone())
        .unwrap_or_else(|| "0".into())
}

/// `shieldTile(strkTokenId, privateReady, deploymentKnownFromPrivacy(...), fundedForFees)`.
pub fn shield_tile(
    network: NetworkId,
    deployment: DeploymentState,
    strk_funded: Option<bool>,
    reading: PrivacyReading,
) -> ShieldTile {
    let reading = effective(network, reading);
    if !networks::info(network)
        .tokens
        .iter()
        .any(|t| t.symbol == "STRK")
    {
        return ShieldTile::NoStrkToken;
    }
    let needs_deploy = deployed(deployment, reading) == Some(false);
    if needs_deploy && strk_funded == Some(false) {
        ShieldTile::FundFirst
    } else if registered(reading) && !needs_deploy {
        ShieldTile::Ready
    } else if needs_deploy {
        ShieldTile::DeployAndEnable
    } else {
        ShieldTile::Activate
    }
}

/// `privateBreakdownFor` → `privateBreakdownLine`.
pub fn private_line(
    network: NetworkId,
    deployment: DeploymentState,
    strk_funded: Option<bool>,
    reading: PrivacyReading,
    token_address: &str,
    state: Option<&PrivacyState>,
) -> PrivateLine {
    let reading = effective(network, reading);
    let state = in_scope(network, state);
    if reading == PrivacyReading::Unconfigured {
        return PrivateLine::Unavailable;
    }
    if deployed(deployment, reading) == Some(false) {
        return if strk_funded == Some(false) {
            PrivateLine::FundWithStrk
        } else {
            PrivateLine::DeployAndEnable
        };
    }
    match reading {
        PrivacyReading::Failed | PrivacyReading::Unconfigured => PrivateLine::Unavailable,
        PrivacyReading::Idle | PrivacyReading::Loading => PrivateLine::Discovering,
        PrivacyReading::Settled {
            registration: PrivacyRegistration::Unregistered,
        } => PrivateLine::RegisterToStart,
        PrivacyReading::Settled { .. } => PrivateLine::Amount {
            text: format!(
                "{} {}",
                compact_amount(
                    &private_formatted(state, token_address),
                    Some(PORTFOLIO_FRACTION_PLACES)
                ),
                symbol_of(network, token_address)
            ),
        },
    }
}

/// `privacyPoolNotice(privacy, poolNoticeAction(...))`; unknown balances count as unfunded.
pub fn receive_pool_notice(
    deployment: DeploymentState,
    strk_funded: Option<bool>,
    reading: PrivacyReading,
) -> PoolNotice {
    if reading
        != (PrivacyReading::Settled {
            registration: PrivacyRegistration::Unregistered,
        })
    {
        return PoolNotice::Hidden;
    }
    if strk_funded != Some(true) {
        PoolNotice::FundFirst
    } else if deployment == DeploymentState::Undeployed {
        PoolNotice::DeployFirst
    } else {
        PoolNotice::Register
    }
}

/// The extension's `startJourney` / `continueJourney` decision. `after_read` is false on the tap
/// and true once the host has run (or joined) the read the journey waits for.
pub fn entry_outcome(
    network: NetworkId,
    deployment: DeploymentState,
    reading: PrivacyReading,
    after_read: bool,
) -> Outcome {
    let reading = effective(network, reading);
    if reading == PrivacyReading::Unconfigured {
        return Outcome::Blocked(PrivacyBlocker::Network);
    }
    if deployment == DeploymentState::Unknown {
        return Outcome::CheckDeployment;
    }
    if deployed(deployment, reading) == Some(false) {
        let waiting = matches!(reading, PrivacyReading::Idle | PrivacyReading::Loading);
        return if waiting && !after_read {
            Outcome::Discovering
        } else {
            Outcome::Blocked(PrivacyBlocker::Deploy)
        };
    }
    match reading {
        PrivacyReading::Settled {
            registration: PrivacyRegistration::Registered,
        } => Outcome::OpenShield,
        PrivacyReading::Settled { .. } => Outcome::Activate,
        // Not current: the journey (re)reads before deciding, then explains what it found.
        _ if !after_read => Outcome::Discovering,
        _ => Outcome::Blocked(PrivacyBlocker::Service),
    }
}

/// `tokenDetailFlow`'s private summary and `privacyActions`.
pub fn token_detail(
    network: NetworkId,
    deployment: DeploymentState,
    strk_funded: Option<bool>,
    reading: PrivacyReading,
    token_address: &str,
    state: Option<&PrivacyState>,
) -> TokenDetailPrivacy {
    let reading = effective(network, reading);
    let state = in_scope(network, state);
    let seen = deployed(deployment, reading);
    let summary = if is_error(reading) && deployment != DeploymentState::Undeployed {
        DetailSummary::Retry
    } else if seen != Some(false) && registered(reading) {
        DetailSummary::Amount {
            text: format!(
                "{} {}",
                compact_amount(&private_formatted(state, token_address), None),
                symbol_of(network, token_address)
            ),
        }
    } else if settled(reading) {
        DetailSummary::RegisterToStart
    } else {
        DetailSummary::None
    };
    let action = if reading == PrivacyReading::Unconfigured {
        DetailAction::None
    } else if seen == Some(false) && strk_funded == Some(false) {
        DetailAction::FundWithStrk
    } else if seen == Some(false) {
        DetailAction::DeployAndEnable
    } else if is_error(reading) {
        DetailAction::None
    } else if registered(reading) {
        DetailAction::ShieldUnshield
    } else {
        DetailAction::GoPrivate
    };
    TokenDetailPrivacy { summary, action }
}

/// `privacyDataIssue` for the active account on Home.
pub fn status(network: NetworkId, reading: PrivacyReading) -> PrivacyStatus {
    match effective(network, reading) {
        PrivacyReading::Failed | PrivacyReading::Unconfigured => PrivacyStatus::Unavailable,
        PrivacyReading::Idle | PrivacyReading::Loading => PrivacyStatus::Refreshing,
        PrivacyReading::Settled { .. } => PrivacyStatus::Current,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LOADING: PrivacyReading = PrivacyReading::Loading;
    const REGISTERED: PrivacyReading = PrivacyReading::Settled {
        registration: PrivacyRegistration::Registered,
    };

    #[test]
    fn sepolia_is_always_the_network_refusal() {
        let s = NetworkId::Sepolia;
        assert_eq!(
            entry_outcome(s, DeploymentState::Deployed, REGISTERED, false),
            Outcome::Blocked(PrivacyBlocker::Network)
        );
        assert_eq!(status(s, REGISTERED), PrivacyStatus::Unavailable);
        assert_eq!(
            token_detail(s, DeploymentState::Deployed, None, LOADING, "0x1", None).action,
            DetailAction::None
        );
    }

    #[test]
    fn registration_implies_deployment() {
        let m = NetworkId::Mainnet;
        assert_eq!(
            shield_tile(m, DeploymentState::Undeployed, Some(false), REGISTERED),
            ShieldTile::Ready
        );
        assert_eq!(
            shield_tile(m, DeploymentState::Undeployed, Some(false), LOADING),
            ShieldTile::FundFirst
        );
        assert_eq!(
            shield_tile(m, DeploymentState::Undeployed, None, LOADING),
            ShieldTile::DeployAndEnable
        );
    }
}
