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

describe("插件卡片与市场弹窗：已安装插件的卸载/管理联动", () => {
  const card = overlaySource("src/components/plugins/plugin-card.tsx")
  // Batch E 后市场首页是「服务端壳 + PluginMarketBoard 岛」，弹窗消费逻辑在岛里
  const page = overlaySource("src/components/plugin-market-board.tsx")
  const modal = overlaySource("src/components/plugins/plugin-install-modal.tsx")

  it("卡片按安装状态分流 targetMode，已安装时为 uninstall 而非继续 install", () => {
    expect(card).toContain("targetMode")
    expect(card).toContain("'uninstall'")
    expect(card).toContain("'install'")
    expect(card).toContain("onOpenInstallModal(plugin, targetMode)")
  })

  it("卡片已安装按钮悬停时展示管理/卸载文案与危险样式", () => {
    expect(card).toContain("管理 / 卸载")
    expect(card).toContain("group-hover/btn")
    expect(card).toContain("hover:text-destructive")
  })

  it("市场首页弹窗消费卡片传递的 installMode，支持卸载与升级模式", () => {
    expect(page).toContain("const [installMode, setInstallMode] = useState")
    expect(page).toContain("mode={installMode}")
    expect(page).toContain("handleOpenInstallModal")
  })


  it("卸载弹窗默认勾选清理站点与分类，并向用户反馈分类同步删除结果", () => {
    expect(modal).toContain("useState(true)")
    expect(modal).toContain("同时清理该插件带来的站点与分类")
    expect(modal).toContain("categoriesRemoved")
  })
  it("卸载弹窗提供直达已安装管家的快捷入口", () => {
    expect(modal).toContain("/marketplace/installed")
    expect(modal).toContain("前往已安装管家")
  })
})

describe("插件详情：分享深链只对未安装用户自动弹窗", () => {
  const view = overlaySource("src/app/marketplace/[slug]/plugin-detail-view.tsx")

  it("等客户端带身份刷新完成后再决定是否弹窗（SSR 首屏没有 installed）", () => {
    expect(view).toContain("detailSynced")
    expect(view).toContain("if (!detailSynced || loading || !plugin")
    expect(view).toContain("setDetailSynced(true)")
  })
})

describe("安装确认里的预设规模：不能把 4 个看板说成 1 个", () => {
  const modal = overlaySource("src/components/plugins/plugin-install-modal.tsx")
  const detail = overlaySource("src/app/marketplace/[slug]/plugin-detail-view.tsx")

  it("摘要缺失（详情接口把 summary 放在响应外层）时按清单 boards 计数", () => {
    expect(modal).toContain("plugin.manifest?.payload?.boards")
    expect(modal).toContain("presetBoardCount")
    expect(modal).toContain("presetWidgetCount")
    // 旧的 ?? 1 会把任意预设都压成「1 个看板 / 0 个模块」
    expect(modal).not.toContain("summary?.boardCount ?? 1")
  })

  it("详情页的「看板数量」指标同样按 payload 兜底", () => {
    expect(detail).not.toContain("plugin.kind === 'workspace-preset' ? 1 : 0")
    expect(detail).toContain("Array.isArray(payload?.boards) ? payload.boards.length : 0")
  })
})

describe("卸载回执不谎报清理范围", () => {
  const modal = overlaySource("src/components/plugins/plugin-install-modal.tsx")

  it("0 个站点时不再说「已清理关联站点」", () => {
    expect(modal).toContain("没有需要移除的关联站点")
    expect(modal).toContain("removedSites > 0")
    expect(modal).not.toContain("`已清理关联站点${res.sitesRemoved")
  })
})
