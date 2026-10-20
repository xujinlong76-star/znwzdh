/**
 * 种子插件：赛博深色主题 (Dracula Dark)
 *
 * 由 seed-plugins.ts 迁移而来（2026-10-20 内容升级批次），原文内容一字未改，
 * 目的是把主文件拆成「一条插件一个文件」，便于后续加深与评审。
 */
import type { SeedPluginDef } from "../types.ts";

export const draculaDark: SeedPluginDef = {
  slug: "dracula-dark",
  status: "published",
  manifest: {
    manifestVersion: 1,
    kind: "theme",
    name: "赛博深色主题 (Dracula Dark)",
    description:
      "完整移植经典 Dracula 配色体系（20 项变量全覆盖）：深蓝黑底 + 粉紫霓虹强调色 + 高对比前景，整站卡片、弹层、输入框、聚焦环与圆角同步换肤，深夜长时间编码不刺眼。",
    icon: "🧛",
    author: "NavHub 官方",
    license: "MIT",
    version: "2.0.0",
    tags: ["主题", "深色", "Dracula", "赛博朋克"],
    payload: {
      accent: "rose",
      tokens: {
        "--background": "231 15% 18%",
        "--foreground": "60 30% 96%",
        "--card": "232 14% 22%",
        "--card-foreground": "60 30% 96%",
        "--popover": "232 14% 22%",
        "--popover-foreground": "60 30% 96%",
        "--primary": "326 100% 74%",
        "--primary-foreground": "231 15% 12%",
        "--secondary": "232 14% 28%",
        "--secondary-foreground": "60 30% 96%",
        "--muted": "232 14% 28%",
        "--muted-foreground": "228 12% 68%",
        "--accent": "265 89% 74%",
        "--accent-foreground": "231 15% 12%",
        "--destructive": "0 100% 66%",
        "--destructive-foreground": "231 15% 12%",
        "--border": "232 14% 30%",
        "--input": "232 14% 30%",
        "--ring": "326 100% 74%",
        "--radius": "0.75rem",
      },
    },
  },
};
