/**
 * Browser data-collection consent for product analytics.
 *
 * The Firefox manifest declares `technicalAndInteraction` as an OPTIONAL data
 * collection, which is a promise that unticking it at install turns the
 * collection off. The wallet's own preference cannot keep that promise — it
 * defaults to on and knows nothing about the install dialog — so these cases
 * are the promise itself: a refused consent withholds analytics, an absent
 * concept (Chromium) changes nothing, and a consent that cannot be read is
 * treated as refused.
 */
import { describe, expect, test } from "bun:test";
import {
  type DataConsentPermissions,
  observeTechnicalDataConsent,
  TECHNICAL_DATA_COLLECTION,
  technicalDataAllowed,
} from "../../../apps/extension/src/background/analytics/data-consent";

/** A Firefox-shaped runtime: it reports a `data_collection` set from `getAll`. */
const firefoxPermissions = (granted: boolean): DataConsentPermissions => ({
  contains: async () => granted,
  getAll: async () => ({ data_collection: granted ? ["technicalAndInteraction"] : [] }),
});

/**
 * A Chromium-shaped runtime: `contains` and `getAll` both exist, `getAll`
 * reports no data-collection set, and `contains` REJECTS the unknown property.
 * Reading that rejection as a refusal is what disabled analytics for every
 * Chromium user.
 */
const chromiumPermissions: DataConsentPermissions = {
  contains: async () => {
    throw new Error("Unexpected property: 'data_collection'");
  },
  getAll: async () => ({ permissions: ["alarms"] }) as { readonly data_collection?: never },
};

describe("technical data consent", () => {
  test("asks the browser about the exact collection the manifest declares", async () => {
    const asked: unknown[] = [];
    await technicalDataAllowed({
      contains: async (permissions) => {
        asked.push(permissions);
        return true;
      },
      getAll: async () => ({ data_collection: ["technicalAndInteraction"] }),
    });

    expect(asked).toEqual([{ data_collection: ["technicalAndInteraction"] }]);
    expect(TECHNICAL_DATA_COLLECTION).toBe("technicalAndInteraction");
  });

  test("allows collection the user consented to", async () => {
    expect(await technicalDataAllowed(firefoxPermissions(true))).toBe(true);
  });

  test("withholds collection the user refused", async () => {
    expect(await technicalDataAllowed(firefoxPermissions(false))).toBe(false);
  });

  // Chromium has no data-collection permissions. Reporting "refused" there
  // would silently disable analytics the user did choose to leave on.
  test("allows collection on a browser with no such concept", async () => {
    expect(await technicalDataAllowed({})).toBe(true);
    expect(await technicalDataAllowed(undefined)).toBe(true);
  });

  // The regression that matters: Chromium HAS `permissions.contains`, so its
  // presence cannot mean "supports data collection". Chromium rejects the
  // unknown property, and reading that as a refusal turned analytics off for
  // every Chromium user regardless of their setting.
  test("allows collection on chromium, which rejects the query it does not know", async () => {
    expect(await technicalDataAllowed(chromiumPermissions)).toBe(true);
  });

  test("never asks chromium about a collection it does not implement", async () => {
    let asked = 0;
    await technicalDataAllowed({
      contains: async () => {
        asked += 1;
        return false;
      },
      getAll: async () => ({ permissions: [] }) as { readonly data_collection?: never },
    });

    expect(asked).toBe(0);
  });

  // Without `getAll` there is no way to show the browser knows about data
  // collection, so a `contains` answer from it cannot be read as a refusal.
  test("allows collection when the browser cannot report its permission set", async () => {
    expect(await technicalDataAllowed({ contains: async () => false })).toBe(true);
  });

  test("treats an unreadable permission set as a browser without the concept", async () => {
    expect(
      await technicalDataAllowed({
        contains: async () => false,
        getAll: async () => {
          throw new Error("unavailable");
        },
      }),
    ).toBe(true);
  });

  // A browser that implements the concept and then fails the query has not
  // told us the user consented, and unconfirmed consent is not consent.
  test("withholds collection when the browser refuses to answer", async () => {
    expect(
      await technicalDataAllowed({
        contains: async () => {
          throw new Error("unavailable");
        },
        getAll: async () => ({ data_collection: [] }),
      }),
    ).toBe(false);
  });
});

describe("consent changes", () => {
  test("re-checks when a permission is added or removed", () => {
    const added: Array<() => void> = [];
    const removed: Array<() => void> = [];
    let checks = 0;
    const permissions: DataConsentPermissions = {
      onAdded: { addListener: (listener) => added.push(listener) },
      onRemoved: { addListener: (listener) => removed.push(listener) },
    };
    observeTechnicalDataConsent(permissions, () => {
      checks += 1;
    });
    added[0]?.();
    removed[0]?.();

    expect(checks).toBe(2);
  });

  test("registers nothing on a runtime without the events", () => {
    expect(() => observeTechnicalDataConsent({}, () => undefined)).not.toThrow();
    expect(() => observeTechnicalDataConsent(undefined, () => undefined)).not.toThrow();
  });
});
