/** Fail-closed module behavior and WASM disposal, independent of native happy-path vectors. */
import { describe, expect, test } from "bun:test";
import type { PqbPrepared, PqbPublicMaterial } from "@bramble/wallet-model/pqb";
import { krustyPqbMethods } from "../src/pqb";

const vector = (await Bun.file(
  new URL("../../../../tests/fixtures/pqb/assembly.json", import.meta.url),
).json()) as {
  readonly material: PqbPublicMaterial;
  readonly prepared: PqbPrepared;
};
const harness = () => {
  const events: string[] = [];
  let brokenMaterial = false,
    brokenInfo = false;
  class Request {
    info() {
      return {
        digest: "00".repeat(32),
        cosigSighash: "00".repeat(32),
        stageSighashes: brokenInfo ? [] : vector.prepared.sighashes,
      };
    }
    dispose() {
      events.push("request dispose");
    }
    free() {
      events.push("request free");
    }
  }
  class Vault {
    static fromMnemonic() {
      events.push("derive");
      return new Vault();
    }
    publicMaterial() {
      return {
        ...vector.material,
        scriptSha256: brokenMaterial ? "00".repeat(32) : vector.material.scriptSha256,
      };
    }
    prepareDisclosure() {
      events.push("prepare");
      return new Request();
    }
    dispose() {
      events.push("vault dispose");
    }
    free() {
      events.push("vault free");
    }
  }
  return {
    events,
    kms: krustyPqbMethods({ WasmPqbVault: Vault }, Promise.resolve()),
    breakMaterial: () => {
      brokenMaterial = true;
    },
    breakInfo: () => {
      brokenInfo = true;
    },
  };
};
describe("PQB adapter refusals", () => {
  test("missing PQB exports never fall back to JavaScript derivation", async () => {
    await expect(
      krustyPqbMethods({}, Promise.resolve()).material("seed words", 0),
    ).rejects.toThrow();
  });
  test("checks the public script hash independently and always disposes its owner", async () => {
    const h = harness();
    h.breakMaterial();
    await expect(h.kms.material("seed words", 0)).rejects.toThrow();
    expect(h.events).toEqual(["derive", "vault dispose", "vault free"]);
  });
  test("malformed or forged request info frees both opaque handles", async () => {
    for (const malformed of [true, false]) {
      const h = harness();
      if (malformed) h.breakInfo();
      await expect(h.kms.prepare("seed words", 0, vector.prepared)).rejects.toThrow();
      expect(h.events).toEqual([
        "derive",
        "prepare",
        "request dispose",
        "request free",
        "vault dispose",
        "vault free",
      ]);
    }
  });
});
