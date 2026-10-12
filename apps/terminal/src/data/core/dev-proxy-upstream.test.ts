/** The dev-server market-data proxy only ever reaches its fixed upstream (Sherlock 127). */
import { describe, expect, it } from "vitest";
import { devProxyUpstream } from "./dev-proxy-upstream";

const PREFIX = "/proxy/starkscan";
const TARGET = "https://starkscan.co";

describe("devProxyUpstream", () => {
  it("resolves an ordinary path and query onto the upstream", () => {
    expect(devProxyUpstream(`${PREFIX}/v1/SN_MAIN/tx?limit=5`, PREFIX, TARGET)?.href).toBe(
      "https://starkscan.co/v1/SN_MAIN/tx?limit=5",
    );
  });

  it("refuses a protocol-relative remainder that names another host", () => {
    expect(devProxyUpstream(`${PREFIX}//attacker.example/collect`, PREFIX, TARGET)).toBeNull();
    expect(devProxyUpstream(`${PREFIX}/\\attacker.example/collect`, PREFIX, TARGET)).toBeNull();
  });

  it("refuses a remainder that URL parsing turns protocol-relative", () => {
    // URL parsing drops tabs and newlines, so "/\t/host" becomes "//host".
    expect(devProxyUpstream(`${PREFIX}/\t/attacker.example/x`, PREFIX, TARGET)).toBeNull();
    expect(devProxyUpstream(`${PREFIX}/\n/attacker.example/x`, PREFIX, TARGET)).toBeNull();
  });

  it("refuses a remainder that does not start a path", () => {
    expect(devProxyUpstream(`${PREFIX}.attacker.example/x`, PREFIX, TARGET)).toBeNull();
    expect(devProxyUpstream(PREFIX, PREFIX, TARGET)).toBeNull();
  });

  it("keeps a dot-segment path on the upstream", () => {
    expect(devProxyUpstream(`${PREFIX}/../../x`, PREFIX, TARGET)?.origin).toBe(TARGET);
  });
});
