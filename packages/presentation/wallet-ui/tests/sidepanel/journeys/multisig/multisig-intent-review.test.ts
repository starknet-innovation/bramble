/**
 * A frozen intent's technical details show every call target and signer key
 * truncated, and each one copies in full: a co-signer can check the identity
 * they were told against the one being signed.
 */
import { describe, expect, test } from "bun:test";
import { multisigDetailFlow } from "../../../../src/sidepanel/journeys/multisig/multisig-views";
import { makeArgentMultisigFixture } from "../../../support/argent-multisig-fixtures";

describe("multisig intent technical details", () => {
  test("technical details copy every call target and signer key in full", async () => {
    const fixture = await makeArgentMultisigFixture([
      {
        calldata: ["0x2", "0x1", "0x0", "0x2"],
        contractAddress: "0x123",
        entrypoint: "add_signers",
      },
    ]);
    const currentKey = fixture.record.currentConfig?.signerPublicKeys[0] ?? "missing";
    const html = multisigDetailFlow(
      fixture.status,
      fixture.status.accounts[0] ?? null,
      fixture.view,
      [fixture.intent],
    );
    const reviewStart = html.indexOf('aria-label="Signer authority change"');
    const callsStart = html.indexOf('<ol class="allowance-list">', reviewStart);
    const review = html.slice(reviewStart, callsStart);
    // Current and resulting signer lists: truncated text, full key on hover,
    // one copy control per key.
    expect(review).toContain(
      `<li><code title="${currentKey}">0x${currentKey.slice(2, 6)}…${currentKey.slice(-4)}</code><button class="icon-button ghost copy-inline" data-copy="${currentKey}" type="button" aria-label="Copy signer public key"`,
    );
    expect(review.match(new RegExp(`data-copy="${currentKey}"`, "g"))).toHaveLength(2);
    // The exact change names the key it adds, whole when short, and copies it.
    expect(review).toContain(
      '<p><code title="Add 0x2">Add 0x2</code><button class="icon-button ghost copy-inline" data-copy="0x2" type="button" aria-label="Copy signer public key to add"',
    );
    // Each call's contract address copies in full beside its truncated label.
    const calls = html.slice(callsStart);
    expect(calls).toContain(
      '<p>Contract · <code title="0x123">0x123…x123</code><button class="icon-button ghost copy-inline" data-copy="0x123" type="button" aria-label="Copy call 1 contract address"',
    );
  });
});
