/**
 * The Ready-key session (issue 776) binds a discovery and its picker to the
 * key, salt, and network it was run for. A late or out-of-order answer is
 * dropped, an input change (the network included) invalidates the picker, only
 * one picker is ever mounted, and ticks are handed out only while the inputs
 * still match the picker's snapshot.
 */
import { describe, expect, test } from "bun:test";
import type { ReadyKeyCandidate } from "../../../../src/popup/responses/responses-onboarding";
import type { ReadyKeyPicker } from "../../../../src/sidepanel/journeys/onboarding/ready-key-picker";
import {
  type ReadyKeyInputs,
  readyKeySession,
} from "../../../../src/sidepanel/journeys/onboarding/ready-key-session";

const ARGENT_031 = "0x29927c8af6bccf3f6fda035981e765a7bdbf18a2dc0d630494f8758aa908e2b";
const row = (classHash: string): ReadyKeyCandidate => ({
  accountId: `SN_MAIN:${classHash}`,
  address: "0xa031",
  classHash,
  deployed: true,
});

const deferred = <T>() => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
};

const harness = () => {
  let inputs: ReadyKeyInputs = { key: "0xfeedface", networkId: "SN_MAIN", salt: undefined };
  const session = readyKeySession(() => inputs);
  const live: string[] = [];
  const asked: ReadyKeyInputs[] = [];
  const mount = (candidates: readonly ReadyKeyCandidate[]): ReadyKeyPicker => {
    const classes = candidates.map(({ classHash }) => classHash);
    const name = classes.join(",");
    live.push(name);
    return {
      picked: () => classes,
      remove: () => live.splice(live.indexOf(name), 1),
    };
  };
  const run = (answer: Promise<readonly ReadyKeyCandidate[]>) =>
    session.discover((snapshot) => {
      asked.push(snapshot);
      return answer;
    }, mount);
  return {
    asked,
    live,
    run,
    session,
    set: (change: Partial<ReadyKeyInputs>) => {
      inputs = { ...inputs, ...change };
    },
  };
};

describe("readyKeySession", () => {
  test("mounts a current answer and hands out its ticks while the inputs match", async () => {
    const flow = harness();
    expect(await flow.run(Promise.resolve([row(ARGENT_031)]))).toBe("mounted");
    expect(flow.session.matches()).toBe(true);
    expect(flow.session.picked()).toEqual([ARGENT_031]);
    expect(flow.asked).toEqual([{ key: "0xfeedface", networkId: "SN_MAIN", salt: undefined }]);
    expect(flow.session.selection()).toEqual({
      classHashes: [ARGENT_031],
      inputs: { key: "0xfeedface", networkId: "SN_MAIN", salt: undefined },
    });
  });

  for (const [input, change] of [
    ["key", { key: "0xbeef" }],
    ["salt", { salt: "0x777" }],
    ["network", { networkId: "SN_SEPOLIA" }],
  ] as const) {
    test(`a ${input} change during the wait drops the answer and mounts nothing`, async () => {
      const flow = harness();
      const answer = deferred<readonly ReadyKeyCandidate[]>();
      const pending = flow.run(answer.promise);
      flow.set(change);
      answer.resolve([row(ARGENT_031)]);
      expect(await pending).toBe("changed");
      expect(flow.live).toEqual([]);
      expect(flow.session.picked()).toBeNull();
    });

    test(`a ${input} change after mounting withholds the ticks`, async () => {
      const flow = harness();
      await flow.run(Promise.resolve([row(ARGENT_031)]));
      flow.set(change);
      expect(flow.session.matches()).toBe(false);
      expect(flow.session.picked()).toBeNull();
      expect(flow.session.selection()).toBeNull();
    });
  }

  test("out of order: the older answer arriving last is dropped, one picker stays", async () => {
    const flow = harness();
    const first = deferred<readonly ReadyKeyCandidate[]>();
    const second = deferred<readonly ReadyKeyCandidate[]>();
    const older = flow.run(first.promise);
    flow.set({ salt: "0x777" });
    const newer = flow.run(second.promise);
    second.resolve([row("0x2")]);
    expect(await newer).toBe("mounted");
    first.resolve([row("0x1")]);
    expect(await older).toBe("superseded");
    expect(flow.live).toEqual(["0x2"]);
    expect(flow.session.picked()).toEqual(["0x2"]);
  });

  test("a new discovery takes the previous picker down before mounting its own", async () => {
    const flow = harness();
    await flow.run(Promise.resolve([row("0x1")]));
    await flow.run(Promise.resolve([row("0x2")]));
    expect(flow.live).toEqual(["0x2"]);
  });

  test("invalidate drops the picker and any answer still in flight", async () => {
    const flow = harness();
    await flow.run(Promise.resolve([row("0x1")]));
    const answer = deferred<readonly ReadyKeyCandidate[]>();
    const pending = flow.run(answer.promise);
    flow.session.invalidate();
    answer.resolve([row("0x2")]);
    expect(await pending).toBe("superseded");
    expect(flow.live).toEqual([]);
    expect(flow.session.picked()).toBeNull();
  });

  test("a stale failure is dropped; a current one rejects", async () => {
    const flow = harness();
    const stale = deferred<readonly ReadyKeyCandidate[]>();
    const pending = flow.run(stale.promise);
    flow.session.invalidate();
    stale.reject(new Error("Ready account check unavailable"));
    expect(await pending).toBe("superseded");
    await expect(
      flow.run(Promise.reject(new Error("Ready account check unavailable"))),
    ).rejects.toThrow("Ready account check unavailable");
    expect(flow.session.picked()).toBeNull();
  });
});
