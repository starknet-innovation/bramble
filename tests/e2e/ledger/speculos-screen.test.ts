/**
 * The Speculos REST client and reachability probe against a local stand-in
 * server: what it posts for buttons, taps and swipes, how it reads and waits
 * for screen text, and that a dead endpoint is reported, not assumed.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:net";
import { probeSpeculos, type SpeculosEndpoints, SpeculosScreen } from "./speculos";

const posts: { readonly body: unknown; readonly path: string }[] = [];
let screens: readonly string[][] = [["Review hash"]];
let api: ReturnType<typeof Bun.serve> | undefined;
let apdu: Server | undefined;

afterEach(() => {
  api?.stop(true);
  apdu?.close();
  posts.length = 0;
});

const startApi = (): string => {
  let read = 0;
  api = Bun.serve({
    fetch: async (request) => {
      const url = new URL(request.url);
      if (request.method === "POST") {
        posts.push({ body: await request.json(), path: url.pathname });
        return Response.json({});
      }
      const texts = screens[Math.min(read, screens.length - 1)] ?? [];
      read += 1;
      return Response.json({
        events: texts.map((text, index) => ({ text, x: 10, y: index * 20 })),
      });
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  return `http://127.0.0.1:${api.port}`;
};

const endpoints = (apiUrl: string, apduPort = 1): SpeculosEndpoints => ({
  apduPort,
  apiUrl,
  host: "127.0.0.1",
  model: "flex",
});

describe("SpeculosScreen", () => {
  test("posts the Ragger-shaped inputs", async () => {
    const screen = new SpeculosScreen(endpoints(startApi()));
    await screen.press("both");
    await screen.touch(240, 435, 3);
    await screen.swipeLeft(240, 300);
    expect(posts).toEqual([
      { body: { action: "press-and-release" }, path: "/button/both" },
      { body: { action: "press-and-release", delay: 3, x: 240, y: 435 }, path: "/finger" },
      {
        body: { action: "press-and-release", delay: 0.5, x: 240, x2: 230, y: 300, y2: 300 },
        path: "/finger",
      },
    ]);
  });

  test("taps whole pixels, since Speculos refuses a fractional point", async () => {
    const screen = new SpeculosScreen(endpoints(startApi()));
    await screen.touch(239.5, 463.6);
    expect(posts).toEqual([
      { body: { action: "press-and-release", delay: 0.5, x: 240, y: 464 }, path: "/finger" },
    ]);
  });

  test("keeps a transcript of distinct screens and inputs", async () => {
    screens = [["Starknet"], ["Starknet"], ["Review hash"]];
    const screen = new SpeculosScreen(endpoints(startApi()));
    await screen.text();
    await screen.text();
    await screen.press("right");
    await screen.text();
    expect(screen.transcript()).toEqual([
      "screen: Starknet@10,0",
      'input: /button/right {"action":"press-and-release"}',
      "screen: Review hash@10,0",
    ]);
  });

  test("waits for screen text and reports the last screen on timeout", async () => {
    screens = [["Starknet"], ["Review", "hash"]];
    const screen = new SpeculosScreen(endpoints(startApi()));
    expect(await screen.waitFor(/review hash/i, 3_000)).toBe("Review hash");
    expect((await screen.texts()).map((event) => event.text)).toEqual(["Review", "hash"]);
    await expect(screen.waitFor(/never/, 300)).rejects.toThrow('last screen: "Review hash"');
  });
});

describe("probeSpeculos", () => {
  test("names whichever endpoint is down", async () => {
    expect(await probeSpeculos(endpoints("http://127.0.0.1:1"))).toContain(
      "REST API is not reachable",
    );
    const apiUrl = startApi();
    expect(await probeSpeculos(endpoints(apiUrl, 1))).toContain("APDU port");
    apdu = createServer(() => undefined);
    await new Promise<void>((resolve) => apdu?.listen(0, "127.0.0.1", resolve));
    const address = apdu.address();
    expect(
      await probeSpeculos(
        endpoints(apiUrl, typeof address === "object" && address ? address.port : 0),
      ),
    ).toBeNull();
  });
});
