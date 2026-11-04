/**
 * The vault configuration is qsb-app's own computation: sorted-key JSON over
 * `JSON.parse`'s rounding of the public state's large integers, never an
 * exact-integer canonicalization. The registration body carries the bridge's
 * public state verbatim and refuses one the coordinator would; the reuse scan
 * finds any listed script that pushes a commitment.
 *
 * The real test vault's vector (computed with qsb-app's provenance.ts under
 * Bun) is pinned by `check:qsb` and tests/background/qsb, which run the
 * pinned bridge.
 */
import { describe, expect, test } from "bun:test";
import { qsbCanonical, qsbFingerprint, qsbVaultConfiguration } from "@bramble/qsb/configuration";
import { isQsbPublicState, qsbVaultRegistration } from "@bramble/qsb/registration";
import { pushesAnyCommitment } from "@bramble/qsb/reuse";
import {
  commitmentsFor,
  OWNER,
  scriptFor,
  sha256Hex,
  VAULT_COMMITMENTS,
  VAULT_SCRIPT,
  VAULT_SCRIPT_HASH,
} from "./fixtures";

// The secp256k1 order: 78 digits, far past what a double holds exactly.
const BIG = "115792089237316195423570985008687907852837564279074904382605163141518161494337";

const publicState = (extra = ""): string =>
  `{"config":"A","hash_mode":"sha256","n":150,"pin_r":${BIG},"round_sigs":[{"r":${BIG},"s":1,"sig":"00"}],"hors_commitments":[],"full_script_hex":"${VAULT_SCRIPT}"${extra}}`;

describe("the vault configuration", () => {
  test("canonicalizes with sorted keys and JSON.stringify leaves", () => {
    expect(qsbCanonical({ b: [2, { d: null, c: "x" }], a: true })).toBe(
      '{"a":true,"b":[2,{"c":"x","d":null}]}',
    );
  });

  test("hashes the rounded public state, as qsb-app's JSON.parse does", () => {
    const rounded = sha256Hex(
      `{"config":"A","full_script_hex":"${VAULT_SCRIPT}","hash_mode":"sha256","hors_commitments":[],"n":150,"pin_r":1.157920892373162e+77,"round_sigs":[{"r":1.157920892373162e+77,"s":1,"sig":"00"}]}`,
    );
    const exact = sha256Hex(
      `{"config":"A","full_script_hex":"${VAULT_SCRIPT}","hash_mode":"sha256","hors_commitments":[],"n":150,"pin_r":${BIG},"round_sigs":[{"r":${BIG},"s":1,"sig":"00"}]}`,
    );
    expect(qsbFingerprint(JSON.parse(publicState()))).toBe(rounded);
    expect(rounded).not.toBe(exact);
  });

  test("names the protocol, generator, network and both script hashes", () => {
    expect(
      qsbVaultConfiguration({
        network: "mainnet",
        publicStateJson: publicState(),
        scriptHash: VAULT_SCRIPT_HASH,
        scriptHex: VAULT_SCRIPT,
      }),
    ).toEqual({
      config: "A",
      generatorCommit: "2c9172051d5c150ef0a994ca6b988a08a3ef9e85",
      network: "mainnet",
      protocol: "qsb-config-a-v1",
      publicStateHash: qsbFingerprint(JSON.parse(publicState())),
      scriptBytesHash: VAULT_SCRIPT_HASH,
      scriptHash: VAULT_SCRIPT_HASH,
    });
  });
});

describe("the registration body", () => {
  const script = {
    publicStateJson: publicState(),
    scriptHash: VAULT_SCRIPT_HASH,
    scriptHex: VAULT_SCRIPT,
  };
  const input = {
    createdAt: "2026-11-04T12:00:00.000Z",
    id: "0b6f4d5e-1c2a-4b3d-8e9f-a0b1c2d3e4f5",
    owner: OWNER.address,
    script,
  };

  test("is public data only, with the bridge's own public-state text and no funding", () => {
    const body = qsbVaultRegistration(input);
    expect(body).toEqual({
      config: "A",
      configuration: qsbVaultConfiguration({ ...script, network: "mainnet" }),
      createdAt: input.createdAt,
      id: input.id,
      name: "Bramble vault",
      network: "mainnet",
      paymentAddress: OWNER.address,
      publicStateJson: script.publicStateJson,
      scriptHash: VAULT_SCRIPT_HASH,
      scriptHex: VAULT_SCRIPT,
      status: "unfunded",
    });
    // Round-tripped through the body's JSON, the text is byte-for-byte the bridge's.
    expect(JSON.parse(JSON.stringify(body))["publicStateJson"]).toBe(script.publicStateJson);
  });

  test.each([
    ["a private field", publicState(',"hors_secrets":[]')],
    ["a private round field", publicState().replace('"sig":"00"', '"sig":"00","k":1')],
    ["another configuration", publicState().replace('"config":"A"', '"config":"B"')],
    ["another hash mode", publicState().replace('"sha256"', '"hash160"')],
    ["text that is not JSON", "{"],
    ["a state longer than the coordinator keeps", publicState(`,"t1s":"${"0".repeat(60_000)}"`)],
  ])("refuses %s", (_label, publicStateJson) => {
    expect(isQsbPublicState(publicStateJson)).toBe(false);
    expect(qsbVaultRegistration({ ...input, script: { ...script, publicStateJson } })).toBeNull();
  });
});

describe("the reuse scan", () => {
  test("finds a listed script that pushes any one commitment, in either case", () => {
    const other = commitmentsFor("other");
    const sharing = scriptFor([
      [...(other[0]?.slice(0, 149) ?? []), VAULT_COMMITMENTS[1]?.[42] ?? ""],
      other[1] ?? [],
    ]);
    expect(
      pushesAnyCommitment([{ scriptHash: "", scriptHex: scriptFor(other) }], VAULT_COMMITMENTS),
    ).toBe(false);
    expect(pushesAnyCommitment([{ scriptHash: "", scriptHex: sharing }], VAULT_COMMITMENTS)).toBe(
      true,
    );
    expect(
      pushesAnyCommitment(
        [{ scriptHash: "", scriptHex: sharing.toUpperCase() }],
        VAULT_COMMITMENTS,
      ),
    ).toBe(true);
    expect(pushesAnyCommitment([], VAULT_COMMITMENTS)).toBe(false);
  });
});
