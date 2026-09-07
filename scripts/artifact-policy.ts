/**
 * Checks that extension builds and release artifacts retain their fail-closed
 * validation, exact file set, reproducible archive, and checksum ordering.
 */
import { pinnedActionLine } from "./workflow-inventory";

/**
 * Every ordering failure in the build and release-artifact policy, or an empty
 * list when the sources satisfy it. Pure over the three sources it is handed:
 * it reads no files and throws on none of them, so a caller that cannot read a
 * source must fail on its own rather than pass an empty string here.
 */
export const artifactPolicyFailures = (
  buildScript: string,
  ciWorkflow: string,
  packageScript: string,
): string[] => {
  const failures: string[] = [];
  const ciLines = ciWorkflow.split("\n").map((line) => line.trim());
  const packageCommandIndex = ciLines.indexOf("- run: bun run package:extension");
  // Pin grammar comes from ./workflow-inventory so this gate cannot drift from
  // the workflow security policy; 0 (absent) sorts before every found index.
  const uploadActionIndex = pinnedActionLine(ciWorkflow, "actions/upload-artifact@") - 1;
  const uploadNameIndex = ciLines.indexOf("name: bramble-extension");
  const uploadZipIndex = ciLines.indexOf("artifacts/*.zip");
  const uploadChecksumIndex = ciLines.indexOf("artifacts/*.zip.sha256");
  const uploadRequiredIndex = ciLines.indexOf("if-no-files-found: error");
  if (
    uploadActionIndex <= packageCommandIndex ||
    uploadNameIndex <= uploadActionIndex ||
    uploadZipIndex <= uploadNameIndex ||
    uploadChecksumIndex <= uploadZipIndex ||
    uploadRequiredIndex <= uploadChecksumIndex
  ) {
    failures.push(".github/workflows/ci.yml must upload the release zip and SHA-256 checksum");
  }

  const buildExtensionCheck = buildScript.indexOf('await run(["bun", "run", "check:extension"]);');
  const buildKrustyCheck = buildScript.indexOf('await run(["bun", "run", "check:krusty"]);');
  const buildPrivacyCheck = buildScript.indexOf('await run(["bun", "run", "check:privacy"]);');
  const buildDistClear = buildScript.indexOf("await rm(outdir");
  if (
    buildExtensionCheck === -1 ||
    buildKrustyCheck === -1 ||
    buildPrivacyCheck === -1 ||
    buildDistClear === -1 ||
    buildExtensionCheck > buildDistClear ||
    buildKrustyCheck > buildDistClear ||
    buildPrivacyCheck > buildDistClear
  ) {
    failures.push(
      "apps/extension/build.ts must check manifest and pinned runtimes before building",
    );
  }

  const packageTouch = packageScript.indexOf('await run(["touch", "-t", reproducibleZipTime');
  const packageZip = packageScript.indexOf('await run(["zip", "-X", "-q", zipPath');
  const packageRuntimeImport = packageScript.indexOf(
    'import { EXPECTED_RUNTIME_FILES } from "./extension-runtime-files";',
  );
  const packageRuntimeCheck = packageScript.indexOf(
    'files.join("\\n") !== EXPECTED_RUNTIME_FILES.join("\\n")',
  );
  const packageRuntimeFailure = packageScript.indexOf("unexpected packaged files");
  if (
    packageRuntimeImport === -1 ||
    packageRuntimeCheck === -1 ||
    packageRuntimeFailure === -1 ||
    packageRuntimeImport > packageRuntimeCheck ||
    packageRuntimeCheck > packageZip ||
    packageRuntimeFailure < packageRuntimeCheck
  ) {
    failures.push("scripts/package-extension.ts must package only the pinned runtime files");
  }

  const packageZipNamePrefix = packageScript.indexOf("const zipName = `bramble-");
  const packageZipNameVersion = packageScript.indexOf('manifest["version"]', packageZipNamePrefix);
  const packageZipNameSuffix = packageScript.indexOf(".zip`;", packageZipNameVersion);
  const packageZipPath = packageScript.indexOf("const zipPath = resolve(artifactDir, zipName);");
  if (
    packageZipNamePrefix === -1 ||
    packageZipNameVersion === -1 ||
    packageZipNameSuffix === -1 ||
    packageZipPath === -1 ||
    packageZipNamePrefix > packageZipNameVersion ||
    packageZipNameVersion > packageZipNameSuffix ||
    packageZipNameSuffix > packageZipPath ||
    packageZipPath > packageZip
  ) {
    failures.push("scripts/package-extension.ts must name release zips from the manifest version");
  }
  if (packageTouch === -1 || packageZip === -1 || packageTouch > packageZip) {
    failures.push("scripts/package-extension.ts must normalize mtimes before zipping");
  }

  const packageDigest = packageScript.indexOf('createHash("sha256")');
  const packageChecksumWrite = packageScript.indexOf("await writeFile(");
  const packageChecksumSuffix = packageScript.indexOf(".sha256");
  if (
    packageZip === -1 ||
    packageDigest === -1 ||
    packageChecksumWrite === -1 ||
    packageChecksumSuffix === -1 ||
    packageZip > packageDigest ||
    packageDigest > packageChecksumWrite ||
    packageChecksumWrite > packageChecksumSuffix
  ) {
    failures.push("scripts/package-extension.ts must write a SHA-256 checksum after zipping");
  }
  return failures;
};
