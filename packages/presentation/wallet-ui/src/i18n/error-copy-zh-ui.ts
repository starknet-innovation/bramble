/**
 * Simplified Chinese for error sentences the panel writes itself and shows as
 * written (a fallback, a thrown refusal), keyed by the exact English literal at
 * its source. Those literals stay English at the source because scanners and
 * matchers read them; `errors-zh.test.ts` fails when a key no longer appears in
 * the panel's source, so an edited sentence cannot keep a stale translation.
 */
export const ERROR_COPY_ZH_UI: Readonly<Record<string, string>> = {
  // journeys/send
  "Transfer review failed": "无法检查此转账。",
  "Review this send first": "先检查此发送。",
  // journeys/privacy
  "Private journey unavailable": "隐私功能不可用",
  "The wallet's background worker stopped before the private operation finished. Try again.":
    "隐私操作完成前，钱包的后台进程已停止。重试。",
  "The wallet's background worker stopped while sending this private transaction, so its status is unknown. Check Activity before trying again.":
    "发送这笔隐私交易时钱包的后台进程停止了，因此其状态未知。重试前先查看活动。",
  // journeys/settings/endpoint-ui
  "Enter a secure HTTPS service URL with no spaces, quotes, angle brackets or backticks":
    "输入安全的 HTTPS 服务网址，不含空格、引号、尖括号或反引号",
  "Enter a secure WSS relay URL with no spaces, quotes, angle brackets or backticks":
    "输入安全的 WSS 中继网址，不含空格、引号、尖括号或反引号",
  "Host permission controls are unavailable in this browser": "此浏览器不提供主机权限控制",
  "Your browser did not grant access to that service host": "你的浏览器未授权访问该服务主机",
  "Your browser did not grant access to those service hosts": "你的浏览器未授权访问这些服务主机",
  "Your browser did not grant access to that explorer host": "你的浏览器未授权访问该区块浏览器主机",
};
