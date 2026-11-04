/**
 * The QSB runtime adapter's refusals and boot order, against a fake
 * interpreter. The real interpreter and the pinned sources are exercised by
 * `check:qsb` (Bun) and `tests/e2e/qsb-runtime.e2e.ts` (the MV3 worker); here
 * the invariants are the ones a fake can pin exactly: no Python runs before
 * every source matches the manifest, the manifest names exactly the four
 * sources, nothing in the adapter calls a secret-drawing bridge method, and a
 * failed boot is not cached. The commitments setup has its own suite
 * (`qsb-vault-setup.test.ts`).
 */
import { describe, expect, test } from "bun:test";
import {
  createQsbRuntime,
  QSB_MANIFEST,
  QSB_SOURCES,
} from "../../../apps/extension/src/background/qsb/qsb-runtime";
import { QSB_PUBLIC_PROBE_ANSWERS } from "../../../scripts/qsb-known-answers";
import {
  runtimeDeps as deps,
  digest,
  type FakePython,
  fakePython,
  manifestFor,
  pinnedManifest,
  registeredFunction,
  sourceBytes,
} from "../../support/qsb-runtime-harness";

const encoder = new TextEncoder();

describe("QSB runtime integrity", () => {
  test("refuses a source whose digest differs from the manifest, before loading Python", async () => {
    const tampered: Readonly<Record<string, Uint8Array>> = {
      ...sourceBytes,
      "bridge.py": encoder.encode("import os\nos.urandom(20)\n"),
      [QSB_MANIFEST]: pinnedManifest,
    };
    const { deps: wired, loads } = deps({ files: tampered });
    await expect(createQsbRuntime(wired).publicProbe()).rejects.toThrow(
      "QSB source integrity check failed",
    );
    expect(loads()).toBe(0);
  });

  test("refuses a manifest that names a file beyond the four sources", async () => {
    const manifest = manifestFor({
      ...JSON.parse(new TextDecoder().decode(pinnedManifest)),
      "extra.py": digest(encoder.encode("")),
    });
    const { deps: wired, loads } = deps({ files: { ...sourceBytes, [QSB_MANIFEST]: manifest } });
    await expect(createQsbRuntime(wired).publicProbe()).rejects.toThrow(
      "QSB source manifest does not list exactly the pinned sources",
    );
    expect(loads()).toBe(0);
  });

  test("refuses a manifest missing a source or carrying a malformed digest", async () => {
    const entries = JSON.parse(new TextDecoder().decode(pinnedManifest)) as Record<string, string>;
    const { "bridge.py": _omitted, ...missing } = entries;
    for (const manifest of [
      manifestFor(missing),
      manifestFor({ ...entries, "bridge.py": entries["bridge.py"]?.toUpperCase() }),
      encoder.encode("not json"),
    ]) {
      const { deps: wired, loads } = deps({ files: { ...sourceBytes, [QSB_MANIFEST]: manifest } });
      await expect(createQsbRuntime(wired).publicProbe()).rejects.toThrow("QSB source manifest");
      expect(loads()).toBe(0);
    }
  });
});

describe("QSB runtime boot", () => {
  test("writes the verified sources in qsb-app's order, then starts the bridge and probes", async () => {
    const fake = fakePython();
    const { deps: wired } = deps({}, fake);
    expect(await createQsbRuntime(wired).publicProbe()).toEqual(QSB_PUBLIC_PROBE_ANSWERS);
    expect(fake.written).toEqual([...QSB_SOURCES]);
    expect([...fake.registered.keys()]).toEqual(["qsb_hash", "qsb_request"]);
    expect(fake.ran[0]).toContain("import bridge");
    expect(fake.ran[0]?.indexOf("import secp256k1")).toBeLessThan(
      fake.ran[0]?.indexOf("import bridge") ?? -1,
    );
  });

  test("never calls a bridge method that draws or holds HORS secrets", async () => {
    const fake = fakePython();
    const { deps: wired } = deps({}, fake);
    const runtime = createQsbRuntime(wired);
    await runtime.publicProbe();
    await runtime.publicProbe();
    for (const code of fake.ran) {
      expect(code).not.toMatch(/\b(?:generate|setup|adopt|validate|assemble)\s*\(/);
      expect(code).not.toContain("urandom");
    }
  });

  test("boots one interpreter for concurrent callers and reuses it", async () => {
    const fake = fakePython();
    const { deps: wired, loads } = deps({}, fake);
    const runtime = createQsbRuntime(wired);
    await Promise.all([runtime.publicProbe(), runtime.publicProbe()]);
    await runtime.publicProbe();
    expect(loads()).toBe(1);
    expect(fake.written).toHaveLength(QSB_SOURCES.length);
  });

  test("forgets a failed boot so the next call starts a fresh interpreter", async () => {
    const fake = fakePython();
    let attempts = 0;
    const { deps: wired } = deps(
      {
        loadInterpreter: async () => {
          attempts += 1;
          if (attempts === 1) {
            throw new Error("wasm compile failed");
          }
          return fake.python;
        },
      },
      fake,
    );
    const runtime = createQsbRuntime(wired);
    await expect(runtime.publicProbe()).rejects.toThrow("QSB interpreter failed to load");
    expect(await runtime.publicProbe()).toEqual(QSB_PUBLIC_PROBE_ANSWERS);
    expect(attempts).toBe(2);
  });

  test("refuses a probe result of the wrong shape", async () => {
    for (const output of [
      null,
      "not json",
      JSON.stringify({ ...QSB_PUBLIC_PROBE_ANSWERS, sha256dEmpty: "00" }),
      JSON.stringify({ ...QSB_PUBLIC_PROBE_ANSWERS, validSmallR: [0] }),
      JSON.stringify({ ...QSB_PUBLIC_PROBE_ANSWERS, hash160Empty: "00".repeat(32) }),
    ]) {
      const { deps: wired } = deps({}, fakePython({ probe: output }));
      await expect(createQsbRuntime(wired).publicProbe()).rejects.toThrow(
        "QSB public probe returned an unexpected shape",
      );
    }
  });
});

describe("QSB HASH160 bridge", () => {
  const ripemdOf = (fake: FakePython): ((hex: string) => unknown) =>
    registeredFunction(fake, "qsb_hash", "ripemd") as (hex: string) => unknown;

  test("passes bytes to the injected provider and returns its digest as hex", async () => {
    const fake = fakePython();
    const seen: string[] = [];
    const { deps: wired } = deps(
      {
        ripemd160: (bytes) => {
          seen.push(Buffer.from(bytes).toString("hex"));
          return new Uint8Array(20).fill(0xab);
        },
      },
      fake,
    );
    await createQsbRuntime(wired).publicProbe();
    expect(ripemdOf(fake)("00ff")).toBe("ab".repeat(20));
    expect(seen).toEqual(["00ff"]);
    expect(() => ripemdOf(fake)("0g")).toThrow("QSB hash input is not lowercase hex");
    expect(() => ripemdOf(fake)("00F")).toThrow("QSB hash input is not lowercase hex");
  });

  test("the worker's provider is RIPEMD-160: the published vectors, through the bridge", async () => {
    const fake = fakePython();
    const { deps: wired } = deps({}, fake);
    await createQsbRuntime(wired).publicProbe();
    // Dobbertin, Bosselaers and Preneel's test vectors for "" and "abc".
    expect(ripemdOf(fake)("")).toBe("9c1185a5c5e9fc54612808977ee8f548b2258d31");
    expect(ripemdOf(fake)("616263")).toBe("8eb208f7e05d987a9b044a8e98c6b087f15a0bfc");
    // HASH160 of the empty string, as setup computes it for every HORS slot.
    expect(ripemdOf(fake)(digest(new Uint8Array()))).toBe(QSB_PUBLIC_PROBE_ANSWERS.hash160Empty);
  });
});
