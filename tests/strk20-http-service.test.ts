/**
 * HTTP STRK20 service checks prove a null prover reproduces the unavailable
 * behavior, a configured prover parses each documented response, and a non-ok or
 * malformed response maps back to the stable spec error.
 */
import { describe, expect, test } from "bun:test";
import { createHttpStrk20Service, type Strk20Http } from "../src/starknet/strk20/http-service";
import { STRK20_PROVING_UNAVAILABLE } from "../src/starknet/strk20/proving-backend";
import type { Strk20CallAndProof } from "../src/starknet/strk20/schemas";
import { STRK20_NOT_REGISTERED } from "../src/starknet/strk20/service";
import type { AccountRef } from "../src/storage/vault-schema";

const token = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const account = { address: "0x1", id: "SN_SEPOLIA:0x1", networkId: "SN_SEPOLIA" } as AccountRef;
const rpcUrls = ["https://rpc.example"];
const proverUrl = "https://prover.example/strk20";
const callAndProof: Strk20CallAndProof = {
  call: { calldata: ["0x1"], contract_address: token, entry_point: "run" },
  proof: { data: "p", output: ["0x1"], proof_facts: ["0x2"] },
};

// A mock transport that records the request and returns a canned payload.
const httpReturning = (payload: unknown, ok = true): { http: Strk20Http; calls: string[] } => {
  const calls: string[] = [];
  const http: Strk20Http = async (url) => {
    calls.push(url);
    return { json: async () => payload, ok };
  };
  return { calls, http };
};

describe("createHttpStrk20Service", () => {
  test("a null prover reproduces the unavailable service", async () => {
    const { http, calls } = httpReturning(null);
    const service = createHttpStrk20Service(http);

    expect(await service.registered({ account, proverUrl: null, rpcUrls })).toBe(false);
    await expect(
      service.privateBalances({ account, proverUrl: null, rpcUrls, tokens: [token] }),
    ).rejects.toThrow(STRK20_NOT_REGISTERED);
    await expect(
      service.proving.prove({
        account,
        actions: [{ action: "invoke", call: callAndProof.call }],
        balances: [],
        proverUrl: null,
        rpcUrls,
        simulate: false,
      }),
    ).rejects.toThrow(STRK20_PROVING_UNAVAILABLE);
    expect(calls).toEqual([]);
  });

  test("a configured prover parses each documented response", async () => {
    const registered = createHttpStrk20Service(httpReturning({ registered: true }).http);
    expect(await registered.registered({ account, proverUrl, rpcUrls })).toBe(true);

    const balancesTransport = httpReturning([{ balance: "0x64", token }]);
    const balances = createHttpStrk20Service(balancesTransport.http);
    await expect(
      balances.privateBalances({ account, proverUrl, rpcUrls, tokens: [token] }),
    ).resolves.toEqual([{ balance: "0x64", token }]);
    expect(balancesTransport.calls).toEqual(["https://prover.example/strk20/balances"]);

    const proving = createHttpStrk20Service(httpReturning(callAndProof).http);
    await expect(
      proving.proving.prove({
        account,
        actions: [{ action: "invoke", call: callAndProof.call }],
        balances: [],
        proverUrl,
        rpcUrls,
        simulate: true,
      }),
    ).resolves.toEqual(callAndProof);
  });

  test("a non-ok response maps to the stable spec error", async () => {
    const service = createHttpStrk20Service(httpReturning({ registered: true }, false).http);

    await expect(service.registered({ account, proverUrl, rpcUrls })).rejects.toThrow(
      STRK20_NOT_REGISTERED,
    );
    await expect(
      createHttpStrk20Service(
        httpReturning([{ balance: "0x64", token }], false).http,
      ).privateBalances({ account, proverUrl, rpcUrls, tokens: [token] }),
    ).rejects.toThrow(STRK20_NOT_REGISTERED);
    await expect(
      createHttpStrk20Service(httpReturning(callAndProof, false).http).proving.prove({
        account,
        actions: [{ action: "invoke", call: callAndProof.call }],
        balances: [],
        proverUrl,
        rpcUrls,
        simulate: false,
      }),
    ).rejects.toThrow(STRK20_PROVING_UNAVAILABLE);
  });

  test("a malformed response maps to the stable spec error", async () => {
    await expect(
      createHttpStrk20Service(httpReturning({ registered: "yes" }).http).registered({
        account,
        proverUrl,
        rpcUrls,
      }),
    ).rejects.toThrow(STRK20_NOT_REGISTERED);
    await expect(
      createHttpStrk20Service(
        httpReturning([{ balance: "not-a-felt", token }]).http,
      ).privateBalances({ account, proverUrl, rpcUrls, tokens: [token] }),
    ).rejects.toThrow(STRK20_NOT_REGISTERED);
    await expect(
      createHttpStrk20Service(httpReturning({ call: callAndProof.call }).http).proving.prove({
        account,
        actions: [{ action: "invoke", call: callAndProof.call }],
        balances: [],
        proverUrl,
        rpcUrls,
        simulate: false,
      }),
    ).rejects.toThrow(STRK20_PROVING_UNAVAILABLE);
  });
});
