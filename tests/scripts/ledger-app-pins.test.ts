/**
 * The Ledger E2E supply-chain pins (issue 861): images by digest, the app by
 * full commit, binary hashes recorded or explicitly unrecorded, and a built
 * binary never accepted without a matching recorded hash.
 */
import { describe, expect, test } from "bun:test";
import {
  APP_STARKNET_REVISION,
  LEDGER_APP_BINARIES,
  LEDGER_APP_BUILDER_IMAGE,
  SPECULOS_IMAGE,
} from "../../scripts/ledger-app-pins";
import { ledgerAppBinaryFailure, ledgerAppPinFailures } from "../../scripts/ledger-app-policy";

const DIGEST = "a".repeat(64);
const pins = {
  binaries: { flex: { sha256: null }, nanosp: { sha256: DIGEST } },
  builderImage: `ghcr.io/ledgerhq/ledger-app-builder/ledger-app-builder@sha256:${DIGEST}`,
  revision: "f".repeat(40),
  speculosImage: `ghcr.io/ledgerhq/speculos@sha256:${DIGEST}`,
};

describe("Ledger app pins", () => {
  test("the committed pins are well formed", () => {
    expect(
      ledgerAppPinFailures({
        binaries: LEDGER_APP_BINARIES,
        builderImage: LEDGER_APP_BUILDER_IMAGE,
        revision: APP_STARKNET_REVISION,
        speculosImage: SPECULOS_IMAGE,
      }),
    ).toEqual([]);
  });

  test("rejects tags, short commits, foreign registries and bad hashes", () => {
    expect(ledgerAppPinFailures(pins)).toEqual([]);
    expect(
      ledgerAppPinFailures({ ...pins, speculosImage: "ghcr.io/ledgerhq/speculos:v0.27.1" }),
    ).toHaveLength(1);
    expect(
      ledgerAppPinFailures({ ...pins, builderImage: `docker.io/someone/builder@sha256:${DIGEST}` }),
    ).toHaveLength(1);
    expect(ledgerAppPinFailures({ ...pins, revision: "f87210cd" })).toHaveLength(1);
    expect(ledgerAppPinFailures({ ...pins, binaries: { flex: { sha256: "ABC" } } })).toHaveLength(
      1,
    );
  });

  test("a built binary needs a recorded, matching hash; an absent one is fine", () => {
    expect(ledgerAppBinaryFailure("flex", null, null)).toBeNull();
    expect(ledgerAppBinaryFailure("flex", DIGEST, null)).toBeNull();
    expect(ledgerAppBinaryFailure("flex", DIGEST, DIGEST)).toBeNull();
    expect(ledgerAppBinaryFailure("flex", null, DIGEST)).toContain("not recorded");
    expect(ledgerAppBinaryFailure("flex", DIGEST, "b".repeat(64))).toContain("does not match");
  });
});
