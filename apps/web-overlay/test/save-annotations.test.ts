/**
 * 收藏划线批注：可搜、可导出的本地批注。
 *
 * 验收对照（先审后做时写下的标准）：
 * 1. 划线原文必须是标题/简介的子串，否则拒绝写入——不把没划过的文字存成「划线」。
 * 2. 批注全文可搜：搜批注文字（划线原文 + 批注）能找到原收藏，分组带命中上下文。
 * 3. 可导出 Markdown 与 JSON：Markdown 按收藏分组、划线用引用块；JSON 结构化原数据。
 * 4. 批注可编辑（只改批注文字）/可删除；损坏存储 load 返回空列表不抛错，
 *    但 isAnnotationStorageCorrupted 能检出损坏，损坏时写入拒绝且不覆盖旧数据。
 * 5. 交互：选中文字出划线入口（浮动按钮 + 键盘可达的常驻按钮）、空状态说清用法、
 *    错误状态有下一步、触控 ≥44px、Esc 关闭编辑且焦点返回。
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  addAnnotation,
  annotationExportFilename,
  buildSearchContext,
  deleteAnnotation,
  escapeMarkdownText,
  exportAnnotationsToJson,
  exportAnnotationsToMarkdown,
  groupAnnotationsBySave,
  isAnnotationStorageCorrupted,
  loadAnnotations,
  loadAnnotationsForSave,
  resolveQuoteSource,
  searchAnnotations,
  updateAnnotationNote,
  ANNOTATION_STORE_KEY,
  MAX_ANNOTATIONS_PER_SAVE,
  MAX_NOTE_LENGTH,
  MAX_QUOTE_LENGTH,
  type SaveAnnotation,
} from '../src/lib/save-annotations'

/** 内存版 storage：localStorage 的测试替身，不碰真实浏览器存储。 */
function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v)
    },
    removeItem: (k: string) => {
      map.delete(k)
    },
  }
}

function overlaySource(rel: string): string {
  const candidates = [`../${rel}`, `../../web-overlay/${rel}`].map((p) =>
    fileURLToPath(new URL(p, import.meta.url)),
  )
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 的 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return readFileSync(hit, 'utf8')
}

const TITLE = '免费流程图工具 Draw.io 支持导出 PNG'
const DESC = '开源免费的在线绘图工具，支持导出 PNG 与 SVG，无需注册即可使用。'

function addOk(
  storage: ReturnType<typeof memoryStorage>,
  overrides: Partial<{ siteId: string; siteTitle: string; siteUrl: string; quote: string; source: 'title' | 'description'; note: string; sourceText: string }> = {},
) {
  return addAnnotation(
    {
      siteId: 'site-1',
      siteTitle: TITLE,
      siteUrl: 'https://example.com/draw',
      quote: '导出 PNG',
      source: 'title',
      note: '当时想找免费流程图工具',
      sourceText: TITLE,
      ...overrides,
    },
    storage,
  )
}

describe('划线批注：新增与校验', () => {
  it('quote 是标题子串时写入成功，字段完整', () => {
    const s = memoryStorage()
    const r = addOk(s)
    expect(r.ok).toBe(true)
    expect(r.annotation).not.toBeNull()
    expect(r.annotation!.siteId).toBe('site-1')
    expect(r.annotation!.quote).toBe('导出 PNG')
    expect(r.annotation!.source).toBe('title')
    expect(r.annotation!.note).toBe('当时想找免费流程图工具')
    expect(loadAnnotationsForSave('site-1', s)).toHaveLength(1)
  })

  it('quote 是简介子串时 source=description 也能写入', () => {
    const s = memoryStorage()
    const r = addOk(s, { quote: '开源免费', source: 'description', sourceText: DESC })
    expect(r.ok).toBe(true)
    expect(r.annotation!.source).toBe('description')
  })

  it('纯划线（批注为空）也允许保存', () => {
    const s = memoryStorage()
    const r = addOk(s, { note: '' })
    expect(r.ok).toBe(true)
    expect(r.annotation!.note).toBe('')
  })

  it('quote 不在标题/简介里时拒绝写入，不留脏数据', () => {
    const s = memoryStorage()
    const r = addOk(s, { quote: '根本没出现过的句子', sourceText: TITLE })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/不在当前标题或简介里/)
    expect(loadAnnotations(s)).toHaveLength(0)
  })

  it('空 quote、超长 quote、超长批注都拒绝', () => {
    const s = memoryStorage()
    expect(addOk(s, { quote: '   ' }).ok).toBe(false)
    expect(addOk(s, { quote: 'x'.repeat(MAX_QUOTE_LENGTH + 1), sourceText: 'x'.repeat(MAX_QUOTE_LENGTH + 1) }).ok).toBe(false)
    expect(addOk(s, { note: 'y'.repeat(MAX_NOTE_LENGTH + 1) }).ok).toBe(false)
    expect(loadAnnotations(s)).toHaveLength(0)
  })

  it('损坏的存储 load 返回空列表不抛错，但 isAnnotationStorageCorrupted 能检出损坏', () => {
    const broken = memoryStorage({ [ANNOTATION_STORE_KEY]: '{broken' })
    expect(loadAnnotations(broken)).toEqual([])
    expect(isAnnotationStorageCorrupted(broken)).toBe(true)
    const notArray = memoryStorage({ [ANNOTATION_STORE_KEY]: '{"a":1}' })
    expect(loadAnnotations(notArray)).toEqual([])
    expect(isAnnotationStorageCorrupted(notArray)).toBe(true)
    // 非数组 JSON 也一样（load 返回 [] 是兼容行为，不是「存储正常」）
    expect(loadAnnotations(memoryStorage({ [ANNOTATION_STORE_KEY]: JSON.stringify([{ id: 'x' }]) }))).toEqual([])
    // 个别条目损坏不算整体损坏：load 过滤坏条目，检测返回 false
    const partial = memoryStorage({
      [ANNOTATION_STORE_KEY]: JSON.stringify([
        { id: 'x' },
        {
          id: 'a1',
          siteId: 'site-1',
          siteTitle: TITLE,
          quote: '导出 PNG',
          source: 'title',
          note: '好',
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    })
    expect(isAnnotationStorageCorrupted(partial)).toBe(false)
    expect(loadAnnotations(partial)).toHaveLength(1)
    // 无数据不算损坏
    expect(loadAnnotations(memoryStorage())).toEqual([])
    expect(isAnnotationStorageCorrupted(memoryStorage())).toBe(false)
  })

  it('单收藏上限 50 条：满了就拒绝，不静默丢弃', () => {
    const s = memoryStorage()
    for (let i = 0; i < MAX_ANNOTATIONS_PER_SAVE; i++) {
      expect(addOk(s, { quote: '导出 PNG', note: `第 ${i} 条` }).ok).toBe(true)
    }
    const r = addOk(s, { note: '第 51 条' })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/上限/)
    expect(loadAnnotations(s)).toHaveLength(MAX_ANNOTATIONS_PER_SAVE)
  })
})

describe('划线批注：损坏存储不覆盖', () => {
  const RAW = '{broken'
  const CORRUPTED_ERROR = '批注存储已损坏，未覆盖旧数据：请先导出/备份或清空后重试'

  it('损坏时 add 拒绝写入，原始数据未被覆盖', () => {
    const s = memoryStorage({ [ANNOTATION_STORE_KEY]: RAW })
    const r = addOk(s)
    expect(r.ok).toBe(false)
    expect(r.error).toBe(CORRUPTED_ERROR)
    expect(s.getItem(ANNOTATION_STORE_KEY)).toBe(RAW)
  })

  it('损坏时 update 拒绝写入，原始数据未被覆盖', () => {
    const s = memoryStorage({ [ANNOTATION_STORE_KEY]: RAW })
    const r = updateAnnotationNote('any-id', '新批注', s)
    expect(r.ok).toBe(false)
    expect(r.error).toBe(CORRUPTED_ERROR)
    expect(s.getItem(ANNOTATION_STORE_KEY)).toBe(RAW)
  })

  it('损坏时 delete 返回 false，原始数据未被覆盖', () => {
    const s = memoryStorage({ [ANNOTATION_STORE_KEY]: RAW })
    expect(deleteAnnotation('any-id', s)).toBe(false)
    expect(s.getItem(ANNOTATION_STORE_KEY)).toBe(RAW)
  })

  it('非数组 JSON 损坏时 add 同样拒绝，不覆盖', () => {
    const raw = '{"a":1}'
    const s = memoryStorage({ [ANNOTATION_STORE_KEY]: raw })
    expect(isAnnotationStorageCorrupted(s)).toBe(true)
    expect(addOk(s).ok).toBe(false)
    expect(s.getItem(ANNOTATION_STORE_KEY)).toBe(raw)
  })
})

describe('划线批注：编辑与删除', () => {
  it('只改批注文字，不改划线原文；updatedAt 随之更新', () => {
    const s = memoryStorage()
    const r = addOk(s)
    const id = r.annotation!.id
    const before = r.annotation!.updatedAt
    const ok = updateAnnotationNote(id, '改后的原因：支持 SVG 导出', s)
    expect(ok.ok).toBe(true)
    const after = loadAnnotations(s)[0]
    expect(after.note).toBe('改后的原因：支持 SVG 导出')
    expect(after.quote).toBe('导出 PNG')
    expect(after.updatedAt).toBeGreaterThanOrEqual(before)
  })

  it('改不存在的批注、超长批注都拒绝', () => {
    const s = memoryStorage()
    expect(updateAnnotationNote('no-such-id', 'x', s).ok).toBe(false)
    const r = addOk(s)
    expect(updateAnnotationNote(r.annotation!.id, 'z'.repeat(MAX_NOTE_LENGTH + 1), s).ok).toBe(false)
  })

  it('删除存在的批注返回 true，不存在的返回 false 且不影响其他条', () => {
    const s = memoryStorage()
    const a = addOk(s)
    addOk(s, { quote: '免费流程图', note: '第二条' })
    expect(deleteAnnotation(a.annotation!.id, s)).toBe(true)
    expect(deleteAnnotation('no-such-id', s)).toBe(false)
    expect(loadAnnotations(s)).toHaveLength(1)
  })
})

describe('划线批注：来源判定', () => {
  it('标题优先：两处都有时判标题；只在简介里判简介；都不含返回 null', () => {
    expect(resolveQuoteSource('免费', TITLE, DESC)).toBe('title')
    expect(resolveQuoteSource('开源免费', TITLE, DESC)).toBe('description')
    expect(resolveQuoteSource('不存在', TITLE, DESC)).toBeNull()
    expect(resolveQuoteSource('   ', TITLE, DESC)).toBeNull()
  })
})

describe('划线批注：全文搜索', () => {
  function seeded(): SaveAnnotation[] {
    const s = memoryStorage()
    addOk(s, { siteId: 'site-1', quote: '导出 PNG', note: '当时想找免费流程图工具', sourceText: TITLE })
    addOk(s, {
      siteId: 'site-2',
      siteTitle: 'Notion 模板库',
      siteUrl: 'https://example.com/notion',
      quote: '模板库',
      source: 'title',
      note: '每周复盘用的模板',
      sourceText: 'Notion 模板库',
    })
    addOk(s, {
      siteId: 'site-1',
      quote: '免费流程图',
      note: '支持导出 SVG',
      sourceText: TITLE,
    })
    return loadAnnotations(s)
  }

  it('搜批注文字找到原收藏：按收藏分组，命中带上下文与位置', () => {
    const groups = searchAnnotations(seeded(), '免费流程图')
    expect(groups).toHaveLength(1)
    expect(groups[0].siteId).toBe('site-1')
    // 两处命中：一条在批注里（「免费流程图工具」），一条在划线原文里
    expect(groups[0].hits.length).toBe(2)
    for (const h of groups[0].hits) {
      expect(h.context.slice(h.matchStart, h.matchEnd).toLowerCase()).toContain('免费流程图')
      expect(h.context.length).toBeLessThanOrEqual(h.annotation.note.length + h.annotation.quote.length + 82)
    }
  })

  it('搜划线原文也能找到原收藏，field=quote', () => {
    const groups = searchAnnotations(seeded(), '模板库')
    expect(groups).toHaveLength(1)
    expect(groups[0].siteId).toBe('site-2')
    expect(groups[0].hits[0].field).toBe('quote')
  })

  it('大小写不敏感；空查询返回空数组；无命中返回空数组', () => {
    const all = seeded()
    expect(searchAnnotations(all, 'png')).toHaveLength(1)
    expect(searchAnnotations(all, 'PNG')).toHaveLength(1)
    expect(searchAnnotations(all, '   ')).toEqual([])
    expect(searchAnnotations(all, '不存在的词')).toEqual([])
  })

  it('同一条批注两处都命中时只留划线那处，不重复计数', () => {
    const s = memoryStorage()
    addOk(s, { quote: '导出 PNG', note: '导出 PNG 很方便', sourceText: TITLE })
    const groups = searchAnnotations(loadAnnotations(s), '导出 PNG')
    expect(groups).toHaveLength(1)
    expect(groups[0].hits).toHaveLength(1)
    expect(groups[0].hits[0].field).toBe('quote')
  })

  it('buildSearchContext：命中前后约 40 字，位置对得上', () => {
    const text = 'a'.repeat(100) + '关键词' + 'b'.repeat(100)
    const ctx = buildSearchContext(text, '关键词')
    expect(ctx).not.toBeNull()
    expect(ctx!.context.slice(ctx!.matchStart, ctx!.matchEnd)).toBe('关键词')
    expect(ctx!.context.startsWith('…')).toBe(true)
    expect(ctx!.context.endsWith('…')).toBe(true)
    expect(buildSearchContext(text, '没有')).toBeNull()
    expect(buildSearchContext(text, '  ')).toBeNull()
  })
})

describe('划线批注：按收藏聚合', () => {
  it('同收藏聚合为一组，组内按创建时间倒序', () => {
    const s = memoryStorage()
    addOk(s, { quote: '导出 PNG', note: '第一条' })
    addOk(s, { quote: '免费流程图', note: '第二条' })
    const groups = groupAnnotationsBySave(loadAnnotations(s))
    expect(groups).toHaveLength(1)
    expect(groups[0].items).toHaveLength(2)
    expect(groups[0].items[0].note).toBe('第二条')
  })
})

describe('划线批注：导出', () => {
  function seeded(): SaveAnnotation[] {
    const s = memoryStorage()
    addOk(s, { quote: '导出 PNG', note: '当时想找免费流程图工具' })
    addOk(s, { quote: '免费流程图', note: '' })
    return loadAnnotations(s)
  }

  it('Markdown 按收藏分组：划线用引用块，批注紧跟其后，带原链接与日期', () => {
    const md = exportAnnotationsToMarkdown(seeded())
    expect(md).toContain('# NavSphere 划线批注')
    expect(md).toContain('[免费流程图工具 Draw.io 支持导出 PNG](https://example.com/draw)')
    expect(md).toContain('> 导出 PNG')
    expect(md).toContain('当时想找免费流程图工具')
    expect(md).toContain('> 免费流程图')
    expect(md).toContain('划自标题')
  })

  it('Markdown 标题含 ] 时转义，不破坏链接结构', () => {
    const s = memoryStorage()
    addOk(s, { siteTitle: '标题含 ] 括号' })
    const md = exportAnnotationsToMarkdown(loadAnnotations(s))
    expect(md).toContain('标题含 \\] 括号')
    expect(md).not.toContain('含 ] 括号') // 未转义的 ] 会提前闭合链接
    expect(md).toMatch(/^## \[.*\]\(https:\/\/example\.com\/draw\)$/m)
  })

  it('Markdown 空 URL 时标题写纯文本，不出空链接', () => {
    const s = memoryStorage()
    addOk(s, { siteUrl: undefined })
    const md = exportAnnotationsToMarkdown(loadAnnotations(s))
    expect(md).toContain(`## ${TITLE}`)
    expect(md).not.toContain(']()')
    expect(md).not.toContain(`[${TITLE}]`)
  })

  it('Markdown 空列表不编造条目，只说暂无批注', () => {
    expect(exportAnnotationsToMarkdown([])).toContain('暂无批注')
  })

  it('JSON 是结构化原数据，可解析回同等条目', () => {
    const json = exportAnnotationsToJson(seeded())
    const parsed = JSON.parse(json) as { version: number; count: number; annotations: SaveAnnotation[] }
    expect(parsed.version).toBe(1)
    expect(parsed.count).toBe(2)
    expect(parsed.annotations).toHaveLength(2)
    expect(parsed.annotations[0].quote).toBeTruthy()
  })

  it('导出文件名按日期生成，md/json 后缀正确', () => {
    const day = new Date().toISOString().slice(0, 10)
    expect(annotationExportFilename('md')).toBe(`navhub-划线批注-${day}.md`)
    expect(annotationExportFilename('json')).toBe(`navhub-划线批注-${day}.json`)
  })
})

describe('划线批注：界面接入（源码守卫）', () => {
  it('详情页面板存在：阅读区、选区入口、编辑器、导出、空状态、错误状态齐全', () => {
    const panel = overlaySource('src/components/save-annotation-panel.tsx')
    expect(panel).toContain('划线批注')
    expect(panel).toContain('划线选中的文字')
    expect(panel).toContain('划线原文')
    expect(panel).toContain('还没有划线批注')
    expect(panel).toContain('role="alert"')
    expect(panel).toContain('导出 Markdown')
    expect(panel).toContain('导出 JSON')
    expect(panel).toContain('查看全部批注')
    expect(panel).toContain('/me/annotations')
    // 无简介时明说只能对标题划线，不编造正文
    expect(panel).toContain('没有简介正文')
    expect(panel).toContain('不从站外抓取')
  })

  it('面板触控与键盘：全部操作按钮 min-h-11，Esc 取消且焦点返回', () => {
    const panel = overlaySource('src/components/save-annotation-panel.tsx')
    const minH11 = (panel.match(/min-h-11/g) ?? []).length
    expect(minH11).toBeGreaterThanOrEqual(6)
    expect(panel).toContain("e.key === 'Escape'")
    expect(panel).toContain('highlightButtonRef.current?.focus()')
    // 选区监听：鼠标选区出浮动入口，键盘选区走常驻按钮
    expect(panel).toContain('selectionchange')
    expect(panel).toContain('getSelection')
    // 浮动按钮是 position:fixed（视口坐标），不许加 scroll 偏移，否则滚动后错位
    expect(panel).not.toContain('scrollX')
    expect(panel).not.toContain('scrollY')
  })

  it('损坏存储读路径有错误状态：面板与总览页都先判损坏再读，不把损坏误显示为空列表', () => {
    const panel = overlaySource('src/components/save-annotation-panel.tsx')
    expect(panel).toContain('isAnnotationStorageCorrupted')
    expect(panel).toContain('批注存储已损坏')
    const page = overlaySource('src/app/me/annotations/page.tsx')
    expect(page).toContain('isAnnotationStorageCorrupted')
    expect(page).toContain('批注存储已损坏')
  })

  it('详情页接入了面板，收藏页与总览页有入口', () => {
    const detail = overlaySource('src/components/site-detail-view.tsx')
    expect(detail).toContain('SaveAnnotationPanel')
    expect(detail).toContain('siteId={site.id}')
    const favorites = overlaySource('src/app/favorites/page.tsx')
    expect(favorites).toContain('/me/annotations')
    expect(favorites).toContain('我的批注')
    const page = overlaySource('src/app/me/annotations/page.tsx')
    expect(page).toContain('搜索批注')
    expect(page).toContain('导出全部 Markdown')
    expect(page).toContain('导出全部 JSON')
    expect(page).toContain('还没有划线批注')
    expect(page).toContain('role="alert"')
  })
})

describe('划线批注：Markdown 导出转义（CodeQL #136/#137）', () => {
  it('反斜杠先转义：a\\]b 里的 ] 不得复活', () => {
    // 旧实现：] -> \]，前面的 \ 与新加的 \ 组成 \\（字面反斜杠），] 重新变活。
    // 单遍映射：\ -> \\、] -> \]，输出 a\\\]b，渲染后仍是字面 a\]b。
    expect(escapeMarkdownText('a\\]b')).toBe('a\\\\\\]b')
    expect(escapeMarkdownText('a\\b')).toBe('a\\\\b')
    expect(escapeMarkdownText('x]y')).toBe('x\\]y')
    expect(escapeMarkdownText('[link](http://evil)')).toBe('\\[link\\](http://evil)')
  })

  it('< > 转义成实体，HTML 不进导出的 Markdown', () => {
    expect(escapeMarkdownText('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    )
    expect(escapeMarkdownText('plain')).toBe('plain')
  })

  it('导出的 Markdown 里含反斜杠的划线不提前终结链接文本', () => {
    const ann: SaveAnnotation = {
      id: 'a1',
      siteId: 'site-1',
      siteTitle: 'a]b 标题',
      siteUrl: 'https://example.com/x',
      quote: 'x]y 划线',
      source: 'title',
      note: 'note \\] note',
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    }
    const md = exportAnnotationsToMarkdown([ann])
    // 标题里的 ] 已转义：链接文本不得在 a] 处提前闭合
    expect(md).toContain('## [a\\]b 标题](https://example.com/x)')
    expect(md).toContain('> x\\]y 划线')
    // 批注里的 \] 不得被反斜杠吃掉后复活
    expect(md).toContain('note \\\\\\] note')
  })
})
