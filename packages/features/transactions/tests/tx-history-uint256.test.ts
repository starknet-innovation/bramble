/**
 * Transfer decoding uint256 guard: an event whose amount low/high words are not
 * strings (a malformed/byzantine RPC record) must decode to null rather than
 * throwing when the amount is parsed, so one bad event is skipped as a
 * non-transfer instead of blanking a token's history.
 */
import { describe, expect, test } from "bun:test";
import {
  decodeTransferEvent,
  type HistoryEvent,
  TRANSFER_EVENT_KEY,
} from "@mc-wallet/transactions/tx-history";

const ACCOUNT = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const OTHER = "0x0777000000000000000000000000000000000000000000000000000000000abc";

describe("decodeTransferEvent uint256 guard", () => {
  test("returns null when the Cairo 1 amount low word is not a string", () => {
    // Indexed layout: from/to are keys, the amount is data[0]/data[1]. A numeric
    // (non-string) low word must be rejected by the uint256 parse guard.
    const event = {
      block_number: 5,
      data: [123 as unknown as string, "0"],
      keys: [TRANSFER_EVENT_KEY, OTHER, ACCOUNT],
      transaction_hash: "0xabc",
    } satisfies HistoryEvent;
    expect(decodeTransferEvent(event, ACCOUNT)).toBeNull();
  });

  test("returns null when the amount high word is missing (undefined)", () => {
    const event = {
      block_number: 5,
      data: ["1000000000000000000"],
      keys: [TRANSFER_EVENT_KEY, OTHER, ACCOUNT],
      transaction_hash: "0xabc",
    } satisfies HistoryEvent;
    expect(decodeTransferEvent(event, ACCOUNT)).toBeNull();
  });
});
