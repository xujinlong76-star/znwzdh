/**
 * 种子插件：暖阳琥珀 (Sunlit Amber)
 *
 * 由 seed-plugins.ts 迁移而来（2026-10-20 内容升级批次），原文内容一字未改，
 * 目的是把主文件拆成「一条插件一个文件」，便于后续加深与评审。
 */
import type { SeedPluginDef } from "../types.ts";

export const sunlitAmber: SeedPluginDef = {
  slug: "sunlit-amber",
  status: "published",
  manifest: {
    manifestVersion: 1,
    kind: "theme",
    name: "暖阳琥珀 (Sunlit Amber)",
    description:
      "暖阳琥珀浅色皮肤（20 项变量）：米白底 + 琥珀橙强调色 + 深棕前景，白天办公与演示投屏时清晰通透，是深色之外的高可读性选择。",
    icon: "🌤️",
    author: "山羊胡官方",
    license: "MIT",
    version: "1.0.0",
    tags: ["主题", "浅色", "琥珀", "护眼"],
    payload: {
      accent: "amber",
      tokens: {
        "--background": "40 40% 97%",
        "--foreground": "28 40% 14%",
        "--card": "40 36% 99%",
        "--card-foreground": "28 40% 14%",
        "--popover": "40 36% 99%",
        "--popover-foreground": "28 40% 14%",
        "--primary": "32 92% 48%",
        "--primary-foreground": "40 60% 99%",
        "--secondary": "36 30% 93%",
        "--secondary-foreground": "28 40% 18%",
        "--muted": "36 30% 93%",
        "--muted-foreground": "30 10% 42%",
        "--accent": "24 90% 55%",
        "--accent-foreground": "40 60% 99%",
        "--destructive": "0 74% 48%",
        "--destructive-foreground": "0 0% 100%",
        "--border": "34 22% 84%",
        "--input": "34 22% 84%",
        "--ring": "32 92% 48%",
        "--radius": "0.75rem",
      },
    },
  },
};
