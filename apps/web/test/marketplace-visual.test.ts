import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p))
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel)
  return readFileSync(hit, "utf8")
}

describe("插件市场排版：展板背景工具类", () => {
  it("globals.css 提供 market-hero（浅色 + 深色两套）", () => {
    const css = overlaySource("src/styles/globals.css")
    expect(css).toContain(".market-hero")
    expect(css).toContain(".dark .market-hero")
  })

  it("globals.css 显式声明市场子树扫描源（否则排版类不进产物 CSS）", () => {
    const css = overlaySource("src/styles/globals.css")
    expect(css).toContain("@source '../app/marketplace/**/*.{js,ts,jsx,tsx,mdx}'")
    expect(css).toContain("@source '../components/plugins/**/*.{js,ts,jsx,tsx,mdx}'")
  })

  it("市场各页面展板统一使用 market-hero", () => {
    const pages = [
      // Batch E 后市场首页是「服务端壳 + PluginMarketBoard 岛」，展板在岛里
      "src/components/plugin-market-board.tsx",
      "src/app/marketplace/installed/page.tsx",
      "src/app/marketplace/mine/page.tsx",
      "src/app/marketplace/import/page.tsx",
      "src/app/marketplace/author/[key]/author-plugins-view.tsx",
    ]
    for (const p of pages) {
      expect(overlaySource(p)).toContain("market-hero")
    }
  })
})

describe("插件市场排版：卡片与列表细节", () => {
  it("卡片按插件类型给图标底座上色", () => {
    const card = overlaySource("src/components/plugins/plugin-card.tsx")
    expect(card).toContain("kindTileClass")
    expect(card).toContain("bg-sky-500/10")
    expect(card).toContain("bg-violet-500/10")
    expect(card).toContain("bg-amber-500/10")
  })

  it("列表加载态用骨架屏，不再是居中转圈", () => {
    const page = overlaySource("src/components/plugin-market-board.tsx")
    expect(page).toContain("animate-pulse")
    expect(page).toContain("正在加载插件市场")
  })

  it("宽屏才切到四列（2xl 变体在本仓库不生成，改用任意断点 + 重要标记）", () => {
    const page = overlaySource("src/components/plugin-market-board.tsx")
    expect(page).toContain("min-[1536px]:grid-cols-4!")
    expect(page).not.toContain("2xl:grid-cols")
  })

  it("详情页 OG 卡片带装饰光斑", () => {
    const og = overlaySource("src/app/marketplace/[slug]/opengraph-image.tsx")
    expect(og).toContain("position: 'absolute'")
    expect(og).toContain("borderRadius: 999")
  })
})
