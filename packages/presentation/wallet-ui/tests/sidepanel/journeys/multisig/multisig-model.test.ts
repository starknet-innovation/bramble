/** Pure import/export helpers reject alternate encodings of frozen Argent authority. */
import { describe, expect, test } from "bun:test";
import {
  parseArgentMultisigIntentPackage,
  parseArgentMultisigSignature,
  serializeArgentMultisigIntentPackage,
} from "../../../../src/sidepanel/journeys/multisig/multisig-model";
import { makeArgentMultisigFixture } from "../../../support/argent-multisig-fixtures";

describe("Argent multisig intent packages", () => {
  test("round-trips the complete frozen package without normalization", async () => {
    const fixture = await makeArgentMultisigFixture();
    const encoded = serializeArgentMultisigIntentPackage(fixture.intentPackage);
    expect(parseArgentMultisigIntentPackage(encoded)).toEqual(fixture.intentPackage);
  });

  test("rejects tampered hashes, partial packages, and unknown authority", async () => {
    const fixture = await makeArgentMultisigFixture();
    const tampered = {
      ...fixture.intentPackage,
      intent: {
        ...fixture.intent,
        prepared: { ...fixture.intent.prepared, nonce: "0x8" },
      },
    };
    expect(parseArgentMultisigIntentPackage(JSON.stringify(tampered))).toBeNull();
    expect(parseArgentMultisigIntentPackage(JSON.stringify({ intent: fixture.intent }))).toBeNull();
    expect(
      parseArgentMultisigIntentPackage(
        JSON.stringify({ ...fixture.intentPackage, approvedByUser: true }),
      ),
    ).toBeNull();
    expect(parseArgentMultisigIntentPackage("not json")).toBeNull();
  });
});

describe("Argent multisig signature fragments", () => {
  test("accepts only three canonical non-zero felts", () => {
    expect(parseArgentMultisigSignature('{"publicKey":"0x1","r":"0x2","s":"0x3"}')).toEqual({
      publicKey: "0x1",
      r: "0x2",
      s: "0x3",
    });
    for (const raw of [
      '{"publicKey":"0x01","r":"0x2","s":"0x3"}',
      '{"publicKey":"0x1","r":"0x0","s":"0x3"}',
      '{"publicKey":"0x1","r":"0x2","s":"0x3","extra":true}',
      "not json",
    ]) {
      expect(parseArgentMultisigSignature(raw)).toBeNull();
    }
  });
});
