/**
 * Arming the private settle watch: only a confirmed private route (shield,
 * unshield, private send) starts the bounded privacy re-read. A public transfer
 * moved nothing private, and a private route the chain rejected moved nothing
 * at all, so neither should make the home re-read.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { account } from "@bramble/testkit/sidepanel";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import { sendFlow } from "../../../../src/sidepanel/app/screens/flows";
import type { PrivacyDisclosureState } from "../../../../src/sidepanel/journeys/privacy/privacy-model";
import type { SendIntent } from "../../../../src/sidepanel/journeys/send/send-model";
import {
  bindTransfer,
  type TransferUiDeps,
} from "../../../../src/sidepanel/journeys/send/transfer-ui";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import {
  flush,
  mountTransferUi as mount,
  paint,
  transferPreferences as preferences,
  transferPublicBalance as publicBalance,
  walletStatus as status,
  submitTransferForm as submit,
} from "../../../support/transfer-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const HASH = "0xfeed";

const strkBalance = {
  address: STRK_TOKEN_ADDRESS,
  balance: "50000000000000000000",
  decimals: 18,
  formatted: "50",
  id: `SN_MAIN:STRK:${STRK_TOKEN_ADDRESS}`,
  name: "Starknet Token",
  networkId: "SN_MAIN" as const,
  symbol: "STRK",
};

const registered: PrivacyDisclosureState = {
  error: null,
  loading: false,
  value: {
    accountId: account.id,
    balances: [],
    networkId: "SN_MAIN",
    poolFeeFri: "0x1",
    relayConfigured: true,
    registration: "registered",
  },
};

const shieldIntent: SendIntent = {
  accountId: account.id,
  destination: "private",
  networkId: status.networkId,
  recipient: account.address,
  recipientLabel: "Account 1",
  source: "public",
  tokenId: publicBalance.id,
};

const activityFor = (chainStatus: "accepted" | "reverted") => [
  {
    accountId: account.id,
    hash: HASH,
    kind: "transfer" as const,
    networkId: "SN_MAIN" as const,
    status: chainStatus,
    submittedAt: 1,
    summary: "Shield 1 ETH",
  },
];

const typeAmount = (app: HTMLElement, value: string): void => {
  const input = app.querySelector<HTMLInputElement>("#send-amount-input");
  if (!input) throw new Error("amount input missing");
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

const mountShield = (chainStatus: "accepted" | "reverted", onPrivateSendConfirmed: () => void) => {
  const mounted = mount({
    async executePrivacyPreparation() {
      return HASH;
    },
    async loadActivity() {
      return { entries: activityFor(chainStatus), historyUnavailable: false };
    },
    async loadPrivacyRecipientStatus() {
      return "registered";
    },
  });
  paint(
    mounted.app,
    sendFlow(
      status,
      account,
      preferences,
      [publicBalance, strkBalance],
      {},
      {},
      "usd",
      [],
      shieldIntent,
    ),
  );
  bindTransfer({
    ...mounted.deps,
    confirmationDelaysMs: [0],
    onPrivateSendConfirmed,
    privacy: () => registered,
    publicBalances: () => [publicBalance, strkBalance],
    senderAddress: () => account.address,
    waitForConfirmation: async () => undefined,
  });
  return mounted.app;
};

const mountPublic = (chainStatus: "accepted" | "reverted", onPrivateSendConfirmed: () => void) => {
  const mounted = mount({
    async loadActivity() {
      return { entries: activityFor(chainStatus), historyUnavailable: false };
    },
    async reviewTransfer() {
      return {
        fee: { overallFee: "1000", unit: "FRI" as const },
        feeEstimateFailed: false,
        flags: [],
        requiresDeployment: false,
        summaries: ["Transfer 1 ETH"],
      };
    },
    async submitTransfer() {
      return HASH;
    },
  });
  paint(
    mounted.app,
    sendFlow(status, account, preferences, [publicBalance, strkBalance], {}, {}, "usd", []),
  );
  const deps: TransferUiDeps = {
    ...mounted.deps,
    confirmationDelaysMs: [0],
    onPrivateSendConfirmed,
    publicBalances: () => [publicBalance, strkBalance],
    waitForConfirmation: async () => undefined,
  };
  bindTransfer(deps);
  const form = mounted.app.querySelector<HTMLFormElement>("#transfer-form");
  const set = (name: string, value: string): void => {
    const input = form?.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    if (!input) throw new Error(`Missing ${name}`);
    input.value = value;
  };
  set("recipient", "0x02a3f4b1c5d6e7089a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6071");
  set("recipientLabel", "Treasury");
  set("amount", "1");
  return mounted.app;
};

const confirmTwice = async (app: HTMLElement): Promise<void> => {
  submit(app);
  await flush();
  submit(app);
  await flush();
  await flush();
};

beforeEach(() => {
  document.body.replaceChildren();
});

describe("private settle watch arming", () => {
  test("a confirmed shield starts the bounded privacy re-read", async () => {
    let confirmed = 0;
    const app = mountShield("accepted", () => {
      confirmed += 1;
    });
    typeAmount(app, "1");

    await confirmTwice(app);

    expect(app.querySelector("#send-success")?.hasAttribute("hidden")).toBe(false);
    expect(confirmed).toBe(1);
  });

  test("a private route the chain reverted does not start the watch", async () => {
    let confirmed = 0;
    const app = mountShield("reverted", () => {
      confirmed += 1;
    });
    typeAmount(app, "1");

    await confirmTwice(app);

    expect(confirmed).toBe(0);
  });

  test("a public transfer never starts the watch", async () => {
    let confirmed = 0;
    const app = mountPublic("accepted", () => {
      confirmed += 1;
    });

    await confirmTwice(app);

    expect(confirmed).toBe(0);
  });
});
