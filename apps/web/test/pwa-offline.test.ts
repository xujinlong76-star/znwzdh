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

describe("PWA: 安装引导接线", () => {
  it("根布局挂载 InstallPrompt", () => {
    const layout = overlaySource("src/app/layout.tsx")
    expect(layout).toContain("import { InstallPrompt } from '@/components/install-prompt'")
    expect(layout).toContain("<InstallPrompt />")
  })

  it("安装引导只监听浏览器安装事件并复用纯判定", () => {
    const src = overlaySource("src/components/install-prompt.tsx")
    expect(src).toContain('window.addEventListener("beforeinstallprompt", onPrompt)')
    expect(src).toContain('window.addEventListener("appinstalled", onInstalled)')
    expect(src).toContain("shouldOfferInstall(")
  })
})

describe("PWA: 离线阅读接线", () => {
  it("Service Worker 预缓存 /offline 并带构建产物", () => {
    const sw = overlaySource("public/sw.js")
    expect(sw).toContain("'/offline'")
    expect(sw).toContain("precacheOfflineAssets")
    expect(sw).toContain("navhub-v4")
  })

  it("离线提示可以跳到离线阅读页", () => {
    expect(overlaySource("src/components/offline-banner.tsx")).toContain('href="/offline"')
  })

  it("普通点击卡片会记录最近访问，多选点击不记录", () => {
    const src = overlaySource("src/components/navigation-card.tsx")
    const idx = src.indexOf("const handleLinkClick")
    const body = src.slice(idx, idx + 420)
    const guard = body.indexOf("if (!selectable) {")
    const record = body.indexOf("recordOfflineVisit(")
    const prevent = body.indexOf("preventDefault()")
    expect(guard).toBeGreaterThan(-1)
    expect(record).toBeGreaterThan(guard)
    expect(prevent).toBeGreaterThan(record)
  })
})
