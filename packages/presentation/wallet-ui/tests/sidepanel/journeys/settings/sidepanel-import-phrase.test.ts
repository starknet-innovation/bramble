/**
 * In-wallet "Import a recovery phrase" flow: word entry gates the search
 * button, the phrase is Krusty-validated before any scan, the shared grouped
 * picker marks accounts already in the vault as locked duplicates, and the
 * restore action commits through the privileged importSeedAccounts request
 * (never first-run recoverAccounts).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { DerivedAccountRef } from "@bramble/wallet-model/accounts";
import type { RecoveryAccountSelection } from "@bramble/wallet-model/recovery";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { importPhraseFlow } from "../../../../src/sidepanel/app/screens/flows";
import { bindImportPhrase } from "../../../../src/sidepanel/journeys/settings/import-phrase-ui";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const MNEMONIC = "legal winner thank year wave sausage worth useful legal winner thank yellow";

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

const accountAt = (accountIndex: number, contract: "argent" | "openzeppelin"): DerivedAccountRef =>
  ({
    ...(contract === "argent"
      ? ({ accountContractType: "argent", deploymentSalt: "0x1" } as const)
      : ({ accountContractType: "openzeppelin" } as const)),
    address: `0x${contract === "argent" ? "e" : ""}${accountIndex + 10}abc`,
    classHash: "0x2",
    derivation: { accountIndex, addressIndex: 0, kind: "starknet-bip44" },
    id: `SN_MAIN:0x${contract === "argent" ? "e" : ""}${accountIndex + 10}abc`,
    networkId: "SN_MAIN",
    publicKeyX: "0x3",
    publicKeyY: "0x4",
  }) as DerivedAccountRef;

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const setWord = (root: ParentNode, index: number, value: string): void => {
  const input = root.querySelector<HTMLInputElement>(`input[name="import-word-${index}"]`);
  if (!input) {
    throw new Error(`missing word ${index}`);
  }
  input.value = value;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
};

const click = (root: ParentNode, selector: string): void => {
  const button = root.querySelector<HTMLButtonElement>(selector);
  if (!button) {
    throw new Error(`missing ${selector}`);
  }
  button.click();
};

const mount = (options?: { readonly validate?: boolean }) => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.replaceChildren(document.createRange().createContextualFragment(importPhraseFlow(status)));
  document.body.append(app);
  const imports: Array<readonly [string, string, readonly RecoveryAccountSelection[]]> = [];
  const recoveries: unknown[] = [];
  let renders = 0;
  const wallet = {
    discoverRecoveryAccounts: () =>
      Promise.resolve({
        candidates: [
          { account: accountAt(0, "openzeppelin"), deployed: true, funded: false },
          { account: accountAt(1, "openzeppelin"), deployed: true, funded: false },
        ],
        complete: true,
        nextIndex: 20,
        ok: true as const,
      }),
    importSeedAccounts(
      mnemonic: string,
      networkId: string,
      selections: readonly RecoveryAccountSelection[],
    ) {
      imports.push([mnemonic, networkId, selections]);
      return Promise.resolve([accountAt(1, "openzeppelin")]);
    },
    loadStatus: () => Promise.resolve(status),
    recoverAccounts(...args: readonly unknown[]) {
      recoveries.push(args);
      return Promise.resolve([]);
    },
    validateMnemonic: () => Promise.resolve(options?.validate ?? true),
  } as unknown as SidepanelWallet;
  bindImportPhrase({
    activeAccountId: () => null,
    app,
    existingAccountIds: () => new Set([accountAt(0, "openzeppelin").id]),
    expandedGroup: () => null,
    networkId: () => "SN_MAIN",
    openAssign: () => null,
    refresh: () => wallet.loadStatus(),
    render: async () => {
      renders += 1;
    },
    setExpandedGroup: () => undefined,
    setOpenAssign: () => undefined,
    startAddAccount: () => undefined,
    wallet,
  });
  return { app, imports, recoveries, renders: () => renders };
};

const fillPhrase = (root: ParentNode): void => {
  for (const [index, word] of MNEMONIC.split(" ").entries()) {
    setWord(root, index, word);
  }
};

describe("import-phrase flow", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("gates the search on a complete phrase and validates through Krusty", async () => {
    const flow = mount({ validate: false });
    const search = flow.app.querySelector<HTMLButtonElement>("#import-phrase-search");
    expect(search?.disabled).toBe(true);
    fillPhrase(flow.app);
    expect(search?.disabled).toBe(false);

    click(flow.app, "#import-phrase-search");
    await tick();
    expect(flow.app.querySelector("#recovery-result")?.textContent).toBe(
      "This recovery phrase is not valid.",
    );
    expect(flow.app.querySelector<HTMLElement>("#import-phrase-scan")?.hidden).toBe(true);
  });

  test("scans, locks duplicates, and imports through the seed-import request", async () => {
    const flow = mount();
    fillPhrase(flow.app);
    click(flow.app, "#import-phrase-search");
    await tick();
    await tick();

    // Both candidates are deployed; the one already in the vault is locked.
    const rows = Array.from(
      flow.app.querySelectorAll<HTMLInputElement>(
        '[data-recovery-group="openzeppelin"] input.select-check',
      ),
    );
    expect(rows.length).toBe(2);
    expect(rows[0]?.disabled).toBe(true);
    expect(rows[0]?.checked).toBe(false);
    expect(rows[1]?.disabled).toBe(false);
    expect(rows[1]?.checked).toBe(true);
    expect(flow.app.textContent).toContain("Already in this wallet");

    const ack = flow.app.querySelector<HTMLInputElement>('input[name="recoveryMainnetAck"]');
    if (!ack) {
      throw new Error("missing acknowledgement");
    }
    ack.checked = true;
    ack.dispatchEvent(new window.Event("change", { bubbles: true }));
    click(flow.app, "#recover-accounts-button");
    await tick();

    expect(flow.imports).toEqual([
      [MNEMONIC, "SN_MAIN", [{ accountContractType: "openzeppelin", accountIndex: 1 }]],
    ]);
    // The first-run path is never used from the in-wallet flow.
    expect(flow.recoveries).toEqual([]);
    expect(flow.renders()).toBe(1);
  });
});
