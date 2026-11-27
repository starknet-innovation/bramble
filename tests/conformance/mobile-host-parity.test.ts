/**
 * The iOS and Android apps are two hosts over one Rust core and one generated copy set, and they
 * drifted apart once already (#977: token management, the multisig flow and Home's private-balance
 * lines existed on iOS only). This catches part of that drift: every top-level core function the
 * Android app imports is called by the iOS app, and every generated copy key one app reads, the
 * other reads too. A difference is either a feature to port, or a platform difference named below
 * with its reason. The Swift side has no imports to read, so core calls are checked one way only,
 * and methods on core objects (`activityBook().scanApply`) are not checked at all.
 */
import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const IOS = "mobile/ios/Bramble";
const ANDROID = "mobile/android/app/src/main/java/org/bramble/wallet";

/** Copy objects generated for both platforms (`scripts/generate-mobile-assets.ts`). */
const COPY_OBJECTS = ["BrambleCopy", "SendCopy", "PrivacyCopy"] as const;

/** Core functions and copy keys only one platform uses, each for a platform reason. */
const PLATFORM_ONLY: Readonly<Record<string, string>> = {
  // Android times the copy control's check from the core; iOS uses the shared `CopyButton` timing.
  "core:copyFeedback": "Android's copy control reads its confirmation time from the core",
  // Android names the Keystore tier that holds the biometric key; iOS has no StrongBox.
  "BrambleCopy.keyStorageSecureHardware": "Android Keystore wording",
  "BrambleCopy.keyStorageStrongBox": "Android Keystore wording",
  // iOS detects a screenshot after the fact; Android blocks it with FLAG_SECURE instead.
  "BrambleCopy.screenshotWarning": "iOS screenshot detection",
};

const sources = async (dir: string, extension: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path, extension);
      const own = entry.name.endsWith(extension) && !entry.name.includes(".generated.");
      return own ? [path] : [];
    }),
  );
  return nested.flat();
};

const read = async (dir: string, extension: string): Promise<string> =>
  (await Promise.all((await sources(dir, extension)).map((path) => readFile(path, "utf8")))).join(
    "\n",
  );

const keys = (source: string, object: string): Set<string> =>
  new Set(
    [...source.matchAll(new RegExp(`\\b${object}\\.(\\w+)`, "g"))].map((m) => `${object}.${m[1]}`),
  );

const allowed = (name: string): boolean => name in PLATFORM_ONLY;

describe("mobile host parity", () => {
  test("every core function Android imports, iOS calls", async () => {
    const kotlin = await read(ANDROID, ".kt");
    const swift = await read(IOS, ".swift");
    const imported = new Set(
      [...kotlin.matchAll(/^import org\.bramble\.core\.([a-z]\w*)$/gm)].map((m) => m[1] ?? ""),
    );
    expect(imported.size).toBeGreaterThan(20);
    const missing = [...imported]
      .filter((name) => !new RegExp(`\\b${name}\\(`).test(swift))
      .map((name) => `core:${name}`)
      .filter((name) => !allowed(name));
    expect(missing).toEqual([]);
  });

  test("both apps read the same generated copy keys", async () => {
    const kotlin = await read(ANDROID, ".kt");
    const swift = await read(IOS, ".swift");
    const drift: string[] = [];
    for (const object of COPY_OBJECTS) {
      const android = keys(kotlin, object);
      const ios = keys(swift, object);
      for (const key of android)
        if (!ios.has(key) && !allowed(key)) drift.push(`Android only: ${key}`);
      for (const key of ios) if (!android.has(key) && !allowed(key)) drift.push(`iOS only: ${key}`);
    }
    expect(drift).toEqual([]);
  });

  test("every platform exception is still a real difference", async () => {
    const kotlin = await read(ANDROID, ".kt");
    const swift = await read(IOS, ".swift");
    const stale = Object.keys(PLATFORM_ONLY).filter((name) => {
      const [object, key] = name.startsWith("core:") ? ["", name.slice(5)] : name.split(".");
      const pattern = object ? new RegExp(`\\b${object}\\.${key}\\b`) : new RegExp(`\\b${key}\\(`);
      return pattern.test(kotlin) === pattern.test(swift);
    });
    expect(stale).toEqual([]);
  });
});
