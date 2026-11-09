/**
 * The deployment receipt's wait (issue 431). A sponsored deploy's hash is the
 * relay's claim, so it never decides the receipt on its own: success is the
 * account's own class at its address, and the hash's failure counts only while
 * the address is confirmed empty. A self-paid deploy still reads its hash.
 */
import { describe, expect, test } from "bun:test";
import type { ClassHashVerification } from "@bramble/starknet/class-hash-verify";
import {
  awaitDeployOutcome,
  type DeployReceiptWatch,
} from "../../../src/sidepanel/shell/deploy-receipt-watch";

const ACCOUNT = "SN_SEPOLIA:0xabc";
const CLASS = "0x61dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f";
const VERIFIED: ClassHashVerification = { onChainClassHash: CLASS, status: "verified" };
const UNDEPLOYED: ClassHashVerification = { status: "undeployed" };
const MISMATCH: ClassHashVerification = {
  expectedClassHash: CLASS,
  onChainClassHash: "0x123",
  status: "mismatch",
};

const watch = (input: {
  readonly accountId?: string | null;
  readonly answeredFor?: string;
  readonly hashStatus?: string;
  readonly sponsored?: boolean;
  readonly verification: ClassHashVerification | Error;
}): DeployReceiptWatch => ({
  accountId: input.accountId === undefined ? ACCOUNT : input.accountId,
  delaysMs: [0, 0],
  hash: "0x5ab",
  sponsored: input.sponsored ?? true,
  stillCurrent: () => true,
  wallet: {
    loadActivity: async () =>
      ({
        entries: input.hashStatus ? [{ hash: "0x5ab", status: input.hashStatus }] : [],
      }) as never,
    loadClassHashVerification: async () => {
      if (input.verification instanceof Error) throw input.verification;
      return {
        accountId: input.answeredFor ?? ACCOUNT,
        ok: true,
        verification: input.verification,
      };
    },
  },
});

describe("sponsored deploy receipt", () => {
  test("an accepted relay hash is not 'Account deployed' while the address is empty", async () => {
    for (const status of ["accepted", "preconfirmed"]) {
      expect(
        await awaitDeployOutcome(watch({ hashStatus: status, verification: UNDEPLOYED })),
      ).toBe(null);
    }
  });

  test("another class at the address is neither deployed nor failed", async () => {
    for (const status of ["accepted", "rejected"]) {
      expect(await awaitDeployOutcome(watch({ hashStatus: status, verification: MISMATCH }))).toBe(
        null,
      );
    }
  });

  test("a rejected relay hash is not a failure while the chain cannot be read", async () => {
    const outcome = await awaitDeployOutcome(
      watch({ hashStatus: "rejected", verification: new Error("rpc down") }),
    );
    expect(outcome).toBeNull();
  });

  test("the account's own class at its address confirms, whatever the hash says", async () => {
    for (const hashStatus of [undefined, "rejected"]) {
      expect(
        await awaitDeployOutcome(
          watch({ ...(hashStatus ? { hashStatus } : {}), verification: VERIFIED }),
        ),
      ).toMatchObject({ kind: "succeeded" });
    }
  });

  test("a failed relay hash over a confirmed-empty address is a failure", async () => {
    for (const hashStatus of ["rejected", "reverted"]) {
      expect(
        await awaitDeployOutcome(watch({ hashStatus, verification: UNDEPLOYED })),
      ).toMatchObject({ kind: "failed" });
    }
  });

  test("an answer for another account, or no account scope, never confirms", async () => {
    expect(
      await awaitDeployOutcome(watch({ answeredFor: "SN_SEPOLIA:0xdef", verification: VERIFIED })),
    ).toBeNull();
    expect(await awaitDeployOutcome(watch({ accountId: null, verification: VERIFIED }))).toBeNull();
  });
});

describe("self-paid deploy receipt", () => {
  test("reads its own hash's outcome", async () => {
    const outcome = await awaitDeployOutcome(
      watch({ hashStatus: "accepted", sponsored: false, verification: UNDEPLOYED }),
    );
    expect(outcome).toMatchObject({ kind: "succeeded" });
  });
});
