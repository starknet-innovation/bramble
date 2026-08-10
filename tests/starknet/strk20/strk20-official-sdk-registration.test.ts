/**
 * Official privacy-SDK registration tests: the public pool reads, and the
 * builder configuration registration is created with. These isolate both from
 * proof/submission coverage so every trust boundary stays reviewable and below
 * the repository file-size ceiling.
 */
import { describe, expect, test } from "bun:test";
import type { RpcProvider } from "starknet";
import { STARK_FIELD_PRIME } from "../../../src/starknet/networks";
import { createOfficialStrk20Service } from "../../../src/starknet/strk20/official-sdk-service";
import {
  STRK20_SDK_ACCOUNT as account,
  officialBuilder as builder,
  STRK20_SDK_CONTEXT as context,
  executeResult,
  providerFor,
  sdkRuntime as runtime,
  strk20ProviderFor,
  STRK20_SDK_TOKEN as token,
} from "../../support/strk20-official-sdk";

describe("official STRK20 SDK registration discovery", () => {
  test("discovers account registration using the SDK setup requirement enum", async () => {
    let requirement = 0;
    const sdk = runtime(() => ({
      build: () => builder(executeResult()),
      async discoverNotes() {
        return { notes: new Map() };
      },
      async discoverRequirement(recipient, selectedToken) {
        expect(recipient).toBe(account.address);
        expect(selectedToken).toBe(token);
        return requirement;
      },
      executeWithInvocation: async () => executeResult(),
    }));
    const service = createOfficialStrk20Service({ providerFor, sdk });

    await expect(service.registrationStatus?.({ ...context, token })).resolves.toBe("unregistered");
    requirement = 3;
    await expect(service.registrationStatus?.({ ...context, token })).resolves.toBe("registered");
  });

  test("reads a recipient from the pool, never from the setup requirement", async () => {
    const subject = "0x5234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
    const sdk = runtime(() => ({
      build: () => builder(executeResult()),
      async discoverNotes() {
        return { notes: new Map() };
      },
      async discoverRequirement() {
        throw new Error("recipient registration must not come from the setup requirement");
      },
      executeWithInvocation: async () => executeResult(),
    }));
    const statusFrom = (publicKey: string) =>
      createOfficialStrk20Service({
        providerFor: strk20ProviderFor({ publicKey }),
        sdk,
      }).registrationStatus?.({ ...context, subject, token });

    await expect(statusFrom("0x77")).resolves.toBe("registered");
    await expect(statusFrom("0x0")).resolves.toBe("unregistered");
  });

  test("fails closed when the pool cannot answer for a recipient", async () => {
    const sdk = runtime(() => ({
      build: () => builder(executeResult()),
      async discoverNotes() {
        return { notes: new Map() };
      },
      executeWithInvocation: async () => executeResult(),
    }));
    const service = createOfficialStrk20Service({
      providerFor: () =>
        ({
          callContract: async () => {
            throw new Error("node down");
          },
        }) as unknown as RpcProvider,
      sdk,
    });
    await expect(
      service.registrationStatus?.({
        ...context,
        subject: "0x5234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
        token,
      }),
    ).rejects.toThrow("could not read pool registration");
  });

  test("rejects negative and out-of-field pool registration keys", async () => {
    const sdk = runtime(() => ({
      build: () => builder(executeResult()),
      async discoverNotes() {
        return { notes: new Map() };
      },
      executeWithInvocation: async () => executeResult(),
    }));
    const statusFrom = (publicKey: string) =>
      createOfficialStrk20Service({
        providerFor: strk20ProviderFor({ publicKey }),
        sdk,
      }).registrationStatus?.({ ...context, subject: "0x123", token });

    await expect(statusFrom("-1")).rejects.toThrow("out-of-field public key");
    await expect(statusFrom(`0x${STARK_FIELD_PRIME.toString(16)}`)).rejects.toThrow(
      "out-of-field public key",
    );
  });

  // Every batch needs the sender's own channel. Registering without it defers
  // that channel to whatever the account does next, and a private send to
  // someone else then opens two channels in one batch — which the SDK reports as
  // USER_LINKAGE and this wallet refuses, stranding the account one step after
  // it paid to register. Registration is also the only free place to open it:
  // that transaction already names this address publicly.
  test("registration opens the account's own channel in the same batch", async () => {
    const options: unknown[] = [];
    const sdk = runtime(() => ({
      build: (value: unknown) => {
        options.push(value);
        return builder(executeResult());
      },
      async discoverNotes() {
        return { notes: new Map() };
      },
      executeWithInvocation: async () => executeResult(),
    }));
    const service = createOfficialStrk20Service({
      providerFor,
      sdk,
      async submitInvoke(input) {
        return { calls: input.calls, transactionHash: "0xabc" };
      },
    });

    await expect(service.register?.({ ...context, poolFeeFri: "0x0" })).resolves.toEqual({
      transactionHash: "0xabc",
    });
    expect(options).toEqual([expect.objectContaining({ autoRegister: false, autoSetup: true })]);
  });
});
