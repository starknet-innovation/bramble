import { describe, expect, it, vi } from "vitest";
import { PRIVACY_POOL_ADDRESS } from "../../shared/privacy";
import {
  isPrivateRegistrationRequired,
  requestPrivateBalances,
  requestPrivateInvoke,
  requestPrivateProof,
  requestPrivateRegistration,
  validatedPrivateActions,
} from "./privacy-wallet";

const token = "0x123";
const actions = [{ amount: "0x2", token, type: "deposit" }] as const;
const transactionHash = `0x01${"0".repeat(62)}`;

describe("Terminal STRK20 wallet boundary", () => {
  it("requests only aggregate balances and rejects duplicate/malformed output", async () => {
    const request = vi.fn(async () => [{ balance: "0x2", token }]);
    await expect(requestPrivateBalances({ request }, [token])).resolves.toEqual([
      { balance: "0x2", token },
    ]);
    expect(request).toHaveBeenCalledWith({
      params: { tokens: [token] },
      type: "wallet_strk20Balances",
    });

    request.mockResolvedValueOnce([
      { balance: "0x2", token },
      { balance: "0x3", token },
    ]);
    await expect(requestPrivateBalances({ request }, [token])).rejects.toThrow(
      "invalid private balances",
    );
    await expect(requestPrivateBalances({ request }, [token, token])).rejects.toThrow(
      "token list is invalid",
    );
  });

  it("validates actions and the complete proof before accepting wallet output", async () => {
    const request = vi.fn(async () => ({
      call: {
        calldata: ["0x1"],
        contract_address: PRIVACY_POOL_ADDRESS,
        entry_point: "apply_actions",
      },
      proof: {
        data: "proof",
        output: ["0x1"],
        proof_facts: ["0x2"],
      },
    }));
    await expect(requestPrivateProof({ request }, actions)).resolves.toMatchObject({
      call: { contract_address: PRIVACY_POOL_ADDRESS, entry_point: "apply_actions" },
      proof: { data: "proof" },
    });
    expect(request).toHaveBeenCalledWith({
      params: { actions, simulate: false },
      type: "wallet_strk20PrepareInvoke",
    });
    expect(() => validatedPrivateActions([{ ...actions[0], hidden: true }])).toThrow(
      "action batch is invalid",
    );
    request.mockResolvedValueOnce({
      call: {
        calldata: ["0x1"],
        contract_address: "0x456",
        entry_point: "apply_actions",
      },
      proof: { data: "proof", output: ["0x1"], proof_facts: ["0x2"] },
    });
    await expect(requestPrivateProof({ request }, actions)).rejects.toThrow(
      "invalid private proof",
    );
  });

  it("accepts only a canonical transaction result", async () => {
    const request = vi.fn(async () => ({ transaction_hash: transactionHash }));
    await expect(requestPrivateInvoke({ request }, actions)).resolves.toBe(transactionHash);
    request.mockResolvedValueOnce({ transaction_hash: "0x123" });
    await expect(requestPrivateInvoke({ request }, actions)).rejects.toThrow(
      "invalid private transaction hash",
    );
  });

  it("uses the MC registration capability and validates its transaction hash", async () => {
    const request = vi.fn(async () => ({ transaction_hash: transactionHash }));
    await expect(requestPrivateRegistration({ request })).resolves.toBe(transactionHash);
    expect(request).toHaveBeenCalledWith({ type: "mc_strk20Register" });
    request.mockResolvedValueOnce({ transaction_hash: "0x123" });
    await expect(requestPrivateRegistration({ request })).rejects.toThrow(
      "invalid registration transaction hash",
    );
  });

  it("recognizes only the Wallet-API registration-required code", () => {
    expect(isPrivateRegistrationRequired({ code: 118 })).toBe(true);
    expect(isPrivateRegistrationRequired(new Error("not registered"))).toBe(false);
    expect(isPrivateRegistrationRequired({ code: 113 })).toBe(false);
  });
});
