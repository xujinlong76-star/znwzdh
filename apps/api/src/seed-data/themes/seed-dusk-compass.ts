/**
 * 种子插件：暮色罗盘
 *
 * 由 seed-plugins.ts 迁移而来（2026-10-20 内容升级批次），原文内容一字未改，
 * 目的是把主文件拆成「一条插件一个文件」，便于后续加深与评审。
 */
import type { SeedPluginDef } from "../types.ts";

export const seedDuskCompass: SeedPluginDef = {
  slug: "seed-dusk-compass",
  status: "published",
  manifest: {
    manifestVersion: 1,
    kind: "theme",
    name: "暮色罗盘",
    description:
      "紫罗兰暮色完整皮肤（20 项变量）：夜蓝底 + 紫罗兰主色 + 淡紫次色，更大的圆角与统一聚焦环，长时间浏览与写作时层次清晰不刺目。",
    icon: "🌆",
    author: "山羊胡官方",
    license: "MIT",
    version: "2.0.0",
    tags: ["主题", "深色", "紫罗兰"],
    payload: {
      accent: "violet",
      tokens: {
        "--background": "240 10% 8%",
        "--foreground": "260 20% 94%",
        "--card": "243 12% 13%",
        "--card-foreground": "260 20% 94%",
        "--popover": "243 12% 13%",
        "--popover-foreground": "260 20% 94%",
        "--primary": "262 83% 58%",
        "--primary-foreground": "0 0% 100%",
        "--secondary": "248 14% 20%",
        "--secondary-foreground": "260 20% 92%",
        "--muted": "248 14% 20%",
        "--muted-foreground": "252 12% 66%",
        "--accent": "286 60% 62%",
        "--accent-foreground": "0 0% 100%",
        "--destructive": "0 72% 58%",
        "--destructive-foreground": "0 0% 100%",
        "--border": "248 12% 24%",
        "--input": "248 12% 24%",
        "--ring": "262 83% 58%",
        "--radius": "0.9rem",
      },
    },
  },
};
