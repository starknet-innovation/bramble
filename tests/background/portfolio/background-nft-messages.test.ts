/**
 * NFT gallery message checks: watching requires proven on-chain ownership, and
 * sending builds a transfer_from call through the verified invoke path.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import type { NftOwnership } from "@bramble/starknet/rpc-assets";
import { createMemoryStore } from "@bramble/store/kv";
import type { Vault } from "@bramble/vault/schema";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { LEDGER_EIP2645_APPLICATION, ledgerAccountPath } from "@bramble/wallet-model/ledger-path";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { testExtension } from "../../support/background-wallet-stub";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";

const CONTRACT = "0x0511a2b3";
const reviewedFee = { overallFee: "1", unit: "FRI" } as const;
const account: AccountRef = {
  accountContractType: "openzeppelin",
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};
const ledgerAccount: AccountRef = {
  ...account,
  derivation: {
    accountIndex: 0,
    eip2645application: LEDGER_EIP2645_APPLICATION,
    kind: "ledger",
    path: ledgerAccountPath(0),
  },
};
const vaultPassphrase = "correct horse battery staple";
const sender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};

const stubFor = (acct: AccountRef) => ({
  async addDerivedAccount() {
    return acct;
  },
  async createAccount() {
    return acct;
  },
  async ensureNetworkAccount() {
    return acct;
  },
  async getGrantedAccounts() {
    return [acct];
  },
  async generateMnemonic() {
    return "unused";
  },
  async grantOrigin() {
    return [acct];
  },
  async readVault() {
    return { accounts: [acct], activeAccountId: acct.id } as unknown as Vault;
  },
  async setActiveAccount() {
    return acct;
  },
  async signHash() {
    return { publicKey: acct.publicKeyX, r: "0x1", s: "0x2" };
  },
  async status() {
    return {
      accountCount: 1,
      activeAccountId: acct.id,
      hasVault: true,
      locked: false,
      ready: false,
    };
  },
});
const makeHarness = (options?: {
  readonly account?: AccountRef;
  readonly deployed?: boolean;
  readonly owner?: string;
  readonly ownership?: NftOwnership;
}) => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const invokeCalls: (readonly unknown[])[] = [];
  const ownership = options?.ownership;
  const handler = createMessageHandler(stubFor(options?.account ?? account), testExtension, {
    preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
    runtimeRpc: makeRuntimeRpc({
      ...(ownership
        ? {
            async getNftOwnership() {
              return ownership;
            },
          }
        : {}),
      ...(options?.deployed === false
        ? {
            async getDeploymentStatus() {
              return false;
            },
          }
        : {}),
      async getNftOwner() {
        return options?.owner ?? account.address;
      },
      async submitInvokeTransaction(input) {
        invokeCalls.push(input.calls);
        return { calls: input.calls, transactionHash: "0x7cd" };
      },
    }),
    session,
  });
  return { handler, invokeCalls };
};

describe("NFT gallery messages", () => {
  test("watches an NFT once ownership is proven on-chain", async () => {
    const { handler } = makeHarness();
    const response = await handler(
      {
        contract: CONTRACT,
        label: "Punk",
        networkId: "SN_MAIN",
        tokenId: "5",
        type: "wallet.addNft",
      },
      sender,
    );
    expect(response).toMatchObject({ ok: true });
    const nfts = (
      response as { preferences: { nfts: readonly { contract: string; tokenId: string }[] } }
    ).preferences.nfts;
    expect(nfts).toHaveLength(1);
    expect(nfts[0]).toMatchObject({
      contract: "0x511a2b3",
      label: "Punk",
      owner: account.address,
      tokenId: "5",
    });
  });

  test("refuses to watch an NFT the account does not own", async () => {
    const { handler } = makeHarness({ owner: "0x999" });
    await expect(
      handler(
        { contract: CONTRACT, networkId: "SN_MAIN", tokenId: "5", type: "wallet.addNft" },
        sender,
      ),
    ).resolves.toEqual({ error: "this account does not own that NFT" });
  });

  test("sends an NFT with a transfer_from call through the invoke path", async () => {
    const { handler, invokeCalls } = makeHarness();
    const response = await handler(
      {
        contract: CONTRACT,
        networkId: "SN_MAIN",
        recipient: "0x777",
        reviewedFee,
        tokenId: "5",
        type: "wallet.transferNft",
      },
      sender,
    );
    expect(response).toEqual({ ok: true, transactionHash: "0x7cd" });

    const call = invokeCalls[0]?.[0] as {
      calldata: string[];
      contractAddress: string;
      entrypoint: string;
    };
    expect(call.entrypoint).toBe("transfer_from");
    expect(call.contractAddress).toBe(CONTRACT);
    expect(call.calldata).toHaveLength(4);
    expect(call.calldata.slice(2)).toEqual(["5", "0"]);
  });

  test("reviews the exact NFT call and fee without broadcasting it", async () => {
    const { handler, invokeCalls } = makeHarness();
    const response = await handler(
      {
        contract: CONTRACT,
        networkId: "SN_MAIN",
        recipient: "0x777",
        tokenId: "5",
        type: "wallet.reviewNftTransfer",
      },
      sender,
    );

    expect(response).toMatchObject({
      ok: true,
      review: {
        fee: { overallFee: "1", unit: "FRI" },
        feeEstimateFailed: false,
        flags: [],
        requiresDeployment: false,
        signsTwice: false,
      },
    });
    const summaries = (response as { review: { summaries: readonly string[] } }).review.summaries;
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toContain("Send NFT #5");
    expect(invokeCalls).toHaveLength(0);
  });

  test("tells a Ledger user the NFT send signs twice when it also deploys the account", async () => {
    // The ERC-20 review already says so; the NFT review feeds the same renderer
    // and must not leave the second device prompt as a surprise.
    const review = { contract: CONTRACT, networkId: "SN_MAIN", recipient: "0x777", tokenId: "5" };
    const ledger = await makeHarness({ account: ledgerAccount, deployed: false }).handler(
      { ...review, type: "wallet.reviewNftTransfer" },
      sender,
    );
    expect(ledger).toMatchObject({
      ok: true,
      review: { requiresDeployment: true, signsTwice: true },
    });

    const software = await makeHarness({ deployed: false }).handler(
      { ...review, type: "wallet.reviewNftTransfer" },
      sender,
    );
    expect(software).toMatchObject({
      ok: true,
      review: { requiresDeployment: true, signsTwice: false },
    });
  });

  test("watches and sends an ERC1155 edition through safe_transfer_from", async () => {
    const { handler, invokeCalls } = makeHarness({
      ownership: { balance: "1", standard: "ERC1155" },
    });
    await expect(
      handler(
        { contract: CONTRACT, networkId: "SN_MAIN", tokenId: "342", type: "wallet.addNft" },
        sender,
      ),
    ).resolves.toMatchObject({ ok: true });

    await expect(
      handler(
        {
          contract: CONTRACT,
          networkId: "SN_MAIN",
          recipient: "0x777",
          reviewedFee,
          tokenId: "342",
          type: "wallet.transferNft",
        },
        sender,
      ),
    ).resolves.toEqual({ ok: true, transactionHash: "0x7cd" });

    const call = invokeCalls[0]?.[0] as {
      calldata: string[];
      contractAddress: string;
      entrypoint: string;
    };
    expect(call).toMatchObject({
      contractAddress: CONTRACT,
      entrypoint: "safe_transfer_from",
    });
    expect(call.calldata.slice(2)).toEqual(["342", "0", "1", "0", "0"]);
    expect(BigInt(call.calldata[0] ?? "0")).toBe(BigInt(account.address));
    expect(BigInt(call.calldata[1] ?? "0")).toBe(0x777n);
  });
});
