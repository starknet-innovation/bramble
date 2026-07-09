/**
 * Multisig call-builder and deploy invariants: exact component calldata
 * layouts, state decoding, deterministic address prediction, and rejection of
 * malformed inputs and artifacts.
 */
import { describe, expect, test } from "bun:test";
import { hash } from "starknet";
import {
  buildMultisigConfirmCall,
  buildMultisigExecuteCall,
  buildMultisigRevokeCall,
  buildMultisigSubmitCall,
  decodeMultisigState,
  isMultisigEntrypoint,
} from "../src/starknet/multisig";
import {
  buildMultisigDeployCall,
  MULTISIG_CLASS_HASH,
  predictMultisigAddress,
  requireMultisigContractClass,
} from "../src/starknet/multisig-deploy";

const MULTISIG = "0x111111111111111111111111111111111111111111111111111111111111111";
const TARGET = "0x222222222222222222222222222222222222222222222222222222222222222";
const SIGNER_A = "0x333333333333333333333333333333333333333333333333333333333333333";
const SIGNER_B = "0x444444444444444444444444444444444444444444444444444444444444444";

const call = { calldata: ["0x5", "0x0"], contractAddress: TARGET, entrypoint: "transfer" };

describe("multisig call builders", () => {
  test("submit_transaction flattens the inner call with the component layout", () => {
    const built = buildMultisigSubmitCall(MULTISIG, call, "0x7");
    expect(built.contractAddress).toBe(MULTISIG);
    expect(built.entrypoint).toBe("submit_transaction");
    expect(built.calldata).toEqual([
      TARGET,
      hash.getSelectorFromName("transfer"),
      "0x2",
      "0x5",
      "0x0",
      "0x7",
    ]);
  });

  test("execute_transaction reuses the exact proposed call and salt", () => {
    const built = buildMultisigExecuteCall(MULTISIG, call, "0x7");
    expect(built.entrypoint).toBe("execute_transaction");
    expect(built.calldata).toEqual(buildMultisigSubmitCall(MULTISIG, call, "0x7").calldata);
  });

  test("confirm and revoke carry only the transaction id", () => {
    expect(buildMultisigConfirmCall(MULTISIG, "0xabc")).toEqual({
      calldata: ["0xabc"],
      contractAddress: MULTISIG,
      entrypoint: "confirm_transaction",
    });
    expect(buildMultisigRevokeCall(MULTISIG, "0xabc").entrypoint).toBe("revoke_confirmation");
  });

  test("rejects invalid entrypoints, felts, and oversized calldata", () => {
    expect(isMultisigEntrypoint("transfer_from")).toBe(true);
    expect(isMultisigEntrypoint("Transfer")).toBe(false);
    expect(isMultisigEntrypoint("1bad")).toBe(false);
    expect(() => buildMultisigSubmitCall(MULTISIG, { ...call, entrypoint: "Bad!" }, "0x0")).toThrow(
      "Invalid multisig call",
    );
    expect(() => buildMultisigSubmitCall(MULTISIG, call, "not-a-felt")).toThrow(
      "Invalid multisig salt",
    );
    expect(() => buildMultisigSubmitCall("0x0", call, "0x0")).toThrow("Invalid multisig address");
    expect(() =>
      buildMultisigSubmitCall(MULTISIG, { ...call, calldata: Array(65).fill("0x1") }, "0x0"),
    ).toThrow("Invalid multisig call");
  });

  test("decodes the TransactionState variants in component order", () => {
    expect(decodeMultisigState(0)).toBe("not-found");
    expect(decodeMultisigState(1)).toBe("pending");
    expect(decodeMultisigState(2)).toBe("confirmed");
    expect(decodeMultisigState(3)).toBe("executed");
    expect(() => decodeMultisigState(4)).toThrow("Invalid multisig state response");
  });
});

describe("multisig deployment", () => {
  const config = { quorum: 2, salt: "0x0", signers: [SIGNER_A, SIGNER_B] };

  test("predicts a deployer-independent address from the pinned class", () => {
    const predicted = predictMultisigAddress(config);
    expect(predicted).toBe(
      hash.calculateContractAddressFromHash(
        "0x0",
        MULTISIG_CLASS_HASH,
        ["0x2", "0x2", SIGNER_A, SIGNER_B],
        0,
      ),
    );
    expect(predictMultisigAddress({ ...config, salt: "0x1" })).not.toBe(predicted);
  });

  test("builds the UDC deploy_contract call with not_from_zero disabled", () => {
    const built = buildMultisigDeployCall(config);
    expect(built.entrypoint).toBe("deploy_contract");
    expect((built.calldata as readonly string[]).map(BigInt)).toEqual(
      [MULTISIG_CLASS_HASH, "0x0", "0x0", "0x4", "0x2", "0x2", SIGNER_A, SIGNER_B].map(BigInt),
    );
  });

  test("rejects bad quorums, duplicate signers, and zero signers", () => {
    expect(() => buildMultisigDeployCall({ ...config, quorum: 3 })).toThrow("Quorum");
    expect(() => buildMultisigDeployCall({ ...config, quorum: 0 })).toThrow("Quorum");
    expect(() => buildMultisigDeployCall({ ...config, signers: [SIGNER_A, SIGNER_A] })).toThrow(
      "Invalid multisig signer list",
    );
    expect(() => buildMultisigDeployCall({ ...config, signers: [] })).toThrow(
      "Invalid multisig signer list",
    );
    expect(() => buildMultisigDeployCall({ ...config, signers: [SIGNER_A, "0x0"] })).toThrow(
      "Invalid multisig signer list",
    );
  });

  test("rejects artifacts that do not match the pinned class hash", () => {
    expect(() => requireMultisigContractClass(null)).toThrow("malformed");
    expect(() => requireMultisigContractClass({ sierra_program: "nope" })).toThrow("malformed");
    expect(() =>
      requireMultisigContractClass({
        abi: [],
        contract_class_version: "0.1.0",
        entry_points_by_type: { CONSTRUCTOR: [], EXTERNAL: [], L1_HANDLER: [] },
        sierra_program: ["0x1", "0x2", "0x3"],
      }),
    ).toThrow("does not match the pinned class hash");
  });
});
