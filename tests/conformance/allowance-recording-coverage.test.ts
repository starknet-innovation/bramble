/**
 * MCW-V09-108, anti-drift: the allowance log is only as good as its coverage.
 * A background module that broadcasts calls it did not build itself can grant a
 * spending allowance, and one that never files that grant leaves the manager
 * unable to show or revoke it — and leaves the running total a later
 * `increase_allowance` is added to wrong. These scans fail the moment a new
 * submitting path (or a second "does this grant spend?" list) is added without
 * being wired to the shared recorder.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

const REPO_DIR = join(import.meta.dir, "../..");
const BACKGROUND_DIR = join(REPO_DIR, "apps/extension/src/background");
// Every workspace source root, so a second "does this grant spend?" list is
// caught wherever the capability packages put it. Tests and tooling are
// deliberately excluded: only shipped source may declare the vocabulary.
const SOURCE_ROOTS: readonly string[] = [
  BACKGROUND_DIR,
  ...readdirSync(join(REPO_DIR, "packages"), { withFileTypes: true })
    .filter((group) => group.isDirectory())
    .flatMap((group) =>
      readdirSync(join(REPO_DIR, "packages", group.name), { withFileTypes: true })
        .filter((workspace) => workspace.isDirectory())
        .map((workspace) => join(REPO_DIR, "packages", group.name, workspace.name, "src")),
    )
    .filter((root) => existsSync(root)),
];

// Every seam a background module can broadcast through, named as the RuntimeRpc
// member it reaches. Matched as a bare identifier rather than as a call
// `name(`, because a one-line alias — `const send = rpc.submitInvokeTransaction`
// then `send({...})` — is otherwise enough to disappear from this scan while
// still broadcasting a dapp's calls.
const SUBMIT_SEAMS = [
  "submitAccountDeployment",
  "submitDeclareTransaction",
  "submitErc20Transfer",
  "submitInvokeTransaction",
  "submitPreparedInvoke",
  "submitStrk20Actions",
  "registerStrk20Account",
] as const;

// Paths that submit only calls the WALLET itself built, from an entrypoint set
// that cannot grant an ERC20 allowance, plus the module that DEFINES the seams.
// Each entry is a claim about that module's calldata, re-read whenever it
// changes — not a way to opt out.
const NO_GRANT_POSSIBLE: Readonly<Record<string, string>> = {
  "allowance-ops.ts":
    "the manager itself: revoke builds approve(spender, 0) and writes the cleared record directly, and refuses a contract that is a watched NFT collection",
  "declare-ops.ts":
    "declares a class; a declaration carries no calls at all, so no allowance can be granted",
  "deployment-ops.ts":
    "deploys the selected account contract; a deployment carries no calls, so no allowance can be granted",
  "multisig-deploy-ops.ts":
    "deploys the pinned Argent multisig account contract; a deployment carries no calls, so no allowance can be granted",
  "nft-transfer-submit.ts":
    "submits only the ERC721/ERC1155 transfer the wallet builds; an NFT approval's second argument is a token id, not an amount, and must never be filed as an ERC20 allowance",
  "runtime-rpc.ts": "defines the seams; it wires the RPC functions and submits nothing itself",
  "strk20-shadow-sweep.ts":
    "relays the reviewed shadow-account sweep for the shared execution path in strk20-wallet-execution.ts, which records whatever grants the submission reports",
  "transfer-ops.ts":
    "submits only the ERC20 transfer the wallet builds from the user's own inputs; it carries no approve",
};

// A submitter whose hash returns to a caller that files the grants. The caller
// must name this module's function and call recordApproveAllowances itself.
const RECORDED_BY_CALLER: Readonly<Record<string, readonly [string, string]>> = {
  "held-invoke-submit.ts": ["submitHeldInvoke", "provider-ops.ts"],
};

// Recurses the background capability folders, keyed by file name: the
// exemption list below names modules, and a module keeps its name wherever the
// capability layout puts it.
// Modules that file their grants through a named recorder in another module,
// as `module: [recorder, defining module]`. Each claim is re-checked: the
// module must call the recorder, and the defining module must export it and
// call recordApproveAllowances, so a delegation cannot silently go empty.
const RECORDS_THROUGH: Readonly<Record<string, readonly [string, string]>> = {
  "multisig-tx-ops.ts": ["recordBroadcastIntent", "multisig-operation-recovery.ts"],
};

const backgroundSources = (): readonly { readonly name: string; readonly text: string }[] =>
  sourceFiles(BACKGROUND_DIR).map((path) => ({
    name: basename(path),
    text: readFileSync(path, "utf8"),
  }));

const submits = (text: string): boolean =>
  SUBMIT_SEAMS.some((seam) => new RegExp(`\\b${seam}\\b`).test(text));

const sourceFiles = (dir: string): readonly string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(dir, entry.name))
      : entry.name.endsWith(".ts")
        ? [join(dir, entry.name)]
        : [],
  );

const declaringFiles = (pattern: RegExp): readonly string[] =>
  SOURCE_ROOTS.flatMap(sourceFiles)
    .filter((path) => pattern.test(readFileSync(path, "utf8")))
    .map((path) => relative(REPO_DIR, path))
    .sort();

describe("allowance recording covers every submitting path", () => {
  test("each background module that broadcasts calls records the allowances they grant", () => {
    const unrecorded = backgroundSources()
      .filter(
        ({ name, text }) =>
          submits(text) &&
          !text.includes("recordApproveAllowances") &&
          RECORDS_THROUGH[name] === undefined &&
          RECORDED_BY_CALLER[name] === undefined &&
          NO_GRANT_POSSIBLE[name] === undefined,
      )
      .map(({ name }) => name);

    expect(unrecorded).toEqual([]);
  });

  // MCW-V09-108(c): the recorder needs the account's trusted set to tell an
  // ERC721 `approve(to, item_id)` from an ERC20 `approve(spender, amount)`, and
  // the type makes `assets` mandatory — but an empty set classifies every
  // contract as unknown, which would file collection approvals again. The
  // registries must therefore come from the one shared builder, never from a
  // literal a caller assembles.
  test("every recording call classifies the contract with the shared trusted set", () => {
    const unclassified = backgroundSources()
      .filter(
        ({ name, text }) =>
          name !== "allowance-recording.ts" &&
          text.includes("recordApproveAllowances(") &&
          !text.includes("verificationContext("),
      )
      .map(({ name }) => name);

    expect(unclassified).toEqual([]);
  });

  test("every delegated recorder is called and itself files the grants", () => {
    const sources = new Map(backgroundSources().map(({ name, text }) => [name, text]));
    for (const [name, [recorder, home]] of Object.entries(RECORDS_THROUGH)) {
      const text = sources.get(name) ?? "";
      const defining = sources.get(home) ?? "";
      expect(submits(text), name).toBe(true);
      expect(new RegExp(`\\b${recorder}\\(`).test(text), `${name} calls ${recorder}`).toBe(true);
      expect(defining.includes(`export const ${recorder} =`), `${home} exports ${recorder}`).toBe(
        true,
      );
      expect(defining.includes("recordApproveAllowances("), `${home} files grants`).toBe(true);
    }
  });

  test("a submitter that returns its hash is filed by the caller that awaits it", () => {
    const sources = new Map(backgroundSources().map(({ name, text }) => [name, text]));
    for (const [name, [fn, caller]] of Object.entries(RECORDED_BY_CALLER)) {
      const text = sources.get(name) ?? "";
      const parent = sources.get(caller) ?? "";
      expect(submits(text), name).toBe(true);
      expect(parent.includes(`${fn}(`), `${caller} awaits ${fn}`).toBe(true);
      expect(parent.includes("recordApproveAllowances("), `${caller} files grants`).toBe(true);
    }
  });

  test("the exemptions still name modules that exist and still submit", () => {
    // A stale exemption is how a path quietly loses its coverage: the file is
    // renamed or repurposed and the allowlist keeps vouching for it.
    const submitting = new Set(
      backgroundSources()
        .filter(({ text }) => submits(text))
        .map(({ name }) => name),
    );

    expect(Object.keys(NO_GRANT_POSSIBLE).filter((name) => !submitting.has(name))).toEqual([]);
  });

  test("the scan sees a seam reached through an alias, not only a direct call", () => {
    // The evasion this scan was rewritten to catch: import the seam under
    // another name, or read it off the RPC object into a local, and the text
    // `submitInvokeTransaction(` never appears.
    expect(submits("const send = runtimeRpc.submitInvokeTransaction;\nawait send(input);")).toBe(
      true,
    );
    expect(
      submits(
        'import { submitStrk20Actions as go } from "@bramble/privacy/service";\nawait go(input);',
      ),
    ).toBe(true);
    expect(submits("await deps.runtimeRpc.getTokenBalances(input);")).toBe(false);
  });

  test("which selectors grant spend is defined once, in the shared vocabulary", () => {
    // A second copy of this list is what let `increase_allowance` read as a
    // grant to one layer and as an opaque call to another. The operator-grant
    // spellings are held to the same rule: `set_approval_for_all` grants more
    // authority than any allowance, so it must not be classified independently
    // by the swap policy, the aggregator adapter, and the reviewer.
    expect(declaringFiles(/"increase_allowance"|"increaseAllowance"/)).toEqual([
      "packages/features/transactions/src/routing/verify-selectors.ts",
    ]);
    expect(declaringFiles(/"decrease_allowance"|"decreaseAllowance"/)).toEqual([
      "packages/features/transactions/src/routing/verify-selectors.ts",
    ]);
    expect(declaringFiles(/"set_approval_for_all"|"setApprovalForAll"/)).toEqual([
      "packages/features/transactions/src/routing/verify-selectors.ts",
    ]);
  });
});
