//! Bundled networks and tokens, embedded from `generated/networks.json`, which
//! `scripts/generate-mobile-assets.ts` renders from `wallet-model/networks`. There is no second
//! hand-written copy of a chain id, RPC endpoint, or token address anywhere in the mobile tree.

use std::sync::OnceLock;

use serde::Deserialize;
pub use wallet_core::catalog::{
    Catalogs, NetworkInfo, RegistryToken, TokenAlias, TokenInfo, TokenRegistry,
};
pub use wallet_core::NetworkId;

use crate::felt;

const CATALOG_JSON: &str = include_str!("../generated/networks.json");
const REGISTRY_JSON: &str = include_str!("../generated/token-registry.json");

/// `LEGITIMATE_ALIASES` (`portfolio/token-registry.ts`): registry symbols with an allow-listed
/// second deployment, which `tokenSpamReasons` never flags as a spoof. USDC's is bridged USDC.e
/// (#645). Not in `token-registry.json`, so held here. A copy of wallet-core's `bramble-core`
/// `catalogs::networks::LEGITIMATE_ALIASES`, value for value, until 2.7 swaps it for that.
pub const LEGITIMATE_ALIASES: [(&str, &[&str]); 1] = [(
    "USDC",
    &["0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8"],
)];

/// A network the mobile wallet supports.
#[uniffi::remote(Enum)]
pub enum NetworkId {
    Mainnet,
    Sepolia,
}

/// An ERC-20 the wallet home queries by default.
#[uniffi::remote(Record)]
pub struct TokenInfo {
    pub address: String,
    pub decimals: u8,
    pub name: String,
    pub symbol: String,
}

/// Public network metadata. RPC endpoints are tried in order; the host verifies
/// `starknet_chainId` against `chain_id` before trusting any response.
#[uniffi::remote(Record)]
pub struct NetworkInfo {
    pub network: NetworkId,
    pub chain_id: String,
    pub explorer_base_url: String,
    pub name: String,
    pub rpc_urls: Vec<String>,
    pub tokens: Vec<TokenInfo>,
}

#[derive(Deserialize)]
struct RawToken {
    address: String,
    decimals: u8,
    name: String,
    symbol: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogEntry {
    id: String,
    chain_id: String,
    explorer_base_url: String,
    name: String,
    rpc_urls: Vec<String>,
    tokens: Vec<RawToken>,
}

#[derive(Deserialize)]
struct Catalog {
    networks: Vec<CatalogEntry>,
}

fn load() -> Vec<NetworkInfo> {
    let catalog: Catalog =
        serde_json::from_str(CATALOG_JSON).expect("bundled network catalog parses");
    [NetworkId::Mainnet, NetworkId::Sepolia]
        .into_iter()
        .map(|network| {
            let entry = catalog
                .networks
                .iter()
                .find(|entry| entry.id == network.catalog_id())
                .expect("bundled catalog covers every NetworkId");
            let info = NetworkInfo {
                network,
                chain_id: entry.chain_id.clone(),
                explorer_base_url: entry.explorer_base_url.clone(),
                name: entry.name.clone(),
                rpc_urls: entry.rpc_urls.clone(),
                tokens: entry
                    .tokens
                    .iter()
                    .map(|t| TokenInfo {
                        address: t.address.clone(),
                        decimals: t.decimals,
                        name: t.name.clone(),
                        symbol: t.symbol.clone(),
                    })
                    .collect(),
            };
            assert!(
                felt::parse_non_zero(&info.chain_id).is_some(),
                "chain id is a felt"
            );
            assert!(
                info.rpc_urls.iter().all(|url| url.starts_with("https://")),
                "RPC over TLS only"
            );
            assert!(info
                .tokens
                .iter()
                .all(|t| felt::parse_non_zero(&t.address).is_some()));
            info
        })
        .collect()
}

/// Every supported network, validated once on first use.
pub fn all() -> &'static [NetworkInfo] {
    static NETWORKS: OnceLock<Vec<NetworkInfo>> = OnceLock::new();
    NETWORKS.get_or_init(load)
}

/// Metadata for one network.
pub fn info(network: NetworkId) -> &'static NetworkInfo {
    wallet_core::catalog::network_info(all(), network).expect("every NetworkId is bundled")
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryEntry {
    address: String,
    decimals: u8,
    name: String,
    network_id: String,
    symbol: String,
}

#[derive(Deserialize)]
struct Registry {
    tokens: Vec<RegistryEntry>,
    logos: Vec<String>,
}

/// The curated token registry and bundled-logo set, embedded from `generated/token-registry.json`
/// (rendered from the extension by the same script), with `LEGITIMATE_ALIASES`, parsed once on
/// first use.
pub fn registry() -> &'static TokenRegistry {
    static REGISTRY: OnceLock<TokenRegistry> = OnceLock::new();
    REGISTRY.get_or_init(|| {
        let raw: Registry =
            serde_json::from_str(REGISTRY_JSON).expect("bundled token registry parses");
        TokenRegistry {
            tokens: raw
                .tokens
                .into_iter()
                .map(|t| RegistryToken {
                    address: t.address,
                    decimals: t.decimals,
                    name: t.name,
                    network_id: t.network_id,
                    symbol: t.symbol,
                })
                .collect(),
            logos: raw.logos,
            aliases: LEGITIMATE_ALIASES
                .iter()
                .map(|(symbol, addresses)| TokenAlias {
                    symbol: (*symbol).into(),
                    addresses: addresses.iter().map(|a| (*a).into()).collect(),
                })
                .collect(),
        }
    })
}

/// Both bundled catalogs, as `wallet_core` takes them.
pub fn catalogs() -> Catalogs<'static> {
    Catalogs {
        networks: all(),
        registry: registry(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_matches_krusty_chain_ids() {
        for network in [NetworkId::Mainnet, NetworkId::Sepolia] {
            let expected = felt::canonical(&network.chain_id());
            assert_eq!(info(network).chain_id, expected);
            assert!(info(network).tokens.iter().any(|t| t.symbol == "STRK"));
        }
    }

    /// Each alias is a curated registry token on mainnet whose ticker is the bridged form of the
    /// symbol it widens (`USDC.e` for `USDC`).
    #[test]
    fn aliases_are_curated_bridged_deployments() {
        for (symbol, addresses) in LEGITIMATE_ALIASES {
            for address in addresses {
                assert!(registry().tokens.iter().any(|t| t.address == *address
                    && t.network_id == "SN_MAIN"
                    && t.symbol == format!("{symbol}.e")));
            }
        }
    }
}
