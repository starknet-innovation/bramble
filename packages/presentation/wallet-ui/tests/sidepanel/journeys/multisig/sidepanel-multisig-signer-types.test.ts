/** Non-Stark Argent signer types remain explicit, safe, and watch-only. */
import { describe, expect, test } from "bun:test";
import { multisigSignersFlow } from "../../../../src/sidepanel/journeys/multisig/multisig-management-views";
import { multisigProposeFlow } from "../../../../src/sidepanel/journeys/multisig/multisig-views";
import { makeArgentMultisigFixture } from "../../../support/argent-multisig-fixtures";

describe("Argent multisig signer types", () => {
  test("renders non-Stark authority without an impossible key field or transaction form", async () => {
    const fixture = await makeArgentMultisigFixture();
    const { currentConfig: _currentConfig, ...record } = fixture.record;
    const view = {
      ...fixture.view,
      authorityStatus: "unsupported-signers" as const,
      config: {
        classHash: fixture.record.classHash,
        signerGuids: ["0x123"],
        threshold: 1,
      },
      record,
      unsupportedSigners: [{ guid: "0x123", type: "webauthn" as const }],
    };
    const html = multisigSignersFlow(fixture.status, fixture.status.accounts[0] ?? null, view);

    expect(html).toContain("Passkey signer");
    expect(html).toContain("Watch only");
    expect(html).not.toContain("Missing signer public key");
    expect(html).not.toContain("Verify missing signer keys");
    const propose = multisigProposeFlow(fixture.status, view);
    expect(propose).toContain("signer types this wallet cannot sign with");
    expect(propose).not.toContain('id="multisig-propose-form"');
  });
});
