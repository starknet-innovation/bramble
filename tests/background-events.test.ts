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

  test("announces new pending approvals from dapp connection requests", () => {
    expect(
      walletEventBroadcasts(
        { type: "wallet.requestAccounts" },
        { ok: false, pending: { id: "1", origin: "https://dapp.example" } },
      ),
    ).toEqual([approvalsChanged]);
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

  test("announces lock and unlock so pages drop or regain accounts", () => {
    expect(walletEventBroadcasts({ type: "wallet.lock" }, { hasVault: true })).toEqual([
      accountsChanged,
    ]);
    expect(walletEventBroadcasts({ type: "wallet.unlock" }, { hasVault: true })).toEqual([
      accountsChanged,
    ]);
  });
});
