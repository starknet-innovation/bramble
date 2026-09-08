/**
 * Chain-status coverage for Send outcomes. A broadcast hash is not success:
 * only accepted activity reaches the green receipt, while reverted and delayed
 * statuses retain distinct recovery states.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { account } from "@bramble/testkit/sidepanel";
import type { ActivityStatus } from "@bramble/transactions/activity";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { sendFlow } from "../../../../src/sidepanel/journeys/send/send-views";
import {
  CONFIRMATION_DELAYS_MS,
  confirmationOutcome,
} from "../../../../src/sidepanel/journeys/send/transfer-model";
import {
  bindTransfer,
  type TransferUiDeps,
} from "../../../../src/sidepanel/journeys/send/transfer-ui";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

const HASH = "0x1234";
const RECIPIENT = "0x2345";
const TOKEN_ADDRESS = "0x3456";
const TOKEN_ID = `SN_MAIN:TST:${TOKEN_ADDRESS}`;
const TOKEN = {
  address: TOKEN_ADDRESS,
  decimals: 6,
  id: TOKEN_ID,
  name: "Test token",
  networkId: "SN_MAIN" as const,
  symbol: "TST",
};
const BALANCE = { ...TOKEN, balance: "10000000", formatted: "10" };

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

const preferences: WalletPreferences = {
  activeNetworkId: "SN_MAIN",
  addressBook: [],
  schemaVersion: 1,
  tokens: [TOKEN],
};

beforeAll(registerDom);
afterAll(unregisterDom);

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const mountOutcome = (chainStatus: ActivityStatus) => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.replaceChildren(
    document
      .createRange()
      .createContextualFragment(
        sendFlow(status, account, preferences, [BALANCE], { [TOKEN_ADDRESS]: 1 }),
      ),
  );
  document.body.append(app);
  const wallet = {
    async loadActivity() {
      return {
        entries: [
          {
            accountId: account.id,
            hash: HASH,
            kind: "transfer" as const,
            networkId: "SN_MAIN" as const,
            status: chainStatus,
            submittedAt: 1,
            summary: "Sent 1 TST",
          },
        ],
        historyUnavailable: false,
      };
    },
    async reviewTransfer() {
      return {
        fee: { overallFee: "1000", unit: "FRI" as const },
        feeEstimateFailed: false,
        flags: [],
        requiresDeployment: false,
        summaries: ["Transfer 1 TST"],
      };
    },
    async submitTransfer() {
      return HASH;
    },
  };
  const deps: TransferUiDeps = {
    app,
    confirmationDelaysMs: [0],
    publicBalances: () => [BALANCE],
    render: async () => undefined,
    waitForConfirmation: async () => undefined,
    wallet: wallet as unknown as TransferUiDeps["wallet"],
  };
  bindTransfer(deps);
  const form = app.querySelector<HTMLFormElement>("#transfer-form");
  if (!form) throw new Error("Missing Send form");
  const set = (name: string, value: string): void => {
    const input = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    if (!input) throw new Error(`Missing ${name}`);
    input.value = value;
  };
  set("recipient", RECIPIENT);
  set("recipientLabel", "Treasury");
  set("amount", "1");
  return { app, form };
};

const submitTwice = async (form: HTMLFormElement): Promise<void> => {
  form.requestSubmit();
  await flush();
  form.requestSubmit();
  await flush();
  await flush();
};

describe("Send confirmation outcomes", () => {
  test("shows confirmed success only after accepted chain status", async () => {
    const { app, form } = mountOutcome("accepted");
    await submitTwice(form);
    expect(form.dataset["stage"]).toBe("submitted");
    expect(app.querySelector("#send-success")?.hasAttribute("hidden")).toBe(false);
    expect(app.querySelector("#send-success-hash")?.textContent).toBe(HASH);
  });

  // The point of the fast-confirmation work: a pre-confirmation is a real
  // answer, so the journey completes on it instead of sitting on a spinner
  // until the pending fallback fires ~10s later.
  test("completes the journey on a pre-confirmation, not only on acceptance", async () => {
    const { app, form } = mountOutcome("preconfirmed");
    await submitTwice(form);
    expect(form.dataset["stage"]).toBe("submitted");
    expect(app.querySelector("#send-success")?.hasAttribute("hidden")).toBe(false);
    expect(app.querySelector("#send-success-hash")?.textContent).toBe(HASH);
  });

  test("shows the failure recovery state when Starknet rejects", async () => {
    const { app, form } = mountOutcome("rejected");
    await submitTwice(form);
    expect(form.dataset["stage"]).toBe("failed");
    expect(app.querySelector("#send-failure-copy")?.textContent).toContain("rejected");
  });

  test("shows the failure recovery state when Starknet reverts", async () => {
    const { app, form } = mountOutcome("reverted");
    await submitTwice(form);
    expect(form.dataset["stage"]).toBe("failed");
    expect(app.querySelector("#send-failure-copy")?.textContent).toContain("reverted");
    expect(app.querySelector("#send-failure")?.hasAttribute("hidden")).toBe(false);
  });

  test("keeps an unconfirmed hash in an honest pending state", async () => {
    const { app, form } = mountOutcome("pending");
    await submitTwice(form);
    expect(form.dataset["stage"]).toBe("pending");
    expect(app.querySelector("#send-pending")?.hasAttribute("hidden")).toBe(false);
    expect(app.querySelector("#send-pending-hash")?.textContent).toBe(HASH);
  });
});

describe("confirmation cadence", () => {
  test("keeps checking for about a minute before handing over to Check again", () => {
    // A pre-confirmation can take longer than a ten-second burst to appear, and
    // giving up early stranded the user on "Confirmation pending" for a
    // transaction that was seconds from settling.
    const total = CONFIRMATION_DELAYS_MS.reduce((sum, delay) => sum + delay, 0);
    expect(total).toBeGreaterThanOrEqual(50_000);
    // Backs off rather than hammering: every gap is at least as long as the last.
    for (const [index, delay] of CONFIRMATION_DELAYS_MS.entries()) {
      expect(delay).toBeGreaterThanOrEqual(CONFIRMATION_DELAYS_MS[index - 1] ?? 0);
    }
    // The first check is immediate, so an already-settled transaction is caught
    // without waiting at all.
    expect(CONFIRMATION_DELAYS_MS[0]).toBe(0);
  });

  test("a pre-confirmation completes the journey instead of waiting for L2", () => {
    expect(confirmationOutcome("preconfirmed")).toEqual({
      kind: "succeeded",
      toast: "Transaction pre-confirmed on Starknet",
    });
    expect(confirmationOutcome("pending")).toBeNull();
  });
});
