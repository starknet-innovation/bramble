/**
 * Shared fixtures for the Send amount-screen fee preview suites: the composed
 * fields, the route context and review they resolve to, and the pool-fee
 * readings a private route needs. Kept in one place so the unit and integration
 * suites price the same send, and so each suite stays inside the file budget.
 */

import { account } from "@bramble/testkit/sidepanel";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import type { PrivacyDisclosureState } from "../../src/sidepanel/journeys/privacy/privacy-model";
import type { TransferFields } from "../../src/sidepanel/journeys/send/transfer-model";
import type { TransferRouteContext } from "../../src/sidepanel/journeys/send/transfer-route";
import type { TransferReview } from "../../src/sidepanel/journeys/send/transfer-submit";
import { transferPublicBalance as publicBalance, TRANSFER_RECIPIENT } from "./transfer-ui-harness";

const FEE = { overallFee: "2000000000000000", unit: "FRI" };
export const DEPLOYMENT_FEE = { overallFee: "1000000000000000", unit: "FRI" };
const TWO_STRK_FRI = "2000000000000000000";

// The pool charges in STRK, so a route that pays one needs a STRK reading.
export const strkBalance = {
  address: STRK_TOKEN_ADDRESS,
  balance: "50000000000000000000",
  decimals: 18,
  formatted: "50",
  id: `SN_MAIN:STRK:${STRK_TOKEN_ADDRESS}`,
  name: "Starknet Token",
  networkId: "SN_MAIN" as const,
  symbol: "STRK",
};

export const FIELDS: TransferFields = {
  accountId: account.id,
  amount: "1",
  destination: "public",
  fiatEstimate: "",
  recipient: TRANSFER_RECIPIENT,
  recipientLabel: "",
  signer: "software",
  source: "public",
  speed: "standard",
  tokenAddress: publicBalance.address,
  tokenBalance: "100000000000000000000",
  tokenDecimals: "18",
  tokenFormatted: "100",
  tokenId: publicBalance.id,
  tokenPrice: "",
  tokenSymbol: "ETH",
};

export const review = (overrides: Partial<TransferReview> = {}): TransferReview => ({
  fee: FEE,
  feeAffordability: "ok",
  feeEstimateFailed: false,
  flags: [],
  requiresDeployment: false,
  summaries: ["Transfer 1 ETH"],
  ...overrides,
});

export const context = (
  overrides: Partial<TransferRouteContext> = {},
  fields: Partial<TransferFields> = {},
): TransferRouteContext => ({
  fields: { ...FIELDS, ...fields },
  privacy: { error: null, loading: false, value: null },
  publicBalances: [publicBalance, strkBalance],
  recipientRegistration: "registered",
  senderAddress: account.address,
  ...overrides,
});

export const registered: PrivacyDisclosureState = {
  error: null,
  loading: false,
  value: {
    accountId: account.id,
    balances: [
      {
        balance: "100000000000000000000",
        formatted: "100",
        symbol: "ETH",
        token: publicBalance.address,
        tokenId: publicBalance.id,
      },
    ],
    networkId: "SN_MAIN",
    poolFeeFri: TWO_STRK_FRI,
    relayConfigured: true,
    registration: "registered",
  },
};
