/**
 * Side-panel runtime message client (part 2 — address book, NFTs, allowances,
 * transfers/review, balances, prices/charts, status/lock/network, groups):
 * exercises the remaining wallet-method wrappers on createSidepanelRuntime.
 * Each method sends a typed request over the injected RuntimeApi and parses the
 * reply through its isXResponse guard, so these tests drive both the request
 * envelope and the happy/failure arms of every wrapper. No DOM is needed; the
 * runtime is a plain fake. Shared fixtures live in
 * tests/support/runtime-client-fixtures.ts; part 1 is in
 * sidepanel-runtime-client.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { createSidepanelRuntime, emptyStatus } from "../../../src/sidepanel/runtime/runtime";
import {
  account,
  allowanceView,
  balancesResponse,
  captureRuntime,
  discoveredNft,
  errorEnvelope,
  preferencesResponse,
  preferencesWithGroup,
  pricesResponse,
  runtimeReturning,
  tokenChartResponse,
  transferResponse,
  transferReviewResponse,
  walletStatus,
} from "../../support/runtime-client-fixtures";

describe("address book", () => {
  test("saveAddress forwards the label/address/network and resolves", async () => {
    const { sent, wallet } = captureRuntime(preferencesResponse);
    await expect(wallet.saveAddress("Alice", "0xabc", "SN_MAIN")).resolves.toBeUndefined();
    expect(sent[0]).toEqual({
      address: "0xabc",
      label: "Alice",
      networkId: "SN_MAIN",
      type: "wallet.saveAddress",
    });
    await expect(runtimeReturning({}).saveAddress("a", "0x1", "SN_MAIN")).rejects.toThrow(
      "address save failed",
    );
  });

  test("removeAddress resolves on preferences and throws otherwise", async () => {
    await expect(
      runtimeReturning(preferencesResponse).removeAddress("id-1"),
    ).resolves.toBeUndefined();
    await expect(runtimeReturning({}).removeAddress("id-1")).rejects.toThrow(
      "address removal failed",
    );
  });
});

describe("NFT wrappers", () => {
  test("addNft omits the label when empty and includes it otherwise", async () => {
    const withLabel = captureRuntime(preferencesResponse);
    await expect(
      withLabel.wallet.addNft("0x511a2b3", "5", "SN_MAIN", "Punk"),
    ).resolves.toBeUndefined();
    expect(withLabel.sent[0]).toEqual({
      contract: "0x511a2b3",
      label: "Punk",
      networkId: "SN_MAIN",
      tokenId: "5",
      type: "wallet.addNft",
    });

    const noLabel = captureRuntime(preferencesResponse);
    await expect(noLabel.wallet.addNft("0x511a2b3", "5", "SN_MAIN", "")).resolves.toBeUndefined();
    expect(noLabel.sent[0]).toEqual({
      contract: "0x511a2b3",
      networkId: "SN_MAIN",
      tokenId: "5",
      type: "wallet.addNft",
    });
  });

  test("addNft throws on failure", async () => {
    await expect(runtimeReturning({}).addNft("0x1", "1", "SN_MAIN", "L")).rejects.toThrow(
      "add NFT failed",
    );
  });

  test("removeNft resolves on preferences and throws otherwise", async () => {
    await expect(runtimeReturning(preferencesResponse).removeNft("id-1")).resolves.toBeUndefined();
    await expect(runtimeReturning({}).removeNft("id-1")).rejects.toThrow("remove NFT failed");
  });

  test("setNftSpam resolves on preferences and throws otherwise", async () => {
    await expect(
      runtimeReturning(preferencesResponse).setNftSpam("id-1", true),
    ).resolves.toBeUndefined();
    await expect(runtimeReturning({}).setNftSpam("id-1", true)).rejects.toThrow(
      "NFT update failed",
    );
  });

  test("transferNft returns the tx hash and throws on failure", async () => {
    const { sent, wallet } = captureRuntime(transferResponse);
    expect(await wallet.transferNft("0x511a2b3", "5", "SN_MAIN", "0xrecipient")).toBe("0x123");
    expect(sent[0]).toEqual({
      contract: "0x511a2b3",
      networkId: "SN_MAIN",
      recipient: "0xrecipient",
      tokenId: "5",
      type: "wallet.transferNft",
    });
    await expect(runtimeReturning({}).transferNft("0x1", "5", "SN_MAIN", "0x2")).rejects.toThrow(
      "NFT transfer failed",
    );
  });

  test("reviewNftTransfer returns a review and sends a read-only review envelope", async () => {
    const { sent, wallet } = captureRuntime(transferReviewResponse);
    await expect(
      wallet.reviewNftTransfer("0x511a2b3", "5", "SN_MAIN", "0xrecipient"),
    ).resolves.toEqual(transferReviewResponse.review);
    expect(sent[0]).toEqual({
      contract: "0x511a2b3",
      networkId: "SN_MAIN",
      recipient: "0xrecipient",
      tokenId: "5",
      type: "wallet.reviewNftTransfer",
    });
    await expect(
      runtimeReturning({}).reviewNftTransfer("0x1", "5", "SN_MAIN", "0x2"),
    ).rejects.toThrow("NFT transfer review failed");
  });

  test("NFT loaders select full, indexed-only, and watched lanes", async () => {
    expect(await runtimeReturning({ nfts: [discoveredNft], ok: true }).discoverNfts()).toEqual([
      discoveredNft,
    ]);
    expect(await runtimeReturning(errorEnvelope).discoverNfts()).toEqual([]);

    const indexed = captureRuntime({ nfts: [discoveredNft], ok: true });
    await indexed.wallet.discoverNfts(false);
    expect(indexed.sent[0]).toEqual({ includeWatched: false, type: "wallet.discoverNfts" });

    const shared = captureRuntime({ nfts: [discoveredNft], ok: true });
    await shared.wallet.discoverNfts(true, "SN_MAIN:shared", "SN_MAIN:0x456");
    expect(shared.sent[0]).toEqual({
      multisigId: "SN_MAIN:0x456",
      type: "wallet.discoverNfts",
    });

    const watched = captureRuntime({ nfts: [discoveredNft], ok: true });
    await watched.wallet.loadWatchedNfts();
    expect(watched.sent[0]).toEqual({ type: "wallet.loadWatchedNfts" });
  });

  test("coalesces concurrent NFT resync requests", async () => {
    let settle!: (value: unknown) => void;
    const sent: unknown[] = [];
    const wallet = createSidepanelRuntime({
      sendMessage(message) {
        sent.push(message);
        return new Promise((resolve) => {
          settle = resolve;
        });
      },
    });

    const first = wallet.loadWatchedNfts();
    const second = wallet.loadWatchedNfts();
    expect(sent).toHaveLength(1);
    settle({ nfts: [discoveredNft], ok: true });
    await expect(Promise.all([first, second])).resolves.toEqual([[discoveredNft], [discoveredNft]]);
  });

  test("does not coalesce NFT loads across account scopes", () => {
    const sent: unknown[] = [];
    const wallet = createSidepanelRuntime({
      sendMessage(message) {
        sent.push(message);
        return new Promise(() => undefined);
      },
    });

    void wallet.loadWatchedNfts("SN_MAIN:0x1");
    void wallet.loadWatchedNfts("SN_MAIN:0x2");
    expect(sent).toHaveLength(2);
  });

  test("invalidates coalesced loads after an NFT mutation", async () => {
    let settleFirst!: (value: unknown) => void;
    let loadCalls = 0;
    const wallet = createSidepanelRuntime({
      sendMessage(message) {
        const type = (message as { type?: string }).type;
        if (type === "wallet.loadWatchedNfts") {
          loadCalls += 1;
          return loadCalls === 1
            ? new Promise((resolve) => {
                settleFirst = resolve;
              })
            : Promise.resolve({ nfts: [], ok: true });
        }
        return Promise.resolve(preferencesResponse);
      },
    });

    const stale = wallet.loadWatchedNfts();
    await wallet.addNft("0x511a2b3", "5", "SN_MAIN", "Punk");
    await wallet.loadWatchedNfts();
    expect(loadCalls).toBe(2);
    settleFirst({ nfts: [], ok: true });
    await stale;
  });
});

describe("allowances", () => {
  test("loadAllowances returns the allowance views or []", async () => {
    expect(
      await runtimeReturning({ allowances: [allowanceView], ok: true }).loadAllowances(),
    ).toEqual([allowanceView]);
    expect(await runtimeReturning(errorEnvelope).loadAllowances()).toEqual([]);
  });

  test("revokeAllowance returns the tx hash and throws on failure", async () => {
    expect(await runtimeReturning(transferResponse).revokeAllowance("id-1")).toBe("0x123");
    await expect(runtimeReturning({}).revokeAllowance("id-1")).rejects.toThrow("revoke failed");
  });
});

describe("transfers and review", () => {
  test("reviewTransfer returns the review and throws on failure", async () => {
    const { sent, wallet } = captureRuntime(transferReviewResponse);
    expect(await wallet.reviewTransfer(account.id, "SN_MAIN:0x1", "0xabc", "1000")).toEqual(
      transferReviewResponse.review,
    );
    expect(sent[0]).toEqual({
      accountId: account.id,
      amount: "1000",
      recipient: "0xabc",
      tokenId: "SN_MAIN:0x1",
      type: "wallet.reviewTransfer",
    });
    await expect(runtimeReturning({}).reviewTransfer(account.id, "t", "0x1", "1")).rejects.toThrow(
      "transfer review failed",
    );
  });

  test("submitTransfer defaults the speed to standard and returns the tx hash", async () => {
    const { sent, wallet } = captureRuntime(transferResponse);
    expect(await wallet.submitTransfer(account.id, "SN_MAIN:0x1", "0xabc", "1000")).toBe("0x123");
    expect(sent[0]).toEqual({
      accountId: account.id,
      amount: "1000",
      recipient: "0xabc",
      speed: "standard",
      tokenId: "SN_MAIN:0x1",
      type: "wallet.transfer",
    });
  });

  test("submitTransfer forwards an explicit fast speed", async () => {
    const { sent, wallet } = captureRuntime(transferResponse);
    await wallet.submitTransfer(account.id, "SN_MAIN:0x1", "0xabc", "1000", "fast");
    expect((sent[0] as { speed: string }).speed).toBe("fast");
  });

  test("submitTransfer throws on failure", async () => {
    await expect(runtimeReturning({}).submitTransfer(account.id, "t", "0x1", "1")).rejects.toThrow(
      "transfer failed",
    );
  });
});

describe("balances", () => {
  test("loadBalances returns the balances on success", async () => {
    expect(await runtimeReturning(balancesResponse).loadBalances()).toEqual({
      accountId: balancesResponse.accountId,
      balances: balancesResponse.balances,
      networkId: balancesResponse.networkId,
    });
  });

  test("loadBalances surfaces the error text from an error envelope", async () => {
    expect(await runtimeReturning({ error: "rpc down" }).loadBalances()).toEqual({
      error: "rpc down",
    });
  });

  test("loadBalances falls back to a generic message for an unrecognised reply", async () => {
    expect(await runtimeReturning({ ok: true }).loadBalances()).toEqual({
      error: "balances unavailable",
    });
  });
});

describe("prices and charts", () => {
  test("loadPrices returns the full price snapshot", async () => {
    expect(await runtimeReturning(pricesResponse).loadPrices()).toEqual({
      asOf: 1700000000,
      changes: { "0x49d3657": 1.5 },
      prices: { "0x49d3657": 3200 },
      stale: false,
    });
  });

  test("loadPrices defaults the optional fields when omitted", async () => {
    expect(
      await runtimeReturning({ currency: "usd", ok: true, prices: { "0x1": 1 } }).loadPrices(),
    ).toEqual({ asOf: null, changes: {}, prices: { "0x1": 1 }, stale: false });
  });

  test("loadPrices returns empty defaults when the guard fails", async () => {
    expect(await runtimeReturning(errorEnvelope).loadPrices()).toEqual({
      asOf: null,
      changes: {},
      prices: {},
      stale: false,
    });
  });

  test("loadTokenChart returns the points or []", async () => {
    expect(await runtimeReturning(tokenChartResponse).loadTokenChart("0x1")).toEqual([1, 2, 3]);
    expect(await runtimeReturning(errorEnvelope).loadTokenChart("0x1")).toEqual([]);
  });
});

describe("status, lock and network", () => {
  test("loadStatus returns the parsed status or emptyStatus", async () => {
    expect(await runtimeReturning(walletStatus).loadStatus()).toEqual(walletStatus);
    expect(await runtimeReturning(errorEnvelope).loadStatus()).toEqual(emptyStatus());
  });

  test("lockVault returns the status and throws when unavailable", async () => {
    expect(await runtimeReturning(walletStatus).lockVault()).toEqual(walletStatus);
    await expect(runtimeReturning({}).lockVault()).rejects.toThrow("wallet unavailable");
  });

  test("unlockVault forwards the passphrase and rejects with the incorrect-passphrase message", async () => {
    const { sent, wallet } = captureRuntime(walletStatus);
    expect(await wallet.unlockVault("pass")).toEqual(walletStatus);
    expect(sent[0]).toEqual({ type: "wallet.unlock", vaultPassphrase: "pass" });
    await expect(runtimeReturning(errorEnvelope).unlockVault("pass")).rejects.toThrow("boom");
    await expect(runtimeReturning({}).unlockVault("pass")).rejects.toThrow("Incorrect passphrase");
  });

  test("setActiveNetwork returns the new status and throws on failure", async () => {
    expect(await runtimeReturning(walletStatus).setActiveNetwork("SN_MAIN")).toEqual(walletStatus);
    await expect(runtimeReturning({}).setActiveNetwork("SN_MAIN")).rejects.toThrow(
      "network switch failed",
    );
  });
});

describe("account groups", () => {
  test("createGroup returns the id of the freshly appended group", async () => {
    const { sent, wallet } = captureRuntime(preferencesWithGroup);
    expect(await wallet.createGroup("Work", "folder")).toBe("work");
    expect(sent[0]).toEqual({ icon: "folder", name: "Work", type: "wallet.createGroup" });
  });

  test("createGroup throws when the returned preferences carry no groups", async () => {
    // preferences valid but groups empty -> no created entry -> falls through to throw.
    await expect(
      runtimeReturning(preferencesResponse).createGroup("Work", "folder"),
    ).rejects.toThrow("group create failed");
  });

  test("createGroup throws on a non-preferences reply", async () => {
    await expect(runtimeReturning(errorEnvelope).createGroup("Work", "folder")).rejects.toThrow(
      "boom",
    );
  });

  test("renameGroup resolves on preferences and throws otherwise", async () => {
    await expect(
      runtimeReturning(preferencesResponse).renameGroup("work", "Jobs"),
    ).resolves.toBeUndefined();
    await expect(runtimeReturning({}).renameGroup("work", "Jobs")).rejects.toThrow(
      "group rename failed",
    );
  });

  test("setGroupIcon resolves on preferences and throws otherwise", async () => {
    const { sent, wallet } = captureRuntime(preferencesResponse);
    await expect(wallet.setGroupIcon("work", "rocket")).resolves.toBeUndefined();
    expect(sent[0]).toEqual({ icon: "rocket", id: "work", type: "wallet.setGroupIcon" });
    await expect(runtimeReturning({}).setGroupIcon("work", "rocket")).rejects.toThrow(
      "group icon update failed",
    );
  });

  test("removeGroup resolves on preferences and throws otherwise", async () => {
    await expect(
      runtimeReturning(preferencesResponse).removeGroup("work"),
    ).resolves.toBeUndefined();
    await expect(runtimeReturning({}).removeGroup("work")).rejects.toThrow("group remove failed");
  });

  test("setAccountInGroup forwards membership and resolves, or throws", async () => {
    const { sent, wallet } = captureRuntime(preferencesResponse);
    await expect(wallet.setAccountInGroup(account.id, "work", true)).resolves.toBeUndefined();
    expect(sent[0]).toEqual({
      accountId: account.id,
      groupId: "work",
      member: true,
      type: "wallet.setAccountInGroup",
    });
    await expect(runtimeReturning({}).setAccountInGroup(account.id, "work", false)).rejects.toThrow(
      "group membership update failed",
    );
  });
});
