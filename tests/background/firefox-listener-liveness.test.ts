/**
 * A pending approval has to keep Firefox's non-persistent event page alive
 * (#350).
 *
 * Chromium MV3 holds a service worker open for a listener that returns `true`
 * and answers through `sendResponse` later. Firefox does not track that shape;
 * it holds the event page open only while the listener's returned Promise is
 * pending, and it takes that Promise's resolved value as the response. The two
 * shapes are mutually exclusive, so the build target picks one, and the answer
 * the caller finally receives is identical either way.
 */
import { describe, expect, test } from "bun:test";
import {
  awaitsListenerPromise,
  respondToMessage,
} from "../../apps/extension/src/background/runtime/message-response";

type MessageResponse = { readonly error: string } | { readonly status: string };

const FAILURE: MessageResponse = { error: "wallet request failed" };
const APPROVED: MessageResponse = { status: "approved" };

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
};

describe("background message response protocol", () => {
  test("Firefox holds a pending request open and still delivers the deferred answer", async () => {
    const approval = deferred<MessageResponse>();
    const sent: MessageResponse[] = [];
    const after: MessageResponse[] = [];
    const outcome = respondToMessage<MessageResponse>({
      after: (response) => after.push(response),
      failure: FAILURE,
      send: (response) => sent.push(response),
      target: "firefox",
      work: approval.promise,
    });

    // While the approval is outstanding the listener's answer is a pending
    // Promise. That Promise is the only thing Firefox keeps the event page
    // alive for, so it must not settle and sendResponse must not be used.
    expect(outcome).toBeInstanceOf(Promise);
    await flush();
    expect(sent).toEqual([]);
    expect(after).toEqual([]);
    if (!(outcome instanceof Promise)) {
      throw new Error("a Firefox listener must answer with a Promise");
    }
    let settled = false;
    void outcome.then(() => {
      settled = true;
    });
    await flush();
    expect(settled).toBe(false);

    // Revive: resolving the approval delivers the original answer intact.
    approval.resolve(APPROVED);
    await expect(outcome).resolves.toEqual(APPROVED);
    expect(after).toEqual([APPROVED]);
    expect(sent).toEqual([]);
  });

  test("Chromium keeps returning true and answers through sendResponse", async () => {
    const approval = deferred<MessageResponse>();
    const sent: MessageResponse[] = [];
    const after: MessageResponse[] = [];
    const outcome = respondToMessage<MessageResponse>({
      after: (response) => after.push(response),
      failure: FAILURE,
      send: (response) => sent.push(response),
      target: "chrome",
      work: approval.promise,
    });
    expect(outcome).toBe(true);
    await flush();
    expect(sent).toEqual([]);
    approval.resolve(APPROVED);
    await flush();
    expect(sent).toEqual([APPROVED]);
    expect(after).toEqual([APPROVED]);
  });

  test("an unstamped bundle keeps the Chromium shape", () => {
    const outcome = respondToMessage<MessageResponse>({
      after: () => undefined,
      failure: FAILURE,
      send: () => undefined,
      target: undefined,
      work: Promise.resolve(APPROVED),
    });
    expect(outcome).toBe(true);
  });

  test("a failed request answers with the failure response on both targets", async () => {
    const chromiumSent: MessageResponse[] = [];
    const chromium = respondToMessage<MessageResponse>({
      after: () => undefined,
      failure: FAILURE,
      send: (response) => chromiumSent.push(response),
      target: "chrome",
      work: Promise.reject(new Error("boom")),
    });
    expect(chromium).toBe(true);
    const firefox = respondToMessage<MessageResponse>({
      after: () => undefined,
      failure: FAILURE,
      send: () => undefined,
      target: "firefox",
      work: Promise.reject(new Error("boom")),
    });
    await expect(firefox).resolves.toEqual(FAILURE);
    await flush();
    expect(chromiumSent).toEqual([FAILURE]);
  });

  test("only the exact firefox target uses the pending-Promise protocol", () => {
    expect(awaitsListenerPromise("firefox")).toBe(true);
    expect(awaitsListenerPromise("chrome")).toBe(false);
    expect(awaitsListenerPromise("Firefox")).toBe(false);
    expect(awaitsListenerPromise("firefox ")).toBe(false);
    expect(awaitsListenerPromise("")).toBe(false);
    expect(awaitsListenerPromise(undefined)).toBe(false);
  });
});
