//! Crate-internal rules the parity suite (`tests/portfolio_parity.rs`) checks directly against
//! the extension's output. Not part of the FFI surface.

pub use crate::history::activity::{decode_transfer_event, entry_from_json, merge_activity};
pub use crate::history::classify::compact_summary;
pub use crate::history::explorer::canonical_account_id;
pub use crate::history::starkscan::{cooldown_ms, parse_retry_after_ms, transfers_to_activity};
pub use crate::history::time::{
    format_utc_clock, format_utc_date, format_utc_day, parse_iso_timestamp,
};
pub use crate::js::json::{parse as parse_json, JsValue};
pub use crate::js::num::{locale_grouped_2, number_to_string, string_to_number, to_fixed};
pub use crate::portfolio::fiat::token_fiat_value;
pub use crate::portfolio::prices::{normalize_price_address, PRICE_CHART_POINT_LIMIT};
pub use crate::portfolio::snapshots::{balance_from_json, is_token_balance};
pub use crate::portfolio::token_meta::decode_erc20_string;
pub use crate::portfolio::tokens::{is_token_config, known_tokens, spam_reasons};
pub use crate::portfolio::wire::{
    HTTP_DEADLINE_MS, PRICE_BODY_LIMIT, RPC_BODY_LIMIT, RPC_DEADLINE_MS, STARKSCAN_BODY_LIMIT,
};

/// `activityRowModel`-level classification for one entry, for the appearance fixtures.
pub fn entry_json(entry: &crate::history::activity::ActivityEntry) -> String {
    crate::history::activity::entry_to_json(entry).to_string()
}

/// `isTokenConfig` over an untyped stored value.
pub fn token_config_from_json(value: &JsValue) -> Option<crate::portfolio::model::TokenConfig> {
    crate::portfolio::tokens::parse_token(value)
}
