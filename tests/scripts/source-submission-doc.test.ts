/**
 * Keeps BUILDING.md's AMO source-submission recipe tied to the repository it
 * documents.
 *
 * The instructions are only true while the toolchain they name is the release the
 * repository pins and every command they show is a real package script. A Bun pin
 * bump or a renamed script would otherwise leave the document quietly wrong, and a
 * reviewer would only discover that by producing an archive that does not match the
 * submitted add-on.
 */
import { describe, expect, test } from "bun:test";
import { EXPECTED_PACKAGE_MANAGER } from "../../scripts/config-standards-policy";
import { readWorkflowSources } from "../../scripts/workflow-inventory";

const documentText = (): Promise<string> => Bun.file("BUILDING.md").text();

const packageManifest = async (): Promise<{
  readonly packageManager?: string;
  readonly scripts?: Record<string, string>;
}> =>
  (await Bun.file("package.json").json()) as {
    readonly packageManager?: string;
    readonly scripts?: Record<string, string>;
  };

describe("AMO source-submission build document", () => {
  test("names the Bun release the repository pins", async () => {
    expect((await packageManifest()).packageManager).toBe(EXPECTED_PACKAGE_MANAGER);
    expect(await documentText()).toContain(`Bun ${EXPECTED_PACKAGE_MANAGER.replace("bun@", "")}`);
  });

  test("every workflow pins the same Bun release", async () => {
    const version = EXPECTED_PACKAGE_MANAGER.replace("bun@", "");
    const sources = await readWorkflowSources(".github/workflows");
    const pinned = Object.entries(sources).flatMap(([name, text]) =>
      [...text.matchAll(/bun-version:\s*([^\s#]+)/g)].map((match) => ({
        name,
        version: match[1] ?? "",
      })),
    );

    // The release pipeline is expected to pin the toolchain, so a run with no
    // match at all is a failure rather than a vacuous pass.
    expect(pinned.length).toBeGreaterThan(0);
    expect(pinned.filter((entry) => entry.version !== version)).toEqual([]);
  });

  test("documents only package scripts that exist", async () => {
    const scripts = (await packageManifest()).scripts ?? {};
    const commands = [...(await documentText()).matchAll(/bun run ([a-z][\w:.-]*)/g)]
      .map((match) => match[1])
      .filter((name): name is string => name !== undefined);

    expect(commands.length).toBeGreaterThan(0);
    for (const name of commands) {
      expect(Object.hasOwn(scripts, name)).toBe(true);
    }
  });

  test("documents the git repository the vendor guard requires", async () => {
    const text = await documentText();
    // The exact command, not the bare phrase the surrounding prose also uses.
    expect(text).toContain("git init -b main .");
    expect(text).toContain("bun run package:extension:firefox");
  });
});
