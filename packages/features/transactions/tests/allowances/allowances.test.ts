/**
 * Allowance-call decoding checks: uint256 amounts, which selectors change an
 * allowance and how (set vs increase vs decrease), non-allowance calls, and the
 * mapping from submitted calls to allowance-log inputs.
 */

import { describe, expect, test } from "bun:test";
import type { TokenConfig } from "@mc-wallet/wallet-model/preferences";
import type { AllowanceOwner } from "../../src/allowances/allowance-store";
import {
  type ApprovedAssets,
  allowanceChangesFromCalls,
  approvedAssetKind,
  decodeAllowanceCall,
} from "../../src/allowances/allowances";

const owner: AllowanceOwner = {
  accountId: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
};
const TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
// Same address, non-canonical spelling: classification must not turn on how a
// dapp happened to pad the felt.
const PADDED_TOKEN = `0x${BigInt(TOKEN).toString(16).padStart(64, "0")}`;
const COLLECTION = `0x0299${"8".repeat(59)}4`;
const erc20: TokenConfig = {
  address: TOKEN,
  decimals: 18,
  id: "SN_MAIN:ETH",
  name: "Ether",
  networkId: "SN_MAIN",
  symbol: "ETH",
};
const assets: ApprovedAssets = { nftContracts: [COLLECTION], tokens: [erc20] };

describe("allowance call decoding", () => {
  test("decodes an approve into spender, uint256 amount, and an absolute kind", () => {
    expect(
      decodeAllowanceCall({
        calldata: ["0x5", "1000", "0"],
        contractAddress: TOKEN,
        entrypoint: "approve",
      }),
    ).toEqual({ amount: 1000n, kind: "set", spender: "0x5" });
  });

  test("combines uint256 high and low limbs", () => {
    const decoded = decodeAllowanceCall({
      calldata: ["0x5", "0", "1"],
      contractAddress: TOKEN,
      entrypoint: "approve",
    });
    expect(decoded?.amount).toBe(1n << 128n);
  });

  // The shared decoder — not just the allowance bookkeeping that used to
  // relabel these calls onto the `approve` selector before decoding them — has
  // to read both spellings of each dual, or a caller that decodes a call
  // directly sees an increase as "not an allowance call at all".
  test("decodes both spellings of increase and decrease with their own kind", () => {
    for (const entrypoint of ["increase_allowance", "increaseAllowance"]) {
      expect(
        decodeAllowanceCall({ calldata: ["0x5", "7", "0"], contractAddress: TOKEN, entrypoint }),
      ).toEqual({ amount: 7n, kind: "increase", spender: "0x5" });
    }
    for (const entrypoint of ["decrease_allowance", "decreaseAllowance"]) {
      expect(
        decodeAllowanceCall({ calldata: ["0x5", "7", "0"], contractAddress: TOKEN, entrypoint }),
      ).toEqual({ amount: 7n, kind: "decrease", spender: "0x5" });
    }
  });

  test("ignores non-allowance, case-variant, and malformed calls", () => {
    for (const entrypoint of ["transfer", "Approve", "INCREASE_ALLOWANCE", "increase_Allowance"]) {
      expect(
        decodeAllowanceCall({ calldata: ["0x5", "1", "0"], contractAddress: TOKEN, entrypoint }),
      ).toBeNull();
    }
    expect(
      decodeAllowanceCall({ calldata: ["0x5"], contractAddress: TOKEN, entrypoint: "approve" }),
    ).toBeNull();
  });

  test("maps allowance calls to inputs scoped to the granting owner", () => {
    expect(
      allowanceChangesFromCalls(
        [
          { calldata: ["0x5", "1000", "0"], contractAddress: TOKEN, entrypoint: "approve" },
          { calldata: ["0x9", "1", "0"], contractAddress: TOKEN, entrypoint: "transfer" },
          { calldata: ["0x9", "4", "0"], contractAddress: TOKEN, entrypoint: "increase_allowance" },
        ],
        owner,
        assets,
      ),
    ).toEqual([
      {
        input: {
          accountId: owner.accountId,
          amount: "1000",
          networkId: "SN_MAIN",
          spender: "0x5",
          token: TOKEN,
        },
        kind: "set",
      },
      {
        input: {
          accountId: owner.accountId,
          amount: "4",
          networkId: "SN_MAIN",
          spender: "0x9",
          token: TOKEN,
        },
        kind: "increase",
      },
    ]);
  });

  test("drops a zero delta but keeps a zero approve, which clears the entry", () => {
    const zeroDeltas = allowanceChangesFromCalls(
      [
        { calldata: ["0x5", "0", "0"], contractAddress: TOKEN, entrypoint: "increase_allowance" },
        { calldata: ["0x5", "0", "0"], contractAddress: TOKEN, entrypoint: "decrease_allowance" },
      ],
      owner,
      assets,
    );
    expect(zeroDeltas).toEqual([]);
    expect(
      allowanceChangesFromCalls(
        [{ calldata: ["0x5", "0", "0"], contractAddress: TOKEN, entrypoint: "approve" }],
        owner,
        assets,
      ).map((change) => change.kind),
    ).toEqual(["set"]);
  });

  // MCW-V09-108(c): an ERC721 `approve(to, item_id)` and an ERC20
  // `approve(spender, amount)` are the same three felts, so the contract — not
  // the call — has to answer "is this a spending allowance at all?".
  test("classifies the approved contract from the account's own registries", () => {
    expect(approvedAssetKind(assets, TOKEN)).toBe("fungible");
    expect(approvedAssetKind(assets, PADDED_TOKEN)).toBe("fungible");
    expect(approvedAssetKind(assets, COLLECTION)).toBe("collection");
    expect(approvedAssetKind(assets, `0x0777${"7".repeat(59)}1`)).toBe("unknown");
    // No registries at all is "unknown", never "fungible": an empty wallet must
    // not read every contract as a token.
    expect(approvedAssetKind({ tokens: [] }, TOKEN)).toBe("unknown");
  });

  test("files no allowance change for a collection this account watches", () => {
    const calls = [
      { calldata: ["0x5", "0x7", "0x0"], contractAddress: COLLECTION, entrypoint: "approve" },
      { calldata: ["0x5", "0x7", "0x0"], contractAddress: TOKEN, entrypoint: "approve" },
    ];
    expect(
      allowanceChangesFromCalls(calls, owner, assets).map((change) => change.input.token),
    ).toEqual([TOKEN]);
    // Without the watch entry the wallet cannot tell the two apart, so the row
    // is still filed — and the manager, not the decoder, is what refuses to
    // call it an amount (see background/allowance-ops).
    expect(
      allowanceChangesFromCalls(calls, owner, { nftContracts: [], tokens: [erc20] }),
    ).toHaveLength(2);
  });
});
