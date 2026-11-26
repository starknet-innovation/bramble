//! SLH-DSA-BLAKE2s-128s signature verification — a NON-STANDARD spike.
//!
//! This is FIPS 205's SLH-DSA-128s construction and parameter set with every hash
//! instantiated from BLAKE2s-256 instead of SHAKE256 or SHA-256 (see the crate README for
//! the exact definitions). It is not FIPS 205 conformant and has not been audited.
//!
//! The verifier implements the pure external interface with an empty context over the
//! transaction hash serialized as a 32-byte big-endian message. It uses Starknet's native
//! `blake2s_compress`/`blake2s_finalize` libfuncs. The invariant first block
//! `PK.seed || 0^48` of every tweakable hash is compressed once per signature.
//!
//! Each 16-byte SLH-DSA string is encoded as one felt holding the string's bytes in
//! little-endian order, so splitting a felt into four `u32`s yields BLAKE2s's little-endian
//! message words directly. Every element must fit in `u128`.

pub mod fixtures;
use core::blake::{blake2s_compress, blake2s_finalize};
use pqbench_interface::PqSignatureVerifier;

/// Number of felts in a public key: `PK.seed || PK.root`, one 16-byte value per felt.
pub const PUBKEY_FELTS: u32 = 2;
/// Number of felts in a signature: 7,856 bytes as 491 16-byte values.
pub const SIG_FELTS: u32 = 491;

const FORS_HEIGHT: u32 = 12;
const FORS_TREES: u32 = 14;
const FORS_TREE_SIZE: u32 = 4096;
const FORS_SIG_NODES: u32 = 182;
const WOTS_LEN: u32 = 35;
const XMSS_HEIGHT: u32 = 9;
const XMSS_SIG_NODES: u32 = 44;
const HT_LAYERS: u32 = 7;
const HT_SIG_OFFSET: u32 = 183;
const TREE_MASK: u64 = 0x3fffffffffffff;
const LEAF_MASK: u32 = 0x1ff;

// Address types, pre-shifted into the high byte of their little-endian word.
const WOTS_HASH_WORD: u32 = 0x00000000;
const WOTS_PK_WORD: u32 = 0x01000000;
const TREE_WORD: u32 = 0x02000000;
const FORS_TREE_WORD: u32 = 0x03000000;
const FORS_ROOTS_WORD: u32 = 0x04000000;

/// BLAKE2s-256 initial state: the IV with parameter block word 0 (digest length 32,
/// no key, fanout 1, depth 1) folded in.
const BLAKE2S_256_IV: [u32; 8] = [
    0x6b08e647, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

#[derive(Copy, Drop)]
struct Node {
    w0: u32,
    w1: u32,
    w2: u32,
    w3: u32,
}

/// The full 32-byte FIPS 205 address as eight little-endian words. Word 1 (the high bytes
/// of the 12-byte tree field) is always zero for 128s and is not stored.
#[derive(Copy, Drop)]
struct Adrs {
    layer: u32,
    tree_hi: u32,
    tree_lo: u32,
    kind: u32,
    key_pair: u32,
    chain_or_height: u32,
    hash_or_index: u32,
}

/// Byte-swaps a value below 2^16 into the little-endian word of its big-endian bytes.
#[inline(always)]
fn swap16(value: u32, two8: NonZero<u32>) -> u32 {
    let (hi, lo) = DivRem::div_rem(value, two8);
    lo * 0x1000000 + hi * 0x10000
}

fn swap32(value: u32, two8: NonZero<u32>) -> u32 {
    let (rest, b3) = DivRem::div_rem(value, two8);
    let (rest, b2) = DivRem::div_rem(rest, two8);
    let (b0, b1) = DivRem::div_rem(rest, two8);
    b3 * 0x1000000 + b2 * 0x10000 + b1 * 0x100 + b0
}

fn layer_address(layer: u32, tree: u64, two8: NonZero<u32>) -> Adrs {
    let two32: NonZero<u64> = 0x100000000_u64.try_into().unwrap();
    let (hi, lo) = DivRem::div_rem(tree, two32);
    Adrs {
        layer: layer * 0x1000000,
        tree_hi: swap32(hi.try_into().unwrap(), two8),
        tree_lo: swap32(lo.try_into().unwrap(), two8),
        kind: 0,
        key_pair: 0,
        chain_or_height: 0,
        hash_or_index: 0,
    }
}

#[inline(always)]
fn split_u128(value: u128, two32: NonZero<u128>) -> Node {
    let (rest, w0) = DivRem::div_rem(value, two32);
    let (rest, w1) = DivRem::div_rem(rest, two32);
    let (w3, w2) = DivRem::div_rem(rest, two32);
    Node {
        w0: w0.try_into().unwrap(),
        w1: w1.try_into().unwrap(),
        w2: w2.try_into().unwrap(),
        w3: w3.try_into().unwrap(),
    }
}

#[inline(always)]
fn digest_node(state: Box<[u32; 8]>) -> Node {
    let [d0, d1, d2, d3, _, _, _, _] = state.unbox();
    Node { w0: d0, w1: d1, w2: d2, w3: d3 }
}

fn compute_prefix_state(pk_seed: Node) -> Box<[u32; 8]> {
    let block = [pk_seed.w0, pk_seed.w1, pk_seed.w2, pk_seed.w3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    blake2s_compress(BoxTrait::new(BLAKE2S_256_IV), 64, BoxTrait::new(block))
}

#[inline(always)]
fn f_hash(prefix: Box<[u32; 8]>, a: Adrs, value: Node) -> Node {
    let block = [
        a.layer, 0, a.tree_hi, a.tree_lo, a.kind, a.key_pair, a.chain_or_height, a.hash_or_index,
        value.w0, value.w1, value.w2, value.w3, 0, 0, 0, 0,
    ];
    digest_node(blake2s_finalize(prefix, 112, BoxTrait::new(block)))
}

#[inline(always)]
fn h_hash(prefix: Box<[u32; 8]>, a: Adrs, left: Node, right: Node) -> Node {
    let block = [
        a.layer, 0, a.tree_hi, a.tree_lo, a.kind, a.key_pair, a.chain_or_height, a.hash_or_index,
        left.w0, left.w1, left.w2, left.w3, right.w0, right.w1, right.w2, right.w3,
    ];
    digest_node(blake2s_finalize(prefix, 128, BoxTrait::new(block)))
}

/// `T_l` over `ADRS || values`, after the cached `PK.seed` block.
fn t_hash(prefix: Box<[u32; 8]>, a: Adrs, mut values: Span<Node>) -> Node {
    let total_bytes = 64 + 32 + values.len() * 16;
    let mut words = array![
        a.layer, 0, a.tree_hi, a.tree_lo, a.kind, a.key_pair, a.chain_or_height, a.hash_or_index,
    ];
    while let Some(value) = values.pop_front() {
        words.append(*value.w0);
        words.append(*value.w1);
        words.append(*value.w2);
        words.append(*value.w3);
    }
    while words.len() % 16 != 0 {
        words.append(0);
    }
    let mut remaining = words.len() / 16;
    let mut blocks = words.span();
    let mut state = prefix;
    let mut count = 64;
    while let Some(block) = blocks.multi_pop_front::<16>() {
        remaining -= 1;
        if remaining == 0 {
            state = blake2s_finalize(state, total_bytes, *block);
        } else {
            count += 64;
            state = blake2s_compress(state, count, *block);
        }
    }
    digest_node(state)
}

/// Appends the 16 big-endian bytes of `value`.
fn append_u128_be_bytes(value: u128, ref out: Array<u32>) {
    let mut bytes = array![];
    let mut rest = value;
    let mut i = 0;
    while i != 16 {
        let (q, r) = DivRem::div_rem(rest, 0x100_u128.try_into().unwrap());
        bytes.append(r);
        rest = q;
        i += 1;
    }
    let mut j = 16;
    while j != 0 {
        j -= 1;
        out.append((*bytes.at(j)).try_into().unwrap());
    }
}

/// Packs bytes (one per `u32`) into little-endian words, zero-padding the last word.
fn pack_le(mut bytes: Span<u32>, ref out: Array<u32>) {
    while !bytes.is_empty() {
        let mut word = 0;
        let mut shift = 1;
        let mut k = 0;
        while k != 4 {
            if let Some(byte) = bytes.pop_front() {
                word += *byte * shift;
            }
            if k != 3 {
                shift *= 0x100;
            }
            k += 1;
        }
        out.append(word);
    }
}

fn append_node(ref words: Array<u32>, value: Node) {
    words.append(value.w0);
    words.append(value.w1);
    words.append(value.w2);
    words.append(value.w3);
}

/// `H_msg`: MGF1-BLAKE2s-256(R || PK.seed || BLAKE2s(R || PK.seed || PK.root || M'), 30)
/// with `M' = 0x00 || 0x00 || M` (pure interface, empty context). Returns the digest's 30
/// bytes, one per `u32`.
fn h_msg(message_hash: felt252, randomizer: Node, pk_seed: Node, pk_root: Node) -> Array<u32> {
    let message: u256 = message_hash.into();
    let mut m_bytes = array![0, 0];
    append_u128_be_bytes(message.high, ref m_bytes);
    append_u128_be_bytes(message.low, ref m_bytes);

    let mut words = array![];
    append_node(ref words, randomizer);
    append_node(ref words, pk_seed);
    append_node(ref words, pk_root);
    pack_le(m_bytes.span(), ref words);
    while words.len() != 32 {
        words.append(0);
    }
    let mut blocks = words.span();
    let first = *blocks.multi_pop_front::<16>().unwrap();
    let second = *blocks.multi_pop_front::<16>().unwrap();
    let state = blake2s_compress(BoxTrait::new(BLAKE2S_256_IV), 64, first);
    let inner = blake2s_finalize(state, 82, second).unbox();

    let [i0, i1, i2, i3, i4, i5, i6, i7] = inner;
    let first = [
        randomizer.w0, randomizer.w1, randomizer.w2, randomizer.w3, pk_seed.w0, pk_seed.w1,
        pk_seed.w2, pk_seed.w3, i0, i1, i2, i3, i4, i5, i6, i7,
    ];
    let state = blake2s_compress(BoxTrait::new(BLAKE2S_256_IV), 64, BoxTrait::new(first));
    // MGF1 counter 0 as four zero bytes; one output block covers the 30-byte digest.
    let second = [0_u32, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    let digest = blake2s_finalize(state, 68, BoxTrait::new(second)).unbox();

    let mut out = array![];
    let two8: NonZero<u32> = 0x100_u32.try_into().unwrap();
    let mut words = digest.span();
    while let Some(word) = words.pop_front() {
        let (rest, b0) = DivRem::div_rem(*word, two8);
        let (rest, b1) = DivRem::div_rem(rest, two8);
        let (b3, b2) = DivRem::div_rem(rest, two8);
        out.append(b0);
        out.append(b1);
        out.append(b2);
        out.append(b3);
    }
    out
}

fn fors_indices(md: Span<u32>) -> Array<u32> {
    let mut indices = array![];
    let mut i = 0;
    while i != 21 {
        let b0 = *md.at(i);
        let b1 = *md.at(i + 1);
        let b2 = *md.at(i + 2);
        indices.append(b0 * 16 + b1 / 16);
        indices.append((b1 % 16) * 256 + b2);
        i += 3;
    }
    indices
}

/// Appends the eight base-16 digits of a little-endian word's four bytes, in byte order.
#[inline(always)]
fn append_wots_word(
    word: u32, ref digits: Array<u32>, ref checksum: u32, two8: NonZero<u32>, sixteen: NonZero<u32>,
) {
    let (rest, b0) = DivRem::div_rem(word, two8);
    let (rest, b1) = DivRem::div_rem(rest, two8);
    let (b3, b2) = DivRem::div_rem(rest, two8);
    let (d0, d1) = DivRem::div_rem(b0, sixteen);
    let (d2, d3) = DivRem::div_rem(b1, sixteen);
    let (d4, d5) = DivRem::div_rem(b2, sixteen);
    let (d6, d7) = DivRem::div_rem(b3, sixteen);
    digits.append(d0);
    digits.append(d1);
    digits.append(d2);
    digits.append(d3);
    digits.append(d4);
    digits.append(d5);
    digits.append(d6);
    digits.append(d7);
    checksum += 120 - d0 - d1 - d2 - d3 - d4 - d5 - d6 - d7;
}

fn wots_digits(message: Node) -> Array<u32> {
    let mut digits = array![];
    let mut checksum = 0;
    let two8: NonZero<u32> = 0x100_u32.try_into().unwrap();
    let sixteen: NonZero<u32> = 16_u32.try_into().unwrap();
    append_wots_word(message.w0, ref digits, ref checksum, two8, sixteen);
    append_wots_word(message.w1, ref digits, ref checksum, two8, sixteen);
    append_wots_word(message.w2, ref digits, ref checksum, two8, sixteen);
    append_wots_word(message.w3, ref digits, ref checksum, two8, sixteen);
    digits.append((checksum / 256) % 16);
    digits.append((checksum / 16) % 16);
    digits.append(checksum % 16);
    digits
}

fn wots_pk_from_sig(signature: Span<Node>, message: Node, prefix: Box<[u32; 8]>, mut a: Adrs) -> Node {
    let mut digits = wots_digits(message).span();
    let mut signature = signature;
    let mut endpoints = array![];
    a.chain_or_height = 0;
    while let Some(start) = digits.pop_front() {
        let mut node = *signature.pop_front().unwrap();
        // The hash index j sits in the high byte of its word: step it by 2^24.
        let mut word = *start * 0x1000000;
        while word != 0x0f000000 {
            a.hash_or_index = word;
            node = f_hash(prefix, a, node);
            word += 0x1000000;
        }
        endpoints.append(node);
        a.chain_or_height += 0x1000000;
    }
    a.kind = WOTS_PK_WORD;
    a.chain_or_height = 0;
    a.hash_or_index = 0;
    t_hash(prefix, a, endpoints.span())
}

fn xmss_pk_from_sig(
    leaf_index: u32, signature: Span<Node>, message: Node, prefix: Box<[u32; 8]>, mut a: Adrs,
) -> Node {
    let two8: NonZero<u32> = 0x100_u32.try_into().unwrap();
    a.kind = WOTS_HASH_WORD;
    a.key_pair = swap16(leaf_index, two8);
    let mut node = wots_pk_from_sig(signature.slice(0, WOTS_LEN), message, prefix, a);

    a.kind = TREE_WORD;
    a.key_pair = 0;
    let mut node_index = leaf_index;
    let two: NonZero<u32> = 2_u32.try_into().unwrap();
    let mut height = 0;
    while height != XMSS_HEIGHT {
        a.chain_or_height = (height + 1) * 0x1000000;
        let auth = *signature.at(WOTS_LEN + height);
        let (parent_index, is_right) = DivRem::div_rem(node_index, two);
        a.hash_or_index = swap16(parent_index, two8);
        if is_right == 0 {
            node = h_hash(prefix, a, node, auth);
        } else {
            node = h_hash(prefix, a, auth, node);
        }
        node_index = parent_index;
        height += 1;
    }
    node
}

fn fors_pk_from_sig(signature: Span<Node>, md: Span<u32>, prefix: Box<[u32; 8]>, mut a: Adrs) -> Node {
    let indices = fors_indices(md);
    let mut roots = array![];
    let two: NonZero<u32> = 2_u32.try_into().unwrap();
    let two8: NonZero<u32> = 0x100_u32.try_into().unwrap();
    let mut i = 0;
    while i != FORS_TREES {
        let index = *indices.at(i);
        let mut node_index = i * FORS_TREE_SIZE + index;
        a.chain_or_height = 0;
        a.hash_or_index = swap16(node_index, two8);
        let mut node = f_hash(prefix, a, *signature.at(i * 13));
        let mut height = 0;
        while height != FORS_HEIGHT {
            a.chain_or_height = (height + 1) * 0x1000000;
            let auth = *signature.at(i * 13 + 1 + height);
            let (parent_index, is_right) = DivRem::div_rem(node_index, two);
            a.hash_or_index = swap16(parent_index, two8);
            if is_right == 0 {
                node = h_hash(prefix, a, node, auth);
            } else {
                node = h_hash(prefix, a, auth, node);
            }
            node_index = parent_index;
            height += 1;
        }
        roots.append(node);
        i += 1;
    }
    a.kind = FORS_ROOTS_WORD;
    a.chain_or_height = 0;
    a.hash_or_index = 0;
    t_hash(prefix, a, roots.span())
}

fn read_be_u64(mut bytes: Span<u32>) -> u64 {
    let mut value: u64 = 0;
    while let Some(byte) = bytes.pop_front() {
        value = value * 256 + (*byte).into();
    }
    value
}

fn read_be_u32(mut bytes: Span<u32>) -> u32 {
    let mut value: u32 = 0;
    while let Some(byte) = bytes.pop_front() {
        value = value * 256 + *byte;
    }
    value
}

fn hypertree_root(
    signature: Span<Node>, message: Node, prefix: Box<[u32; 8]>, mut tree_index: u64, mut leaf_index: u32,
) -> Node {
    let two8: NonZero<u32> = 0x100_u32.try_into().unwrap();
    let mut node = xmss_pk_from_sig(
        leaf_index,
        signature.slice(0, XMSS_SIG_NODES),
        message,
        prefix,
        layer_address(0, tree_index, two8),
    );
    let mut layer = 1;
    while layer != HT_LAYERS {
        leaf_index = (tree_index % 512).try_into().unwrap();
        tree_index /= 512;
        node =
            xmss_pk_from_sig(
                leaf_index,
                signature.slice(layer * XMSS_SIG_NODES, XMSS_SIG_NODES),
                node,
                prefix,
                layer_address(layer, tree_index, two8),
            );
        layer += 1;
    }
    node
}

fn decode_signature(mut encoded: Span<felt252>, two32: NonZero<u128>) -> Option<Array<Node>> {
    let mut decoded = array![];
    while let Some(value) = encoded.pop_front() {
        let node: u128 = match (*value).try_into() {
            Some(node) => node,
            None => { return None; },
        };
        decoded.append(split_u128(node, two32));
    }
    Some(decoded)
}

/// Verifies a pure SLH-DSA-BLAKE2s-128s signature with an empty context (non-standard).
///
/// `message_hash` is serialized as a 32-byte big-endian message. `public_key` is
/// `PK.seed || PK.root` (2 felts), and `signature` is the 491-element signature
/// (`R || SIG_FORS || SIG_HT`), each felt holding one 16-byte element in little-endian
/// byte order. Malformed lengths and values outside `u128` are rejected.
pub impl SlhDsaBlake2s128sVerifier of PqSignatureVerifier {
    fn verify(message_hash: felt252, public_key: Span<felt252>, signature: Span<felt252>) -> bool {
        if public_key.len() != PUBKEY_FELTS || signature.len() != SIG_FELTS {
            return false;
        }
        let pk_seed: u128 = match (*public_key.at(0)).try_into() {
            Some(value) => value,
            None => { return false; },
        };
        let pk_root: u128 = match (*public_key.at(1)).try_into() {
            Some(value) => value,
            None => { return false; },
        };
        let two32: NonZero<u128> = 0x100000000_u128.try_into().unwrap();
        let signature = match decode_signature(signature, two32) {
            Some(value) => value,
            None => { return false; },
        };
        let pk_seed = split_u128(pk_seed, two32);
        let pk_root = split_u128(pk_root, two32);

        let digest = h_msg(message_hash, *signature.at(0), pk_seed, pk_root);
        let prefix = compute_prefix_state(pk_seed);
        let tree_index = read_be_u64(digest.span().slice(21, 7)) & TREE_MASK;
        let leaf_index = read_be_u32(digest.span().slice(28, 2)) & LEAF_MASK;

        let two8: NonZero<u32> = 0x100_u32.try_into().unwrap();
        let mut a = layer_address(0, tree_index, two8);
        a.kind = FORS_TREE_WORD;
        a.key_pair = swap16(leaf_index, two8);
        let fors_pk = fors_pk_from_sig(
            signature.span().slice(1, FORS_SIG_NODES), digest.span().slice(0, 21), prefix, a,
        );
        let root = hypertree_root(
            signature.span().slice(HT_SIG_OFFSET, SIG_FELTS - HT_SIG_OFFSET),
            fors_pk,
            prefix,
            tree_index,
            leaf_index,
        );
        root.w0 == pk_root.w0
            && root.w1 == pk_root.w1
            && root.w2 == pk_root.w2
            && root.w3 == pk_root.w3
    }
}
