/**
 * The signer seam picks a backend by account kind before any vault lookup, so a
 * paired-phone account must reach its own device queue and never the vault — and
 * must fail closed with nothing sent when that queue is not wired. Sits beside
 * the Ledger coverage because the risk is the same: a keyless account that falls
 * through to the vault would either sign with the wrong key or report a missing
 * one, and both are worse than refusing.
 */
import { describe, expect, test } from "bun:test";
import { mlDsa65Fixture } from "@mc-wallet/testkit/ml-dsa-fixtures";
import type { AccountRef, MobilePqAccountRef } from "@mc-wallet/wallet-model/accounts";
import { createMobilePqSignQueue } from "../../../apps/extension/src/background/devices/mobile-pq-signer";
import { accountHashSigner } from "../../../apps/extension/src/background/ledger/account-hash-signer";
import { createLedgerSignQueue } from "../../../apps/extension/src/background/ledger/ledger-sign-queue";

const HASH = "0x1e240";
const enrolled = mlDsa65Fixture(11);
const vaultPassphrase = "correct horse battery staple";

const account: MobilePqAccountRef = {
  accountContractType: "ml-dsa",
  mlDsaKind: "const",
  address: "0xabc111111",
  classHash: "0x111111",
  derivation: { deviceId: "phone-1", kind: "mobile-pq", transport: { kind: "clipboard" } },
  id: "SN_MAIN:0xabc111111",
  networkId: "SN_MAIN",
  publicKey: enrolled.publicKey,
  publicKeyX: "0x456",
};

// A live passive session: the keyless branch is chosen before any vault lookup,
// so the passphrase is never read — but the seam requires a real session so a
// caller cannot forget one and fail open.
const session = {
  generation: () => 1,
  isUnlocked: () => true,
  peekPassphrase: () => vaultPassphrase,
};

const vaultThatMustNotBeUsed = {
  signHash: async () => {
    throw new Error("the vault was reached for a keyless account");
  },
};

describe("accountHashSigner for a paired-phone account", () => {
  test("routes to the phone queue and returns the verified scheme-tagged signature", async () => {
    const mobilePqSignQueue = createMobilePqSignQueue();
    const sign = accountHashSigner(
      { mobilePqSignQueue, session, wallet: vaultThatMustNotBeUsed },
      account as AccountRef,
      vaultPassphrase,
    );

    const signing = sign(HASH);
    const parked = mobilePqSignQueue.pending();
    expect(parked).toHaveLength(1);
    expect(parked[0]).toMatchObject({ accountId: account.id, deviceId: "phone-1" });
    // ML-DSA signing is hedged, so two signatures over the same hash differ;
    // hold the one the device produced rather than re-signing to compare.
    const signature = enrolled.sign(HASH);
    expect(mobilePqSignQueue.settle(parked[0]?.id as string, { signature })).toBe(true);

    await expect(signing).resolves.toEqual({
      kind: "ml-dsa-65",
      publicKey: account.publicKey,
      signature,
    });
  });

  test("fails closed with nothing parked when no phone queue is wired", () => {
    expect(() =>
      accountHashSigner(
        { session, wallet: vaultThatMustNotBeUsed },
        account as AccountRef,
        vaultPassphrase,
      ),
    ).toThrow("Mobile signing unavailable");
  });

  test("a wired Ledger queue is no substitute for the phone queue", () => {
    // The two queues are distinct collaborators. A deployment with Ledger
    // support but no transport to a phone must refuse, not route the phone
    // account down the Ledger path and ask a device for a Stark signature.
    expect(() =>
      accountHashSigner(
        {
          ledgerSignQueue: createLedgerSignQueue(),
          session,
          wallet: vaultThatMustNotBeUsed,
        },
        account as AccountRef,
        vaultPassphrase,
      ),
    ).toThrow("Mobile signing unavailable");
  });

  test("a rejected device request rejects the submit instead of falling back", async () => {
    const mobilePqSignQueue = createMobilePqSignQueue();
    const sign = accountHashSigner(
      { mobilePqSignQueue, session, wallet: vaultThatMustNotBeUsed },
      account as AccountRef,
      vaultPassphrase,
    );
    const signing = sign(HASH);
    const parked = mobilePqSignQueue.pending();
    expect(mobilePqSignQueue.reject(parked[0]?.id as string, "user rejected")).toBe(true);
    await expect(signing).rejects.toThrow("user rejected");
  });
});
