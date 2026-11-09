/**
 * The account deploy screen never prints a raw RPC dump, and a node rejection
 * for an unfunded account reads as the funding sentence (mc-wallet issue 662).
 *
 * The reported failure: Deploy pressed with 0 STRK printed the whole
 * `starknet_addDeployAccountTransaction` request and "exceed balance (0)" under
 * the button, because the status line took the untranslated diagnostic.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { account, preferences } from "@bramble/testkit/sidepanel";
import { SubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
import type { TokenBalance, WalletStatus } from "../../../src/popup/responses/responses";
import { dashboard } from "../../../src/sidepanel/app/screens/views";
import { deploymentFailureToast } from "../../../src/sidepanel/journeys/multisig/multisig-deploy-errors";
import { FIRST_SEND_DEPLOYS } from "../../../src/sidepanel/journeys/send/transfer-review-markup";
import { RPC_REJECTED } from "../../../src/sidepanel/runtime/friendly-error-copy";
import { outcomeReceiptSection } from "../../../src/sidepanel/shared/outcome-receipt";
import {
  DEPLOY_NEEDS_STRK,
  deployErrorLine,
  deployToastText,
} from "../../../src/sidepanel/shell/deploy-errors";
import { bindDeploy, type ShellBindingDeps } from "../../../src/sidepanel/shell/shell-bindings";
import { registerDom, unregisterDom } from "../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

// The shape the reporter saw: starknet.js's RPC error, request and all, ending
// in the node's validation failure for an account holding no STRK.
const REPORTED =
  'RPC: starknet_addDeployAccountTransaction with params {"deploy_account_transaction":{"type":"DEPLOY_ACCOUNT","version":"0x3","signature":["0x1","0x2"],"nonce":"0x0","contract_address_salt":"0x5","constructor_calldata":["0x5"],"class_hash":"0x61dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f","resource_bounds":{"l1_gas":{"max_amount":"0x0","max_price_per_unit":"0x5af3107a4000"},"l2_gas":{"max_amount":"0x1f4000","max_price_per_unit":"0x2cb417800"},"l1_data_gas":{"max_amount":"0x1b0","max_price_per_unit":"0x5dc"}},"tip":"0x0","paymaster_data":[],"nonce_data_availability_mode":"L1","fee_data_availability_mode":"L1"}}\n\n      55: Account validation failed: "Resources bounds (Max amount: 0x0, Max price: 0x5af3107a4000) exceed balance (0)."';
const RAW_MARKERS = ["starknet_addDeployAccountTransaction", "exceed balance", "55:", "params"];
const FEE = { overallFee: "1000000000000000", unit: "FRI" as const };

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

const markup = `<section class="section">
    <section id="deploy-review-stage">
      <div id="deploy-review"></div>
      <button id="deploy-button" type="button">Deploy</button>
      <p id="deploy-result" role="status"></p>
    </section>
    ${outcomeReceiptSection("deploy-success")}
  </section>`;

const settle = async (): Promise<void> => {
  for (let index = 0; index < 6; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const mount = (): Element => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.innerHTML = markup;
  document.body.append(app);
  return app;
};

const depsFor = (app: Element, deployAccount: (fee?: typeof FEE) => Promise<unknown>) =>
  ({
    app,
    confirmationDelaysMs: [0],
    deploymentScope: () => ({ accountId: account.id, stillCurrent: () => true }),
    render: async () => undefined,
    setActiveView: () => undefined,
    wallet: {
      deployAccount,
      loadActivity: async () => ({ entries: [], historyUnavailable: false }),
      loadStatus: async () => status,
    },
  }) as unknown as ShellBindingDeps;

const visibleText = (app: Element): string =>
  `${app.querySelector("#deploy-result")?.textContent ?? ""} ${
    app.querySelector("#deploy-review")?.textContent ?? ""
  } ${Array.from(document.querySelectorAll(".toast .toast-text"))
    .map((node) => node.textContent ?? "")
    .join(" ")}`;

describe("deploy screen error copy", () => {
  beforeEach(() => document.body.replaceChildren());

  test("the reported exceed-balance dump reads as the funding sentence", () => {
    const error = new Error(REPORTED);
    expect(deployErrorLine(error, "Deployment failed")).toBe(DEPLOY_NEEDS_STRK);
    expect(deployToastText(error, "Deployment failed")).toBe(DEPLOY_NEEDS_STRK);
  });

  test("an unrecognised RPC dump reads as the RPC sentence, never the dump", () => {
    const error = new Error(
      'RPC: starknet_addDeployAccountTransaction with params {"a":1}\n\n 55: Account validation failed: "invalid signature"',
    );
    expect(deployErrorLine(error, "Deployment failed")).toBe(RPC_REJECTED);
  });

  test("an unknown outcome is never read as the funding sentence", () => {
    const error = new SubmissionUnknownError("exceed balance", null);
    expect(deployErrorLine(error, "Deployment failed")).not.toBe(DEPLOY_NEEDS_STRK);
  });

  test("the multisig deploy recognises the same rejection", () => {
    const review = { address: account.address, fee: FEE } as Parameters<
      typeof deploymentFailureToast
    >[1];
    expect(deploymentFailureToast(REPORTED, review)).toStartWith(`Fund 0x`);
  });

  test("a rejected Deploy press shows the funding sentence on the status line and toast", async () => {
    const app = mount();
    bindDeploy(
      depsFor(app, async (fee) => {
        if (!fee) return FEE;
        throw new Error(REPORTED);
      }),
    );
    await settle();
    app.querySelector<HTMLButtonElement>("#deploy-button")?.click();
    await settle();

    expect(app.querySelector("#deploy-result")?.textContent).toBe(DEPLOY_NEEDS_STRK);
    expect(document.querySelector(".toast.error .toast-text")?.textContent).toBe(DEPLOY_NEEDS_STRK);
    for (const marker of RAW_MARKERS) expect(visibleText(app)).not.toContain(marker);
    expect(app.querySelector<HTMLButtonElement>("#deploy-button")?.disabled).toBe(false);
  });

  test("a failed quote puts the funding sentence in the Cost box, not the dump", async () => {
    const app = mount();
    bindDeploy(
      depsFor(app, async () => {
        throw new Error(REPORTED);
      }),
    );
    await settle();

    expect(app.querySelector("#deploy-review")?.textContent).toContain(DEPLOY_NEEDS_STRK);
    expect(app.querySelector("#deploy-result")?.textContent).toBe(DEPLOY_NEEDS_STRK);
    for (const marker of RAW_MARKERS) expect(visibleText(app)).not.toContain(marker);
  });

  test("any other failed submission shows the translated line, not the dump", async () => {
    const app = mount();
    bindDeploy(
      depsFor(app, async (fee) => {
        if (!fee) return FEE;
        throw new Error('RPC: starknet_addDeployAccountTransaction with params {"a":1}');
      }),
    );
    await settle();
    app.querySelector<HTMLButtonElement>("#deploy-button")?.click();
    await settle();

    expect(app.querySelector("#deploy-result")?.textContent).toBe(RPC_REJECTED);
    expect(visibleText(app)).not.toContain("starknet_addDeployAccountTransaction");
  });
});

describe("deploy screen notes", () => {
  const strk = (balance: string): TokenBalance => ({
    address: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    balance,
    decimals: 18,
    formatted: balance,
    id: "SN_MAIN:STRK",
    name: "Starknet Token",
    networkId: "SN_MAIN",
    symbol: "STRK",
  });
  const screen = (balances: { balances: TokenBalance[] } | { error: string }, deployed = false) =>
    dashboard("deploy-account", status, [], preferences, balances, deployed);

  test("an undeployed account with no STRK is told to add STRK, and that a send deploys it", () => {
    const html = screen({ balances: [strk("0")] });
    expect(html).toContain(DEPLOY_NEEDS_STRK);
    expect(html).toContain(FIRST_SEND_DEPLOYS);
    // Softened, not hidden: an untracked STRK balance must not strand the action.
    expect(html).toMatch(/<button[^>]*id="deploy-button"(?![^>]*disabled)/);
  });

  test("a funded account is not told to add STRK", () => {
    const html = screen({ balances: [strk("1000")] });
    expect(html).not.toContain(DEPLOY_NEEDS_STRK);
    expect(html).toContain(FIRST_SEND_DEPLOYS);
  });

  test("an unread balance says nothing about funding", () => {
    expect(screen({ error: "balances unavailable" })).not.toContain(DEPLOY_NEEDS_STRK);
  });

  test("a deployed account shows neither note", () => {
    const html = screen({ balances: [strk("0")] }, true);
    expect(html).not.toContain(DEPLOY_NEEDS_STRK);
    expect(html).not.toContain(FIRST_SEND_DEPLOYS);
  });

  test("a Braavos account is not told its first send deploys it", () => {
    const braavos = { ...account, accountContractType: "braavos", deploymentSalt: "0x5" };
    const html = dashboard(
      "deploy-account",
      { ...status, accounts: [braavos] } as WalletStatus,
      [],
      preferences,
      { balances: [strk("0")] },
      false,
    );
    expect(html).toContain(DEPLOY_NEEDS_STRK);
    expect(html).not.toContain(FIRST_SEND_DEPLOYS);
  });
});
