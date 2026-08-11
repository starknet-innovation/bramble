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
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const BACKGROUND_DIR = join(import.meta.dir, "../../src/background");
const SRC_DIR = join(import.meta.dir, "../../src");

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
  "multisig-deploy-ops.ts":
    "submits only the UDC deployment and class declaration the wallet builds from pinned constants",
  "nft-ops.ts":
    "submits only the ERC721/ERC1155 transfer the wallet builds; an NFT approval's second argument is a token id, not an amount, and must never be filed as an ERC20 allowance",
  "runtime-rpc.ts": "defines the seams; it wires the RPC functions and submits nothing itself",
  "wallet-ops.ts":
    "submits only the ERC20 transfer and the account deployment the wallet builds from the user's own inputs; neither carries an approve",
};

const backgroundSources = (): readonly { readonly name: string; readonly text: string }[] =>
  readdirSync(BACKGROUND_DIR)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({ name, text: readFileSync(join(BACKGROUND_DIR, name), "utf8") }));

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
  sourceFiles(SRC_DIR)
    .filter((path) => pattern.test(readFileSync(path, "utf8")))
    .map((path) => path.slice(SRC_DIR.length + 1));

describe("allowance recording covers every submitting path", () => {
  test("each background module that broadcasts calls records the allowances they grant", () => {
    const unrecorded = backgroundSources()
      .filter(
        ({ name, text }) =>
          submits(text) &&
          !text.includes("recordApproveAllowances") &&
          NO_GRANT_POSSIBLE[name] === undefined,
      )
      .map(({ name }) => name);

    expect(unrecorded).toEqual([]);
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
      submits('import { submitStrk20Actions as go } from "../starknet/x";\nawait go(input);'),
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
      "starknet/verify-selectors.ts",
    ]);
    expect(declaringFiles(/"decrease_allowance"|"decreaseAllowance"/)).toEqual([
      "starknet/verify-selectors.ts",
    ]);
    expect(declaringFiles(/"set_approval_for_all"|"setApprovalForAll"/)).toEqual([
      "starknet/verify-selectors.ts",
    ]);
  });
});
