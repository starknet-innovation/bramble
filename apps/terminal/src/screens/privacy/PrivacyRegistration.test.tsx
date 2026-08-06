import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PrivacyRegistration } from "./PrivacyRegistration";

describe("PrivacyRegistration", () => {
  it("explains the public commitment and hands activation to the wallet", () => {
    const onActivate = vi.fn();
    render(
      <PrivacyRegistration
        active={false}
        busy={false}
        onActivate={onActivate}
        poolAddress="0x40337"
      />,
    );

    expect(screen.getByRole("heading", { name: "Activate private balances" })).toBeTruthy();
    expect(screen.getByText("Viewing-key commitment")).toBeTruthy();
    expect(screen.getByText("Viewing key or private notes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review activation in wallet" }));
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it("renders a settled setup without offering a duplicate activation", () => {
    render(
      <PrivacyRegistration
        active
        busy={false}
        onActivate={vi.fn()}
        poolAddress="0x40337"
      />,
    );

    expect(screen.getByRole("heading", { name: "Private balances are active" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Review activation in wallet" })).toBeNull();
  });
});
