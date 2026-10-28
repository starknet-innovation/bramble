/**
 * The Ready-key session (issue 776) binds a discovery and its picker to the
 * key, salt, and network it was run for. A late or out-of-order answer is
 * dropped, an input change (the network included) invalidates the picker, only
 * one picker is ever mounted, and ticks are handed out only while the inputs
 * still match the picker's snapshot.
 */
import { describe, expect, test } from "bun:test";
import type { KeyAddressCandidate } from "@bramble/wallet-model/recovery";
import type { ReadyKeyCandidate } from "../../../../src/popup/responses/responses-onboarding";
import type { ReadyKeyPicker } from "../../../../src/sidepanel/journeys/onboarding/ready-key-picker";
import {
  type ReadyKeyInputs,
  readyKeyPick,
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

// Issue 779: a found-by-address account, as the lookup answers it.
const FOUND: KeyAddressCandidate = {
  accountId: "SN_MAIN:0x7e57",
  address: "0x7e57",
  byAddress: true,
  classHash: ARGENT_031,
  deployed: true,
};

describe("readyKeySession address lookups", () => {
  const lookup = (
    flow: ReturnType<typeof harness>,
    answer: Promise<KeyAddressCandidate>,
    asked: ReadyKeyInputs[] = [],
  ) =>
    flow.session.findByAddress(
      (inputs) => {
        asked.push(inputs);
        return answer;
      },
      (candidate) => {
        flow.live.push(candidate.address);
        return {
          picked: () => [candidate.classHash],
          remove: () => flow.live.splice(flow.live.indexOf(candidate.address), 1),
        };
      },
    );

  test("refused before any discovery has answered", async () => {
    const flow = harness();
    await expect(lookup(flow, Promise.resolve(FOUND))).rejects.toThrow(
      "wallet changed during the account check",
    );
  });

  test("runs for the discovery's snapshot after a refusal, and replaces the picker", async () => {
    const flow = harness();
    flow.set({ salt: "0x5a17" });
    await expect(
      flow.run(Promise.reject(new Error("No Ready account found for this key"))),
    ).rejects.toThrow();
    const asked: ReadyKeyInputs[] = [];
    expect(await lookup(flow, Promise.resolve(FOUND), asked)).toEqual(FOUND);
    expect(asked).toEqual([{ key: "0xfeedface", networkId: "SN_MAIN", salt: "0x5a17" }]);
    expect(flow.live).toEqual(["0x7e57"]);
    const selection = flow.session.selection();
    expect(selection).toEqual({
      address: "0x7e57",
      classHashes: [ARGENT_031],
      inputs: { key: "0xfeedface", networkId: "SN_MAIN", salt: "0x5a17" },
    });
    expect(selection && readyKeyPick(selection)).toEqual({
      address: "0x7e57",
      classHash: ARGENT_031,
    });
  });

  test("a found account takes the release picker down", async () => {
    const flow = harness();
    await flow.run(Promise.resolve([row("0x1")]));
    await lookup(flow, Promise.resolve(FOUND));
    expect(flow.live).toEqual(["0x7e57"]);
  });

  for (const [input, change] of [
    ["key", { key: "0xbeef" }],
    ["salt", { salt: "0x777" }],
    ["network", { networkId: "SN_SEPOLIA" }],
  ] as const) {
    test(`a ${input} change during a lookup drops its answer`, async () => {
      const flow = harness();
      await flow.run(Promise.resolve([row("0x1")]));
      const answer = deferred<KeyAddressCandidate>();
      const pending = lookup(flow, answer.promise);
      flow.set(change);
      answer.resolve(FOUND);
      expect(await pending).toBeNull();
      expect(flow.live).toEqual(["0x1"]);
      expect(flow.session.selection()).toBeNull();
    });
  }

  test("an invalidate during a lookup drops its answer, and the next lookup is refused", async () => {
    const flow = harness();
    await flow.run(Promise.resolve([row("0x1")]));
    const answer = deferred<KeyAddressCandidate>();
    const pending = lookup(flow, answer.promise);
    flow.session.invalidate();
    answer.resolve(FOUND);
    expect(await pending).toBeNull();
    expect(flow.live).toEqual([]);
    await expect(lookup(flow, Promise.resolve(FOUND))).rejects.toThrow();
  });

  test("refused once the inputs differ from the discovery's, even without an edit event", async () => {
    const flow = harness();
    await flow.run(Promise.resolve([row("0x1")]));
    flow.set({ networkId: "SN_SEPOLIA" });
    const asked: ReadyKeyInputs[] = [];
    await expect(lookup(flow, Promise.resolve(FOUND), asked)).rejects.toThrow();
    expect(asked).toEqual([]);
  });

  test("out of order: an older lookup answering last is dropped, the newer pick stays", async () => {
    const flow = harness();
    await flow.run(Promise.resolve([row("0x1")]));
    const older = deferred<KeyAddressCandidate>();
    const newer = deferred<KeyAddressCandidate>();
    const first = lookup(flow, older.promise);
    const second = lookup(flow, newer.promise);
    newer.resolve({ ...FOUND, address: "0x2" });
    expect(await second).toMatchObject({ address: "0x2" });
    older.resolve(FOUND);
    expect(await first).toBeNull();
    expect(flow.live).toEqual(["0x2"]);
    expect(flow.session.selection()?.address).toBe("0x2");
  });

  test("a pick names releases, one address, or nothing when nothing is ticked", () => {
    const inputs = { key: "0xfeedface", networkId: "SN_MAIN", salt: undefined };
    expect(readyKeyPick({ classHashes: ["0x1", "0x2"], inputs })).toEqual(["0x1", "0x2"]);
    expect(readyKeyPick({ classHashes: [], inputs })).toBeNull();
    expect(readyKeyPick({ address: "0x7e57", classHashes: [], inputs })).toBeNull();
  });
});
