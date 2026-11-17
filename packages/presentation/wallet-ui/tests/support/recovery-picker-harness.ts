/** Shared fixtures for driving the first-run recovery account picker. */
import type { DerivedAccountRef, RecoverableAccountRef } from "@bramble/wallet-model/accounts";
import type { WalletStatus } from "../../src/popup/responses/responses";
import { onboarding } from "../../src/sidepanel/journeys/onboarding/gate-views";
import { bindOnboarding } from "../../src/sidepanel/journeys/onboarding/onboarding-ui";
import type { SidepanelWallet } from "../../src/sidepanel/runtime/runtime";

export const MNEMONIC =
  "habit hope tip crystal because grunt nation idea electric witness alert like";
export const PASSPHRASE = "fixture vault passphrase";

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

export const brambleAccount: DerivedAccountRef = {
  accountContractType: "openzeppelin",
  address: "0xabc",
  classHash: "0x1",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0xabc",
  networkId: "SN_MAIN",
  publicKeyX: "0x2",
  publicKeyY: "0x3",
};

export const readyIdleAccount: DerivedAccountRef = {
  ...brambleAccount,
  accountContractType: "argent",
  address: "0xready0",
  id: "SN_MAIN:0xready0",
};

export const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export const setValue = (root: ParentNode, selector: string, value: string): void => {
  const input = root.querySelector<HTMLInputElement>(selector);
  if (!input) {
    throw new Error(`missing ${selector}`);
  }
  input.value = value;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
};

export const click = (root: ParentNode, selector: string): void => {
  const button = root.querySelector<HTMLButtonElement>(selector);
  if (!button) {
    throw new Error(`missing ${selector}`);
  }
  button.click();
};

type Candidate = {
  account: RecoverableAccountRef;
  deployed: boolean;
  funded: boolean;
  privacyPool?: "other-wallet";
  restriction?: "guardian" | "owner-changed" | "owner-type" | "release" | "strong-signer";
};

export const mount = (
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

export const reachPicker = async (app: HTMLElement): Promise<void> => {
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

export const rowsIn =
  (app: HTMLElement) =>
  (contractType: string): readonly HTMLLIElement[] =>
    Array.from(app.querySelectorAll<HTMLLIElement>(`[data-recovery-group="${contractType}"] li`));
