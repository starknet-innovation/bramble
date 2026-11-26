//! Tests for the SNIP-36 harness: the probe checks real SLH-DSA signatures (BLAKE2s and
//! SHAKE) through the user's account and sends the committed message; the consumer accepts
//! only matching, fresh, virtual-OS proof facts. The proof itself is out of scope here: the
//! facts are injected with `cheat_proof_facts`, as the sequencer would expose them after
//! verifying a proof.

use core::poseidon::poseidon_hash_span;
use pq_accounts::snip36::consumer::{
    IPqAuthConsumerDispatcher, IPqAuthConsumerDispatcherTrait, IPqAuthConsumerSafeDispatcher,
    IPqAuthConsumerSafeDispatcherTrait,
};
use pq_accounts::snip36::proof_facts::{
    VIRTUAL_SNOS, VIRTUAL_SNOS0, message_hash, message_payload,
};
use pq_accounts::utils::interface::{
    IPqAccountDispatcher, IPqAccountDispatcherTrait, IPqAccountSafeDispatcher,
    IPqAccountSafeDispatcherTrait,
};
use snforge_std::{
    CheatSpan, ContractClassTrait, DeclareResultTrait, MessageToL1, MessageToL1SpyAssertionsTrait,
    cheat_block_number, cheat_caller_address, cheat_proof_facts, cheat_resource_bounds,
    cheat_signature, cheat_tip,
    cheat_transaction_hash, declare, spy_messages_to_l1,
};
use starknet::account::Call;
use starknet::{ContractAddress, ResourcesBounds};

use super::signer_vector;
use pqbench_slh_dsa_blake2s_128s::fixtures as blake;
use pqbench_slh_dsa_shake_128s::fixtures as shake;

const BASE_BLOCK: u64 = 1000;
const VALIDITY: u64 = 64;

fn deploy(name: ByteArray, calldata: Array<felt252>) -> ContractAddress {
    let class = declare(name).unwrap().contract_class();
    let (address, _) = class.deploy(@calldata).unwrap();
    address
}

fn deploy_account(name: ByteArray, public_key: Array<felt252>) -> ContractAddress {
    let mut calldata = array![];
    public_key.serialize(ref calldata);
    deploy(name, calldata)
}

fn payload() -> Array<felt252> {
    array!['pq-snip36', 42, 7]
}

fn authorize_call(probe: ContractAddress, user: ContractAddress, payload: Span<felt252>) -> Call {
    let mut calldata = array![];
    user.serialize(ref calldata);
    payload.serialize(ref calldata);
    Call { to: probe, selector: selector!("authorize"), calldata: calldata.span() }
}

/// Sets up the probe as the protocol would run it: caller zero, the given hash and signature.
fn as_virtual_tx(probe: ContractAddress, tx_hash: felt252, signature: Span<felt252>) {
    cheat_caller_address(probe, 0.try_into().unwrap(), CheatSpan::Indefinite);
    cheat_transaction_hash(probe, tx_hash, CheatSpan::Indefinite);
    cheat_signature(probe, signature, CheatSpan::Indefinite);
}

fn assert_probe_approves(account: ByteArray, public_key: Array<felt252>, tx_hash: felt252, signature: Array<felt252>) {
    let user = deploy_account(account, public_key);
    let probe = deploy("PqAuthProbe", array![]);
    as_virtual_tx(probe, tx_hash, signature.span());
    let mut spy = spy_messages_to_l1();

    IPqAccountDispatcher { contract_address: probe }
        .__execute__(array![authorize_call(probe, user, payload().span())]);

    let expected = MessageToL1 {
        to_address: 0.try_into().unwrap(), payload: message_payload(user, payload().span()),
    };
    spy.assert_sent(@array![(probe, expected)]);
}

#[feature("safe_dispatcher")]
fn probe_error(account: ByteArray, public_key: Array<felt252>, tx_hash: felt252, signature: Array<felt252>) -> felt252 {
    let user = deploy_account(account, public_key);
    let probe = deploy("PqAuthProbe", array![]);
    as_virtual_tx(probe, tx_hash, signature.span());
    let dispatcher = IPqAccountSafeDispatcher { contract_address: probe };
    match dispatcher.__execute__(array![authorize_call(probe, user, payload().span())]) {
        Result::Ok(_) => 'NO_ERROR',
        Result::Err(data) => *data.at(0),
    }
}

fn tampered(mut signature: Array<felt252>, index: u32) -> Array<felt252> {
    let mut out = array![];
    let mut i = 0;
    while let Some(felt) = signature.pop_front() {
        out.append(if i == index { felt + 1 } else { felt });
        i += 1;
    }
    out
}

#[test]
fn probe_approves_blake2s_signature() {
    assert_probe_approves("SlhDsaBlake2s128sAccount", blake::public_key(), blake::message(), blake::signature());
}

#[test]
fn probe_approves_shake_signature() {
    assert_probe_approves("SlhDsaShake128sAccount", shake::public_key(), shake::message(), shake::signature());
}

#[test]
fn probe_approves_shake_signature_from_python_signer() {
    assert_probe_approves(
        "SlhDsaShake128sAccount",
        signer_vector::public_key(),
        signer_vector::message(),
        signer_vector::signature(),
    );
}

#[test]
fn probe_refuses_tampered_blake2s_signature() {
    let err = probe_error("SlhDsaBlake2s128sAccount", blake::public_key(), blake::message(), tampered(blake::signature(), 200));
    assert_eq!(err, 'INVALID_SIGNATURE');
}

#[test]
fn probe_refuses_tampered_shake_signature() {
    let err = probe_error("SlhDsaShake128sAccount", shake::public_key(), shake::message(), tampered(shake::signature(), 200));
    assert_eq!(err, 'INVALID_SIGNATURE');
}

#[test]
fn probe_refuses_signature_over_another_hash() {
    let err = probe_error("SlhDsaBlake2s128sAccount", blake::public_key(), blake::message() + 1, blake::signature());
    assert_eq!(err, 'INVALID_SIGNATURE');
}

#[test]
#[feature("safe_dispatcher")]
fn probe_runs_only_for_the_protocol_and_one_authorize_call() {
    let probe = deploy("PqAuthProbe", array![]);
    let user: ContractAddress = 'user'.try_into().unwrap();
    let dispatcher = IPqAccountSafeDispatcher { contract_address: probe };

    // Not the protocol.
    let err = dispatcher.__execute__(array![authorize_call(probe, user, payload().span())]).unwrap_err();
    assert_eq!(*err.at(0), 'Account: invalid caller');

    cheat_caller_address(probe, 0.try_into().unwrap(), CheatSpan::Indefinite);
    let two = array![authorize_call(probe, user, payload().span()), authorize_call(probe, user, payload().span())];
    assert_eq!(*dispatcher.__execute__(two).unwrap_err().at(0), 'ONE_CALL_ONLY');

    let elsewhere = Call { to: user, selector: selector!("authorize"), calldata: array![].span() };
    assert_eq!(*dispatcher.__execute__(array![elsewhere]).unwrap_err().at(0), 'CALL_SELF_ONLY');

    let other = Call { to: probe, selector: selector!("transfer"), calldata: array![].span() };
    assert_eq!(*dispatcher.__execute__(array![other]).unwrap_err().at(0), 'AUTHORIZE_ONLY');
}

#[test]
#[feature("safe_dispatcher")]
fn probe_validate_requires_zero_fees() {
    let probe = deploy("PqAuthProbe", array![]);
    let dispatcher = IPqAccountSafeDispatcher { contract_address: probe };
    cheat_caller_address(probe, 0.try_into().unwrap(), CheatSpan::Indefinite);
    let bounds = |price: u128| array![
        ResourcesBounds { resource: 'L1_GAS', max_amount: 0, max_price_per_unit: 0 },
        ResourcesBounds { resource: 'L2_GAS', max_amount: 100_000_000, max_price_per_unit: price },
        ResourcesBounds { resource: 'L1_DATA', max_amount: 0, max_price_per_unit: 0 },
    ];
    cheat_resource_bounds(probe, bounds(0).span(), CheatSpan::Indefinite);
    assert_eq!(dispatcher.__validate__(array![]).unwrap(), starknet::VALIDATED);
    cheat_resource_bounds(probe, bounds(1).span(), CheatSpan::Indefinite);
    assert_eq!(*dispatcher.__validate__(array![]).unwrap_err().at(0), 'NON_ZERO_RESOURCE_PRICE');
    cheat_resource_bounds(probe, bounds(0).span(), CheatSpan::Indefinite);
    cheat_tip(probe, 1, CheatSpan::Indefinite);
    assert_eq!(*dispatcher.__validate__(array![]).unwrap_err().at(0), 'NON_ZERO_TIP');
}

// Consumer.

fn facts(probe: ContractAddress, user: ContractAddress, payload: Span<felt252>) -> Array<felt252> {
    facts_with(VIRTUAL_SNOS, BASE_BLOCK, array![message_hash(probe, message_payload(user, payload).span())])
}

fn facts_with(variant: felt252, base_block: u64, hashes: Array<felt252>) -> Array<felt252> {
    let mut out = array![
        'PROOF0', variant, 'program-hash', VIRTUAL_SNOS0, base_block.into(), 'block-hash',
        'config-hash',
    ];
    hashes.span().serialize(ref out);
    out
}

fn consumer_setup() -> (ContractAddress, ContractAddress, ContractAddress) {
    let probe: ContractAddress = 'probe'.try_into().unwrap();
    let user: ContractAddress = 'user'.try_into().unwrap();
    let consumer = deploy("PqAuthConsumer", array![probe.into(), VALIDITY.into()]);
    cheat_block_number(consumer, BASE_BLOCK + 1, CheatSpan::Indefinite);
    (probe, user, consumer)
}

#[feature("safe_dispatcher")]
fn apply_error(consumer: ContractAddress, user: ContractAddress, facts: Array<felt252>) -> felt252 {
    cheat_proof_facts(consumer, facts.span(), CheatSpan::Indefinite);
    let dispatcher = IPqAuthConsumerSafeDispatcher { contract_address: consumer };
    match dispatcher.apply(user, payload().span()) {
        Result::Ok(_) => 'NO_ERROR',
        Result::Err(data) => *data.at(0),
    }
}

#[test]
fn consumer_applies_a_matching_proof_once() {
    let (probe, user, consumer) = consumer_setup();
    cheat_proof_facts(consumer, facts(probe, user, payload().span()).span(), CheatSpan::Indefinite);
    let dispatcher = IPqAuthConsumerDispatcher { contract_address: consumer };
    dispatcher.apply(user, payload().span());
    assert_eq!(dispatcher.applied_count(user), 1);
    assert!(dispatcher.is_applied(poseidon_hash_span(payload().span())));
    assert_eq!(apply_error(consumer, user, facts(probe, user, payload().span())), 'ALREADY_APPLIED');
}

#[test]
fn consumer_refuses_missing_or_malformed_facts() {
    let (probe, user, consumer) = consumer_setup();
    assert_eq!(apply_error(consumer, user, array![]), 'EMPTY_PROOF_FACTS');
    let mut trailing = facts(probe, user, payload().span());
    trailing.append(0);
    assert_eq!(apply_error(consumer, user, trailing), 'TRAILING_PROOF_FACTS');
}

#[test]
fn consumer_refuses_other_programs_and_stale_proofs() {
    let (probe, user, consumer) = consumer_setup();
    let hash = message_hash(probe, message_payload(user, payload().span()).span());
    assert_eq!(apply_error(consumer, user, facts_with('SNOS', BASE_BLOCK, array![hash])), 'NOT_VIRTUAL_SNOS');
    assert_eq!(apply_error(consumer, user, facts_with(VIRTUAL_SNOS, BASE_BLOCK + 1, array![hash])), 'BASE_BLOCK_NOT_PAST');
    cheat_block_number(consumer, BASE_BLOCK + VALIDITY + 1, CheatSpan::Indefinite);
    assert_eq!(apply_error(consumer, user, facts_with(VIRTUAL_SNOS, BASE_BLOCK, array![hash])), 'PROOF_EXPIRED');
}

#[test]
fn consumer_refuses_messages_for_anyone_or_anything_else() {
    let (probe, user, consumer) = consumer_setup();
    let other_user: ContractAddress = 'other-user'.try_into().unwrap();
    let other_probe: ContractAddress = 'other-probe'.try_into().unwrap();
    // A proof for another user, from another sender, or with an extra message.
    assert_eq!(apply_error(consumer, user, facts(probe, other_user, payload().span())), 'PROOF_MESSAGE_MISMATCH');
    assert_eq!(apply_error(consumer, user, facts(other_probe, user, payload().span())), 'PROOF_MESSAGE_MISMATCH');
    let hash = message_hash(probe, message_payload(user, payload().span()).span());
    assert_eq!(apply_error(consumer, user, facts_with(VIRTUAL_SNOS, BASE_BLOCK, array![hash, hash])), 'PROOF_MESSAGE_MISMATCH');
    // A proof for another payload.
    let other_payload = array!['pq-snip36', 42, 8];
    assert_eq!(apply_error(consumer, user, facts(probe, user, other_payload.span())), 'PROOF_MESSAGE_MISMATCH');
}

#[test]
fn message_hash_matches_the_privacy_pool_formula() {
    // Poseidon over [from, to = 0, payload_len, ...payload], as the pool's compute_message_hash.
    let from: ContractAddress = 'probe'.try_into().unwrap();
    let payload = array![5, 6];
    assert_eq!(message_hash(from, payload.span()), poseidon_hash_span(array![from.into(), 0, 2, 5, 6].span()));
}
