/**
 * Official privacy-SDK registration discovery tests. These isolate the public
 * pool reads from proof/submission coverage so both trust boundaries remain
 * reviewable and below the repository file-size ceiling.
 */
import { describe, expect, test } from "bun:test";
import { createOfficialStrk20Service } from "@bramble/privacy/official-sdk-service";
import { STARK_FIELD_PRIME } from "@bramble/wallet-model/networks";
import type { RpcProvider } from "starknet";
import {
  STRK20_SDK_ACCOUNT as account,
  officialBuilder as builder,
  STRK20_SDK_CONTEXT as context,
  executeResult,
  providerFor,
  sdkRuntime as runtime,
  strk20ProviderFor,
  STRK20_SDK_TOKEN as token,
} from "../support/official-sdk";

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

  test("registration opens the account's own channel alongside the viewing key", async () => {
    // The pinned SDK warns (`USER_LINKAGE`) when one batch opens more than one
    // channel, and the wallet refuses on any warning. A registration that left
    // the self channel unopened made the account's first shield to another
    // wallet need two channels at once, so it always failed as a privacy leak.
    const seen: unknown[] = [];
    const sdk = runtime(() => ({
      build: (options: unknown) => {
        seen.push(options);
        return builder(executeResult());
      },
      async discoverNotes() {
        return { notes: new Map() };
      },
      executeWithInvocation: async () => executeResult(),
    }));
    const service = createOfficialStrk20Service({ providerFor, sdk });

    await service.prepareRegistration?.({ ...context, poolFeeFri: "0x0" });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ autoRegister: false, autoSetup: true });
  });

  test("invokes SDK discovery on its receiver rather than detached", async () => {
    // The real SDK is a class:
    //   discoverRequirement(t,n){ return this.discoveryProvider.discoverRequirement(this.user, …) }
    // A plain-object fake whose method closes over its answer cannot notice a
    // detached call, which is exactly how a receiver-less invocation shipped: it
    // threw "Cannot read properties of undefined (reading 'discoveryProvider')"
    // before any request, and that TypeError matches no error marker, so the
    // only thing the user ever saw was the bare "strk20 services unavailable".
    class Transfers {
      public readonly discoveryProvider = { requirement: 3 };
      public build() {
        return builder(executeResult());
      }
      public async discoverNotes() {
        return { notes: new Map() };
      }
      public async discoverRequirement(recipient: string, selectedToken: string) {
        expect(recipient).toBe(account.address);
        expect(selectedToken).toBe(token);
        // Fails with a TypeError when called without its receiver.
        return this.discoveryProvider.requirement;
      }
      public async executeWithInvocation() {
        return executeResult();
      }
    }
    const sdk = runtime(() => new Transfers());
    const service = createOfficialStrk20Service({ providerFor, sdk });

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
});
