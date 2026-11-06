import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import TokenMetadata from "./TokenMetadata";

const fill = (label: string, value: string): void => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};

const json = (): string => screen.getByLabelText("Metadata JSON").textContent ?? "";

const fact = (label: string): string =>
  screen.getByText(label, { selector: "dt" }).nextElementSibling?.textContent ?? "";

describe("Token metadata", () => {
  const writeText = vi.fn();
  const fetchSpy = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("ERC-721: builds the file, its token URI and its file name, and fetches nothing", async () => {
    render(<TokenMetadata baseUri=" ipfs://bafy/ " standard="erc721" tokenIds="7, 8" />);
    expect((screen.getByLabelText("Token id") as HTMLInputElement).value).toBe("7");
    fill("Token name", "Garden #7");
    fill("Image URI", "ipfs://bafyimage/7.png");
    fill("Description", "Moss garden.");
    fill("Trait 1", "Background");
    fill("Value 1", "Moss");

    const expected = `${JSON.stringify(
      {
        name: "Garden #7",
        description: "Moss garden.",
        image: "ipfs://bafyimage/7.png",
        attributes: [{ trait_type: "Background", value: "Moss" }],
      },
      null,
      2,
    )}\n`;
    expect(json()).toBe(expected);
    expect(fact("Token URI")).toBe("ipfs://bafy/7");
    expect(fact("File name")).toBe("7");

    const download = screen.getByRole("link", { name: /Download JSON/ });
    expect(download.getAttribute("download")).toBe("7");
    const href = download.getAttribute("href") ?? "";
    expect(href.startsWith("data:application/json;charset=utf-8,")).toBe(true);
    expect(decodeURIComponent(href.slice(href.indexOf(",") + 1))).toBe(expected);

    fireEvent.click(screen.getByRole("button", { name: /Copy JSON/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Copied/ })).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith(expected);

    // The image URI is user-supplied: the terminal never requests or renders it.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(document.querySelector("img")).toBeNull();
  });

  test("ERC-1155: {id} becomes 64 hex digits, and a shared URI says so", () => {
    const view = render(<TokenMetadata baseUri="https://example.org/meta/{id}.json" standard="erc1155" tokenIds="" />);
    fill("Token id", "255");
    fill("Token name", "Seed");
    fill("Image URI", "https://example.org/seed.png");
    const hexId = `${"0".repeat(62)}ff`;
    expect(fact("Token URI")).toBe(`https://example.org/meta/${hexId}.json`);
    expect(fact("File name")).toBe(`${hexId}.json`);
    expect(screen.queryByText(/Every token id uses this one file/)).toBeNull();

    view.rerender(<TokenMetadata baseUri="ipfs://bafy/seed.json" standard="erc1155" tokenIds="" />);
    expect(fact("Token URI")).toBe("ipfs://bafy/seed.json");
    expect(screen.getByText(/Every token id uses this one file/)).toBeTruthy();
  });

  test("an invalid base URI still gives the file, under <id>.json", () => {
    render(<TokenMetadata baseUri="https://localhost/meta/" standard="erc721" tokenIds="3" />);
    fill("Token name", "Garden #3");
    fill("Image URI", "ipfs://bafyimage/3.png");
    expect(fact("Token URI")).toBe("Enter a valid base URI above to see it.");
    expect(fact("File name")).toBe("3.json");
  });

  test("invalid input shows why and offers no file", () => {
    render(<TokenMetadata baseUri="ipfs://bafy/" standard="erc721" tokenIds="1" />);
    expect(screen.getByText("Add a name and an image URI to see the file.")).toBeTruthy();
    fill("Token name", "Garden");
    fill("Image URI", "https://192.168.0.2/x.png");
    expect(screen.getByText("Image URI must be a public https:// or ipfs:// address, with no spaces.")).toBeTruthy();
    expect(screen.queryByLabelText("Metadata JSON")).toBeNull();
    expect(screen.queryByRole("link", { name: /Download JSON/ })).toBeNull();
  });

  test("traits can be added and removed", () => {
    render(<TokenMetadata baseUri="ipfs://bafy/" standard="erc721" tokenIds="1" />);
    fill("Token name", "Garden");
    fill("Image URI", "ipfs://bafyimage/1.png");
    fireEvent.click(screen.getByRole("button", { name: /Add trait/ }));
    fill("Trait 2", "Rarity");
    fill("Value 2", "Rare");
    expect(JSON.parse(json()).attributes).toEqual([{ trait_type: "Rarity", value: "Rare" }]);
    fireEvent.click(screen.getByRole("button", { name: "Remove trait 2" }));
    expect(JSON.parse(json()).attributes).toBeUndefined();
    fill("Trait 1", "Background");
    expect(screen.getByText("Each trait needs a name and a value.")).toBeTruthy();
  });

  test("a refused clipboard says so", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    render(<TokenMetadata baseUri="ipfs://bafy/" standard="erc721" tokenIds="1" />);
    fill("Token name", "Garden");
    fill("Image URI", "ipfs://bafyimage/1.png");
    fireEvent.click(screen.getByRole("button", { name: /Copy JSON/ }));
    expect(await screen.findByText("Couldn't copy. Select the JSON and copy it.")).toBeTruthy();
  });
});
