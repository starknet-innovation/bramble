/**
 * Background discovery message checks: the read-only supported-version methods
 * report the wallet's spec/API lists and negotiate api_version, and
 * wallet.deploymentData is origin-gated and maps the already-deployed and
 * unresolvable-data branches to their spec errors.
 */
import { describe, expect, test } from "bun:test";
import type { DeploymentStatusInput } from "@bramble/starknet/rpc";
import type { Vault } from "@bramble/vault/schema";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { CallData, hash } from "starknet";
import {
  SUPPORTED_SPECS,
  SUPPORTED_WALLET_API,
} from "../../../apps/extension/src/background/portfolio/discovery-ops";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { testExtension } from "../../support/background-wallet-stub";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";

const PUBLIC_KEY = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const CLASS_HASH = "0x2b31e19e45c06f29234e06e2ee98a9966479ba3067f8785ed972794fdb0065c";
const deployAddress = hash.calculateContractAddressFromHash(
  "0x0",
  CLASS_HASH,
  CallData.compile([PUBLIC_KEY]),
  0,
);

const account: AccountRef = {
  accountContractType: "openzeppelin",
  address: deployAddress,
  classHash: CLASS_HASH,
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: `SN_MAIN:${deployAddress}`,
  networkId: "SN_MAIN",
  publicKeyX: PUBLIC_KEY,
  publicKeyY: "0x5234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

const origin = "https://dapp.example";
const contentSender: RuntimeSender = { id: "extension-id", url: `${origin}/app` };
const vaultPassphrase = "correct horse battery staple";

const makeHandler = (options: {
  readonly deployed?: boolean;
  readonly granted?: readonly AccountRef[];
  readonly unlocked?: boolean;
}) => {
  const statusCalls: DeploymentStatusInput[] = [];
  const session = createUnlockSession();
  if (options.unlocked ?? true) {
    session.unlock(vaultPassphrase);
  }
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
      return options.granted ?? [account];
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
      return { publicKey: "0x3", r: "0x1", s: "0x2" };
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
  const handler = createMessageHandler(wallet, testExtension, {
    runtimeRpc: makeRuntimeRpc({
      async getDeploymentStatus(input) {
        statusCalls.push(input);
        return options.deployed ?? false;
      },
      async getTokenMetadata() {
        return { decimals: 18, name: "Token", symbol: "TKN" };
      },
      async submitAccountDeployment() {
        return { transactionHash: "0x7abc" };
      },
    }),
    session,
  });
  return { handler, statusCalls };
};

describe("background discovery messages", () => {
  test("reports the supported spec versions", async () => {
    const { handler } = makeHandler({});
    expect(await handler({ origin, type: "wallet.supportedSpecs" }, contentSender)).toEqual({
      ok: true,
      versions: [...SUPPORTED_SPECS],
    });
  });

  test("reports the supported wallet-API versions", async () => {
    const { handler } = makeHandler({});
    expect(await handler({ origin, type: "wallet.supportedWalletApi" }, contentSender)).toEqual({
      ok: true,
      versions: [...SUPPORTED_WALLET_API],
    });
  });

  test("negotiates api_version and returns the matching list when supported", async () => {
    const { handler } = makeHandler({});
    expect(
      await handler(
        { apiVersion: SUPPORTED_WALLET_API[0], origin, type: "wallet.supportedSpecs" },
        contentSender,
      ),
    ).toEqual({ ok: true, versions: [...SUPPORTED_SPECS] });
  });

  test("rejects an unsupported api_version on a discovery method", async () => {
    const { handler } = makeHandler({});
    expect(
      await handler(
        { apiVersion: "9.9.9", origin, type: "wallet.supportedWalletApi" },
        contentSender,
      ),
    ).toEqual({ error: "unsupported api version" });
  });

  test("returns counterfactual deployment data for a connected origin", async () => {
    const { handler, statusCalls } = makeHandler({});
    const response = await handler({ origin, type: "wallet.deploymentData" }, contentSender);

    expect(response).toEqual({
      deployment: {
        address: deployAddress,
        calldata: CallData.compile([PUBLIC_KEY]),
        classHash: CLASS_HASH,
        salt: "0x0",
        version: 1,
      },
      ok: true,
    });
    expect(statusCalls).toHaveLength(1);
    expect(statusCalls[0]?.accountAddress).toBe(deployAddress);
  });

  test("maps an already-deployed account to ACCOUNT_ALREADY_DEPLOYED", async () => {
    const { handler } = makeHandler({ deployed: true });
    expect(await handler({ origin, type: "wallet.deploymentData" }, contentSender)).toEqual({
      error: "account already deployed",
    });
  });

  test("maps unresolvable deployment data to DEPLOYMENT_DATA_NOT_AVAILABLE", async () => {
    const mismatched: AccountRef = { ...account, address: "0xdead" };
    const { handler } = makeHandler({ granted: [mismatched] });
    expect(await handler({ origin, type: "wallet.deploymentData" }, contentSender)).toEqual({
      error: "deployment data not available",
    });
  });

  test("rejects an unsupported api_version on deployment data", async () => {
    const { handler } = makeHandler({});
    expect(
      await handler({ apiVersion: "9.9.9", origin, type: "wallet.deploymentData" }, contentSender),
    ).toEqual({ error: "unsupported api version" });
  });

  test("refuses deployment data for an origin without a grant", async () => {
    const { handler } = makeHandler({ granted: [] });
    expect(await handler({ origin, type: "wallet.deploymentData" }, contentSender)).toEqual({
      error: "origin not connected",
    });
  });

  test("refuses deployment data when the wallet is locked", async () => {
    const { handler } = makeHandler({ unlocked: false });
    expect(await handler({ origin, type: "wallet.deploymentData" }, contentSender)).toEqual({
      error: "wallet locked",
    });
  });
});
