/**
 * Recovery-scan gate: Bramble creates only Bramble accounts, so a Ready
 * candidate with no on-chain history — which would be a brand-new Ready
 * deployment — is listed for transparency but never selectable. Deployed or
 * funded (counterfactual) Ready accounts stay importable, and Bramble
 * candidates are unaffected.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  BRAAVOS_BASE_CLASS_HASH,
  BRAAVOS_DEPLOYMENT_CLASS_HASH,
  deploymentClasses,
  XVERSE_ARGENT_CLASS_HASH,
} from "@bramble/wallet-model/account-families";
import { ARGENT_ACCOUNT_CLASS_HASH, type DerivedAccountRef } from "@bramble/wallet-model/accounts";
import { RECOVERY_SCAN_LIMITS } from "@bramble/wallet-model/recovery";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { onboarding } from "../../../../src/sidepanel/journeys/onboarding/gate-views";
import { bindOnboarding } from "../../../../src/sidepanel/journeys/onboarding/onboarding-ui";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const MNEMONIC = "habit hope tip crystal because grunt nation idea electric witness alert like";
const PASSPHRASE = "fixture vault passphrase";

const status: WalletStatus = {
  accountCount: 0,
  accounts: [],
  activeAccountId: null,
  hasVault: false,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

const brambleAccount: DerivedAccountRef = {
  accountContractType: "openzeppelin",
  address: "0xabc",
  classHash: "0x1",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0xabc",
  networkId: "SN_MAIN",
  publicKeyX: "0x2",
  publicKeyY: "0x3",
};

const readyIdleAccount: DerivedAccountRef = {
  ...brambleAccount,
  accountContractType: "argent",
  address: "0xready0",
  id: "SN_MAIN:0xready0",
};

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const setValue = (root: ParentNode, selector: string, value: string): void => {
  const input = root.querySelector<HTMLInputElement>(selector);
  if (!input) {
    throw new Error(`missing ${selector}`);
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

type Candidate = {
  account: DerivedAccountRef;
  deployed: boolean;
  funded: boolean;
  restriction?: "guardian" | "owner-changed" | "owner-type" | "release" | "strong-signer";
};

const mount = (
  candidates: readonly Candidate[] = [
    { account: brambleAccount, deployed: true, funded: false },
    { account: readyIdleAccount, deployed: false, funded: false },
  ],
  discover?: SidepanelWallet["discoverRecoveryAccounts"],
  hooks: { readonly onRender?: () => void } = {},
) => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.replaceChildren(document.createRange().createContextualFragment(onboarding(status)));
  document.body.append(app);
  const wallet = {
    discoverRecoveryAccounts:
      discover ??
      (() =>
        Promise.resolve({
          candidates,
          complete: true,
          nextIndex: 20,
          ok: true as const,
        })),
    loadStatus: () => Promise.resolve(status),
    recoverAccounts: () => Promise.resolve([brambleAccount]),
    validateMnemonic: () => Promise.resolve(true),
  } as unknown as SidepanelWallet;
  bindOnboarding({
    app,
    render: async () => {
      hooks.onRender?.();
    },
    wallet,
  });
  return app;
};

const reachPicker = async (app: HTMLElement): Promise<void> => {
  click(app, "#add-existing-button");
  click(app, "#recovery-method-button");
  setValue(app, 'input[name="import-word-0"]', MNEMONIC);
  click(app, "#recovery-continue");
  await tick();
  setValue(app, 'input[name="vaultPassphrase"]', PASSPHRASE);
  setValue(app, 'input[name="vaultPassphraseConfirm"]', PASSPHRASE);
  click(app, "#password-continue-button");
  await tick();
};

const rowsIn =
  (app: HTMLElement) =>
  (contractType: string): readonly HTMLLIElement[] =>
    Array.from(app.querySelectorAll<HTMLLIElement>(`[data-recovery-group="${contractType}"] li`));

describe("recovery scan Ready gate", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("Enter in a passphrase field continues only once the passphrase is valid", async () => {
    const app = mount();
    click(app, "#add-existing-button");
    click(app, "#recovery-method-button");
    setValue(app, 'input[name="import-word-0"]', MNEMONIC);
    click(app, "#recovery-continue");
    await tick();
    const step = (name: string): boolean =>
      app.querySelector<HTMLElement>(`[data-onboarding-step="${name}"]`)?.hidden === true;
    const enter = (name: string): boolean => {
      const event = new window.KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
      });
      app.querySelector(`input[name="${name}"]`)?.dispatchEvent(event);
      return event.defaultPrevented;
    };

    setValue(app, 'input[name="vaultPassphrase"]', PASSPHRASE);
    setValue(app, 'input[name="vaultPassphraseConfirm"]', `${PASSPHRASE}x`);
    expect(enter("vaultPassphraseConfirm")).toBe(true);
    expect(step("password")).toBe(false);

    setValue(app, 'input[name="vaultPassphraseConfirm"]', PASSPHRASE);
    expect(enter("vaultPassphraseConfirm")).toBe(true);
    expect(step("password")).toBe(true);
    expect(step("recovery-accounts")).toBe(false);
  });

  test("says it is searching every account type while the scan is still running", async () => {
    let finish: (value: Awaited<ReturnType<SidepanelWallet["discoverRecoveryAccounts"]>>) => void =
      () => undefined;
    const app = mount(
      [],
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await reachPicker(app);

    expect(app.querySelector("#recovery-scan-status")?.textContent).toBe(
      "Searching every account type…",
    );
    finish({ candidates: [], complete: true, nextIndex: 20, ok: true });
    await tick();
  });

  test("extends the progress denominator past activity near the horizon", async () => {
    // Issue 503: evidence at index 19 reopens the scan, and the status line
    // quotes the extended target rather than announcing a finished window.
    const lateAccount: DerivedAccountRef = {
      ...brambleAccount,
      address: "0xlate",
      derivation: { accountIndex: 19, addressIndex: 0, kind: "starknet-bip44" },
      id: "SN_MAIN:0xlate",
    };
    const batches: Array<Awaited<ReturnType<SidepanelWallet["discoverRecoveryAccounts"]>>> = [
      {
        candidates: [{ account: lateAccount, deployed: true, funded: false }],
        complete: false,
        nextIndex: 20,
        ok: true,
      },
    ];
    let finish: (value: Awaited<ReturnType<SidepanelWallet["discoverRecoveryAccounts"]>>) => void =
      () => undefined;
    const app = mount([], () => {
      const batch = batches.shift();
      if (batch) return Promise.resolve(batch);
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    await reachPicker(app);

    expect(app.querySelector("#recovery-scan-status")?.textContent).toBe(
      "Checked 20 of 40 indices…",
    );
    // An empty group is only declared empty once the search has finished.
    const braavosList = app.querySelector('[data-recovery-group="braavos"] ul');
    expect(braavosList?.textContent).toBe("");
    finish({
      candidates: [{ account: lateAccount, deployed: true, funded: false }],
      complete: true,
      nextIndex: 40,
      ok: true,
    });
    await tick();
    expect(app.querySelector("#recovery-scan-status")?.textContent).toBe(
      "Search complete. Checked 40 indices across every account type.",
    );
    expect(braavosList?.textContent).toBe("No accounts with on-chain activity.");
  });

  test("says a guarded Argent account is view only before it is picked", async () => {
    // Issue 542: the advisory verdict reaches the row's state line, and the
    // account stays selectable — imported view-only, like Braavos.
    const guarded: DerivedAccountRef = {
      ...readyIdleAccount,
      address: "0xguarded",
      id: "SN_MAIN:0xguarded",
    };
    const app = mount([
      { account: guarded, deployed: true, funded: false, restriction: "guardian" },
    ]);
    await reachPicker(app);

    const row = rowsIn(app)("argent")[0];
    if (!row) throw new Error("missing argent row");
    expect(row.textContent).toContain("Deployed on Starknet · has a guardian · view only");
    const checkbox = row.querySelector<HTMLInputElement>("input[type=checkbox]");
    expect(checkbox?.disabled).toBe(false);
  });

  test("lists an inactive Ready candidate but refuses to select it", async () => {
    const app = mount();
    await reachPicker(app);

    const groupRows = rowsIn(app);
    expect(groupRows("openzeppelin").length).toBe(1);
    expect(groupRows("argent").length).toBe(1);

    const readyGroup = app.querySelector<HTMLDetailsElement>('[data-recovery-group="argent"]');
    const readyCheckbox =
      groupRows("argent")[0]?.querySelector<HTMLInputElement>("input.select-check");
    expect(readyCheckbox?.disabled).toBe(true);
    expect(readyCheckbox?.checked).toBe(false);
    expect(groupRows("argent")[0]?.textContent).toContain(
      "Bramble only imports existing Ready accounts",
    );
    // No active Ready accounts: no detected count, and the group stays closed.
    expect(readyGroup?.textContent).not.toContain("detected");
    expect(readyGroup?.open).toBe(false);

    // The Bramble candidate stays selectable (auto-selected: deployed), its
    // group reports the detection and opens itself.
    const brambleGroup = app.querySelector<HTMLDetailsElement>(
      '[data-recovery-group="openzeppelin"]',
    );
    const brambleCheckbox =
      groupRows("openzeppelin")[0]?.querySelector<HTMLInputElement>("input.select-check");
    expect(brambleCheckbox?.disabled).toBe(false);
    expect(brambleCheckbox?.checked).toBe(true);
    // The count is always rendered, in the small-caps eyebrow beside the family
    // name, so a family with nothing in it says so rather than going blank.
    expect(brambleGroup?.textContent).toContain("1 found");
    expect(brambleGroup?.querySelector("[data-detected]")?.className).toBe("eyebrow");
    expect(brambleGroup?.open).toBe(true);
  });

  test("shows a found Braavos account, selected, labelled by its verdict", async () => {
    // Discovery auto-selects every account with activity. A stark-only Braavos
    // account is now usable, so its row reads as a plain deployed account; a
    // strong signer labels the row view only with the reason; an undeployed
    // one stays view only, since Bramble cannot deploy Braavos yet.
    const braavos: DerivedAccountRef = {
      ...brambleAccount,
      accountContractType: "braavos",
      address: "0xb4a",
      classHash: BRAAVOS_BASE_CLASS_HASH,
      deploymentSalt: "0x2",
      id: "SN_MAIN:0xb4a",
    };
    const app = mount([{ account: braavos, deployed: true, funded: false }]);
    await reachPicker(app);

    const [row] = rowsIn(app)("braavos");
    const checkbox = row?.querySelector<HTMLInputElement>("input.select-check");
    expect(rowsIn(app)("braavos").length).toBe(1);
    expect(checkbox?.checked).toBe(true);
    expect(checkbox?.disabled).toBe(false);
    expect(row?.textContent).toContain("Deployed on Starknet");
    expect(row?.textContent).not.toContain("view only");
    expect(app.querySelector<HTMLDetailsElement>('[data-recovery-group="braavos"]')?.open).toBe(
      true,
    );

    const guarded = mount([
      { account: braavos, deployed: true, funded: false, restriction: "strong-signer" },
    ]);
    await reachPicker(guarded);
    expect(rowsIn(guarded)("braavos")[0]?.textContent).toContain("2FA active · view only");

    const undeployed = mount([{ account: braavos, deployed: false, funded: true }]);
    await reachPicker(undeployed);
    expect(rowsIn(undeployed)("braavos")[0]?.textContent).toContain(
      "Funded, not deployed · view only for now",
    );

    // The modern deployment class deploys from here like any other account.
    const modern = mount([
      {
        account: { ...braavos, classHash: BRAAVOS_DEPLOYMENT_CLASS_HASH },
        deployed: false,
        funded: true,
      },
    ]);
    await reachPicker(modern);
    expect(rowsIn(modern)("braavos")[0]?.textContent).toContain("Funded and ready to deploy");
  });

  test("names the Argent release on rows that share an index", async () => {
    const earlier = deploymentClasses("argent").find((entry) => entry.label === "argent 0.3.0");
    if (!earlier) throw new Error("argent 0.3.0 missing from the class table");
    const current: DerivedAccountRef = {
      ...brambleAccount,
      accountContractType: "argent",
      address: "0xa04",
      classHash: ARGENT_ACCOUNT_CLASS_HASH,
      deploymentSalt: "0x2",
      id: "SN_MAIN:0xa04",
    };
    const upgraded: DerivedAccountRef = {
      ...current,
      address: "0xa03",
      classHash: earlier.classHash,
      id: "SN_MAIN:0xa03",
    };
    const app = mount([
      { account: current, deployed: true, funded: false },
      { account: upgraded, deployed: true, funded: false },
    ]);
    await reachPicker(app);

    const titles = rowsIn(app)("argent").map((row) => row.querySelector("strong")?.textContent);
    expect(titles.sort()).toEqual(["Account 0", "Account 0 · Argent 0.3.0"]);
    // Both are selected: they are two accounts, not one listed twice.
    const checked = rowsIn(app)("argent").filter(
      (row) => row.querySelector<HTMLInputElement>("input.select-check")?.checked,
    );
    expect(checked.length).toBe(2);
  });

  test("does not call a funded historical Argent class ready to deploy", async () => {
    const earlier = deploymentClasses("argent").find((entry) => entry.label === "argent 0.3.0");
    if (!earlier) throw new Error("argent 0.3.0 missing from the class table");
    const current: DerivedAccountRef = {
      ...brambleAccount,
      accountContractType: "argent",
      address: "0xa04",
      classHash: ARGENT_ACCOUNT_CLASS_HASH,
      deploymentSalt: "0x2",
      id: "SN_MAIN:0xa04",
    };
    const historical: DerivedAccountRef = {
      ...current,
      address: "0xa03",
      classHash: earlier.classHash,
      id: "SN_MAIN:0xa03",
    };
    const app = mount([
      { account: current, deployed: false, funded: true },
      { account: historical, deployed: false, funded: true },
    ]);
    await reachPicker(app);

    const rows = rowsIn(app)("argent");
    const currentRow = rows.find((row) => row.querySelector("strong")?.textContent === "Account 0");
    const historicalRow = rows.find((row) =>
      row.querySelector("strong")?.textContent?.includes("0.3.0"),
    );
    expect(currentRow?.textContent).toContain("Funded and ready to deploy");
    expect(historicalRow?.textContent).toContain("Bramble cannot deploy this Argent release");
    expect(historicalRow?.textContent).not.toContain("ready to deploy");
    expect(historicalRow?.querySelector<HTMLInputElement>("input.select-check")?.disabled).toBe(
      false,
    );
  });

  test("says Bramble cannot deploy a funded Xverse account, and never offers an unused one", async () => {
    // Issue 734: Xverse deploys on the first send, so a funded counterfactual is
    // the common case. Deploy accepts only the pinned release, so the row must
    // not promise a deployment; an unused Xverse address belongs to nobody.
    const xverse = (address: string, accountIndex: number): DerivedAccountRef => ({
      ...brambleAccount,
      accountContractType: "argent",
      address,
      classHash: XVERSE_ARGENT_CLASS_HASH,
      deploymentSalt: "0x2",
      derivation: { accountIndex, addressIndex: 0, kind: "starknet-bip44" },
      id: `SN_MAIN:${address}`,
    });
    const app = mount([
      { account: xverse("0x7e51", 1), deployed: false, funded: true },
      { account: xverse("0x7e52", 2), deployed: false, funded: false },
    ]);
    await reachPicker(app);

    const rows = rowsIn(app)("argent");
    const funded = rows.find((row) => row.textContent?.includes("Account 1"));
    const unused = rows.find((row) => row.textContent?.includes("Account 2"));
    expect(funded?.querySelector("strong")?.textContent).toBe("Account 1 · Argent 0.4.0 (Xverse)");
    expect(funded?.textContent).toContain("Bramble cannot deploy this Argent release");
    expect(funded?.textContent).not.toContain("ready to deploy");
    expect(unused?.textContent).toContain("No on-chain activity found");
    expect(unused?.querySelector<HTMLInputElement>("input.select-check")?.disabled).toBe(true);
  });

  test("stops auto-selecting once a restore would reject the selection", async () => {
    const accounts = Array.from({ length: RECOVERY_SCAN_LIMITS.maxSelections + 1 }, (_, index) => {
      const address = `0x${(index + 1).toString(16)}`;
      const account: DerivedAccountRef = {
        ...brambleAccount,
        address,
        derivation: { accountIndex: index, addressIndex: 0, kind: "starknet-bip44" },
        id: `SN_MAIN:${address}`,
      };
      return { account, deployed: true, funded: false };
    });
    const app = mount(accounts);
    await reachPicker(app);

    const boxes = rowsIn(app)("openzeppelin").map(
      (row) => row.querySelector<HTMLInputElement>("input.select-check") ?? null,
    );
    const checked = boxes.filter((box) => box?.checked);
    const unchecked = boxes.find((box) => box && !box.checked);
    expect(checked.length).toBe(RECOVERY_SCAN_LIMITS.maxSelections);
    expect(unchecked).toBeTruthy();
    expect(app.querySelector("#recovery-scan-status")?.textContent).toContain(
      `At most ${RECOVERY_SCAN_LIMITS.maxSelections} accounts`,
    );

    unchecked?.click();
    expect(unchecked?.checked).toBe(false);
    expect(document.body.textContent).toContain(
      `Choose at most ${RECOVERY_SCAN_LIMITS.maxSelections} accounts`,
    );

    checked[0]?.click();
    unchecked?.click();
    expect(unchecked?.checked).toBe(true);
    expect(boxes.filter((box) => box?.checked).length).toBe(RECOVERY_SCAN_LIMITS.maxSelections);
  });

  test("a first-run restore hands off to the repaint without emptying the picker", async () => {
    // The in-wallet import wipes its form on success (audit #250); first-run
    // passes no hook, because success there replaces the whole screen.
    let renders = 0;
    const app = mount(undefined, undefined, { onRender: () => (renders += 1) });
    await reachPicker(app);
    const picked = (): number =>
      app.querySelectorAll<HTMLInputElement>("input.select-check:checked").length;
    expect(picked()).toBe(1);
    click(app, "#recover-accounts-button");
    await tick();
    await tick();
    expect(renders).toBe(1);
    expect(picked()).toBe(1);
    expect(app.querySelector("#recovery-accounts-result")?.textContent).toContain("Restoring");
  });
});
