/**
 * 种子插件：macOS Sonoma 毛玻璃晶透主题（theme）
 */
import type { SeedPluginDef } from "../types.ts";

export const macSonomaGlass: SeedPluginDef = {
  slug: "mac-sonoma-glass",
  status: "published",
  manifest: {
    manifestVersion: 1,
    kind: "theme",
    name: "macOS Sonoma 深色主题",
    description: "向 Apple macOS 现代桌面美学致敬的深色主题（21 项变量全覆盖）：超大圆角、深海军蓝底与活力系统天蓝强调色，卡片层次干净、聚焦环清晰，完美契合 Mac 桌面审美。",
    icon: "🪟",
    author: "山羊胡官方",
    homepage: "https://www.shanyanghu.com/",
    license: "MIT",
    version: "1.0.2",
    tags: ["主题","深色","macOS","现代"],
    payload: {
      "accent": "system-blue",
      "tokens": {
            "--background": "220 20% 12%",
            "--foreground": "210 40% 98%",
            "--card": "222 24% 17%",
            "--card-foreground": "210 40% 98%",
            "--popover": "222 24% 17%",
            "--popover-foreground": "210 40% 98%",
            "--primary": "212 100% 58%",
            "--primary-foreground": "220 20% 12%",
            "--link": "212 100% 85%",
            "--secondary": "220 18% 24%",
            "--secondary-foreground": "210 40% 98%",
            "--muted": "220 18% 24%",
            "--muted-foreground": "215 20% 70%",
            "--accent": "205 90% 53%",
            "--accent-foreground": "220 20% 12%",
            "--destructive": "0 72% 51%",
            "--destructive-foreground": "0 0% 100%",
            "--border": "220 20% 26%",
            "--input": "220 20% 26%",
            "--ring": "212 100% 58%",
            "--radius": "1rem"
      }
}
  }
};
