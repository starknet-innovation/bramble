/**
 * Remote feature flags end to end, against the built extension.
 *
 * Egress is blackholed, so the flags CDN is routed to a local fixture that
 * serves a correctly shaped, canonically signed bramble-ff document. The
 * fixture's key is an ephemeral test key presented under the production
 * keyId: the build must fetch it with a bare GET, refuse it (bad signature),
 * and keep answering bundled defaults — even though the document tries to
 * kill `swap.enabled`. A production build never trusts a
 * test key, so acceptance itself is covered by the unit suites.
 */
import { FEATURE_FLAG_URL } from "@bramble/flags/catalog";
import { FEATURE_FLAG_ALARM } from "../../apps/extension/src/background/flags/feature-flag-alarm";
import {
  createTestPublisher,
  payload,
  stamp,
} from "../../packages/features/flags/tests/support/flag-fixture";
import { expect, test } from "./fixtures";
import { sendRuntimeMessage } from "./wallet-helpers";

type ServedRequest = {
  readonly headers: Record<string, string>;
  readonly method: string;
  readonly url: string;
};

test("fetches the signed flag document privately and fails closed on a foreign key", async ({
  extension,
}) => {
  const publisher = await createTestPublisher("flags-2026-11");
  const now = Date.now();
  const document = await publisher.sign(
    payload({
      expiresAt: stamp(now + 7 * 86_400_000),
      issuedAt: stamp(now - 60_000),
      sequence: 42,
    }),
  );
  const served: ServedRequest[] = [];
  await extension.context.route(FEATURE_FLAG_URL, async (route) => {
    const request = route.request();
    served.push({
      headers: await request.allHeaders(),
      method: request.method(),
      url: request.url(),
    });
    await route.fulfill({
      body: document,
      // The wallet holds no host permission for the CDN (issue 772), so the
      // read only succeeds because the CDN answers CORS like bramble-ff's R2
      // bucket does.
      headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=300" },
      contentType: "application/json",
    });
  });

  // The worker's startup refresh ran before the route existed and hit the
  // blackhole. Firing the refresh alarm drives a forced refresh.
  const fireRefreshAlarm = () =>
    extension.serviceWorker.evaluate((name) => {
      const extensionGlobal = globalThis as typeof globalThis & {
        readonly chrome: {
          readonly alarms: { readonly create: (n: string, i: { when: number }) => void };
        };
      };
      extensionGlobal.chrome.alarms.create(name, { when: Date.now() });
    }, FEATURE_FLAG_ALARM);

  await fireRefreshAlarm();
  await expect.poll(() => served.length, { timeout: 15_000 }).toBeGreaterThan(0);
  const [request] = served as [ServedRequest];
  expect(request.method).toBe("GET");
  expect(request.url).toBe(FEATURE_FLAG_URL);
  expect(new URL(request.url).search).toBe("");
  expect(request.headers["cookie"]).toBeUndefined();
  expect(request.headers["referer"]).toBeUndefined();

  // Refreshes are serialized, so a second fetch can only start once the first
  // refresh has fully verified (and refused) its document.
  await fireRefreshAlarm();
  await expect.poll(() => served.length, { timeout: 15_000 }).toBeGreaterThan(1);

  const page = await extension.openExtensionPage("popup.html");
  expect(await sendRuntimeMessage(page, { type: "wallet.featureFlags" })).toEqual({
    flags: { "qsb.vaults": false, "swap.enabled": true },
    killed: [],
    ok: true,
    overridable: ["qsb.vaults"],
    overridden: [],
    sequence: null,
    source: "bundled",
  });
  // Local overrides need an unlocked wallet; this one has no vault yet.
  expect(
    await sendRuntimeMessage(page, {
      key: "swap.enabled",
      type: "wallet.setFeatureFlagOverride",
      value: false,
    }),
  ).toEqual({ error: "wallet locked" });
});
