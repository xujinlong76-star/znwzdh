import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * 安装体感（P0-2）接线守卫。
 *
 * 为什么用源码扫描而不是渲染测试：这三件事都是「接线」——接口路径、状态字段、
 * 展示位置。一旦被重构掉，功能会静默消失且没有任何报错（用户只会觉得
 * 「装完什么都没说」），所以用最便宜的方式把它们钉住。
 */
const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p))
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel)
  return readFileSync(hit, "utf8")
}

describe("安装弹窗：跨包重复预览与耗时反馈", () => {
  const modal = overlaySource("src/components/plugins/plugin-install-modal.tsx")

  it("打开网址包时请求重复预览接口", () => {
    expect(modal).toContain("/overlap")
    expect(modal).toContain("overlapSlug")
  })

  it("预览失败静默降级：不能让 catch 吃掉安装能力", () => {
    expect(modal).toContain(".catch(() => {")
    expect(modal).toContain("overlapResult && overlapResult.slug === overlapSlug")
  })

  it("安装结果里把 sitesSkipped（跨包重复）说给用户听", () => {
    expect(modal).toContain("sitesSkipped")
    expect(modal).toContain("跳过")
  })

  it("安装过程中展示耗时，而不是一直只有「处理中…」", () => {
    expect(modal).toContain("elapsedMs")
    expect(modal).toContain("toFixed(1)")
  })

  it("计时器在 finally 中清理，避免关闭弹窗后继续 setState", () => {
    expect(modal).toContain("clearInterval(timerRef.current)")
  })
})
