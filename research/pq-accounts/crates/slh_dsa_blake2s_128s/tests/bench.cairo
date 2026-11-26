//! Benchmark and correctness scenarios for the SLH-DSA-BLAKE2s-128s spike.
//!
//! The paired benchmark builds identical inputs in both tests and subtracts the baseline
//! from the verifier call. Correctness is pinned by accepting two reference-generated
//! signatures and rejecting tampering of every part of a signature.

use pqbench_slh_dsa_blake2s_128s::SlhDsaBlake2s128sVerifier;
use pqbench_slh_dsa_blake2s_128s::fixtures::{
    message, message_2, public_key, public_key_2, signature, signature_2,
};

/// Builds the genuine fixture without invoking the verifier.
#[test]
fn bench_baseline_slh_dsa_blake2s_128s() {
    let pk = public_key();
    let sig = signature();
    assert!(pk.len() == 2 && sig.len() == 491);
}

/// Measures verification of a genuine SLH-DSA-BLAKE2s-128s signature.
#[test]
fn bench_verify_slh_dsa_blake2s_128s() {
    let valid = SlhDsaBlake2s128sVerifier::verify(
        message(), public_key().span(), signature().span(),
    );
    assert!(valid);
}

fn with_change(original: Array<felt252>, index: u32, delta: felt252) -> Array<felt252> {
    let mut out = array![];
    let mut i = 0;
    while i != original.len() {
        let value = *original.at(i);
        out.append(if i == index {
            value + delta
        } else {
            value
        });
        i += 1;
    }
    out
}

fn rejects_signature_change(index: u32) -> bool {
    !SlhDsaBlake2s128sVerifier::verify(
        message(), public_key().span(), with_change(signature(), index, 1).span(),
    )
}

#[test]
fn test_accepts_second_fixture() {
    assert!(SlhDsaBlake2s128sVerifier::verify(message_2(), public_key_2().span(), signature_2().span()));
}

#[test]
fn test_rejects_other_message() {
    assert!(!SlhDsaBlake2s128sVerifier::verify(message() + 1, public_key().span(), signature().span()));
    assert!(!SlhDsaBlake2s128sVerifier::verify(message_2(), public_key().span(), signature().span()));
}

#[test]
fn test_rejects_tampered_randomizer() {
    assert!(rejects_signature_change(0));
}

#[test]
fn test_rejects_tampered_fors_secret() {
    assert!(rejects_signature_change(1));
    assert!(rejects_signature_change(1 + 13 * 13));
}

#[test]
fn test_rejects_tampered_fors_auth_node() {
    assert!(rejects_signature_change(2));
    assert!(rejects_signature_change(1 + 13 * 7 + 12));
}

#[test]
fn test_rejects_tampered_layer0_wots() {
    assert!(rejects_signature_change(183));
    assert!(rejects_signature_change(183 + 34));
}

#[test]
fn test_rejects_tampered_auth_three_layers_up() {
    assert!(rejects_signature_change(183 + 3 * 44 + 35));
}

#[test]
fn test_rejects_tampered_top_layer() {
    assert!(rejects_signature_change(183 + 6 * 44));
    assert!(rejects_signature_change(490));
}

#[test]
fn test_rejects_tampered_public_key() {
    assert!(
        !SlhDsaBlake2s128sVerifier::verify(
            message(), with_change(public_key(), 0, 1).span(), signature().span(),
        ),
    );
    assert!(
        !SlhDsaBlake2s128sVerifier::verify(
            message(), with_change(public_key(), 1, 1).span(), signature().span(),
        ),
    );
}

#[test]
fn test_rejects_swapped_felts() {
    let original = signature();
    let mut swapped = array![];
    let mut i = 0;
    while i != original.len() {
        swapped.append(if i == 5 {
            *original.at(6)
        } else if i == 6 {
            *original.at(5)
        } else {
            *original.at(i)
        });
        i += 1;
    }
    assert!(!SlhDsaBlake2s128sVerifier::verify(message(), public_key().span(), swapped.span()));
}

#[test]
fn test_rejects_wrong_key() {
    assert!(!SlhDsaBlake2s128sVerifier::verify(message(), public_key_2().span(), signature().span()));
}

#[test]
fn test_rejects_out_of_range_felts() {
    let two128: felt252 = 0x100000000000000000000000000000000;
    assert!(
        !SlhDsaBlake2s128sVerifier::verify(
            message(), public_key().span(), with_change(signature(), 10, two128).span(),
        ),
    );
    assert!(
        !SlhDsaBlake2s128sVerifier::verify(
            message(), with_change(public_key(), 0, two128).span(), signature().span(),
        ),
    );
}

#[test]
fn test_rejects_bad_lengths() {
    assert!(
        !SlhDsaBlake2s128sVerifier::verify(
            message(), public_key().span().slice(0, 1), signature().span(),
        ),
    );
    assert!(
        !SlhDsaBlake2s128sVerifier::verify(
            message(), public_key().span(), signature().span().slice(0, 490),
        ),
    );
    let mut longer = signature();
    longer.append(0);
    assert!(!SlhDsaBlake2s128sVerifier::verify(message(), public_key().span(), longer.span()));
}
