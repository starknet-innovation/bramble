/**
 * The multisig privacy round's offline rules: how much it may fund and move,
 * which kept record it trusts, and that the two owner phrases are stable and
 * distinct. None of these dial a network.
 */
import { describe, expect, test } from "bun:test";
import { validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { MAX_PROTOCOL_FEE_RAW } from "../strk20-pool-fee";
import {
  feeRefusal,
  planRound,
  ROUND_LIMITS,
  sweepableAmount,
  withdrawableAmount,
} from "./round-budget";
import { strkTransferCall } from "./round-chain";
import { ownerPhrase } from "./round-owners";
import { parseRoundRecord } from "./round-state";
import { isLaggingNode } from "./round-wallets";

const STRK = 10n ** 18n;
// Full-length felts: a short stub would pass a check a real address fails.
const SALT = `0x${"5".repeat(62)}`;
const ADDRESS = `0x4${"a".repeat(62)}`;
const KEY = `0x3${"c".repeat(62)}`;

describe("round budget", () => {
  test("funds the deposit, two pool fees and the gas reserve", () => {
    const plan = planRound(STRK);
    expect(plan.deposit).toBe(2n * (STRK + ROUND_LIMITS.relayReserve) + plan.transferAmount);
    expect(plan.funding).toBe(plan.deposit + 2n * STRK + ROUND_LIMITS.gasReserve);
  });

  test("covers both relayed actions out of the deposit", () => {
    const plan = planRound(STRK);
    const twoActions = 2n * (plan.poolFee + ROUND_LIMITS.relayReserve);
    expect(plan.deposit - twoActions).toBe(plan.transferAmount);
  });

  test("stays under the funding ceiling at the highest pool fee it accepts", () => {
    expect(planRound(MAX_PROTOCOL_FEE_RAW).funding).toBeLessThanOrEqual(ROUND_LIMITS.maxFunding);
  });

  test("refuses a pool fee above the ceiling, and a negative one", () => {
    expect(() => planRound(MAX_PROTOCOL_FEE_RAW + 1n)).toThrow("Nothing was funded");
    expect(() => planRound(-1n)).toThrow("Nothing was funded");
  });
});

describe("fee refusal", () => {
  test("names the quoted figure and the ceiling, and passes a fee at the ceiling", () => {
    const ceiling = 3n * STRK;
    expect(
      feeRefusal({ overallFee: (ceiling + 1n).toString(), unit: "FRI" }, ceiling, "register"),
    ).toBe(
      "The register fee may reach 3.000000000000000001 STRK, above its 3 STRK ceiling. Nothing was sent.",
    );
    expect(
      feeRefusal({ overallFee: ceiling.toString(), unit: "FRI" }, ceiling, "register"),
    ).toBeNull();
    expect(feeRefusal({ overallFee: "1", unit: "WEI" }, ceiling, "deposit")).toBe(
      "The deposit fee is quoted in WEI, not STRK. Nothing was sent.",
    );
  });
});

describe("withdrawable amount", () => {
  test("keeps one and a half times the observed action cost", () => {
    expect(withdrawableAmount(10n * STRK, STRK, 2n * STRK)).toBe(7n * STRK);
  });

  test("keeps the pool fee and the relay reserve when nothing was observed", () => {
    expect(withdrawableAmount(10n * STRK, STRK, null)).toBe(
      10n * STRK - STRK - ROUND_LIMITS.relayReserve,
    );
  });

  test("is null when the balance cannot pay for its own withdrawal", () => {
    expect(withdrawableAmount(STRK, STRK, null)).toBeNull();
    expect(withdrawableAmount(0n, STRK, 2n * STRK)).toBeNull();
  });
});

describe("sweepable amount", () => {
  test("leaves twice the prepared maximum fee behind", () => {
    expect(sweepableAmount(STRK, STRK / 100n)).toBe(STRK - STRK / 50n);
  });

  test("is null above the transfer fee ceiling, for a zero fee, and for dust", () => {
    expect(sweepableAmount(10n * STRK, ROUND_LIMITS.maxTransferFee + 1n)).toBeNull();
    expect(sweepableAmount(10n * STRK, 0n)).toBeNull();
    expect(sweepableAmount(STRK / 100n, STRK / 100n)).toBeNull();
  });
});

describe("kept round record", () => {
  test("round-trips a record with and without the multisig address", () => {
    const bare = { salt: SALT, version: 1 as const };
    expect(parseRoundRecord(JSON.stringify(bare))).toEqual(bare);
    const full = { ...bare, multisigAddress: ADDRESS };
    expect(parseRoundRecord(JSON.stringify(full))).toEqual(full);
  });

  test("refuses anything it cannot name funds from", () => {
    for (const text of [
      "",
      "{",
      "null",
      JSON.stringify({ salt: SALT, version: 2 }),
      JSON.stringify({ salt: "0x0", version: 1 }),
      JSON.stringify({ salt: SALT.toUpperCase(), version: 1 }),
      JSON.stringify({ multisigAddress: "not-a-felt", salt: SALT, version: 1 }),
      JSON.stringify({ multisigAddress: `0x0${ADDRESS.slice(2)}`, salt: SALT, version: 1 }),
    ]) {
      expect(parseRoundRecord(text)).toBeNull();
    }
  });
});

describe("owner phrases", () => {
  test("are valid, stable for a key, and different per owner", () => {
    const a = ownerPhrase(KEY, "a");
    const b = ownerPhrase(KEY, "b");
    expect(a.split(" ")).toHaveLength(12);
    expect(validateMnemonic(a, wordlist)).toBe(true);
    expect(validateMnemonic(b, wordlist)).toBe(true);
    expect(a).not.toBe(b);
    expect(ownerPhrase(KEY, "a")).toBe(a);
  });

  test("do not depend on how the same key is spelled", () => {
    expect(ownerPhrase(`0x0${KEY.slice(2)}`, "a")).toBe(ownerPhrase(KEY, "a"));
    expect(ownerPhrase(KEY.toUpperCase().replace("0X", "0x"), "a")).toBe(ownerPhrase(KEY, "a"));
  });

  test("differ between funding keys, and refuse a key that is not a felt", () => {
    expect(ownerPhrase(`0x2${"c".repeat(62)}`, "a")).not.toBe(ownerPhrase(KEY, "a"));
    expect(() => ownerPhrase("not-a-key", "a")).toThrow("not a valid felt");
  });
});

describe("lagging RPC node", () => {
  const refused = { error: "RPC: starknet_call\n\n      24: Block not found: undefined" };

  test("retries a read the node refused, and never a broadcast", () => {
    expect(isLaggingNode({ type: "wallet.shareArgentMultisigStrk20Authorization" }, refused)).toBe(
      true,
    );
    expect(isLaggingNode({ type: "wallet.submitArgentMultisigIntent" }, refused)).toBe(false);
    expect(isLaggingNode({ type: "wallet.submitArgentMultisigStrk20Relay" }, refused)).toBe(false);
    expect(isLaggingNode({ type: "wallet.deployArgentMultisig" }, refused)).toBe(false);
  });

  test("leaves every other refusal and a success alone", () => {
    const share = { type: "wallet.shareArgentMultisigStrk20Authorization" };
    expect(isLaggingNode(share, { error: "Invalid Argent multisig private proof" })).toBe(false);
    expect(isLaggingNode(share, { ok: true })).toBe(false);
  });
});

describe("sweep call", () => {
  test("is one canonical STRK transfer with a two-limb amount", () => {
    const call = strkTransferCall(ADDRESS, 3n * STRK);
    expect(call.entrypoint).toBe("transfer");
    expect(call.calldata).toEqual([ADDRESS, `0x${(3n * STRK).toString(16)}`, "0x0"]);
  });
});
