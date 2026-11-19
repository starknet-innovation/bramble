/**
 * Held proof requests in the official SDK adapter. The SDK draws new random
 * values on every compile, so an account that collects its signature after
 * compiling (an Argent multisig) must prove the request it compiled, not a
 * fresh one. These pin the two hooks: a resumed request is proved without
 * compiling, and every fresh compile passes through `hold` before proving.
 */
import { describe, expect, test } from "bun:test";
import { WalletError } from "@bramble/core/errors";
import { createOfficialStrk20Service } from "@bramble/privacy/official-sdk-service";
import type { Strk20HeldProofRequest } from "@bramble/privacy/service";
import {
  officialBuilder as builder,
  STRK20_SDK_CONTEXT as context,
  executeResult,
  providerFor,
  sdkRuntime as runtime,
} from "../support/official-sdk";

const proving = () => {
  const proved: { readonly block: number; readonly input: unknown }[] = [];
  let compiles = 0;
  const compiled = {
    invocation: { calldata: ["0x5"], nonce: "0x0", signature: ["0x0"] },
    registry: "registry",
    warnings: [],
  };
  // The builder's chained methods return the builder itself, so the counter
  // is patched onto that object rather than onto a copy.
  const counted = () =>
    Object.assign(builder(compiled), {
      createProofInvocation: async () => {
        compiles += 1;
        return compiled;
      },
    });
  const sdk = runtime(() => ({
    build: counted,
    async discoverNotes() {
      return { notes: new Map() };
    },
    async executeWithInvocation(input: unknown, block: number) {
      proved.push({ block, input });
      return executeResult();
    },
  }));
  return {
    compiles: () => compiles,
    proved,
    service: createOfficialStrk20Service({ providerFor, sdk }),
  };
};

describe("held proof requests", () => {
  test("a resumed request is proved at its own block without compiling", async () => {
    const { compiles, proved, service } = proving();
    const resumed: Strk20HeldProofRequest = {
      invocation: { calldata: ["0x9"], signature: ["0x1", "0x2"] },
      provingBlock: 77,
    };
    await service.prepareRegistration?.({
      ...context,
      heldProof: {
        hold: async () => {
          throw new Error("a resumed request is not compiled, so nothing is held");
        },
        resume: async () => resumed,
      },
      poolFeeFri: "0x0",
    });
    expect(compiles()).toBe(0);
    expect(proved).toHaveLength(1);
    expect(proved[0]?.block).toBe(77);
    expect(proved[0]?.input).toMatchObject({ invocation: resumed.invocation });
  });

  test("a fresh compile passes through hold, and what hold returns is proved", async () => {
    const { compiles, proved, service } = proving();
    const held: Strk20HeldProofRequest[] = [];
    await service.prepareRegistration?.({
      ...context,
      heldProof: {
        hold: async (request) => {
          held.push(request);
          return { ...request, invocation: { ...request.invocation, signature: ["0xa", "0xb"] } };
        },
        resume: async () => null,
      },
      poolFeeFri: "0x0",
    });
    expect(compiles()).toBe(1);
    expect(held).toHaveLength(1);
    expect(held[0]?.invocation["calldata"]).toEqual(["0x5"]);
    expect(proved).toHaveLength(1);
    // Proved at the block the request was compiled for, with the SDK's own
    // registry carried through and the signature hold supplied.
    expect(proved[0]?.block).toBe(held[0]?.provingBlock as number);
    expect(proved[0]?.input).toMatchObject({
      invocation: { calldata: ["0x5"], signature: ["0xa", "0xb"] },
      registry: "registry",
    });
  });

  test("a hold that stops leaves nothing proved", async () => {
    const { proved, service } = proving();
    await expect(
      service.prepareRegistration?.({
        ...context,
        heldProof: {
          hold: async () => {
            throw new WalletError("Waiting for co-owners to authorize this private action.");
          },
          resume: async () => null,
        },
        poolFeeFri: "0x0",
      }),
    ).rejects.toThrow("Waiting for co-owners");
    expect(proved).toHaveLength(0);
  });

  test("an account without the hooks proves its compile directly", async () => {
    const { compiles, proved, service } = proving();
    await service.prepareRegistration?.({ ...context, poolFeeFri: "0x0" });
    expect(compiles()).toBe(1);
    expect(proved[0]?.input).toMatchObject({ invocation: { signature: ["0x0"] } });
  });
});
