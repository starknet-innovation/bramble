/**
 * Ready escapes that are not a removal this flow can complete — a guardian
 * escape to a NEW guardian — and the backup guardian that blocks the removal.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { resetRpcEndpointCooldownsForTests } from "@bramble/starknet/provider";
import { getArgentRecoveryState } from "@bramble/starknet/rpc";
import {
  account,
  type Chain,
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
