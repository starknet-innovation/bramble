/**
 * MCW-V09-108, the review side: no selector that hands out spending or transfer
 * authority may reach the approval card as an opaque "Call <selector> on 0x…".
 *
 * `set_approval_for_all` grants strictly MORE than any ERC20 allowance — every
 * item the account owns in a collection, including ones acquired later, until it
 * is revoked — and is the most-used NFT drainer selector, so it must decode with
 * the operator named and carry a risk flag at least as loud as an unlimited
 * approval. An ERC721 `approve(to, token_id)` shares the ERC20 calldata shape
 * exactly, so on a collection the wallet watches it must read as a token id, not
 * as fungible units, and must never trip the unlimited-amount threshold.
 */
import { describe, expect, test } from "bun:test";
import type { WatchedNft } from "@mc-wallet/portfolio/watched-nft";
import type { TokenConfig } from "@mc-wallet/settings/preferences";
import { verificationContext, verifyCalls } from "@mc-wallet/transactions/verify";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";

const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const COLLECTION = "0x03ba1f0dd8b9b6f7c8d1d1d7f0a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4";
const OPERATOR = "0x0111111111111111111111111111111111111111111111111111111111111111";

const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

const tokens: readonly TokenConfig[] = [
  {
    address: ETH,
    decimals: 18,
    id: `SN_MAIN:ETH:${ETH}`,
    name: "Ether",
    networkId: "SN_MAIN",
    symbol: "ETH",
  },
];

const watched: WatchedNft = {
  contract: COLLECTION,
  id: `SN_MAIN:${COLLECTION}:1`,
  networkId: "SN_MAIN",
  tokenId: "1",
};

const context = verificationContext(account, { addressBook: [], nfts: [watched], tokens });

const operatorCall = (entrypoint: string, approved: string, contract = COLLECTION) => ({
  calldata: [OPERATOR, approved],
  contractAddress: contract,
  entrypoint,
});

describe("operator approvals reach the review card as grants", () => {
  test("both spellings decode as an operator grant naming the operator", () => {
    for (const entrypoint of ["set_approval_for_all", "setApprovalForAll"]) {
      const report = verifyCalls([operatorCall(entrypoint, "0x1")], context);

      expect(report.calls[0]?.kind).toBe("operator-approval");
      expect(report.calls[0]?.summary).toContain("EVERY item");
      expect(report.calls[0]?.summary).toContain("0x1111…1111");
      expect(report.flags.map((flag) => flag.code)).toContain("operator-approval");
    }
  });

  test("the grant is flagged even on a collection the wallet does not watch", () => {
    // The drainer's own contract will not be in the user's gallery. The
    // operator flag must not depend on recognizing the collection.
    const unwatched = verifyCalls(
      [operatorCall("set_approval_for_all", "0x1", `0x0499${"8".repeat(59)}4`)],
      context,
    );

    expect(unwatched.calls[0]?.kind).toBe("operator-approval");
    expect(unwatched.flags.map((flag) => flag.code)).toEqual([
      "unknown-contract",
      "operator-approval",
    ]);
  });

  test("revoking an operator says so and raises no grant flag", () => {
    const report = verifyCalls([operatorCall("set_approval_for_all", "0x0")], context);

    expect(report.calls[0]?.summary).toContain("Revoke");
    expect(report.flags.map((flag) => flag.code)).not.toContain("operator-approval");
  });

  test("malformed operator calldata stays opaque rather than claiming a decode", () => {
    const report = verifyCalls(
      [{ calldata: [OPERATOR], contractAddress: COLLECTION, entrypoint: "set_approval_for_all" }],
      context,
    );

    expect(report.calls[0]?.kind).toBe("unknown");
  });

  test("case variants are not folded into the operator grant", () => {
    const report = verifyCalls([operatorCall("Set_Approval_For_All", "0x1")], context);

    expect(report.calls[0]?.kind).toBe("unknown");
  });
});

describe("an ERC721 approve is not an ERC20 allowance", () => {
  test("a watched collection's approve names the token id, not fungible units", () => {
    const report = verifyCalls(
      [{ calldata: [OPERATOR, "0x5", "0x0"], contractAddress: COLLECTION, entrypoint: "approve" }],
      context,
    );

    expect(report.calls[0]?.kind).toBe("nft-approval");
    expect(report.calls[0]?.summary).toContain("transfer NFT #5");
    expect(report.calls[0]?.summary).not.toContain("units");
  });

  test("a large token id raises no unlimited-approval flag", () => {
    // `approve(attacker, 2^129)` on a collection is item #2^129, not an
    // unlimited spend cap; thresholding an id invents a risk that is not there
    // and teaches the user to ignore the flag.
    const report = verifyCalls(
      [
        {
          calldata: [OPERATOR, "0x0", "0x2"],
          contractAddress: COLLECTION,
          entrypoint: "approve",
        },
      ],
      context,
    );

    expect(report.flags.map((flag) => flag.code)).not.toContain("unlimited-approval");
    // A watched collection is a contract this wallet knows, so it is not
    // reported as unknown either — the NFT summary already states the risk.
    expect(report.flags).toEqual([]);
  });

  test("an ERC20 approve on a tracked token is unaffected", () => {
    const report = verifyCalls(
      [
        {
          calldata: [OPERATOR, "0x0", "0x2"],
          contractAddress: ETH,
          entrypoint: "approve",
        },
      ],
      context,
    );

    expect(report.calls[0]?.kind).toBe("approve");
    expect(report.flags.map((flag) => flag.code)).toContain("unlimited-approval");
  });
});
