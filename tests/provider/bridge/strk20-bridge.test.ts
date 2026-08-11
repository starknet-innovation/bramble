/**
 * STRK20 bridge checks prove params map to runtime messages and results map to
 * spec-exact page payloads and error codes.
 */
import { describe, expect, test } from "bun:test";
import {
  type ProviderRequest,
  providerResponse,
  readProviderResponse,
  toProviderPayload,
  toRuntimeMessage,
} from "@mc-wallet/wallet-protocol/bridge";
import { readProviderParams } from "@mc-wallet/wallet-protocol/request-params";

const origin = "https://example.com";
const token = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const recipient = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const uuid = "123e4567-e89b-42d3-a456-426614174000";

// The spec's literal `${poolAddress}` calldata placeholder, assembled by
// interpolation so the source carries no bare "${" template token.
const poolAddressPlaceholder = `${"$"}{poolAddress}`;

const request = (method: ProviderRequest["method"], params?: unknown): ProviderRequest =>
  ({ id: uuid, method, ...(params === undefined ? {} : { params }) }) as ProviderRequest;

const callAndProof = {
  call: { calldata: ["0x1"], contract_address: token, entry_point: "shielded_execute" },
  proof: { data: "proof", output: ["0x1"], proof_facts: ["0x2"] },
};

describe("strk20 bridge params", () => {
  test("maps the MC registration capability without accepting parameters", () => {
    expect(toRuntimeMessage(request("mc_strk20Register"), origin)).toEqual({
      origin,
      type: "wallet.strk20Register",
    });
    expect(toRuntimeMessage(request("mc_strk20Register", {}), origin)).toBeNull();
  });

  test("maps balances params to a runtime message", () => {
    expect(toRuntimeMessage(request("wallet_strk20Balances", { tokens: [token] }), origin)).toEqual(
      {
        origin,
        tokens: [token],
        type: "wallet.strk20Balances",
      },
    );
    expect(toRuntimeMessage(request("wallet_strk20Balances", { tokens: [] }), origin)).toEqual({
      origin,
      tokens: [],
      type: "wallet.strk20Balances",
    });
  });

  test("maps prepare params with a default simulate flag", () => {
    expect(
      toRuntimeMessage(
        request("wallet_strk20PrepareInvoke", {
          actions: [{ amount: "0x0a", token, type: "deposit" }],
        }),
        origin,
      ),
    ).toEqual({
      actions: [{ amount: "0x0a", token, type: "deposit" }],
      origin,
      simulate: false,
      type: "wallet.strk20PrepareInvoke",
    });
    expect(
      toRuntimeMessage(request("wallet_strk20PrepareInvoke", { actions: [] }), origin),
    ).toBeNull();
  });

  test("maps prepare params carrying an explicit simulate flag", () => {
    expect(
      toRuntimeMessage(
        request("wallet_strk20PrepareInvoke", {
          actions: [{ amount: "OPEN", recipient, token, type: "transfer" }],
          simulate: true,
        }),
        origin,
      ),
    ).toEqual({
      actions: [{ amount: "OPEN", recipient, token, type: "transfer" }],
      origin,
      simulate: true,
      type: "wallet.strk20PrepareInvoke",
    });
  });

  test("maps invoke params with a flat, placeholder-bearing invoke action", () => {
    expect(
      toRuntimeMessage(
        request("wallet_strk20InvokeTransaction", {
          actions: [
            { amount: "0x1", recipient, token, type: "withdraw" },
            { calldata: ["0x1", poolAddressPlaceholder], contract: token, type: "invoke" },
          ],
        }),
        origin,
      ),
    ).toEqual({
      actions: [
        { amount: "0x1", recipient, token, type: "withdraw" },
        { calldata: ["0x1", poolAddressPlaceholder], contract: token, type: "invoke" },
      ],
      origin,
      type: "wallet.strk20InvokeTransaction",
    });
  });

  test("rejects an action using the old `action` discriminator", () => {
    expect(
      toRuntimeMessage(
        request("wallet_strk20InvokeTransaction", {
          actions: [{ action: "withdraw", amount: "1", token }],
        }),
        origin,
      ),
    ).toBeNull();
  });

  test("normalizes a schema-bounded proof larger than the generic request budget", () => {
    const proof = { ...callAndProof.proof, data: "p".repeat(200_000) };
    const params = readProviderParams("wallet_addInvokeTransaction", {
      invoke_transaction: [callAndProof.call],
      proof,
    });
    expect(params).not.toBeNull();
    expect(toRuntimeMessage(request("wallet_addInvokeTransaction", params), origin)).toEqual({
      calls: [
        {
          calldata: ["0x1"],
          contractAddress: token,
          entrypoint: "shielded_execute",
        },
      ],
      origin,
      proof,
      type: "wallet.addInvokeTransaction",
    });
  });
});

describe("strk20 bridge results", () => {
  test("shapes balances and call-and-proof results for the page", () => {
    expect(
      toProviderPayload(
        { balances: [{ balance: "0x64", token }], ok: true },
        "wallet_strk20Balances",
      ),
    ).toEqual({ result: [{ balance: "0x64", token }] });
    expect(toProviderPayload({ callAndProof, ok: true }, "wallet_strk20PrepareInvoke")).toEqual({
      result: callAndProof,
    });
  });

  test("carries a schema-bounded proof larger than the generic provider JSON budget", () => {
    const largeProof = {
      ...callAndProof,
      proof: { ...callAndProof.proof, data: "p".repeat(200_000) },
    };
    expect(
      toProviderPayload({ callAndProof: largeProof, ok: true }, "wallet_strk20PrepareInvoke"),
    ).toEqual({ result: largeProof });
  });

  test("pads the invoke transaction hash", () => {
    const payload = toProviderPayload(
      { ok: true, transactionHash: "0x123" },
      "wallet_strk20InvokeTransaction",
    );
    expect(payload.result).toEqual({ transaction_hash: `0x${"123".padStart(64, "0")}` });
  });

  test("pads the registration transaction hash", () => {
    const payload = toProviderPayload({ ok: true, transactionHash: "0x123" }, "mc_strk20Register");
    expect(payload.result).toEqual({ transaction_hash: `0x${"123".padStart(64, "0")}` });
  });

  test("maps each strk20 error string to its spec code", () => {
    expect(toProviderPayload({ error: "account not registered in strk20" }).error?.code).toBe(118);
    expect(toProviderPayload({ error: "insufficient private balance" }).error?.code).toBe(119);
    expect(toProviderPayload({ error: "strk20 privacy leak" }).error?.code).toBe(120);
    expect(toProviderPayload({ error: "invalid strk20 prepare request" }).error?.code).toBe(114);
    expect(toProviderPayload({ error: "request rejected" }).error?.code).toBe(113);
    expect(
      toProviderPayload({
        error: "strk20 services unavailable (proving/proof-rejected): proof rejected",
      }).error,
    ).toEqual({
      code: 163,
      data: "strk20 services unavailable (proving/proof-rejected): proof rejected",
      message: "The wallet request failed",
    });
  });

  test("round-trips balances and call-and-proof through the page response", () => {
    const balancesResponse = providerResponse(request("wallet_strk20Balances"), {
      result: [{ balance: "0x64", token }],
    });
    expect(readProviderResponse(balancesResponse)?.result).toEqual([{ balance: "0x64", token }]);

    const proofResponse = providerResponse(request("wallet_strk20PrepareInvoke"), {
      result: callAndProof,
    });
    expect(readProviderResponse(proofResponse)?.result).toEqual(callAndProof);
  });
});
