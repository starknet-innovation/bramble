/** Direct-page provider request admission and release regression checks. */
import { describe, expect, test } from "bun:test";
import { createProviderRequestAdmission } from "../../../apps/extension/src/content/provider-request-admission";

describe("content provider request admission", () => {
  test("applies the provider cap to direct page bridge messages", () => {
    const admission = createProviderRequestAdmission();
    for (let index = 0; index < 100; index += 1) {
      expect(admission.acquire(`${index}`)).toBe(true);
    }
    expect(admission.acquire("100")).toBe(false);
    expect(admission.acquire("0")).toBe(false);
    admission.release("0");
    expect(admission.acquire("100")).toBe(true);
  });

  test("a rejected request releases its reserved slot", () => {
    const admission = createProviderRequestAdmission();
    for (let index = 0; index < 100; index += 1) {
      expect(admission.acquire(`${index}`)).toBe(true);
      admission.release(`${index}`);
    }
    expect(admission.acquire("accepted-after-rejections")).toBe(true);
  });
});
