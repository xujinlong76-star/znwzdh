/**
 * 对照表分享接线守卫测试（Batch 4 Phase 2 P2-4）。
 *
 * 环境：仓库 vitest 是 node 环境、无 jsdom——组件挂载测不了（见
 * compare-page-guard.test.ts 同款说明），接线与渲染纪律走源码守卫体例：
 *   - 分享弹窗默认全不选（selectedFields 从 [] 开始），未勾选发布按钮
 *     disabled（disabled={... selectedFields.length === 0}）；
 *   - 发布成功显示 /pub/compare/<slug> 链接 + 复制按钮 + “下线”按钮，
 *     下线后链接区消失；
 *   - 公开页是只读冻结页：直调 GET /api/compare/shares/:slug，只渲染
 *     share.fields 里的白名单字段，页头注明冻结日期与“内容不再更新”，
 *     不挂“刷新验证”与“填写价格”按钮；404 走 not-found；
 *   - 分享取数走 lib/compare-share.ts（发布 POST / 下线 PATCH / 删除
 *     DELETE），快照面板本身仍无改写快照的入口（见
 *     compare-snapshots-guard.test.ts 的锁——PATCH/DELETE 只在分享
 *     helper 里，不在面板里）。
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

const panel = overlaySource('src/components/snapshot-panel.tsx')
const shareLib = overlaySource('src/lib/compare-share.ts')
const publicPage = overlaySource('src/app/pub/compare/[slug]/page.tsx')

describe('分享弹窗：默认全不选，未勾选不发布', () => {
  it('白名单 5 个字段：pricing / price / platform / form / maintenance，没有 note / migration', () => {
    const code = stripComments(shareLib)
    expect(code).toContain("'pricing', 'price', 'platform', 'form', 'maintenance'")
    expect(code).not.toContain("'note'")
    expect(code).not.toContain("'migration'")
  })

  it('分享弹窗默认全不选：selectedFields 从空数组开始', () => {
    const code = stripComments(panel)
    expect(code).toContain('useState<ShareableCompareField[]>([])')
    expect(code).toContain('setSelectedFields([])')
  })

  it('未勾选发布按钮 disabled：disabled 条件含 selectedFields.length === 0', () => {
    const code = stripComments(panel)
    expect(code).toContain('disabled={publishing || selectedFields.length === 0}')
    expect(code).toContain('发布分享')
  })

  it('二次确认文案：公开后任何人可见，备注与标签永不公开', () => {
    const code = stripComments(panel)
    expect(code).toContain('公开后任何人可见，备注与标签永不公开')
  })

  it('每张快照行挂“分享”按钮，挂在“设为基准/设为对照”按钮旁', () => {
    const code = stripComments(panel)
    expect(code).toContain('设为基准')
    expect(code).toContain('设为对照')
    expect(code).toContain('分享')
    expect(code).toContain('handleShareOpen(snapshot.id)')
  })
})

describe('分享取数：发布 / 下线 / 删除走分享接口', () => {
  it('发布走 POST /api/compare/snapshots/:id/publish，只发 fields', () => {
    const code = stripComments(shareLib)
    expect(code).toContain('/api/compare/snapshots/${encodeURIComponent(snapshotId)}/publish')
    expect(code).toContain("method: 'POST'")
    expect(code).toContain('JSON.stringify({ fields: [...fields] })')
  })

  it('下线走 PATCH /api/compare/shares/:slug { status: unpublished }；删除走 DELETE', () => {
    const code = stripComments(shareLib)
    expect(code).toContain('/api/compare/shares/${encodeURIComponent(slug)}')
    expect(code).toContain("method: 'PATCH'")
    expect(code).toContain("method: 'DELETE'")
    expect(code).toContain("JSON.stringify({ status })")
  })

  it('发布成功显示 /pub/compare/<slug> 链接 + 复制按钮 + “下线”按钮', () => {
    const code = stripComments(panel)
    expect(code).toContain('compareShareUrl(shareBySnapshot[snapshot.id].slug)')
    expect(code).toContain('复制链接')
    expect(code).toContain('下线')
    expect(code).toContain('handleCopyShareLink(snapshot.id)')
    expect(code).toContain('handleUnpublish(snapshot.id)')
  })

  it('下线后链接区消失：下线成功从 shareBySnapshot 里删掉该快照的分享', () => {
    const code = stripComments(panel)
    expect(code).toContain('delete next[snapshotId]')
  })

  it('分享链接用 compareShareUrl 拼，不手写第二份 /pub/compare 前缀', () => {
    const code = stripComments(shareLib)
    expect(code).toContain("return `/pub/compare/${slug}`")
  })
})

describe('公开页：只读冻结页，只渲染白名单字段', () => {
  it('直调 GET /api/compare/shares/:slug（hubGetProbe），revalidate=60', () => {
    const code = stripComments(publicPage)
    expect(code).toContain("hubGetProbe<CompareShareDetail>('/api/compare/shares/'")
    expect(code).toContain('export const revalidate = 60')
  })

  it('只渲染 share.fields 里的字段，按 COMPARE_DIMENSIONS 行顺序', () => {
    const code = stripComments(publicPage)
    expect(code).toContain('COMPARE_DIMENSIONS.filter((d) => probe.data.share.fields.includes(d.key))')
    expect(code).not.toContain("dim.key === 'note'")
    expect(code).not.toContain("dim.key === 'migration'")
  })

  it('页头注明冻结日期与“内容不再更新”', () => {
    const code = stripComments(publicPage)
    expect(code).toContain('此对照表冻结于')
    expect(code).toContain('内容不再更新')
  })

  it('冻结页是只读的：不挂“刷新验证”与“填写价格”按钮', () => {
    const code = stripComments(publicPage)
    expect(code).not.toContain('刷新验证')
    expect(code).not.toContain('填写价格')
  })

  it('404 走 not-found：miss 时 notFound()（metadata 与页面体两处）', () => {
    const code = stripComments(publicPage)
    expect(code.match(/notFound\(\)/g)?.length).toBeGreaterThanOrEqual(2)
    expect(code).toContain("if (probe.status === 'miss') notFound()")
  })

  it('格子渲染与 CellValue 同规则：值 + 可能过期徽标 + 来源·核实于/更新于·未验证', () => {
    const code = stripComments(publicPage)
    expect(code).toContain('formatCellValue(cell)')
    expect(code).toContain('formatVerifiedDate(cell.verifiedAt)')
    expect(code).toContain('可能过期')
    expect(code).toContain('来源：')
    expect(code).toContain('未验证')
  })
})
