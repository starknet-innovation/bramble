/**
 * The mobile core's portfolio and activity rules are ports of the extension's TypeScript. The
 * Rust suite (`mobile/core/tests/portfolio_parity.rs`) asserts the core against the committed
 * fixture; this test fails when that fixture no longer matches what the extension computes today,
 * so a change to prices, tokens, history or row presentation must be carried to mobile
 * (`bun run mobile:parity`, then fix the core until `cargo test` passes).
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  PORTFOLIO_PARITY_FIXTURE_PATH,
  renderPortfolioParity,
} from "../../scripts/mobile-parity-portfolio";

describe("mobile portfolio parity", () => {
  test("the committed fixture is what the extension computes today", async () => {
    expect(await readFile(PORTFOLIO_PARITY_FIXTURE_PATH, "utf8")).toBe(
      await renderPortfolioParity(),
    );
  });

  test("the fixture is deterministic within one process", async () => {
    expect(await renderPortfolioParity()).toBe(await renderPortfolioParity());
  });
});
