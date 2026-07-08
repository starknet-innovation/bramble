/**
 * STRK20 service checks prove the prepare pipeline enforces registration,
 * balances, and the leak guard, and never fabricates a proof.
 */
import { describe, expect, test } from "bun:test";
import { errorForMessage } from "../src/background/wallet-rpc-errors";
import { unconfiguredProvingBackend } from "../src/starknet/strk20/proving-backend";
import type { Strk20CallAndProof } from "../src/starknet/strk20/schemas";
import {
  prepareStrk20CallAndProof,
  readStrk20Balances,
  type Strk20Service,
  unavailableStrk20Service,
} from "../src/starknet/strk20/service";
import type { AccountRef } from "../src/storage/vault-schema";

const token = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const account = { id: "SN_SEPOLIA:0x1", networkId: "SN_SEPOLIA" } as unknown as AccountRef;
const rpcUrls = ["https://rpc.example"];
const callAndProof: Strk20CallAndProof = {
  call: { calldata: ["0x1"], contract_address: token, entry_point: "run" },
  proof: { data: "p", output: ["0x1"], proof_facts: ["0x2"] },
};

const service = (over: Partial<Strk20Service>): Strk20Service => ({
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

const codeOf = async (run: () => Promise<unknown>): Promise<number> => {
  try {
    await run();
  } catch (error) {
    return errorForMessage(error instanceof Error ? error.message : "").code;
  }
  throw new Error("expected a rejection");
};

describe("strk20 service", () => {
  test("the unavailable default reports the account as not registered (118)", async () => {
    expect(
      await codeOf(() =>
        readStrk20Balances(unavailableStrk20Service, {
          account,
          proverUrl: null,
          rpcUrls,
          tokens: [token],
        }),
      ),
    ).toBe(118);
    expect(unavailableStrk20Service.proving).toBe(unconfiguredProvingBackend);
  });

  test("builds a call-and-proof for a valid, sufficient batch", async () => {
    await expect(
      prepareStrk20CallAndProof(service({}), {
        account,
        actions: [{ action: "withdraw", amount: "10", token }],
        proverUrl: null,
        rpcUrls,
        simulate: false,
      }),
    ).resolves.toEqual(callAndProof);
  });

  test("maps each guard to its spec code", async () => {
    expect(
      await codeOf(() =>
        prepareStrk20CallAndProof(
          service({
            async registered() {
              return false;
            },
          }),
          {
            account,
            actions: [{ action: "deposit", amount: "1", token }],
            proverUrl: null,
            rpcUrls,
            simulate: false,
          },
        ),
      ),
    ).toBe(118);
    expect(
      await codeOf(() =>
        prepareStrk20CallAndProof(
          service({
            async privateBalances() {
              return [{ balance: "0x1", token }];
            },
          }),
          {
            account,
            actions: [{ action: "withdraw", amount: "1000", token }],
            proverUrl: null,
            rpcUrls,
            simulate: false,
          },
        ),
      ),
    ).toBe(119);
    expect(
      await codeOf(() =>
        prepareStrk20CallAndProof(service({}), {
          account,
          actions: [
            { action: "deposit", amount: "5", token },
            { action: "withdraw", amount: "5", token },
          ],
          proverUrl: null,
          rpcUrls,
          simulate: false,
        }),
      ),
    ).toBe(120);
  });

  test("refuses with UNKNOWN_ERROR (163) when a registered account has no prover", async () => {
    expect(
      await codeOf(() =>
        prepareStrk20CallAndProof(service({ proving: unconfiguredProvingBackend }), {
          account,
          actions: [{ action: "invoke", call: callAndProof.call }],
          proverUrl: null,
          rpcUrls,
          simulate: false,
        }),
      ),
    ).toBe(163);
  });
});
