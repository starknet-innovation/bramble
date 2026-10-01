/**
 * Side-panel client for account groups: the folders a user arranges their
 * accounts into. Grouping is presentation, not authority — every method here is
 * a preferences write validated by `isPreferencesResponse` before the UI trusts
 * it, and a rejected or malformed reply throws rather than being treated as a
 * silent success.
 *
 * Split out of `runtime.ts` so that file stays within the size budget; the
 * methods are spread back into the one client object the panel uses, so callers
 * see no seam.
 */

import { type AccountGroupIcon, isDefaultGroup } from "@bramble/settings/groups";
import { isPreferencesResponse } from "../../popup/responses/responses";
import { responseError } from "./runtime-errors";

/**
 * The message transport the client is built over: the panel's own
 * `chrome.runtime.sendMessage` wrapper, injected so this module holds no
 * browser handle of its own.
 */
export type GroupMessageSender = (message: unknown) => Promise<unknown>;

/**
 * Creates the account-group half of the side-panel wallet client. Every method
 * rejects with a curated Error when the background refuses or answers with a
 * shape the response guard does not accept.
 */
export const createAccountGroupClient = (sendMessage: GroupMessageSender) => ({
  async createGroup(name: string, icon: AccountGroupIcon): Promise<string> {
    const response = await sendMessage({ icon, name, type: "wallet.createGroup" });
    if (isPreferencesResponse(response)) {
      // The write seeds both default folders and stores the new one between
      // them, so the archive — not the folder just created — is last. The new
      // folder is the last entry that is not a default.
      const groups = response.preferences.groups ?? [];
      const created = [...groups].reverse().find((group) => !isDefaultGroup(group.id));
      if (created) {
        return created.id;
      }
    }
    throw responseError(response, "group create failed");
  },
  async renameGroup(id: string, name: string): Promise<void> {
    const response = await sendMessage({ id, name, type: "wallet.renameGroup" });
    if (isPreferencesResponse(response)) {
      return;
    }
    throw responseError(response, "group rename failed");
  },
  async setGroupIcon(id: string, icon: AccountGroupIcon): Promise<void> {
    const response = await sendMessage({ icon, id, type: "wallet.setGroupIcon" });
    if (isPreferencesResponse(response)) {
      return;
    }
    throw responseError(response, "group icon update failed");
  },
  async removeGroup(id: string): Promise<void> {
    const response = await sendMessage({ id, type: "wallet.removeGroup" });
    if (isPreferencesResponse(response)) {
      return;
    }
    throw responseError(response, "group remove failed");
  },
  async setAccountInGroup(accountId: string, groupId: string, member: boolean): Promise<void> {
    const response = await sendMessage({
      accountId,
      groupId,
      member,
      type: "wallet.setAccountInGroup",
    });
    if (isPreferencesResponse(response)) {
      return;
    }
    throw responseError(response, "group membership update failed");
  },
});
