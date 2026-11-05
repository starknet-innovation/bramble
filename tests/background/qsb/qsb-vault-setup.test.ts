/**
 * The QSB runtime's commitments-only vault setup: every refusal of a malformed
 * commitment list happens before an interpreter loads; the list reaches Python
 * only through the `qsb_request` module, never inside Python source; calls
 * cannot read each other's request; and the bridge's reply is accepted only
 * when its shape, its script hash, and its public state all hold.
 *
 * The fixture is the QSB BIP test vault, checked against the BIP's root
 * vector here. Its known answer runs on the real interpreter and the pinned
 * sources wherever `vendor:qsb` has run (always under `bun run check`, whose
 * `check:qsb` refuses a missing checkout before the tests start).
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { qsbVaultConfiguration } from "@bramble/qsb/configuration";
import { createQsbRuntime } from "../../../apps/extension/src/background/qsb/qsb-runtime";
import {
  QSB_MAX_JSON_TEXT,
  readQsbCommitmentRequest,
} from "../../../apps/extension/src/background/qsb/qsb-vault-setup";
import {
  QSB_TEST_VAULT_COMMITMENTS,
  QSB_TEST_VAULT_ROOT,
  QSB_TEST_VAULT_SETUP,
} from "../../../scripts/qsb-known-answers";
import { loadPinnedPyodide } from "../../../scripts/qsb-pyodide";
import {
  commitmentsFor,
  digest,
  FAKE_SCRIPT,
  fakePython,
  registeredFunction,
  runtimeDeps,
  vaultReply,
} from "../../support/qsb-runtime-harness";

const VAULT = QSB_TEST_VAULT_COMMITMENTS.map((round) => [...round]);
const VAULT_JSON = JSON.stringify(VAULT);

const replaced = (r: number, i: number, value: unknown): unknown[][] =>
  VAULT.map((round, ri) => round.map((c, ci) => (ri === r && ci === i ? value : c)));

const setupWith = (setup: (requestJson: string) => unknown) => {
  const fake = fakePython({ setup });
  const { deps, loads } = runtimeDeps({}, fake);
  return { fake, loads, runtime: createQsbRuntime(deps) };
};

describe("QSB test vault fixture", () => {
  test("is the BIP test vault: its root is R(net=0, v=0) and its first commitment the BIP's", () => {
    const flat = Buffer.from(VAULT.flat().join(""), "hex");
    expect(flat).toHaveLength(300 * 20);
    expect(digest(Buffer.concat([Buffer.from("QSB-HORS-v1/root"), flat]))).toBe(
      QSB_TEST_VAULT_ROOT,
    );
    expect(VAULT[0]?.[0]).toBe("887b040fb41eb3cf514e3bd63986f08697b943c4");
    expect(readQsbCommitmentRequest(VAULT).json).toBe(VAULT_JSON);
  });
});

describe("QSB commitments request", () => {
  const refusals: readonly (readonly [string, unknown])[] = [
    ["QSB commitments are not 2 rounds of 150", undefined],
    ["QSB commitments are not 2 rounds of 150", VAULT_JSON],
    ["QSB commitments are not 2 rounds of 150", [VAULT[0]]],
    ["QSB commitments are not 2 rounds of 150", [...VAULT, commitmentsFor("third")[0]]],
    ["QSB commitments are not 2 rounds of 150", [VAULT[0], VAULT[1]?.slice(1)]],
    ["QSB commitments are not 2 rounds of 150", [VAULT[0], [...(VAULT[1] ?? []), "00".repeat(20)]]],
    ["QSB commitments are not 2 rounds of 150", VAULT.flat()],
    ["QSB commitments are not 2 rounds of 150", { 0: VAULT[0], 1: VAULT[1], length: 2 }],
    [
      "QSB commitment is not 20 bytes of lowercase hex",
      replaced(1, 3, VAULT[1]?.[3]?.toUpperCase()),
    ],
    ["QSB commitment is not 20 bytes of lowercase hex", replaced(0, 7, VAULT[0]?.[7]?.slice(2))],
    ["QSB commitment is not 20 bytes of lowercase hex", replaced(0, 7, `${VAULT[0]?.[7]}00`)],
    [
      "QSB commitment is not 20 bytes of lowercase hex",
      replaced(0, 7, `0x${VAULT[0]?.[7]?.slice(2)}`),
    ],
    ["QSB commitment is not 20 bytes of lowercase hex", replaced(0, 7, 7)],
    ["QSB commitment is not 20 bytes of lowercase hex", replaced(0, 0, null)],
    // A sparse round: its holes read as `undefined`, never skipped.
    ["QSB commitment is not 20 bytes of lowercase hex", [VAULT[0], new Array(150)]],
    ["QSB commitment repeats", replaced(1, 0, VAULT[0]?.[0])],
    ["QSB commitment repeats", replaced(0, 149, VAULT[0]?.[148])],
  ];

  test("refuses every list but 2 rounds of 150 distinct lowercase commitments, before booting", async () => {
    for (const [message, commitments] of refusals) {
      const { fake, loads, runtime } = setupWith(vaultReply);
      await expect(
        runtime.setupFromCommitments(commitments as readonly (readonly string[])[]),
      ).rejects.toThrow(message);
      expect(loads()).toBe(0);
      expect(fake.ran).toEqual([]);
    }
  });

  test("an outer hole is a missing round, not a skipped one", () => {
    const sparse = [VAULT[0], VAULT[1]];
    delete sparse[0];
    expect(() => readQsbCommitmentRequest(sparse)).toThrow(
      "QSB commitments are not 2 rounds of 150",
    );
  });
});

describe("QSB commitments setup", () => {
  test("hands the bridge the request through qsb_request and returns its checked reply", async () => {
    const { fake, runtime } = setupWith(vaultReply);
    const vault = await runtime.setupFromCommitments(VAULT);
    expect(vault).toEqual(JSON.parse(vaultReply(VAULT_JSON)));
    expect(Object.keys(vault).sort()).toEqual(["publicStateJson", "scriptHash", "scriptHex"]);
    expect(fake.requests).toEqual([VAULT_JSON]);
    const setupCode = fake.ran.at(-1) ?? "";
    expect(setupCode).toContain("bridge.setup_from_commitments(qsb_request.commitments_json())");
    // No commitment, and no JSON text at all, is ever part of Python source,
    // and no bridge call that draws or holds HORS secrets runs.
    for (const code of fake.ran) {
      for (const commitment of VAULT.flat()) expect(code).not.toContain(commitment);
      expect(code).not.toContain("[[");
      expect(code).not.toMatch(/\b(?:generate|setup|adopt|validate|assemble|prepare|finish)\s*\(/);
      expect(code).not.toContain("urandom");
    }
  });

  test("sends the list as it was when called, whatever the caller does afterwards", async () => {
    const { fake, runtime } = setupWith(vaultReply);
    const mine = VAULT.map((round) => [...round]);
    const pending = runtime.setupFromCommitments(mine);
    mine[0]?.reverse();
    mine.pop();
    await pending;
    expect(fake.requests).toEqual([VAULT_JSON]);
  });

  test("a request is read once, only by the call that set it", async () => {
    const { fake, runtime } = setupWith((request) => {
      expect(() => registeredFunction(fake, "qsb_request", "commitments_json")()).toThrow(
        "QSB runtime has no request in progress",
      );
      return vaultReply(request);
    });
    await runtime.setupFromCommitments(VAULT);
    expect(() => registeredFunction(fake, "qsb_request", "commitments_json")()).toThrow(
      "QSB runtime has no request in progress",
    );
  });

  test("concurrent calls run one at a time and each gets the vault it asked for", async () => {
    const { fake, loads, runtime } = setupWith(vaultReply);
    const other = commitmentsFor("concurrent");
    const [first, probe, second] = await Promise.all([
      runtime.setupFromCommitments(VAULT),
      runtime.publicProbe(),
      runtime.setupFromCommitments(other),
    ]);
    expect(JSON.parse(first.publicStateJson).hors_commitments).toEqual(VAULT);
    expect(JSON.parse(second.publicStateJson).hors_commitments).toEqual(other);
    expect(probe.hash160Empty).toHaveLength(40);
    expect(fake.requests).toEqual([VAULT_JSON, JSON.stringify(other)]);
    expect(loads()).toBe(1);
  });

  test("a failed call leaves no request behind and does not block the next", async () => {
    let calls = 0;
    const { runtime } = setupWith((request) => {
      calls += 1;
      if (calls === 1) {
        throw new Error("Traceback (most recent call last): ValueError: a commitment repeats");
      }
      return vaultReply(request);
    });
    const failed = runtime.setupFromCommitments(VAULT).catch((error: unknown) => error);
    const next = runtime.setupFromCommitments(VAULT);
    const error = (await failed) as Error;
    expect(error.message).toBe("QSB commitments setup failed");
    expect(error.message).not.toContain("Traceback");
    expect((await next).scriptHex).toBe(FAKE_SCRIPT);
  });
});

describe("QSB commitments setup reply", () => {
  const shape = "QSB commitments setup returned an unexpected shape";
  const hash = "QSB vault script does not match its hash";
  const state = "QSB public state does not match the requested vault";
  const otherScript = `${FAKE_SCRIPT.slice(0, -2)}87`;
  const cases: readonly (readonly [string, (request: string) => unknown])[] = [
    [shape, () => undefined],
    [shape, () => 42],
    [shape, () => "not json"],
    [shape, (request) => `[${vaultReply(request)}]`],
    [shape, (request) => vaultReply(request, { extra: 1 })],
    [shape, (request) => vaultReply(request, { scriptHash: undefined })],
    [shape, (request) => vaultReply(request, { publicStateJson: { hors_commitments: [] } })],
    [
      shape,
      (request) => vaultReply(request, { publicStateJson: "x".repeat(QSB_MAX_JSON_TEXT + 1) }),
    ],
    [shape, (request) => vaultReply(request, { scriptHex: "" })],
    [shape, (request) => vaultReply(request, { scriptHex: FAKE_SCRIPT.toUpperCase() })],
    [shape, (request) => vaultReply(request, { scriptHex: `${FAKE_SCRIPT}0` })],
    [shape, (request) => vaultReply(request, { scriptHex: "51".repeat(10_001) })],
    [shape, (request) => vaultReply(request, { scriptHash: digest(FAKE_SCRIPT).toUpperCase() })],
    [shape, (request) => vaultReply(request, { scriptHash: `sha256:${digest(FAKE_SCRIPT)}` })],
    // The hash of the hex text rather than of the script bytes.
    [hash, (request) => vaultReply(request, { scriptHash: digest(FAKE_SCRIPT) })],
    [hash, (request) => vaultReply(request, { scriptHex: otherScript })],
    [state, (request) => vaultReply(request, { publicStateJson: "not json" })],
    [state, (request) => vaultReply(request, { publicStateJson: "[]" })],
    [state, (request) => vaultReply(request, {}, { hors_commitments: undefined })],
    [
      state,
      (request) =>
        vaultReply(request, {}, { hors_commitments: [...JSON.parse(request)].reverse() }),
    ],
    [state, () => vaultReply(JSON.stringify(commitmentsFor("someone else")))],
    [state, (request) => vaultReply(request, {}, { full_script_hex: otherScript })],
  ];

  test("refuses each mismatch with a fixed message that quotes nothing it was given", async () => {
    for (const [message, reply] of cases) {
      const { runtime } = setupWith(reply);
      const error = (await runtime.setupFromCommitments(VAULT).catch((e: unknown) => e)) as Error;
      expect(error.message).toBe(message);
      expect(error.cause).toBeUndefined();
    }
  });

  test("a public state of exactly the bridge's limit is accepted", async () => {
    const { runtime } = setupWith((request) => {
      const text = JSON.parse(vaultReply(request)).publicStateJson as string;
      const padded = `${text.slice(0, -1)},"pad":"${"x".repeat(QSB_MAX_JSON_TEXT - text.length - 9)}"}`;
      expect(padded).toHaveLength(QSB_MAX_JSON_TEXT);
      return vaultReply(request, { publicStateJson: padded });
    });
    expect((await runtime.setupFromCommitments(VAULT)).publicStateJson).toHaveLength(
      QSB_MAX_JSON_TEXT,
    );
  });
});

const pyodideRoot = resolve(import.meta.dir, "../../../node_modules/pyodide");
const shipped = resolve(import.meta.dir, "../../../vendor/qsb/public/qsb");

describe.skipIf(!existsSync(`${shipped}/manifest.json`))(
  "QSB commitments setup on the pinned pipeline",
  () => {
    test("returns the test vault's known answers", async () => {
      const { deps } = runtimeDeps({
        loadInterpreter: () => loadPinnedPyodide(pyodideRoot),
        readFile: async (file) => new Uint8Array(await readFile(`${shipped}/${file}`)),
      });
      const vault = await createQsbRuntime(deps).setupFromCommitments(VAULT);
      expect(vault.scriptHash).toBe(QSB_TEST_VAULT_SETUP.scriptHash);
      expect(vault.scriptHex).toHaveLength(QSB_TEST_VAULT_SETUP.scriptBytes * 2);
      expect(digest(vault.publicStateJson)).toBe(QSB_TEST_VAULT_SETUP.publicStateSha256);
      // The configuration fingerprint qsb-app's own provenance.ts computes.
      expect(qsbVaultConfiguration({ ...vault, network: "mainnet" }).publicStateHash).toBe(
        QSB_TEST_VAULT_SETUP.publicStateHash,
      );
    }, 60_000);
  },
);
