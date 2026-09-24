//! Portfolio: fiat prices and charts, tracked tokens, on-chain token reads and saved balances,
//! each a sans-IO port of the extension's TypeScript (see `mobile/docs/portfolio-activity.md`).

pub mod fiat;
pub mod model;
pub(crate) mod ordered;
mod price_cache;
pub mod prices;
mod registry;
pub mod snapshots;
pub mod token_meta;
pub mod tokens;
pub mod wire;

/// Schema tag of every persisted portfolio/activity document (`preferences.json`, `prices.json`,
/// `snapshots.json`, `activity.json`). A later change bumps it and adds one adjacent migration.
pub const SCHEMA: &str = "bramble.mobile.portfolio.v1";
