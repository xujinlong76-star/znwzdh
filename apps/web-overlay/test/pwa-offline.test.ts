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
    // 首屏瘦身 Step 5 起走客户端挂载壳（ssr:false 动态加载），挂载点不变
    expect(layout).toContain("InstallPrompt,")
    expect(layout).toContain("from '@/components/shell-background'")
    expect(layout).toContain("<InstallPrompt />")
    expect(overlaySource("src/components/shell-background.tsx")).toContain(
      "import('@/components/install-prompt')",
    )
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
    expect(sw).toContain("navhub-v6")
    expect(sw).not.toContain("navhub-v5")
  })

  it("SW v6 的 SHELL 覆盖 9 条 HTML 路由（不含 /search、不含 /me/* 子页）", () => {
    const sw = overlaySource("public/sw.js")
    const shellBlock = sw.match(/const SHELL = \[([\s\S]*?)\]/)
    expect(shellBlock).not.toBeNull()
    const shell = shellBlock![1]
    for (const route of ["'/'", "'/offline'", "'/favorites'", "'/me'", "'/algorithms'", "'/videos'", "'/scenes'", "'/hot'", "'/tags'"]) {
      expect(shell).toContain(route)
    }
    expect(shell).not.toContain("'/search'")
    expect(shell).not.toContain("'/me/history'")
    expect(shell).not.toContain("'/me/data'")
    // 图标与 manifest 行保留
    expect(shell).toContain("'/icons/icon-192.png'")
    expect(shell).toContain("'/manifest.webmanifest'")
  })

  it("precache 循环解析 SHELL 里每个 HTML 的 _next/static，单页失败跳过", () => {
    const sw = overlaySource("public/sw.js")
    expect(sw).toContain("SHELL.filter")
    expect(sw).toContain("_next/static")
    expect(sw).toContain("Promise.allSettled")
  })

  it("导航失败回退 /offline（不是 /），并带上 ?from=<原路径> 只做展示", () => {
    const sw = overlaySource("public/sw.js")
    expect(sw).toContain("caches.match('/offline')")
    expect(sw).not.toContain("caches.match('/')")
    expect(sw).toContain("Response.redirect")
    expect(sw).toContain("?from=")
    expect(sw).toContain("encodeURIComponent")
  })

  it("红线不动：localhost 自毁、/api/ 与 RSC 直通、只缓存 200、SWR 只给静态产物", () => {
    const sw = overlaySource("public/sw.js")
    expect(sw).toContain("localhost")
    expect(sw).toContain("registration.unregister()")
    expect(sw).toContain("startsWith('/api/')")
    expect(sw).toContain("'_rsc'")
    expect(sw).toContain("res.ok")
    expect(sw).toContain("skipWaiting")
    expect(sw).toContain("clients.claim()")
    expect(sw).toContain("startsWith('/_next/static/')")
    expect(sw).toContain("startsWith('/icons/')")
  })

  it("overlay 与 apps/web 镜像的 sw.js 一致", () => {
    const overlaySw = overlaySource("public/sw.js")
    const mirrorPath = resolve(HERE, "..", "public", "sw.js")
    if (existsSync(mirrorPath)) {
      expect(readFileSync(mirrorPath, "utf8")).toBe(overlaySw)
    }
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
