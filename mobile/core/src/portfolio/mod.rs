//! Portfolio: fiat prices and charts, tracked tokens, on-chain token reads and saved balances.
//! The rules are `wallet_core::portfolio` (sans-IO ports of the extension's TypeScript, see
//! `mobile/docs/portfolio-activity.md`); this module is Bramble's side: the UniFFI shapes and
//! exports, the three FFI objects wrapping the core's stores in a lock, the bundled catalogs they
//! pass (`networks::catalogs`), and the copy that carries no rule.

pub mod fiat;
pub mod model;
pub mod prices;
pub(crate) mod registry;
pub mod snapshots;
pub mod token_meta;
pub mod tokens;
pub mod wire;
