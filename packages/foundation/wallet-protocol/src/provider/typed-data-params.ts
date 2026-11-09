/**
 * wallet_signTypedData param parsing at the page trust boundary. Split from
 * results.ts, which holds the result parsers, to keep each provider module
 * within the size cap.
 */
import { isJson, isRecord, type Json } from "@bramble/core/json";
import { isOptionalApiVersion } from "./versions";

/**
 * Extracts the SNIP-12 typed data from sign params, accepting the spec
 * `{ typed_data }` wrapper, the legacy `{ typedData }` wrapper, and a bare
 * typed-data object passed directly as params. Each form may carry the spec's
 * optional `api_version` beside the typed data: a malformed one rejects the
 * request, and a well-formed one is removed from a bare object so it is not
 * mistaken for a typed-data field. Nothing else is stripped; the background
 * still validates the typed data's own shape before any signing.
 */
export const readTypedDataParam = (params: Json | undefined): Json | null => {
  if (params === undefined) {
    return null;
  }
  if (!isRecord(params)) {
    return params;
  }
  if (!isOptionalApiVersion(params["api_version"])) {
    return null;
  }
  if (Object.hasOwn(params, "typed_data") && isJson(params["typed_data"])) {
    return params["typed_data"];
  }
  if (Object.hasOwn(params, "typedData") && isJson(params["typedData"])) {
    return params["typedData"];
  }
  if (!Object.hasOwn(params, "api_version")) {
    return params;
  }
  const { api_version: _apiVersion, ...typedData } = params;
  return typedData;
};
