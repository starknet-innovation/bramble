//! STRK20 routing and limits, embedded from `generated/privacy.json`, which
//! `scripts/mobile-assets/privacy.ts` renders from the extension's `DEFAULT_STRK20_NETWORKS`,
//! `STRK20_LIMITS`, `STRK20_WAIT_BUDGETS` and `MAX_SERVICE_ATTEMPTS`.
//!
//! The loader re-checks what the generator promises, independently: a network with OHTTP on
//! (`"ohttp": true`), without a discovery URL or pool, with a non-`https` URL, or with a pool that
//! is not a non-zero felt is **not configured**. Mobile has no OHTTP client, so an OHTTP network is
//! never routed (docs/privacy.md §1.1): the viewing key is never put in a plaintext body for it.
//!
//! A debug build of the core may replace a routed network's discovery URL (`set_override`), so a
//! developer can point the app or the tests at their own service. The override passes the same
//! URL rules as the generated file, applies only to a network that is already routed (so it never
//! re-enables an OHTTP network), and is refused outright by a release build.

use std::sync::{OnceLock, RwLock};

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

/// The extension's bound on a service URL (`isServiceUrl` in `@bramble/core/service-url`).
pub const MAX_SERVICE_URL_BYTES: usize = 2048;

fn is_service_url(url: &str) -> bool {
    url.len() <= MAX_SERVICE_URL_BYTES
        && url.strip_prefix("https://").is_some_and(|rest| {
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

fn overrides() -> &'static RwLock<Vec<(NetworkId, String)>> {
    static OVERRIDES: OnceLock<RwLock<Vec<(NetworkId, String)>>> = OnceLock::new();
    OVERRIDES.get_or_init(|| RwLock::new(Vec::new()))
}

/// Why an override was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OverrideRefusal {
    /// A release build never takes one.
    ReleaseBuild,
    /// The network has no plain routing (Sepolia, or OHTTP on); an override cannot add one.
    NotRouted,
    /// The URL fails the configured-URL rules: `https`, at most 2048 bytes, no credentials,
    /// query, fragment, backslash, whitespace or trailing slash.
    InvalidUrl,
}

/// Checks an override against the configured-URL rules and the network's routing, without
/// storing it. Pure, so the rules are testable without touching the process-wide override.
pub fn check_override(
    routing: &Routing,
    network: NetworkId,
    url: &str,
) -> Result<(), OverrideRefusal> {
    if !routing.routes.iter().any(|route| route.network == network) {
        return Err(OverrideRefusal::NotRouted);
    }
    if !is_service_url(url) {
        return Err(OverrideRefusal::InvalidUrl);
    }
    Ok(())
}

/// Replaces (or with `None`, restores) a routed network's discovery URL for this process.
/// Debug builds only; every refusal leaves the current routing unchanged.
pub fn set_override(network: NetworkId, url: Option<&str>) -> Result<(), OverrideRefusal> {
    if !cfg!(debug_assertions) {
        return Err(OverrideRefusal::ReleaseBuild);
    }
    if let Some(url) = url {
        check_override(routing(), network, url)?;
    }
    let mut table = overrides()
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    table.retain(|(id, _)| *id != network);
    if let Some(url) = url {
        table.push((network, url.to_owned()));
    }
    Ok(())
}

/// The route for a network, if it is configured, with any debug override of its discovery URL.
pub fn route_for(network: NetworkId) -> Option<Route> {
    let mut route = routing()
        .routes
        .iter()
        .find(|route| route.network == network)?
        .clone();
    let table = overrides()
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some((_, url)) = table.iter().find(|(id, _)| *id == network) {
        route.discovery_url.clone_from(url);
    }
    Some(route)
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
        let long = format!("https://d.example/{}", "a".repeat(MAX_SERVICE_URL_BYTES));
        let routing = with_networks(&format!(
            r#"{{"id":"SN_MAIN","ohttp":false,"discoveryUrl":"{long}","poolAddress":"0x1"}}"#
        ));
        assert!(
            routing.routes.is_empty(),
            "an over-long URL is not configured"
        );
        let zero_pool = with_networks(
            r#"{"id":"SN_MAIN","ohttp":false,"discoveryUrl":"https://d.example","poolAddress":"0x0"}"#,
        );
        assert!(zero_pool.routes.is_empty());
    }

    #[test]
    fn an_override_passes_the_configured_url_rules() {
        let routing = routing();
        assert_eq!(
            check_override(
                routing,
                NetworkId::Mainnet,
                "https://privacy.example.org/discovery"
            ),
            Ok(())
        );
        for url in [
            "http://privacy.example.org/discovery",
            "https://user:secret@privacy.example.org/discovery",
            "https://token@privacy.example.org",
            "https://privacy.example.org/discovery/",
            "https://privacy.example.org/discovery?key=1",
            "https://privacy.example.org/dis covery",
            "https://",
        ] {
            assert_eq!(
                check_override(routing, NetworkId::Mainnet, url),
                Err(OverrideRefusal::InvalidUrl),
                "{url}"
            );
        }
        let long = format!(
            "https://privacy.example.org/{}",
            "a".repeat(MAX_SERVICE_URL_BYTES)
        );
        assert_eq!(
            check_override(routing, NetworkId::Mainnet, &long),
            Err(OverrideRefusal::InvalidUrl)
        );
    }

    #[test]
    fn an_override_never_routes_an_unrouted_or_ohttp_network() {
        assert_eq!(
            check_override(routing(), NetworkId::Sepolia, "https://privacy.example.org"),
            Err(OverrideRefusal::NotRouted)
        );
        let pool = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
        let ohttp = with_networks(&format!(
            r#"{{"id":"SN_MAIN","ohttp":true,"discoveryUrl":"https://d.example/discovery","poolAddress":"{pool}"}}"#
        ));
        assert_eq!(
            check_override(&ohttp, NetworkId::Mainnet, "https://privacy.example.org"),
            Err(OverrideRefusal::NotRouted)
        );
        // A refused override stores nothing: the bundled URL is still the one served.
        assert!(set_override(NetworkId::Mainnet, Some("http://privacy.example.org")).is_err());
        assert!(set_override(NetworkId::Sepolia, Some("https://privacy.example.org")).is_err());
        assert_eq!(
            route_for(NetworkId::Mainnet).unwrap().discovery_url,
            routing().routes[0].discovery_url
        );
        assert!(route_for(NetworkId::Sepolia).is_none());
    }
}
