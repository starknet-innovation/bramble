# Braavos accounts on mobile

Braavos records send and deploy as the extension does. Discovery, naming and the one signing gate
are in [accounts.md](accounts.md) §2.7; this is the transaction path.

Braavos records use the same `TransferPlan`, following `braavos-compatibility.ts`,
`braavos-deployment-gate.ts`, `deployment.ts` and `account-signer.ts`:

- **Signature.** A bare `[r, s]` over Krusty's invoke hash, as for OpenZeppelin; invoke estimates
  skip validation and carry no signature.
- **Account state before estimating or signing** (`send/plan_probe.rs`). The accepted block, then
  the class at that block, which must be an implementation this wallet signs for
  (`BRAAVOS_SIGNING_CLASS_HASHES`: current or legacy). Then `get_signers` at that block: this
  wallet's key must be the first Stark signer. If a 2FA (secp256r1 or WebAuthn) signer exists,
  `get_deferred_remove_signers` and the block's timestamp are read, and the account is signed for
  only once the requested removal has expired by that timestamp.
- **Deploy first.** An undeployed Braavos account never deploys inside a send: the review fails
  with `BraavosDeployFirst` ("Deploy this account first (Settings → Deploy account)."). The base
  class cannot deploy at all (`BraavosNotDeployable`).
- **Deployment.** Only at the modern deployment class (`BRAAVOS_DEPLOYMENT_CLASS_HASH`), with the
  public key as salt and sole constructor argument, checked to reproduce the stored address. The
  signature is the extended authorization `[r, s, ...params, aux_r, aux_s]`: `params` are the
  11 `AdditionalDeploymentParams` felts (the implementation to install, no secp256r1 signer, no
  multisig or limits, the chain id) and `(aux_r, aux_s)` signs `poseidon(params)`. The parameters
  are signed before the transaction hash, as the extension signs them.
- **Estimates validate, signed for real.** The Braavos constructor checks the deploy authorization
  even in an estimate, so the deployment estimate carries a real signature over the
  query-version hash, which can never be broadcast. This is the one place a review signs: two
  hashes at review, two again at confirmation's re-estimate, then two for the deployment.
  Krusty hashes only version 3, so `send/sign.rs` composes the query-version hash itself; a unit
  test pins that composition to Krusty's at version 3, and the parity fixture pins the query hash.
- **Refusals.** The review step fails with the extension's sentence, before any estimate or
  signature: `BraavosDeployFirst`, `BraavosNotDeployable`, `BraavosClassUnrecognised`,
  `BraavosOwnerMismatch`, `BraavosStrongSigner`, and `BraavosSignerListMalformed` when
  `get_signers` does not parse. A signer change after a clean review is still refused at
  confirmation. Ready's review stays a fee-failed screen.
- **Multisig.** Braavos keys are still not offered as Nostr multisig co-signers.

Parity: `scripts/mobile-transactions-braavos.ts` runs the extension's own path for the published
phrase's Braavos account (deployed sends on both networks, the legacy implementation, an expired
2FA removal, standalone deployment on both networks) and each refusal, into
`tests/fixtures/extension-transactions-braavos*.json`. `tests/transactions_braavos_parity.rs`
replays it request by request and requires the same bodies, signature arrays, signed-hash count
and transaction hashes.
