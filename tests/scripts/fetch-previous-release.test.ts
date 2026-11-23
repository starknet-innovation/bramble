/**
 * Pins which release the upgrade E2E test starts from.
 */
import { expect, test } from "bun:test";
import { previousReleaseTag } from "../../scripts/fetch-previous-release";

test("picks the newest X.Y.Z tag at or below the package version", () => {
  const tags = ["v0.9.12", "v0.10.9", "v0.10.10", "v0.10.10-rc1", "nightly", "v1.0"];
  // Bumped branch: the newest release is the one live users upgrade from.
  expect(previousReleaseTag(tags, "0.10.11")).toBe("v0.10.10");
  // Unbumped branch (package equals the latest release): still that release, not N-2.
  expect(previousReleaseTag(tags, "0.10.10")).toBe("v0.10.10");
  expect(previousReleaseTag(tags, "0.10.0")).toBe("v0.9.12");
  expect(previousReleaseTag(tags, "0.9.11")).toBeUndefined();
});

test("refuses a package version that is not X.Y.Z", () => {
  expect(() => previousReleaseTag([], "0.10")).toThrow("not X.Y.Z");
});
