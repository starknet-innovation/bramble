/**
 * Another wallet's pool registration turns private actions off and leaves
 * import alone. Bramble's own key, and a zero key, stay clear.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { createKrustyKms } from "@bramble/kms-krusty/adapter";
import { defaultWalletPreferences, type WalletPreferences } from "@bramble/settings/preferences";
import { deriveAccount } from "@bramble/vault/accounts";
import { previewStrk20ViewingPublicKey } from "@bramble/vault/strk20-viewing-key";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { canonicalFelt, DEFAULT_NETWORK } from "@bramble/wallet-model/networks";
import {
  PRIVACY_OTHER_WALLET_ACTION,
  PRIVACY_REGISTRATION_UNCHECKED,
} from "@bramble/wallet-protocol/privacy-blocker";
import { ec } from "starknet";
import type { Strk20WalletOpsDeps } from "../../../apps/extension/src/background/privacy/strk20-op-context";
import { resolvePrivacyContext } from "../../../apps/extension/src/background/privacy/strk20-op-context";
import {
  clearStrk20PoolKeyCache,
  isForeignStrk20Registration,
} from "../../../apps/extension/src/background/privacy/strk20-registration-owner";
import { account } from "../../support/background-wallet-stub";
import { flushHeld, waitForPendingApprovals } from "../../support/held";
import {
  buildStrk20Handler,
  STRK20_CONTENT_SENDER,
  STRK20_EXTENSION_SENDER,
  STRK20_ORIGIN,
  STRK20_RECIPIENT,
  STRK20_TOKEN,
} from "../../support/strk20-background";

// The published BIP-39 test phrase the Krusty gate already pins. Not a wallet.
const REFERENCE_MNEMONIC =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";
const CHAIN_ID = "0x534e5f5345504f4c4941";
const POOL = "0x123";

const FOREIGN = "0x99";
const OWN = "0x1";

const ledgerAccount: AccountRef = {
  ...account,
  derivation: {
    accountIndex: 0,
    eip2645application: "LedgerW",
    kind: "ledger",
    path: "m/2645'/1195502025'/1470455285'/0'/0'/0",
  },
};

const preferences = (): WalletPreferences => {
  const defaults = defaultWalletPreferences();
  const mainnet = defaults.strk20Networks?.SN_MAIN;
  if (!mainnet) throw new Error("missing bundled Mainnet STRK20 config");
  return {
    ...defaults,
    activeNetworkId: "SN_SEPOLIA",
    strk20Networks: {
      ...defaults.strk20Networks,
      SN_SEPOLIA: { ...mainnet, poolAddress: POOL },
    },
  };
};

const ACTION = {
  error: PRIVACY_OTHER_WALLET_ACTION,
  privacyBlocker: "other-wallet",
} as const;

const RETRY = {
  error: PRIVACY_REGISTRATION_UNCHECKED,
  privacyBlocker: "service",
} as const;

afterEach(() => {
  clearStrk20PoolKeyCache();
});

describe("viewing public key against the pool", () => {
  test("does not flag the key Bramble would register, and does flag a different one", async () => {
    const kms = createKrustyKms(await import("@starknetfoundation/krusty-kms-wasm"));
    const derivation = {
      accountContractType: "openzeppelin" as const,
      mnemonic: REFERENCE_MNEMONIC,
      networkId: DEFAULT_NETWORK.id,
    };
    const own = await previewStrk20ViewingPublicKey(kms, {
      ...derivation,
      chainId: CHAIN_ID,
      poolAddress: POOL,
    });
    const { privateKey } = await deriveAccount(kms, derivation);
    const viewingKey = await kms.deriveStrk20ViewingKey(privateKey, CHAIN_ID, POOL);
    // The pool stores viewingKey * G on the Stark generator, the x coordinate.
    const poolKey = canonicalFelt(ec.starkCurve.getStarkKey(viewingKey));
    const other = canonicalFelt(ec.starkCurve.getStarkKey("0x2"));
    if (poolKey === null || other === null) throw new Error("pool key was not a felt");
    expect(isForeignStrk20Registration(poolKey, own)).toBe(false);
    expect(isForeignStrk20Registration("0x0", own)).toBe(false);
    expect(isForeignStrk20Registration(other, own)).toBe(true);
  });
});

describe("ledger blocker order", () => {
  test("refuses a Ledger account before any pool read", async () => {
    let reads = 0;
    const result = await resolvePrivacyContext(
      {
        activity: {
          async list() {
            return [];
          },
        },
        preferencesStore: {
          async read() {
            return preferences();
          },
        },
        runtimeRpc: {
          async getStrk20PublicKey() {
            reads += 1;
            return FOREIGN;
          },
        },
        wallet: {
          async previewStoredStrk20ViewingPublicKey() {
            throw new Error("ledger preview must not run");
          },
        },
      } as unknown as Strk20WalletOpsDeps,
      {
        active: {
          account: ledgerAccount,
          accounts: [ledgerAccount],
          networkId: "SN_SEPOLIA",
          vaultPassphrase: "correct horse battery staple",
        },
      },
    );
    expect(result).toEqual({
      error: "Private balances are not available for Ledger accounts",
      privacyBlocker: "ledger",
    });
    expect(reads).toBe(0);
  });
});

describe("private routes", () => {
  const valueMove = (type: string) => ({
    amount: "1",
    recipient: STRK20_RECIPIENT,
    tokenId: "SN_SEPOLIA:ETH:0x1",
    type,
  });

  test("flags a foreign key on the state read and each wallet write, and leaves zero alone", async () => {
    const foreign = buildStrk20Handler({
      ownViewingPublicKey: OWN,
      poolPublicKey: FOREIGN,
      preferences: preferences(),
    });
    const panel = STRK20_EXTENSION_SENDER;
    for (const message of [
      { type: "wallet.strk20State" },
      { type: "wallet.strk20PrepareRegistration" },
      valueMove("wallet.strk20PrepareDeposit"),
      valueMove("wallet.strk20PrepareTransfer"),
      valueMove("wallet.strk20PrepareWithdraw"),
      {
        label: "Market",
        nonce: "0x1",
        origin: "https://example.com",
        type: "wallet.strk20PrepareShadowSweep",
      },
    ]) {
      expect(await foreign(message, panel)).toEqual(ACTION);
    }

    clearStrk20PoolKeyCache();
    const clear = buildStrk20Handler({
      ownViewingPublicKey: OWN,
      poolPublicKey: "0x0",
      preferences: preferences(),
    });
    const state = await clear({ type: "wallet.strk20State" }, panel);
    expect(state).toMatchObject({ ok: true, strk20State: { registration: "registered" } });
  });

  test("does not cache a zero pool key, and does cache a non-zero one", async () => {
    let reads = 0;
    const zero = buildStrk20Handler({
      poolPublicKey: async () => {
        reads += 1;
        return "0x0";
      },
      preferences: preferences(),
    });
    await zero({ type: "wallet.strk20State" }, STRK20_EXTENSION_SENDER);
    await zero({ type: "wallet.strk20State" }, STRK20_EXTENSION_SENDER);
    expect(reads).toBe(2);

    clearStrk20PoolKeyCache();
    reads = 0;
    const remembered = buildStrk20Handler({
      ownViewingPublicKey: OWN,
      poolPublicKey: async () => {
        reads += 1;
        return FOREIGN;
      },
      preferences: preferences(),
    });
    expect(await remembered({ type: "wallet.strk20State" }, STRK20_EXTENSION_SENDER)).toEqual(
      ACTION,
    );
    expect(await remembered({ type: "wallet.strk20State" }, STRK20_EXTENSION_SENDER)).toEqual(
      ACTION,
    );
    expect(reads).toBe(1);
  });

  test("a failed pool read is a retry, not a foreign flag", async () => {
    const handler = buildStrk20Handler({
      poolPublicKey: async () => {
        throw new Error("node down");
      },
      preferences: preferences(),
    });
    expect(await handler({ type: "wallet.strk20State" }, STRK20_EXTENSION_SENDER)).toEqual(RETRY);
    expect(
      await handler(valueMove("wallet.strk20PrepareDeposit"), STRK20_EXTENSION_SENDER),
    ).toEqual(RETRY);
  });

  test("a failed viewing-key derivation is a retry, not a foreign flag", async () => {
    const result = await resolvePrivacyContext(
      {
        activity: {
          async list() {
            return [];
          },
        },
        preferencesStore: {
          async read() {
            return preferences();
          },
        },
        runtimeRpc: {
          async getStrk20PublicKey() {
            return FOREIGN;
          },
        },
        wallet: {
          async previewStoredStrk20ViewingPublicKey() {
            throw new Error("kms down");
          },
        },
      } as unknown as Strk20WalletOpsDeps,
      {
        active: {
          account,
          accounts: [account],
          networkId: "SN_SEPOLIA",
          vaultPassphrase: "correct horse battery staple",
        },
      },
    );
    expect(result).toEqual(RETRY);
  });

  test("holds a dapp private request instead of answering the foreign registration at once", async () => {
    const handler = buildStrk20Handler({
      ownViewingPublicKey: OWN,
      poolPublicKey: FOREIGN,
      preferences: preferences(),
    });
    const messages = [
      { origin: STRK20_ORIGIN, type: "wallet.strk20Register" },
      { origin: STRK20_ORIGIN, tokens: [], type: "wallet.strk20Balances" },
      {
        actions: [{ amount: "0x1", token: STRK20_TOKEN, type: "deposit" }],
        origin: STRK20_ORIGIN,
        simulate: false,
        type: "wallet.strk20PrepareInvoke",
      },
      {
        actions: [{ amount: "0x1", token: STRK20_TOKEN, type: "deposit" }],
        origin: STRK20_ORIGIN,
        type: "wallet.strk20InvokeTransaction",
      },
      {
        dappName: "Market",
        origin: STRK20_ORIGIN,
        type: "wallet.strk20ShadowAccountCommitment",
      },
    ];
    for (const message of messages) {
      clearStrk20PoolKeyCache();
      let settled: unknown = "unsettled";
      const held = handler(message, STRK20_CONTENT_SENDER).then((result) => {
        settled = result;
        return result;
      });
      const pending = await waitForPendingApprovals<{
        readonly id: string;
        readonly kind: string;
        readonly notice?: string;
      }>(handler, STRK20_EXTENSION_SENDER);
      await flushHeld();
      expect(settled).toBe("unsettled");
      expect(pending.at(-1)).toMatchObject({
        kind: "strk20-unavailable",
        notice: "other-wallet",
      });
      const id = pending.at(-1)?.id;
      await handler({ id, type: "wallet.denyOrigin" }, STRK20_EXTENSION_SENDER);
      expect(await held).toEqual({ error: PRIVACY_OTHER_WALLET_ACTION });
    }
  });
});
