/**
 * The QSB coordinator's origin is defined once (`QSB_COORDINATOR_ORIGIN`) and
 * is never a required host permission: adding one would be a privilege
 * increase that disables the installed wallet on update until the user
 * re-approves (issue 772). The UI requests exactly `QSB_COORDINATOR_PERMISSION`
 * at runtime, which the declared optional HTTPS pattern covers in Chrome's and
 * Firefox's manifests, and the CSP reaches it through `https:` with no named
 * source. The background asks the browser before every coordinator request.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { QSB_API_BASE_PATH, QSB_COORDINATOR_ORIGIN } from "@bramble/qsb/origin";
import { QSB_COORDINATOR_PERMISSION } from "@bramble/wallet-model/qsb-vaults";
import { type Manifest, toFirefoxManifest } from "../../apps/extension/firefox-manifest";

type HostManifest = {
  readonly content_security_policy: { readonly extension_pages: string };
  readonly host_permissions?: readonly string[];
  readonly optional_host_permissions?: readonly string[];
};

const chromeManifest = async (): Promise<HostManifest> =>
  JSON.parse(await readFile("apps/extension/public/manifest.json", "utf8"));

const bothManifests = async (): Promise<readonly HostManifest[]> => {
  const chrome = await chromeManifest();
  return [chrome, toFirefoxManifest(chrome as unknown as Manifest) as unknown as HostManifest];
};

// Whether a declared match pattern covers the permission: same scheme, and a
// host that is either the exact one or a `*` wildcard, with a `/*` path.
const covers = (pattern: string, permission: string): boolean => {
  if (pattern === permission) return true;
  const declared = /^(https):\/\/(\*|\*\.[^/]+|[^/*]+)\/\*$/u.exec(pattern);
  const wanted = /^(https):\/\/([^/*]+)\/\*$/u.exec(permission);
  if (!declared || !wanted) return false;
  const [, , host] = declared;
  const [, , exact] = wanted;
  if (host === "*") return true;
  return host?.startsWith("*.") === true && exact?.endsWith(host.slice(1)) === true;
};

describe("the QSB coordinator host", () => {
  test("is one exact HTTPS origin with the stable prefix, and the permission is its pattern", () => {
    const origin = new URL(QSB_COORDINATOR_ORIGIN);
    expect(origin.protocol).toBe("https:");
    expect(origin.origin).toBe(QSB_COORDINATOR_ORIGIN);
    expect(QSB_API_BASE_PATH).toBe("/v1");
    expect(QSB_COORDINATOR_PERMISSION).toBe(`${QSB_COORDINATOR_ORIGIN}/*`);
  });

  test("is not a required host permission in Chrome's or Firefox's manifest", async () => {
    for (const manifest of await bothManifests()) {
      const required = manifest.host_permissions ?? [];
      expect(
        required.filter((host) => host.includes(new URL(QSB_COORDINATOR_ORIGIN).host)),
      ).toEqual([]);
      expect(required.some((host) => covers(host, QSB_COORDINATOR_PERMISSION))).toBe(false);
    }
  });

  test("is covered by a declared optional pattern in both manifests", async () => {
    for (const manifest of await bothManifests()) {
      const optional = manifest.optional_host_permissions ?? [];
      expect(optional.some((pattern) => covers(pattern, QSB_COORDINATOR_PERMISSION))).toBe(true);
    }
  });

  test("is reached through the CSP's `https:` source, never named, and the gate pins neither", async () => {
    const csp = (await chromeManifest()).content_security_policy.extension_pages;
    const connect = csp.split(";").find((directive) => directive.trim().startsWith("connect-src"));
    const sources = connect?.trim().split(/\s+/u) ?? [];
    expect(sources).toContain("https:");
    expect(sources.filter((source) => source.startsWith("https://"))).toEqual([]);
    const gate = await readFile("scripts/check-extension-manifest.ts", "utf8");
    expect(gate).not.toContain(QSB_COORDINATOR_ORIGIN);
  });
});
