/**
 * The runtime's two-phase withdrawal assembly. Against a fake interpreter:
 * arguments reach Python only through `qsb_request` (the code run is a
 * constant), `prepare`'s reply is accepted only as its seven fields echoing
 * the request, `finish` takes exactly 15 lowercase preimages and returns only
 * lowercase hex, no refusal quotes a preimage, and the interpreter that ran
 * `finish` is never used again, whatever the outcome. On the pinned pipeline
 * (vendor-gated): the first mainnet withdrawal's own T and bytes, and a
 * solution that does not check out is refused before anything is disclosed.
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createQsbRuntime } from "../../../apps/extension/src/background/qsb/qsb-runtime";
import { mainnetAssemblyFailures } from "../../../scripts/qsb-mainnet-assembly";
import {
  QSB_MAINNET_ASSEMBLY,
  QSB_MAINNET_COMMITMENTS,
  QSB_MAINNET_MANIFEST,
  QSB_MAINNET_PREIMAGES,
  QSB_MAINNET_SOLUTION,
} from "../../../scripts/qsb-mainnet-withdrawal";
import { loadPinnedPyodide } from "../../../scripts/qsb-pyodide";
import { type FakeReplies, fakePython, runtimeDeps } from "../../support/qsb-runtime-harness";

const STATE = JSON.stringify({ config: "A", full_script_hex: "51" });
const MANIFEST = JSON.stringify(QSB_MAINNET_MANIFEST);
const SOLUTION = JSON.stringify(QSB_MAINNET_SOLUTION);
const PREIMAGES = [...QSB_MAINNET_PREIMAGES];

// The reply a correct bridge gives the request it read, with `fields` over it.
const preparedReply =
  (fields: Readonly<Record<string, unknown>> = {}) =>
  ([state, manifest, solution]: readonly string[]): string =>
    JSON.stringify({
      manifest: JSON.parse(manifest ?? "null"),
      publicStateJson: state,
      round0: QSB_MAINNET_ASSEMBLY.round0,
      round1: QSB_MAINNET_ASSEMBLY.round1,
      scriptHash: QSB_MAINNET_ASSEMBLY.scriptHash,
      solution: JSON.parse(solution ?? "null"),
      transaction: QSB_MAINNET_ASSEMBLY.transaction,
      ...fields,
    });

const runtimeWith = (replies: FakeReplies) => {
  const fake = fakePython({
    finish: () => QSB_MAINNET_ASSEMBLY.raw,
    prepare: preparedReply(),
    ...replies,
  });
  const { deps, loads } = runtimeDeps({}, fake);
  return { fake, loads, runtime: createQsbRuntime(deps) };
};

describe("prepare", () => {
  test("hands the three texts over through the request module and returns T and the indices", async () => {
    const { fake, runtime } = runtimeWith({});
    const prepared = await runtime.prepare(STATE, MANIFEST, SOLUTION);
    expect(prepared).toMatchObject({
      round0: QSB_MAINNET_ASSEMBLY.round0,
      round1: QSB_MAINNET_ASSEMBLY.round1,
      scriptHash: QSB_MAINNET_ASSEMBLY.scriptHash,
      transaction: QSB_MAINNET_ASSEMBLY.transaction,
    });
    expect(JSON.parse(prepared.json)).toMatchObject({ publicStateJson: STATE });
    expect(fake.requests.at(-1)).toBe(JSON.stringify([STATE, MANIFEST, SOLUTION]));
    // The code run never carries the request.
    expect(fake.ran.some((code) => code.includes(QSB_MAINNET_SOLUTION.sequence.toString()))).toBe(
      false,
    );
  });

  test.each([
    ["an extra field", preparedReply({ extra: 1 })],
    ["seven round-0 indices", preparedReply({ round0: QSB_MAINNET_ASSEMBLY.round0.slice(1) })],
    ["a repeated round-1 index", preparedReply({ round1: [1, 1, 2, 3, 4, 5, 6] })],
    ["uppercase T", preparedReply({ transaction: QSB_MAINNET_ASSEMBLY.transaction.toUpperCase() })],
    ["a short script hash", preparedReply({ scriptHash: "00" })],
    ["not JSON", () => "{"],
  ])("refuses a reply with %s", async (_label, prepare) => {
    await expect(
      runtimeWith({ prepare }).runtime.prepare(STATE, MANIFEST, SOLUTION),
    ).rejects.toThrow("QSB withdrawal prepare returned an unexpected shape");
  });

  test.each([
    ["another public state", preparedReply({ publicStateJson: "{}" })],
    ["another manifest", preparedReply({ manifest: { ...QSB_MAINNET_MANIFEST, fee: "1" } })],
    ["another solution", preparedReply({ solution: { ...QSB_MAINNET_SOLUTION, locktime: 1 } })],
  ])("refuses a reply for %s", async (_label, prepare) => {
    await expect(
      runtimeWith({ prepare }).runtime.prepare(STATE, MANIFEST, SOLUTION),
    ).rejects.toThrow("QSB withdrawal prepare answered for another withdrawal");
  });

  test("refuses a request that is not three JSON objects, before Python runs", async () => {
    const { fake, loads, runtime } = runtimeWith({});
    const cases: readonly (readonly [string, string, string])[] = [
      ["[]", MANIFEST, SOLUTION],
      [STATE, "{", SOLUTION],
      [STATE, MANIFEST, "7"],
      [STATE, MANIFEST, "x".repeat(1_000_001)],
    ];
    for (const [state, manifest, solution] of cases) {
      await expect(runtime.prepare(state, manifest, solution)).rejects.toThrow(
        "QSB withdrawal request is not a public state, manifest and solution",
      );
    }
    expect([loads(), fake.requests]).toEqual([0, []]);
  });
});

describe("finish", () => {
  test("hands over prepare's own text and the preimages, then drops the interpreter", async () => {
    const { fake, loads, runtime } = runtimeWith({});
    const prepared = await runtime.prepare(STATE, MANIFEST, SOLUTION);
    expect(await runtime.finish(prepared, PREIMAGES)).toBe(QSB_MAINNET_ASSEMBLY.raw);
    expect(fake.requests.at(-1)).toBe(JSON.stringify([prepared.json, JSON.stringify(PREIMAGES)]));
    expect(loads()).toBe(1);
    await runtime.prepare(STATE, MANIFEST, SOLUTION);
    expect(loads()).toBe(2);
  });

  test("drops the interpreter after a failed finish too, and quotes no preimage", async () => {
    const { loads, runtime } = runtimeWith({
      finish: () => {
        throw new Error(`ValueError: preimage ${PREIMAGES[0]} is wrong`);
      },
    });
    const prepared = await runtime.prepare(STATE, MANIFEST, SOLUTION);
    const failure = await runtime.finish(prepared, PREIMAGES).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("QSB withdrawal finish failed");
    await runtime.prepare(STATE, MANIFEST, SOLUTION);
    expect(loads()).toBe(2);
  });

  test.each([
    ["14 preimages", PREIMAGES.slice(1)],
    ["16 preimages", [...PREIMAGES, PREIMAGES[0] ?? ""]],
    ["an uppercase preimage", [PREIMAGES[0]?.toUpperCase() ?? "", ...PREIMAGES.slice(1)]],
    ["a 19-byte preimage", [PREIMAGES[0]?.slice(2) ?? "", ...PREIMAGES.slice(1)]],
  ])("refuses %s before Python runs", async (_label, preimages) => {
    const { fake, runtime } = runtimeWith({});
    const prepared = await runtime.prepare(STATE, MANIFEST, SOLUTION);
    const failure = await runtime.finish(prepared, preimages).catch((error: Error) => error);
    expect((failure as Error).message).toBe("QSB withdrawal finish needs exactly 15 preimages");
    expect(fake.requests).toHaveLength(1);
  });

  test.each([
    ["uppercase hex", () => QSB_MAINNET_ASSEMBLY.raw.toUpperCase()],
    ["an object", () => ({ raw: QSB_MAINNET_ASSEMBLY.raw })],
    ["odd-length hex", () => `${QSB_MAINNET_ASSEMBLY.raw}0`],
  ])("refuses a reply of %s", async (_label, finish) => {
    const { runtime } = runtimeWith({ finish });
    const prepared = await runtime.prepare(STATE, MANIFEST, SOLUTION);
    await expect(runtime.finish(prepared, PREIMAGES)).rejects.toThrow(
      "QSB withdrawal finish returned an unexpected shape",
    );
  });
});

const pyodideRoot = resolve(import.meta.dir, "../../../node_modules/pyodide");
const shipped = resolve(import.meta.dir, "../../../vendor/qsb/public/qsb");

describe.skipIf(!existsSync(`${shipped}/manifest.json`))("the pinned pipeline", () => {
  const pinned = () => {
    const { deps } = runtimeDeps({
      loadInterpreter: () => loadPinnedPyodide(pyodideRoot),
      readFile: async (file) => new Uint8Array(await readFile(`${shipped}/${file}`)),
    });
    return createQsbRuntime(deps);
  };

  test("assembles the first mainnet withdrawal's own T and bytes", async () => {
    expect(await mainnetAssemblyFailures(pinned())).toEqual([]);
  }, 120_000);

  test("refuses a solution whose puzzle does not check out", async () => {
    const runtime = pinned();
    const vault = await runtime.setupFromCommitments(QSB_MAINNET_COMMITMENTS);
    // A bonus index the real search never chose: the round's puzzle fails.
    const wrong = {
      ...QSB_MAINNET_SOLUTION,
      round1: [...QSB_MAINNET_SOLUTION.round1.slice(0, 8), 148],
    };
    await expect(
      runtime.prepare(vault.publicStateJson, MANIFEST, JSON.stringify(wrong)),
    ).rejects.toThrow("QSB withdrawal prepare failed");
  }, 120_000);
});
