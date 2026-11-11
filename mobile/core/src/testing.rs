//! Test-only hooks for the integration suite; not part of the FFI surface.

pub use crate::avatar::account_avatar;
pub use crate::privacy::testing as privacy;
pub use crate::security::{delay_ms, BASE_DELAY_MS, FREE_ATTEMPTS, MAX_DELAY_MS};
pub use crate::ui::passphrase_strength;
pub use crate::vault::{KDF_ITERATIONS, MIN_PASSWORD_LENGTH};
pub use crate::wallet::IDLE_LOCK_MS;

/// The scoped STRK20 viewing key the core derives for an account, for the extension-parity
/// suite only (fixture keys come from the published parity phrase and are public).
pub fn strk20_viewing_key(
    mnemonic: &str,
    account_index: u32,
    chain_id: &str,
    pool_address: &str,
) -> Result<String, crate::CoreError> {
    crate::kms::scoped_viewing_key(
        mnemonic,
        None,
        crate::kms::Ladder::Account,
        account_index,
        chain_id,
        pool_address,
    )
    .map(|key| key.expose_secret_hex().to_string())
}

/// The public key the published phrase derives at `index` on `ladder`, which a signable
/// deployed account reports as its owner.
pub fn ladder_public_key(
    mnemonic: &str,
    ladder: crate::kms::Ladder,
    index: u32,
) -> Result<String, crate::CoreError> {
    crate::kms::public_key(mnemonic, None, ladder, index).map(|key| crate::felt::canonical(&key))
}

/// The public viewing key this wallet would register at `index` on `ladder` in `network`'s
/// pool, and that pool's address; `None` when the network has no pool.
pub fn strk20_viewing_public_key(
    mnemonic: &str,
    ladder: crate::kms::Ladder,
    index: u32,
    network: crate::NetworkId,
) -> Option<(String, String)> {
    let pool = crate::felt::canonical(&crate::privacy::config::route_for(network)?.pool);
    let chain_id = &crate::networks::info(network).chain_id;
    let key = crate::kms::scoped_viewing_public_key(mnemonic, None, ladder, index, chain_id, &pool)
        .ok()?;
    Some((crate::felt::canonical(&key), pool))
}

/// The Braavos implementation a current deployment installs, a class this wallet signs for.
pub fn braavos_implementation_class() -> String {
    crate::felt::canonical(&crate::account_catalog::catalog().braavos_implementation)
}

/// Seals `plaintext` as a pre-container vault in `dir`: a bare envelope with scope
/// `bramble.mobile.vault.v1`, as the original core (payload version 1) and the accounts branch
/// before the merge (records payload, version 2) wrote it.
pub fn seal_envelope_vault(
    dir: &str,
    password: &str,
    plaintext: &str,
) -> Result<(), crate::CoreError> {
    crate::vault::check_password(password)?;
    let key = crate::vault::SealingKey::create(password)?;
    let envelope = key.seal_with(
        plaintext.as_bytes(),
        crate::container::V1_SCOPE,
        &crate::vault::random::<12>()?,
        &crate::vault::random::<16>()?,
    )?;
    write_vault(
        dir,
        &serde_json::to_vec(&envelope).expect("envelope serialises"),
    )
}

/// Seals `plaintext` into a DEK container of `version` in `dir`, as vault-security (version 2)
/// or this core (version 3) writes it.
pub fn seal_container_vault(
    dir: &str,
    password: &str,
    version: u32,
    plaintext: &str,
) -> Result<(), crate::CoreError> {
    crate::vault::check_password(password)?;
    let key = crate::vault::SealingKey::create(password)?;
    let dek = crate::container::new_dek()?;
    let randomness = crate::container::Randomness::draw()?;
    let file = crate::container::seal_new(&key, &dek, version, plaintext.as_bytes(), &randomness)?;
    let file = crate::container::VaultFile { version, ..file };
    write_vault(
        dir,
        &serde_json::to_vec(&file).expect("container serialises"),
    )
}

fn write_vault(dir: &str, body: &[u8]) -> Result<(), crate::CoreError> {
    let path = std::path::Path::new(dir).join(crate::wallet::VAULT_FILE);
    std::fs::write(path, body).map_err(|_| crate::CoreError::Storage {
        reason: "write vault".into(),
    })
}

/// Opens the wallet vault in `dir` (a current or older container) with the passphrase and
/// returns its decrypted payload JSON as stored, without migrating it.
pub fn open_vault(dir: &str, password: &str) -> Result<String, crate::CoreError> {
    let path = std::path::Path::new(dir).join(crate::wallet::VAULT_FILE);
    let json = std::fs::read_to_string(path).map_err(|_| crate::CoreError::NoWallet)?;
    let plaintext = match crate::container::parse(&json, crate::migrations::VAULT_VERSION)? {
        crate::container::StoredVault::Container(file) => {
            let (dek, _) = file.open_dek(password)?;
            file.open_payload(&dek)?
        }
        crate::container::StoredVault::Envelope(envelope) => {
            crate::vault::open(&envelope, password, crate::container::V1_SCOPE)?.0
        }
    };
    Ok(String::from_utf8(plaintext.to_vec()).expect("payload is UTF-8"))
}

/// Words one discovery row exactly as the scan would.
pub fn recovery_candidate(
    family: crate::AccountFamily,
    ladder: crate::kms::Ladder,
    class_hash: &str,
    account_index: u32,
    address: &str,
    deployed: bool,
    funded: bool,
) -> crate::RecoveryCandidate {
    crate::recovery::candidate(&wallet_core::accounts::scan::Found {
        family,
        ladder,
        class_hash: crate::felt::parse(class_hash).expect("class hash is a felt"),
        account_index,
        address: crate::felt::parse(address).expect("address is a felt"),
        deployed,
        funded,
        restriction: None,
        privacy_elsewhere: false,
    })
}

/// A deployed discovery row with the scan's advisory verdicts: `restriction` in the
/// extension's wire spelling (`"guardian"`, `"owner-changed"`, …) and the privacy-pool note.
pub fn deployed_recovery_candidate(
    family: crate::AccountFamily,
    ladder: crate::kms::Ladder,
    class_hash: &str,
    account_index: u32,
    address: &str,
    restriction: Option<&str>,
    privacy_elsewhere: bool,
) -> crate::RecoveryCandidate {
    use wallet_core::accounts::advisory::Restriction;
    let mut found = wallet_core::accounts::scan::Found {
        family,
        ladder,
        class_hash: crate::felt::parse(class_hash).expect("class hash is a felt"),
        account_index,
        address: crate::felt::parse(address).expect("address is a felt"),
        deployed: true,
        funded: false,
        restriction: None,
        privacy_elsewhere,
    };
    found.restriction = restriction.map(|wire| match wire {
        "guardian" => Restriction::Guardian,
        "owner-changed" => Restriction::OwnerChanged,
        "owner-type" => Restriction::OwnerType,
        "release" => Restriction::Release,
        "strong-signer" => Restriction::StrongSigner,
        other => panic!("unknown restriction {other}"),
    });
    crate::recovery::candidate(&found)
}

/// The coordination public key at Nostr address `index`. Parity suites use the published
/// test phrase's address 1 as the co-signer, so no second phrase appears in the repository.
pub fn nostr_public_key_at(mnemonic: &str, index: u32) -> Result<String, crate::CoreError> {
    crate::nostr::public_key_at(mnemonic, index)
}

/// Opens a gift wrap for the coordination key at Nostr address `index`:
/// `(content, identifier, sender)`.
pub fn open_gift_wrap(
    mnemonic: &str,
    index: u32,
    event_json: &str,
) -> Option<(String, String, String)> {
    let event = crate::nostr::parse_event_json(event_json)?;
    let opened = crate::nostr::open_at(mnemonic, index, &event)?;
    Some((opened.content, opened.identifier, opened.sender_public_key))
}

/// Wraps application data from the coordination key at Nostr address `index`.
pub fn wrap_gift(
    mnemonic: &str,
    index: u32,
    recipient: &str,
    identifier: &str,
    content: &str,
    now: u64,
) -> Result<String, crate::CoreError> {
    crate::nostr::wrap(mnemonic, index, recipient, identifier, content, now)
}

/// The sync judge and the publish, which no FFI call exposes on their own (the sync judge sits
/// inside `NostrSyncPlan`; publishing is deferred), for the coordination parity suite against the
/// extension.
pub use crate::nostr_relay::{publish_many, SyncJudge};

/// The sender rule inside `coordination::is_trusted`, which no FFI call exposes on its own: whether
/// a `bramble.multisig` package from `sender` naming a multisig on `network_id` is trusted, given
/// the saved `contacts` (address-book entries as JSON) and a snapshot whose signer set (ascending
/// canonical GUIDs) equals the record's stored authority.
pub fn coordination_sender_trusted(
    contacts_json: &str,
    network_id: &str,
    sender: &str,
    signer_guids: &[String],
) -> bool {
    let contacts: Vec<crate::contacts::Entry> =
        serde_json::from_str(contacts_json).expect("address-book entries");
    let class_hash = crate::argent_multisig::class_hash();
    let record = crate::multisig_store::Record {
        account_contract_type: "argent-multisig".into(),
        address: "0x123".into(),
        class_hash: class_hash.into(),
        current_config: None,
        deployment: None,
        id: format!("{network_id}:0x123"),
        name: None,
        network_id: network_id.into(),
    };
    let snapshot =
        serde_json::json!({"classHash": class_hash, "signerGuids": signer_guids, "threshold": 1});
    let content = serde_json::json!({"intent": {"accountId": record.id, "configSnapshot": snapshot},
        "kind": "bramble.argent-multisig-intent", "version": 1});
    let opened = crate::nostr::NostrApplicationData {
        content: content.to_string(),
        identifier: crate::multisig_constants::get()
            .coordination
            .identifier
            .clone(),
        sender_public_key: sender.into(),
    };
    let authority = crate::multisig_store::Authority {
        threshold: 1,
        signer_guids: signer_guids.to_vec(),
    };
    crate::coordination::is_trusted(&opened, &contacts, &record, Some(&authority))
}
