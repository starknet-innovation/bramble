//! Bundled networks and tokens, embedded from `generated/networks.json`, which
//! `scripts/generate-mobile-assets.ts` renders from `wallet-model/networks`. There is no second
//! hand-written copy of a chain id, RPC endpoint, or token address anywhere in the mobile tree.

use std::sync::OnceLock;

use krusty_kms_common::ChainId;
use serde::Deserialize;

use crate::felt;

const CATALOG_JSON: &str = include_str!("../generated/networks.json");

/// A network the mobile wallet supports.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, uniffi::Enum)]
pub enum NetworkId {
    Mainnet,
    Sepolia,
}

impl NetworkId {
    pub(crate) fn catalog_id(self) -> &'static str {
        match self {
            Self::Mainnet => "SN_MAIN",
            Self::Sepolia => "SN_SEPOLIA",
        }
    }

    pub(crate) fn chain(self) -> ChainId {
        match self {
            Self::Mainnet => ChainId::Mainnet,
            Self::Sepolia => ChainId::Sepolia,
        }
    }
}

/// An ERC-20 the wallet home queries by default.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, uniffi::Record)]
pub struct TokenInfo {
    pub address: String,
    pub decimals: u8,
    pub name: String,
    pub symbol: String,
}

/// Public network metadata. RPC endpoints are tried in order; the host verifies
/// `starknet_chainId` against `chain_id` before trusting any response.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInfo {
    #[serde(skip, default = "default_network")]
    pub network: NetworkId,
    pub chain_id: String,
    pub explorer_base_url: String,
    pub name: String,
    pub rpc_urls: Vec<String>,
    pub tokens: Vec<TokenInfo>,
}

fn default_network() -> NetworkId {
    NetworkId::Sepolia
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogEntry {
    id: String,
    #[serde(flatten)]
    info: NetworkInfo,
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
                ..entry.info.clone()
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
    all()
        .iter()
        .find(|info| info.network == network)
        .expect("every NetworkId is bundled")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_matches_krusty_chain_ids() {
        for network in [NetworkId::Mainnet, NetworkId::Sepolia] {
            let expected = felt::canonical(&network.chain().as_felt());
            assert_eq!(info(network).chain_id, expected);
            assert!(info(network).tokens.iter().any(|t| t.symbol == "STRK"));
        }
    }
}
