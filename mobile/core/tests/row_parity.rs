//! Bramble's Activity empty-state sentences (`activityEmptyCopy`) against the side panel's own
//! renderer (`fixtures/portfolio-parity.jsonl`). The rows, day groups, header copy, timestamps,
//! sparklines and explorer links are `wallet_core`'s, checked over the same fixture in wallet-core
//! (`crates/bramble-core/tests/row_parity.rs`); the sentences are Bramble's, so they are checked
//! here, through the export.

mod common;

use bramble_core::portfolio_testing::JsValue;
use bramble_core::*;
use common::portfolio::*;

#[test]
fn empty_state_copy_matches_the_side_panel() {
    let block = at(&fixture(), "status").clone();
    let cases = list(&block, "empty");
    assert!(!cases.is_empty());
    for c in cases {
        assert_eq!(
            activity_empty_copy(at(c, "unavailable") == &JsValue::Bool(true)),
            text(c, "out")
        );
    }
}
