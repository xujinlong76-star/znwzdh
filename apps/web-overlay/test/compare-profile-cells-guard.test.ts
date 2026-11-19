/**
 * 对照表档案四格视图守卫测试（Batch0-02 R10 视图层 F8）。
 *
 * 环境：仓库 vitest 是 node 环境、无 jsdom / @testing-library——组件挂载
 * 测不了（见 compare-page-guard.test.ts 同款说明），视图接线走源码守卫体例；
 * 四格的值透传与差异判定行为见 compare-logic.test.ts 的归一化用例，
 * 真实渲染逐字核对见浏览器复核（F8 探针）。
 *
 * 守卫内容：
 *   - 四格在价格行之后、平台行之前渲染，按 §8.3 分组（适用 / 数据 / 替代）；
 *   - 只有 verified:true 的格出值，verified:false（含 draft 行）灰显“未验证”；
 *   - alternatives 出站名列表、每站名点进目标站（标题按 id 懒取，取不到显示 id）；
 *   - 全表无 winner 相关渲染；四格不进分流结论依据与分享字段选择。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 定位并读取 overlay 里的文件；镜像副本（apps/web/test）不会被误当成源 */
function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return readFileSync(hit, 'utf8')
}

/** 去掉块注释与行注释：守卫断言的是「代码真的用了」，不是「注释里提到了」 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
}

const view = overlaySource('src/components/compare-view.tsx')
const compareLib = overlaySource('src/lib/compare.ts')
const viewCode = stripComments(view)
const libCode = stripComments(compareLib)

describe('档案四格定义（lib/compare.ts）', () => {
  it('PROFILE_DIMENSIONS 四格：best_for / not_for / license / alternatives，标签与 §8.3 分组一致', () => {
    expect(libCode).toContain("key: 'best_for'")
    expect(libCode).toContain("key: 'not_for'")
    expect(libCode).toContain("key: 'license'")
    expect(libCode).toContain("key: 'alternatives'")
    expect(libCode).toContain("label: '适用场景'")
    expect(libCode).toContain("label: '不适用场景'")
    expect(libCode).toContain("label: '开源协议'")
    expect(libCode).toContain("label: '可替代站点'")
    expect(libCode).toContain("group: '适用'")
    expect(libCode).toContain("group: '数据'")
    expect(libCode).toContain("group: '替代'")
  })

  it('四格不进 COMPARE_DIMENSIONS（分流结论依据与分享字段仍只取七维）', () => {
    const dimsBlock = libCode.slice(libCode.indexOf('COMPARE_DIMENSIONS = ['), libCode.indexOf('] as const', libCode.indexOf('COMPARE_DIMENSIONS = [')))
    expect(dimsBlock).not.toContain('best_for')
    expect(dimsBlock).not.toContain('not_for')
    expect(dimsBlock).not.toContain('license')
    expect(dimsBlock).not.toContain('alternatives')
  })

  it('ComparisonItem 含四格，normalizeComparisonItem 透传四格（含 verified / verifiedAt / source）', () => {
    expect(libCode).toContain('best_for: ComparisonCell')
    expect(libCode).toContain('not_for: ComparisonCell')
    expect(libCode).toContain('license: ComparisonCell')
    expect(libCode).toContain('alternatives: ComparisonCell')
    expect(libCode).toContain("best_for: cell('best_for')")
    expect(libCode).toContain("not_for: cell('not_for')")
    expect(libCode).toContain("license: cell('license')")
    expect(libCode).toContain("alternatives: cell('alternatives')")
  })
})

describe('档案四格渲染位置（compare-view.tsx）', () => {
  it('四格在价格行之后渲染（dim.key === price 后接 PROFILE_DIMENSIONS）', () => {
    expect(viewCode).toContain('PROFILE_DIMENSIONS')
    expect(viewCode).toContain("dim.key === 'price'")
    const priceIdx = viewCode.indexOf("dim.key === 'price'")
    const profileIdx = viewCode.indexOf('PROFILE_DIMENSIONS.map', priceIdx)
    expect(profileIdx).toBeGreaterThan(priceIdx)
  })

  it('四格行有差异高亮（compareRowDiffers）与 §8.3 分组标题', () => {
    expect(viewCode).toContain('compareRowDiffers(items, pdim.key)')
    expect(viewCode).toContain('pdim.group')
  })

  it('四格不进分流结论依据（basisKeys 仍只取 COMPARE_DIMENSIONS）', () => {
    expect(viewCode).not.toContain('PROFILE_DIMENSIONS.map((dim)')
    expect(viewCode).toContain('COMPARE_DIMENSIONS.map((dim) => (')
  })
})

describe('档案四格渲染规则（compare-view.tsx）', () => {
  it('只有 verified:true 的格出值：ProfileCellValue 以 verified 为门', () => {
    expect(viewCode).toContain('ProfileCellValue')
    expect(viewCode).toContain('cell.verified === true')
  })

  it('verified:false 的格灰显“未验证”（opacity-60），不编造值、不画占位文案', () => {
    const cellStart = viewCode.indexOf('function ProfileCellValue')
    expect(cellStart).toBeGreaterThan(-1)
    const cellBody = viewCode.slice(cellStart, cellStart + 3000)
    expect(cellBody).toContain('opacity-60')
    expect(cellBody).toContain('未验证')
    expect(cellBody).not.toContain('暂无')
    expect(cellBody).not.toContain('敬请期待')
  })

  it('alternatives 出站名列表：站名按 id 向 GET /api/sites/:id 懒取，每站名点进 /site/<id>', () => {
    expect(viewCode).toContain('alternativeSiteIds(cell)')
    expect(viewCode).toContain("hubUrl('/api/sites/' + encodeURIComponent(id))")
    expect(viewCode).toContain('href={`/site/${encodeURIComponent(id)}`}')
    // 取不到标题回落显示站内 id，不编造站名
    expect(viewCode).toContain('alternativeTitles[id] ?? id')
  })

  it('全表无 winner 相关渲染', () => {
    expect(viewCode).not.toContain('winner')
    expect(libCode).not.toContain('winner')
  })
})
