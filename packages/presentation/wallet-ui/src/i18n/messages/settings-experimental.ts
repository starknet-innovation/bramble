/**
 * Settings > Experimental features: the per-feature Default / On / Off
 * overrides. Split from ./settings.ts by size.
 */
import type { Catalog } from "@bramble/core/i18n";

const en = {
  "settings.experimental.default": "Default",
  "settings.experimental.hint":
    "These switch wallet features on or off on this device. A changed feature may not work as expected. A feature Bramble turns off stays off.",
  "settings.experimental.killed": "Off · turned off by Bramble",
  "settings.experimental.loadFailed": "Couldn't load experimental features.",
  "settings.experimental.loading": "Loading experimental features…",
  "settings.experimental.none": "This version has no features you can change.",
  "settings.experimental.off": "Off",
  "settings.experimental.on": "On",
  "settings.experimental.reset": "Reset all",
  "settings.experimental.retryLabel": "Retry loading experimental features",
  "settings.experimental.saved": "Saved",
  "settings.experimental.stateChosen": "{value} · your choice",
  "settings.experimental.stateDefault": "{value} · default",
  "settings.experimental.title": "Experimental features",
} as const;

/** English and Simplified Chinese Experimental features copy. */
export const settingsExperimentalMessages = {
  en,
  "zh-Hans": {
    "settings.experimental.default": "默认",
    "settings.experimental.hint":
      "这些开关可在此设备上开启或关闭钱包功能。更改过的功能可能无法按预期工作。被 Bramble 关闭的功能会保持关闭。",
    "settings.experimental.killed": "关闭 · 由 Bramble 关闭",
    "settings.experimental.loadFailed": "无法加载实验性功能。",
    "settings.experimental.loading": "正在加载实验性功能…",
    "settings.experimental.none": "此版本没有可更改的功能。",
    "settings.experimental.off": "关闭",
    "settings.experimental.on": "开启",
    "settings.experimental.reset": "全部重置",
    "settings.experimental.retryLabel": "重新加载实验性功能",
    "settings.experimental.saved": "已保存",
    "settings.experimental.stateChosen": "{value} · 你的选择",
    "settings.experimental.stateDefault": "{value} · 默认",
    "settings.experimental.title": "实验性功能",
  } satisfies Catalog<keyof typeof en>,
};
