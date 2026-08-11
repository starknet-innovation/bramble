/**
 * MCW-V09-102: a multisig proposal id is the whole binding between the call a
 * user reviewed and the transaction they confirm, so it must be derived by the
 * wallet rather than taken from whichever RPC node answered first.
 *
 * These tests pin the derivation against a vector produced by OpenZeppelin
 * MultisigComponent v3.0.0's own `hash_transaction_batch` (Cairo, scarb
 * 2.18.0), then prove that a node reporting any other id fails the whole read
 * closed instead of yielding an id the wallet never computed.
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { RpcProvider } from "starknet";
import {
  computeMultisigTransactionId,
  multisigCallMatchesId,
  multisigTransactionId,
} from "../../src/starknet/multisig";

const MULTISIG = "0x111111111111111111111111111111111111111111111111111111111111111";
const TARGET = "0x222222222222222222222222222222222222222222222222222222222222222";
const RPC = ["https://rpc.example"];

const CALL = { calldata: ["0x5", "0x0"], contractAddress: TARGET, entrypoint: "transfer" } as const;
const SALT = "0x7";

// Ground truth, not a self-derived expectation: the value
// `PedersenTrait::new(0).update_with(array![Call { to, selector, calldata }].span())
//  .update_with(salt).finalize()` returns for the (CALL, SALT) pair above,
// evaluated by the pinned openzeppelin_governance 3.0.0 sources themselves.
const OZ_COMPONENT_ID = "0x4a00ee185a91be1f72779815877fb748f3a4290c2d1e6cea1ac3a6b11fd9e7c";

const stubHashTransaction = (response: readonly string[]) =>
  spyOn(RpcProvider.prototype, "callContract").mockImplementation(async () => response as string[]);

afterEach(() => {
  spyOn(RpcProvider.prototype, "callContract").mockRestore();
});

describe("multisigTransactionId", () => {
  test("reproduces the OpenZeppelin MultisigComponent hash exactly", () => {
    expect(multisigTransactionId(CALL, SALT)).toBe(OZ_COMPONENT_ID);
  });

  test("separates proposals that differ only in salt, calldata, or entrypoint", () => {
    const ids = new Set([
      multisigTransactionId(CALL, SALT),
      multisigTransactionId(CALL, "0x8"),
      multisigTransactionId({ ...CALL, calldata: ["0x5", "0x1"] }, SALT),
      multisigTransactionId({ ...CALL, calldata: ["0x5"] }, SALT),
      multisigTransactionId({ ...CALL, entrypoint: "transfer_from" }, SALT),
      multisigTransactionId({ ...CALL, contractAddress: MULTISIG }, SALT),
    ]);
    expect(ids.size).toBe(6);
  });

  test("refuses to hash a call the component could never accept", () => {
    expect(() => multisigTransactionId({ ...CALL, entrypoint: "Transfer" }, SALT)).toThrow(
      "Invalid multisig call",
    );
    expect(() => multisigTransactionId(CALL, "nope")).toThrow("Invalid multisig salt");
  });
});

describe("multisigCallMatchesId", () => {
  test("binds a stored call to the id it was filed under", () => {
    expect(multisigCallMatchesId(CALL, SALT, OZ_COMPONENT_ID)).toBe(true);
    // Same numeric felt, zero-padded the way a stored record may spell it.
    expect(multisigCallMatchesId(CALL, SALT, `0x0${OZ_COMPONENT_ID.slice(2)}`)).toBe(true);
  });

  test("rejects a call swapped underneath an unchanged id", () => {
    expect(
      multisigCallMatchesId({ ...CALL, calldata: ["0x5", "0x99"] }, SALT, OZ_COMPONENT_ID),
    ).toBe(false);
    expect(multisigCallMatchesId(CALL, "0x8", OZ_COMPONENT_ID)).toBe(false);
  });

  test("is total: malformed calls, salts, and ids are refusals, not throws", () => {
    expect(multisigCallMatchesId({ ...CALL, contractAddress: "0x0" }, SALT, OZ_COMPONENT_ID)).toBe(
      false,
    );
    expect(multisigCallMatchesId(CALL, "not-a-felt", OZ_COMPONENT_ID)).toBe(false);
    expect(multisigCallMatchesId(CALL, SALT, "not-a-felt")).toBe(false);
  });
});

describe("computeMultisigTransactionId cross-check", () => {
  test("returns the derived id when the node agrees, whatever spelling it uses", async () => {
    stubHashTransaction([`0x0${OZ_COMPONENT_ID.slice(2)}`]);

    await expect(
      computeMultisigTransactionId({ address: MULTISIG, call: CALL, rpcUrls: RPC, salt: SALT }),
    ).resolves.toBe(OZ_COMPONENT_ID);
  });

  test("fails closed when a node substitutes an id of its own choosing", async () => {
    // Before the fix this resolved to the attacker's felt, and every later
    // confirm/execute was aimed at whatever proposal that id names on chain.
    stubHashTransaction(["0xdead"]);

    await expect(
      computeMultisigTransactionId({ address: MULTISIG, call: CALL, rpcUrls: RPC, salt: SALT }),
    ).rejects.toThrow("Multisig transaction id mismatch");
  });

  test("fails closed on an off-by-one-bit answer, not just an obvious one", async () => {
    stubHashTransaction([`0x${(BigInt(OZ_COMPONENT_ID) ^ 1n).toString(16)}`]);

    await expect(
      computeMultisigTransactionId({ address: MULTISIG, call: CALL, rpcUrls: RPC, salt: SALT }),
    ).rejects.toThrow("Multisig transaction id mismatch");
  });
});
