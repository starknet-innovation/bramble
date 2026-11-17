import { CallData, hash } from "starknet";
import { describe, expect, test } from "vitest";
import {
  buildOwnershipCall,
  type ContractOwnership,
  expectedOwnerAfter,
  isRenounced,
  readContractAddress,
  readNewOwner,
  standardForClass,
} from "./token-ownership";
import { TOKEN_PRESETS } from "./token-presets";

const CONTRACT = "0x5ac53c4a815b3e2d614b1ad31bf8c80ea841cdcc4499976cfc5e95534612027";
const OWNER = "0x77dfdc45ba4695eac4c961f3d9bf820ed7e925a44d9963de7b7a0daf8768af0";
const NEW_OWNER = "0x57c50f71ba754809e76b2024ac6983130c50e08d237a3d0f1af5d227f11a767";
const ownership: ContractOwnership = { contract: CONTRACT, owner: OWNER, standard: "erc721" };

describe("ownership calls", () => {
  // The selectors are the ones the Sepolia simulation hit on the pinned
  // classes (transfer_ownership 0x2a3bb1…, renounce_ownership 0x52580a…).
  test("transfer is exactly transfer_ownership(new_owner) on the contract", () => {
    const call = buildOwnershipCall(CONTRACT, { kind: "transfer", newOwner: NEW_OWNER });
    expect(call).toEqual({ calldata: [NEW_OWNER], contractAddress: CONTRACT, entrypoint: "transfer_ownership" });
    expect(hash.getSelectorFromName(call.entrypoint)).toBe(
      "0x2a3bb1eaa05b77c4b0eeee0116a3177c6d62319dd7149ae148185d9e09de74a",
    );
    expect(CallData.toCalldata(call.calldata)).toEqual([BigInt(NEW_OWNER).toString()]);
    expect(expectedOwnerAfter({ kind: "transfer", newOwner: NEW_OWNER })).toBe(NEW_OWNER);
  });

  test("renounce is exactly renounce_ownership() with no arguments", () => {
    const call = buildOwnershipCall(CONTRACT, { kind: "renounce" });
    expect(call).toEqual({ calldata: [], contractAddress: CONTRACT, entrypoint: "renounce_ownership" });
    expect(hash.getSelectorFromName(call.entrypoint)).toBe(
      "0x52580a92c73f4428f1a260c5d768ef462b25955307de00f99957df119865d",
    );
    expect(expectedOwnerAfter({ kind: "renounce" })).toBe("0x0");
  });
});

describe("readNewOwner", () => {
  test("canonicalizes a valid new owner", () => {
    expect(readNewOwner(` ${NEW_OWNER.replace("0x", "0x0").toUpperCase().replace("0X", "0x")} `, ownership)).toBe(
      NEW_OWNER,
    );
  });

  test("refuses zero, junk, the current owner and the contract itself", () => {
    expect(() => readNewOwner("0x0", ownership)).toThrow("Enter a valid Starknet address for the new owner.");
    expect(() => readNewOwner("garden", ownership)).toThrow("Enter a valid Starknet address for the new owner.");
    expect(() => readNewOwner(OWNER.replace("0x", "0x0"), ownership)).toThrow(
      "That account already owns this contract.",
    );
    expect(() => readNewOwner(CONTRACT, ownership)).toThrow("The contract can't own itself.");
  });
});

describe("contract checks", () => {
  test("only the pinned preset classes are recognized", () => {
    expect(standardForClass(TOKEN_PRESETS.erc20.classHash)).toBe("erc20");
    expect(standardForClass("0x356fbb89f6a6574ff97c4ecc5fe97808785ce0b093c8e864b87a184f48dbd9e")).toBe("erc721");
    expect(standardForClass(TOKEN_PRESETS.erc1155.classHash)).toBe("erc1155");
    expect(standardForClass("0x1234")).toBeNull();
  });

  test("reads a contract address and spots a renounced owner", () => {
    expect(readContractAddress(` ${CONTRACT.toUpperCase().replace("0X", "0x")} `)).toBe(CONTRACT);
    expect(() => readContractAddress("0x")).toThrow("Enter a valid Starknet contract address.");
    expect(isRenounced(ownership)).toBe(false);
    expect(isRenounced({ ...ownership, owner: "0x0" })).toBe(true);
  });
});
