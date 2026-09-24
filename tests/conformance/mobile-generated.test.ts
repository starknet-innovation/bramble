/**
 * The mobile wallet reuses the extension's design system, network catalog, and Krusty release
 * rather than restating them. These tests fail when a committed mobile copy drifts from its
 * TypeScript source: re-run `bun run mobile:assets` (tokens, networks, brand mark) or
 * `bun run mobile:parity` (derivation vectors) and commit the result.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { EXPECTED_DEPENDENCIES } from "../../scripts/config-standards-policy";
import { readMobileAssetSources, renderMobileAssets } from "../../scripts/mobile-assets";
import { mobilePrivacyRoutes } from "../../scripts/mobile-assets/privacy";
import {
  computeParityAccounts,
  computeUiParity,
  PARITY_FIXTURE_PATH,
  PARITY_MESSAGE_HASH,
  PARITY_MNEMONIC,
} from "../../scripts/mobile-parity";
import {
  PRIVACY_COPY_KOTLIN_PATH,
  PRIVACY_COPY_SWIFT_PATH,
  PRIVACY_MOBILE_ONLY,
  renderPrivacyCopy,
} from "../../scripts/mobile-privacy-copy";
import { computePrivacyFixture, PRIVACY_FIXTURE_PATHS } from "../../scripts/mobile-privacy-fixture";
import {
  renderSendCopy,
  SEND_COPY_KOTLIN_PATH,
  SEND_COPY_SWIFT_PATH,
} from "../../scripts/mobile-send-copy";
import {
  computeTransactionFixture,
  splitTransactionFixture,
} from "../../scripts/mobile-transactions-fixture";

describe("mobile generated sources", async () => {
  for (const [path, expected] of renderMobileAssets(await readMobileAssetSources())) {
    test(`${path} matches its TypeScript source`, async () => {
      expect(await readFile(path, "utf8")).toBe(expected);
    });
  }
});

describe("mobile core parity", () => {
  test("the committed fixture is what the extension derives today", async () => {
    const fixture = JSON.parse(await readFile(PARITY_FIXTURE_PATH, "utf8")) as {
      readonly accounts: unknown;
      readonly messageHash: string;
      readonly mnemonic: string;
      readonly ui: unknown;
    };
    expect(fixture.mnemonic).toBe(PARITY_MNEMONIC);
    expect(fixture.messageHash).toBe(PARITY_MESSAGE_HASH);
    expect(fixture.accounts).toEqual(await computeParityAccounts());
    expect(fixture.ui).toEqual(JSON.parse(JSON.stringify(computeUiParity())));
  });

  test("the committed transaction fixture is what the extension's send path does today", async () => {
    const parts = splitTransactionFixture(await computeTransactionFixture());
    for (const [path, part] of parts) {
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual(part);
    }
    // The capture harness must have seen the extension's full write path, not a short-circuit.
    const wire = [...parts.values()][0] as {
      readonly scenarios: readonly { readonly submit: readonly string[] }[];
    };
    const methods = wire.scenarios.flatMap((scenario) =>
      scenario.submit.map((call) => (JSON.parse(call) as { readonly method: string }).method),
    );
    for (const method of [
      "starknet_chainId",
      "starknet_getClassHashAt",
      "starknet_getNonce",
      "starknet_estimateFee",
      "starknet_addDeployAccountTransaction",
      "starknet_getTransactionStatus",
      "starknet_addInvokeTransaction",
    ]) {
      expect(methods).toContain(method);
    }
  });

  test("the Send copy tables are rendered from the committed fixture", async () => {
    const { copy } = JSON.parse(
      await readFile("mobile/core/tests/fixtures/extension-transactions-copy.json", "utf8"),
    ) as { readonly copy: Record<string, unknown> };
    const rendered = renderSendCopy(copy);
    expect(await readFile(SEND_COPY_SWIFT_PATH, "utf8")).toBe(rendered.swift);
    expect(await readFile(SEND_COPY_KOTLIN_PATH, "utf8")).toBe(rendered.kotlin);
  });

  test("the Rust core pins the same Krusty release as the extension", async () => {
    const cargo = await readFile("mobile/core/Cargo.toml", "utf8");
    const npmPin = EXPECTED_DEPENDENCIES["@starknetfoundation/krusty-kms-wasm"];
    expect(npmPin).toMatch(/^\d+\.\d+\.\d+$/);
    expect(cargo).toContain(`krusty-kms = { version = "=${npmPin}"`);
    expect(cargo).toContain(`krusty-kms-common = { version = "=${npmPin}"`);
    const lib = await readFile("mobile/core/src/lib.rs", "utf8");
    expect(lib).toContain(`krusty_version: "${npmPin}".into()`);
  });
});

describe("mobile privacy parity", () => {
  test("the committed privacy fixture is what the extension's privacy path does today", async () => {
    for (const [path, part] of await computePrivacyFixture()) {
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual(part);
    }
  });

  test("the privacy copy tables are rendered from the committed fixture", async () => {
    const { copy } = JSON.parse(await readFile(PRIVACY_FIXTURE_PATHS.copy, "utf8")) as {
      readonly copy: Parameters<typeof renderPrivacyCopy>[0];
    };
    expect(copy.mobileOnly).toEqual(PRIVACY_MOBILE_ONLY);
    const rendered = renderPrivacyCopy(copy);
    expect(await readFile(PRIVACY_COPY_SWIFT_PATH, "utf8")).toBe(rendered.swift);
    expect(await readFile(PRIVACY_COPY_KOTLIN_PATH, "utf8")).toBe(rendered.kotlin);
  });

  // The mobile core has no OHTTP client: a network whose routing turns OHTTP on must never be
  // rendered with a URL the core could post the viewing key to in plaintext (docs/privacy.md §1.1).
  test("an OHTTP network gets no mobile routing", () => {
    const base = {
      discoveryUrl: "https://discovery.example",
      poolAddress: "0x1",
      proverUrl: "https://prover.example",
    };
    expect(mobilePrivacyRoutes({ SN_MAIN: { ...base, ohttpEnabled: true } })).toEqual([
      { id: "SN_MAIN", ohttp: true },
    ]);
    expect(
      mobilePrivacyRoutes({ SN_MAIN: { ...base, ohttpRelayUrl: "https://relay.example" } }),
    ).toEqual([{ id: "SN_MAIN", ohttp: true }]);
    expect(mobilePrivacyRoutes({ SN_MAIN: { ...base, ohttpEnabled: false } })).toEqual([
      { discoveryUrl: base.discoveryUrl, id: "SN_MAIN", ohttp: false, poolAddress: "0x1" },
    ]);
  });
});
