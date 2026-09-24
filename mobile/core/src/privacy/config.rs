//! STRK20 routing and limits, embedded from `generated/privacy.json`, which
//! `scripts/mobile-assets/privacy.ts` renders from the extension's `DEFAULT_STRK20_NETWORKS`,
//! `STRK20_LIMITS`, `STRK20_WAIT_BUDGETS` and `MAX_SERVICE_ATTEMPTS`.
//!
//! The loader re-checks what the generator promises, independently: a network with OHTTP on
//! (`"ohttp": true`), without a discovery URL or pool, with a non-`https` URL, or with a pool that
//! is not a non-zero felt is **not configured**. Mobile has no OHTTP client, so an OHTTP network is
//! never routed (docs/privacy.md §1.1): the viewing key is never put in a plaintext body for it.

use std::sync::OnceLock;

use serde::Deserialize;
use starknet_types_core::felt::Felt;

use crate::felt;
use crate::networks::NetworkId;

const ROUTING_JSON: &str = include_str!("../../generated/privacy.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawNetwork {
    id: String,
    ohttp: bool,
    discovery_url: Option<String>,
    pool_address: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawLimits {
    balances: usize,
    discovered_notes: usize,
    max_pool_fee: String,
    max_service_attempts: u32,
    tokens: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawWaits {
    discovery_ms: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawRouting {
    limits: RawLimits,
    networks: Vec<RawNetwork>,
    wait_budgets: RawWaits,
}

/// One routed network.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Route {
    pub network: NetworkId,
    /// `https://…`, no trailing slash; the SDK appends `/v1/sync/…`.
    pub discovery_url: String,
    /// As configured (the extension's `starknet_call` sends this spelling).
    pub pool_address: String,
    pub pool: Felt,
}

/// The extension's limits the judges enforce.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Limits {
    pub balances: usize,
    pub discovered_notes: usize,
    pub max_pool_fee: u128,
    pub max_service_attempts: u32,
    pub tokens: usize,
    pub discovery_budget_ms: u64,
}

/// Everything the privacy module reads from the generated file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Routing {
    pub routes: Vec<Route>,
    pub limits: Limits,
}

fn network_for(id: &str) -> Option<NetworkId> {
    match id {
        "SN_MAIN" => Some(NetworkId::Mainnet),
        "SN_SEPOLIA" => Some(NetworkId::Sepolia),
        _ => None,
    }
}

fn is_service_url(url: &str) -> bool {
    url.strip_prefix("https://").is_some_and(|rest| {
        !rest.is_empty()
            && !url.ends_with('/')
            && url.bytes().all(|b| b.is_ascii_graphic())
            && !url.contains(['?', '#', '@', '\\'])
    })
}

fn route(raw: RawNetwork) -> Option<Route> {
    // OHTTP on means the extension never posts the key in plaintext: neither does mobile.
    if raw.ohttp {
        return None;
    }
    let network = network_for(&raw.id)?;
    let discovery_url = raw.discovery_url.filter(|url| is_service_url(url))?;
    let pool_address = raw.pool_address?;
    let pool = felt::parse_non_zero(&pool_address)?;
    Some(Route {
        network,
        discovery_url,
        pool_address,
        pool,
    })
}

/// Parses routing text; `None` when the file is malformed. Networks that fail the rules above are
/// dropped rather than failing the whole file, so they read as not configured.
pub fn parse(text: &str) -> Option<Routing> {
    let raw: RawRouting = serde_json::from_str(text).ok()?;
    let max_pool_fee = raw
        .limits
        .max_pool_fee
        .strip_prefix("0x")
        .and_then(|hex| u128::from_str_radix(hex, 16).ok())?;
    let limits = Limits {
        balances: raw.limits.balances,
        discovered_notes: raw.limits.discovered_notes,
        max_pool_fee,
        max_service_attempts: raw.limits.max_service_attempts.max(1),
        tokens: raw.limits.tokens,
        discovery_budget_ms: raw.wait_budgets.discovery_ms,
    };
    let routes = raw.networks.into_iter().filter_map(route).collect();
    Some(Routing { routes, limits })
}

/// The embedded routing, validated once.
pub fn routing() -> &'static Routing {
    static ROUTING: OnceLock<Routing> = OnceLock::new();
    ROUTING.get_or_init(|| parse(ROUTING_JSON).expect("bundled privacy routing parses"))
}

/// The route for a network, if it is configured.
pub fn route_for(network: NetworkId) -> Option<&'static Route> {
    routing()
        .routes
        .iter()
        .find(|route| route.network == network)
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIMITS: &str = r#""limits":{"balances":64,"discoveredNotes":4096,"maxPoolFee":"0xffffffffffffffffffffffffffffffff","maxServiceAttempts":3,"tokens":64},"waitBudgets":{"discoveryMs":60000}"#;

    fn with_networks(networks: &str) -> Routing {
        parse(&format!(
            r#"{{"generatedBy":"t",{LIMITS},"networks":[{networks}]}}"#
        ))
        .unwrap()
    }

    #[test]
    fn bundled_routing_serves_mainnet_only() {
        assert!(route_for(NetworkId::Mainnet).is_some());
        assert!(route_for(NetworkId::Sepolia).is_none());
        let limits = &routing().limits;
        assert_eq!(limits.max_pool_fee, u128::MAX);
        assert_eq!(limits.discovery_budget_ms, 60_000);
        assert_eq!(limits.max_service_attempts, 3);
    }

    #[test]
    fn an_ohttp_network_is_never_routed() {
        let pool = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
        let plain = with_networks(&format!(
            r#"{{"id":"SN_MAIN","ohttp":false,"discoveryUrl":"https://d.example/discovery","poolAddress":"{pool}"}}"#
        ));
        assert_eq!(plain.routes.len(), 1);
        // Even if a generator regression left the URL in place, `ohttp: true` refuses it.
        let ohttp = with_networks(&format!(
            r#"{{"id":"SN_MAIN","ohttp":true,"discoveryUrl":"https://d.example/discovery","poolAddress":"{pool}"}}"#
        ));
        assert!(ohttp.routes.is_empty());
        assert!(with_networks(r#"{"id":"SN_MAIN","ohttp":true}"#)
            .routes
            .is_empty());
    }

    #[test]
    fn unsafe_routes_are_not_configured() {
        for url in [
            "http://d.example",
            "https://",
            "https://d.example/",
            "https://u@d.example",
            "https://d.example?x=1",
        ] {
            let routing = with_networks(&format!(
                r#"{{"id":"SN_MAIN","ohttp":false,"discoveryUrl":"{url}","poolAddress":"0x1"}}"#
            ));
            assert!(routing.routes.is_empty(), "{url}");
        }
        let zero_pool = with_networks(
            r#"{"id":"SN_MAIN","ohttp":false,"discoveryUrl":"https://d.example","poolAddress":"0x0"}"#,
        );
        assert!(zero_pool.routes.is_empty());
    }
}
