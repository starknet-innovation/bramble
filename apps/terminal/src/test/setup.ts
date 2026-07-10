/**
 * Vitest setup: register @testing-library cleanup after each test so mounted
 * components don't leak between cases.
 */
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
