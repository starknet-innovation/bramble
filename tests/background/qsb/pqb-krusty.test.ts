/** Actual published Krusty 3.1.0 against the independent SDK two-input assembly vector. */
import { describe, expect, test } from "bun:test";
import { createKrustyKms } from "@bramble/kms-krusty/adapter";
import { isQsbPublicState, qsbVaultRegistration } from "@bramble/qsb/registration";
import { readQsbSolution } from "@bramble/qsb/withdrawal-binding";
import { pqbFixture, pqbSdk } from "../../support/pqb-fixture";

const kms = createKrustyKms(await import("@starknetfoundation/krusty-kms-wasm"));
const vector = await pqbFixture();
const sdk = await pqbSdk();
describe("published PQB capability", () => {
  test("keeps public material and the selected witness byte-compatible with the independent SDK", async () => {
    const pqb =
      kms.pqb ??
      (() => {
        throw new Error("PQB export missing");
      })();
    const material = await pqb.material(vector.mnemonic, vector.index);
    expect(material).toEqual(vector.material);
    expect(sdk.publicState(material)).toBe(vector.publicStateJson);
    expect(isQsbPublicState(vector.publicStateJson)).toBe(true);
    const info = await pqb.prepare(vector.mnemonic, vector.index, vector.prepared);
    expect(info.stageSighashes).toEqual(vector.prepared.sighashes);
    const witness = await pqb.authorize(vector.mnemonic, vector.index, vector.prepared);
    expect(witness).toEqual(vector.witness);
    expect(sdk.finish(material, vector.prepared, witness)).toBe(vector.raw);
  });
  test("accepts a public state only when its round table is the ordered table in its own script", () => {
    expect(sdk.validatePublicState(vector.publicStateJson)).toBe(true);
    const state = JSON.parse(vector.publicStateJson) as { round_table: string[] };
    const swapped = [...state.round_table];
    [swapped[0], swapped[1]] = [swapped[1] ?? "", swapped[0] ?? ""];
    // Still schema-valid (same 9-byte entries, all distinct); only the order no longer matches.
    expect(sdk.validatePublicState(JSON.stringify({ ...state, round_table: swapped }))).toBe(false);
    // A script whose own first table push differs from the shared table is refused outright.
    const [first = "", second = ""] = state.round_table;
    const script = vector.material.script.replace(first, second);
    expect(script).not.toBe(vector.material.script);
    expect(() => sdk.publicState({ ...vector.material, script })).toThrow(
      "PQB round table does not match the ordered table in its locking script.",
    );
  });
  test("rejects changed roots, cross-round reuse and malformed transactions", async () => {
    const pqb =
      kms.pqb ??
      (() => {
        throw new Error("PQB export missing");
      })();
    for (const change of [
      { scriptHash: "00".repeat(32) },
      { round1: [vector.prepared.round0[0] ?? 0, ...vector.prepared.round1.slice(1)] },
      { menus: [12, 0, 0] },
      { transaction: "00" },
    ]) {
      await expect(
        pqb.authorize(vector.mnemonic, vector.index, { ...vector.prepared, ...change }),
      ).rejects.toThrow();
    }
  });
  test("registers only the public PQB state with the upstream protocol identity", () => {
    const body = qsbVaultRegistration({
      id: "11111111-2222-4333-8444-000000000001",
      createdAt: "2026-11-15T12:00:00.000Z",
      owner: "bc1qtest",
      script: {
        publicStateJson: vector.publicStateJson,
        scriptHex: vector.material.script,
        scriptHash: vector.material.scriptSha256,
      },
    });
    expect(body?.["config"]).toBe("PQB");
    expect(body?.["configuration"]).toMatchObject({
      protocol: "pqb-v1",
      generatorCommit: "eccdd09772edf14ab37fc63992b0626ad7ff2221",
    });
    expect(JSON.stringify(body)).not.toContain(vector.mnemonic);
    expect(
      isQsbPublicState(
        JSON.stringify({ ...JSON.parse(vector.publicStateJson), seed: "aa".repeat(32) }),
      ),
    ).toBe(false);
  });
  test("rejects invented hits before a disclosure request can be prepared", () => {
    const solution = readQsbSolution({
      sequence: 0x80000000,
      locktime: 500000000,
      round1: [0, 1, 2, 3, 4, 5, 6, 7],
      round2: [8, 9, 10, 11, 12, 13, 14, 15, 16],
      pqb: {
        pinning: "500000000 2147483648 0 0 0 0",
        round0: "0,1,2,3,4,5,6,7 0 0 0 0",
        round1: "0,1,2,3,4,5,6,7,8 0 0 0 0",
      },
    });
    if (!solution) throw new Error("invalid fixture solution");
    expect(() =>
      sdk.prepare(
        vector.material,
        {
          vaultId: "11111111-2222-4333-8444-000000000001",
          funding: { txid: "cc".repeat(32), vout: 1, value: "250000" },
          helper: { txid: "bb".repeat(32), vout: 0, value: "1000" },
          destination: "bc1qtest",
          outputScript: "0014000102030405060708090a0b0c0d0e0f10111213",
          outputValue: "242000",
          fee: "9000",
          costAccepted: true,
          idempotencyKey: "21111111-2222-4333-8444-000000000001",
          solverReleaseId: "pqb-aws-sm86-v0-1-0",
        },
        solution,
      ),
    ).toThrow();
  });
});
