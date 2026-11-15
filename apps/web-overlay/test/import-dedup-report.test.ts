import { describe, expect, it } from 'vitest'
import { parseNetscapeBookmarks } from '../src/lib/bookmarks-import'
import { parseUniversalBookmarks, type ParsedUniversalItem } from '../src/lib/favorites-export-import'
import {
  activeVariantForKept,
  applyOverride,
  buildDedupReport,
  buildLocalFingerprintIndex,
  checkDedupReportInvariant,
  collectSkippedItems,
  freezeExecutionPlan,
  isAllSkippedSummary,
} from '../src/lib/import-dedup-report'
import { fingerprintUrl } from '../src/lib/import-workbench'

function parsedItem(href: string, title = '站点', folderName?: string): ParsedUniversalItem {
  return {
    siteId: `test-${href}`,
    title,
    href,
    folderName,
    tags: [],
    createdAt: 1,
  }
}

const LOCAL = buildLocalFingerprintIndex([
  { siteId: 'local-1', title: '已存标题', href: 'https://example.com/saved', folderName: '工作' },
  { siteId: 'local-2', title: '公开站', href: 'https://public.example.com/', folderName: '阅读' },
])

describe('指纹同一性：三处口径一致（解析层 / 报告层 / 入库层共用 fingerprintUrl）', () => {
  it('utm / www / http-vs-https / 尾斜杠 / 默认端口 / host 大小写收敛到同一指纹', () => {
    const variants = [
      'https://www.Example.com/docs/?utm_source=x&spm=a&q=rust#part',
      'http://example.com/docs/?q=rust',
      'https://example.com:443/docs/?q=rust',
      'https://example.com/docs/?q=rust',
    ]
    const fps = new Set(variants.map((v) => fingerprintUrl(v)))
    expect(fps.size).toBe(1)
  })

  it('业务参数不同判不同条（sku 这类业务参数不被误剥离的回归用例）', () => {
    // 注意：ref / utm_* 是追踪参数（normalizeUrl 会剥离），误判兜底靠逐条改判；
    // 真正的业务参数（如 sku）必须保留且区分
    expect(fingerprintUrl('https://example.com/item?sku=1')).not.toBe(
      fingerprintUrl('https://example.com/item?sku=2'),
    )
  })

  it('解析层批内去重用指纹：utm 变体只剩 1 条', () => {
    const html = [
      '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
      '<DL><p>',
      '<DT><A HREF="https://example.com/?utm_source=x">站 A</A>',
      '<DT><A HREF="http://www.example.com/">站 A 换个写法</A>',
      '<DT><A HREF="https://other.example.com/">站 B</A>',
      '</DL><p>',
    ].join('\n')
    const parsed = parseUniversalBookmarks(html)
    expect(parsed.ok).toBe(true)
    expect(parsed.items).toHaveLength(2)
    const legacy = parseNetscapeBookmarks(html)
    expect(legacy.items).toHaveLength(2)
    expect(legacy.totalMatched).toBe(3)
  })

  it('报告层对同一组 URL 得出同一 verdict：变体是 intra-file-dup，不是 new', () => {
    const report = buildDedupReport(
      [
        parsedItem('https://example.com/?utm_source=x', '站 A'),
        parsedItem('http://www.example.com/', '站 A 换个写法'),
        parsedItem('https://other.example.com/', '站 B'),
      ],
      new Map(),
    )
    expect(report.counts.new).toBe(2)
    expect(report.counts['intra-file-dup']).toBe(1)
    expect(checkDedupReportInvariant(report)).toBe(true)
  })
})

describe('去重报告分组完备', () => {
  it('8 种 verdict 全覆盖时 sum(counts) === totalParsed', () => {
    // 注意：同一指纹第二次出现一律是 intra-file-dup；标题/文件夹冲突只在
    // 该指纹首次出现、与本地已存条目比对时判定——所以每种冲突各用不同指纹。
    const local = buildLocalFingerprintIndex([
      { siteId: 'local-1', title: '已存标题', href: 'https://example.com/saved', folderName: '工作' },
      { siteId: 'local-3', title: '旧标题', href: 'https://titled.example.com/', folderName: '阅读' },
      { siteId: 'local-4', title: '夹站', href: 'https://foldered.example.com/', folderName: '旧夹' },
    ])
    const publicIndex = [fingerprintUrl('https://public.example.com/')]
    const report = buildDedupReport(
      [
        parsedItem('https://new.example.com/', '新站'),
        parsedItem('https://example.com/saved', '已存标题', '工作'),
        parsedItem('https://titled.example.com/', '新标题', '阅读'),
        parsedItem('https://foldered.example.com/', '夹站', '新夹'),
        parsedItem('https://public.example.com/', '公开站'),
        parsedItem('http://localhost:3000/admin', '本地后台'),
        parsedItem('javascript:alert(1)', '坏链接'),
        parsedItem('https://dup.example.com/', '第一条'),
        parsedItem('https://dup.example.com/', '第二条'),
      ],
      local,
      { publicIndex },
    )
    expect(report.counts.new).toBe(2)
    expect(report.counts['exists-local']).toBe(1)
    expect(report.counts['title-conflict']).toBe(1)
    expect(report.counts['folder-conflict']).toBe(1)
    expect(report.counts['exists-public']).toBe(1)
    expect(report.counts['private-blocked']).toBe(1)
    expect(report.counts.invalid).toBe(1)
    expect(report.counts['intra-file-dup']).toBe(1)
    expect(report.totalParsed).toBe(9)
    expect(checkDedupReportInvariant(report)).toBe(true)
  })

  it('公共库索引不可用时 dedupeUnavailable=true，且不把任何条目标成已收录', () => {
    const report = buildDedupReport([parsedItem('https://public.example.com/', '公开站', '阅读')], new Map(), { publicIndex: null })
    expect(report.dedupeUnavailable).toBe(true)
    expect(report.counts['exists-public']).toBe(0)
    // 本地也没有它：应为 new，而不是 exists-local
    expect(report.counts.new).toBe(1)
  })
})

describe('标题冲突与文件夹冲突不算重复', () => {
  it('同指纹不同标题 → title-conflict，counts.new 不变，默认保留已存标题', () => {
    const report = buildDedupReport(
      [parsedItem('https://example.com/saved', '新标题')],
      LOCAL,
    )
    expect(report.counts['title-conflict']).toBe(1)
    expect(report.counts.new).toBe(0)
    const item = report.groups['title-conflict'][0]!
    expect(item.existingTitle).toBe('已存标题')
    expect(item.selectedPrivate).toBe(false)
    expect(item.override).toBeUndefined()
  })

  it('同指纹不同文件夹 → folder-conflict，默认保留已存文件夹', () => {
    const report = buildDedupReport(
      [parsedItem('https://example.com/saved', '已存标题', '新文件夹')],
      LOCAL,
    )
    expect(report.counts['folder-conflict']).toBe(1)
    const item = report.groups['folder-conflict'][0]!
    expect(item.existingFolder).toBe('工作')
    expect(item.selectedPrivate).toBe(false)
  })
})

describe('逐条改判联动', () => {
  it('exists-local 改判 use-imported → 选中更新已存条目，冻结清单进 updatedItems', () => {
    const report = buildDedupReport([parsedItem('https://example.com/saved', '已存标题')], LOCAL)
    const id = report.groups['exists-local'][0]!.id
    const next = applyOverride(report, id, 'use-imported')
    const item = next.groups['exists-local'][0]!
    expect(item.selectedPrivate).toBe(true)
    expect(item.override).toBe('use-imported')
    const plan = freezeExecutionPlan(next)
    expect(plan.updatedItems).toHaveLength(1)
    expect(plan.privateCount).toBe(1)
    // 改回 keep-existing 后不再选中
    const back = applyOverride(next, id, 'keep-existing')
    expect(back.groups['exists-local'][0]!.selectedPrivate).toBe(false)
    expect(freezeExecutionPlan(back).privateCount).toBe(0)
  })

  it('folder-conflict 改判 move-folder → folderMoves 有一条，选中更新', () => {
    const report = buildDedupReport(
      [parsedItem('https://example.com/saved', '已存标题', '新文件夹')],
      LOCAL,
    )
    const id = report.groups['folder-conflict'][0]!.id
    const next = applyOverride(report, id, 'move-folder')
    const plan = freezeExecutionPlan(next)
    expect(plan.folderMoves).toEqual([{ id, existingId: 'local-1', folder: '新文件夹' }])
    expect(plan.privateCount).toBe(1)
  })

  it('title-conflict 改判 use-imported → titleOverrides 有一条', () => {
    const report = buildDedupReport([parsedItem('https://example.com/saved', '新标题')], LOCAL)
    const id = report.groups['title-conflict'][0]!.id
    const next = applyOverride(report, id, 'use-imported')
    const plan = freezeExecutionPlan(next)
    expect(plan.titleOverrides).toEqual([{ id, existingId: 'local-1', title: '新标题' }])
  })

  it('intra-file-dup 改判 use-imported → 与保留条互换（本条选中，保留条取消）', () => {
    const report = buildDedupReport(
      [
        parsedItem('https://dup.example.com/', '第一条'),
        parsedItem('https://dup.example.com/', '第二条'),
      ],
      new Map(),
    )
    const keptId = report.groups.new[0]!.id
    const dupId = report.groups['intra-file-dup'][0]!.id
    const next = applyOverride(report, dupId, 'use-imported')
    expect(next.groups.new.find((i) => i.id === keptId)!.selectedPrivate).toBe(false)
    const dup = next.groups['intra-file-dup'].find((i) => i.id === dupId)!
    expect(dup.selectedPrivate).toBe(true)
    expect(freezeExecutionPlan(next).privateCount).toBe(1)
  })

  it('private-blocked 与 invalid 不可改判：applyOverride 原样返回', () => {
    const report = buildDedupReport(
      [parsedItem('http://localhost:3000/admin', '本地后台'), parsedItem('javascript:x', '坏')],
      new Map(),
    )
    const privateId = report.groups['private-blocked'][0]!.id
    const invalidId = report.groups.invalid[0]!.id
    expect(applyOverride(report, privateId, 'use-imported')).toBe(report)
    expect(applyOverride(report, invalidId, 'use-imported')).toBe(report)
  })
})

describe('隐私红线与公共投稿锁定', () => {
  it('private-blocked 只能进个人收藏，公共投稿锁定', () => {
    const report = buildDedupReport([parsedItem('http://192.168.1.10:8080/', 'NAS')], new Map())
    const item = report.groups['private-blocked'][0]!
    expect(item.publicLocked).toBe(true)
    expect(item.selectedPrivate).toBe(true)
    expect(item.selectedPublic).toBe(false)
    expect(freezeExecutionPlan(report).publicCount).toBe(0)
  })

  it('exists-public 的个人收藏默认选中，公共投稿不可再投', () => {
    // 本地没有这条时才判 exists-public（本地已存时优先判 exists-local）
    const report = buildDedupReport(
      [parsedItem('https://public.example.com/', '公开站')],
      new Map(),
      { publicIndex: [fingerprintUrl('https://public.example.com/')] },
    )
    const item = report.groups['exists-public'][0]!
    expect(item.publicLocked).toBe(true)
    expect(item.selectedPrivate).toBe(true)
    expect(item.selectedPublic).toBe(false)
  })
})

describe('冻结清单：预览数 == 执行数', () => {
  it('freezeExecutionPlan 的 private/public 计数与报告选中一致', () => {
    const report = buildDedupReport(
      [
        parsedItem('https://a.example.com/', 'A'),
        parsedItem('https://b.example.com/', 'B'),
        parsedItem('https://example.com/saved', '已存标题'),
      ],
      LOCAL,
    )
    const plan = freezeExecutionPlan(report)
    expect(plan.privateCount).toBe(2)
    expect(plan.publicCount).toBe(2)
    expect(plan.totalSelected).toBe(2)
    expect(plan.privateItems).toHaveLength(plan.privateCount)
    expect(plan.publicItems).toHaveLength(plan.publicCount)
  })
})

describe('超限 totalMatched 诚实', () => {
  it('超过 limit 时 truncated=true 且 totalMatched 是真实命中总数', () => {
    const lines = ['<!DOCTYPE NETSCAPE-Bookmark-file-1>', '<DL><p>']
    for (let i = 0; i < 5; i++) lines.push(`<DT><A HREF="https://s${i}.example.com/">站 ${i}</A>`)
    lines.push('</DL><p>')
    const parsed = parseUniversalBookmarks(lines.join('\n'), 2)
    expect(parsed.items).toHaveLength(2)
    expect(parsed.truncated).toBe(true)
    expect(parsed.totalMatched).toBe(5)
  })

  it('parseNetscapeBookmarks 上限统一为 5000（不再是 10000）', () => {
    const lines = ['<DL><p>']
    for (let i = 0; i < 5100; i++) lines.push(`<DT><A HREF="https://s${i}.example.com/">站 ${i}</A>`)
    lines.push('</DL><p>')
    const { items, truncated, totalMatched } = parseNetscapeBookmarks(lines.join('\n'))
    expect(items).toHaveLength(5000)
    expect(truncated).toBe(true)
    expect(totalMatched).toBe(5100)
  })

  it('非阻塞 #5：parseNetscapeBookmarks 的 totalMatched 只计 http(s) 锚点，不含 javascript:', () => {
    const html = [
      '<DL><p>',
      '<DT><A HREF="https://a.example.com/">站 A</A>',
      '<DT><A HREF="javascript:alert(1)">坏锚点</A>',
      '<DT><A HREF="https://b.example.com/">站 B</A>',
      '</DL><p>',
    ].join('\n')
    const { items, totalMatched } = parseNetscapeBookmarks(html)
    expect(items).toHaveLength(2)
    expect(totalMatched).toBe(2)
  })
})

describe('B-2：汇总跳过数从冻结 plan / 报告派生（不再拿 writePrivate 的 alreadyExisted）', () => {
  it('3 新 + 2 已存在：确认数与汇总数一致——跳过 = totalParsed - totalSelected', () => {
    const report = buildDedupReport(
      [
        parsedItem('https://a.example.com/', 'A'),
        parsedItem('https://b.example.com/', 'B'),
        parsedItem('https://c.example.com/', 'C'),
        parsedItem('https://example.com/saved', '已存标题'),
        // LOCAL 里已有的第二条（exists-local，默认不选中、被跳过）
        parsedItem('https://public.example.com/', '公开站'),
      ],
      LOCAL,
    )
    const plan = freezeExecutionPlan(report)
    expect(report.totalParsed).toBe(5)
    expect(plan.totalSelected).toBe(3)
    // 确认页的“将被跳过”与汇总页的跳过数是同一道算式
    const skipped = collectSkippedItems(report)
    expect(skipped).toHaveLength(report.totalParsed - plan.totalSelected)
    expect(skipped).toHaveLength(2)
    expect(skipped.map((i) => i.verdict).sort()).toEqual(['exists-local', 'exists-local'])
    expect(checkDedupReportInvariant(report)).toBe(true)
  })

  it('全已存在：isAllSkippedSummary 为 true，汇总应说“没有新增内容”', () => {
    const report = buildDedupReport(
      [
        parsedItem('https://example.com/saved', '已存标题'),
        parsedItem('https://public.example.com/', '公开站'),
      ],
      LOCAL,
    )
    const plan = freezeExecutionPlan(report)
    expect(plan.totalSelected).toBe(0)
    expect(collectSkippedItems(report)).toHaveLength(2)
    expect(isAllSkippedSummary(plan, 0)).toBe(true)
    // 有新增或有更新时不是全跳过
    expect(isAllSkippedSummary(plan, 1)).toBe(false)
    const withUpdate = applyOverride(report, report.groups['exists-local'][0]!.id, 'use-imported')
    expect(isAllSkippedSummary(freezeExecutionPlan(withUpdate), 0)).toBe(false)
  })
})

describe('B-3：单文件内重复进报告（解析器 droppedDuplicates + 报告判定）', () => {
  it('同一链接出现两次 → 报告 intra-file-dup===1，保留条与 dup 条各有独立 id', () => {
    const html = [
      '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
      '<DL><p>',
      '<DT><A HREF="https://dup.example.com/">第一条标题</A>',
      '<DT><A HREF="https://dup.example.com/">第二条标题</A>',
      '</DL><p>',
    ].join('\n')
    const parsed = parseUniversalBookmarks(html)
    expect(parsed.items).toHaveLength(1)
    expect(parsed.droppedDuplicates).toHaveLength(1)
    // stage 的做法：报告对“原始命中清单”（items + droppedDuplicates）建
    const report = buildDedupReport([...parsed.items, ...(parsed.droppedDuplicates ?? [])], new Map())
    expect(report.totalParsed).toBe(2)
    expect(report.counts.new).toBe(1)
    expect(report.counts['intra-file-dup']).toBe(1)
    expect(checkDedupReportInvariant(report)).toBe(true)
    const kept = report.groups.new[0]!
    const dup = report.groups['intra-file-dup'][0]!
    expect(dup.keptById).toBe(kept.id)
    expect(dup.id).not.toBe(kept.id)
    expect(dup.title).toBe('第二条标题')
    expect(kept.selectedPrivate).toBe(true)
    expect(dup.selectedPrivate).toBe(false)
    // Step 3 可见、可互换：改用 dup 后只计一次，且是 dup 的标题
    const swapped = applyOverride(report, dup.id, 'use-imported')
    const plan = freezeExecutionPlan(swapped)
    expect(plan.privateCount).toBe(1)
    expect(plan.privateItems[0]!.title).toBe('第二条标题')
    expect(activeVariantForKept(swapped, kept.id)?.id).toBe(dup.id)
  })
})

describe('B-4：跨文件重复——保留条默认选中、徽标为 new、执行只计一次', () => {
  it('两文件含同一 URL：保留条默认选中，dup 不选中，冻结只计一次', () => {
    // 多文件累加后合并清单里同一指纹出现两次（第二条标题不同）
    const report = buildDedupReport(
      [
        parsedItem('https://dup.example.com/', '第一条'),
        parsedItem('https://dup.example.com/', '第二条'),
      ],
      new Map(),
    )
    const kept = report.groups.new[0]!
    const dup = report.groups['intra-file-dup'][0]!
    expect(kept.verdict).toBe('new')
    expect(kept.selectedPrivate).toBe(true)
    expect(dup.selectedPrivate).toBe(false)
    expect(freezeExecutionPlan(report).privateCount).toBe(1)
  })

  it('改判回“保留第一条”：保留条按默认恢复选中，dup 取消，仍只计一次', () => {
    const report = buildDedupReport(
      [
        parsedItem('https://dup.example.com/', '第一条'),
        parsedItem('https://dup.example.com/', '第二条'),
      ],
      new Map(),
    )
    const keptId = report.groups.new[0]!.id
    const dupId = report.groups['intra-file-dup'][0]!.id
    const swapped = applyOverride(report, dupId, 'use-imported')
    expect(swapped.groups.new.find((i) => i.id === keptId)!.selectedPrivate).toBe(false)
    const back = applyOverride(swapped, dupId, 'keep-existing')
    expect(back.groups.new.find((i) => i.id === keptId)!.selectedPrivate).toBe(true)
    expect(back.groups['intra-file-dup'].find((i) => i.id === dupId)!.selectedPrivate).toBe(false)
    expect(freezeExecutionPlan(back).privateCount).toBe(1)
    expect(activeVariantForKept(back, keptId)?.id).toBe(keptId)
  })

  it('同一指纹同时只能有一条生效：保留条改判选中时，已激活的 dup 自动取消', () => {
    const local = buildLocalFingerprintIndex([
      { siteId: 'local-1', title: '已存标题', href: 'https://dup.example.com/', folderName: '工作' },
    ])
    const report = buildDedupReport(
      [
        parsedItem('https://dup.example.com/', '已存标题'),
        parsedItem('https://dup.example.com/', '第二条'),
      ],
      local,
    )
    const keptId = report.groups['exists-local'][0]!.id
    const dupId = report.groups['intra-file-dup'][0]!.id
    // 先改用 dup（dup 选中），再对保留条点“更新已存条目”：dup 必须让位
    const swapped = applyOverride(report, dupId, 'use-imported')
    expect(swapped.groups['intra-file-dup'].find((i) => i.id === dupId)!.selectedPrivate).toBe(true)
    const updated = applyOverride(swapped, keptId, 'use-imported')
    expect(updated.groups['exists-local'].find((i) => i.id === keptId)!.selectedPrivate).toBe(true)
    expect(updated.groups['intra-file-dup'].find((i) => i.id === dupId)!.selectedPrivate).toBe(false)
    expect(freezeExecutionPlan(updated).privateCount).toBe(1)
  })
})
