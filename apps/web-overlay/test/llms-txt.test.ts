/**
 * llms.txt（U-465：Lighthouse 13 新增 llms-txt 审计 score 0）。
 *
 * 2026-11-26 R5 实测：`GET /llms.txt` → 404；仓库 `apps/web-overlay/public`
 * 与 `src/app` 均无 llms.txt，全仓零引用。修复：加 `public/llms.txt`
 *（Next.js 静态托管，`/llms.txt` 直出，无需路由），内容与 sitemap 的
 * 静态页清单一致。
 *
 * 落盘路径：apps/web-overlay/test/llms-txt.test.ts（事实源）；跑之前先
 * `pnpm mirror:web` 同步到 apps/web/test/，再从仓库根跑 vitest。
 * @/ 别名指向 apps/web/src（vendored 镜像），overlay 里直接跑会解析失败。
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { STATIC_PATHS } from "@/lib/seo/sitemap-entries"

const HERE = dirname(fileURLToPath(import.meta.url))
const ORIGIN = "https://www.shanyanghu.com"

/** 沿用 pwa-offline.test.ts 的 overlaySource：overlay 与镜像两处都能定位。 */
function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p))
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel)
  return readFileSync(hit, "utf8")
}

describe("llms.txt（U-465）", () => {
  it("存在且非空，以站名标题开头，含站点简介与 origin", () => {
    const txt = overlaySource("public/llms.txt")
    expect(txt.length).toBeGreaterThan(100)
    expect(txt.startsWith("# 山羊胡网")).toBe(true)
    expect(txt).toContain("网址导航")
    expect(txt).toContain(ORIGIN)
  })

  it("与 sitemap 静态页一致：STATIC_PATHS 每条都有绝对链接", () => {
    const txt = overlaySource("public/llms.txt")
    for (const p of STATIC_PATHS) {
      expect(txt, `sitemap 静态页缺失：${p}`).toContain(`${ORIGIN}${p}`)
    }
  })

  it("不含相对链接、占位符与 sitemap 之外的死链形态", () => {
    const txt = overlaySource("public/llms.txt")
    expect(txt).not.toMatch(/\]\(\//)
    expect(txt).not.toContain("TODO")
    expect(txt).not.toContain("Lorem")
    expect(txt).toContain(`${ORIGIN}/sitemap.xml`)
  })
})
