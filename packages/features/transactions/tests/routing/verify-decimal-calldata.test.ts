/**
 * Calldata felts arrive in any spelling the builder emitted: starknet.js
 * `CallData.compile` writes decimal. The review must name every address read
 * from calldata as `0x…`, and every risk rule must read a decimal felt exactly
 * as it reads the same felt in hex — the send review once showed the recipient
 * as a 76-digit decimal.
 */
import { describe, expect, test } from "bun:test";
import { buildErc20TransferCall } from "@bramble/starknet/rpc";
import {
  refuseOnPoisonedRecipient,
  verificationContext,
  verifyCalls,
} from "@bramble/transactions/verify";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { addressLabel } from "@bramble/wallet-model/networks";
import type { Call } from "starknet";

const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const RECIPIENT = "0x03fa1111111111111111111111111111111111111111111111111111111141a3";
const CONTACT = "0x0555aa7890abcdef1234567890abcdef1234567890abcdef1234567890aabbcc";
const LOOKALIKE = `0x0555f${"0".repeat(55)}bbcc`;

const account: Pick<AccountRef, "address" | "networkId"> = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
};

const context = verificationContext(account, {
  addressBook: [{ address: CONTACT, id: `SN_MAIN:${CONTACT}`, label: "Ada", networkId: "SN_MAIN" }],
  tokens: [
    {
      address: ETH,
      decimals: 18,
      id: `SN_MAIN:ETH:${ETH}`,
      name: "Ether",
      networkId: "SN_MAIN",
      symbol: "ETH",
    },
  ],
});

const decimal = (felt: string): string => BigInt(felt).toString(10);

// Every calldata felt respelled in decimal: the same call, as `CallData.compile`
// would have written it.
const asDecimal = (call: Call): Call => ({
  ...call,
  calldata: (call.calldata as string[]).map(decimal),
});

const sameReport = (call: Call) => {
  const hex = verifyCalls([call], context);
  const dec = verifyCalls([asDecimal(call)], context);
  expect(dec).toEqual(hex);
  return hex;
};

describe("decimal calldata", () => {
  test("a send built by buildErc20TransferCall names the recipient in hex", () => {
    const call = buildErc20TransferCall(ETH, RECIPIENT, 10n ** 18n);
    expect(call.calldata).toContain(decimal(RECIPIENT));
    const summary = verifyCalls([call], context).calls[0]?.summary;
    expect(summary).toBe(`Send 1 ETH to ${addressLabel(RECIPIENT)}`);
    expect(summary).toContain("0x03fa…41a3");
  });

  test("decimal and hex calldata give identical summaries and flags", () => {
    for (const call of [
      { calldata: [RECIPIENT, "0x1", "0x0"], contractAddress: ETH, entrypoint: "transfer" },
      {
        calldata: [CONTACT, RECIPIENT, "0x1", "0x0"],
        contractAddress: ETH,
        entrypoint: "transfer_from",
      },
      { calldata: [RECIPIENT, "0x1", "0x0"], contractAddress: ETH, entrypoint: "approve" },
      { calldata: [RECIPIENT, "0x1"], contractAddress: ETH, entrypoint: "set_approval_for_all" },
      { calldata: [account.address, "0x1", "0x0"], contractAddress: ETH, entrypoint: "transfer" },
      { calldata: [ETH, "0x1", "0x0"], contractAddress: ETH, entrypoint: "transfer" },
    ]) {
      const report = sameReport(call);
      expect(JSON.stringify(report)).not.toContain(decimal(call.calldata[0] ?? "0x0"));
    }
  });

  test("self-send and token-contract recipient flags fire on decimal calldata", () => {
    const self = verifyCalls(
      [
        asDecimal({
          calldata: [account.address, "0x1", "0x0"],
          contractAddress: ETH,
          entrypoint: "transfer",
        }),
      ],
      context,
    );
    expect(self.flags.map((flag) => flag.code)).toContain("self-transfer");
    const toToken = verifyCalls(
      [asDecimal({ calldata: [ETH, "0x1", "0x0"], contractAddress: ETH, entrypoint: "transfer" })],
      context,
    );
    expect(toToken.flags.map((flag) => flag.code)).toContain("token-contract-recipient");
  });

  test("a poisoned lookalike recipient in decimal calldata is still refused", () => {
    const call = buildErc20TransferCall(ETH, LOOKALIKE, 1n);
    expect(call.calldata).toContain(decimal(LOOKALIKE));
    const report = verifyCalls([call], context);
    expect(report.flags.map((flag) => flag.code)).toContain("address-poisoning");
    expect(refuseOnPoisonedRecipient(report)).not.toBeNull();
  });

  test("an absent or unparseable slot still reads as no address", () => {
    expect(
      verifyCalls(
        [{ calldata: ["", "0x1", "0x0"], contractAddress: ETH, entrypoint: "transfer" }],
        context,
      ).calls[0]?.kind,
    ).toBe("unknown");
  });
});
