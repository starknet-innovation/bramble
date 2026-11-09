/**
 * The in-page provider tells a dapp about `networkChanged` only when the chain
 * the page holds actually moves (Sherlock 188, 215), and "the chain the page
 * holds" includes what the dapp last read with `wallet_requestChainId`.
 *
 * The wallet announces the active network after account switches and
 * unlocks, which usually leave it where it was, so repeats are dropped. But a
 * dapp that polled the chain id directly may hold a chain no event told it
 * about; an announcement that moves it back must still arrive.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CONTENT_TARGET, PAGE_TARGET } from "@bramble/wallet-protocol/bridge";
import {
  registerDom,
  unregisterDom,
} from "../../packages/presentation/wallet-ui/tests/support/groups-harness";

const ORIGIN = "https://dapp.example";
const MAINNET = "0x534e5f4d41494e";
const SEPOLIA = "0x534e5f5345504f4c4941";

type Provider = {
  readonly on: (event: string, handler: (data: unknown) => void) => void;
  readonly request: (args: unknown) => Promise<unknown>;
};

let provider: Provider;
let answerChainId = MAINNET;
const heard: unknown[] = [];

const deliver = (data: unknown): void => {
  window.dispatchEvent(new MessageEvent("message", { data, origin: ORIGIN, source: window }));
};

const announce = async (chainId: string): Promise<void> => {
  deliver({ data: chainId, event: "networkChanged", target: PAGE_TARGET });
  await Promise.resolve();
};

beforeAll(async () => {
  await registerDom();
  (window as unknown as { happyDOM: { setURL: (url: string) => void } }).happyDOM.setURL(ORIGIN);
  // Plays the content script: answers each chain-id request the page posts.
  const post = window.postMessage.bind(window);
  window.postMessage = ((message: unknown, ...rest: unknown[]) => {
    const request = message as {
      readonly id?: string;
      readonly method?: string;
      readonly target?: string;
    };
    if (request.target === CONTENT_TARGET && request.method === "wallet_requestChainId") {
      queueMicrotask(() => deliver({ id: request.id, result: answerChainId, target: PAGE_TARGET }));
      return;
    }
    (post as (...args: unknown[]) => void)(message, ...rest);
  }) as typeof window.postMessage;
  await import("../../apps/extension/src/provider/inpage");
  provider = (window as unknown as { starknet_bramble: Provider }).starknet_bramble;
  provider.on("networkChanged", (data) => heard.push(data));
});

afterAll(unregisterDom);

describe("in-page networkChanged delivery", () => {
  test("delivers the first chain, drops a repeat, and delivers a real move", async () => {
    await announce(SEPOLIA);
    await announce(SEPOLIA);
    await announce(MAINNET);
    expect(heard).toEqual([SEPOLIA, MAINNET]);
  });

  test("a chain the dapp read directly counts, so a move back is still delivered", async () => {
    heard.length = 0;
    await announce(SEPOLIA);
    answerChainId = MAINNET;
    expect(await provider.request({ type: "wallet_requestChainId" })).toBe(MAINNET);
    await announce(SEPOLIA);
    expect(heard).toEqual([SEPOLIA, SEPOLIA]);
  });
});
