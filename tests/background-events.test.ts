/**
 * Broadcast decision checks: which wallet events follow each runtime
 * mutation, and which responses must stay silent.
 */
import { describe, expect, test } from "bun:test";
import { walletEventBroadcasts } from "../src/background/events";

const MAIN_CHAIN_ID = "0x534e5f4d41494e";
const accountsChanged = { event: "accountsChanged", type: "wallet.event" } as const;
const approvalsChanged = { event: "approvalsChanged", type: "wallet.event" } as const;
const networkChanged = (chainId: string) =>
  ({
    chainId,
    event: "networkChanged",
    type: "wallet.event",
  }) as const;

describe("walletEventBroadcasts", () => {
  test("stays silent for malformed messages, errors, and read-only requests", () => {
    expect(walletEventBroadcasts(null, { ok: true })).toEqual([]);
    expect(walletEventBroadcasts({ type: "wallet.lock" }, { error: "wallet locked" })).toEqual([]);
    expect(walletEventBroadcasts({ type: "wallet.status" }, { hasVault: true })).toEqual([]);
    expect(walletEventBroadcasts({ type: "wallet.getBalances" }, { balances: [] })).toEqual([]);
  });

  test("announces accounts and network after creating a wallet", () => {
    expect(
      walletEventBroadcasts(
        { type: "wallet.createAccount" },
        { account: { networkId: "SN_MAIN" }, ok: true },
      ),
    ).toEqual([accountsChanged, networkChanged(MAIN_CHAIN_ID)]);
  });

  test("announces approvals and grants around origin decisions", () => {
    expect(
      walletEventBroadcasts({ type: "wallet.approveOrigin" }, { accounts: [], ok: true }),
    ).toEqual([accountsChanged, approvalsChanged]);
    expect(walletEventBroadcasts({ type: "wallet.denyOrigin" }, { ok: true, pending: [] })).toEqual(
      [approvalsChanged],
    );
  });

  test("also announces the network when an approval switches chains", () => {
    // A switch-chain approval resolves with the new chain id, so approveOrigin
    // broadcasts networkChanged alongside the accounts and approvals refresh.
    expect(
      walletEventBroadcasts({ type: "wallet.approveOrigin" }, { chainId: MAIN_CHAIN_ID, ok: true }),
    ).toEqual([accountsChanged, approvalsChanged, networkChanged(MAIN_CHAIN_ID)]);
  });

  test("stays silent on a held connection request — the queue notifier signals it", () => {
    // A held requestAccounts resolves to granted accounts only after approval;
    // the approvals-changed signal is pushed at enqueue time by the notifier,
    // and the connection itself is announced by the approveOrigin broadcast.
    expect(
      walletEventBroadcasts({ type: "wallet.requestAccounts" }, { accounts: [], ok: true }),
    ).toEqual([]);
  });

  test("announces account and network switches", () => {
    expect(
      walletEventBroadcasts({ type: "wallet.setActiveAccount" }, { account: {}, ok: true }),
    ).toEqual([accountsChanged]);
    expect(
      walletEventBroadcasts({ type: "wallet.setActiveNetwork" }, { networkId: "SN_MAIN" }),
    ).toEqual([accountsChanged, networkChanged(MAIN_CHAIN_ID)]);
    expect(
      walletEventBroadcasts({ type: "wallet.switchChain" }, { chainId: MAIN_CHAIN_ID, ok: true }),
    ).toEqual([accountsChanged, networkChanged(MAIN_CHAIN_ID)]);
  });

  test("stays silent after importing a raw key, so the pasted key never rides a broadcast", () => {
    // Importing a raw key adds an account and makes it active, but grants it to
    // no origin — dapps' visible sets are unchanged, so (like wallet.addAccount)
    // it broadcasts nothing. Critically, the raw import message carries the
    // private key, and background/index.ts feeds that message into this decision
    // before dispatching to every tab; returning [] keeps the key off the wire.
    const events = walletEventBroadcasts(
      {
        networkId: "SN_MAIN",
        privateKey: "0x7e57ab1e5ec8e7ab1e5ec8e7ab1e5ec8e7ab1e5ec8e7ab1e5ec8e7ab1e5ec8",
        type: "wallet.importAccount",
      },
      { account: { networkId: "SN_MAIN" }, ok: true },
    );
    expect(events).toEqual([]);
    expect(JSON.stringify(events)).not.toContain("7e57ab1e");
  });

  test("announces lock and unlock so pages drop or regain accounts", () => {
    expect(walletEventBroadcasts({ type: "wallet.lock" }, { hasVault: true })).toEqual([
      accountsChanged,
    ]);
    expect(walletEventBroadcasts({ type: "wallet.unlock" }, { hasVault: true })).toEqual([
      accountsChanged,
    ]);
  });
});
