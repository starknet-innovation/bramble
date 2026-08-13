# MC Wallet UI Lab

An isolated Storybook HTML workbench for reviewing production MC Wallet templates, bindings,
styles, and motion at the real wallet dimensions. It uses deterministic fixture responses only:
there is no browser-extension runtime, vault, signer, Ledger transport, production RPC, or
broadcast path.

## Run locally

Requirements:

- Bun 1.3.3 (the version pinned by this package and CI).
- The root workspace lockfile. Storybook remains a private app workspace and cannot enter the
  production extension dependency graph.

From a fresh clone:

```bash
cd /path/to/mc-wallet
bun install --frozen-lockfile
cd apps/ui-lab
bun run storybook
```

Open `http://localhost:6006` (or the URL Storybook prints). `bun run dev` is an equivalent
shorthand. Stop the local server with <kbd>Control</kbd>+<kbd>C</kbd>.

The static UI Lab from `main` is hosted on the repository's access-controlled GitHub Pages site at
<https://effective-adventure-qwr464j.pages.github.io/>.

## Review the design system

Open **Design system** first when changing shared interface code. The catalog is grouped into
Foundations, Controls, Feedback, Data display, Cards, Navigation, and Assets. It renders the real
production skins, styles, renderers, and domain components—never Storybook-only replicas.

The source of truth lives in `packages/presentation/ui-kit/src/`:

- `tokens.ts`, `skin.ts`, `default-skin.ts`, and `dark-skin.ts` own foundations.
- `controls.ts`, `fields.ts`, `content.ts`, `navigation.ts`, and `icons.ts` own reusable
  components.
- `catalog.ts` is the authoritative inventory. `tests/ui/design-system.test.ts` fails when an
  inventory item lacks Storybook coverage, a renderer stops escaping dynamic content, or a
  side-panel template bypasses shared fields and structural primitives.
- Wallet-specific cards and rows live in `packages/presentation/wallet-ui/src/sidepanel/`, and their
  Storybook stories import those production renderers directly.

When adding a shared component, grep for an existing pattern first, extend the library in place,
use it from the production surface, add it to `catalog.ts`, and add its states to the matching
Storybook section.

## Review a flow

1. Open **Wallet journeys** in Storybook's sidebar and follow the numbered product journey from
   onboarding through settings, or jump directly to the task under review. Cross-cutting coverage
   and interaction contracts live separately under **Wallet UI Lab**.
2. Select a direct checkpoint or use **Play**, **Pause**, **Step**, **Replay**, and **Reset** to
   inspect the complete sequence.
3. Adjust speed, theme, reduced motion, and the 960 × 800 onboarding-tab, 400 × 760 side-panel,
   or 380 × 600 popup surface. Wallet scenarios default to the side panel; full-screen onboarding
   keeps the onboarding-tab preset. The popup remains an explicit responsive-layout check.
4. Read the event/state log beside the wallet frame. Add local feedback notes and export them as
   Markdown when a review needs to leave the browser.
5. Use the Canvas for motion review and the Interactions panel to rewind or step through story play
   functions.

## Journey coverage

The lab has 174 deterministic checkpoints across 15 scenario families:

| Family | Review surface |
| --- | --- |
| Full-screen onboarding | Welcome, import method, phrase entry, local passphrase, account selection, generated-backup verification, Ledger protection, and completion. |
| Returning unlock | Locked, request-waiting, and failed-authentication side-panel states. |
| Home and portfolio | Ready, tabs, account drawer, undeployed, offline, error, and empty-network states. |
| Send lifecycle | Details, review latency, fee failure, signing, broadcast, and receipt. |
| Swap lifecycle | Picker, quote latency, route sanity, frozen review, failure, and submission. |
| Private balances and actions | Explicit disclosure, registration, empty notes, shielding, selective and complete balance sharing, private transfer and public withdrawal, dapp-specific anonymizers, AVNU private swap, scoped sub-accounts, proof liveness, success, service failure, missing configuration, locked requests, and Ledger fail-closed behavior. |
| Ledger signing | Connect, device selection, readiness, verification, approval, submission, and recovery. |
| Ledger account onboarding | Setup method, device grants, enumeration, multi-select, partial add, and errors. |
| dApp approvals | Every provider approval kind, blocked origin, queue visibility, and live authorization handoff. |
| dApp request takeover | Foreground takeover, receipt-token watch, explicit review-later behavior, and a dedicated parked-request list. |
| Account-isolated Activity | Account switching, immediate clearing, refresh, restoration, and separation from dApp decisions. |
| Assets and permissions | Receive, focused add/detect token journeys, token detail, address book, and ERC20 allowances. |
| NFT loading and send | Metadata loading, gallery, hidden/watch management, recipient-first review, blocking, and submission. |
| Settings and security | Focused appearance, request, network/endpoint, account/import, connected-site, backup/export/restore, and security boundaries. |

The `ProductionViewCoverage` interaction test derives its assertion from the production
`WALLET_VIEWS` constant. A new production view fails the UI Lab suite until at least one scenario
declares a checkpoint for it. Scenario ids and checkpoint ids are also checked for uniqueness.

## Commands

| Command | Purpose |
| --- | --- |
| `bun run storybook` | Start the local UI Lab at port 6006. |
| `bun run check` | Run strict typechecking, Biome, and all story interaction/a11y tests. |
| `bun run test` | Run the stories and play functions in Playwright Chromium. |
| `bun run build` | Build the static site in `storybook-static/`. |
| `bun run chromatic` | Publish visual snapshots when `CHROMATIC_PROJECT_TOKEN` is set. |

Install Playwright's Chromium once before the first local test run:

```bash
bunx playwright install chromium
```

The lab keeps strict checking for its source while skipping third-party declaration-file checking:
Storybook 10 currently brings declaration packages that are not TypeScript 6 `isolatedModules`
clean. This does not relax the extension's root `tsconfig.json` or compile any unchecked lab code.

## Chromatic review

Create a Chromatic project for this repository, add `CHROMATIC_PROJECT_TOKEN` to repository
Actions secrets, and run the **UI Lab** workflow or push a pull request that changes the lab or
production UI. The same workflow always tests and builds the lab, publishes Pages only from
`main`, and publishes Chromatic snapshots only when the token is configured. Locally:

```bash
CHROMATIC_PROJECT_TOKEN=... bun run chromatic
```

Chromatic is the hosted snapshot-comment and approval surface. CSS animation is paused in visual
snapshots, so review motion in the live Canvas and use the explicit start, middle, and end
checkpoints for durable comparisons.

## Safety boundary

- All accounts, sites, transactions, metadata, timing, errors, and device states are fixtures.
- The wallet frame is a sandboxed `srcdoc` iframe with no script or navigation capability; forms
  are enabled only so parent-attached production bindings can intercept their submit events.
- Production bindings are attached by the lab only to deterministic in-memory runtime clients.
- The lab must not import Chrome APIs, encrypted storage, Krusty KMS, Ledger transports, or live
  network clients.
- Feedback notes stay in this browser's local storage and export as Markdown; collaboration lives
  in Chromatic, not in a new application backend.

Playwright extension E2E remains the final integration and debugging layer for the packaged
Manifest V3 extension. The UI lab makes design states directly inspectable; it does not replace
extension integration tests or hardware verification.

## Review stack

- [Storybook for HTML](https://storybook.js.org/docs/get-started/install) provides the isolated
  component and scenario host.
- [Play functions](https://storybook.js.org/docs/10.5/writing-tests/interaction-testing) power the
  pausable, rewindable, step-by-step Interactions panel.
- [Chromatic UI Review](https://www.chromatic.com/docs/review/) provides PR-linked snapshots,
  threaded comments, reviewer assignment, and approvals.
- [Chromatic snapshots](https://www.chromatic.com/docs/snapshots/) intentionally freeze animation;
  use live Canvas plus the explicit checkpoint stories to review motion.
- [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer) remains the timeline,
  filmstrip, DOM, console, and network debugger for packaged-extension integration.
