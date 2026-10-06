/**
 * The read-only flag's recovery copy (consent copy, reviewed as a group): the
 * Ready completion window and deadline, the truthful cancel rule, the expired
 * and owner-escape states, and the Ledger refusal. Rendered through the same
 * function Home uses; every instant is fixed, no clock is read.
 */
import { describe, expect, test } from "bun:test";
import type { SignabilityVerdict } from "../../../../src/popup/responses/responses";
import { readOnlyNotice } from "../../../../src/sidepanel/journeys/portfolio/recovery-view";

const notice = (verdict: SignabilityVerdict, keyless = false): string =>
  readOnlyNotice(verdict, keyless);

describe("read-only recovery notice", () => {
  test("offers to complete a Ready guardian escape once it is ready, with its deadline", () => {
    const markup = notice({
      readOnly: true,
      reason: "guardian",
      recovery: {
        delaySeconds: 604_800,
        expiresAt: 1_900_604_800,
        pendingUntil: 1_900_000_000,
        stage: "ready",
      },
    });
    expect(markup).toContain("Complete recovery");
    expect(markup).toContain('data-recover-kind="argent"');
    // 1_900_604_800 = 24/03/30 17h46 UTC: the end of the completion window.
    expect(markup).toContain(
      "Guardian removal is ready. Complete it before 24/03/30 at 17h46 UTC.",
    );
  });

  test("shows when a Ready escape can be completed, its deadline, and who can cancel", () => {
    const markup = notice({
      readOnly: true,
      reason: "guardian",
      recovery: {
        delaySeconds: 604_800,
        expiresAt: 1_900_604_800,
        pendingUntil: 1_900_000_000,
        stage: "pending",
      },
    });
    expect(markup).toContain(
      "Removing the guardian — you can complete it after 17/03/30 at 17h46 UTC, until 24/03/30 at 17h46 UTC.",
    );
    expect(markup).toContain(
      "Cancelling needs this account&#39;s key and your guardian together, in Ready.",
    );
    expect(markup).not.toContain("guardian can still stop");
    expect(markup).not.toContain('id="recover-account"');
  });

  test("says an expired Ready escape expired, and restarts only on request", () => {
    const markup = notice({
      readOnly: true,
      reason: "guardian",
      recovery: {
        delaySeconds: 604_800,
        expiresAt: 1_900_604_800,
        pendingUntil: 1_900_000_000,
        stage: "expired",
      },
    });
    expect(markup).toContain(
      "The last guardian removal expired on 24/03/30 at 17h46 UTC without being completed.",
    );
    expect(markup).toContain('id="recover-account"');
    expect(markup).toContain("Recover account");
  });

  test("warns that the guardian is replacing the key instead of reporting nothing", () => {
    const markup = notice({
      readOnly: true,
      reason: "guardian",
      recovery: { delaySeconds: 604_800, pendingUntil: null, stage: "owner-escape" },
    });
    expect(markup).toContain("Your guardian has started replacing this account&#39;s key.");
    expect(markup).toContain('id="recover-account"');
  });

  test("tells a Ledger account that recovery is unavailable instead of offering it", () => {
    const markup = notice({ readOnly: true, reason: "guardian" }, true);
    expect(markup).toContain("Removing the guardian isn&#39;t available for Ledger accounts.");
    expect(markup).not.toContain('id="recover-account"');
    expect(notice({ readOnly: true, reason: "strong-signer" }, true)).toContain(
      "Removing 2FA isn&#39;t available for Ledger accounts.",
    );
  });

  test("a Braavos request in progress states when it takes effect and who can stop it", () => {
    const markup = notice({
      readOnly: true,
      reason: "strong-signer",
      recovery: { delaySeconds: 345_600, pendingUntil: 1_900_000_000 },
    });
    expect(markup).toContain(
      "Removing 2FA — usable on 17/03/30 at 17h46 UTC. Your Braavos device can still stop this.",
    );
    expect(markup).not.toContain('id="recover-account"');
  });

  test("renders nothing for a signable or unknown account", () => {
    expect(notice({ readOnly: false })).toBe("");
  });

  test("a backup guardian, or an unanswered read of it, gets no Recover button", () => {
    const present = notice({
      readOnly: true,
      reason: "guardian",
      recovery: { delaySeconds: 604_800, pendingUntil: null, stage: "backup-guardian" },
    });
    expect(present).toContain(
      "This account has a backup guardian, so the recovery phrase can&#39;t remove its guardian.",
    );
    expect(present).not.toContain('id="recover-account"');
    const unknown = notice({
      readOnly: true,
      reason: "guardian",
      recovery: { delaySeconds: 604_800, pendingUntil: null, stage: "backup-unknown" },
    });
    expect(unknown).toContain(
      "Couldn&#39;t check this account&#39;s backup guardian, so recovery isn&#39;t offered. Try again later.",
    );
    expect(unknown).not.toContain('id="recover-account"');
  });

  test("a pending change to a new guardian is shown neutrally, never as a removal", () => {
    const markup = notice({
      readOnly: true,
      reason: "guardian",
      recovery: { delaySeconds: 604_800, pendingUntil: null, stage: "guardian-change" },
    });
    expect(markup).toContain(
      "A change to a new guardian, started with this account&#39;s key, is pending.",
    );
    expect(markup).not.toContain("Removing the guardian");
    expect(markup).not.toContain("Complete recovery");
    expect(markup).toContain('id="recover-account"');
  });
});
