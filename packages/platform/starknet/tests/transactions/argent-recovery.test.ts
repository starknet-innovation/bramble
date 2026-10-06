/**
 * Phrase-driven Ready guardian escape: the owner-only carve-out, the status to
 * call mapping, the security period and completion window read from chain,
 * the owner-escape acknowledgement, the confirmed fee ceiling, and the submit
 * guards. Pending changes and the backup guardian: argent-recovery-escapes.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { resetRpcEndpointCooldownsForTests } from "@bramble/starknet/provider";
import { getArgentRecoveryState, IndeterminateRpcWriteError } from "@bramble/starknet/rpc";
import {
  ACCEPTED_BLOCK,
  account,
  BLOCK_TIME,
  boundsFor,
  type Chain,
  COMPLETE,
  EXPIRED,
  hex,
  ledgerAccount,
  OWNER_ESCAPE,
  PENDING,
  providerWith,
  READY,
  READY_AT,
  RPC,
  review,
  STRK,
  submit,
  TRIGGER,
  VALIDATED,
  WEEK,
} from "./argent-recovery-harness";

beforeEach(() => resetRpcEndpointCooldownsForTests());

describe("argent recovery state", () => {
  test("maps every escape status, with the window from the chain's period", async () => {
    const read = (chain: Chain) =>
      getArgentRecoveryState({ accountAddress: account.address, rpcUrls: RPC }, () =>
        providerWith(chain),
      );
    const none = {
      expiresAt: null,
      guardianBackup: "absent" as const,
      pendingChange: null,
      readyAt: null,
      securityPeriodSeconds: WEEK,
      status: "none" as const,
    };
    expect(await read({})).toEqual(none);
    const window = {
      expiresAt: READY_AT + WEEK,
      guardianBackup: "absent" as const,
      pendingChange: null,
      readyAt: READY_AT,
    };
    expect(await read(PENDING)).toEqual({
      ...window,
      securityPeriodSeconds: WEEK,
      status: "pending",
    });
    expect(await read(READY)).toEqual({ ...window, securityPeriodSeconds: WEEK, status: "ready" });
    expect(await read(EXPIRED)).toEqual({
      ...window,
      securityPeriodSeconds: WEEK,
      status: "expired",
    });
    // A shortened security period moves the deadline with it.
    expect(await read({ ...READY, period: hex(600) })).toMatchObject({
      expiresAt: READY_AT + 600,
      securityPeriodSeconds: 600,
    });
  });

  test("reports a live owner escape instead of reading it as none", async () => {
    const read = (chain: Chain) =>
      getArgentRecoveryState({ accountAddress: account.address, rpcUrls: RPC }, () =>
        providerWith(chain),
      );
    expect(await read(OWNER_ESCAPE)).toMatchObject({
      pendingChange: { kind: "owner-escape", readyAt: READY_AT },
      status: "none",
    });
    expect(await read({ ...OWNER_ESCAPE, status: "0x2" })).toMatchObject({
      pendingChange: { kind: "owner-escape", readyAt: READY_AT },
    });
    expect(await read({ ...OWNER_ESCAPE, status: "0x3" })).toMatchObject({
      pendingChange: null,
    });
    await expect(read({ ...PENDING, status: "0x9" })).rejects.toThrow("unrecognised escape status");
  });
});

describe("argent recovery gate", () => {
  test("reads the gate and the escape at one accepted block, for review and submit", async () => {
    for (const run of ["review", "submit"] as const) {
      const reads: string[] = [];
      if (run === "review") await review({ reads }).result;
      else await submit({ reads }, "start").result;
      // Everything up to the estimate: class, owner, owner type, guardian,
      // backup, escape and period — all at the pinned accepted block.
      const gate = reads.slice(0, 7);
      expect(gate).toHaveLength(7);
      expect(gate.every((read) => read.endsWith(`@${ACCEPTED_BLOCK}`))).toBe(true);
      expect(gate).toContain(`get_escape_and_status@${ACCEPTED_BLOCK}`);
      expect(gate).toContain(`get_guardian_backup@${ACCEPTED_BLOCK}`);
    }
  });
});

describe("argent recovery review", () => {
  test("starts with trigger_escape_guardian(None), estimated validated and keyless", async () => {
    for (const chain of [{}, EXPIRED]) {
      const { doubles, result } = review(chain);
      expect(await result).toEqual({
        expiresAt: BLOCK_TIME + 2 * WEEK,
        fee: { overallFee: "1500000000000000", unit: "FRI" },
        readyAt: BLOCK_TIME + WEEK,
        replaces: null,
        step: "start",
      });
      expect(doubles.estimates).toEqual([{ call: TRIGGER, details: VALIDATED }]);
    }
  });

  test("states the window from the account's own security period", async () => {
    expect(await review({ period: hex(600) }).result).toMatchObject({
      expiresAt: BLOCK_TIME + 1200,
      readyAt: BLOCK_TIME + 600,
    });
  });

  test("completes a ready escape with escape_guardian() and its real deadline", async () => {
    const { doubles, result } = review(READY);
    expect(await result).toEqual({
      expiresAt: READY_AT + WEEK,
      fee: { overallFee: "1500000000000000", unit: "FRI" },
      readyAt: READY_AT,
      replaces: null,
      step: "complete",
    });
    expect(doubles.estimates).toEqual([{ call: COMPLETE, details: VALIDATED }]);
  });

  test("refuses during the waiting period", async () => {
    await expect(review(PENDING).result).rejects.toThrow("waiting period");
  });

  test("flags that starting cancels a pending owner escape", async () => {
    expect(await review(OWNER_ESCAPE).result).toMatchObject({
      replaces: { kind: "owner-escape", readyAt: READY_AT },
      step: "start",
    });
  });

  test("caps the stated fee at the account's 5 STRK escape limit", async () => {
    expect((await review({}, 4n * STRK).result).fee.overallFee).toBe((5n * STRK).toString());
    await expect(review({}, 6n * STRK).result).rejects.toThrow("on-chain cap");
  });

  test("refuses accounts the carve-out does not cover", async () => {
    await expect(review({ guardian: "0x0" }).result).rejects.toThrow("no guardian to remove");
    // Each restriction names its own cause.
    await expect(review({ owner: "0x999" }).result).rejects.toThrow(
      "Deployed Argent account owner does not match the wallet signer",
    );
    await expect(review({ ownerType: "0x1" }).result).rejects.toThrow(
      "Deployed Argent account owner type is not supported by this wallet",
    );
    await expect(review({ classHash: "0x123" }).result).rejects.toThrow(
      "Deployed Argent account class is not one this wallet can recover",
    );
    await expect(review({}, 10n ** 15n, ledgerAccount).result).rejects.toThrow("Ledger");
  });
});

describe("argent recovery submit", () => {
  test("starts the escape under the reviewed bounds and returns the window", async () => {
    const { doubles, result, signed } = submit({}, "start");
    // The receipt clears this double's escape; the window is read back live.
    expect(await result).toEqual({ expiresAt: null, readyAt: null, transactionHash: "0x5" });
    expect(doubles.estimates).toEqual([{ call: TRIGGER, details: VALIDATED }]);
    expect(doubles.executes).toEqual([
      { call: TRIGGER, details: { resourceBounds: boundsFor(10n ** 15n), tip: "0x0" } },
    ]);
    expect(signed).toEqual(["0x5"]);
  });

  test("completes a ready escape and never re-triggers it", async () => {
    const { doubles, result } = submit(READY, "complete");
    await result;
    expect(doubles.executes.map((entry) => entry.call)).toEqual([COMPLETE]);
  });

  test("refuses a step other than the one confirmed, and an early completion", async () => {
    await expect(submit({}, "complete").result).rejects.toThrow("step changed");
    await expect(submit(READY, "start").result).rejects.toThrow("step changed");
    await expect(submit(PENDING, "complete").result).rejects.toThrow("waiting period");
    await expect(submit({}, undefined).result).rejects.toThrow("not reviewed");
  });

  test("cancels a pending owner escape only when the user acknowledged it", async () => {
    const silent = submit(OWNER_ESCAPE, "start");
    await expect(silent.result).rejects.toThrow("key change is pending");
    expect(silent.doubles.executes).toHaveLength(0);
    // An acknowledgement for another escape (cancelled and re-triggered since
    // the review, so a different ready_at) does not cover this one.
    const stale = submit(OWNER_ESCAPE, "start", {
      replaceEscape: { kind: "owner-escape", readyAt: READY_AT - 1 },
    });
    await expect(stale.result).rejects.toThrow("key change is pending");
    expect(stale.doubles.executes).toHaveLength(0);
    // Nor does one for another kind of change at the same ready_at.
    const wrongKind = submit(OWNER_ESCAPE, "start", {
      replaceEscape: { kind: "guardian-change", readyAt: READY_AT },
    });
    await expect(wrongKind.result).rejects.toThrow("key change is pending");
    expect(wrongKind.doubles.executes).toHaveLength(0);
    const acknowledged = submit(OWNER_ESCAPE, "start", {
      replaceEscape: { kind: "owner-escape", readyAt: READY_AT },
    });
    await acknowledged.result;
    expect(acknowledged.doubles.executes.map((entry) => entry.call)).toEqual([TRIGGER]);
  });

  test("holds the fee to the confirmed ceiling and the on-chain cap", async () => {
    await submit({}, "start", { spend: 1_500_000_000_000_000n }).result;
    const over = submit({}, "start", { spend: 1_500_000_000_000_001n });
    await expect(over.result).rejects.toThrow("recovery fee changed");
    expect(over.doubles.executes).toHaveLength(0);
    await expect(
      submit({}, "start", { reviewed: (50n * STRK).toString(), spend: 6n * STRK }).result,
    ).rejects.toThrow("recovery fee changed");
  });

  test("re-checks the account before signing", async () => {
    for (const chain of [{ owner: "0x999" }, { ownerType: "0x1" }, { guardian: "0x0" }]) {
      const refused = submit(chain, "start");
      await expect(refused.result).rejects.toThrow(/does not match|not supported|no guardian/);
      expect(refused.doubles.executes).toHaveLength(0);
    }
    await expect(submit({}, "start", { subject: ledgerAccount }).result).rejects.toThrow("Ledger");
  });

  test("a lock after signing revokes it; a mismatched or lost reply is indeterminate", async () => {
    await expect(submit({}, "start", { isAuthorized: () => false }).result).rejects.toThrow(
      "wallet locked",
    );
    const mismatch = await submit({}, "start", { accepts: "0x6" }).result.catch((e: unknown) => e);
    expect(mismatch).toBeInstanceOf(IndeterminateRpcWriteError);
    // An indeterminate write cools its endpoint down; start the next one fresh.
    resetRpcEndpointCooldownsForTests();
    const lost = await submit({ waitFails: true }, "start").result.catch((e: unknown) => e);
    expect(lost).toBeInstanceOf(IndeterminateRpcWriteError);
  });
});
