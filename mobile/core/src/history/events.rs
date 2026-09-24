//! The RPC history scan (`history/tx-history-scan.ts collectTransactionHistory` and
//! `tx-history.ts decodeTransferEvent`) as a sans-IO step machine: `starknet_blockNumber`, then
//! for each tracked token two key-filtered `starknet_getEvents` reads (outgoing, incoming) of up
//! to three 100-event pages over the last 200 000 blocks (re-read over the last 20 000 when that
//! overflows), then one `starknet_getBlockWithTxHashes` per distinct block for the timestamps.
//!
//! Failover (design §3.9): `accept` reports `Transport` when the endpoint failed; the host then
//! calls `restart` and replays the whole scan on the next chain-id-verified endpoint, exactly as
//! `withRpcFallback` reruns `collectTransactionHistory`.

use std::sync::Mutex;

use serde_json::{json, Value};

use super::activity::{
    decode_transfer_event, is_activity_entry, on_chain_activity_entry, ActivityEntry,
    DecodedTransfer, TRANSFER_EVENT_KEY,
};
use super::explorer::{account_id_address, is_account_id_for_network};
use super::starkscan::MAX_HISTORY_ENTRIES;
use crate::js::felt::{canonical_felt, is_non_zero_felt};
use crate::js::json::JsValue;
use crate::js::num::is_safe_integer;
use crate::networks::NetworkId;
use crate::portfolio::model::TokenConfig;
use crate::portfolio::wire::{classify, rpc_call, Reply, RpcCall, RpcReply};
use crate::CoreError;

const MAX_EVENT_PAGES: usize = 3;
const EVENT_CHUNK_SIZE: u64 = 100;
const HISTORY_BLOCK_WINDOW: u64 = 200_000;
const HISTORY_RECENT_STRIDE: u64 = 20_000;
const BLOCK_TIMESTAMP_CONCURRENCY: usize = 4;
/// A continuation token longer than this (serialised) is treated as a malformed answer.
const MAX_CONTINUATION_BYTES: usize = 4_096;

/// What the host does after handing a reply to `accept`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum ScanStep {
    /// Keep going: ask `next_calls` again (empty means `finish`).
    Continue,
    /// This endpoint failed at transport level: `restart` on the next endpoint, or, when none is
    /// left, mark history unavailable.
    Transport,
}

#[derive(Debug, Clone)]
enum Phase {
    Latest,
    Events {
        token: usize,
        filter: usize,
        recent: bool,
        page: usize,
        continuation: Option<JsValue>,
        buffer: Vec<(DecodedTransfer, usize)>,
    },
    Timestamps {
        blocks: Vec<u64>,
        next: usize,
        times: Vec<(u64, Option<f64>)>,
    },
    Done(Vec<ActivityEntry>),
}

#[derive(Debug)]
struct Scan {
    phase: Phase,
    latest: u64,
    from_block: u64,
    collected: Vec<(DecodedTransfer, usize)>,
    ranked: Vec<(DecodedTransfer, usize)>,
    outstanding: Vec<(u64, u64)>,
    next_id: u64,
}

/// One account's on-chain history scan on one network.
#[derive(uniffi::Object)]
pub struct HistoryScan {
    account_id: String,
    account: String,
    network: NetworkId,
    tokens: Vec<TokenConfig>,
    scan: Mutex<Scan>,
}

fn fresh_scan() -> Scan {
    Scan {
        phase: Phase::Latest,
        latest: 0,
        from_block: 0,
        collected: Vec::new(),
        ranked: Vec::new(),
        outstanding: Vec::new(),
        next_id: 1,
    }
}

impl HistoryScan {
    fn lock(&self) -> std::sync::MutexGuard<'_, Scan> {
        self.scan
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn scannable(&self, index: usize) -> bool {
        canonical_felt(&self.tokens[index].address).is_some_and(|a| is_non_zero_felt(&a))
    }

    // The first scannable token at or after `from`, or the timestamp phase when none is left.
    fn next_token(&self, scan: &mut Scan, from: usize) {
        match (from..self.tokens.len()).find(|i| self.scannable(*i)) {
            Some(token) => {
                scan.phase = Phase::Events {
                    token,
                    filter: 0,
                    recent: false,
                    page: 0,
                    continuation: None,
                    buffer: Vec::new(),
                };
            }
            None => self.rank(scan),
        }
    }

    // `rankRecentTransfers` then the distinct blocks, in rank order.
    fn rank(&self, scan: &mut Scan) {
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

    fn finish_if_dated(&self, scan: &mut Scan) {
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

    fn events_call(&self, id: u64, scan: &Scan) -> Option<RpcCall> {
        let Phase::Events {
            token,
            filter,
            recent,
            continuation,
            ..
        } = &scan.phase
        else {
            return None;
        };
        let keys = if *filter == 0 {
            json!([[TRANSFER_EVENT_KEY], [self.account]])
        } else {
            json!([[TRANSFER_EVENT_KEY], [], [self.account]])
        };
        let from = if *recent {
            scan.from_block
                .max(scan.latest.saturating_sub(HISTORY_RECENT_STRIDE))
        } else {
            scan.from_block
        };
        let mut filter_doc = json!({
            "address": self.tokens[*token].address,
            "chunk_size": EVENT_CHUNK_SIZE,
            "from_block": { "block_number": from },
            "keys": keys,
            "to_block": { "block_number": scan.latest },
        });
        if let Some(token) = continuation {
            let value: Value = serde_json::from_str(&token.to_json()).ok()?;
            filter_doc["continuation_token"] = value;
        }
        Some(rpc_call(
            id,
            "starknet_getEvents",
            json!({ "filter": filter_doc }),
        ))
    }

    // Applies one events page; `Err(())` is a transport-class failure.
    fn accept_events(&self, scan: &mut Scan, result: &JsValue) -> Result<(), ()> {
        let Phase::Events {
            token,
            filter,
            recent,
            page,
            continuation,
            buffer,
        } = &mut scan.phase
        else {
            return Err(());
        };
        if matches!(result, JsValue::Null) {
            return Err(());
        }
        match result.get("events") {
            None | Some(JsValue::Null) | Some(JsValue::String(_)) => {}
            Some(JsValue::Array(events)) => {
                for event in events {
                    if matches!(event, JsValue::Null) {
                        return Err(());
                    }
                    if let Some(decoded) = decode_transfer_event(event, &self.account) {
                        buffer.push((decoded, *token));
                    }
                }
            }
            Some(_) => return Err(()),
        }
        *page += 1;
        let next = result.get("continuation_token").cloned();
        if let Some(next) = next {
            if next.to_json().len() > MAX_CONTINUATION_BYTES {
                return Err(());
            }
            if *page < MAX_EVENT_PAGES {
                *continuation = Some(next);
                return Ok(());
            }
            if !*recent {
                *recent = true;
                *page = 0;
                *continuation = None;
                buffer.clear();
                return Ok(());
            }
        }
        let (token, filter) = (*token, *filter);
        let committed = std::mem::take(buffer);
        scan.collected.extend(committed);
        if filter == 0 {
            scan.phase = Phase::Events {
                token,
                filter: 1,
                recent: false,
                page: 0,
                continuation: None,
                buffer: Vec::new(),
            };
        } else {
            self.next_token(scan, token + 1);
        }
        Ok(())
    }
}

#[uniffi::export]
impl HistoryScan {
    /// A scan for `account_id` (from `activity_account_id`) over the tracked tokens.
    #[uniffi::constructor]
    pub fn new(
        account_id: String,
        network: NetworkId,
        tracked: Vec<TokenConfig>,
    ) -> Result<std::sync::Arc<Self>, CoreError> {
        if !is_account_id_for_network(&account_id, network) {
            return Err(CoreError::InvalidInput {
                reason: "History account id does not belong to the network".into(),
            });
        }
        let account = canonical_felt(account_id_address(&account_id)).unwrap_or_default();
        let tokens: Vec<TokenConfig> = tracked
            .into_iter()
            .filter(|t| t.network == network)
            .collect();
        let this = Self {
            account_id,
            account,
            network,
            tokens,
            scan: Mutex::new(fresh_scan()),
        };
        if this.tokens.is_empty() {
            this.lock().phase = Phase::Done(Vec::new());
        }
        Ok(std::sync::Arc::new(this))
    }

    /// The calls to send now (events one at a time, timestamps up to four at once); empty when
    /// the scan is waiting for replies or done.
    pub fn next_calls(&self) -> Vec<RpcCall> {
        let mut scan = self.lock();
        if !scan.outstanding.is_empty() {
            return Vec::new();
        }
        let mut calls = Vec::new();
        let take_id = |scan: &mut Scan, purpose: u64| {
            let id = scan.next_id;
            scan.next_id += 1;
            scan.outstanding.push((id, purpose));
            id
        };
        match scan.phase.clone() {
            Phase::Latest => {
                let id = take_id(&mut scan, 0);
                calls.push(rpc_call(id, "starknet_blockNumber", json!([])));
            }
            Phase::Events { .. } => {
                let id = take_id(&mut scan, 0);
                if let Some(call) = self.events_call(id, &scan) {
                    calls.push(call);
                }
            }
            Phase::Timestamps { blocks, next, .. } => {
                for block in blocks.iter().skip(next).take(BLOCK_TIMESTAMP_CONCURRENCY) {
                    let id = take_id(&mut scan, *block);
                    calls.push(rpc_call(
                        id,
                        "starknet_getBlockWithTxHashes",
                        json!({ "block_id": { "block_number": block } }),
                    ));
                }
                if let Phase::Timestamps { next, .. } = &mut scan.phase {
                    *next += calls.len();
                }
            }
            Phase::Done(_) => {}
        }
        calls
    }

    /// Judges one reply. A node error skips that token (or leaves that block undated).
    pub fn accept(&self, reply: RpcReply) -> ScanStep {
        let mut scan = self.lock();
        let Some(index) = scan.outstanding.iter().position(|(id, _)| *id == reply.id) else {
            return ScanStep::Transport;
        };
        let (id, block) = scan.outstanding.remove(index);
        let judged = classify(&reply, id);
        if judged == Reply::Transport {
            return ScanStep::Transport;
        }
        match scan.phase.clone() {
            Phase::Latest => {
                let latest = match &judged {
                    Reply::Result(JsValue::Number(n)) if is_safe_integer(*n) && *n >= 0.0 => {
                        *n as u64
                    }
                    _ => return ScanStep::Transport,
                };
                scan.latest = latest;
                scan.from_block = latest.saturating_sub(HISTORY_BLOCK_WINDOW);
                self.next_token(&mut scan, 0);
            }
            Phase::Events { token, .. } => match &judged {
                Reply::Result(result) => {
                    if self.accept_events(&mut scan, result).is_err() {
                        return ScanStep::Transport;
                    }
                }
                _ => self.next_token(&mut scan, token + 1),
            },
            Phase::Timestamps { .. } => {
                let seconds = match &judged {
                    Reply::Result(JsValue::Null) => return ScanStep::Transport,
                    Reply::Result(block) => block.get("timestamp").and_then(JsValue::as_f64),
                    _ => None,
                };
                if let Phase::Timestamps { times, .. } = &mut scan.phase {
                    times.push((block, seconds));
                }
                self.finish_if_dated(&mut scan);
            }
            Phase::Done(_) => return ScanStep::Transport,
        }
        ScanStep::Continue
    }

    /// Discards all progress so the scan replays from `starknet_blockNumber` on another endpoint.
    pub fn restart(&self) {
        let mut scan = self.lock();
        *scan = fresh_scan();
        if self.tokens.is_empty() {
            scan.phase = Phase::Done(Vec::new());
        }
    }

    /// The dated rows (at most 25, newest block first), once every call has been answered.
    pub fn finish(&self) -> Result<Vec<ActivityEntry>, CoreError> {
        match &self.lock().phase {
            Phase::Done(entries) => Ok(entries.clone()),
            _ => Err(CoreError::Rpc {
                reason: "history scan is not finished".into(),
            }),
        }
    }
}
