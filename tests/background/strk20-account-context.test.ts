/**
 * The shared STRK20 account context keeps viewing-key derivation lazy and
 * fails closed when the wallet boundary does not provide it.
 */
import { describe, expect, test } from "bun:test";
import { createUnlockSession } from "../../src/background/session";
import { strk20AccountContext } from "../../src/background/strk20-account-context";
import { defaultWalletPreferences } from "../../src/storage/preferences-store";
import { account, createWallet, vaultPassphrase } from "../support/background-wallet-stub";

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

  test("fails closed when viewing-key derivation is unavailable", async () => {
    const context = strk20AccountContext(
      { session: unlockedSession(), wallet: createWallet() },
      resolved,
    );

    await expect(context.viewingKey()).rejects.toThrow("strk20 services unavailable");
  });
});
