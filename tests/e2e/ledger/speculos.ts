/**
 * Speculos access for the Ledger E2E suite: the raw APDU socket (TCP 9999,
 * 4-byte big-endian length framing) and the REST API (buttons, finger,
 * on-screen text). Endpoints come from the environment so the runner
 * (`run-speculos.ts`) can point one Playwright run at one emulated model.
 *
 * Only loopback hosts are accepted, so a mistyped variable cannot send APDUs
 * or screen reads anywhere else. Test-only; nothing in `apps/` or `packages/`
 * may import this file.
 */
import { connect, type Socket } from "node:net";
import type { LedgerModel } from "./dashboard";
import type { ApduBackend } from "./hid-bridge";

/** Where one running Speculos listens. */
export type SpeculosEndpoints = {
  readonly apduPort: number;
  readonly apiUrl: string;
  readonly host: string;
  readonly model: LedgerModel;
};

// Long enough for an on-device review the suite answers through the REST API.
const EXCHANGE_TIMEOUT_MS = 120_000;
const MODELS: readonly LedgerModel[] = ["nanosp", "flex", "stax"];
const LOOPBACK = new Set(["127.0.0.1", "localhost"]);

/**
 * Reads `BRAMBLE_SPECULOS_MODEL`, `BRAMBLE_SPECULOS_HOST`,
 * `BRAMBLE_SPECULOS_APDU_PORT` and `BRAMBLE_SPECULOS_API_PORT`. Returns null
 * when no model is set (Speculos not configured); throws on bad values.
 */
export const speculosEndpointsFromEnv = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): SpeculosEndpoints | null => {
  const model = env["BRAMBLE_SPECULOS_MODEL"];
  if (model === undefined || model === "") {
    return null;
  }
  if (!MODELS.includes(model as LedgerModel)) {
    throw new Error(`BRAMBLE_SPECULOS_MODEL must be one of ${MODELS.join(", ")}`);
  }
  const host = env["BRAMBLE_SPECULOS_HOST"] ?? "127.0.0.1";
  if (!LOOPBACK.has(host)) {
    throw new Error("BRAMBLE_SPECULOS_HOST must be a loopback host");
  }
  const port = (name: string, fallback: number): number => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      throw new Error(`${name} must be a TCP port`);
    }
    return value;
  };
  return {
    apduPort: port("BRAMBLE_SPECULOS_APDU_PORT", 9999),
    apiUrl: `http://${host}:${port("BRAMBLE_SPECULOS_API_PORT", 5000)}`,
    host,
    model: model as LedgerModel,
  };
};

/**
 * Returns null when both the REST API and the APDU port answer, else a short
 * reason for the failure or skip message.
 */
export const probeSpeculos = async (endpoints: SpeculosEndpoints): Promise<string | null> => {
  try {
    const response = await fetch(`${endpoints.apiUrl}/events?currentscreenonly=true`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) {
      return `Speculos REST API at ${endpoints.apiUrl} answered ${response.status}`;
    }
  } catch {
    return `Speculos REST API is not reachable at ${endpoints.apiUrl}`;
  }
  const socket = await new Promise<Socket | null>((resolve) => {
    const candidate = connect(endpoints.apduPort, endpoints.host);
    candidate.once("connect", () => resolve(candidate));
    candidate.once("error", () => resolve(null));
  });
  if (!socket) {
    return `Speculos APDU port ${endpoints.host}:${endpoints.apduPort} is not reachable`;
  }
  socket.destroy();
  return null;
};

/** Raw APDU client for Speculos's TCP server. One exchange at a time. */
export class SpeculosApdu implements ApduBackend {
  private buffered = Buffer.alloc(0);
  private pending: { readonly fail: (error: Error) => void; readonly take: () => void } | null =
    null;
  private queue: Promise<unknown> = Promise.resolve();
  private socket: Socket | null = null;

  constructor(private readonly endpoints: SpeculosEndpoints) {}

  /** Sends one APDU and resolves with reply data plus status word. */
  exchange(apdu: Uint8Array): Promise<Uint8Array> {
    const next = this.queue.then(() => this.exchangeNow(apdu));
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Closes the socket; a pending exchange rejects. */
  close(): void {
    this.drop(new Error("Speculos APDU socket closed"));
  }

  // Ends the connection and rejects whatever read is waiting on it, so an
  // emulator crash fails the exchange at once instead of hanging the queue.
  private drop(error: Error): void {
    const socket = this.socket;
    this.socket = null;
    this.buffered = Buffer.alloc(0);
    socket?.destroy();
    const pending = this.pending;
    this.pending = null;
    pending?.fail(error);
  }

  private async open(): Promise<Socket> {
    if (this.socket) {
      return this.socket;
    }
    const socket = await new Promise<Socket>((resolve, reject) => {
      const candidate = connect(this.endpoints.apduPort, this.endpoints.host);
      candidate.once("connect", () => resolve(candidate));
      candidate.once("error", reject);
    });
    socket.on("data", (chunk: Buffer) => {
      this.buffered = Buffer.concat([this.buffered, chunk]);
      this.pending?.take();
    });
    socket.on("error", (error) => this.drop(error));
    socket.on("close", () => {
      if (this.socket === socket) {
        this.drop(new Error("Speculos closed the APDU connection"));
      }
    });
    this.socket = socket;
    return socket;
  }

  private read(size: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const take = (): boolean => {
        if (this.buffered.length < size) {
          return false;
        }
        const head = this.buffered.subarray(0, size);
        this.buffered = this.buffered.subarray(size);
        this.pending = null;
        resolve(Buffer.from(head));
        return true;
      };
      if (!take()) {
        this.pending = {
          fail: reject,
          take: () => {
            take();
          },
        };
      }
    });
  }

  private async exchangeNow(apdu: Uint8Array): Promise<Uint8Array> {
    const socket = await this.open();
    const header = Buffer.alloc(4);
    header.writeUInt32BE(apdu.length, 0);
    socket.write(Buffer.concat([header, Buffer.from(apdu)]));
    // Speculos counts the reply length without the 2-byte status word.
    // Bounded: a reply that never comes (a dead emulator, a review nobody
    // answers) fails the exchange instead of waiting on the test timeout.
    const timer = setTimeout(
      () => this.drop(new Error("Speculos did not answer the APDU in time")),
      EXCHANGE_TIMEOUT_MS,
    );
    try {
      const length = (await this.read(4)).readUInt32BE(0);
      return Uint8Array.from(await this.read(length + 2));
    } finally {
      clearTimeout(timer);
    }
  }
}

/** One text element Speculos reports on the current screen. */
type ScreenText = {
  readonly h?: number;
  readonly text: string;
  readonly w?: number;
  readonly x: number;
  readonly y: number;
};

/** REST client for the emulated screen and inputs. */
export class SpeculosScreen {
  private readonly seen: string[] = [];

  constructor(private readonly endpoints: SpeculosEndpoints) {}

  /**
   * Every distinct screen read and every input sent, in order. Test evidence
   * only: the device holds the public test phrase, never a secret.
   */
  transcript(): readonly string[] {
    return [...this.seen];
  }

  /** Text elements on the current screen. */
  async texts(): Promise<readonly ScreenText[]> {
    const response = await fetch(`${this.endpoints.apiUrl}/events?currentscreenonly=true`);
    const body = (await response.json()) as { readonly events?: readonly ScreenText[] };
    const texts = (body.events ?? []).filter((event) => typeof event.text === "string");
    const line = `screen: ${texts.map((event) => `${event.text}@${event.x},${event.y}`).join(" | ")}`;
    if (this.seen.at(-1) !== line) {
      this.seen.push(line);
    }
    return texts;
  }

  /** The current screen's text joined with spaces. */
  async text(): Promise<string> {
    return (await this.texts()).map((event) => event.text).join(" ");
  }

  /** Polls until the screen text matches, or throws with what was on screen. */
  async waitFor(pattern: RegExp, timeoutMs = 15_000): Promise<string> {
    const deadline = performance.now() + timeoutMs;
    let last = "";
    while (performance.now() < deadline) {
      last = await this.text();
      if (pattern.test(last)) {
        return last;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`Speculos screen never matched ${pattern}; last screen: "${last}"`);
  }

  /** Presses and releases a Nano button. */
  async press(button: "left" | "right" | "both"): Promise<void> {
    await this.post(`/button/${button}`, { action: "press-and-release" });
  }

  /** Taps (or holds, with `delay` seconds) a touchscreen point. */
  async touch(x: number, y: number, delay = 0.5): Promise<void> {
    await this.post("/finger", { action: "press-and-release", delay, x, y });
  }

  /** Swipes left from a point, as Ragger's `SWIPE_CENTER_TO_LEFT` does. */
  async swipeLeft(x: number, y: number): Promise<void> {
    await this.post("/finger", {
      action: "press-and-release",
      delay: 0.5,
      x,
      x2: x - 10,
      y,
      y2: y,
    });
  }

  private async post(path: string, body: unknown): Promise<void> {
    this.seen.push(`input: ${path} ${JSON.stringify(body)}`);
    const response = await fetch(`${this.endpoints.apiUrl}${path}`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(`Speculos ${path} answered ${response.status}`);
    }
    // Let the emulated screen settle before the next read.
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}
