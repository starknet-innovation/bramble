/**
 * The QSB coordinator's origin is defined once (`QSB_COORDINATOR_ORIGIN`) and
 * granted exactly there: the one host permission for it, in Chrome's and
 * Firefox's manifests and in the manifest gate's pinned list, and the one
 * explicit `connect-src` source in the extension CSP. Its API allows no other
 * CORS origin, so without the grant the worker cannot reach it; with a wider
 * one it could reach what it should not.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { QSB_API_BASE_PATH, QSB_COORDINATOR_ORIGIN } from "@bramble/qsb/origin";
import { type Manifest, toFirefoxManifest } from "../../apps/extension/firefox-manifest";

const manifest = async (): Promise<{
  readonly content_security_policy: { readonly extension_pages: string };
  readonly host_permissions: readonly string[];
}> => JSON.parse(await readFile("apps/extension/public/manifest.json", "utf8"));

const coordinatorHosts = (hosts: readonly string[]): readonly string[] =>
  hosts.filter((host) => host.includes("cloudfront.net"));

describe("the QSB coordinator host", () => {
  test("is one exact HTTPS origin with the stable prefix", () => {
    const origin = new URL(QSB_COORDINATOR_ORIGIN);
    expect(origin.protocol).toBe("https:");
    expect(origin.origin).toBe(QSB_COORDINATOR_ORIGIN);
    expect(QSB_API_BASE_PATH).toBe("/v1");
  });

  test("is granted exactly, in Chrome's and Firefox's manifests", async () => {
    const chrome = await manifest();
    const firefox = toFirefoxManifest(chrome as unknown as Manifest) as unknown as {
      readonly host_permissions?: readonly string[];
    };
    for (const hosts of [chrome.host_permissions, firefox.host_permissions ?? []]) {
      expect(coordinatorHosts(hosts)).toEqual([`${QSB_COORDINATOR_ORIGIN}/*`]);
    }
  });

  test("is the CSP's one named connect-src source, and the gate pins both", async () => {
    const csp = (await manifest()).content_security_policy.extension_pages;
    const connect = csp.split(";").find((directive) => directive.trim().startsWith("connect-src"));
    expect(
      connect
        ?.trim()
        .split(/\s+/)
        .filter((source) => source.startsWith("https://")),
    ).toEqual([QSB_COORDINATOR_ORIGIN]);
    const gate = await readFile("scripts/check-extension-manifest.ts", "utf8");
    expect(gate).toContain(`"${QSB_COORDINATOR_ORIGIN}/*"`);
    expect(gate).toContain(`connect-src 'self' ${QSB_COORDINATOR_ORIGIN} https:`);
  });
});
