---
layout: default
title: PQ signer — wallet
permalink: /pq-mobile-signer/wallet/
---

[Post-quantum mobile signer](../) · overview, milestones, and cross-cutting flows

# Part 1 — Wallet

The architecture already exists. `apps/extension/src/background/ledger/account-hash-signer.ts`
describes itself as *"the single seam that picks a hash-signing backend for a resolved account,
shared by every submitting path… Kept in one place so the choice can never drift."* This is a
fourth signer kind behind that seam, not a new flow.

## 1.1 Account model

`packages/foundation/wallet-model/src/accounts/accounts.ts`

Add a fourth variant to `AccountDerivation`, which is already
`Bip44Derivation | ImportedKeyDerivation | LedgerDerivation`:

```ts
export type MobilePqDerivation = {
  readonly kind: "mobile-pq";
  readonly deviceId: string;              // stable, non-secret
  readonly transport: TransportDescriptor; // how to reach the device again
};

export type MobilePqAccountRef = AccountRefCore & {
  readonly derivation: MobilePqDerivation;
  readonly publicKey: string;             // 1952 bytes, hex
};
```

Two consequences worth stating explicitly.

**`AccountRefIdentity.publicKeyX` cannot hold this key.** It is a single felt. The account
identity carries a Poseidon commitment over the packed public key, and the full key is stored
alongside it. Every consumer that reads `publicKeyX` to identify an account has to be checked.

**`isKeylessAccount` (`accounts.ts:488`) is currently `derivation.kind === "ledger"` and returns
`account is LedgerAccountRef`.** It becomes a union predicate over both keyless kinds, and callers
that relied on the narrowing need a second branch.

**There is no enumeration.** Ledger walks `accountIndex` along a derivation path. ML-DSA keys are
not derived, so "add another post-quantum account" means "generate another enclave key." The
re-pair flow presents the phone's key list rather than a range of indices.

## 1.2 Account contract type

**Missing from the first draft of this document, and load-bearing.** `AccountContractType` was
`"argent" | "openzeppelin"`, and the account model has no third option — so a paired-phone account
was first built claiming `openzeppelin`. That is wrong, and wrong in ways that reach the user:

- Six UI sites render `accountContractType === "argent" ? "Argent" : "OpenZeppelin"`, so the account
  would have been **labelled "OpenZeppelin" on screen** in the multisig pickers and deploy view.
- `deployment.ts` short-circuits the deployed-class check for `openzeppelin` and the vault resolves
  a missing class hash to the OpenZeppelin class, so the record asserted a deployment recipe and a
  contract that are not this account's.
- `hasValidContractMetadata` pins a class hash only for `argent`, so nothing objected to an
  `openzeppelin` record pointing at the stub's class.
- `serializeAccountSignature` branches on contract type. With no third type, the ML-DSA layout would
  have to branch on the *signature* kind inside the OpenZeppelin case — one decision split across
  two axes, which is how the drift AGENTS.md warns about starts.

So `AccountContractType` gains **`"ml-dsa"`**: an account whose on-chain `__validate__` checks
ML-DSA-65. Not `"mobile-pq"` — the derivation kind already means *a phone holds the key*, and the
contract type means *the chain validates ML-DSA*. A laptop enclave holding an ML-DSA key would be the
same contract with a different derivation, and collapsing the two axes would lose that.

### The trap, if you are following along

The codebase used `accountContractType !== "openzeppelin"` as a proxy for *"Argent-like, run
validation"* in four deployment and estimate paths. **Adding a union member does not make `!==` a
type error.** A new family silently inherited the validated-query path, which for this account means
`__validate__` verifying 1830 felts of dummy input and failing every fee review — the same
failure §1.7 is about, one path over.

Those four are now `usesValidatedQueryEstimate(family)`, backed by a
`Record<AccountContractFamily, boolean>` in `account-contracts.ts`. A record rather than a predicate
on purpose: adding a family fails to compile until it is answered, instead of defaulting.

Two other places were silently wrong for the same reason and are worth checking for whenever this
union grows: `canonicalAccountRef` hardcoded `{ accountContractType: "openzeppelin" }` for every
non-Argent family, rewriting the family on the way out of the migration boundary; and the six UI
ternaries are now one `accountContractLabel` record, so a family added later cannot be shown to the
user under another family's name.

Since ML-DSA cannot satisfy Argent's per-member `(r, s)` check, an `ml-dsa` account is also excluded
from multisig member selection by `canSignArgentMultisig` — offering one would let the user build a
multisig with a threshold it can never reach. It stays available as a funding source.

**Timing.** `accountContractType` is persisted, so adding a value is the same class of change as
adding the derivation: an older build reading a vault containing one fails closed. It therefore
belongs inside the v8 bump rather than needing a v9 later. It is **not** blocked on the account
contract track — only the pinned class hash and the constructor calldata are, and both fail closed
with an explicit error until they arrive.

## 1.3 Signature types

`packages/foundation/wallet-model/src/accounts/signing.ts` is thirteen lines and assumes two
scalars throughout:

```ts
export type StarkSignature = { publicKey: string; r: string; s: string };
export type DeviceSignature = Pick<StarkSignature, "r" | "s">;
```

An ML-DSA-65 signature is 1830 felts on this contract. The file is small; the call sites are not. Widen to
a discriminated union so existing Stark paths keep their shape and the compiler finds every site
that assumed `r`/`s`:

```ts
export type AccountSignature =
  | { kind: "stark"; publicKey: string; r: string; s: string }
  | { kind: "ml-dsa-65"; publicKey: string; signature: string };
```

`StarkHashSigner` (`@mc-wallet/starknet/provider`) returns `Promise<StarkSignature>` and becomes
`Promise<AccountSignature>`. This is the single most invasive change in part 1 and should land on
its own, ahead of everything else, with no behaviour change.

Once it returns an `AccountSignature`, the name `StarkHashSigner` is wrong. It was renamed to
`AccountHashSigner`, matching the `accountHashSigner` factory that builds it, and the previous
`AccountHashSigner` — the multisig-aggregate variant — became `AggregateHashSigner`.

## 1.4 Vault migration

`CURRENT_SCHEMA_VERSION` was 7 when this was written, and ARCHITECTURE.md still claimed v4; both
were corrected when v8 landed.

Following the workflow in ARCHITECTURE.md: bump to 8, add one adjacent step to `VAULT_MIGRATIONS`,
update validators for old, current, and invalid data, and exercise staging, verification, restart
recovery, and idempotence.

A `mobile-pq` account record has no `signingKeys` entry, exactly like a Ledger record. Non-HD
accounts already have two precedents (`imported-raw-key` and `ledger`), so this introduces no new
concept into the schema.

**Backup.** The JSON backup does not restore Ledger accounts and will not restore these. But the
phone is the backup: reinstall the extension, re-pair, the phone supplies its public key, the
address recomputes, the account is restored. This makes an **"add existing device account" path
mandatory, not optional** — without it a reinstall is indistinguishable from losing the phone.

## 1.5 The signer seam

`apps/extension/src/background/ledger/account-hash-signer.ts`

`accountHashSigner` branches on account kind before any vault lookup. Add a third branch, keeping
the existing fail-closed shape — a keyless account whose queue is not wired throws rather than
falling through to the vault.

The adapter mirrors `ledgerStarkHashSigner` (`ledger-signer.ts`, 58 lines):

```ts
export const mobilePqHashSigner =
  (
    account: MobilePqAccountRef,
    sign: MobilePqHashSigner,
    verify: MlDsaVerifier,
  ): AccountHashSigner =>
  async (messageHash) => {
    const { signature } = await sign({
      accountId: account.id,
      deviceId: account.derivation.deviceId,
      messageHash,
      publicKey: account.publicKey,
    });
    if (!(await verify(account.publicKey, messageHash, signature))) {
      throw new WalletError("Mobile signature verification failed");
    }
    return { kind: "ml-dsa-65", publicKey: account.publicKey, signature };
  };
```

**The verifier is injected, not imported.** It is `mlDsaVerify` from krusty-kms, reaching here as
`deps.mlDsa` on the device collaborators — the same `KmsPort` instance the vault used to derive this
account's address, so the key that authorises a signature and the key that determined the address
cannot come from two implementations. `accountHashSigner` refuses when it is absent rather than
returning an unverified signature; a test pins that.

As with the Ledger gate, verification is a public-key check rather than signing, so it does not
weaken "Krusty owns wallet crypto."

`MlDsaVerifier` is declared in `mobile-pq-signer.ts` rather than taken from the collaborators type,
because `device-queues.ts` already imports from this module and the reverse import would be a cycle
— `bun run check:cycles` catches it.

## 1.6 Sign queue

`apps/extension/src/background/ledger/ledger-sign-queue.ts`

Generalize rather than duplicate. The existing queue already provides everything needed: a parked
deferred promise, an injected bounded timeout, the captured unlock-session generation checked at
settle time, and `rejectAll` on explicit lock. A phone is a slower Ledger.

**Retune the timeout.** A Ledger round-trip is a button press. A phone round-trip is: notice the
prompt, pick up the phone, unlock it, open the app, authenticate, confirm. Both the timeout and
the probability of mid-signature session expiry rise materially, and the current values were
chosen for hardware.

## 1.7 Fee estimation must not prompt for biometrics

> **Superseded.** Earlier revisions of this document said the post-quantum account must take the
> `skipValidate` branch and must *not* take the Argent-style query path. That was right while the
> account contract rejected a dummy signature, and is wrong now: the contract tolerates a failing
> verdict under a query version, so the query path is both possible and necessary. The reasoning is
> recorded because the conclusion inverted.

The problem is real: estimating a fee normally runs the account's `__validate__`, which for this
family would mean a biometric prompt just to preview a fee.

`skipValidate` solves the prompt and breaks the estimate. This account's validation *is* nearly the
whole transaction — the packed key, the signature and its witnesses are 1830 felts, and verifying
them is around 96M gas — so an estimate that omits it under-quotes by roughly an order of magnitude
and the submission then fails on resource bounds the user already approved.

So the account takes the **query-version dummy** path instead, the same shape Argent uses: the
estimate runs as a query-version transaction (`2^128 + 3`) carrying
`mlDsaEstimationSignature(publicKey)`, the contract runs its **full** verifier — so the estimate
includes the real cost — and then tolerates the failing verdict. That tolerance cannot be abused,
because the sequencer never executes a query-version transaction.

The estimation dummy is a pure function of the public key, so it needs no signer, no stored fixture,
and no round trip to the phone.

`account-contracts.ts` makes the choice a table rather than a boolean, because there are three
answers and a boolean can only carry two:

```ts
export type EstimateMode = "argent-query" | "ml-dsa-query" | "skip-validate";

const ESTIMATE_MODE: Record<AccountContractFamily, EstimateMode> = {
  argent: "argent-query",
  "argent-multisig": "argent-query",
  "ml-dsa": "ml-dsa-query",
  openzeppelin: "skip-validate",
};
```

`estimatingAccountFor` is the single function every estimate path calls — invoke, deploy, and the
reviews that price them. One function on purpose: a review taken a different way from the submission
that follows it is not a ceiling on anything.

**Measured, end to end on a devnet:** deploy review 0.5053 STRK and invoke review 0.5046 STRK, each
with **zero biometric prompts**, then two prompts total — one per submitted transaction. The receipt
reports 224,246,400 L2 gas, which is devnet's inflated accounting; see the note on runner-dependent
gas in the shared contract.

> **This replaced a pinned floor**
>
> The first attempt kept `skipValidate` and floored the L2 gas bound with a constant
> (`ML_DSA_VALIDATE_L2_GAS`). It worked and was deleted: the constant was wrong the first time by
> more than half, it has to be re-measured whenever the verifier changes, and it is silently wrong on
> any runner whose accounting differs. Asking the node is exact everywhere.

## 1.8 Message shapes

A 3309-byte signature and a 1952-byte public key cross `chrome.runtime` messages and the
`BroadcastChannel` broker, both of which validate exact shapes against strict allowlists. Each
edit is trivial; the risk is that a missed one fails closed silently, in a path that only runs
with a real device attached.

Two messages, mirroring the Ledger pair: `wallet.mobilePqSignPending` lists what the background has
parked, and `wallet.completeMobilePqSign` carries back either the encoded signature or a rejection.
Both are panel-only — they are not in `DAPP_MESSAGES`, so they stay privileged by default — and both
are registered in the enforced key-boundary catalog, which fails the suite if a handled `wallet.*`
type is missing from it.

The length check is the point. `readCompleteMobilePqSignInput` requires exactly
`ML_DSA_65_SIGNATURE_BYTES`, because a truncated response that reached the verify gate would surface
as *"verification failed"* — indistinguishable from a wrong device, in a path that only runs with a
real phone attached.

**The `BroadcastChannel` broker is not touched.** That broker exists so a Ledger grant *window* can
reach a WebHID or Bluetooth device the side panel cannot hold. A clipboard transport needs no
window and no device handle: the panel reads and writes the base64url string itself. The broker
becomes relevant only if a transport later needs its own window, which the relay does not and BLE
would.

## 1.9 UI

Model on `packages/presentation/wallet-ui/src/sidepanel/journeys/ledger/`, which splits into
`onboard-*` and `sign-*` with a runtime / session / views separation.

- New account entry point: **"Post Quantum Secure with your Biometrics"**.
- `journeys/mobile/onboard-*` — pairing, proof of possession, funding, deploy.
- `journeys/mobile/sign-*` — waiting state, timeout, rejection, retry.

There is no paired-devices panel in this wallet today and this design does not add one. The vault
stores accounts, not devices; the connection is re-established per operation. That matches the
existing Ledger model, where cable devices reopen silently through Chrome's origin permission and
Bluetooth cannot.

`apps/ui-lab` renders production templates against deterministic fixtures, so both journeys can be
built and reviewed with no phone, no relay, and no working crypto.

### What was built, and what onboarding is waiting on

**`journeys/mobile/sign-*` is complete.** With a clipboard transport the user *is* the transport, so
the takeover does not sequence "copy" and "paste" into phases the user clicks through — both are on
screen at once, in one `handoff` phase, with `submitting` and `error` around it. Three phases, not
the Ledger's nine, because there is no device discovery, no transport to open, and no app version to
check.

Three details are load-bearing rather than cosmetic. The hash renders at full padded width in
*every* phase: the phone blind-signs at this milestone, so this screen is the only place a user can
see what a signature commits to. A paste that is not a well-formed ML-DSA-65 signature is refused in
the controller, before the round trip — otherwise it reaches the verify gate and comes back as
*"verification failed"*, which is what a wrong device looks like. And the screen is ordered by what
the user has to **do**: the request to copy leads, in its own block, and the hash below it carries no
copy control at all. It had one once, next to a value the app rejects — a copy button beside the
wrong thing is not a convenience, it is a trap.

The `mobile-pq-sign` ui-lab scenario renders all three states against a fixture carrying a real
1952-byte key and a real envelope. That is deliberate: a stubbed short key makes the copy affordance
look reasonable and hides the question this design actually has to answer, which is whether a person
will carry a string that size between two devices for every transaction.

**`journeys/mobile/onboard-*` is built, and the whole flow runs.** Registration is pairing → proof
of possession → derive the address from the key commitment → fund → deploy, and every step works:
the commitment is computed from the public key through krusty-kms, and a deploy-then-transfer cycle
has been driven end to end against a locally declared build of the account contract.

The enrollment form now asks for **one** value: the app's reply, which carries the device name, the
1952-byte public key and the signature over the challenge together. It once asked for five. The
`key_hash` went when the wallet started deriving the commitment itself; the class hash went when it
was pinned as `ML_DSA_ACCOUNT_CLASS_HASH`; the rest collapsed into the reply because a device that
can produce three values can produce them in one string. Each removal deletes a way to get an
unspendable address by typing.
The name the user typed on the phone becomes the account's name: enrollment writes it to the
same account-label preference the rename control uses, so the two devices call one account one
thing and the user can still change it. Both screens also render the felt they ask the user to
compare — the challenge here, the transaction hash on the signing takeover — through one block,
padded to the 32 bytes the phone signs and grouped in fours. The challenge was previously printed
at the wallet's own shorter spelling, so any felt with a leading zero read as a mismatch.

One rough edge remains, and it is not about crypto: **the enrollment challenge lives in
service-worker memory.** Chrome MV3 terminates the worker after roughly 30 seconds idle, and the user
is on their phone for much longer than that, so the challenge can evaporate mid-flow and enrollment
fails with a message that does not explain why. It belongs in `chrome.storage.session`. This is an
architectural constraint on the extension, not a detail — a phone-side flow must not be designed
longer than the extension can hold.

## 1.10 What does not change

Worth stating, because it is most of the system:

- Verify-before-broadcast — already the rule, already enforced for Ledger.
- The background parks a hash and re-checks the unlock generation — unchanged.
- Every submitting path (transfers, deploy, multisig, dapp invoke/declare, SNIP-12) routes through
  `accountHashSigner` and needs no per-path change.
- `sign-request-decode.ts` and the approvals journey continue to decode SNIP-12 for the
  extension-side review.
