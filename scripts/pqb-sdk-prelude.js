// Disable Zod code generation before the SDK constructs its schemas. MV3 keeps its strict CSP.
import { z } from "zod";

z.config({ jitless: true });
