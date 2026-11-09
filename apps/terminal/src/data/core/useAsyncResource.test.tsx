import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HttpError } from "./client";
import { useAsyncResource } from "./useAsyncResource";

// Issue 652: a data banner reads "Couldn't load X: <error>", so the error must
// never carry a request URL or a response body.
describe("useAsyncResource error text", () => {
  it("collapses an HTTP failure to the existing sentence", async () => {
    const { result } = renderHook(() =>
      useAsyncResource(async () => {
        throw new HttpError(502, "https://api.example/markets?key=1", "<html>bad gateway</html>");
      }, []),
    );
    await waitFor(() => expect(result.current.error).toBe("Request failed"));
  });

  it("keeps a reader sentence as written", async () => {
    const { result } = renderHook(() =>
      useAsyncResource(async () => {
        throw new Error("Vesu lending is temporarily unavailable");
      }, []),
    );
    await waitFor(() =>
      expect(result.current.error).toBe("Vesu lending is temporarily unavailable"),
    );
  });
});
