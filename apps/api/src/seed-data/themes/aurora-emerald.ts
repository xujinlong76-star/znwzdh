/**
 * 种子插件：极光青 (Aurora Emerald)
 *
 * 由 seed-plugins.ts 迁移而来（2026-10-20 内容升级批次），原文内容一字未改，
 * 目的是把主文件拆成「一条插件一个文件」，便于后续加深与评审。
 */
import type { SeedPluginDef } from "../types.ts";

export const auroraEmerald: SeedPluginDef = {
  slug: "aurora-emerald",
  status: "published",
  manifest: {
    manifestVersion: 1,
    kind: "theme",
    name: "极光青 (Aurora Emerald)",
    description:
      "以极光青绿为主色的深色皮肤（20 项变量）：低饱和墨绿底衬托高亮青绿强调色，长文阅读与技术看板场景下对比柔和不疲劳，圆角收紧到 0.5rem 更显硬朗。",
    icon: "🌌",
    author: "山羊胡官方",
    license: "MIT",
    version: "1.0.0",
    tags: ["主题", "深色", "极光", "青绿"],
    payload: {
      accent: "emerald",
      tokens: {
        "--background": "170 20% 8%",
        "--foreground": "150 20% 94%",
        "--card": "172 18% 12%",
        "--card-foreground": "150 20% 94%",
        "--popover": "172 18% 12%",
        "--popover-foreground": "150 20% 94%",
        "--primary": "160 84% 45%",
        "--primary-foreground": "170 40% 8%",
        "--secondary": "172 16% 18%",
        "--secondary-foreground": "150 20% 92%",
        "--muted": "172 16% 18%",
        "--muted-foreground": "160 10% 64%",
        "--accent": "186 76% 52%",
        "--accent-foreground": "170 40% 8%",
        "--destructive": "0 72% 55%",
        "--destructive-foreground": "0 0% 100%",
        "--border": "172 14% 22%",
        "--input": "172 14% 22%",
        "--ring": "160 84% 45%",
        "--radius": "0.5rem",
      },
    },
  },
};
