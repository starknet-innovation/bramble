# MC Wallet UI Lab

An isolated Storybook HTML workbench for reviewing production MC Wallet templates, bindings,
styles, and motion at the real wallet dimensions. It uses deterministic fixture responses only:
there is no browser-extension runtime, vault, signer, Ledger transport, production RPC, or
broadcast path.

## Run locally

```bash
cd apps/ui-lab
bun install --frozen-lockfile
bun run storybook
```

Open the URL Storybook prints (normally `http://localhost:6006`). Use the lab controls to select a
checkpoint, replay or step through a scenario, change speed, switch theme, enforce reduced motion,
or move between the 400 × 760 side-panel reference and the production 380 × 600 popup preset.
`bun run dev` is an equivalent shorthand.

`bun run test` executes the stories and their play-function interactions in Playwright Chromium.
`bun run build` writes the static site to `storybook-static/`.

The lab keeps strict checking for its source while skipping third-party declaration-file checking:
Storybook 10 currently brings declaration packages that are not TypeScript 6 `isolatedModules`
clean. This does not relax the extension's root `tsconfig.json` or compile any unchecked lab code.

## Chromatic review

Create a Chromatic project for this repository, add `CHROMATIC_PROJECT_TOKEN` to repository
Actions secrets, and run the **UI Lab / Chromatic** workflow or push a pull request that changes
the lab or production UI. Locally:

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
