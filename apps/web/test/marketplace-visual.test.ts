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

  it("市场各页面展板统一使用 market-hero", () => {
    const pages = [
      "src/app/marketplace/page.tsx",
      "src/app/marketplace/installed/page.tsx",
      "src/app/marketplace/mine/page.tsx",
      "src/app/marketplace/import/page.tsx",
      "src/app/marketplace/author/[key]/page.tsx",
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
    const page = overlaySource("src/app/marketplace/page.tsx")
    expect(page).toContain("animate-pulse")
    expect(page).toContain("正在加载插件市场")
  })

  it("详情页 OG 卡片带装饰光斑", () => {
    const og = overlaySource("src/app/marketplace/[slug]/opengraph-image.tsx")
    expect(og).toContain("position: 'absolute'")
    expect(og).toContain("borderRadius: 999")
  })
})
