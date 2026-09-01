/**
 * Discovery message invalid-input and gate branches: the readDiscoveryInput
 * guards (bad shape and an unnormalizable origin) on the supported-version
 * methods, the deploymentData malformed-request guard, and the deploymentData
 * sender-origin-mismatch gate. Complements background-discovery-messages.test.ts.
 */
import { describe, expect, test } from "bun:test";
import type { Vault } from "@mc-wallet/vault/schema";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";

const origin = "https://dapp.example";
const contentSender: RuntimeSender = { id: "extension-id", url: `${origin}/app` };
const otherSender: RuntimeSender = { id: "extension-id", url: "https://evil.example/app" };
const vaultPassphrase = "correct horse battery staple";

const account: AccountRef = {
  accountContractType: "openzeppelin",
  address: "0xabcabcdef",
  classHash: "0xabcdef",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0xabcabcdef",
  networkId: "SN_MAIN",
  publicKeyX: "0xabc",
  publicKeyY: "0xdef",
};

const wallet = {
  async createAccount() {
    return account;
  },
  async addDerivedAccount() {
    return account;
  },
  async ensureNetworkAccount() {
    return account;
  },
  async getGrantedAccounts() {
    return [account];
  },
  async generateMnemonic() {
    return "habit hope tip crystal because grunt nation idea electric witness alert like";
  },
  async grantOrigin() {
    return [account];
  },
  async readVault() {
    return { accounts: [account], activeAccountId: account.id } as unknown as Vault;
  },
  async setActiveAccount() {
    return account;
  },
  async signHash() {
    return { publicKey: "0xabc", r: "0x1", s: "0x2" };
  },
  async status() {
    return {
      accountCount: 1,
      activeAccountId: account.id,
      hasVault: true,
      locked: false,
      ready: true,
    };
  },
};

const makeHandler = () => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  return createMessageHandler(wallet, "extension-id", {
    runtimeRpc: makeRuntimeRpc(),
    session,
  });
};

describe("discovery invalid-input and gates", () => {
  test("rejects a supportedSpecs request carrying an unknown key", async () => {
    await expect(
      makeHandler()({ extra: 1, origin, type: "wallet.supportedSpecs" }, contentSender),
    ).resolves.toEqual({ error: "invalid discovery request" });
  });

  test("rejects a supportedSpecs request whose origin cannot be normalized", async () => {
    await expect(
      makeHandler()({ origin: "not-a-url", type: "wallet.supportedSpecs" }, contentSender),
    ).resolves.toEqual({ error: "invalid discovery request" });
  });

  test("rejects a supportedWalletApi request with a malformed api version", async () => {
    await expect(
      makeHandler()(
        { apiVersion: "not.a.version!", origin, type: "wallet.supportedWalletApi" },
        contentSender,
      ),
    ).resolves.toEqual({ error: "invalid discovery request" });
  });

  test("rejects a malformed deploymentData request", async () => {
    await expect(
      makeHandler()({ extra: 1, origin, type: "wallet.deploymentData" }, contentSender),
    ).resolves.toEqual({ error: "invalid deployment data request" });
  });

  test("refuses deploymentData when the sender origin does not match", async () => {
    await expect(
      makeHandler()({ origin, type: "wallet.deploymentData" }, otherSender),
    ).resolves.toEqual({ error: "sender origin mismatch" });
  });
});
