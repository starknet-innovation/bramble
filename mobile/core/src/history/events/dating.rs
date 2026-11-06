//! The scan's last step, split from `events.rs`: rank the collected transfers
//! (`rankRecentTransfers`), then date each by its block and build the activity rows.

use super::{HistoryScan, Phase, Scan};
use crate::history::activity::{is_activity_entry, on_chain_activity_entry, DecodedTransfer};
use crate::history::starkscan::MAX_HISTORY_ENTRIES;
use crate::js::num::is_safe_integer;

impl HistoryScan {
    // `rankRecentTransfers` then the distinct blocks, in rank order.
    pub(super) fn rank(&self, scan: &mut Scan) {
        let mut ranked: Vec<(DecodedTransfer, usize)> = Vec::new();
        for (transfer, token) in std::mem::take(&mut scan.collected) {
            let same_leg = |(t, i): &(DecodedTransfer, usize)| {
                t.hash == transfer.hash
                    && self.tokens[*i].address == self.tokens[token].address
                    && t.counterparty == transfer.counterparty
                    && t.amount_raw == transfer.amount_raw
            };
            if !ranked.iter().any(same_leg) {
                ranked.push((transfer, token));
            }
        }
        ranked.sort_by_key(|r| std::cmp::Reverse(r.0.block_number));
        ranked.truncate(MAX_HISTORY_ENTRIES);
        let mut blocks: Vec<u64> = Vec::new();
        for (transfer, _) in &ranked {
            if !blocks.contains(&transfer.block_number) {
                blocks.push(transfer.block_number);
            }
        }
        scan.ranked = ranked;
        scan.phase = Phase::Timestamps {
            blocks,
            next: 0,
            times: Vec::new(),
        };
        self.finish_if_dated(scan);
    }

    pub(super) fn finish_if_dated(&self, scan: &mut Scan) {
        let Phase::Timestamps { blocks, times, .. } = &scan.phase else {
            return;
        };
        if times.len() < blocks.len() {
            return;
        }
        let mut entries = Vec::new();
        for (transfer, token) in &scan.ranked {
            let Some(Some(seconds)) = times
                .iter()
                .find(|(b, _)| *b == transfer.block_number)
                .map(|(_, s)| *s)
            else {
                continue;
            };
            let ms = seconds * 1000.0;
            if !is_safe_integer(ms) || ms < 0.0 {
                continue;
            }
            let entry = on_chain_activity_entry(
                &self.account_id,
                transfer,
                self.network,
                ms as u64,
                &self.tokens[*token],
            );
            if is_activity_entry(&entry) {
                entries.push(entry);
            }
        }
        scan.phase = Phase::Done(entries);
    }
}
