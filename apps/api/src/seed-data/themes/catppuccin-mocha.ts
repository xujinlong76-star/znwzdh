/**
 * 种子插件：Catppuccin Mocha 极客主题（theme）
 */
import type { SeedPluginDef } from "../types.ts";

export const catppuccinMocha: SeedPluginDef = {
  slug: "catppuccin-mocha",
  status: "published",
  manifest: {
    manifestVersion: 1,
    kind: "theme",
    name: "Catppuccin Mocha 极客主题",
    description: "经典 Catppuccin Mocha 极客深色调色盘（20 项变量全覆盖）：以温润舒缓的暗褐黑为底，搭配摩卡淡紫与粉桃强调色，色彩平衡柔和且层次分明，专为长时间专注编码设计。",
    icon: "☕",
    author: "NavHub 官方",
    license: "MIT",
    version: "1.0.0",
    tags: ["主题","深色","Catppuccin","Mocha","极客"],
    payload: {
      "accent": "violet",
      "tokens": {
            "--background": "240 21% 15%",
            "--foreground": "226 64% 88%",
            "--card": "240 21% 18%",
            "--card-foreground": "226 64% 88%",
            "--popover": "240 21% 18%",
            "--popover-foreground": "226 64% 88%",
            "--primary": "267 84% 81%",
            "--primary-foreground": "240 21% 15%",
            "--secondary": "240 19% 26%",
            "--secondary-foreground": "226 64% 88%",
            "--muted": "240 19% 26%",
            "--muted-foreground": "228 24% 72%",
            "--accent": "316 72% 86%",
            "--accent-foreground": "240 21% 15%",
            "--destructive": "343 81% 75%",
            "--destructive-foreground": "240 21% 15%",
            "--border": "240 16% 28%",
            "--input": "240 16% 28%",
            "--ring": "267 84% 81%",
            "--radius": "0.75rem"
      }
}
  }
};
