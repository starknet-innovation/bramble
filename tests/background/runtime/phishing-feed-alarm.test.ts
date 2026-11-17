/**
 * The phishing feed's refresh runs on a recurring alarm, not only on worker
 * start (Sherlock 182). The feed's TTL still decides whether a wake fetches.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createPhishingFeed } from "@bramble/permissions/phishing-feed";
import { createMemoryStore } from "@bramble/store/kv";
import {
  PHISHING_FEED_ALARM,
  PHISHING_FEED_PERIOD_MINUTES,
  type PhishingFeedAlarmsApi,
  schedulePhishingFeedRefresh,
} from "../../../apps/extension/src/background/runtime/phishing-feed-alarm";

const fakeAlarms = () => {
  const created: { readonly name: string; readonly periodInMinutes: number }[] = [];
  const listeners: ((alarm: { readonly name: string }) => void)[] = [];
  const api: PhishingFeedAlarmsApi = {
    create: (name, info) => {
      created.push({ name, periodInMinutes: info.periodInMinutes });
    },
    onAlarm: { addListener: (listener) => listeners.push(listener) },
  };
  return {
    api,
    created,
    fire: (name: string) => {
      for (const listener of listeners) listener({ name });
    },
  };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("schedulePhishingFeedRefresh", () => {
  test("refreshes now, arms one recurring alarm, and refreshes on that alarm only", async () => {
    const alarms = fakeAlarms();
    let refreshes = 0;
    expect(
      schedulePhishingFeedRefresh(alarms.api, async () => {
        refreshes += 1;
      }),
    ).toBe(true);
    expect(refreshes).toBe(1);
    expect(alarms.created).toEqual([
      { name: PHISHING_FEED_ALARM, periodInMinutes: PHISHING_FEED_PERIOD_MINUTES },
    ]);
    alarms.fire("bramble:session-expiry");
    expect(refreshes).toBe(1);
    alarms.fire(PHISHING_FEED_ALARM);
    expect(refreshes).toBe(2);
  });

  test("keeps refresh-on-start without an alarms API, and swallows refresh failures", async () => {
    let refreshes = 0;
    expect(
      schedulePhishingFeedRefresh(undefined, async () => {
        refreshes += 1;
        throw new Error("offline");
      }),
    ).toBe(false);
    await flush();
    expect(refreshes).toBe(1);
    const refusing: PhishingFeedAlarmsApi = {
      create: () => {
        throw new Error("no alarms");
      },
      onAlarm: { addListener: () => undefined },
    };
    expect(schedulePhishingFeedRefresh(refusing, async () => undefined)).toBe(false);
  });

  test("an alarm wake after the TTL fetches a fresh list into a long-lived feed", async () => {
    const alarms = fakeAlarms();
    let clock = 1_700_000_000_000;
    let list = ["old-evil.example"];
    const feed = createPhishingFeed({
      fetch: async () => new Response(JSON.stringify({ blocklist: list })),
      now: () => clock,
      store: createMemoryStore(),
    });
    schedulePhishingFeedRefresh(alarms.api, feed.refresh);
    await flush();
    expect(feed.blockedDomains().has("old-evil.example")).toBe(true);

    list = ["new-evil.example"];
    clock += 7 * 60 * 60 * 1000;
    alarms.fire(PHISHING_FEED_ALARM);
    await flush();
    await flush();
    expect(feed.blockedDomains().has("new-evil.example")).toBe(true);
  });

  test("the background root schedules the feed through the alarm", async () => {
    const source = await readFile(
      join(import.meta.dir, "../../../apps/extension/src/background/index.ts"),
      "utf8",
    );
    expect(source).toContain(
      "schedulePhishingFeedRefresh(extensionApi?.alarms, phishingFeed.refresh)",
    );
    expect(source).not.toContain("phishingFeed?.refresh()");
  });
});
