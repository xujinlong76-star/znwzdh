/**
 * Batch 4 Phase 2 P2-5：第 4 步前端标注守卫测试。
 *
 * 环境：仓库 vitest 是 node 环境、无 jsdom / @testing-library——组件挂载
 * 测不了（见 compare-page-guard.test.ts 同款说明），三态标注的 UI 区分走
 * 源码守卫体例（注释剥掉后断言，防“注释里提到了、代码没做”）：
 *  - model_generated 格：徽标“模型生成”+“仅供参考”文案双通道（不只颜色）；
 *  - measured 格：“已核实”徽标，与模型生成格样式与文案都不同；
 *  - unverified 格：显式“未验证”，且不渲染原值；
 *  - 缺标注按模型生成处理，绝不默认 measured；
 *  - search-palette 把 matrix 透传给 TechComparisonCard（渲染块接线）；
 *  - core 镜像已同步：overlay lib/comparison.ts 含三态类型与纯函数。
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

const card = stripComments(overlaySource('src/components/tech-comparison-card.tsx'))
const palette = stripComments(overlaySource('src/components/search-palette.tsx'))
const mirror = overlaySource('src/lib/comparison.ts')

describe('三态徽标：模型生成格双通道区分', () => {
  it('model_generated 格有“模型生成”徽标与“仅供参考”文案（徽标样式 + 文案，不只颜色）', () => {
    expect(card).toContain('模型生成')
    expect(card).toContain('仅供参考')
    // 徽标有独立的琥珀样式（边框 + 底色 + 文字色），不是只改文字颜色
    expect(card).toContain('border-amber-400/40')
    expect(card).toContain('bg-amber-500/10')
    // “仅供参考”由 withNote 开关控制，随徽标一起出现，不是散落的静态文案
    expect(card).toContain('withNote')
    expect(card).toContain('<ProvenanceTag provenance={p} withNote />')
  })

  it('measured 格有“已核实”徽标，样式与模型生成格不同', () => {
    expect(card).toContain('已核实')
    expect(card).toContain('border-emerald-400/40')
    expect(card).toContain('bg-emerald-500/10')
  })

  it('unverified 格显式“未验证”，且不渲染原值', () => {
    expect(card).toContain('未验证')
    expect(card).toContain('border-dashed')
    // 未验证分支直接返回徽标，不走到值渲染
    expect(card).toContain("if (p === 'unverified' || !value.trim() || value === '未验证')")
  })

  it('缺标注按模型生成处理：绝不把来源不明的格子标成“已核实”', () => {
    expect(card).toContain("provenance ?? 'model_generated'")
    expect(card).not.toContain("?? 'measured'")
  })
})

describe('三态标注接线：逐字段 provenance 真进渲染', () => {
  it('维度格按 provenanceA / provenanceB 分别标注', () => {
    expect(card).toContain('provenanceA')
    expect(card).toContain('provenanceB')
    expect(card).toContain('<DimensionValue value={dim.valueA} provenance={dim.provenanceA}')
    expect(card).toContain('<DimensionValue value={dim.valueB} provenance={dim.provenanceB}')
  })

  it('结论与摘要字段也标注：verdict、license、category、primaryPros', () => {
    expect(card).toContain('matrix.verdictProvenance')
    expect(card).toContain('matrix.itemA.provenance?.license')
    expect(card).toContain('matrix.itemB.provenance?.license')
    expect(card).toContain('matrix.itemA.provenance?.category')
    expect(card).toContain('matrix.itemA.provenance?.primaryPros')
    expect(card).toContain('matrix.itemB.provenance?.primaryPros')
  })

  it('search-palette 把矩阵透传给 TechComparisonCard（渲染块接线未断）', () => {
    expect(palette).toContain("import('@/components/tech-comparison-card')")
    expect(palette).toContain('<TechComparisonCard matrix=')
  })
})

describe('core 镜像已同步：前端类型含三态标注', () => {
  it('overlay lib/comparison.ts 含三态类型与纯函数，且保持零 import', () => {
    expect(mirror).toContain('ComparisonProvenance')
    expect(mirror).toContain('verdictProvenance')
    expect(mirror).toContain('assignComparisonProvenance')
    expect(mirror).toContain('buildStructuredMatrix')
    expect(mirror).toContain('buildStructuredComparisonContext')
    // 镜像逐字复用 core：facets.ts 不在前端镜像里，comparison.ts 绝不能 import 它
    expect(mirror).not.toContain('./facets')
    expect(mirror).not.toContain('./types')
  })
})
