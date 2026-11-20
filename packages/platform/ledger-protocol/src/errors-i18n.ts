/**
 * Ledger rejection sentences in every shipped language other than English.
 *
 * `ledgerMessage` stays the English source of truth: other code matches on it
 * and support reads it. This module only renders the same code for a reader
 * in another language. Total over the code union, so a new code cannot ship
 * without its translation. Nothing here changes which code a failure maps to.
 */
import type { Locale } from "@bramble/core/i18n";
import { type LedgerRejectionCode, ledgerMessage } from "./errors";

const ZH_HANS: Readonly<Record<LedgerRejectionCode, string>> = {
  "app-below-minimum":
    "你的 Ledger 上的 Starknet 应用需要更新。在 Ledger Live 中更新，然后重新连接并打开 Starknet。",
  "rejected-or-blind-signing-off":
    "签名未能完成。你可能拒绝了请求，或者盲签已关闭。重试前检查你的 Ledger 及其连接。",
  "chain-failed": "你的交易已提交，但在链上执行失败。",
  "dashboard-restore-failed":
    "你的 Ledger 没有回到主屏幕。解锁设备，停留在 Starknet 应用上，然后重试。",
  "deploy-unfunded": "此账户尚未部署，也没有支付第一笔交易所需的 STRK。添加 STRK 后重试。",
  "device-busy":
    "另一个应用正在使用你的 Ledger。关闭 Ledger Live 和其他正在使用它的标签页，然后重试。",
  "device-locked": "解锁你的 Ledger，然后重试。",
  "disconnected-mid-sign": "你的 Ledger 已断开连接。没有提交任何内容。",
  "locked-mid-sign": "你的 Ledger 自动锁定了。解锁后再次按确认——你会看到同一个请求。",
  "management-refused":
    "你的 Ledger 拒绝了兼容性检查。解锁设备，打开 Starknet 应用，关闭 Ledger Live，然后重试。",
  "management-unreadable": "你的 Ledger 的应用或固件比此钱包支持的版本更新。没有签名任何内容。",
  "multiple-devices": "选择此账户对应的 Ledger。",
  "network-mismatch": "此 Ledger 账户是为另一个网络设置的。切换网络或选择匹配的账户。",
  "no-app-open":
    "在你的 Ledger 上打开 Starknet 应用。如果 Ledger Live 无法安装它，先更新固件（我的 Ledger），然后打开应用。",
  "firmware-below-minimum":
    "你的 Ledger 固件需要更新。在 Ledger Live（我的 Ledger）中更新，然后重新连接并打开 Starknet 应用。",
  "panel-context-lost": "你确认之前 Ledger 标签页已关闭。没有提交任何内容。",
  "picker-cancelled": "没有选择 Ledger。通过 USB 连接，解锁设备，打开 Starknet 应用，然后重试。",
  "rejected-on-device": "你在 Ledger 上拒绝了请求。没有提交任何内容。",
  replug: "重新连接你的 Ledger，然后重试。",
  "sign-timeout": "仍在等待你在 Ledger 上确认。",
  "starknet-reopen-failed":
    "你的 Ledger 无法重新打开 Starknet 应用。在设备上打开它，然后重试。没有签名任何内容。",
  "signature-verify-failed": "无法验证来自你的 Ledger 的签名，因此没有提交任何内容。重试。",
  "unexpected-device-error":
    "与你的 Ledger 通信时出错。打开 Starknet 应用，关闭其他正在使用它的应用，然后重试。",
  "unsupported-ledger-device":
    "尚不支持此 Ledger 设备或固件。在 Ledger Live 中更新，然后重新连接并打开 Starknet 应用。",
  "webhid-unavailable": "Ledger 支持需要基于 Chromium 的浏览器（Chrome、Brave 或 Edge）。",
  "worker-evicted": "钱包在签名过程中重启了。重新连接你的 Ledger 并重试。",
  "wrong-device": "这不是设置此账户时使用的 Ledger。连接你最初使用的那一台。",
};

/** The rejection sentence for `code` in `locale`; English is `ledgerMessage`. */
export const ledgerMessageIn = (code: LedgerRejectionCode, locale: Locale): string =>
  locale === "zh-Hans" ? ZH_HANS[code] : ledgerMessage(code);

/**
 * Every Ledger rejection sentence keyed by its English, for a display layer
 * that only holds the English (an error that passed through a classifier).
 */
export const ledgerMessagesByEnglish = (locale: Locale): ReadonlyMap<string, string> =>
  new Map(
    (Object.keys(ZH_HANS) as LedgerRejectionCode[]).map((code) => [
      ledgerMessage(code),
      ledgerMessageIn(code, locale),
    ]),
  );
