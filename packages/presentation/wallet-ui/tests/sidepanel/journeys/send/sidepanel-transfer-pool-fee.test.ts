/**
 * The pool fee is named in the token that pays it. Release lets a configured
 * token other than STRK pay the pool fee; the Send gate's refusal and the
 * Amount screen's fee line must state that fee in its own token and scale, the
 * way the review does, never as STRK.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import type { TokenBalance } from "../../../../src/popup/responses/responses";
import type { PrivacyDisclosureState } from "../../../../src/sidepanel/journeys/privacy/privacy-model";
import {
  composeFeeLines,
  composeFeeTarget,
} from "../../../../src/sidepanel/journeys/send/transfer-compose-fee";
import { transferFields } from "../../../../src/sidepanel/journeys/send/transfer-model";
import { resolveTransferRoute } from "../../../../src/sidepanel/journeys/send/transfer-route";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => {
  document.body.replaceChildren();
});

const SIX_STRK = "6000000000000000000";
const SENDER = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const RECIPIENT = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const strk: TokenBalance = {
  address: STRK_TOKEN_ADDRESS,
  balance: "100000000000000000000",
  decimals: 18,
  formatted: "100",
  id: "SN_MAIN:STRK:0x04718",
  name: "Starknet Token",
  networkId: "SN_MAIN",
  symbol: "STRK",
};

// A composed private send of `token`, as the Send form carries it.
const mountForm = (token: { address: string; id: string; symbol: string }): HTMLFormElement => {
  const form = document.createElement("form");
  const fields: Record<string, string> = {
    amount: "1",
    destination: "private",
    recipient: RECIPIENT,
    source: "private",
    tokenAddress: token.address,
    tokenBalance: "0",
    tokenDecimals: "18",
    tokenFormatted: "0",
    tokenId: token.id,
    tokenSymbol: token.symbol,
  };
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.append(input);
  }
  document.body.append(form);
  return form;
};

describe("pool fee in its own token", () => {
  // A private ETH send whose relay fee falls back to a configured USDC fee
  // token: every figure names the USDC fee at USDC's scale, read from the
  // public token list, never STRK's.
  const USDC = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
  const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
  const usdc: TokenBalance = {
    address: USDC,
    balance: "0",
    decimals: 6,
    formatted: "0",
    id: "SN_MAIN:USDC",
    name: "USD Coin",
    networkId: "SN_MAIN",
    symbol: "USDC",
  };
  const ethSend = (privateUsdc: string) => {
    const form = mountForm({ address: ETH, id: "SN_MAIN:ETH", symbol: "ETH" });
    const privacy: PrivacyDisclosureState = {
      error: null,
      loading: false,
      value: {
        accountId: "SN_MAIN:0x1",
        balances: [
          {
            balance: "5000000000000000000",
            formatted: "5",
            symbol: "ETH",
            token: ETH,
            tokenId: "SN_MAIN:ETH",
          },
          {
            balance: privateUsdc,
            feeCeiling: "6000000",
            formatted: "0",
            symbol: "USDC",
            token: USDC,
            tokenId: "SN_MAIN:USDC",
          },
        ],
        feeToken: USDC,
        networkId: "SN_MAIN",
        poolFeeFri: SIX_STRK,
        relayConfigured: true,
        registration: "registered",
      },
    };
    return {
      fields: transferFields(form),
      privacy,
      publicBalances: [strk, usdc],
      recipientRegistration: "registered" as const,
      senderAddress: SENDER,
    };
  };

  test("the refusal states a non-STRK fee in its own token and decimals", () => {
    expect(resolveTransferRoute(ethSend("0")).blocked?.reason).toBe(
      "Not enough private USDC to cover the pool fee. You need at least 6 USDC.",
    );
  });

  test("the Amount screen names the same fee the gate reserves, not STRK", () => {
    const target = composeFeeTarget(ethSend("100000000"));
    expect(target?.poolFee).toBe("6 USDC");
    expect(target ? composeFeeLines(target, { failed: false, review: null }) : []).toEqual([
      "Pool fee: 6 USDC from your private balance",
    ]);
  });
});
