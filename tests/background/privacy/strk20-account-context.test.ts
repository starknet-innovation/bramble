/**
 * The shared STRK20 account context keeps viewing-key derivation lazy, labels
 * each phase's device prompt separately, and fails closed when the wallet
 * boundary does not provide derivation.
 */

import { describe, expect, test } from "bun:test";
import { STRK20_SIGN_INTENTS } from "@mc-wallet/ledger-protocol/intent";
import { defaultWalletPreferences } from "@mc-wallet/settings/preferences";
import type { LedgerAccountRef } from "@mc-wallet/wallet-model/accounts";
import { ledgerAccountPath } from "@mc-wallet/wallet-model/ledger-path";
import { ec } from "starknet";
import type { LedgerSignQueue } from "../../../apps/extension/src/background/ledger/ledger-sign-queue";
import type { LedgerSignRequest } from "../../../apps/extension/src/background/ledger/ledger-signer";
import { strk20AccountContext } from "../../../apps/extension/src/background/privacy/strk20-account-context";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { account, createWallet, vaultPassphrase } from "../../support/background-wallet-stub";

const resolved = {
  account,
  passphrase: vaultPassphrase,
  preferences: {
    ...defaultWalletPreferences(),
    strk20Networks: {
      SN_SEPOLIA: {
        discoveryUrl: "https://discovery.example",
        poolAddress: "0x0123",
        proverUrl: "https://prover.example",
        subaccountAnonymizerAddress: "0x456",
      },
    },
  },
  rpcUrls: ["https://rpc.example"],
};

// The unlock that authorizes the context; `strk20AccountContext` binds the
// vault signer it builds to this session.
const unlockedSession = () => {
  const session = createUnlockSession({ now: () => 1_000, ttlMs: 1_000 });
  session.unlock(vaultPassphrase);
  return session;
};

describe("STRK20 account context", () => {
  test("derives the viewing key only when the SDK asks for it", async () => {
    const seen: unknown[] = [];
    const context = strk20AccountContext(
      {
        session: unlockedSession(),
        wallet: {
          ...createWallet(),
          async deriveStrk20ViewingKey(input) {
            seen.push(input);
            return "0x55";
          },
        },
      },
      resolved,
      STRK20_SIGN_INTENTS.dapp,
    );

    expect(seen).toEqual([]);
    await expect(context.viewingKey()).resolves.toBe("0x55");
    expect(seen).toEqual([
      {
        accountId: account.id,
        chainId: "0x534e5f5345504f4c4941",
        poolAddress: "0x123",
        vaultPassphrase,
      },
    ]);
  });

  // The viewing-key thunk is reached LATE — inside the SDK's network work, well
  // after the user approved a disclosure — so a lock issued in that window must
  // revoke it exactly as it revokes the signing thunk. The invocation count is
  // the real assertion: a rejection after the vault had already been asked would
  // mean the key was derived for a locked wallet.
  test("an explicit lock revokes the viewing-key thunk as well as the signing thunk", async () => {
    const derivations: unknown[] = [];
    const session = unlockedSession();
    const context = strk20AccountContext(
      {
        session,
        wallet: {
          ...createWallet(),
          async deriveStrk20ViewingKey(input) {
            derivations.push(input);
            return "0x55";
          },
        },
      },
      resolved,
      STRK20_SIGN_INTENTS.dapp,
    );

    session.lock();

    await expect(context.viewingKey()).rejects.toThrow("wallet locked");
    await expect(context.signHash("0x1")).rejects.toThrow("wallet locked");
    expect(derivations).toEqual([]);
  });

  test("fails closed when viewing-key derivation is unavailable", async () => {
    const context = strk20AccountContext(
      { session: unlockedSession(), wallet: createWallet() },
      resolved,
      STRK20_SIGN_INTENTS.dapp,
    );

    await expect(context.viewingKey()).rejects.toThrow("strk20 services unavailable");
  });

  // One private operation asks a Ledger to approve twice, for two different
  // things. If both prompts carry the same intent the user is shown the same
  // screen twice with no way to tell what the second approval is for, which is
  // indistinguishable from a wallet asking again for the one they already gave.
  test("the two phases reach the device under different intents", async () => {
    const deviceKey = "0x1234567890abcdef";
    const seen: LedgerSignRequest[] = [];
    const ledgerAccount: LedgerAccountRef = {
      accountContractType: "openzeppelin",
      address: "0xabc111111",
      classHash: "0x111111",
      derivation: {
        accountIndex: 2,
        eip2645application: "LedgerW",
        kind: "ledger",
        path: ledgerAccountPath(2),
      },
      id: "SN_SEPOLIA:0xabc111111",
      networkId: "SN_SEPOLIA",
      publicKeyX: ec.starkCurve.getStarkKey(deviceKey),
    };
    const queue: LedgerSignQueue = {
      pending: () => [],
      reject: () => false,
      rejectAll: () => 0,
      settle: () => false,
      async request(request) {
        seen.push(request as LedgerSignRequest);
        const signature = ec.starkCurve.sign(request.messageHash, deviceKey);
        return { r: `0x${signature.r.toString(16)}`, s: `0x${signature.s.toString(16)}` };
      },
    };
    const context = strk20AccountContext(
      { ledgerSignQueue: queue, session: unlockedSession(), wallet: createWallet() },
      { ...resolved, account: ledgerAccount },
      STRK20_SIGN_INTENTS.shield,
    );

    await context.signHash("0x1e240");
    await context.submitSignHash("0x1e241");

    expect(seen.map((request) => request.intent)).toEqual([
      "strk20-shield-authorize",
      "strk20-shield-broadcast",
    ]);
  });
});
