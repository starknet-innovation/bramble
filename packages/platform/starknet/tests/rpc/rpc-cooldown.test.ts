/** RPC refusal cooldown, its read-only back-off view, and pre-submission error boundary checks. */
import { describe, expect, test } from "bun:test";
import { rpcEndpointBackoff } from "@bramble/starknet/provider";
import {
  RPC_REFUSED_MESSAGE,
  RpcRefusedError,
  timedRpcFetch,
  withRpcFallback,
  withRpcWrite,
} from "@bramble/starknet/rpc";
import { RpcTransportError } from "@bramble/starknet/rpc-transport";
import type { RpcProvider } from "starknet";

describe("RPC endpoint cooldown", () => {
  test("treats JSON-RPC -32005 as a determinate refusal", async () => {
    const rpcFetch = timedRpcFetch(
      1_000,
      async () =>
        new Response(
          '{"jsonrpc":"2.0","id":1,"error":{"code":-32005,"message":"rate limit exceeded"}}',
        ),
    );
    const rejection = await rpcFetch("https://selected.example", {}).catch(
      (error: unknown) => error,
    );

    expect(rejection).toBeInstanceOf(RpcRefusedError);
    expect((rejection as Error).message).toBe(RPC_REFUSED_MESSAGE);
  });

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

  test("does not probe a transport-failed endpoint before its cooldown expires", async () => {
    const nodeUrl = "https://transport-cooldown.example";
    let currentTime = 1_000;
    let attempts = 0;
    const provider = () => ({}) as RpcProvider;
    await expect(
      withRpcFallback(
        [nodeUrl],
        async () => {
          attempts += 1;
          throw new RpcTransportError("offline");
        },
        provider,
        () => currentTime,
      ),
    ).rejects.toBeInstanceOf(RpcTransportError);

    await expect(
      withRpcFallback(
        [nodeUrl],
        async () => {
          attempts += 1;
        },
        provider,
        () => currentTime,
      ),
    ).rejects.toThrow("temporarily unavailable");
    expect(attempts).toBe(1);

    currentTime += 30_000;
    await withRpcFallback(
      [nodeUrl],
      async () => {
        attempts += 1;
      },
      provider,
      () => currentTime,
    );
    expect(attempts).toBe(2);
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

describe("RPC endpoint back-off", () => {
  // A provider stand-in that names its endpoint, so one run can fail each
  // endpoint its own way.
  const tagged = (nodeUrl: string) => ({ nodeUrl }) as unknown as RpcProvider;
  const endpointOf = (provider: RpcProvider): string =>
    (provider as unknown as { readonly nodeUrl: string }).nodeUrl;

  test("reports a refusal-only cooldown until the first endpoint may be asked again", async () => {
    const gateway = "https://backoff-gateway.example";
    const fallback = "https://backoff-fallback.example";
    let currentTime = 1_000;
    const retryAfter: Record<string, string> = { [fallback]: "20", [gateway]: "45" };
    await expect(
      withRpcFallback(
        [gateway, fallback],
        async (provider) => {
          throw new RpcRefusedError(RPC_REFUSED_MESSAGE, retryAfter[endpointOf(provider)] ?? null);
        },
        tagged,
        () => currentTime,
      ),
    ).rejects.toBeInstanceOf(RpcRefusedError);

    expect(rpcEndpointBackoff([gateway, fallback], () => currentTime)).toEqual({
      refused: true,
      retryInMs: 20_000,
    });
    currentTime += 20_000;
    expect(rpcEndpointBackoff([gateway, fallback], () => currentTime)).toBeNull();
    expect(rpcEndpointBackoff([gateway], () => currentTime)).toEqual({
      refused: true,
      retryInMs: 25_000,
    });
  });

  test("a timeout behind any cooldown is not a refusal to wait out", async () => {
    const gateway = "https://backoff-mixed-gateway.example";
    const fallback = "https://backoff-mixed-fallback.example";
    await expect(
      withRpcFallback(
        [gateway, fallback],
        async (provider) => {
          throw endpointOf(provider) === gateway
            ? new RpcRefusedError(RPC_REFUSED_MESSAGE, "45")
            : new RpcTransportError("RPC request timed out");
        },
        tagged,
        () => 1_000,
      ),
    ).rejects.toBeInstanceOf(RpcTransportError);
    expect(rpcEndpointBackoff([gateway, fallback], () => 1_000)).toEqual({
      refused: false,
      retryInMs: 30_000,
    });
  });

  test("a timeout merged into one endpoint's refusal cooldown clears its refusal", async () => {
    const nodeUrl = "https://backoff-merged.example";
    let releaseTimeout = (): void => undefined;
    const refused = withRpcFallback(
      [nodeUrl],
      async () => {
        await Promise.resolve();
        throw new RpcRefusedError(RPC_REFUSED_MESSAGE, "60");
      },
      () => ({}) as RpcProvider,
      () => 1_000,
    );
    const timedOut = withRpcFallback(
      [nodeUrl],
      () =>
        new Promise<never>((_resolve, reject) => {
          releaseTimeout = () => reject(new RpcTransportError("RPC request timed out"));
        }),
      () => ({}) as RpcProvider,
      () => 1_000,
    );
    await expect(refused).rejects.toBeInstanceOf(RpcRefusedError);
    expect(rpcEndpointBackoff([nodeUrl], () => 1_000)?.refused).toBe(true);
    releaseTimeout();
    await expect(timedOut).rejects.toBeInstanceOf(RpcTransportError);
    expect(rpcEndpointBackoff([nodeUrl], () => 1_000)).toEqual({
      refused: false,
      retryInMs: 60_000,
    });
  });

  test("is null when nothing is configured or an endpoint never failed", () => {
    expect(rpcEndpointBackoff([], () => 0)).toBeNull();
    expect(rpcEndpointBackoff(["https://backoff-healthy.example"], () => 0)).toBeNull();
  });
});
