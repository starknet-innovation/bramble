/**
 * Stark-curve signature returned by an authorized software or hardware signer.
 */
export type StarkSignature = {
  readonly publicKey: string;
  readonly r: string;
  readonly s: string;
};

/**
 * Raw two-scalar signature returned by a hardware device.
 */
export type DeviceSignature = Pick<StarkSignature, "r" | "s">;
