/**
 * STRK20 service error/guard and summary branches: the unavailable default's
 * private-balance read, the privacy-leak guard reached through the prepare
 * pipeline, and summarizeStrk20Action for every action kind (deposit, withdraw,
 * transfer numeric + OPEN, invoke). Complements strk20-service.test.ts.
 */
import { describe, expect, test } from "bun:test";
import type { Strk20Action, Strk20CallAndProof } from "../src/starknet/strk20/schemas";
import {
  prepareStrk20CallAndProof,
  STRK20_NOT_REGISTERED,
  STRK20_PRIVACY_LEAK,
  type Strk20Service,
  summarizeStrk20Action,
  unavailableStrk20Service,
} from "../src/starknet/strk20/service";
import type { AccountRef } from "../src/storage/vault-schema";

const token = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const recipient = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const account = { id: "SN_SEPOLIA:0x1", networkId: "SN_SEPOLIA" } as unknown as AccountRef;
const rpcUrls = ["https://rpc.example"];

const callAndProof: Strk20CallAndProof = {
  call: { calldata: ["0x1"], contract_address: token, entry_point: "run" },
  proof: { data: "p", output: ["0x1"], proof_facts: ["0x2"] },
};

const service = (over: Partial<Strk20Service> = {}): Strk20Service => ({
  async privateBalances({ tokens }) {
    return tokens.map((entry) => ({ balance: "0x64", token: entry }));
  },
  proving: {
    async prove() {
      return callAndProof;
    },
  },
  async registered() {
    return true;
  },
  ...over,
});

describe("unavailableStrk20Service", () => {
  test("privateBalances rejects with NOT_REGISTERED", async () => {
    await expect(
      unavailableStrk20Service.privateBalances({
        account,
        proverUrl: null,
        rpcUrls,
        tokens: [token],
      }),
    ).rejects.toThrow(STRK20_NOT_REGISTERED);
  });

  test("registered reports false", async () => {
    expect(await unavailableStrk20Service.registered({ account, proverUrl: null, rpcUrls })).toBe(
      false,
    );
  });
});

describe("prepareStrk20CallAndProof leak guard", () => {
  test("refuses a batch that deposits and withdraws the same token", async () => {
    await expect(
      prepareStrk20CallAndProof(service(), {
        account,
        actions: [
          { amount: "0x05", token, type: "deposit" },
          { amount: "0x05", recipient, token, type: "withdraw" },
        ],
        proverUrl: null,
        rpcUrls,
        simulate: false,
      }),
    ).rejects.toThrow(STRK20_PRIVACY_LEAK);
  });
});

describe("summarizeStrk20Action", () => {
  test("summarizes a deposit action", () => {
    const action: Strk20Action = { amount: "100", token, type: "deposit" };
    const summary = summarizeStrk20Action(action);
    expect(summary).toContain("Deposit 100 to private balance");
    expect(summary).toContain("0x049d36…4dc7");
  });

  test("summarizes a withdraw action with recipient and token", () => {
    const action: Strk20Action = { amount: "50", recipient, token, type: "withdraw" };
    const summary = summarizeStrk20Action(action);
    expect(summary).toContain("Withdraw 50 to 0x04718f");
    expect(summary).toContain("0x049d36");
  });

  test("summarizes a numeric transfer action", () => {
    const action: Strk20Action = { amount: "25", recipient, token, type: "transfer" };
    const summary = summarizeStrk20Action(action);
    expect(summary).toContain("Transfer 25 privately to 0x04718f");
  });

  test("summarizes an OPEN transfer as an open note", () => {
    const action: Strk20Action = { amount: "OPEN", recipient, token, type: "transfer" };
    const summary = summarizeStrk20Action(action);
    expect(summary).toContain("Transfer an open note privately to 0x04718f");
  });

  test("summarizes an invoke action by contract", () => {
    const action: Strk20Action = { calldata: ["0x1"], contract: token, type: "invoke" };
    expect(summarizeStrk20Action(action)).toContain("Private invoke on 0x049d36");
  });

  test("keeps a short address unshortened", () => {
    const action: Strk20Action = { amount: "1", token: "0x123", type: "deposit" };
    expect(summarizeStrk20Action(action)).toContain("(0x123)");
  });
});
