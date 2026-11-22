/**
 * /brief#hotlist 诚实空态第一步（W4 设计，进化轮 2026-11-23 02:22，W2 测试）：
 * 5 条验收标准（W4 §4）的页面渲染层断言。
 *
 * 仓库 vitest 是 node 环境、无 jsdom：页面级断言用源码守卫（与
 * empty-states.test.ts / brief-page.test.ts 同款做法）——读 apps/web/src
 *（overlay 的生成镜像）里的 page.tsx 等源码，断言接线与文案；
 * 纯函数部分（判定、相对时间）真测。文案层断言见
 * empty-states.test.ts 的 W4 describe。
 *
 * 搜索集 S = page.tsx + src/app/brief/*.tsx + src/lib/empty-states.ts：
 * W1 可能把源状态列表 / 上次成功行 / 过期横幅写进 page.tsx，也可能抽
 * 成 brief 下的小组件；文案字符串落在哪一个文件不重要，重要的是
 * /brief 的渲染闭包里有它、且由 hotlist.sources / hotlist.generatedAt
 * 驱动。相对时间口径复用 formatFreshness / STALE_ESCALATION_MS。
 *
 * 当前状态（W2 落笔时，W1 并行实现中）：验收 1（源状态列表 + 上次
 * 成功行）与验收 4（全 stale 横幅）的实现尚未落盘，对应守卫预期红；
 * 验收 2/3/5 的接线已在基线里，对应守卫应绿。实现到位后全绿才算完成。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { hotlistEmptyVariant } from '../src/lib/empty-states'
import { STALE_ESCALATION_MS, formatFreshness } from '../src/lib/relative-time'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

const page = read('src/app/brief/page.tsx')
// /brief 渲染闭包：页 + brief 下全部件 + 空态文案模块（W1 落点可能在其中任一处）
const briefComponentFiles = readdirSync(join(here, '..', 'src/app/brief')).filter((f) =>
  f.endsWith('.tsx'),
)
const scope = [
  page,
  read('src/lib/empty-states.ts'),
  ...briefComponentFiles.map((f) => read(`src/app/brief/${f}`)),
].join('\n')

/** 全空态分支：从 `hotlistCopy ? (` 起到 else 分支 `) : (` 为止的源码片。 */
function emptyBranch(): string {
  const start = page.indexOf('hotlistCopy ? (')
  expect(start).toBeGreaterThan(-1)
  const end = page.indexOf(') : (', start)
  expect(end).toBeGreaterThan(start)
  return page.slice(start, end)
}

describe('验收 1：全空态——六源状态列表 + 上次成功行（W1 实现项 1/2）', () => {
  it('空态分支渲染六源状态列表，数据源是现有 hotlist.sources[]（不新增取数）', () => {
    const branch = emptyBranch()
    expect(branch).toContain('hotlist.sources')
    // 每源一行：名称 + 状态词，空源的状态词是「暂无数据」（W4 §4 验收 1：
    // 六行均为「暂无数据」）。字符串落在页或 brief 组件或文案模块均可，
    // 但不能只在 relative-time.ts 的副行函数里（那是单源副行，不是列表）。
    expect(scope).toContain('暂无数据')
  })

  it('空态分支有「上次成功抓取」行：generatedAt 有值显示相对时间，无值明说「从未成功抓取过」', () => {
    const branch = emptyBranch()
    expect(branch).toContain('hotlist.generatedAt')
    expect(scope).toContain('上次成功抓取')
    expect(scope).toContain('从未成功抓取过')
    // 无值时不得留空、不得写「—」、不得拿当前时间冒充上次成功时间：
    // 空值分支必须有明说的文案（上一行已钉），且 formatFreshness(null)
    // 本身返回 null、不编造时间（口径见 relative-time.test.ts）。
    expect(formatFreshness(null)).toBeNull()
  })

  it('全空态不渲染榜单条目：空态分支里没有源列与榜单网格', () => {
    const branch = emptyBranch()
    expect(branch).not.toContain('SourceColumn')
    expect(branch).not.toContain('grid gap-4')
  })
})

describe('验收 4：全 stale 页级过期横幅（W1 实现项 3）', () => {
  it('横幅文案写明最后/最近一次成功抓取的相对时间，不谎称实时', () => {
    // W4 §2C 原文「最近一次成功抓取是 X」，§4 验收写「最后一次成功抓取」，
    // 两种说法都接受；关键是相对时间必须出现（由 generatedAt 算出）。
    expect(scope).toMatch(/最(近|后)一次成功抓取/)
    expect(scope).not.toMatch(/实时热榜|最新热榜/)
  })

  it('横幅只在全 stale 时出现：页里有「全部源 status === stale」的判定', () => {
    expect(page).toContain("'stale'")
    expect(page).toContain('every')
  })

  it('横幅触发复用 STALE_ESCALATION_MS（2h），不另立阈值', () => {
    expect(STALE_ESCALATION_MS).toBe(2 * 60 * 60_000)
    expect(page).toContain('STALE_ESCALATION_MS')
  })

  it('横幅相对时间与副行同一口径：generatedAt 用 formatFreshness 算', () => {
    const now = Date.UTC(2026, 10, 15, 12, 0, 0)
    expect(formatFreshness(now - 3 * 60 * 60_000, now)).toBe('3 小时前')
    expect(formatFreshness(now - 30 * 60_000, now)).toBe('30 分钟前')
  })

  it('各列副行仍在：SourceColumn 继续用 formatHotlistSubline 渲染各自缓存时间', () => {
    expect(page).toContain('formatHotlistSubline(source.status, source.fetchedAt)')
  })
})

describe('验收 2：fetch-failed 标题与主行动（页面接线）', () => {
  it('全空态标题与主行动取自 hotlistAllEmptyCopy(hotlistVariant)，不是页里手写散文案', () => {
    expect(page).toContain('hotlistAllEmptyCopy(hotlistVariant)')
    const branch = emptyBranch()
    expect(branch).toContain('hotlistCopy.title')
    expect(branch).toContain('hotlistCopy.actionHref')
    expect(branch).toContain('hotlistCopy.actionLabel')
  })

  it('判定分流已定：全 empty 是 never-fetched、有源失败过是 fetch-failed（文案层见 empty-states.test.ts）', () => {
    expect(
      hotlistEmptyVariant({
        sources: [
          { status: 'empty', items: [] },
          { status: 'empty', items: [] },
        ],
      }),
    ).toBe('never-fetched')
    expect(
      hotlistEmptyVariant({
        sources: [
          { status: 'empty', items: [] },
          { status: 'stale', items: [] },
        ],
      }),
    ).toBe('fetch-failed')
  })
})

describe('验收 3：部分源空——有数源出榜、空源列 why + 外链、不出现全榜空态', () => {
  it('有数源时走榜单网格而不是全榜空态：hotlistCopy 为 null 时渲染 sources.map', () => {
    expect(page).toContain('hotlistCopy ? (')
    const gridStart = page.indexOf('hotlist.sources.map')
    expect(gridStart).toBeGreaterThan(page.indexOf('hotlistCopy ? ('))
  })

  it('空源列显示 why +「去{源名}看实时热搜」外链（接线见 SourceColumn 空分支）', () => {
    expect(page).toContain('hotlistSourceEmptyCopy(source).why')
    expect(page).toContain('hotlistSourceEmptyCopy(source).actionLabel')
    expect(page).toContain('safeHref(source.homeUrl)')
  })
})

describe('验收 5：中枢不可达 → 降级壳，不渲染任何空态（失败 ≠ 空，回归不破）', () => {
  it('loadHotlist() 返回 null 时走「每日简报暂时不可用」降级壳', () => {
    expect(page).toContain('!brief && !hotlist')
    expect(page).toContain('每日简报暂时不可用')
    expect(hotlistEmptyVariant(null)).toBeNull()
  })

  it('全空态分支嵌在 hotlist 非空区内：中枢不可达时够不着它', () => {
    expect(page.indexOf('{hotlist ? (')).toBeGreaterThan(-1)
    expect(page.indexOf('{hotlist ? (')).toBeLessThan(page.indexOf('hotlistCopy ? ('))
  })

  it('降级壳里不出现六源状态列表与过期横幅的文案', () => {
    const shellStart = page.indexOf('!brief && !hotlist')
    const shellEnd = page.indexOf(') : (', shellStart)
    expect(shellStart).toBeGreaterThan(-1)
    expect(shellEnd).toBeGreaterThan(shellStart)
    const shell = page.slice(shellStart, shellEnd)
    expect(shell).not.toContain('从未成功抓取过')
    expect(shell).not.toContain('暂无数据')
    expect(shell).not.toMatch(/最(近|后)一次成功抓取/)
  })
})
