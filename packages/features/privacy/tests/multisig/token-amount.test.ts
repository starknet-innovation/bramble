/**
 * Multisig STRK20 amounts use the tracked token's own decimals, and a stored
 * request displays that token, the amount, and the recipient.
 */
import { describe, expect, test } from "bun:test";
import {
  describeMultisigStrk20Request,
  resolveMultisigStrk20Amount,
} from "@bramble/privacy/multisig-strk20-token";

const STRK = {
  address: "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  decimals: 18,
  id: "SN_MAIN:STRK:0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  networkId: "SN_MAIN",
  symbol: "STRK",
};
const USDC = {
  address: "0x53c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
  decimals: 6,
  id: "SN_MAIN:USDC:0x53c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
  networkId: "SN_MAIN",
  symbol: "USDC",
};

describe("multisig STRK20 token amounts", () => {
  test("scales a tracked token by its own decimals", () => {
    expect(resolveMultisigStrk20Amount([STRK, USDC], "SN_MAIN", USDC.id, "1.5")).toEqual({
      raw: "0x16e360",
      symbol: "USDC",
      token: USDC.address,
    });
    const strk = resolveMultisigStrk20Amount([STRK, USDC], "SN_MAIN", STRK.id, "1");
    if ("error" in strk) throw new Error(strk.error);
    expect(strk.raw).toBe(`0x${(10n ** 18n).toString(16)}`);
  });

  test("refuses a token this wallet does not track", () => {
    expect(resolveMultisigStrk20Amount([STRK], "SN_MAIN", USDC.id, "1")).toEqual({
      error: "That token isn't tracked on this network.",
    });
  });

  test("describes a stored request with the token, amount, and recipient", () => {
    const described = describeMultisigStrk20Request(
      {
        amount: "0x16e360",
        kind: "transfer",
        recipient: "0x123",
        token: USDC.address,
      },
      [USDC],
    );
    expect(described.symbol).toBe("USDC");
    expect(described.amount).toBe("1.5");
    expect(described.recipient).toBe("0x123");
    expect(describeMultisigStrk20Request({ kind: "register" }, [USDC])).toEqual({
      amount: "",
      symbol: "",
    });
  });
});
