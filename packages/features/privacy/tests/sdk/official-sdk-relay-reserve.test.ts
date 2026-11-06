/**
 * A relayed multisig write claims the maturity journal before the paymaster
 * is called. An unreadable answer leaves that claim, and a second send stops.
 */
import { describe, expect, test } from "bun:test";
import {
  memoryStrk20MaturityStore,
  STRK20_PRIOR_WRITE_UNRESOLVED,
} from "@bramble/privacy/maturity";
import { createOfficialStrk20Service } from "@bramble/privacy/official-sdk-service";
import {
  INDETERMINATE_RPC_WRITE_MESSAGE,
  IndeterminateRpcWriteError,
} from "@bramble/starknet/provider";
import {
  STRK20_SDK_ACCOUNT as account,
  officialBuilder as builder,
  executeResult,
  STRK20_POOL_ADDRESS as poolAddress,
  RELAY_WRITE_ONCE_SLOT,
  STRK20_RELAY_CONTEXT as relayContext,
  sdkRuntime as runtime,
  strk20ProviderFor,
} from "../support/official-sdk";

const scope = { accountId: account.id, networkId: account.networkId, poolAddress };

describe("relayed writes are reserved before broadcast", () => {
  test("an indeterminate answer blocks a second broadcast", async () => {
    let broadcasts = 0;
    const maturityStore = memoryStrk20MaturityStore();
    const service = createOfficialStrk20Service({
      http: async () => {
        throw new Error("unused");
      },
      maturityStore,
      nowSeconds: () => 1_000,
      providerFor: strk20ProviderFor(),
      sdk: runtime(() => ({
        build: () => builder(),
        discoverNotes: async () => ({ notes: new Map() }),
        async executeWithInvocation() {
          return executeResult();
        },
      })),
    });
    const send = service.submitAcceptedRelay;
    if (!send) throw new Error("relay claim is not wired");
    await expect(
      send({
        ...relayContext,
        broadcast: async () => {
          broadcasts += 1;
          throw new IndeterminateRpcWriteError(INDETERMINATE_RPC_WRITE_MESSAGE);
        },
        relaySlots: [RELAY_WRITE_ONCE_SLOT],
      }),
    ).rejects.toThrow(INDETERMINATE_RPC_WRITE_MESSAGE);
    expect(await maturityStore.read(scope)).toMatchObject({ state: "submitting" });
    await expect(
      send({
        ...relayContext,
        broadcast: async () => {
          broadcasts += 1;
          return { transactionHash: "0xabc" };
        },
        relaySlots: [RELAY_WRITE_ONCE_SLOT],
      }),
    ).rejects.toThrow(STRK20_PRIOR_WRITE_UNRESOLVED);
    expect(broadcasts).toBe(1);
  });
});
