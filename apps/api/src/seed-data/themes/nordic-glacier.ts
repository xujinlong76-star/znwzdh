/**
 * 种子插件：北欧冰川极简冷灰主题（theme）
 */
import type { SeedPluginDef } from "../types.ts";

export const nordicGlacier: SeedPluginDef = {
  slug: "nordic-glacier",
  status: "published",
  manifest: {
    manifestVersion: 1,
    kind: "theme",
    name: "北欧冰川极简冷灰主题",
    description: "源自北欧斯堪的纳维亚半岛的极简冰川清爽冷灰调（20 项变量全覆盖）：冰川幽蓝冷灰背景配以微霜青强调色，卡片边框轻薄如薄冰，呈现现代高端极简美学质感。",
    icon: "❄️",
    author: "NavHub 官方",
    license: "MIT",
    version: "1.0.0",
    tags: ["主题","冷色","北欧","冰川","清爽"],
    payload: {
      "accent": "emerald",
      "tokens": {
            "--background": "215 28% 17%",
            "--foreground": "210 30% 94%",
            "--card": "217 33% 21%",
            "--card-foreground": "210 30% 94%",
            "--popover": "217 33% 21%",
            "--popover-foreground": "210 30% 94%",
            "--primary": "193 82% 65%",
            "--primary-foreground": "215 28% 13%",
            "--secondary": "215 25% 27%",
            "--secondary-foreground": "210 30% 94%",
            "--muted": "215 25% 27%",
            "--muted-foreground": "215 20% 70%",
            "--accent": "178 70% 62%",
            "--accent-foreground": "215 28% 13%",
            "--destructive": "354 70% 64%",
            "--destructive-foreground": "210 30% 94%",
            "--border": "215 25% 30%",
            "--input": "215 25% 30%",
            "--ring": "193 82% 65%",
            "--radius": "0.75rem"
      }
}
  }
};
