/**
 * MCW-V09-131: the workflow inventory that every workflow gate iterates must be
 * the directory, not a filter that a contributor can step outside of. GitHub
 * executes `.github/workflows/*.yaml` exactly as it executes `*.yml`, and a
 * `.yaml` workflow taking `pull_request_target`, `write-all`, and the
 * self-hosted runner once passed every gate because only `.yml` was read.
 *
 * These tests drive the real reader against a scratch directory, so the
 * extension rule is pinned in both directions: what enters the inventory, and
 * what makes the reader refuse to report success.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWorkflowSources, WORKFLOW_DIR } from "../../scripts/workflow-inventory";

const scratchDirectory = async (files: Readonly<Record<string, string>>): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "mc-wallet-workflows-"));
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(join(directory, name), contents, "utf8");
  }
  return directory;
};

describe("workflow inventory", () => {
  test("reads both extensions GitHub executes", async () => {
    const directory = await scratchDirectory({
      "a.yml": "name: a\n",
      "b.yaml": "name: b\n",
    });

    expect(await readWorkflowSources(directory)).toEqual({
      "a.yml": "name: a\n",
      "b.yaml": "name: b\n",
    });
  });

  test("refuses a directory holding a file that is not a workflow", async () => {
    const directory = await scratchDirectory({ "a.yml": "name: a\n", "notes.md": "# notes\n" });

    await expect(readWorkflowSources(directory)).rejects.toThrow("notes.md");
  });

  test("refuses an empty directory rather than reporting nothing to check", async () => {
    const directory = await scratchDirectory({});

    await expect(readWorkflowSources(directory)).rejects.toThrow("would check nothing");
  });

  test("defaults to the repository workflow directory", async () => {
    expect(WORKFLOW_DIR).toBe(".github/workflows");
    expect(Object.keys(await readWorkflowSources())).toContain("ci.yml");
  });
});
