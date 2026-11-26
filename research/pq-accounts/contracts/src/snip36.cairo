//! SNIP-36 harness: checks an account's signature inside a client-side proof, the way the
//! STRK20 privacy pool does, and consumes the proven result on-chain.
//!
//! - `PqAuthProbe` is the sender of the off-chain ("virtual") transaction. Like the privacy
//!   pool it validates nothing itself; its `__execute__` asks the user's account to approve
//!   the transaction through `is_valid_signature` and, on success, sends one L2-to-L1
//!   message committing to the user and the payload.
//! - `PqAuthConsumer` runs on-chain in a transaction that carries the proof. It reads the
//!   proof facts, checks that they come from the virtual OS on a recent block and that the
//!   only proven message is the probe's message for this user and payload, then records it.
//! - `proof_facts` holds the shared layout and message hashing.

pub mod consumer;
pub mod probe;
pub mod proof_facts;
