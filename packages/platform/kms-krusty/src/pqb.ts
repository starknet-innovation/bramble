/**
 * PQB WASM boundary. All derivation and signing stay in Krusty; each operation
 * owns and disposes its vault/request. Authorization is deliberately stateless:
 * only the vault service may call it, after its durable journal write.
 */
import { WalletError } from "@bramble/core/errors";
import { bytesToHex, hexToBytes, isLowercaseHexBytes } from "@bramble/core/hex";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import type { PqbDisclosure, PqbKms, PqbRequestInfo } from "@bramble/vault/pqb-kms";
import { qsbTransactionOutpoints } from "@bramble/vault/qsb-transaction";
import { isMnemonicText } from "@bramble/wallet-model/passphrase";
import {
  isPqbSelection,
  PQB_LIMITS,
  type PqbDisclosureRequest,
  type PqbPublicMaterial,
  snapshotPqbRequest,
} from "@bramble/wallet-model/pqb";
import type { WasmPqbRequest, WasmPqbVault } from "@starknetfoundation/krusty-kms-wasm";
import { ownValue } from "./krusty-values";

const bad = (): never => {
  throw new WalletError("Invalid Krusty PQB input or result");
};
const hex = (v: unknown, bytes: number): v is string => isLowercaseHexBytes(v, bytes, bytes);
const strings = (v: unknown, count: number, bytes: number): v is string[] =>
  Array.isArray(v) && v.length === count && [...v].every((x) => hex(x, bytes));
const signature = (v: unknown): v is string =>
  isLowercaseHexBytes(v, 9, 73) && v.startsWith("30") && v.endsWith("01");

const material = (v: unknown): PqbPublicMaterial => {
  if (
    !isRecord(v) ||
    !hasOnlyKnownKeys(v, ["script", "scriptSha256", "commitments", "cosigPublicKey", "menus"]) ||
    !hex(v["script"], PQB_LIMITS.scriptBytes) ||
    !hex(v["scriptSha256"], 32) ||
    !strings(v["commitments"], PQB_LIMITS.table, 20) ||
    new Set(v["commitments"]).size !== PQB_LIMITS.table ||
    !hex(v["cosigPublicKey"], 33) ||
    !/^(02|03)/.test(v["cosigPublicKey"]) ||
    !Array.isArray(v["menus"]) ||
    v["menus"].length !== 3 ||
    !v["menus"].every(
      (m: unknown, i: number) =>
        isRecord(m) &&
        hasOnlyKnownKeys(m, ["r", "commitments", "recoveryPoints"]) &&
        hex(m["r"], 32) &&
        strings(m["commitments"], PQB_LIMITS.menus[i] ?? 0, 20) &&
        Array.isArray(m["recoveryPoints"]) &&
        m["recoveryPoints"].length === (i === 0 ? 2 : 4) &&
        m["recoveryPoints"].every(
          (row: unknown) =>
            strings(row, PQB_LIMITS.menus[i] ?? 0, 65) && row.every((p) => p.startsWith("04")),
        ),
    )
  )
    return bad();
  return v as unknown as PqbPublicMaterial;
};
const info = (v: unknown): PqbRequestInfo => {
  if (
    !isRecord(v) ||
    !hasOnlyKnownKeys(v, ["digest", "cosigSighash", "stageSighashes"]) ||
    !hex(v["digest"], 32) ||
    !hex(v["cosigSighash"], 32) ||
    !strings(v["stageSighashes"], 3, 32)
  )
    return bad();
  return {
    digest: v["digest"],
    cosigSighash: v["cosigSighash"],
    stageSighashes: [...v["stageSighashes"]],
  };
};
const disclosure = (v: unknown): PqbDisclosure => {
  if (
    !isRecord(v) ||
    !hasOnlyKnownKeys(v, ["round0", "round1", "menus", "cosignature"]) ||
    !strings(v["round0"], PQB_LIMITS.round0, 20) ||
    !strings(v["round1"], PQB_LIMITS.round1, 32) ||
    !Array.isArray(v["menus"]) ||
    v["menus"].length !== 3 ||
    !v["menus"].every(signature) ||
    !signature(v["cosignature"])
  )
    return bad();
  return {
    round0: [...v["round0"]],
    round1: [...v["round1"]],
    menus: [...v["menus"]],
    cosignature: v["cosignature"],
  };
};
const sha256 = async (bytes: Uint8Array): Promise<string> =>
  bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)));
// Independent encoding of Krusty's public journal binding, including vault input 1.
const expectedDigest = (r: PqbDisclosureRequest): Promise<string> =>
  sha256(
    Uint8Array.from([
      ...new TextEncoder().encode("krusty/pqb/disclosure/v1\0"),
      ...(hexToBytes(r.scriptHash) ?? []),
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      1,
      ...r.round0,
      ...r.round1,
      ...r.menus,
      ...(hexToBytes(r.transaction) ?? []),
    ]),
  );

const prepared = (vault: WasmPqbVault, r: PqbDisclosureRequest): WasmPqbRequest => {
  if (
    !isPqbSelection(r) ||
    !hex(r.scriptHash, 32) ||
    !isLowercaseHexBytes(r.transaction, 1, 10000) ||
    qsbTransactionOutpoints(r.transaction)?.length !== 2
  )
    return bad();
  return vault.prepareDisclosure(
    r.transaction,
    1,
    r.scriptHash,
    [...r.round0],
    [...r.round1],
    [...r.menus],
  );
};

/** Builds the PQB capability; missing exports fail closed when a PQB operation is requested. */
export const krustyPqbMethods = (
  module: Record<string, unknown>,
  ready: Promise<unknown>,
): PqbKms => {
  const over = async <T>(
    words: string,
    v: number,
    task: (vault: WasmPqbVault) => T,
  ): Promise<T> => {
    await ready;
    if (!isMnemonicText(words) || !Number.isSafeInteger(v) || v < 0 || v >= 2 ** 31) return bad();
    const klass = ownValue(module, "WasmPqbVault");
    const factory =
      typeof klass === "function"
        ? Object.getOwnPropertyDescriptor(klass, "fromMnemonic")?.value
        : undefined;
    if (typeof factory !== "function") return bad();
    const vault = factory(words, v, "main") as WasmPqbVault;
    try {
      return task(vault);
    } finally {
      try {
        vault.dispose();
      } finally {
        vault.free();
      }
    }
  };
  const requestOver = <T>(
    vault: WasmPqbVault,
    r: PqbDisclosureRequest,
    task: (request: WasmPqbRequest) => T,
  ): T => {
    const request = prepared(vault, r);
    try {
      return task(request);
    } finally {
      try {
        request.dispose();
      } finally {
        request.free();
      }
    }
  };
  return {
    material: async (words, v) => {
      const result = await over(words, v, (vault) => material(vault.publicMaterial()));
      if ((await sha256(hexToBytes(result.script) ?? new Uint8Array())) !== result.scriptSha256)
        return bad();
      return result;
    },
    prepare: async (words, v, r) => {
      const snapshot = snapshotPqbRequest(r);
      const result = await over(words, v, (vault) =>
        requestOver(vault, snapshot, (request) => info(request.info())),
      );
      if (result.digest !== (await expectedDigest(snapshot))) return bad();
      return result;
    },
    authorize: (words, v, r) => {
      const snapshot = snapshotPqbRequest(r);
      return over(words, v, (vault) =>
        requestOver(vault, snapshot, (request) => disclosure(vault.authorize(request))),
      );
    },
  };
};
