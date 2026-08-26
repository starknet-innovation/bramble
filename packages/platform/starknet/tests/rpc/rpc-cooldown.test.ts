/** RPC refusal cooldown and pre-submission error boundary checks. */
import { describe, expect, test } from "bun:test";
import {
  RPC_REFUSED_MESSAGE,
  RpcRefusedError,
  timedRpcFetch,
  withRpcFallback,
  withRpcWrite,
} from "@mc-wallet/starknet/rpc";
import { RpcTransportError } from "@mc-wallet/starknet/rpc-transport";
import type { RpcProvider } from "starknet";

describe("RPC endpoint cooldown", () => {
  test("retains Retry-After from an HTTP 429 without reading its body", async () => {
    let releaseCancellation = (): void => undefined;
    let settled = false;
    const body = new ReadableStream({
      cancel: () =>
        new Promise<void>((resolve) => {
          releaseCancellation = resolve;
        }),
    });
    const pending = timedRpcFetch(
      1_000,
      async () =>
        new Response(body, {
          headers: { "retry-after": "45" },
          status: 429,
        }),
    )("https://selected.example", {}).catch((error: unknown) => {
      settled = true;
      return error;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseCancellation();
    const rejection = await pending;

    expect(settled).toBe(true);
    expect(rejection).toBeInstanceOf(RpcRefusedError);
    expect((rejection as RpcRefusedError).retryAfter).toBe("45");
  });

  test("honors Retry-After without probing a sole cooling endpoint", async () => {
    let currentTime = 0;
    let wallClock = Date.parse("2026-08-25T10:00:00.000Z");
    let attempts = 0;
    const read = () =>
      withRpcFallback(
        ["https://rate-limited-cooldown.example"],
        async () => {
          attempts += 1;
          throw new RpcRefusedError(RPC_REFUSED_MESSAGE, "Tue, 25 Aug 2026 10:01:00 GMT");
        },
        () => ({}) as RpcProvider,
        () => currentTime,
        () => wallClock,
      );

    await expect(read()).rejects.toBeInstanceOf(RpcRefusedError);
    await expect(read()).rejects.toThrow("temporarily unavailable");
    expect(attempts).toBe(1);

    currentTime += 60_000;
    wallClock += 60_000;
    await expect(read()).rejects.toBeInstanceOf(RpcRefusedError);
    expect(attempts).toBe(2);
  });

  test("does not downgrade or clear a concurrent rate-limit cooldown", async () => {
    const nodeUrl = "https://concurrent-cooldown.example";
    let releaseTransport = (): void => undefined;
    let releaseSuccess = (): void => undefined;
    let probes = 0;
    const refused = withRpcFallback(
      [nodeUrl],
      async () => {
        await Promise.resolve();
        throw new RpcRefusedError(RPC_REFUSED_MESSAGE, "60");
      },
      () => ({}) as RpcProvider,
      () => 1_000,
    );
    const transport = withRpcFallback(
      [nodeUrl],
      () =>
        new Promise<never>((_resolve, reject) => {
          releaseTransport = () => reject(new RpcTransportError("offline"));
        }),
      () => ({}) as RpcProvider,
      () => 1_000,
    );
    const success = withRpcFallback(
      [nodeUrl],
      () =>
        new Promise<void>((resolve) => {
          releaseSuccess = resolve;
        }),
      () => ({}) as RpcProvider,
      () => 1_000,
    );

    await expect(refused).rejects.toBeInstanceOf(RpcRefusedError);
    releaseTransport();
    await expect(transport).rejects.toBeInstanceOf(RpcTransportError);
    releaseSuccess();
    await expect(success).resolves.toBeUndefined();
    await expect(
      withRpcFallback(
        [nodeUrl],
        async () => {
          probes += 1;
        },
        () => ({}) as RpcProvider,
        () => 1_000,
      ),
    ).rejects.toThrow("temporarily unavailable");
    expect(probes).toBe(0);
  });

  test("allows only one concurrent recovery probe for a cooling endpoint", async () => {
    const nodeUrl = "https://single-recovery-probe.example";
    let releaseProbe = (): void => undefined;
    let attempts = 0;
    const provider = () => ({}) as RpcProvider;
    await expect(
      withRpcFallback(
        [nodeUrl],
        async () => {
          throw new RpcTransportError("offline");
        },
        provider,
        () => 1_000,
      ),
    ).rejects.toBeInstanceOf(RpcTransportError);

    const probe = withRpcFallback(
      [nodeUrl],
      () =>
        new Promise<never>((_resolve, reject) => {
          attempts += 1;
          releaseProbe = () => reject(new RpcTransportError("still offline"));
        }),
      provider,
      () => 1_000,
    );
    await expect(
      withRpcFallback(
        [nodeUrl],
        async () => {
          attempts += 1;
        },
        provider,
        () => 1_000,
      ),
    ).rejects.toThrow("temporarily unavailable");
    expect(attempts).toBe(1);

    releaseProbe();
    await expect(probe).rejects.toBeInstanceOf(RpcTransportError);
  });

  test("cools down an endpoint after a determinate refused broadcast", async () => {
    const nodeUrl = "https://refused-write-cooldown.example";
    let currentTime = 1_000;
    let probes = 0;
    const provider = {
      channel: {
        async fetchEndpoint() {
          throw new RpcRefusedError(RPC_REFUSED_MESSAGE, "60");
        },
      },
      async getChainId() {
        return "0x534e5f4d41494e";
      },
    } as unknown as RpcProvider;

    await expect(
      withRpcWrite(
        [nodeUrl],
        "0x534e5f4d41494e",
        async (selected) => {
          const fetchEndpoint = Reflect.get(selected.channel, "fetchEndpoint") as (
            method: string,
          ) => Promise<never>;
          return fetchEndpoint("starknet_addInvokeTransaction");
        },
        () => provider,
        () => currentTime,
      ),
    ).rejects.toThrow(RPC_REFUSED_MESSAGE);
    await expect(
      withRpcFallback(
        [nodeUrl],
        async () => {
          probes += 1;
        },
        () => provider,
        () => currentTime,
      ),
    ).rejects.toThrow("temporarily unavailable");
    expect(probes).toBe(0);

    currentTime += 60_000;
    await withRpcFallback(
      [nodeUrl],
      async () => {
        probes += 1;
      },
      () => provider,
      () => currentTime,
    );
    expect(probes).toBe(1);
  });
});
