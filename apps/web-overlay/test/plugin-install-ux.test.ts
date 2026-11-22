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
/** 详情页家族联合源（A3.1 拆分后守卫锁整个特性，不单壳文件） */
function detailFamily(): string {
  const parts = [overlaySource('src/app/marketplace/[slug]/plugin-detail-view.tsx')]
  for (const extra of ['detail-tab-panels.tsx', 'detail-modals.tsx']) {
    try { parts.push(overlaySource(`src/app/marketplace/[slug]/${extra}`)) } catch { /* 拆分前不存在则忽略 */ }
  }
  return parts.join(String.fromCharCode(10))
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
    expect(card).toContain("hover:text-destructive-text")
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
  const view = detailFamily()

  it("等客户端带身份刷新完成后再决定是否弹窗（SSR 首屏没有 installed）", () => {
    expect(view).toContain("detailSynced")
    expect(view).toContain("if (!detailSynced || loading || !plugin")
    expect(view).toContain("setDetailSynced(true)")
  })
})

describe("安装确认里的预设规模：不能把 4 个看板说成 1 个", () => {
  const modal = overlaySource("src/components/plugins/plugin-install-modal.tsx")
  const detail = detailFamily()

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

describe("安装确认里的主题变量数：不能把 21 项说成 0 项", () => {
  const modal = overlaySource("src/components/plugins/plugin-install-modal.tsx")
  const detail = detailFamily()

  it("摘要缺失（详情接口把 summary 放在响应外层）时按清单 tokens 计数", () => {
    expect(modal).toContain("plugin.manifest?.payload?.tokens")
    expect(modal).toContain("themeTokenCount")
    // 旧的 ?? 0 会把任意主题都说成「将应用 0 项 CSS 颜色变量」
    expect(modal).not.toContain("summary?.themeTokenCount ?? 0")
  })

  it("详情页的「色彩变量」指标同样按 payload 兜底", () => {
    expect(detail).toContain("Object.keys(payload?.tokens || {}).length")
  })
})

describe("安装确认里的网址包站点数：不能把 2 个站点说成 0 个", () => {
  const modal = overlaySource("src/components/plugins/plugin-install-modal.tsx")

  it("摘要缺失（详情接口把 summary 放在响应外层）时按清单 sites/categories 计数", () => {
    expect(modal).toContain("sitePackSiteCount")
    expect(modal).toContain("sitePackCategoryCount")
    // 兜底与服务端 summarizePluginManifest 同口径：站点数 = sites 长度，
    // 分类数 = categories 长度（未声明分类数组时为 0，与服务端摘要一致）
    expect(modal).toContain("plugin.manifest?.payload?.sites")
    expect(modal).toContain("plugin.manifest?.payload?.categories")
    // 旧的 ?? 0 会把任意网址包都说成「新增约 0 个」，与下方 overlap 预览
    // 「2 个站点全部新增」自相矛盾（U-404：详情页弹窗拿不到 summary）
    expect(modal).not.toContain("summary?.siteCount ?? 0")
    expect(modal).not.toContain("summary?.categoryCount ?? 0")
  })

  it("顶部计数用兜底后的变量渲染，而不是直接读 summary", () => {
    expect(modal).toContain("{sitePackSiteCount}")
    expect(modal).toContain("{sitePackCategoryCount}")
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

describe("插件卡片：父级刷新后本地安装态必须跟 prop 走", () => {
  const card = overlaySource("src/components/plugins/plugin-card.tsx")
  const board = overlaySource("src/components/plugin-market-board.tsx")
  const api = overlaySource("src/lib/navhub-api.ts")

  it("弹窗安装成功后父级重取列表，卡片 installed/starred 随 prop 同步（否则按钮一直停在「安装」）", () => {
    // 弹窗成功回调是列表重取：board 把 onSuccess 接到 reload 上
    expect(board).toContain("onSuccess={reload}")
    // 卡片必须有从 prop 同步本地态的 effect，不能只靠 useState 初值
    expect(card).toContain("useEffect")
    expect(card).toContain("setInstalled(Boolean(plugin.installed))")
    expect(card).toContain("setStarred(Boolean(plugin.starred))")
    expect(card).toContain("setStarCount(plugin.starCount || 0)")
  })

  it("同步 effect 只监听 prop 变化，不干扰卡片自身的乐观更新", () => {
    expect(card).toContain("[plugin.installed]")
    // R7 按新行为改写（93632c7f）：星标同步 effect 依赖现为
    // [plugin.starred, plugin.starCount, starLoading]——多出的 starLoading
    // 不是 prop 而是在途切换守卫：切换进行时 effect 直接 return，不把切换前
    // 发出的旧 prop 写回、翻掉刚切换的乐观状态；切换结束（starLoading 翻
    // false）时 effect 重跑，再按最新 prop 同步。断言意图不变：依赖里除守
    // 卫外仍只有 prop，且 effect 体内必须有 starLoading 守卫。
    expect(card).toContain("[plugin.starred, plugin.starCount, starLoading]")
    expect(card).toContain("if (starLoading) return")
  })

  it("列表请求必须带匿名身份头，否则服务端标不出 installed、重取也拿不到已装态", () => {
    // fetchPlugins 与 fetchInstalledPlugins / fetchPluginDetail 同口径
    expect(api).toContain("anonHeaders(effectiveIdentity)")
    const fetchPluginsBlock = api.slice(api.indexOf("export async function fetchPlugins"))
    expect(fetchPluginsBlock).toContain("anonHeaders(effectiveIdentity)")
    expect(fetchPluginsBlock).toContain("getIdentity()")
  })

  it("SSR 首帧没有身份：挂载后静默重取一次补已装/星标态，不闪骨架、不抹首帧", () => {
    // 挂载仍取数（不是跳过），但走静默分支
    expect(board).toContain("void load(0, false, true)")
    expect(board).toContain("async (offset: number, append: boolean, silent = false)")
    // 静默失败不覆盖 SSR 数据、不亮失败提示
    // 接线变更（P1-2 重构进 helper，行为未变、断言跟随接线）：内联守卫
    // `!(silent && failed)` 已从 board 消失，board 改走
    // applyMarketplaceListLoad，静默失败时 helper 原样返回旧快照（同一引
    // 用），SSR 首帧列表与总数都不被清空、不闪空态。
    // 2026-11-20 d52a36ec（#418 修复）：静默同步改合并式，board 调用多传
    // silentMerge: mergeSilentSync，断言跟随接线更新。
    expect(board).toContain("applyMarketplaceListLoad(prev, res, { failed, append, silent, silentMerge: mergeSilentSync })")
    const helper = overlaySource("src/lib/plugins/marketplace-load-state.ts")
    expect(helper).toContain("if (opts.append || opts.silent) return prev")
    expect(board).toContain("if (!silent) setNotice(describeDegrade(error, '插件市场'))")
    // 精选区同样挂载同步，且等地址栏解析完再取
    expect(board).toContain("if (!filtersReady || hasFilter) return")
    expect(board).not.toContain("skipFirstSide")
  })
})
