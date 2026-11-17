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
  const buildArgentCheck = buildScript.indexOf('await run(["bun", "run", "check:argent"]);');
  const buildPrivacyCheck = buildScript.indexOf('await run(["bun", "run", "check:privacy"]);');
  const buildDistClear = buildScript.indexOf("await rm(outdir");
  // `await rm(outdir` now sits inside `emit()`, so its source position no
  // longer implies when it RUNS. The call site is pinned separately: without
  // this, hoisting the emission above the gates — or deleting it so the build
  // silently produces nothing — both passed.
  const buildEmitCall = buildScript.indexOf("await Promise.all(buildTargets.map(emit))");
  if (
    buildExtensionCheck === -1 ||
    buildKrustyCheck === -1 ||
    buildArgentCheck === -1 ||
    buildPrivacyCheck === -1 ||
    buildDistClear === -1 ||
    buildExtensionCheck > buildDistClear ||
    buildKrustyCheck > buildDistClear ||
    buildArgentCheck > buildDistClear ||
    buildPrivacyCheck > buildDistClear ||
    buildEmitCall === -1 ||
    buildExtensionCheck > buildEmitCall ||
    buildKrustyCheck > buildEmitCall ||
    buildArgentCheck > buildEmitCall ||
    buildPrivacyCheck > buildEmitCall
  ) {
    failures.push(
      "apps/extension/build.ts must check manifest and pinned runtimes before building",
    );
  }

  const packageTouch = packageScript.indexOf('await run(["touch", "-t", reproducibleZipTime');
  const packageZip = packageScript.indexOf('await run(["zip", "-X", "-q", zipPath');
  const packageRuntimeImport = packageScript.indexOf(
    'import { EXPECTED_RUNTIME_FILES, FIREFOX_RUNTIME_FILES } from "./extension-runtime-files";',
  );
  // The packaged set is selected per target, so the selection itself is pinned:
  // both lists must come from the reviewed module above, and neither target may
  // be packaged against a set assembled anywhere else.
  const packageRuntimeSelection = packageScript.indexOf(
    'const expectedFiles = target === "firefox" ? FIREFOX_RUNTIME_FILES : EXPECTED_RUNTIME_FILES;',
  );
  const packageRuntimeCheck = packageScript.indexOf(
    'files.join("\\n") !== expectedFiles.join("\\n")',
  );
  const packageRuntimeFailure = packageScript.indexOf("unexpected packaged files");
  if (
    packageRuntimeImport === -1 ||
    packageRuntimeSelection === -1 ||
    packageRuntimeSelection < packageRuntimeImport ||
    packageRuntimeCheck === -1 ||
    packageRuntimeFailure === -1 ||
    packageRuntimeImport > packageRuntimeCheck ||
    packageRuntimeCheck > packageZip ||
    packageRuntimeFailure < packageRuntimeCheck
  ) {
    failures.push("scripts/package-extension.ts must package only the pinned runtime files");
  }

  // Both branches are pinned by their full template literal. Matching only
  // `const zipName =` let the Chrome branch satisfy the whole ordering chain
  // while the Firefox name went unchecked — a Gecko zip could then drop the
  // manifest version, which is the exact drift this policy exists to stop.
  const packageZipNamePrefix = packageScript.indexOf("`bramble-$" + '{manifest["version"]}.zip`');
  const packageFirefoxZipName = packageScript.indexOf(
    "`bramble-firefox-$" + '{manifest["version"]}.zip`',
  );
  const packageZipNameVersion = packageScript.indexOf('manifest["version"]', packageZipNamePrefix);
  const packageZipNameSuffix = packageScript.indexOf(".zip`;", packageZipNameVersion);
  const packageZipPath = packageScript.indexOf("const zipPath = resolve(artifactDir, zipName);");
  if (
    packageZipNamePrefix === -1 ||
    packageFirefoxZipName === -1 ||
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
  // Matched on the write itself rather than on the first ".sha256" in the file:
  // the script now also DELETES a stale checksum before zipping, so a bare
  // occurrence test would have accepted that deletion as the write.
  const packageChecksumWrite = packageScript.indexOf("await writeFile(`$" + "{zipPath}.sha256`");
  if (
    packageZip === -1 ||
    packageDigest === -1 ||
    packageChecksumWrite === -1 ||
    packageZip > packageDigest ||
    packageDigest > packageChecksumWrite
  ) {
    failures.push("scripts/package-extension.ts must write a SHA-256 checksum after zipping");
  }
  return failures;
};
