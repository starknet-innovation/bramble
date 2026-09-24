export const meta = {
  name: 'mobile-feature',
  description: 'Research, design, implement, and verify one Bramble mobile feature on the Rust Krusty core',
  whenToUse: 'Adding a wallet capability (vault security, transactions, privacy, …) to the iOS/Android apps in mobile/, built on krusty-kms and matching the extension',
  phases: [
    { title: 'Setup', detail: 'isolated worktree, branch, and simulator for parallel runs' },
    { title: 'Research', detail: 'extension behaviour, krusty-kms APIs, mobile security practice' },
    { title: 'Design', detail: 'one design, two adversarial reviews' },
    { title: 'Build', detail: 'one implementer across core, iOS, Android' },
    { title: 'Verify', detail: 'gates + security audit of the diff' },
    { title: 'Fix', detail: 'resolve confirmed findings, commit locally' },
  ],
}

// args: { feature: 'vault-security', brief: '…', isolated?: true }
// isolated: run in a dedicated worktree + branch (mobile/<feature>) cut from feature/mobile-wallet, with
// its own simulator, so several runs can proceed in parallel and be merged back afterwards.
const FEATURE = args && args.feature
const BRIEF = args && args.brief
const ISOLATED = Boolean(args && args.isolated)
if (!FEATURE || !BRIEF) throw new Error('args.feature and args.brief are required')

const BASE = '/Users/theodorepender/Coding/mc-wallet-mobile'
const REPO = ISOLATED ? `/Users/theodorepender/Coding/mc-wallet-mobile-${FEATURE}` : BASE
const BRANCH = ISOLATED ? `mobile/${FEATURE}` : 'feature/mobile-wallet'
const SIMULATOR = ISOLATED ? `Bramble ${FEATURE}` : 'Bramble Workflow'
const DOC = `mobile/docs/${FEATURE}.md`

// Rules every agent in this workflow follows. They restate only what is specific to this
// workflow; the repository's AGENTS.md already binds them.
const GROUND_RULES = `
Ground rules for this task (in addition to AGENTS.md):
- Work ONLY in the git worktree ${REPO} (branch ${BRANCH}). Never edit, build, or commit in
  /Users/theodorepender/Coding/mc-wallet (the user's main checkout)${ISOLATED ? ` or in ${BASE} (another run owns it)` : ''}.
- Other workstreams (vault-security, transactions, portfolio-activity, accounts, design-mobile,
  nostr-multisig, android-parity) run in parallel on sibling branches and will be merged together. Stay
  inside this workstream's scope, do not refactor code outside it, and keep edits to shared files
  (mobile/core/src/lib.rs exports, Cargo.toml, WalletStore.swift, WalletShell.swift, SettingsViews.swift)
  small and additive. Put new logic in new files.
- Read mobile/SCOPE.md and mobile/README.md first. The mobile architecture is fixed: all key custody and
  protocol logic lives in the Rust core mobile/core (crate bramble-core, UniFFI), built on the published
  krusty-kms crates pinned at =0.11.0 (same release as the extension's @starknetfoundation/krusty-kms-wasm).
  The core is sans-IO: it builds JSON-RPC bodies and judges responses; Swift/Kotlin only move bytes.
- Private keys, the recovery phrase, viewing keys, and vault keys never cross the FFI boundary except where
  SCOPE.md already allows (phrase at creation and on password-rechecked reveal). Never log secrets.
- Never add fallback crypto. If krusty-kms 0.11.0 lacks something, say so explicitly and propose the smallest
  honest path (e.g. an upstream krusty-kms change) rather than re-implementing it. Its sources are readable at
  ~/.cargo/registry/src/*/krusty-kms*-0.11.0/ and in ~/Coding/krusty-kms (tag v0.11.0).
- Nothing is restated by hand: design tokens, icons, networks, and presentation rules come from the
  extension's TypeScript via scripts/generate-mobile-assets.ts and parity fixtures (bun run mobile:assets,
  bun run mobile:parity). Reuse the existing SwiftUI components in mobile/ios/Bramble/DesignSystem and match
  the extension UI exactly (its stories render in apps/ui-lab; stylesheets in
  packages/presentation/wallet-ui/src/sidepanel/styles).
- Simulator: NEVER use, boot, uninstall from, or run tests on the "iPhone 16" simulator — the user is using it —
  or on another run's simulator. Use this run's device: \`xcrun simctl list devices | grep "${SIMULATOR}" || xcrun simctl create "${SIMULATOR}" "iPhone 16"\`
  then pass -destination 'platform=iOS Simulator,name=${SIMULATOR}'. Build the core first with
  mobile/scripts/build-core-ios.sh debug, then \`cd mobile/ios && xcodegen generate\`.
- Mainnet: never broadcast a transaction, never spend funds, never read or print a real recovery phrase.
  Any live-network test must be opt-in behind environment variables, skipped by default and refused under CI.
- Android has no SDK on this machine: write Android code against the generated Kotlin bindings and say
  clearly that it is uncompiled.
- Files stay under 500 lines. Pin any new dependency exactly and justify it.
`

const FINDINGS = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          topic: { type: 'string' },
          detail: { type: 'string' },
          sources: { type: 'array', items: { type: 'string' } },
        },
        required: ['topic', 'detail', 'sources'],
      },
    },
    gaps: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'findings', 'gaps'],
}

const REVIEW = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['approve', 'revise'] },
    mustFix: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          issue: { type: 'string' },
          why: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['issue', 'why', 'fix'],
      },
    },
  },
  required: ['verdict', 'mustFix'],
}

const BUILD = {
  type: 'object',
  properties: {
    done: { type: 'array', items: { type: 'string' } },
    notDone: { type: 'array', items: { type: 'string' } },
    gates: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
  },
  required: ['done', 'notDone', 'gates', 'files'],
}

const VERIFY = {
  type: 'object',
  properties: {
    passed: { type: 'boolean' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          file: { type: 'string' },
          issue: { type: 'string' },
          evidence: { type: 'string' },
        },
        required: ['severity', 'file', 'issue', 'evidence'],
      },
    },
  },
  required: ['passed', 'findings'],
}

const briefing = `Feature: ${FEATURE}\n\nBrief:\n${BRIEF}\n${GROUND_RULES}`

if (ISOLATED) {
  phase('Setup')
  await agent(
    `Prepare an isolated workspace for the "${FEATURE}" mobile workstream. Steps, stopping on any failure:\n` +
    `1. If ${REPO} does not exist: \`git -C ${BASE} worktree add ${REPO} -b ${BRANCH} feature/mobile-wallet\` ` +
    `(if the branch already exists, add the worktree on it without -b). Do not touch uncommitted work in ${BASE}.\n` +
    `2. \`cd ${REPO} && bun install --frozen-lockfile\`.\n` +
    `3. mkdir -p ${REPO}/vendor, then copy ${BASE}/vendor/argent-contracts and ${BASE}/vendor/starknet-privacy ` +
    `into it as siblings (cp -R each directory into vendor/, never cp -R vendor itself).\n` +
    `4. Create the simulator "${SIMULATOR}" (iPhone 16 device type) if missing. Never touch "iPhone 16".\n` +
    `5. \`cd ${REPO}/mobile && ./scripts/build-core-ios.sh debug && cd ios && xcodegen generate\`.\n` +
    `6. \`cd ${REPO}/mobile/core && cargo test --locked\` must pass.\nReport what you did and any failure.`,
    { label: 'setup', phase: 'Setup' })
}

phase('Research')
const research = await parallel([
  () => agent(
    `${briefing}\nRESEARCH TASK (read-only, change nothing): map exactly how the browser extension implements this ` +
    `feature today — the TypeScript modules, the invariants and validation rules, the UI screens and their copy ` +
    `(journeys under packages/presentation/wallet-ui, stories under apps/ui-lab), and the tests that pin the ` +
    `behaviour. Cite file paths. The mobile app must reproduce this behaviour, so be precise about rules.`,
    { label: 'research:extension', phase: 'Research', schema: FINDINGS }),
  () => agent(
    `${briefing}\nRESEARCH TASK (read-only, change nothing): inventory what the published krusty-kms 0.11.0 crates ` +
    `(krusty-kms, krusty-kms-common, krusty-kms-crypto, krusty-kms-client, krusty-kms-wallet-api, krusty-kms-sdk) ` +
    `provide for this feature: exact function signatures, types, and whether each pulls networking or async runtimes ` +
    `into a mobile binary. List precisely what is MISSING and would need an upstream krusty change.`,
    { label: 'research:krusty', phase: 'Research', schema: FINDINGS }),
  () => agent(
    `${briefing}\nRESEARCH TASK (read-only, change nothing): state the standard iOS and Android security practice ` +
    `for this feature in a self-custodial wallet (Keychain/Secure Enclave, Android Keystore/StrongBox, ` +
    `LocalAuthentication/BiometricPrompt, backoff, auto-lock, screenshot/recording protection, memory hygiene), ` +
    `and how the current mobile code (mobile/core, mobile/ios, mobile/android) stands against it. Cite APIs and files.`,
    { label: 'research:platform', phase: 'Research', schema: FINDINGS }),
])
const researchNotes = JSON.stringify(research.filter(Boolean), null, 1)

phase('Design')
const draft = await agent(
  `${briefing}\nDESIGN TASK: using the research below, write the design to ${REPO}/${DOC} (create mobile/docs/ if ` +
  `needed; keep it under 500 lines). Cover: user-visible behaviour mapped screen-by-screen to the extension; the ` +
  `exact new UniFFI surface (Rust signatures) and what never crosses it; storage and migration of any persisted ` +
  `state; the threat model and each mitigation; parity fixtures that will pin behaviour to the extension; the test ` +
  `plan (Rust, Swift unit, XCUITest on the "${SIMULATOR}" simulator); and anything out of scope or blocked on ` +
  `krusty-kms. Do not write implementation code. Return the document path and a one-paragraph summary.\n\n` +
  `RESEARCH:\n${researchNotes}`,
  { label: 'design:draft', phase: 'Design' })

const reviews = await parallel(['security (key custody, FFI leakage, storage, untrusted RPC, downgrade and replay)',
  'extension parity and scope (does it behave exactly like the extension, is it the smallest complete slice)']
  .map((lens) => () => agent(
    `${briefing}\nADVERSARIAL REVIEW: read ${REPO}/${DOC} and try to break it through the lens of ${lens}. ` +
    `Verify claims against the code and krusty-kms sources rather than trusting the document. Only list issues ` +
    `that would cause a real defect; approve if there are none.`,
    { label: `design:review:${lens.split(' ')[0]}`, phase: 'Design', schema: REVIEW })))
const mustFix = reviews.filter(Boolean).flatMap((r) => r.mustFix)
log(`design reviews: ${mustFix.length} must-fix item(s)`)

phase('Build')
const build = await agent(
  `${briefing}\nIMPLEMENTATION TASK: implement the design in ${REPO}/${DOC}, first updating the document to resolve ` +
  `every must-fix item below. Build in this order: Rust core + tests (cargo test --locked, cargo clippy ` +
  `--all-targets --locked clean) → parity fixtures if behaviour is shared with the extension → iOS (rebuild the core, ` +
  `xcodegen, unit tests and the relevant XCUITest on "${SIMULATOR}") → Android sources. Then run ` +
  `\`bun run check\` from the repo root. Do not commit. Report exactly what is done, what is not, and gate results.\n\n` +
  `MUST-FIX FROM REVIEW:\n${JSON.stringify(mustFix, null, 1)}`,
  { label: 'build', phase: 'Build', schema: BUILD })

phase('Verify')
const verdicts = await parallel([
  () => agent(
    `${briefing}\nVERIFY (gates): in ${REPO}, re-run every gate independently — cargo fmt --check, cargo clippy ` +
    `--all-targets --locked, cargo test --locked (mobile/core), bun run check (repo root), the iOS unit tests and the ` +
    `feature's XCUITests on the "${SIMULATOR}" simulator. Report each failure with its output. Change nothing.`,
    { label: 'verify:gates', phase: 'Verify', schema: VERIFY }),
  () => agent(
    `${briefing}\nVERIFY (security audit): audit the uncommitted diff in ${REPO} (\`git diff HEAD\` plus untracked ` +
    `files) for this feature. Look for secret material crossing FFI or reaching logs/UI state/persistence outside ` +
    `the vault, missing input validation on RPC responses, weakened KDF or cipher parameters, missing zeroization, ` +
    `unsafe defaults, and behaviour that diverges from the extension. Report only issues you can point to in code. ` +
    `Change nothing.`,
    { label: 'verify:security', phase: 'Verify', schema: VERIFY }),
])
const findings = verdicts.filter(Boolean).flatMap((v) => v.findings)
log(`verification: ${findings.length} finding(s)`)

phase('Fix')
const final = await agent(
  `${briefing}\nFIX AND COMMIT: resolve every blocker and major finding below in ${REPO} (minor ones where cheap), ` +
  `re-run all gates until green, update mobile/SCOPE.md's phase list for what now exists, then commit on ` +
  `${BRANCH} with an imperative summary line scoped "feat(mobile):" and a body explaining why, ending ` +
  `with the line "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>". Before committing, scan the staged ` +
  `diff for any BIP-39 phrase or private key other than the published E2E phrase in tests/e2e/wallet-helpers.ts ` +
  `and abort if one appears. Do not push. Report the commit hash, ` +
  `gate results, and anything still open.\n\nBUILD REPORT:\n${JSON.stringify(build, null, 1)}\n\n` +
  `FINDINGS:\n${JSON.stringify(findings, null, 1)}`,
  { label: 'fix+commit', phase: 'Fix', schema: BUILD })

return { feature: FEATURE, design: DOC, mustFix, build, findings, final }
