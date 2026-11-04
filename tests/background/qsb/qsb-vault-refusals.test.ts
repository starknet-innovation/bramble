/**
 * The QSB vault flows refuse with the contract's diagnostics only: a
 * coordinator refusal maps by status and code (a taken or paid script, an
 * owner the deployment will not serve, everything else unavailable), a
 * refused journal change maps by its reason, and anything unnamed becomes the
 * flow's fallback, so no coordinator or internal text reaches a page.
 */
import { describe, expect, test } from "bun:test";
import { WalletError } from "@bramble/core/errors";
import { QsbCoordinatorFailure } from "@bramble/qsb/client";
import { QSB_ACCOUNT_REFUSALS } from "@bramble/wallet-model/qsb";
import { QSB_VAULT_REFUSALS } from "@bramble/wallet-model/qsb-vaults";
import {
  coordinatorRefusal,
  failClosed,
  isScriptTaken,
  isSessionExpired,
  journalRefusal,
} from "../../../apps/extension/src/background/qsb/qsb-vault-refusals";

const refused = (status: number, code: string | null) =>
  new QsbCoordinatorFailure("refused", status, code);

describe("coordinator refusals", () => {
  test.each([
    [409, "vault_script_registered", QSB_VAULT_REFUSALS.scriptTaken],
    [409, "vault_script_paid", QSB_VAULT_REFUSALS.scriptTaken],
    [403, "owner_not_allowlisted", QSB_VAULT_REFUSALS.coordinatorDisabled],
    [503, "owner_limits_invalid", QSB_VAULT_REFUSALS.coordinatorDisabled],
    [503, "operations_disabled", QSB_VAULT_REFUSALS.coordinatorDisabled],
    [503, "chain_unavailable", QSB_VAULT_REFUSALS.coordinatorUnavailable],
    [409, "state_conflict", QSB_VAULT_REFUSALS.coordinatorUnavailable],
    [409, "idempotency_in_progress", QSB_VAULT_REFUSALS.coordinatorUnavailable],
    [400, "vault_invalid", QSB_VAULT_REFUSALS.coordinatorUnavailable],
    [502, null, QSB_VAULT_REFUSALS.coordinatorUnavailable],
    // A script code on any other status is not the deployment's script refusal.
    [400, "vault_script_paid", QSB_VAULT_REFUSALS.coordinatorUnavailable],
  ])("%p %p is %p", (status, code, diagnostic) => {
    expect(coordinatorRefusal(refused(status, code)).message).toBe(diagnostic);
  });

  test("an unreachable coordinator is unavailable; only a 401 session code expires", () => {
    expect(coordinatorRefusal(new QsbCoordinatorFailure("unreachable", null, null)).message).toBe(
      QSB_VAULT_REFUSALS.coordinatorUnavailable,
    );
    expect(isSessionExpired(refused(401, "session_expired"))).toBe(true);
    expect(isSessionExpired(refused(401, "auth_required"))).toBe(true);
    expect(isSessionExpired(refused(401, "signature_invalid"))).toBe(false);
    expect(isSessionExpired(refused(403, "session_expired"))).toBe(false);
    expect(isScriptTaken(new Error("vault_script_paid"))).toBe(false);
  });
});

describe("journal refusals", () => {
  test.each([
    ["allocation-exhausted", QSB_VAULT_REFUSALS.vaultLimit],
    ["journal-full", QSB_VAULT_REFUSALS.vaultLimit],
    ["journal-unavailable", QSB_ACCOUNT_REFUSALS.journalUnavailable],
    ["not-writer", QSB_VAULT_REFUSALS.notWriter],
    ["unknown-vault", QSB_VAULT_REFUSALS.unknownVault],
    ["record-mismatch", QSB_VAULT_REFUSALS.runtimeUnavailable],
  ] as const)("%s is %p", (refusal, diagnostic) => {
    expect(journalRefusal(refusal).message).toBe(diagnostic);
  });
});

describe("failing closed", () => {
  test("passes named refusals, maps coordinator failures, and hides everything else", async () => {
    const named = new WalletError(QSB_VAULT_REFUSALS.quoteChanged);
    await expect(failClosed("runtimeUnavailable", () => Promise.reject(named))).rejects.toBe(named);
    await expect(
      failClosed("runtimeUnavailable", () => Promise.reject(refused(409, "vault_script_paid"))),
    ).rejects.toThrow(QSB_VAULT_REFUSALS.scriptTaken);
    await expect(
      failClosed("runtimeUnavailable", () => Promise.reject(new Error("Traceback: secret detail"))),
    ).rejects.toThrow(QSB_VAULT_REFUSALS.runtimeUnavailable);
    await expect(failClosed("runtimeUnavailable", async () => 7)).resolves.toBe(7);
  });
});
