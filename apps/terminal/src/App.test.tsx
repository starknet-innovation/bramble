/**
 * A wallet account or network change remounts the active screen, so state and
 * async replies bound to the previous account never carry over (Sherlock 222).
 */
import { act, render, screen } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { describe, expect, it, vi } from "vitest";

const wallet = vi.hoisted(() => ({
  address: "0x1" as string | null,
  chainId: "SN_MAIN" as string | null,
}));

vi.mock("./wallet/connection/WalletProvider", () => ({
  useWallet: () => ({ ...wallet, clearError: () => undefined, error: null }),
}));
vi.mock("./shell/TopNav", () => ({ TopNav: () => null }));
vi.mock("./shell/BottomBar", () => ({ BottomBar: () => null }));

let mounts = 0;
const StatefulScreen = (): ReactNode => {
  const [mount] = useState(() => {
    mounts += 1;
    return mounts;
  });
  return <span data-testid="mount">{mount}</span>;
};
for (const path of [
  "./screens/discover/Discover",
  "./screens/nft/NftStudio",
  "./screens/lending/Lending",
  "./screens/perps/Perps",
  "./screens/portfolio/Portfolio",
  "./screens/privacy/Privacy",
  "./screens/tokens/Tokens",
]) {
  vi.doMock(path, () => ({ default: StatefulScreen }));
}

describe("App screen identity", () => {
  it("remounts the active screen when the account or network changes", async () => {
    window.location.hash = "#lending";
    const { App } = await import("./App");
    const view = render(<App />);
    expect(screen.getByTestId("mount").textContent).toBe("1");

    view.rerender(<App />);
    expect(screen.getByTestId("mount").textContent).toBe("1");

    wallet.address = "0x2";
    await act(async () => view.rerender(<App />));
    expect(screen.getByTestId("mount").textContent).toBe("2");

    wallet.chainId = "SN_SEPOLIA";
    await act(async () => view.rerender(<App />));
    expect(screen.getByTestId("mount").textContent).toBe("3");
  });
});
