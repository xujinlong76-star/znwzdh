/**
 * 种子插件：OLED 纯黑极致省电主题（theme）
 */
import type { SeedPluginDef } from "../types.ts";

export const oledPureBlack: SeedPluginDef = {
  slug: "oled-pure-black",
  status: "published",
  manifest: {
    manifestVersion: 1,
    kind: "theme",
    name: "OLED 纯黑极致省电主题",
    description: "专为 OLED / Mini-LED 屏幕优化的纯黑极致省电主题（20 项变量全覆盖）：背景绝对零度真黑 #000000 像素级关闭发光，搭配超高对比度微蓝白文字与电光青聚焦环，深夜视网膜零负担。",
    icon: "🌑",
    author: "NavHub 官方",
    license: "MIT",
    version: "1.0.0",
    tags: ["主题","深色","OLED","纯黑","极简"],
    payload: {
      "accent": "rose",
      "tokens": {
            "--background": "0 0% 0%",
            "--foreground": "210 40% 98%",
            "--card": "0 0% 6%",
            "--card-foreground": "210 40% 98%",
            "--popover": "0 0% 6%",
            "--popover-foreground": "210 40% 98%",
            "--primary": "189 94% 53%",
            "--primary-foreground": "0 0% 0%",
            "--secondary": "0 0% 12%",
            "--secondary-foreground": "210 40% 98%",
            "--muted": "0 0% 12%",
            "--muted-foreground": "215 20% 65%",
            "--accent": "217 91% 60%",
            "--accent-foreground": "0 0% 0%",
            "--destructive": "0 84% 60%",
            "--destructive-foreground": "210 40% 98%",
            "--border": "0 0% 16%",
            "--input": "0 0% 16%",
            "--ring": "189 94% 53%",
            "--radius": "0.5rem"
      }
}
  }
};
