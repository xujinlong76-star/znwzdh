import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * 「相似插件」降级接线守卫。
 *
 * 服务端把「确实没有近邻」与「语义索引不可用/请求失败」都表达成空列表，区别只在
 * `degraded`。组件一旦再次丢弃这个标志，失败就会和真空态同形（整块无声消失），
 * 用户既不知道发生了什么也没有重试入口。这里用源码扫描钉住三条接线。
 */
const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p))
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel)
  return readFileSync(hit, "utf8")
}

describe("相似插件：失败 ≠ 空", () => {
  const src = overlaySource("src/components/plugins/plugin-similar.tsx")

  it("请求时传入 onDegraded，失败原因能落到 state", () => {
    expect(src).toContain("fetchSimilarPlugins(slug, 6, onDegraded)")
    expect(src).toContain("describeDegrade(error, '相似插件服务')")
  })

  it("区分服务端 degraded 与真空态", () => {
    expect(src).toContain("res.degraded")
    expect(src).toContain("if (state.items.length === 0) return null")
  })

  it("降级态渲染 role=alert 的区块错误与重试按钮", () => {
    expect(src).toContain('variant="error"')
    expect(src).toContain("onRetry=")
    expect(src).toContain('retryLabel="重新加载"')
  })

  it("重试会重新发起请求（effect 依赖 attempt）", () => {
    expect(src).toContain("setAttempt((n) => n + 1)")
    expect(src).toContain("[slug, attempt, key]")
  })

  it("不可重试的失败（鉴权类）不展示无效的重试按钮", () => {
    expect(src).toContain("state.notice.retryable ?")
  })
})
