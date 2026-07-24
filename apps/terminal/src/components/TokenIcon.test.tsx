import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TokenIcon } from "./TokenIcon";

describe("TokenIcon", () => {
  it("renders provider artwork and falls back to the ticker when it fails", () => {
    const { container } = render(
      <TokenIcon
        logoUri="https://assets.avnu.fi/token.svg"
        name="Example token"
        symbol="TKN"
      />,
    );

    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toBe("https://assets.avnu.fi/token.svg");
    expect(container.firstElementChild?.classList.contains("has-artwork")).toBe(true);
    expect((container.firstElementChild as HTMLElement).style.background).toBe("");

    if (image !== null) {
      fireEvent.error(image);
    }
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("TKN");
    expect(container.firstElementChild?.classList.contains("has-fallback")).toBe(true);
    expect((container.firstElementChild as HTMLElement).style.background).not.toBe("");
  });
});
