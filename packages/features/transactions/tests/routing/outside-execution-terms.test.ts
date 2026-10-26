/**
 * The terms recorded for a signed OutsideExecution (issue 299) are read with
 * the canonical SNIP-9 field types, so the nonce is the felt the account checks
 * whatever spelling the dapp used, and anything that is not a complete
 * OutsideExecution under the SNIP-9 domain records nothing.
 */
import { describe, expect, test } from "bun:test";
import {
  OUTSIDE_EXECUTION_DOMAIN,
  outsideExecutionTerms,
} from "@bramble/transactions/outside-execution-terms";
import { constants, outsideExecution } from "starknet";

const ETH = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const CALL = { calldata: ["0x5", "0x1", "0x0"], contractAddress: ETH, entrypoint: "transfer" };

const outside = (
  version: "1" | "2",
  options: {
    readonly caller?: string;
    readonly before?: number | string;
    readonly nonce?: unknown;
  } = {},
): Record<string, unknown> =>
  JSON.parse(
    JSON.stringify(
      outsideExecution.getTypedData(
        constants.StarknetChainId.SN_MAIN,
        {
          caller: options.caller ?? constants.OutsideExecutionCallerAny,
          execute_after: 1,
          execute_before: (options.before ?? 1_900_000_000) as number,
        },
        (options.nonce ?? "0x2a") as string,
        [CALL, CALL],
        version,
      ),
    ),
  );

describe("outsideExecutionTerms", () => {
  for (const version of ["1", "2"] as const) {
    test(`reads the nonce, caller, deadline and call count of a v${version} message`, () => {
      expect(outsideExecutionTerms(outside(version))).toEqual({
        callCount: 2,
        caller: constants.OutsideExecutionCallerAny,
        executeBefore: 1_900_000_000,
        nonce: "0x2a",
        revision: version,
      });
    });
  }

  test("canonicalizes a decimal nonce to the felt the account checks", () => {
    expect(outsideExecutionTerms(outside("2", { nonce: "42" }))?.nonce).toBe("0x2a");
  });

  test("keeps no deadline when the bound is past any real timestamp", () => {
    const terms = outsideExecutionTerms(
      outside("2", { before: "0xffffffffffffffffffffffffffffffff" }),
    );
    expect(terms?.executeBefore).toBeNull();
  });

  test("records nothing for a message under another domain", () => {
    const typed = outside("2");
    typed["domain"] = { ...(typed["domain"] as object), name: "Example" };
    expect(outsideExecutionTerms(typed)).toBeNull();
    expect(OUTSIDE_EXECUTION_DOMAIN).toBe("Account.execute_from_outside");
  });

  test("records nothing for a message missing its nonce", () => {
    const typed = outside("2");
    const { Nonce: _nonce, ...message } = typed["message"] as Record<string, unknown>;
    expect(outsideExecutionTerms({ ...typed, message })).toBeNull();
  });

  test("records nothing for a nonce the encoder rejects", () => {
    const typed = outside("1");
    typed["message"] = { ...(typed["message"] as object), nonce: { not: "a felt" } };
    expect(outsideExecutionTerms(typed)).toBeNull();
  });

  test("records nothing for plain typed data or a malformed OutsideExecution", () => {
    expect(outsideExecutionTerms({ message: {}, primaryType: "Mail" })).toBeNull();
    expect(
      outsideExecutionTerms({ message: { Nonce: "0x1" }, primaryType: "OutsideExecution" }),
    ).toBeNull();
    expect(outsideExecutionTerms("not typed data")).toBeNull();
  });
});
