/**
 * 插件市场种子数据质量门禁。
 *
 * 为什么要这条测试：
 *   seed.ts 对校验失败的清单是「静默跳过」（只打一行 console.warn），
 *   历史上出现过搜索引擎包因 icon 填了远程 URL（契约限 8 字符且禁含 ://）
 *   而整个包从未入库、组合包却仍引用它的情况 —— 市场看上去有内容，
 *   实际少包、且引用悬空。这里把「静默失败」变成显式红灯。
 *
 * 覆盖：
 *   1. 全部种子清单必须通过 core 契约校验（含字节上限）；
 *   2. slug 唯一、版本号 x.y.z、许可证为免费许可；
 *   3. 网址包已卸载（2026-11-15）：注册表不再含 site-pack；原来按包内站点
 *      人口算的两条棘轮（包×叶子覆盖面、类目索引门槛覆盖率）人口清零，只断言
 *      人口为 0 与门槛值仍为 5；原来逐包的规模 / 完整性 / 去重 / 落叶子用例
 *      随包退役，精选站的去重与完整性由 seed-content / seed-dedupe 测试守门；
 *   4. 搜索引擎包：每个引擎带 {q}、前缀合法唯一、icon 为短文本（非远程地址）；
 *   5. 主题：包含完整色板 token 与圆角，而非只改一两个变量；
 *   6. 工作台预设：组件类型必须存在于前端注册表，且 col/rowSpan 落在该组件的
 *      min/max 区间内（此处内联一份注册表单，前端改名时这里会红，提醒同步）；
 *   7. 组合包：成员 slug 必须在种子内存在、已上架、且 kind 与真实清单一致；
 *   8. 组合包描述与实际成员一致（2026-11-16 Q-1～Q-15）：描述不得再宣称
 *      2026-11-15 已卸载的 34 个网址包成员，描述里的成员数 / !前缀总数 /
 *      主题套数必须与 seed 实际成员实算一致；
 *   9. 搜索引擎收录 URL（2026-11-16 Q-16～Q-19）：已证实失效的旧检索 URL
 *      不得回流，全部收录 URL 为 https 且含 {q} 占位。
 */
import { describe, expect, it } from "vitest";
import {
  comparePluginVersions,
  normalizePluginUrlKey,
  PLUGIN_LIMITS,
  REGISTRY_BY_SLUG,
  resolveRegistryEntry,
  resolveRegistryLeaf,
  validateAndCleanPluginManifest,
  type PluginManifest,
  type BundlePayload,
  type SearchPackPayload,
  type SitePackPayload,
  type ThemePayload,
  type WorkspacePresetPayload,
} from "@navhub/core";
import { seedPluginDefs } from "../src/seed-plugins.ts";

/** 允许在种子数据里出现的免费许可证（用户要求：插件全部免费提供下载使用） */
const FREE_LICENSES = new Set(["MIT", "Apache-2.0", "GPL-3.0", "BSD-3-Clause"]);

// 网址包已卸载（2026-11-15）：PROFESSIONAL_SITE_PACK 随 34 个 site-packs 退役。
// 原来按包内站点人口算的棘轮（单个包 minCategories 18 / minSites 190 /
// minSitesPerCategory 6、全市场包×叶子覆盖对 minLeafCoveragePairs 300）
// 人口已不存在；卸载守卫见下面的「网址包已卸载」describe。
/** 商用级搜索引擎包的下限 */
const PROFESSIONAL_SEARCH_PACK = { minEngines: 36 }
/** 商用级主题的 token 下限（色板变量可用集合共 19 色 + 圆角 = 20 项，取满才算完整皮肤） */
const PROFESSIONAL_THEME = { minTokens: 20 }
/** 商用级工作台预设的下限（看板数 / 每看板模块数） */
const PROFESSIONAL_PRESET = { minBoards: 4, minWidgetsPerBoard: 5 }
/** 商用级组合包的成员数下限（一站式起步包；2026-11-15 卸载后组合包只剩 search-pack / theme 成员，最小包 3 个成员，棘轮定格 3） */
const PROFESSIONAL_BUNDLE = { minItems: 3 }

/**
 * 市场整体规模下限（2026-11-15 卸载后重定格）。
 *
 * 2026-11-13 用户决定缩回精选站：34 个网址包卸载后市场不再按「大型导航站」
 * 的宽度算。数值按当前实测略降留余量（实测：网址包 0 个 / 包内站点 0 /
 * 插件 42 / 搜索包 5 / 主题 14 / 预设 8 / 组合包 15），作为棘轮——
 * 只允许往上加，往下掉即红灯。
 */
const MARKET_SCALE = {
  minTotalPlugins: 40,
  minSearchPacks: 3,
  minThemes: 9,
  minPresets: 6,
  minBundles: 12,
}

/**
 * 前端 WIDGET_REGISTRY 的稳定快照（apps/web-overlay/src/lib/modular/registry.ts）。
 * 种子数据只能引用这里登记过的类型，跨度必须落在区间内。
 */
const WIDGET_REGISTRY: Record<string, { col: [number, number]; row: [number, number] }> = {
  "clock-pomodoro": { col: [3, 6], row: [1, 2] },
  "quick-tools": { col: [3, 6], row: [1, 2] },
  "trending-radar": { col: [4, 8], row: [1, 3] },
  "hyperbolic-radar": { col: [4, 8], row: [1, 3] },
  "speculative-terminal": { col: [3, 6], row: [1, 2] },
  "markdown-notes": { col: [3, 8], row: [1, 3] },
  "system-metrics": { col: [3, 6], row: [1, 2] },
  "favorites-dock": { col: [3, 6], row: [1, 2] },
  "custom-category": { col: [4, 12], row: [1, 3] },
  "quick-search": { col: [4, 12], row: [1, 2] },
  "github-heatmap": { col: [4, 12], row: [1, 3] },
  "weather-clock": { col: [3, 6], row: [1, 2] },
  "iframe-embed": { col: [4, 12], row: [1, 3] },
  "live-api": { col: [3, 8], row: [1, 2] },
  "rss-feed": { col: [4, 8], row: [1, 3] },
  "declarative-widget": { col: [3, 8], row: [1, 3] },
};

interface ValidatedSeed {
  slug: string
  status: string
  manifest: PluginManifest
  bytes: number
}

/** 跑一遍 core 校验，返回通过校验的种子清单（不通过的记录在 errors 里） */
function collectValidated(): { items: ValidatedSeed[]; errors: string[] } {
  const items: ValidatedSeed[] = []
  const errors: string[] = []
  for (const def of seedPluginDefs()) {
    const result = validateAndCleanPluginManifest(def.manifest)
    if (!result.ok) {
      errors.push(`${def.slug}: ${result.errors.join("; ")}`)
      continue
    }
    const bytes = Buffer.byteLength(JSON.stringify(def.manifest), "utf8")
    items.push({ slug: def.slug, status: def.status, manifest: result.manifest, bytes })
  }
  return { items, errors }
}

describe("插件市场种子数据：契约校验与元数据", () => {
  it("所有种子清单必须通过 core 契约校验（静默跳过 = 缺包事故）", () => {
    const { errors } = collectValidated()
    expect(errors, `以下种子插件校验失败、sedding 时会被静默跳过：\n${errors.join("\n")}`).toEqual([])
  })

  it("slug 唯一、版本号 x.y.z 递增、许可证为免费许可", () => {
    const { items } = collectValidated()
    const slugs = new Set<string>()
    for (const item of items) {
      expect(slugs.has(item.slug), `slug 重复：${item.slug}`).toBe(false)
      slugs.add(item.slug)
      expect(item.manifest.version, `${item.slug} 版本号格式非法`).toMatch(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/)
      expect(comparePluginVersions(item.manifest.version, "1.0.0"), `${item.slug} 版本不得低于 1.0.0`).toBeGreaterThanOrEqual(0)
      const license = item.manifest.license ?? ""
      expect(FREE_LICENSES.has(license), `${item.slug} 许可证「${license}」不在免费许可清单内`).toBe(true)
    }
  })

  it("清单体积留有余量（不超过契约上限）", () => {
    for (const item of collectValidated().items) {
      expect(item.bytes, `${item.slug} 清单超过 ${PLUGIN_LIMITS.maxManifestBytes} 字节上限`).toBeLessThanOrEqual(PLUGIN_LIMITS.maxManifestBytes)
    }
  })

  it("元信息完整：名称/描述/图标/作者/标签齐全，描述具有可读性", () => {
    for (const item of collectValidated().items) {
      expect(item.manifest.name.length, `${item.slug} 缺少有意义的名称`).toBeGreaterThan(1)
      expect(item.manifest.description.length, `${item.slug} 描述过短，无法体现插件价值`).toBeGreaterThanOrEqual(30)
      expect(item.manifest.icon, `${item.slug} 缺少图标`).toBeTruthy()
      expect(item.manifest.author, `${item.slug} 缺少作者`).toBeTruthy()
      expect(item.manifest.tags?.length ?? 0, `${item.slug} 缺少标签`).toBeGreaterThan(0)
    }
  })
})

describe("网址包已卸载：注册表不再含 site-pack（2026-11-15 uninstall-4839）", () => {
  const packs = () =>
    collectValidated().items.filter((i) => i.manifest.kind === "site-pack")

  // 2026-11-15：34 个 site-packs（apps/api/src/seed-data/site-packs/）随卸载删除，
  // allSeedPluginDefs 里不再有网址包。下面三条是卸载守卫：注册表必须保持“无网址包”，
  // 否则就是有人把包加回来了。原来按包内站点人口算的两条棘轮（包×叶子覆盖面、
  // 类目索引门槛覆盖率）人口已不存在，计算原样保留，只断言人口为 0 与门槛值仍为 5。
  // 原来逐包断言的规模 / 完整性 / 去重 / 落在权威树上的用例（分类与站点数量达标、
  // 描述与标签齐全、URL 归一后不重复、分类解析到叶子）随包退役——它们的人口没有了，
  // 空跑只会静默通过；精选站的去重与完整性由 seed-content / seed-dedupe 测试守门。
  it("注册表里没有 site-pack：34 个网址包已删干净", () => {
    expect(packs()).toHaveLength(0)
  })

  it("包×叶子覆盖面：人口随网址包清零", () => {
    // 原棘轮：29 个包声明的分类解析到不同叶子的（包，叶子）对数，下限 300。
    // 包删掉后对数自然为 0；计算留着——以后若有人加回包，这条立刻按旧口径算出新数。
    const pairs = new Set<string>()
    const perPack: string[] = []
    for (const item of packs()) {
      const payload = item.manifest.payload as SitePackPayload
      const leaves = new Set(
        (payload.categories ?? []).map((c) => resolveRegistryLeaf(c.title)?.slug).filter((s): s is string => Boolean(s)),
      )
      for (const slug of leaves) pairs.add(`${item.slug}:${slug}`)
      perPack.push(`${item.slug}:${leaves.size}/${(payload.categories ?? []).length}`)
    }
    expect(
      pairs.size,
      `不同「包×叶子」覆盖面只剩 ${pairs.size}，各包分布：${perPack.join(" ")}`,
    ).toBe(0)
    expect(perPack).toEqual([])
  })

  it("类目索引门槛的站点覆盖率：门槛仍为 5，包内站点人口为 0", () => {
    // 门槛值决定「哪些叶子有分类 hub」，写错不报错，只会让成片站点失去分类入口。
    // 这里的 5 必须与 apps/web-overlay/src/lib/seo/thresholds.ts 的
    // MIN_SITES_FOR_CATEGORY_INDEX 同口径（跨包无法直接 import，改一边就要改另一边）。
    const MIN_SITES_PER_LEAF = 5
    const perLeaf = new Map<string, number>()
    let total = 0
    for (const item of packs()) {
      for (const site of (item.manifest.payload as SitePackPayload).sites) {
        const slug = resolveRegistryLeaf(site.category)?.slug
        if (!slug) continue
        perLeaf.set(slug, (perLeaf.get(slug) ?? 0) + 1)
        total++
      }
    }
    // 包内站点人口已随卸载清零：覆盖率分母不存在，0.85 的棘轮不再适用；
    // 精选站的分类入口由 web 侧 category-hub / seo-invariants 按同一门槛 5 守门。
    expect(total).toBe(0)
    expect(perLeaf.size).toBe(0)
    expect(MIN_SITES_PER_LEAF).toBe(5)
  })
})

describe("搜索引擎包：前缀可用、图标合规、规模达标", () => {
  const packs = () => collectValidated().items.filter((i) => i.manifest.kind === "search-pack")

  it("引擎数量达到商用规模，且全部可直接检索", () => {
    for (const item of packs()) {
      const payload = item.manifest.payload as SearchPackPayload
      expect(payload.engines.length, `${item.slug} 引擎数量不足`).toBeGreaterThanOrEqual(PROFESSIONAL_SEARCH_PACK.minEngines)
      for (const engine of payload.engines) {
        expect(engine.searchUrl.includes("{q}"), `${item.slug} 引擎「${engine.name}」缺少 {q} 占位符`).toBe(true)
        expect(engine.prefix.startsWith("!"), `${item.slug} 引擎「${engine.name}」前缀必须以叹号开头`).toBe(true)
        expect(engine.description?.trim().length ?? 0, `${item.slug} 引擎「${engine.name}」缺少说明`).toBeGreaterThan(0)
        if (engine.icon !== undefined) {
          expect(engine.icon.includes("://"), `${item.slug} 引擎「${engine.name}」的 icon 不能是远程地址（契约限短文本）`).toBe(false)
          expect(engine.icon.length, `${item.slug} 引擎「${engine.name}」的 icon 超过 ${PLUGIN_LIMITS.maxIconChars} 字符`).toBeLessThanOrEqual(PLUGIN_LIMITS.maxIconChars)
        }
      }
    }
  })
})

describe("主题：提供成套色板变量而非零星点缀", () => {
  const themes = () => collectValidated().items.filter((i) => i.manifest.kind === "theme")

  it("主题 token 数量达到完整皮肤标准且带圆角设定", () => {
    for (const item of themes()) {
      const payload = item.manifest.payload as ThemePayload
      const tokens = payload.tokens ?? {}
      expect(Object.keys(tokens).length, `${item.slug} 主题 token 过少，不成皮肤`).toBeGreaterThanOrEqual(PROFESSIONAL_THEME.minTokens)
      expect(tokens["--radius"], `${item.slug} 主题未设定圆角`).toBeTruthy()
      expect(payload.accent ?? null, `${item.slug} 主题未指定 accent`).toBeTruthy()
    }
  })
})

describe("工作台预设：组件类型与跨度必须可在前端落地", () => {
  const presets = () => collectValidated().items.filter((i) => i.manifest.kind === "workspace-preset")

  it("组件类型均已登记，且 col/rowSpan 落在该组件的允许区间内", () => {
    for (const item of presets()) {
      const payload = item.manifest.payload as WorkspacePresetPayload
      expect(payload.boards.length, `${item.slug} 至少 ${PROFESSIONAL_PRESET.minBoards} 个看板才成「工作台」`).toBeGreaterThanOrEqual(PROFESSIONAL_PRESET.minBoards)
      for (const board of payload.boards) {
        expect(board.widgets.length, `${item.slug} 看板「${board.name}」模块数不足 ${PROFESSIONAL_PRESET.minWidgetsPerBoard}`).toBeGreaterThanOrEqual(PROFESSIONAL_PRESET.minWidgetsPerBoard)
        for (const widget of board.widgets) {
          const spec = WIDGET_REGISTRY[widget.type]
          expect(spec, `${item.slug} 引用了未登记的组件类型：${widget.type}`).toBeTruthy()
          if (!spec) continue
          expect(
            widget.colSpan >= spec.col[0] && widget.colSpan <= spec.col[1],
            `${item.slug} 组件 ${widget.type} 的 colSpan=${widget.colSpan} 越界（${spec.col[0]}..${spec.col[1]}）`,
          ).toBe(true)
          expect(
            widget.rowSpan >= spec.row[0] && widget.rowSpan <= spec.row[1],
            `${item.slug} 组件 ${widget.type} 的 rowSpan=${widget.rowSpan} 越界（${spec.row[0]}..${spec.row[1]}）`,
          ).toBe(true)
        }
      }
    }
  })
})

describe("组合包：成员必须真实存在、已上架、类型一致", () => {
  it("组合包声明的成员不得被校验器静默丢弃", () => {
    // 真实盲区：BundleItemKind 只允许 site-pack / search-pack / theme，
    // 误写 workspace-preset 时校验器只是 continue 丢弃该成员，清单依旧 ok，
    // 结果「声明 12 个、装完只有 11 个」。这里以声明数为硬口径，逼出静默丢项。
    const validated = new Map(collectValidated().items.map((i) => [i.slug, i]))
    for (const def of seedPluginDefs()) {
      const raw = def.manifest as { kind?: string; payload?: { items?: Array<{ slug: string; kind: string }> } }
      if (raw.kind !== "bundle") continue
      const declared = raw.payload?.items ?? []
      const stored = ((validated.get(def.slug)?.manifest.payload as BundlePayload | undefined)?.items ?? [])
      expect(
        stored.length,
        `${def.slug} 声明 ${declared.length} 个成员，校验后仅剩 ${stored.length} 个；成员类型只允许 site-pack / search-pack / theme`,
      ).toBe(declared.length)
    }
  })


  it("组合包不出现悬空引用（成员缺斤少两曾是真实事故）", () => {
    const { items } = collectValidated()
    const bySlug = new Map(items.map((i) => [i.slug, i]))
    for (const item of items.filter((i) => i.manifest.kind === "bundle")) {
      const payload = item.manifest.payload as BundlePayload
      expect(payload.items.length, `${item.slug} 组合包成员不足 ${PROFESSIONAL_BUNDLE.minItems} 个，不成「一站式起步包」`).toBeGreaterThanOrEqual(PROFESSIONAL_BUNDLE.minItems)
      for (const member of payload.items) {
        const target = bySlug.get(member.slug)
        expect(target, `${item.slug} 引用了不存在的成员插件：${member.slug}`).toBeTruthy()
        if (!target) continue
        expect(target.status, `${item.slug} 成员 ${member.slug} 尚未上架，组合包无法安装`).toBe("published")
        expect(target.manifest.kind, `${item.slug} 成员 ${member.slug} 的 kind 标注不一致`).toBe(member.kind)
      }
    }
  })
})

describe("市场规模：卸载后精选种子的宽度", () => {
  it("插件总数与各类型覆盖均达标，网址包与包内站点已清零", () => {
    const { items } = collectValidated()
    const byKind = (kind: string) => items.filter((i) => i.manifest.kind === kind)

    // 2026-11-15：34 个网址包卸载后注册表里不应再有 site-pack，包内站点总数为 0；
    // 下面两条是卸载守卫，不是规模下限。
    expect(byKind("site-pack").length, "网址包已于 2026-11-15 卸载，注册表不应再出现 site-pack").toBe(0)
    expect(items.length, "插件总数不足").toBeGreaterThanOrEqual(MARKET_SCALE.minTotalPlugins)
    expect(byKind("search-pack").length, "搜索引擎包数量不足").toBeGreaterThanOrEqual(MARKET_SCALE.minSearchPacks)
    expect(byKind("theme").length, "主题数量不足").toBeGreaterThanOrEqual(MARKET_SCALE.minThemes)
    expect(byKind("workspace-preset").length, "工作台预设数量不足").toBeGreaterThanOrEqual(MARKET_SCALE.minPresets)
    expect(byKind("bundle").length, "组合包数量不足").toBeGreaterThanOrEqual(MARKET_SCALE.minBundles)
  })

  it("搜索引擎包的 !前缀全局唯一（多个包可同时安装且不互相覆盖）", () => {
    const { items } = collectValidated()
    const seen = new Map<string, string>()
    for (const item of items.filter((i) => i.manifest.kind === "search-pack")) {
      const payload = item.manifest.payload as SearchPackPayload
      for (const engine of payload.engines ?? []) {
        const key = engine.prefix.toLowerCase()
        const owner = seen.get(key)
        expect(owner, `前缀 ${engine.prefix} 重复：${owner} 与 ${item.slug}`).toBeUndefined()
        seen.set(key, item.slug)
      }
    }
  })

  it("插件 slug 全局唯一（扩容目录与主文件之间也不得撞车）", () => {
    const { items } = collectValidated()
    const slugs = new Set<string>()
    for (const item of items) {
      expect(slugs.has(item.slug), `slug 重复：${item.slug}`).toBe(false)
      slugs.add(item.slug)
    }
    expect(slugs.size).toBe(items.length)
  })
})

describe("组合包描述与实际成员一致（2026-11-16 Q-1～Q-15）", () => {
  // 2026-11-15 卸载 34 个网址包后，15 个组合包的描述仍宣称已被卸载的
  // 网址包成员（“前端武器库”“设计师灵感导航”“AI 与大模型工具包”等），
  // 描述承诺数百站点、成员清单里却是 0 个站点。以下两条是描述守卫：
  // 描述只许写真实成员（搜索包 + 主题），数字全部按实际成员实算。
  // 注意：断言按新行为改写（2026-11-16 Q 线重写 15 条描述时立），
  // 旧描述里“约 400 个专业站点与 50 个 !前缀”等数字已证伪，不得恢复。
  const RETIRED_SITE_PACK_PHRASES = [
    "网址包",
    "站点",
    "前端武器库",
    "设计师灵感导航",
    "AI 与大模型工具包",
    "法律合规全场景包",
    "宠物与育儿",
    "医疗健康",
    "购物电商",
    "旅行出行",
    "政务民生",
    "金融理财",
    "影音娱乐",
    "游戏与电竞",
    "求职招聘",
    "软件效率工具包",
    "开发者效率精选",
    "自媒体运营增长包",
    "运营营销增长包",
    "后端与云原生",
    "学习与自我提升",
    "办公协作",
    "新闻资讯",
    "中文生活综合导航",
    "AI Agentic 编码包",
    "MCP 协议与工具库生态包",
    "开源大模型与本地推理包",
    "经典 AI 工具库",
    "130+",
    "120 个",
    "400 个",
  ]

  it("描述不再宣称已被卸载的网址包成员", () => {
    const { items } = collectValidated()
    for (const item of items.filter((i) => i.manifest.kind === "bundle")) {
      for (const phrase of RETIRED_SITE_PACK_PHRASES) {
        expect(
          item.manifest.description.includes(phrase),
          `${item.slug} 描述仍宣称已卸载的网址包成员「${phrase}」：${item.manifest.description}`,
        ).toBe(false)
      }
    }
  })

  it("描述里的成员数 / !前缀总数 / 主题套数与 seed 实际成员一致", () => {
    // 数字全部从 seed 实算：成员数 = payload.items 长度；
    // !前缀总数 = 成员搜索包的引擎数之和；主题套数 = 成员里 kind=theme 的个数。
    // 描述必须用「共 N 个成员」「M 个 !前缀」「T 套」三处写明实算数字。
    const { items } = collectValidated()
    const bySlug = new Map(items.map((i) => [i.slug, i]))
    for (const item of items.filter((i) => i.manifest.kind === "bundle")) {
      const payload = item.manifest.payload as BundlePayload
      const members = payload.items ?? []
      let totalPrefixes = 0
      let themeCount = 0
      for (const member of members) {
        const target = bySlug.get(member.slug)
        if (member.kind === "theme") themeCount++
        if (member.kind === "search-pack" && target) {
          totalPrefixes += ((target.manifest.payload as SearchPackPayload).engines ?? []).length
        }
      }
      const desc = item.manifest.description
      expect(desc.includes(`共 ${members.length} 个成员`), `${item.slug} 描述未写明实算成员数（应为 ${members.length} 个）：${desc}`).toBe(true)
      expect(desc.includes(`${totalPrefixes} 个 !前缀`), `${item.slug} 描述未写明实算 !前缀总数（应为 ${totalPrefixes} 个）：${desc}`).toBe(true)
      expect(desc.includes(`${themeCount} 套`), `${item.slug} 描述未写明实算主题套数（应为 ${themeCount} 套）：${desc}`).toBe(true)
    }
  })
})

describe("搜索引擎收录 URL：死链不得回流（2026-11-16 Q-16～Q-19）", () => {
  // 2026-11-16 逐个实测结论（curl + 目标站自身证据）：
  // - crates.io !crates：旧 URL https://crates.io/search?q={q} 经复核有效，不替换。
  //   站方 OpenSearch（https://crates.io/opensearch.xml，200）声明的模板就是
  //   https://crates.io/search?q={searchTerms}；curl 默认 Accept: */* 时站方回 404，
  //   浏览器 Accept: text/html 时回 200——审计的两次 404 是探测头伪影。
  // - Smithery !smithery：旧 https://smithery.ai/search?q={q} 两次 curl 404 且
  //   浏览器取回亦 404（/search 路由已随 2026-10-31 关停托管服务一并下线）；
  //   新路径 https://smithery.ai/servers?q={q}：curl -L 200，且站方自身 JS
  //   以 URLSearchParams 读 q 入参过滤目录、输入时写回 q，属真实检索深链。
  // - 美团 !meituan：旧 https://www.meituan.com/s/{q} 两次 curl 404 且重定向到
  //   /error/404；新路径 https://h5.waimai.meituan.com/waimai/mindex/search?keyword={q}：
  //   curl -L 200（55KB 美团外卖搜索页应用壳，与美团 98,799 字节 404 页不同）。
  //   keyword 参数未在静态壳里直接观测到（客户端渲染），属残留不确定性，见报告。
  // - 携程 !ctrip：旧 https://you.ctrip.com/searchsite/all?keyword={q} 未找到可用替代。
  //   /searchsite/all、/searchsite/、/search/ 三路经浏览器取回均为上游 404
  //   （取回器可正常打开 you.ctrip.com/ 与 www.ctrip.com/，故为路径级失效），
  //   站内首页亦无 searchsite 链接；curl 一律被 verify.ctrip.com 验证码墙拦截。
  //   按任务要求如实登记未达标、不编 URL，旧 URL 暂留、引擎不下掉。
  const RETIRED_SEARCH_URLS = [
    "https://smithery.ai/search?q={q}",
    "https://www.meituan.com/s/{q}",
  ]
  const REPLACEMENT_SEARCH_URLS = [
    "https://smithery.ai/servers?q={q}",
    "https://h5.waimai.meituan.com/waimai/mindex/search?keyword={q}",
  ]

  it("已证实失效的旧检索 URL 不再出现", () => {
    const { items } = collectValidated()
    for (const item of items.filter((i) => i.manifest.kind === "search-pack")) {
      const payload = item.manifest.payload as SearchPackPayload
      for (const engine of payload.engines ?? []) {
        for (const dead of RETIRED_SEARCH_URLS) {
          expect(engine.searchUrl, `${item.slug} 引擎「${engine.name}」仍用已失效的旧检索 URL：${dead}`).not.toBe(dead)
        }
      }
    }
  })

  it("替换后的新检索 URL 已收录（防回退）", () => {
    const { items } = collectValidated()
    const allUrls = new Set<string>()
    for (const item of items.filter((i) => i.manifest.kind === "search-pack")) {
      const payload = item.manifest.payload as SearchPackPayload
      for (const engine of payload.engines ?? []) allUrls.add(engine.searchUrl)
    }
    for (const url of REPLACEMENT_SEARCH_URLS) {
      expect(allUrls.has(url), `替换后的新检索 URL 未收录：${url}`).toBe(true)
    }
  })

  it("全部收录 URL 为 https 且含 {q} 占位", () => {
    const { items } = collectValidated()
    for (const item of items.filter((i) => i.manifest.kind === "search-pack")) {
      const payload = item.manifest.payload as SearchPackPayload
      for (const engine of payload.engines ?? []) {
        expect(engine.searchUrl.startsWith("https://"), `${item.slug} 引擎「${engine.name}」收录 URL 非 https：${engine.searchUrl}`).toBe(true)
        expect(engine.searchUrl.includes("{q}"), `${item.slug} 引擎「${engine.name}」收录 URL 缺少 {q} 占位：${engine.searchUrl}`).toBe(true)
      }
    }
  })
})
