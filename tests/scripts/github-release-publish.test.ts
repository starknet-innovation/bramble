/**
 * The release publisher's shell is the only code that runs with permission to
 * change a GitHub Release, and it does not check out the tag. These tests run
 * that shell against a fake `gh` and pin the copy inlined into the workflow.
 */

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dir, "../..");
const SCRIPT = join(REPO, "scripts/github-release-publish.sh");
const WORKFLOW = join(REPO, ".github/workflows/release-build.yml");

const MOCK_GH = `#!/bin/bash
set -euo pipefail
printf '%s\\n' "$*" >> "$MOCK_LOG"
for arg in "$@"; do
  if [ "$arg" = "--clobber" ] || [ "$arg" = "--cleanup-tag" ]; then
    echo "forbidden flag $arg" >&2
    exit 99
  fi
done
if [ "\${1:-}" != "release" ]; then
  echo "unexpected gh command" >&2
  exit 97
fi
cmd="\${2:-}"
state="$(cat "$MOCK_DIR/state")"
case "$cmd" in
  view)
    if [ "$state" = "missing" ]; then
      echo "no release" >&2
      exit 1
    fi
    json=""
    for arg in "$@"; do
      if [ "$arg" = "isDraft" ]; then json=isDraft; fi
      if [ "$arg" = "assets" ]; then json=assets; fi
    done
    if [ "$json" = "isDraft" ]; then
      if [ "$state" = "draft" ]; then echo true; else echo false; fi
      exit 0
    fi
    if [ "$json" = "assets" ]; then
      if [ -d "$MOCK_DIR/assets" ]; then
        for file in "$MOCK_DIR/assets"/*; do
          [ -f "$file" ] || continue
          basename "$file"
        done
      fi
      exit 0
    fi
    echo "unknown view" >&2
    exit 96
    ;;
  create)
    if [ -f "$MOCK_DIR/create-fails" ]; then
      echo draft > "$MOCK_DIR/state"
      echo "lost the create race" >&2
      exit 1
    fi
    if [ "$state" != "missing" ]; then
      echo "release exists" >&2
      exit 1
    fi
    draft=false
    verify=false
    for arg in "$@"; do
      [ "$arg" = "--draft" ] && draft=true
      [ "$arg" = "--verify-tag" ] && verify=true
      case "$arg" in
        *.zip|*.sha256)
          echo "asset attached at create" >&2
          exit 98
          ;;
      esac
    done
    if [ "$draft" != true ] || [ "$verify" != true ]; then
      echo "create must stay a draft until the tag is verified" >&2
      exit 95
    fi
    echo draft > "$MOCK_DIR/state"
    mkdir -p "$MOCK_DIR/assets"
    ;;
  upload)
    if [ "$state" = "missing" ]; then
      echo "no release" >&2
      exit 1
    fi
    shift 3
    mkdir -p "$MOCK_DIR/assets"
    for file in "$@"; do
      name="$(basename "$file")"
      if [ -e "$MOCK_DIR/assets/$name" ]; then
        echo "asset exists: $name" >&2
        exit 1
      fi
      cp "$file" "$MOCK_DIR/assets/$name"
    done
    ;;
  download)
    if [ "$state" = "missing" ]; then
      echo "no release" >&2
      exit 1
    fi
    dir=""
    prev=""
    for arg in "$@"; do
      if [ "$prev" = "--dir" ]; then dir="$arg"; fi
      prev="$arg"
    done
    mkdir -p "$dir"
    for file in "$MOCK_DIR/assets"/*; do
      [ -f "$file" ] || continue
      cp "$file" "$dir/"
    done
    ;;
  edit)
    found=false
    for arg in "$@"; do
      [ "$arg" = "--draft=false" ] && found=true
    done
    if [ "$found" != true ]; then
      echo "edit did not publish" >&2
      exit 94
    fi
    if [ "$state" = "missing" ]; then
      echo "no release" >&2
      exit 1
    fi
    echo published > "$MOCK_DIR/state"
    ;;
  delete)
    if [ -f "$MOCK_DIR/delete-fails" ]; then
      echo "cannot delete" >&2
      exit 1
    fi
    echo missing > "$MOCK_DIR/state"
    rm -rf "$MOCK_DIR/assets"
    mkdir -p "$MOCK_DIR/assets"
    ;;
  verify)
    if [ "$(cat "$MOCK_DIR/verify")" != ok ] || [ "$state" != "published" ]; then
      echo "no release attestation" >&2
      exit 1
    fi
    ;;
  verify-asset)
    file="\${4:-}"
    name="$(basename "$file")"
    if [ "$(cat "$MOCK_DIR/verify")" != ok ] || [ "$state" != "published" ]; then
      echo "no release attestation" >&2
      exit 1
    fi
    cmp -s "$file" "$MOCK_DIR/assets/$name"
    ;;
  *)
    echo "unknown release command $cmd" >&2
    exit 93
    ;;
esac
`;

type ReleaseFile = {
  readonly name: string;
  readonly bytes: string;
  readonly checksum: string;
};

const releaseFile = (name: string, bytes: string): ReleaseFile => {
  const digest = createHash("sha256").update(bytes).digest("hex");
  return { name, bytes, checksum: `${digest}  ${name}\n` };
};

const CHROME = releaseFile("bramble-1.2.3.zip", "chrome-bytes");
const FIREFOX = releaseFile("bramble-firefox-1.2.3.zip", "firefox-bytes");

const runPublish = async (
  options: {
    readonly state?: "missing" | "draft" | "published";
    readonly verify?: "ok" | "fail";
    readonly seeded?: readonly ReleaseFile[];
    readonly tag?: string;
    readonly createFails?: boolean;
    readonly deleteFails?: boolean;
    readonly notes?: boolean;
  } = {},
): Promise<{
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly log: string;
  readonly output: string;
  readonly state: string;
}> => {
  const root = await mkdtemp(join(tmpdir(), "bramble-release-"));
  try {
    const bin = join(root, "bin");
    const mock = join(root, "mock");
    const artifacts = join(root, "artifacts");
    const assets = join(mock, "assets");
    await mkdir(bin);
    await mkdir(assets, { recursive: true });
    await mkdir(artifacts);
    await writeFile(join(bin, "gh"), MOCK_GH);
    await chmod(join(bin, "gh"), 0o755);
    await writeFile(join(mock, "state"), options.state ?? "missing");
    await writeFile(join(mock, "verify"), options.verify ?? "ok");
    await writeFile(join(mock, "log"), "");
    if (options.createFails === true) await writeFile(join(mock, "create-fails"), "1");
    if (options.deleteFails === true) await writeFile(join(mock, "delete-fails"), "1");
    const onRelease =
      options.seeded ??
      (options.state === "draft" || options.state === "published" ? [CHROME, FIREFOX] : []);
    for (const file of [CHROME, FIREFOX]) {
      await writeFile(join(artifacts, file.name), file.bytes);
      await writeFile(join(artifacts, `${file.name}.sha256`), file.checksum);
    }
    for (const file of onRelease) {
      await writeFile(join(assets, file.name), file.bytes);
      await writeFile(join(assets, `${file.name}.sha256`), file.checksum);
    }
    if (options.notes !== false) {
      await writeFile(join(artifacts, "release-notes.md"), "notes\n");
    }
    const outputPath = join(root, "github-output");
    await writeFile(outputPath, "");
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env["PATH"] ?? ""}`,
      TAG: options.tag ?? "v1.2.3",
      ARTIFACT_DIR: artifacts,
      GITHUB_OUTPUT: outputPath,
      MOCK_DIR: mock,
      MOCK_LOG: join(mock, "log"),
      VERIFY_RETRY_SECONDS: "0",
    };
    const proc = Bun.spawn(["bash", SCRIPT], {
      cwd: root,
      env,
      stderr: "pipe",
      stdout: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    return {
      exitCode,
      stdout,
      stderr,
      log: await readFile(join(mock, "log"), "utf8"),
      output: await readFile(outputPath, "utf8"),
      state: await readFile(join(mock, "state"), "utf8"),
    };
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

const uploadNames = (log: string): string[] =>
  log
    .split("\n")
    .filter((line) => line.startsWith("release upload "))
    .flatMap((line) => line.split(" ").slice(3))
    .map((path) => path.split("/").at(-1) ?? path)
    .sort();

const published = (result: Awaited<ReturnType<typeof runPublish>>): void => {
  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
};

describe("GitHub release publication", () => {
  test("publishes a draft only after the assets match, and never replaces them", async () => {
    const result = await runPublish();
    published(result);
    expect(result.state.trim()).toBe("published");
    expect(result.output).toBe("published_now=true\n");
    expect(result.log).toContain("release create v1.2.3 --draft");
    expect(result.log).toContain("--verify-tag");
    expect(result.log).toContain("release edit v1.2.3 --draft=false");
    expect(result.log).toContain("release verify v1.2.3");
    expect(result.log).toContain("release verify-asset v1.2.3");
    expect(result.log).not.toContain("release delete");
    const uploads = uploadNames(result.log);
    expect(uploads).toEqual([
      "bramble-1.2.3.zip",
      "bramble-1.2.3.zip.sha256",
      "bramble-firefox-1.2.3.zip",
      "bramble-firefox-1.2.3.zip.sha256",
    ]);
  });

  test("deletes a release it just published when the attestation does not verify", async () => {
    const result = await runPublish({ verify: "fail" });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("attestation did not verify");
    expect(result.log).toContain("release delete v1.2.3 --yes");
    expect(result.log).not.toContain("--cleanup-tag");
    expect(result.state.trim()).toBe("missing");
    expect(result.output).not.toContain("published_now=true");
  });

  test("keeps a published release when deletion is already refused", async () => {
    const result = await runPublish({ deleteFails: true, verify: "fail" });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Could not delete v1.2.3.");
    expect(result.state.trim()).toBe("published");
  });

  test("leaves an already published matching release unchanged", async () => {
    const result = await runPublish({ state: "published" });
    published(result);
    expect(result.output).toBe("published_now=false\n");
    expect(result.log).not.toContain("release upload");
    expect(result.log).not.toContain("release create");
    expect(result.log).not.toContain("release delete");
    expect(result.stdout).toContain("Leaving it unchanged");
  });

  test("fails when published bytes differ and does not delete or upload", async () => {
    const different = releaseFile("bramble-1.2.3.zip", "other-bytes");
    const result = await runPublish({ seeded: [different, FIREFOX], state: "published" });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("does not match the built bytes");
    expect(result.log).not.toContain("release upload");
    expect(result.log).not.toContain("release delete");
    expect(result.state.trim()).toBe("published");
  });

  test("uploads only assets that are not already on a draft", async () => {
    const result = await runPublish({ seeded: [CHROME], state: "draft" });
    published(result);
    expect(uploadNames(result.log)).toEqual([
      "bramble-firefox-1.2.3.zip",
      "bramble-firefox-1.2.3.zip.sha256",
    ]);
  });

  test("finishes a draft when creating the release loses a race", async () => {
    const result = await runPublish({ createFails: true });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("lost the create race");
    expect(result.stdout).toContain("continuing if a release now exists");
    expect(result.state.trim()).toBe("published");
  });

  test("rejects a tag that is not vX.Y.Z before calling gh", async () => {
    const result = await runPublish({ tag: "v1.2.3-rc.1" });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Release tag must match vX.Y.Z exactly.");
    expect(result.log).toBe("");
  });

  test("the workflow publish job inlines this script", async () => {
    const script = (await Bun.file(SCRIPT).text()).replace(/\n$/, "");
    const indented = script
      .split("\n")
      .map((line) => (line.length === 0 ? "" : `          ${line}`))
      .join("\n");
    expect(await Bun.file(WORKFLOW).text()).toContain(indented);
  });
});
