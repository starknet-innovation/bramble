/**
 * Copy for the standalone Ledger grant tab, in English and Simplified Chinese.
 *
 * The tab is its own page with no runtime client, so it follows the browser's
 * language list (set once by the entrypoint through `setGrantLocale`). Text
 * lands only through `textContent`, never as markup. Support codes and the
 * transport detail line stay English: they are read by support, not the user.
 * Device error sentences come from `ledgerMessageIn` (ledger-protocol), which holds
 * their translations beside the English source; they are not repeated here.
 */
import {
  type Catalog,
  type Locale,
  type MessageArgs,
  SOURCE_LOCALE,
  translator,
} from "@bramble/core/i18n";

const en = {
  "ledgerGrant.access.blocked": "Device access blocked",
  "ledgerGrant.access.blockedCopy":
    "Reconnect the Ledger, then allow device access for Bramble in your browser.",
  "ledgerGrant.button.checkStarknet": "Check Starknet again",
  "ledgerGrant.button.checkingSupport": "Checking browser support…",
  "ledgerGrant.button.connectUsb": "Connect with USB",
  "ledgerGrant.button.connected": "Connected",
  "ledgerGrant.button.pairBluetooth": "Pair with Bluetooth",
  "ledgerGrant.button.tryAgain": "Try again",
  "ledgerGrant.button.tryBluetooth": "Try Bluetooth pairing",
  "ledgerGrant.button.tryHid": "Try HID cable",
  "ledgerGrant.button.tryInstead": "Try {transport} instead",
  "ledgerGrant.button.tryUsb": "Try USB cable",
  "ledgerGrant.button.waiting": "Waiting for {transport}…",
  "ledgerGrant.cancel": "Cancel",
  "ledgerGrant.chooser.connect":
    "Select your Ledger in your browser's {transport} device list, then click Connect.",
  "ledgerGrant.chooser.pair":
    "Select your Ledger in your browser's {transport} device list, then click Pair.",
  "ledgerGrant.chooser.title": "Choose your device in your browser",
  "ledgerGrant.connected.copy": "Starknet {version} verified. Bramble is ready to continue.",
  "ledgerGrant.connected.title": "Ledger connected",
  "ledgerGrant.disconnect": "Disconnect",
  "ledgerGrant.documentTitle": "Connect your Ledger — Bramble",
  "ledgerGrant.failed.copy":
    "Reconnect the cable, unlock the device, open Starknet, and close other wallet apps.",
  "ledgerGrant.failed.title": "Ledger connection failed",
  "ledgerGrant.footnote": "Your keys never leave your Ledger.",
  "ledgerGrant.interface.alternate":
    "Your browser couldn't open that connection. Try {transport} instead.",
  "ledgerGrant.interface.retry": "Reconnect the Ledger, close other wallet apps, and try again.",
  "ledgerGrant.interface.title": "{transport} couldn't open the Ledger",
  "ledgerGrant.intro":
    "Your browser needs this tab open to reach your Ledger. It closes when the wallet is done.",
  "ledgerGrant.method.bluetooth": "Bluetooth",
  "ledgerGrant.method.title": "Connection method",
  "ledgerGrant.method.usb": "USB cable",
  "ledgerGrant.notReady": "Ledger isn't ready",
  "ledgerGrant.openStarknet": "Open Starknet on your Ledger",
  "ledgerGrant.picker.ble":
    "No Ledger was found to pair with. Choose USB above if the device is cabled.",
  "ledgerGrant.picker.cable":
    "No Ledger was found. Unlock the device, open the Starknet app, and try again.",
  "ledgerGrant.picker.title": "No Ledger selected",
  "ledgerGrant.preview":
    "Hardware preview · Bramble has not been tested against every Ledger model. Use test funds only.",
  "ledgerGrant.progress.checkingDevice": "Checking your Ledger",
  "ledgerGrant.progress.checkingFirmware": "Checking Ledger firmware",
  "ledgerGrant.progress.confirmingStarknet": "Confirming Starknet",
  "ledgerGrant.progress.handshake": "Checking firmware and Starknet",
  "ledgerGrant.progress.noSignature": "No transaction is signed.",
  "ledgerGrant.progress.openingStarknet": "Approve opening Starknet",
  "ledgerGrant.progress.openingStarknetCopy":
    "Confirm the prompt on your Ledger. No transaction is signed.",
  "ledgerGrant.progress.reconnectingDashboard": "Reconnecting to your Ledger",
  "ledgerGrant.progress.reconnectingStarknet": "Starknet is opening",
  "ledgerGrant.progress.returningToDashboard": "Returning to the dashboard",
  "ledgerGrant.readiness.title": "Before you continue",
  "ledgerGrant.session.copy": "This hardware tab needs a fresh secure session from the wallet.",
  "ledgerGrant.session.title": "Open Ledger from Bramble",
  "ledgerGrant.steps.bleOne": "Enable Bluetooth, then power your Ledger off and back on",
  "ledgerGrant.steps.bleTwo": "Stay on the Ledger dashboard and pair it in your browser",
  "ledgerGrant.steps.cableOne": "Unlock your Ledger and connect a data-capable USB cable",
  "ledgerGrant.steps.cableTwo": "Choose your Ledger in your browser, then press Connect",
  "ledgerGrant.title": "Connect your Ledger",
  "ledgerGrant.transport.title": "Ledger transport unavailable",
  "ledgerGrant.transport.noBluetooth":
    "Bluetooth is unavailable in this browser. Connect with USB instead.",
  "ledgerGrant.transport.unsupported":
    "Use the latest Chrome, Brave, or Edge on desktop, then try again.",
} as const;

/** English and Simplified Chinese grant-tab copy. */
export const ledgerGrantMessages = {
  en,
  "zh-Hans": {
    "ledgerGrant.access.blocked": "设备访问被阻止",
    "ledgerGrant.access.blockedCopy": "重新连接 Ledger，然后在浏览器中允许 Bramble 访问设备。",
    "ledgerGrant.button.checkStarknet": "再次检查 Starknet",
    "ledgerGrant.button.checkingSupport": "正在检查浏览器支持…",
    "ledgerGrant.button.connectUsb": "通过 USB 连接",
    "ledgerGrant.button.connected": "已连接",
    "ledgerGrant.button.pairBluetooth": "通过蓝牙配对",
    "ledgerGrant.button.tryAgain": "重试",
    "ledgerGrant.button.tryBluetooth": "尝试蓝牙配对",
    "ledgerGrant.button.tryHid": "尝试 HID 数据线",
    "ledgerGrant.button.tryInstead": "改用 {transport}",
    "ledgerGrant.button.tryUsb": "尝试 USB 数据线",
    "ledgerGrant.button.waiting": "正在等待 {transport}…",
    "ledgerGrant.cancel": "取消",
    "ledgerGrant.chooser.connect":
      "在浏览器的 {transport} 设备列表中选择你的 Ledger，然后点击“连接”。",
    "ledgerGrant.chooser.pair":
      "在浏览器的 {transport} 设备列表中选择你的 Ledger，然后点击“配对”。",
    "ledgerGrant.chooser.title": "在浏览器中选择你的设备",
    "ledgerGrant.connected.copy": "Starknet {version} 已验证。Bramble 可以继续。",
    "ledgerGrant.connected.title": "Ledger 已连接",
    "ledgerGrant.disconnect": "断开连接",
    "ledgerGrant.documentTitle": "连接你的 Ledger — Bramble",
    "ledgerGrant.failed.copy": "重新连接数据线，解锁设备，打开 Starknet，并关闭其他钱包应用。",
    "ledgerGrant.failed.title": "Ledger 连接失败",
    "ledgerGrant.footnote": "你的密钥永远不会离开 Ledger。",
    "ledgerGrant.interface.alternate": "浏览器无法打开该连接。改用 {transport}。",
    "ledgerGrant.interface.retry": "重新连接 Ledger，关闭其他钱包应用，然后重试。",
    "ledgerGrant.interface.title": "{transport} 无法打开 Ledger",
    "ledgerGrant.intro": "浏览器需要保持此标签页打开才能连接 Ledger。钱包完成后它会自动关闭。",
    "ledgerGrant.method.bluetooth": "蓝牙",
    "ledgerGrant.method.title": "连接方式",
    "ledgerGrant.method.usb": "USB 数据线",
    "ledgerGrant.notReady": "Ledger 尚未就绪",
    "ledgerGrant.openStarknet": "在 Ledger 上打开 Starknet",
    "ledgerGrant.picker.ble": "未找到可配对的 Ledger。如果设备已用数据线连接，在上方选择 USB。",
    "ledgerGrant.picker.cable": "未找到 Ledger。解锁设备，打开 Starknet 应用，然后重试。",
    "ledgerGrant.picker.title": "未选择 Ledger",
    "ledgerGrant.preview": "硬件预览版 · Bramble 尚未在所有 Ledger 型号上测试。只使用测试资金。",
    "ledgerGrant.progress.checkingDevice": "正在检查你的 Ledger",
    "ledgerGrant.progress.checkingFirmware": "正在检查 Ledger 固件",
    "ledgerGrant.progress.confirmingStarknet": "正在确认 Starknet",
    "ledgerGrant.progress.handshake": "正在检查固件和 Starknet",
    "ledgerGrant.progress.noSignature": "不会签名任何交易。",
    "ledgerGrant.progress.openingStarknet": "批准打开 Starknet",
    "ledgerGrant.progress.openingStarknetCopy": "在 Ledger 上确认提示。不会签名任何交易。",
    "ledgerGrant.progress.reconnectingDashboard": "正在重新连接 Ledger",
    "ledgerGrant.progress.reconnectingStarknet": "Starknet 正在打开",
    "ledgerGrant.progress.returningToDashboard": "正在返回主界面",
    "ledgerGrant.readiness.title": "继续之前",
    "ledgerGrant.session.copy": "此硬件标签页需要钱包提供新的安全会话。",
    "ledgerGrant.session.title": "从 Bramble 打开 Ledger",
    "ledgerGrant.steps.bleOne": "开启蓝牙，然后将 Ledger 关机再开机",
    "ledgerGrant.steps.bleTwo": "停留在 Ledger 主界面，并在浏览器中配对",
    "ledgerGrant.steps.cableOne": "解锁 Ledger，并用支持数据传输的 USB 数据线连接",
    "ledgerGrant.steps.cableTwo": "在浏览器中选择你的 Ledger，然后点击“连接”",
    "ledgerGrant.title": "连接你的 Ledger",
    "ledgerGrant.transport.title": "无法使用 Ledger 连接方式",
    "ledgerGrant.transport.noBluetooth": "此浏览器不支持蓝牙。改用 USB 连接。",
    "ledgerGrant.transport.unsupported": "使用桌面版最新的 Chrome、Brave 或 Edge，然后重试。",
  } satisfies Catalog<keyof typeof en>,
};

let active: Locale = SOURCE_LOCALE;

/** Sets the grant tab's language. Called once by the entrypoint before rendering. */
export const setGrantLocale = (locale: Locale): void => {
  active = locale;
};

/** The grant tab's language, for text rendered from another catalog. */
export const grantLocale = (): Locale => active;

const lookup = translator(ledgerGrantMessages);

/** A grant-tab message in the tab's language, as plain text for `textContent`. */
export const gt = <K extends keyof typeof en>(
  key: K,
  ...args: MessageArgs<(typeof en)[K]>
): string => lookup(active)(key, ...args);
