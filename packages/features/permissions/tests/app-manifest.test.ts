/**
 * The admission manifest comparison (mc-wallet issue 749): a served manifest
 * passes only when it declares the listing's name, networks and contracts.
 */
import { describe, expect, test } from "bun:test";
import type { ListedApp } from "@bramble/permissions/app-directory";
import { appManifestMismatches } from "@bramble/permissions/app-manifest";

const app: ListedApp = {
  audit: "https://audits.example.org/dex.pdf",
  category: "defi",
  chains: { SN_MAIN: { contracts: ["0x123", "0x456"] }, SN_SEPOLIA: { contracts: ["0x789"] } },
  id: "example-dex",
  name: "Example DEX",
  origin: "https://app.example.com",
};

const manifest = {
  chains: { SN_MAIN: { contracts: ["0x456", "0x0123"] }, SN_SEPOLIA: { contracts: ["0x789"] } },
  name: "Example DEX",
};

describe("appManifestMismatches", () => {
  test("a manifest matching the listing passes, in any order and felt spelling", () => {
    expect(appManifestMismatches(app, manifest)).toEqual([]);
  });

  test("a different name, network set or contract set is a mismatch", () => {
    expect(appManifestMismatches(app, { ...manifest, name: "Example" }).join()).toContain(
      "name is",
    );
    expect(
      appManifestMismatches(app, {
        ...manifest,
        chains: { SN_MAIN: manifest.chains.SN_MAIN },
      }).join(),
    ).toContain("networks are SN_MAIN, listed as SN_MAIN, SN_SEPOLIA");
    expect(
      appManifestMismatches(app, {
        ...manifest,
        chains: { ...manifest.chains, SN_MAIN: { contracts: ["0x123", "0x456", "0x999"] } },
      }).join(),
    ).toContain("SN_MAIN contracts differ");
  });

  test("a key that spells the listed network set is not those networks", () => {
    const spelled = {
      chains: { "SN_MAIN, SN_SEPOLIA": { contracts: ["nope"] } },
      name: "Example DEX",
    };
    expect(appManifestMismatches(app, spelled).join()).toContain("networks are");
  });

  test("anything not in the expected shape fails rather than being skipped", () => {
    expect(appManifestMismatches(app, null)).toHaveLength(1);
    expect(appManifestMismatches(app, [])).toHaveLength(1);
    expect(appManifestMismatches(app, { ...manifest, extra: true })).toHaveLength(1);
    expect(appManifestMismatches(app, { ...manifest, chains: [] }).join()).toContain(
      "chains must be an object",
    );
    expect(
      appManifestMismatches(app, {
        ...manifest,
        chains: { ...manifest.chains, SN_SEPOLIA: { contracts: ["nope"] } },
      }).join(),
    ).toContain("SN_SEPOLIA contracts must be a list of felts");
    expect(
      appManifestMismatches(app, {
        ...manifest,
        chains: { ...manifest.chains, SN_SEPOLIA: { contracts: ["0x789"], extra: 1 } },
      }).join(),
    ).toContain("SN_SEPOLIA contracts must be a list of felts");
  });
});
