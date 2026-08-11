/**
 * Decouples the message handlers from the runtime broadcast. A signTypedData
 * request queues an approval and holds its response until the user decides, so
 * it must push an "approvals changed" signal to the side panel at queue time
 * rather than when the delayed response resolves. The entrypoint registers the
 * real broadcaster; tests leave the default no-op.
 */
let sink: () => void = () => undefined;

/**
 * Registers the broadcaster that notifies open surfaces of a queue change.
 */
export const setApprovalNotifier = (notify: () => void): void => {
  sink = notify;
};

/**
 * Signals that the pending-approval queue changed (e.g. a request was queued).
 */
export const notifyApprovalsChanged = (): void => {
  sink();
};
