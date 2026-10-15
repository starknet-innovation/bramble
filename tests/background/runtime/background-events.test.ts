/**
 * Broadcast decision checks: which wallet events follow each runtime
 * mutation, and which responses must stay silent. Includes the enforced-derived
 * rule that every vault mutation which re-selects the active account is
 * announced — an origin only ever sees the active account, so a silent change
 * would leave a connected page holding an address the wallet no longer signs
 * for.
 */

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  announcesApprovalsChange,
  walletEventBroadcasts,
} from "../../../apps/extension/src/background/runtime/events";

const MAIN_CHAIN_ID = "0x534e5f4d41494e";
const accountsChanged = { event: "accountsChanged", type: "wallet.event" } as const;
const approvalsChanged = { event: "approvalsChanged", type: "wallet.event" } as const;
const networkChanged = (chainId: string) =>
  ({
    chainId,
    event: "networkChanged",
    type: "wallet.event",
  }) as const;

// Members of the vault service object literals: four-space indent in the main
// factory, two-space indent in its size-budget creation split.
const SERVICE_MEMBERS = [
  {
    file: "packages/platform/vault/src/service/service.ts",
    member: /^ {4}(?:async )?([a-zA-Z0-9]+)[(:,]/gm,
  },
  {
    file: "packages/platform/vault/src/service/service-creation.ts",
    member: /^ {2}(?:async )?([a-zA-Z0-9]+)[(:,]/gm,
  },
];

// Vault-service methods that persist a new activeAccountId, read out of the
// source rather than listed by hand — the list can never silently go stale.
const activeAccountMutators = async (): Promise<readonly string[]> => {
  const names: string[] = [];
  for (const { file, member } of SERVICE_MEMBERS) {
    const source = await readFile(file, "utf8");
    const members = [...source.matchAll(member)].map((match) => ({
      at: match.index ?? 0,
      name: match[1] ?? "",
    }));
    names.push(
      ...members
        .filter(({ at }, position) => {
          const body = source.slice(at, members[position + 1]?.at ?? source.length);
          return body.includes("writeVault(") && body.includes("activeAccountId:");
        })
        .map(({ name }) => name),
    );
  }
  return names.sort();
};

// The message types that reach each of those mutators. switchActiveNetwork
// re-selects the target network's account, which is why the network switches
// (and the switch-chain approval that runs through approveOrigin) appear here.
const MUTATOR_MESSAGE_TYPES: Readonly<Record<string, readonly string[]>> = {
  addDerivedAccount: ["wallet.addAccount"],
  addLedgerAccount: ["wallet.addLedgerAccount"],
  createAccount: ["wallet.createAccount"],
  createKeyVault: ["wallet.createKeyVault"],
  createLedgerVault: ["wallet.createLedgerVault"],
  ensureNetworkAccount: ["wallet.approveOrigin", "wallet.setActiveNetwork", "wallet.switchChain"],
  importRawKeyAccount: ["wallet.importAccount"],
  setActiveAccount: [
    "wallet.approveOrigin",
    "wallet.importPreferences",
    "wallet.setAccountHidden",
    "wallet.setActiveAccount",
    "wallet.setActiveNetwork",
    "wallet.switchChain",
  ],
};

describe("walletEventBroadcasts", () => {
  test("stays silent for malformed messages, errors, and read-only requests", () => {
    expect(walletEventBroadcasts(null, { ok: true })).toEqual([]);
    expect(walletEventBroadcasts({ type: "wallet.lock" }, { error: "wallet locked" })).toEqual([]);
    expect(walletEventBroadcasts({ type: "wallet.status" }, { hasVault: true })).toEqual([]);
    expect(walletEventBroadcasts({ type: "wallet.getBalances" }, { balances: [] })).toEqual([]);
    expect(walletEventBroadcasts({ type: "wallet.previewAccount" }, { account: {} })).toEqual([]);
  });

  test("announces accounts and network after creating a wallet", () => {
    expect(
      walletEventBroadcasts(
        { type: "wallet.createAccount" },
        { account: { networkId: "SN_MAIN" }, ok: true },
      ),
    ).toEqual([accountsChanged, networkChanged(MAIN_CHAIN_ID)]);
    expect(
      walletEventBroadcasts(
        { type: "wallet.unlockUnverified" },
        { hasVault: true, networkId: "SN_MAIN" },
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
      walletEventBroadcasts(
        { type: "wallet.setActiveAccount" },
        { account: { networkId: "SN_MAIN" }, ok: true },
      ),
    ).toEqual([accountsChanged, networkChanged(MAIN_CHAIN_ID)]);
    expect(
      walletEventBroadcasts(
        { type: "wallet.importPreferences" },
        { ok: true, preferences: { activeNetworkId: "SN_MAIN" } },
      ),
    ).toEqual([accountsChanged, networkChanged(MAIN_CHAIN_ID)]);
    expect(
      walletEventBroadcasts({ type: "wallet.setActiveNetwork" }, { networkId: "SN_MAIN" }),
    ).toEqual([accountsChanged, networkChanged(MAIN_CHAIN_ID)]);
    expect(
      walletEventBroadcasts({ type: "wallet.switchChain" }, { chainId: MAIN_CHAIN_ID, ok: true }),
    ).toEqual([accountsChanged, networkChanged(MAIN_CHAIN_ID)]);
  });

  test("announces the new account after an add, import, or Ledger attach", () => {
    // These all select the account they create, and an origin only ever sees
    // the active account — so without a broadcast a connected page keeps
    // showing an address the wallet has already stopped signing for.
    for (const type of [
      "wallet.addAccount",
      "wallet.addLedgerAccount",
      "wallet.createLedgerVault",
      "wallet.importAccount",
    ]) {
      expect(
        walletEventBroadcasts({ type }, { account: { networkId: "SN_MAIN" }, ok: true }),
      ).toEqual([accountsChanged, networkChanged(MAIN_CHAIN_ID)]);
    }
  });

  test("keeps a pasted raw key off the wire when the import broadcasts", () => {
    // The raw import message carries the private key, and background/index.ts
    // feeds that message into this decision before dispatching to every tab.
    // Broadcasts are derived from the response's networkId only, never echoed
    // from the request, so the key cannot ride along.
    const events = walletEventBroadcasts(
      {
        networkId: "SN_MAIN",
        privateKey: "0x7e57ab1e5ec8e7ab1e5ec8e7ab1e5ec8e7ab1e5ec8e7ab1e5ec8e7ab1e5ec8",
        type: "wallet.importAccount",
      },
      { account: { networkId: "SN_MAIN" }, ok: true },
    );
    expect(events).toEqual([accountsChanged, networkChanged(MAIN_CHAIN_ID)]);
    expect(JSON.stringify(events)).not.toContain("7e57ab1e");
  });

  test("announces every vault mutation that re-selects the active account", async () => {
    // Derived from packages/platform/vault/src/service/service.ts: a new method that persists an
    // activeAccountId must be mapped to the message types that reach it, and
    // each of those must broadcast accountsChanged. Skipping that is the bug
    // where "Add account" silently disconnects every connected site.
    expect(await activeAccountMutators()).toEqual(Object.keys(MUTATOR_MESSAGE_TYPES).sort());

    const response = {
      account: { networkId: "SN_MAIN" },
      chainId: MAIN_CHAIN_ID,
      networkId: "SN_MAIN",
      ok: true,
    };
    for (const type of new Set(Object.values(MUTATOR_MESSAGE_TYPES).flat())) {
      expect(walletEventBroadcasts({ type }, response)).toContainEqual(accountsChanged);
    }
  });

  test("announces lock and unlock so pages drop or regain accounts", () => {
    expect(walletEventBroadcasts({ type: "wallet.lock" }, { hasVault: true })).toEqual([
      accountsChanged,
    ]);
    expect(walletEventBroadcasts({ type: "wallet.unlock" }, { hasVault: true })).toEqual([
      accountsChanged,
    ]);
  });

  test("announces the active network on unlock, so a page reconnects on the right chain (Sherlock 188)", () => {
    expect(
      walletEventBroadcasts({ type: "wallet.unlock" }, { hasVault: true, networkId: "SN_MAIN" }),
    ).toEqual([accountsChanged, networkChanged(MAIN_CHAIN_ID)]);
  });
});

// The toolbar badge mirrors the queue size, and approve/deny clear entries
// through `claim` rather than the enqueue notifier — their only signal is this
// broadcast. Without watching it, denying a request left a badge reading "1"
// over an empty queue.
describe("approval queue change announcements", () => {
  test("reports a queue change for an approval decision", () => {
    expect(
      announcesApprovalsChange(
        walletEventBroadcasts({ id: "a", type: "wallet.approveOrigin" }, { ok: true }),
      ),
    ).toBe(true);
    expect(
      announcesApprovalsChange(
        walletEventBroadcasts({ id: "a", type: "wallet.denyOrigin" }, { ok: true }),
      ),
    ).toBe(true);
  });

  test("reports no queue change for an unrelated broadcast", () => {
    expect(announcesApprovalsChange([])).toBe(false);
    expect(
      announcesApprovalsChange([{ chainId: "0x1", event: "networkChanged", type: "wallet.event" }]),
    ).toBe(false);
  });
});
