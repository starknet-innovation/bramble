/**
 * Restoring accounts a wallet has lost but the phone still holds keys for.
 *
 * Two invariants matter here and they pull in the same direction. Every account
 * carries its own proof over its own fresh challenge, because an address derived
 * from a key the device cannot sign for is unspendable. And one account's
 * failure must not take the others down: the whole point of asking per account
 * is that a declined approval costs that account and nothing else.
 */
import { describe, expect, test } from "bun:test";
import { mlDsa65Fixture } from "@mc-wallet/testkit/ml-dsa-fixtures";
import {
  MOBILE_PQ_PAIRING_VERSION,
  type MobilePqEnrollDraft,
} from "../../../../src/sidepanel/journeys/mobile/pairing-reply";
import {
  decodeMobilePqRestoreList,
  encodeMobilePqRestoreKeyOffer,
  encodeMobilePqRestoreOffer,
  MOBILE_PQ_ALREADY_STORED,
  MOBILE_PQ_RESTORE_LIST_INVALID,
  MOBILE_PQ_RESTORE_VERSION,
  MOBILE_PQ_RESTORE_WRONG_ACCOUNT,
  type MobilePqRestoreEntry,
  runMobilePqRestore,
} from "../../../../src/sidepanel/journeys/mobile/restore-session";
import {
  fromBase64Url,
  toBase64Url,
} from "../../../../src/sidepanel/journeys/mobile/wire-encoding";

/**
 * The picker's answer, emitted by **pq-signer** itself.
 *
 * Written by `EmitFixturesTest` in that repository to `build/fixtures/restore-list.txt`.
 * A fixture this repo built would agree with itself no matter which side was
 * wrong, which is the mistake `docs/pq/ble-transport.md` records.
 */
const PHONE_RESTORE_LIST =
  "eyJ2ZXJzaW9uIjoxLCJkZXZpY2VJZHMiOlsiUGl4ZWwgOCBQcm8iLCJTcGFyZSBwaG9uZSJdfQ";

const FIRST = "Pixel 8 Pro";
const SECOND = "Spare phone";

const devices: Readonly<Record<string, ReturnType<typeof mlDsa65Fixture>>> = {
  [FIRST]: mlDsa65Fixture(11),
  [SECOND]: mlDsa65Fixture(12),
};

/** One account's reply, exactly the shape a pairing reply has. */
const reply = (deviceId: string, challenge: string, patch: Partial<MobilePqEnrollDraft> = {}) =>
  toBase64Url(
    JSON.stringify({
      deviceId,
      publicKey: devices[deviceId]?.publicKey,
      signature: devices[deviceId]?.sign(challenge),
      version: MOBILE_PQ_PAIRING_VERSION,
      ...patch,
    }),
  );

const offered = (payload: string): Record<string, unknown> =>
  JSON.parse(fromBase64Url(payload) ?? "{}") as Record<string, unknown>;

type Harness = {
  readonly challenges: string[];
  readonly enrolled: (MobilePqEnrollDraft & { readonly challenge: string })[];
  readonly offers: string[];
  readonly progress: readonly MobilePqRestoreEntry[][];
  readonly run: () => Promise<readonly MobilePqRestoreEntry[]>;
};

const harness = (options?: {
  readonly enroll?: (draft: MobilePqEnrollDraft & { readonly challenge: string }) => Promise<void>;
  readonly list?: string;
  readonly restoreKey?: (offer: string, challenge: string) => Promise<string>;
}): Harness => {
  const challenges: string[] = [];
  const offers: string[] = [];
  const enrolled: (MobilePqEnrollDraft & { readonly challenge: string })[] = [];
  const progress: MobilePqRestoreEntry[][] = [];
  let issued = 0;
  return {
    challenges,
    enrolled,
    offers,
    progress,
    run: () =>
      runMobilePqRestore({
        challenge: async () => {
          issued += 1;
          const next = `0x${String(issued).padStart(2, "0")}`;
          challenges.push(next);
          return next;
        },
        device: {
          restore: async (offer) => {
            offers.push(offer);
            return options?.list ?? PHONE_RESTORE_LIST;
          },
          restoreKey: async (offer) => {
            offers.push(offer);
            const active = challenges.at(-1) as string;
            const deviceId = offered(offer)["deviceId"] as string;
            return options?.restoreKey
              ? options.restoreKey(offer, active)
              : reply(deviceId, active);
          },
        },
        enroll:
          options?.enroll ??
          (async (draft) => {
            enrolled.push(draft);
          }),
        networkId: "SN_SEPOLIA",
        onProgress: (entries) => progress.push([...entries]),
      }),
  };
};

describe("runMobilePqRestore", () => {
  test("the phone's own picker answer decodes", () => {
    // The cross-repo agreement this whole flow rests on.
    expect(decodeMobilePqRestoreList(PHONE_RESTORE_LIST)).toEqual([FIRST, SECOND]);
  });

  test("asks the picker first, with the network and no challenge", async () => {
    const bench = harness();
    await bench.run();
    expect(offered(bench.offers[0] as string)).toEqual({
      networkId: "SN_SEPOLIA",
      version: MOBILE_PQ_RESTORE_VERSION,
    });
  });

  test("every account gets its own fresh challenge", async () => {
    const bench = harness();
    await bench.run();
    // Two accounts, two challenges, and neither reused: the wallet keeps one
    // outstanding and consumes it, so a shared challenge would enroll the first
    // and be refused as expired for the second.
    expect(bench.challenges).toHaveLength(2);
    expect(new Set(bench.challenges).size).toBe(2);
    expect(bench.enrolled.map((draft) => draft.challenge)).toEqual(bench.challenges);
  });

  test("each account is enrolled under the name the phone gave it", async () => {
    const bench = harness();
    const entries = await bench.run();
    expect(bench.enrolled.map((draft) => draft.deviceId)).toEqual([FIRST, SECOND]);
    expect(entries.map((entry) => entry.outcome)).toEqual(["restored", "restored"]);
  });

  test("a declined account is skipped and the rest still restore", async () => {
    const bench = harness({
      restoreKey: async (offer, challenge) => {
        const deviceId = offered(offer)["deviceId"] as string;
        if (deviceId === FIRST) {
          throw new Error("Your phone declined the request.");
        }
        return reply(deviceId, challenge);
      },
    });
    const entries = await bench.run();
    expect(entries[0]?.outcome).toBe("skipped");
    expect(entries[0]?.reason).toContain("declined");
    expect(entries[1]?.outcome).toBe("restored");
    // The one that was declined was never enrolled, and the other still was.
    expect(bench.enrolled.map((draft) => draft.deviceId)).toEqual([SECOND]);
  });

  test("an account this wallet already holds is reported, not treated as a failure", async () => {
    const bench = harness({
      enroll: async (draft) => {
        if (draft.deviceId === FIRST) {
          throw new Error(MOBILE_PQ_ALREADY_STORED);
        }
      },
    });
    const entries = await bench.run();
    expect(entries[0]?.outcome).toBe("present");
    expect(entries[1]?.outcome).toBe("restored");
  });

  test("a reply about a different account than the one asked for is refused", async () => {
    // Otherwise the account would be stored under the requested name while
    // carrying another key's material.
    const bench = harness({
      restoreKey: async (_offer, challenge) => reply(SECOND, challenge),
    });
    const entries = await bench.run();
    expect(entries[0]?.outcome).toBe("skipped");
    expect(entries[0]?.reason).toBe(MOBILE_PQ_RESTORE_WRONG_ACCOUNT);
    expect(bench.enrolled).toHaveLength(1);
  });

  test("a malformed per-account reply is skipped rather than enrolled", async () => {
    const bench = harness({ restoreKey: async () => "not-a-reply" });
    const entries = await bench.run();
    expect(entries.map((entry) => entry.outcome)).toEqual(["skipped", "skipped"]);
    expect(bench.enrolled).toHaveLength(0);
  });

  test("a reply whose signature is not ML-DSA-65 is skipped", async () => {
    const bench = harness({
      restoreKey: async (offer, challenge) =>
        reply(offered(offer)["deviceId"] as string, challenge, { signature: "0xdead" }),
    });
    const entries = await bench.run();
    expect(entries.map((entry) => entry.outcome)).toEqual(["skipped", "skipped"]);
    expect(bench.enrolled).toHaveLength(0);
  });

  test("an unreadable picker answer ends the run, because there is no list", async () => {
    const bench = harness({ list: "not-a-list" });
    await expect(bench.run()).rejects.toThrow(MOBILE_PQ_RESTORE_LIST_INVALID);
  });

  test("progress is reported before the first account and after every one", async () => {
    const bench = harness();
    await bench.run();
    // Once for the list, then once per account: each account costs the user a
    // biometric approval, and a screen that does not move looks stopped.
    expect(bench.progress).toHaveLength(3);
    expect(bench.progress[0]?.map((entry) => entry.outcome)).toEqual([undefined, undefined]);
    expect(bench.progress[1]?.map((entry) => entry.outcome)).toEqual(["restored", undefined]);
    expect(bench.progress[2]?.map((entry) => entry.outcome)).toEqual(["restored", "restored"]);
  });

  test("an account skipped without an exception is still reported as it happens", async () => {
    // Regression: the malformed-reply, wrong-account and bad-signature paths all
    // leave the per-account body early rather than by throwing. Reporting only
    // on the throwing paths left those accounts on screen as still pending
    // while the run moved on without them.
    const bench = harness({ restoreKey: async () => "not-a-reply" });
    const entries = await bench.run();

    expect(entries.map((entry) => entry.outcome)).toEqual(["skipped", "skipped"]);
    // One report for the list, then one for each account as it settles.
    expect(bench.progress).toHaveLength(3);
    expect(bench.progress[1]?.map((entry) => entry.outcome)).toEqual(["skipped", undefined]);
    expect(bench.progress[2]?.map((entry) => entry.outcome)).toEqual(["skipped", "skipped"]);
  });

  test("each per-account offer names its account, network and challenge", async () => {
    const bench = harness();
    await bench.run();
    expect(offered(bench.offers[1] as string)).toEqual({
      challenge: bench.challenges[0] as string,
      deviceId: FIRST,
      networkId: "SN_SEPOLIA",
      version: MOBILE_PQ_RESTORE_VERSION,
    });
  });
});

describe("decodeMobilePqRestoreList", () => {
  const listOf = (deviceIds: unknown, version: unknown = MOBILE_PQ_RESTORE_VERSION): string =>
    toBase64Url(JSON.stringify({ deviceIds, version }));

  test("refuses a version it does not speak", () => {
    expect(decodeMobilePqRestoreList(listOf([FIRST], 2))).toBeNull();
  });

  test("refuses an empty or non-string name", () => {
    // A name nobody can ask for would become an account the run cannot request.
    expect(decodeMobilePqRestoreList(listOf([""]))).toBeNull();
    expect(decodeMobilePqRestoreList(listOf(["  "]))).toBeNull();
    expect(decodeMobilePqRestoreList(listOf([7]))).toBeNull();
  });

  test("refuses a duplicate name", () => {
    // The run would ask twice and report the second as already present.
    expect(decodeMobilePqRestoreList(listOf([FIRST, FIRST]))).toBeNull();
  });

  test("accepts an empty selection", () => {
    // The user opened the picker and picked nothing. Not an error.
    expect(decodeMobilePqRestoreList(listOf([]))).toEqual([]);
  });

  test("refuses anything that is not the picker's answer", () => {
    expect(decodeMobilePqRestoreList("not-base64url!")).toBeNull();
    expect(decodeMobilePqRestoreList(toBase64Url("[]"))).toBeNull();
    expect(
      decodeMobilePqRestoreList(encodeMobilePqRestoreOffer({ networkId: "SN_MAIN" })),
    ).toBeNull();
    expect(
      decodeMobilePqRestoreList(
        encodeMobilePqRestoreKeyOffer({
          challenge: "0x1",
          deviceId: FIRST,
          networkId: "SN_MAIN",
        }),
      ),
    ).toBeNull();
  });
});
