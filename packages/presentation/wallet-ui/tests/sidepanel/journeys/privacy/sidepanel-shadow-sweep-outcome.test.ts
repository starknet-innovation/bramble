/**
 * A shadow sweep whose outcome is unknown is not a failure (errors audit F4).
 * The worker may have broadcast it, so the toast is amber and Confirm gives way
 * to the outcome line instead of being offered again. A known refusal stays
 * red and leaves Confirm usable.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
import { PRIVATE_EXECUTION_UNKNOWN } from "../../../../src/sidepanel/journeys/privacy/privacy-preparation-job";
import type { PrivacyPreparation } from "../../../../src/sidepanel/journeys/privacy/privacy-runtime";
import { bindShadowAccounts } from "../../../../src/sidepanel/journeys/privacy/shadow-accounts-ui";
import { shadowAccountsFlow } from "../../../../src/sidepanel/journeys/privacy/shadow-accounts-view";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const status = {
  accountCount: 1,
  accounts: [],
  activeAccountId: null,
  hasVault: true,
  locked: false,
  network: "Starknet Sepolia",
  networkId: "SN_SEPOLIA",
  networks: [{ id: "SN_SEPOLIA", name: "Starknet Sepolia" }],
  ready: true,
} as const;
const scope = {
  anonymizer: "0x4f3",
  current: true,
  label: "Market",
  nonces: ["0x1"],
  origin: "https://app.example",
};
const account = {
  address: "0x5ad01",
  balances: [{ balance: "0x1", formatted: "2", symbol: "STRK", tokenId: "SN_SEPOLIA:STRK:0x4718" }],
  deployed: true,
  nonce: "0x1",
  recorded: true,
};
const preparation: PrivacyPreparation = {
  id: `sha256:${"a".repeat(64)}`,
  kind: "shadow-sweep",
  payloadDigest: `sha256:${"a".repeat(64)}`,
  poolAddress: "0x1",
  recipient: "0x2",
  relayFee: { amount: "0x1", recipient: "0x3", token: "0x4" },
  route: "private-relay",
  summaries: ["Sweep your shadow account #1 for https://app.example"],
  symbol: "STRK",
  tokenId: "SN_SEPOLIA:STRK:0x4718",
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const sweepWith = async (failure: Error): Promise<HTMLElement> => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.innerHTML = shadowAccountsFlow(status as never);
  document.body.append(app);
  bindShadowAccounts({
    app,
    wallet: {
      executePrivacyPreparation: async () => {
        throw failure;
      },
      loadShadowAccountBalances: async () => ({ accounts: [account], unlisted: [] }),
      loadShadowAccounts: async () => [scope],
      prepareShadowSweep: async () => preparation,
    },
  });
  await settle();
  const button = (label: string) =>
    [...app.querySelectorAll("button")].find((node) => node.textContent === label);
  button("Check balances")?.click();
  await settle();
  button("Sweep")?.click();
  await settle();
  button("Confirm sweep")?.click();
  await settle();
  return app;
};

const confirmButton = (app: Element) =>
  [...app.querySelectorAll("button")].find((node) => node.textContent === "Confirm sweep");

describe("a shadow sweep's failure", () => {
  test("an unknown outcome is amber and Confirm is not offered again", async () => {
    const app = await sweepWith(new SubmissionUnknownError(PRIVATE_EXECUTION_UNKNOWN, null));
    expect(document.querySelector(".toast")?.classList.contains("warning")).toBe(true);
    expect(document.querySelector(".toast.error")).toBeNull();
    expect(confirmButton(app)).toBeUndefined();
    expect(app.textContent).toContain(PRIVATE_EXECUTION_UNKNOWN);
  });

  test("a known refusal stays red and leaves Confirm usable", async () => {
    const app = await sweepWith(new Error("Privacy preparation not found"));
    expect(document.querySelector(".toast")?.classList.contains("error")).toBe(true);
    expect(confirmButton(app)?.disabled).toBe(false);
  });
});
