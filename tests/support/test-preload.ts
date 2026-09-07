/** Process-state cleanup shared by every isolated Bun test case. */
import { afterEach } from "bun:test";
import { resetRpcEndpointCooldownsForTests } from "@bramble/starknet/provider";

afterEach(resetRpcEndpointCooldownsForTests);
