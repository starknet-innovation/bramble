/**
 * Guided Multisig journey tests: common transfers derive exact contract calls,
 * and deployment signer choices remain stable through mandatory review.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../src/popup/responses";
import { multisigDeployFlow } from "../../src/sidepanel/multisig-deploy-view";
import { multisigProposeFlow } from "../../src/sidepanel/multisig-propose-view";
import { bindMultisigs, type MultisigUiDeps } from "../../src/sidepanel/multisig-ui";
import { canonicalFelt } from "../../src/starknet/networks";
import { buildErc20TransferCall, parseTokenAmount } from "../../src/starknet/rpc";
import type { MultisigRecord } from "../../src/storage/multisig-store";
import { defaultWalletPreferences } from "../../src/storage/preferences-store";
import type { AccountRef } from "../../src/storage/vault-schema";
import { registerDom, unregisterDom } from "../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const account: AccountRef = {
  address: "0x123",
  classHash: "0x456",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x123",
  networkId: "SN_MAIN",
  publicKeyX: "0x789",
  publicKeyY: "0xabc",
};

const status: WalletStatus = {
  accountCount: 1,
  accounts: [account],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

const record: MultisigRecord = {
  address: "0x999",
  id: "SN_MAIN:0x999",
  name: "Treasury",
  networkId: "SN_MAIN",
  quorum: 1,
  signers: [account.address],
};

const basePreferences = defaultWalletPreferences();
const preferences = {
  ...basePreferences,
  addressBook: [
    {
      address: "0x555",
      id: "SN_MAIN:0x555",
      label: "Research treasury",
      networkId: "SN_MAIN" as const,
    },
  ],
};
const token = preferences.tokens[0];
if (!token) throw new Error("Default token fixture missing");
const portfolio = {
  balances: {
    balances: [
      {
        ...token,
        balance: (1000n * 10n ** BigInt(token.decimals)).toString(),
        formatted: "1000",
      },
    ],
  },
  changes: {},
  currency: "usd" as const,
  nfts: [],
  prices: { [token.address]: 1 },
};

const mount = (html: string, multisig: MultisigUiDeps["multisig"]): HTMLElement => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.append(document.createRange().createContextualFragment(html));
  document.body.append(app);
  bindMultisigs({
    app,
    multisig,
    openDetail() {},
    openList() {},
    render: async () => {},
    selectedMultisigId: () => record.id,
    wallet: { loadStatus: async () => status },
  } as unknown as MultisigUiDeps);
  return app;
};

describe("guided Multisig actions", () => {
  test("derives an ERC-20 transfer from the familiar recipient and amount flow", async () => {
    const proposals: unknown[] = [];
    const flow = multisigProposeFlow(status, record, preferences, portfolio);
    expect(flow).toMatch(
      /<dt>Network<\/dt><dd class="network-inline-value">[\s\S]*?class="token-logo"/,
    );
    const app = mount(flow, {
      async proposeTransaction(value) {
        proposals.push(value);
        return "0xaaa";
      },
    } as MultisigUiDeps["multisig"]);
    const recipient = [
      ...app.querySelectorAll<HTMLButtonElement>("[data-proposal-recipient]"),
    ].find((button) => button.dataset["proposalRecipientLabel"] === "Research treasury");
    recipient?.click();
    const amount = app.querySelector<HTMLInputElement>("#proposal-amount-input");
    if (amount) {
      amount.value = "1.25";
      amount.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const form = app.querySelector<HTMLFormElement>("#multisig-propose-form");
    form?.requestSubmit();
    expect(proposals).toEqual([]);
    expect(form?.dataset["proposalStage"]).toBe("review");
    expect(app.querySelector(".proposal-review-stack")).not.toBeNull();
    form?.requestSubmit();
    await Promise.resolve();

    const call = buildErc20TransferCall(
      token.address,
      "0x555",
      parseTokenAmount("1.25", token.decimals),
    );
    expect(proposals).toEqual([
      {
        calldata: call.calldata,
        entrypoint: "transfer",
        multisigId: record.id,
        salt: "0x0",
        summary: `Send 1.25 ${token.symbol} to Research treasury`,
        to: canonicalFelt(token.address),
      },
    ]);
  });

  test("selects wallet contacts, then requires stable deployment review", async () => {
    const deployments: unknown[] = [];
    const app = mount(multisigDeployFlow(status, account, true, preferences), {
      async deployMultisig(signers, quorum, salt) {
        deployments.push({ quorum, salt, signers });
        return { address: "0x777", transactionHash: "0x888" };
      },
    } as MultisigUiDeps["multisig"]);
    const contact = [...app.querySelectorAll<HTMLButtonElement>("[data-signer-toggle]")].find(
      (button) => button.dataset["signerLabel"] === "Research treasury",
    );
    contact?.click();
    app.querySelector<HTMLButtonElement>("#multisig-signers-continue")?.click();
    const rules = app.querySelector<HTMLElement>('[data-deploy-stage="rules"]');
    expect(rules?.hidden).toBe(false);
    const form = app.querySelector<HTMLFormElement>("#multisig-deploy-form");
    form?.requestSubmit();
    expect(deployments).toEqual([]);
    expect(app.querySelector("#multisig-deploy-review")?.textContent).toContain("Deployment rules");
    form?.requestSubmit();
    await Promise.resolve();
    expect(deployments).toEqual([{ quorum: 1, salt: "0x0", signers: [account.address, "0x555"] }]);
  });
});
