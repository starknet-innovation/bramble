//! The wallet's one activity log: transactions this wallet submitted and on-chain history rows,
//! as the extension's `ActivityEntry`, in one core-owned file. Public on-chain data only; see
//! `store` for the file format and its guarantees and `feed` for the history side.

pub(crate) mod feed;
pub(crate) mod observation;
pub(crate) mod store;
