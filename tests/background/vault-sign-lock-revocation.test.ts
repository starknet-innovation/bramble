/**
 * Lock revokes in-flight vault signing (MCW-V09-113). The Ledger queue already
 * binds a parked device sign to the unlock generation that authorized it and
 * rejects at settle time if that boundary moved. These checks hold the vault
 * signer to the same contract, so both product lines behave identically: a
 * signature is never produced — or handed back for broadcast — under a session
 * the user has locked, that expired, or that was replaced by a re-unlock.
 */
import { describe, expect, test } from "bun:test";
import { accountHashSigner } from "../../apps/extension/src/background/ledger/account-hash-signer";
import { createUnlockSession } from "../../apps/extension/src/background/runtime/session";
import { account, createWallet, vaultPassphrase } from "../support/background-wallet-stub";

const MESSAGE_HASH = "0x9a";
const TTL_MS = 1_000;
const UNLOCKED_AT = 1_000;

describe("vault hash signer is bound to its unlock session", () => {
  test("signs while the authorizing session is still live", async () => {
    const session = createUnlockSession({ now: () => UNLOCKED_AT, ttlMs: TTL_MS });
    session.unlock(vaultPassphrase);
    const signHash = accountHashSigner(
      { session, wallet: createWallet() },
      account,
      vaultPassphrase,
    );

    await expect(signHash(MESSAGE_HASH)).resolves.toEqual({
      publicKey: "0xabc",
      r: "0x1",
      s: "0x2",
    });
  });

  test("rejects a KMS signature for a different public key", async () => {
    const session = createUnlockSession({ now: () => UNLOCKED_AT, ttlMs: TTL_MS });
    session.unlock(vaultPassphrase);
    const wallet = createWallet();
    const signHash = accountHashSigner(
      {
        session,
        wallet: {
          ...wallet,
          async signHash() {
            return { publicKey: "0xdef", r: "0x1", s: "0x2" };
          },
        },
      },
      account,
      vaultPassphrase,
    );

    await expect(signHash(MESSAGE_HASH)).rejects.toThrow("Krusty KMS signature key mismatch");
  });

  test("refuses to touch the vault after an explicit lock", async () => {
    const session = createUnlockSession({ now: () => UNLOCKED_AT, ttlMs: TTL_MS });
    session.unlock(vaultPassphrase);
    let vaultReads = 0;
    const signHash = accountHashSigner(
      {
        session,
        wallet: createWallet({
          captureSign: () => {
            vaultReads += 1;
          },
        }),
      },
      account,
      vaultPassphrase,
    );

    session.lock();

    await expect(signHash(MESSAGE_HASH)).rejects.toThrow("wallet locked");
    expect(vaultReads).toBe(0);
  });

  test("withholds a signature produced while the user was locking", async () => {
    const session = createUnlockSession({ now: () => UNLOCKED_AT, ttlMs: TTL_MS });
    session.unlock(vaultPassphrase);
    // The vault answers, but the user locks before the signature comes back —
    // the same race the Ledger queue closes at settle time.
    const signHash = accountHashSigner(
      { session, wallet: createWallet({ captureSign: () => session.lock() }) },
      account,
      vaultPassphrase,
    );

    await expect(signHash(MESSAGE_HASH)).rejects.toThrow("wallet locked");
  });

  test("refuses after the inactivity window expires", async () => {
    let now = UNLOCKED_AT;
    const session = createUnlockSession({ now: () => now, ttlMs: TTL_MS });
    session.unlock(vaultPassphrase);
    const signHash = accountHashSigner(
      { session, wallet: createWallet() },
      account,
      vaultPassphrase,
    );

    now = UNLOCKED_AT + TTL_MS + 1;

    await expect(signHash(MESSAGE_HASH)).rejects.toThrow("wallet locked");
  });

  test("refuses under a replacement unlock, not just a lock", async () => {
    const session = createUnlockSession({ now: () => UNLOCKED_AT, ttlMs: TTL_MS });
    session.unlock(vaultPassphrase);
    const signHash = accountHashSigner(
      { session, wallet: createWallet() },
      account,
      vaultPassphrase,
    );

    // Same passphrase, new session boundary: the authorization the signer was
    // built under is gone, so the generation check must still reject.
    session.lock();
    session.unlock(vaultPassphrase);

    await expect(signHash(MESSAGE_HASH)).rejects.toThrow("wallet locked");
  });

  // `AccountHashSignerDeps.session` is required, so "the caller forgot to pass
  // a session" is a compile error rather than a signer that silently trusts the
  // captured passphrase forever. The runtime half of that contract is that a
  // signer built under an already-locked session can never produce a signature.
  test("a signer built under a session that is already locked never signs", async () => {
    const session = createUnlockSession({ now: () => UNLOCKED_AT, ttlMs: TTL_MS });
    let vaultReads = 0;
    const signHash = accountHashSigner(
      {
        session,
        wallet: createWallet({
          captureSign: () => {
            vaultReads += 1;
          },
        }),
      },
      account,
      vaultPassphrase,
    );

    await expect(signHash(MESSAGE_HASH)).rejects.toThrow("wallet locked");
    // Even a later unlock cannot revive it: the authorization it was built
    // under never existed.
    session.unlock(vaultPassphrase);
    await expect(signHash(MESSAGE_HASH)).rejects.toThrow("wallet locked");
    expect(vaultReads).toBe(0);
  });
});
