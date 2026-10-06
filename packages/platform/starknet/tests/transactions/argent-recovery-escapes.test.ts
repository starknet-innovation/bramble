/**
 * Ready escapes that are not a removal this flow can complete — a guardian
 * escape to a NEW guardian — and the backup guardian that blocks the removal.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { resetRpcEndpointCooldownsForTests } from "@bramble/starknet/provider";
import { getArgentRecoveryState, reviewArgentRecovery } from "@bramble/starknet/rpc";
import {
  account,
  BLOCK_TIME,
  type Chain,
  fakes,
  GUARDIAN_CHANGE,
  hex,
  providerWith,
  READY,
  READY_AT,
  RPC,
  review,
  submit,
  TRIGGER,
  VALIDATED,
} from "./argent-recovery-harness";

beforeEach(() => resetRpcEndpointCooldownsForTests());

describe("argent recovery guardian change (escape to a new guardian)", () => {
  const read = (chain: Chain) =>
    getArgentRecoveryState({ accountAddress: account.address, rpcUrls: RPC }, () =>
      providerWith(chain),
    );
  const change = { kind: "guardian-change", readyAt: READY_AT };

  test("is never read as a removal, at any status", async () => {
    for (const status of ["0x1", "0x2"]) {
      expect(await read({ ...GUARDIAN_CHANGE, status })).toMatchObject({
        expiresAt: null,
        pendingChange: change,
        readyAt: null,
        status: "none",
      });
    }
    // An expired one is inert: nothing pending, nothing to show.
    expect(await read({ ...GUARDIAN_CHANGE, status: "0x3" })).toMatchObject({
      pendingChange: null,
      status: "none",
    });
    // A removal (None) is still a removal.
    expect(await read(READY)).toMatchObject({ pendingChange: null, status: "ready" });
  });

  test("fails closed on a new_signer it cannot parse", async () => {
    for (const rawEscape of [
      [hex(READY_AT), "0x1", "0x5", "0x2"],
      [hex(READY_AT), "0x1", "0x0", "0xc4a", "0x2"],
      [hex(READY_AT), "0x1", "0x1", "0xc4a", "0x0", "0x2"],
    ]) {
      await expect(read({ rawEscape })).rejects.toThrow("unrecognised escape");
    }
  });

  test("review offers only starting a removal, which cancels the change", async () => {
    const { doubles, result } = review(GUARDIAN_CHANGE);
    expect(await result).toMatchObject({ replaces: change, step: "start" });
    expect(doubles.estimates).toEqual([{ call: TRIGGER, details: VALIDATED }]);
  });

  test("submit never completes it, and starts only on an acknowledgement for it", async () => {
    const complete = submit(GUARDIAN_CHANGE, "complete");
    await expect(complete.result).rejects.toThrow("step changed");
    expect(complete.doubles.executes).toHaveLength(0);
    const silent = submit(GUARDIAN_CHANGE, "start");
    await expect(silent.result).rejects.toThrow("A guardian change is pending");
    expect(silent.doubles.executes).toHaveLength(0);
    const acknowledged = submit(GUARDIAN_CHANGE, "start", { replaceEscapeReadyAt: READY_AT });
    await acknowledged.result;
    expect(acknowledged.doubles.executes.map((entry) => entry.call)).toEqual([TRIGGER]);
  });
});

describe("argent recovery backup guardian", () => {
  const read = (chain: Chain) =>
    getArgentRecoveryState({ accountAddress: account.address, rpcUrls: RPC }, () =>
      providerWith(chain),
    );

  test("the state reports a backup guardian, and an unanswered read as unknown", async () => {
    expect((await read({ backup: "0xb4c" })).guardianBackup).toBe("present");
    expect((await read({ backup: "revert" })).guardianBackup).toBe("unknown");
    expect((await read({ backup: "empty" })).guardianBackup).toBe("unknown");
  });

  test("review refuses before estimating, and fails closed when the read fails", async () => {
    const present = review({ backup: "0xb4c" });
    await expect(present.result).rejects.toThrow("has a backup guardian");
    expect(present.doubles.estimates).toHaveLength(0);
    for (const backup of ["revert", "empty"] as const) {
      const unchecked = review({ backup });
      await expect(unchecked.result).rejects.toThrow(
        "Could not check this account's backup guardian",
      );
      expect(unchecked.doubles.estimates).toHaveLength(0);
    }
  });

  test("submit refuses before signing, for either step", async () => {
    for (const [chain, step] of [
      [{ backup: "0xb4c" }, "start"],
      [{ ...READY, backup: "0xb4c" }, "complete"],
      [{ backup: "revert" }, "start"],
    ] as const) {
      const refused = submit(chain, step);
      await expect(refused.result).rejects.toThrow(/backup guardian/);
      expect(refused.doubles.executes).toHaveLength(0);
    }
  });
});

describe("argent recovery escape limit (one attempt per 12 hours)", () => {
  const TWELVE_HOURS = 43_200;
  const LIMIT = "This account allows one escape attempt every 12 hours";

  test("review refuses a start within 12 hours of the last trigger, before estimating", async () => {
    for (const ago of [100, TWELVE_HOURS]) {
      const recent = review({ lastTrigger: hex(BLOCK_TIME - ago) });
      await expect(recent.result).rejects.toThrow(LIMIT);
      expect(recent.doubles.estimates).toHaveLength(0);
    }
    // Strictly after last + 12h passes, as the account's assert does.
    expect(await review({ lastTrigger: hex(BLOCK_TIME - TWELVE_HOURS - 1) }).result).toMatchObject({
      step: "start",
    });
  });

  test("completion is held to the completion clock, not the trigger's", async () => {
    await expect(review({ ...READY, lastEscape: hex(BLOCK_TIME - 100) }).result).rejects.toThrow(
      LIMIT,
    );
    expect(await review({ ...READY, lastTrigger: hex(BLOCK_TIME - 100) }).result).toMatchObject({
      step: "complete",
    });
  });

  test("submit refuses before signing, and an unreadable clock fails closed", async () => {
    const refused = submit({ lastTrigger: hex(BLOCK_TIME - 100) }, "start");
    await expect(refused.result).rejects.toThrow(LIMIT);
    expect(refused.doubles.executes).toHaveLength(0);
    await expect(review({ lastTrigger: "revert" }).result).rejects.toThrow(
      "Could not check this account's escape limit",
    );
  });

  test("an estimate that reverts on the limit gets the same refusal; others pass through", async () => {
    const estimateFailing = (message: string) => () =>
      ({
        async estimateInvokeFee() {
          throw new Error(message);
        },
      }) as never;
    const run = (message: string) =>
      reviewArgentRecovery(
        { account, rpcUrls: RPC, signHash: async () => ({ publicKey: "0x1", r: "0x1", s: "0x1" }) },
        () => providerWith({}),
        estimateFailing(message),
      );
    await expect(
      run("execution reverted: 0x617267656e742f6c6173742d6573636170652d746f6f2d726563656e74"),
    ).rejects.toThrow(LIMIT);
    await expect(run("Failure reason: 'argent/last-escape-too-recent'")).rejects.toThrow(LIMIT);
    await expect(run("argent/invalid-owner-sig")).rejects.toThrow("argent/invalid-owner-sig");
  });
});

describe("argent recovery gate reads that must not be swallowed", () => {
  const TWO = ["https://rpc-a.example", "https://rpc-b.example"];

  test("a transport failure on a gate read moves to the next endpoint", async () => {
    for (const broken of [{ lastTrigger: "transport" }, { backup: "transport" }] as const) {
      // The failed endpoint cools down; start each case from fresh state.
      resetRpcEndpointCooldownsForTests();
      const used: string[] = [];
      const doubles = fakes();
      const result = await reviewArgentRecovery(
        { account, rpcUrls: TWO, signHash: async () => ({ publicKey: "0x1", r: "0x1", s: "0x1" }) },
        (url) => {
          used.push(url);
          return providerWith(url === TWO[0] ? broken : {});
        },
        doubles.makeQueryAccount,
      );
      expect(result.step).toBe("start");
      expect(used).toEqual(TWO);
    }
  });

  test("the Home state read fails over too, rather than reporting the backup unknown", async () => {
    resetRpcEndpointCooldownsForTests();
    const state = await getArgentRecoveryState(
      { accountAddress: account.address, rpcUrls: TWO },
      (url) => providerWith(url === TWO[0] ? { backup: "transport" } : {}),
    );
    expect(state.guardianBackup).toBe("absent");
  });

  test("a JSON-RPC 24 miss re-pins instead of refusing", async () => {
    for (const chain of [{ lastTrigger: "miss-once" }, { backup: "miss-once" }] as const) {
      const reads: string[] = [];
      expect(await review({ ...chain, reads }).result).toMatchObject({ step: "start" });
      const entry =
        "lastTrigger" in chain ? "get_last_owner_trigger_escape_attempt" : "get_guardian_backup";
      expect(reads.filter((read) => read.startsWith(entry)).length).toBeGreaterThan(1);
    }
  });

  test("an answer from the account still refuses", async () => {
    await expect(review({ lastTrigger: "revert" }).result).rejects.toThrow(
      "Could not check this account's escape limit",
    );
    await expect(review({ backup: "revert" }).result).rejects.toThrow(
      "Could not check this account's backup guardian",
    );
  });
});
