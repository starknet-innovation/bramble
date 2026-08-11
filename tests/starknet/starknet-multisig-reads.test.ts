/**
 * On-chain multisig reads: quorum + signer set, per-proposal lifecycle state,
 * and the contract-derived transaction id. Each read is driven through the real
 * withRpcFallback path with RpcProvider.callContract stubbed per entrypoint, so
 * both the happy decode and every malformed-response throw are exercised.
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { RpcProvider } from "starknet";
import {
  computeMultisigTransactionId,
  getMultisigConfig,
  getMultisigProposalStatus,
  multisigTransactionId,
} from "../../src/starknet/multisig";

const MULTISIG = "0x111111111111111111111111111111111111111111111111111111111111111";
const TARGET = "0x222222222222222222222222222222222222222222222222222222222222222";
const SIGNER_A = "0x333333333333333333333333333333333333333333333333333333333333333";
const SIGNER_B = "0x444444444444444444444444444444444444444444444444444444444444444";
const RPC = ["https://rpc.example"];
const call = { calldata: ["0x5", "0x0"], contractAddress: TARGET, entrypoint: "transfer" };

// Stubs RpcProvider.callContract, dispatching each on-chain view by entrypoint.
// A missing entrypoint throws so an unexpected call fails loudly.
const stubContract = (responses: Record<string, readonly string[]>) =>
  spyOn(RpcProvider.prototype, "callContract").mockImplementation(
    async (request: { entrypoint: string }) => {
      const response = responses[request.entrypoint];
      if (!response) {
        throw new Error(`unexpected entrypoint ${request.entrypoint}`);
      }
      return response as string[];
    },
  );

afterEach(() => {
  spyOn(RpcProvider.prototype, "callContract").mockRestore();
});

describe("getMultisigConfig", () => {
  test("reads quorum and canonical signer set from the component views", async () => {
    stubContract({ get_quorum: ["0x2"], get_signers: ["0x2", SIGNER_A, SIGNER_B] });

    const config = await getMultisigConfig({ address: MULTISIG, rpcUrls: RPC });

    expect(config.quorum).toBe(2);
    expect(config.signers).toEqual([
      `0x${BigInt(SIGNER_A).toString(16)}`,
      `0x${BigInt(SIGNER_B).toString(16)}`,
    ]);
  });

  test("throws when a view returns a non-felt where a number is expected", async () => {
    stubContract({ get_quorum: [], get_signers: ["0x2", SIGNER_A, SIGNER_B] });
    await expect(getMultisigConfig({ address: MULTISIG, rpcUrls: RPC })).rejects.toThrow(
      "Invalid multisig quorum response",
    );
  });

  test("throws when a count exceeds the 32-bit small-number bound", async () => {
    stubContract({ get_quorum: ["0x100000000"], get_signers: ["0x1", SIGNER_A] });
    await expect(getMultisigConfig({ address: MULTISIG, rpcUrls: RPC })).rejects.toThrow(
      "Invalid multisig quorum response",
    );
  });

  test("throws when the signer array length disagrees with its count prefix", async () => {
    stubContract({ get_quorum: ["0x2"], get_signers: ["0x3", SIGNER_A, SIGNER_B] });
    await expect(getMultisigConfig({ address: MULTISIG, rpcUrls: RPC })).rejects.toThrow(
      "Invalid multisig signers response",
    );
  });

  test("throws when quorum is zero", async () => {
    stubContract({ get_quorum: ["0x0"], get_signers: ["0x1", SIGNER_A] });
    await expect(getMultisigConfig({ address: MULTISIG, rpcUrls: RPC })).rejects.toThrow(
      "Invalid multisig signers response",
    );
  });

  test("turns an aborted RPC read into an actionable verification error", async () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    spyOn(RpcProvider.prototype, "callContract").mockRejectedValue(timeout);

    await expect(getMultisigConfig({ address: MULTISIG, rpcUrls: RPC })).rejects.toThrow(
      "Multisig verification took too long. Check the RPC endpoint and retry.",
    );
  });
});

describe("getMultisigProposalStatus", () => {
  const input = { address: MULTISIG, rpcUrls: RPC, signer: SIGNER_A, txId: "0xabc" };

  test("decodes state, confirmation count, and this signer's confirmation flag", async () => {
    stubContract({
      get_transaction_state: ["0x1"],
      get_transaction_confirmations: ["0x2"],
      is_confirmed_by: ["0x1"],
    });

    await expect(getMultisigProposalStatus(input)).resolves.toEqual({
      confirmations: 2,
      confirmedBySigner: true,
      state: "pending",
    });
  });

  test("reports a signer that has not confirmed as false", async () => {
    stubContract({
      get_transaction_state: ["0x2"],
      get_transaction_confirmations: ["0x3"],
      is_confirmed_by: ["0x0"],
    });

    await expect(getMultisigProposalStatus(input)).resolves.toMatchObject({
      confirmedBySigner: false,
      state: "confirmed",
    });
  });

  test("throws on an out-of-range TransactionState variant", async () => {
    stubContract({
      get_transaction_state: ["0x9"],
      get_transaction_confirmations: ["0x1"],
      is_confirmed_by: ["0x0"],
    });
    await expect(getMultisigProposalStatus(input)).rejects.toThrow(
      "Invalid multisig state response",
    );
  });

  test("throws when the confirmation count is not a felt", async () => {
    stubContract({
      get_transaction_state: ["0x1"],
      get_transaction_confirmations: ["not-a-felt"],
      is_confirmed_by: ["0x0"],
    });
    await expect(getMultisigProposalStatus(input)).rejects.toThrow(
      "Invalid multisig confirmations response",
    );
  });
});

describe("computeMultisigTransactionId", () => {
  test("returns the locally derived id when the contract view agrees", async () => {
    const derived = multisigTransactionId(call, "0x7");
    stubContract({ hash_transaction: [derived] });

    await expect(
      computeMultisigTransactionId({ address: MULTISIG, call, rpcUrls: RPC, salt: "0x7" }),
    ).resolves.toBe(derived);
  });

  test("throws when the hash view returns no felt", async () => {
    stubContract({ hash_transaction: [] });
    await expect(
      computeMultisigTransactionId({ address: MULTISIG, call, rpcUrls: RPC, salt: "0x7" }),
    ).rejects.toThrow("Invalid multisig transaction id response");
  });
});
