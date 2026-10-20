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
 *   3. 网址包达到专业导航规模：分类与站点数量达标，站点必须带
 *      描述/合法分类（必须引用包内已声明分类）/标签，URL 归一后不重复；
 *   4. 搜索引擎包：每个引擎带 {q}、前缀合法唯一、icon 为短文本（非远程地址）；
 *   5. 主题：包含完整色板 token 与圆角，而非只改一两个变量；
 *   6. 工作台预设：组件类型必须存在于前端注册表，且 col/rowSpan 落在该组件的
 *      min/max 区间内（此处内联一份注册表单，前端改名时这里会红，提醒同步）；
 *   7. 组合包：成员 slug 必须在种子内存在、已上架、且 kind 与真实清单一致。
 */
import { describe, expect, it } from "vitest";
import {
  comparePluginVersions,
  normalizePluginUrlKey,
  PLUGIN_LIMITS,
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

/** 商用级网址包的内容下限（分类数 / 站点数 / 单个分类内最少站点数） */
const PROFESSIONAL_SITE_PACK = { minCategories: 18, minSites: 190, minSitesPerCategory: 6 }
/** 商用级搜索引擎包的下限 */
const PROFESSIONAL_SEARCH_PACK = { minEngines: 36 }
/** 商用级主题的 token 下限（色板变量可用集合共 19 色 + 圆角 = 20 项，取满才算完整皮肤） */
const PROFESSIONAL_THEME = { minTokens: 20 }
/** 商用级工作台预设的下限（看板数 / 每看板模块数） */
const PROFESSIONAL_PRESET = { minBoards: 4, minWidgetsPerBoard: 5 }
/** 商用级组合包的成员数下限（一站式起步包） */
const PROFESSIONAL_BUNDLE = { minItems: 8 }

/**
 * 市场整体规模下限（2026-10-20 内容升级批次后定档）。
 *
 * 用户口径是「像大型网址导航站那样」：单个包达标还不够，市场本身要有足够宽度。
 * 数值按当前实测略降留余量（实测：网址包 20 个 / 站点 4057 / 插件 52 /
 * 主题 10 / 预设 7 / 组合包 12），作为棘轮——只允许往上加，往下掉即红灯。
 */
const MARKET_SCALE = {
  minSitePacks: 20,
  minTotalPlugins: 50,
  minTotalSites: 3900,
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

describe("网址包：达到专业导航站点的内容规模与完整度", () => {
  const packs = () => collectValidated().items.filter((i) => i.manifest.kind === "site-pack")

  it("每个网址包的分类与站点数量达标，且没有「空壳分类」", () => {
    for (const item of packs()) {
      const payload = item.manifest.payload as SitePackPayload
      const categories = payload.categories ?? []
      expect(categories.length, `${item.slug} 分类数不足专业导航标准`).toBeGreaterThanOrEqual(PROFESSIONAL_SITE_PACK.minCategories)
      expect(payload.sites.length, `${item.slug} 站点数不足专业导航标准`).toBeGreaterThanOrEqual(PROFESSIONAL_SITE_PACK.minSites)

      // 分类不能只是「声明了却没内容」：每个分类都要有足够站点撑起来
      const perCategory = new Map<string, number>()
      for (const site of payload.sites) perCategory.set(site.category ?? "", (perCategory.get(site.category ?? "") ?? 0) + 1)
      for (const category of categories) {
        const count = perCategory.get(category.title) ?? 0
        expect(
          count,
          `${item.slug} 分类「${category.title}」只有 ${count} 个站点，低于 ${PROFESSIONAL_SITE_PACK.minSitesPerCategory} 个`,
        ).toBeGreaterThanOrEqual(PROFESSIONAL_SITE_PACK.minSitesPerCategory)
      }
    }
  })

  it("站点数据完整：必有描述、标签，分类必须引用包内已声明的分类", () => {
    for (const item of packs()) {
      const payload = item.manifest.payload as SitePackPayload
      const declared = new Set((payload.categories ?? []).map((c) => c.title))
      for (const site of payload.sites) {
        expect(site.description?.trim().length ?? 0, `${item.slug} 站点「${site.title}」缺少描述`).toBeGreaterThan(0)
        expect(site.tags?.length ?? 0, `${item.slug} 站点「${site.title}」缺少标签`).toBeGreaterThan(0)
        expect(site.category, `${item.slug} 站点「${site.title}」缺少分类`).toBeTruthy()
        expect(declared.has(site.category ?? ""), `${item.slug} 站点「${site.title}」引用了未声明的分类：${site.category}`).toBe(true)
      }
    }
  })

  it("站点 URL 归一后无重复（契约已去重，此处防止包内多Host重复录入）", () => {
    for (const item of packs()) {
      const payload = item.manifest.payload as SitePackPayload
      const seen = new Set<string>()
      for (const site of payload.sites) {
        const key = normalizePluginUrlKey(site.url)
        expect(seen.has(key), `${item.slug} 站点 URL 重复：${site.url}`).toBe(false)
        seen.add(key)
      }
    }
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

describe("市场规模：像大型导航站那样有足够宽度", () => {
  it("网址包数量、插件总数、站点总数与各类型覆盖均达标", () => {
    const { items } = collectValidated()
    const byKind = (kind: string) => items.filter((i) => i.manifest.kind === kind)
    const totalSites = byKind("site-pack").reduce(
      (sum, i) => sum + (i.manifest.payload as SitePackPayload).sites.length,
      0,
    )

    expect(byKind("site-pack").length, "网址包数量不足，市场宽度不够").toBeGreaterThanOrEqual(MARKET_SCALE.minSitePacks)
    expect(items.length, "插件总数不足").toBeGreaterThanOrEqual(MARKET_SCALE.minTotalPlugins)
    expect(totalSites, "全部网址包的站点总数不足大型导航站规模").toBeGreaterThanOrEqual(MARKET_SCALE.minTotalSites)
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
