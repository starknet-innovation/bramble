/**
 * A payment whose recipient is a known token contract raises a warning before
 * review (QA I10): STRK, a curated token on the network, or a tracked token.
 * Tokens sent there are usually lost. It warns; only address poisoning refuses.
 */
import { describe, expect, test } from "bun:test";
import { refuseOnPoisonedRecipient, verifyCalls } from "@bramble/transactions/verify";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import type { TokenConfig } from "@bramble/wallet-model/preferences";

const USDC_MAINNET = "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb";
const TRACKED = "0x0555aa7890abcdef1234567890abcdef1234567890abcdef1234567890abcd1";
const WALLET = "0x0666bb7890abcdef1234567890abcdef1234567890abcdef1234567890abcd2";

const account: AccountRef = {
  accountContractType: "openzeppelin",
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

const tracked: TokenConfig = {
  address: TRACKED,
  decimals: 18,
  id: `SN_MAIN:TRK:${TRACKED}`,
  name: "Tracked",
  networkId: "SN_MAIN",
  symbol: "TRK",
};

const context = { account, addressBook: [], tokens: [tracked] };

const sendTo = (recipient: string, entrypoint = "transfer") =>
  verifyCalls(
    [
      {
        calldata:
          entrypoint === "transfer"
            ? [recipient, "0x1", "0x0"]
            : [account.address, recipient, "0x1", "0x0"],
        contractAddress: STRK_TOKEN_ADDRESS,
        entrypoint,
      },
    ],
    context,
  );

const codes = (recipient: string, entrypoint?: string): readonly string[] =>
  sendTo(recipient, entrypoint).flags.map((flag) => flag.code);

describe("token-contract recipient", () => {
  test("flags STRK sent to the STRK token contract", () => {
    const report = sendTo(STRK_TOKEN_ADDRESS);
    expect(report.flags).toContainEqual({
      code: "token-contract-recipient",
      message: "This is a token contract, not a wallet. Tokens sent here are usually lost.",
    });
  });

  test("catches the address in any felt spelling", () => {
    const bare = BigInt(STRK_TOKEN_ADDRESS).toString(16);
    for (const spelling of [
      STRK_TOKEN_ADDRESS.toUpperCase().replace("0X", "0x"),
      `0x${bare}`,
      `0x${bare.padStart(64, "0")}`,
    ]) {
      expect(codes(spelling), spelling).toContain("token-contract-recipient");
    }
  });

  test("flags a curated token and a tracked token as recipients", () => {
    expect(codes(USDC_MAINNET)).toContain("token-contract-recipient");
    expect(codes(TRACKED)).toContain("token-contract-recipient");
  });

  test("flags a transfer_from whose recipient is a token contract", () => {
    expect(codes(STRK_TOKEN_ADDRESS, "transfer_from")).toContain("token-contract-recipient");
  });

  test("does not flag an ordinary wallet recipient", () => {
    expect(codes(WALLET)).not.toContain("token-contract-recipient");
  });

  test("warns but never refuses", () => {
    expect(refuseOnPoisonedRecipient(sendTo(STRK_TOKEN_ADDRESS))).toBeNull();
  });
});
