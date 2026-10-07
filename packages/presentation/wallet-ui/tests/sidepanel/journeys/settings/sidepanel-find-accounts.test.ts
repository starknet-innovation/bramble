/**
 * Settings-screen "Find my other accounts" flow: the search reveals the shared
 * grouped picker with accounts already in the vault locked, discovery goes
 * through the wallet's own-account rescan (never the typed-phrase scan), and the
 * restore commits through the privileged own-account import (never first-run
 * recoverAccounts, and never the foreign-phrase import).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  ARGENT_ACCOUNT_CLASS_HASH,
  deploymentClasses,
} from "@bramble/wallet-model/account-families";
import type { DerivedAccountRef } from "@bramble/wallet-model/accounts";
import { sameFelt } from "@bramble/wallet-model/networks";
import type { RecoveryAccountSelection } from "@bramble/wallet-model/recovery";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { findAccountsFlow } from "../../../../src/sidepanel/app/screens/flows";
import { bindFindAccounts } from "../../../../src/sidepanel/journeys/settings/find-accounts-ui";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const status: WalletStatus = {
  accountCount: 1,
  accounts: [],
  activeAccountId: null,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

const accountAt = (accountIndex: number): DerivedAccountRef =>
  ({
    accountContractType: "openzeppelin",
    address: `0x${accountIndex + 10}abc`,
    classHash: "0x2",
    derivation: { accountIndex, addressIndex: 0, kind: "starknet-bip44" },
    id: `SN_MAIN:0x${accountIndex + 10}abc`,
    networkId: "SN_MAIN",
    publicKeyX: "0x3",
    publicKeyY: "0x4",
  }) as DerivedAccountRef;

// A Ready (Argent X) account on the vendor's ETH-seeded ladder: x-only key,
// stepped on the address axis, at an older Argent release (issue 505).
const READY_CLASS =
  deploymentClasses("argent").find((entry) => !sameFelt(entry.classHash, ARGENT_ACCOUNT_CLASS_HASH))
    ?.classHash ?? "";
const readyAt = (addressIndex: number): DerivedAccountRef =>
  ({
    accountContractType: "argent",
    address: `0x${addressIndex + 50}def`,
    classHash: READY_CLASS,
    deploymentSalt: "0x0",
    derivation: { addressIndex, kind: "argentx-bip44" },
    id: `SN_MAIN:0x${addressIndex + 50}def`,
    networkId: "SN_MAIN",
    publicKeyX: "0x5",
  }) as unknown as DerivedAccountRef;

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const click = (root: ParentNode, selector: string): void => {
  const button = root.querySelector<HTMLButtonElement>(selector);
  if (!button) {
    throw new Error(`missing ${selector}`);
  }
  button.click();
};

const mount = (
  candidates: readonly { readonly account: DerivedAccountRef }[] = [
    { account: accountAt(0) },
    { account: accountAt(1) },
  ],
) => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.replaceChildren(document.createRange().createContextualFragment(findAccountsFlow(status)));
  document.body.append(app);
  const scans: Array<readonly [string, number | undefined]> = [];
  const imports: Array<readonly [string, readonly RecoveryAccountSelection[]]> = [];
  const recoveries: unknown[] = [];
  const foreignImports: unknown[] = [];
  let renders = 0;
  const wallet = {
    discoverOwnAccounts(networkId: string, manualIndex?: number) {
      scans.push([networkId, manualIndex]);
      return Promise.resolve({
        candidates: candidates.map(({ account }) => ({ account, deployed: true, funded: false })),
        complete: true,
        nextIndex: 20,
        ok: true as const,
      });
    },
    importOwnAccounts(networkId: string, selections: readonly RecoveryAccountSelection[]) {
      imports.push([networkId, selections]);
      return Promise.resolve([accountAt(1)]);
    },
    importSeedAccounts(...args: readonly unknown[]) {
      foreignImports.push(args);
      return Promise.resolve([]);
    },
    loadStatus: () => Promise.resolve(status),
    recoverAccounts(...args: readonly unknown[]) {
      recoveries.push(args);
      return Promise.resolve([]);
    },
  } as unknown as SidepanelWallet;
  bindFindAccounts({
    app,
    existingAccountIds: () => new Set([accountAt(0).id]),
    expandedGroup: () => null,
    networkId: () => "SN_MAIN",
    refresh: () => wallet.loadStatus(),
    render: async () => {
      renders += 1;
    },
    setExpandedGroup: () => undefined,
    startAddAccount: () => undefined,
    wallet,
  });
  return { app, foreignImports, imports, recoveries, renders: () => renders, scans };
};

describe("find-accounts flow", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("starts with the scan hidden and nothing typed", () => {
    const flow = mount();

    expect(flow.app.querySelector<HTMLElement>("#find-accounts-scan")?.hidden).toBe(true);
    expect(flow.app.querySelector('input[name="recoveryManualIndex"]')).not.toBeNull();
    // No phrase cells: this screen never asks the reader for one.
    expect(flow.app.querySelectorAll('input[data-recovery-kind="import"]').length).toBe(0);
  });

  test("searching rescans the wallet's own accounts and reveals the picker", async () => {
    const flow = mount();
    click(flow.app, "#find-accounts-search");
    await tick();
    await tick();

    expect(flow.scans).toEqual([["SN_MAIN", undefined]]);
    expect(flow.app.querySelector<HTMLElement>("#find-accounts-scan")?.hidden).toBe(false);
    // The locked duplicate is the account the vault already holds.
    const rows = Array.from(
      flow.app.querySelectorAll<HTMLInputElement>(
        '[data-recovery-group="openzeppelin"] input.select-check',
      ),
    );
    expect(rows.length).toBe(2);
    expect(rows[0]?.disabled).toBe(true);
    expect(rows[1]?.disabled).toBe(false);
    expect(rows[1]?.checked).toBe(true);
  });

  test("commits the selection through the own-account import only", async () => {
    const flow = mount();
    click(flow.app, "#find-accounts-search");
    await tick();
    await tick();
    click(flow.app, "#recover-accounts-button");
    await tick();

    expect(flow.imports).toEqual([
      ["SN_MAIN", [{ accountContractType: "openzeppelin", accountIndex: 1 }]],
    ]);
    // Neither the first-run restore nor the foreign-phrase import is reachable here.
    expect(flow.recoveries).toEqual([]);
    expect(flow.foreignImports).toEqual([]);
    expect(flow.renders()).toBe(1);
  });

  test("commits a Ready account with its class and the vendor's ladder", async () => {
    expect(READY_CLASS).not.toBe("");
    const flow = mount([{ account: accountAt(0) }, { account: readyAt(2) }]);
    click(flow.app, "#find-accounts-search");
    await tick();
    await tick();
    const ready = Array.from(
      flow.app.querySelectorAll<HTMLInputElement>(
        '[data-recovery-group="argent"] input.select-check',
      ),
    );
    expect(ready.length).toBe(1);
    expect(ready[0]?.checked).toBe(true);
    click(flow.app, "#recover-accounts-button");
    await tick();

    // The selection names the release and the scheme, so the vault re-derives
    // on Ready's ladder rather than this wallet's own.
    expect(flow.imports).toEqual([
      [
        "SN_MAIN",
        [
          {
            accountContractType: "argent",
            accountIndex: 2,
            classHash: READY_CLASS,
            derivation: "argentx-bip44",
          },
        ],
      ],
    ]);
    expect(flow.recoveries).toEqual([]);
    expect(flow.foreignImports).toEqual([]);
  });
});
