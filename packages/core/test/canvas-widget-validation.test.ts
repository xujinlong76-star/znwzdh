/**
 * AI 画布生成结果的逐类型校验（validateCanvasWidgets）。
 *
 * 这里锁的是「模型的输出不许静默变成用户的工作台」：
 *   - 跨度必须按**这张卡自己的** min/max 收敛，而不是统一 1~12；
 *   - config 逐字段按目录声明校验，非法值回默认并记账，未知字段丢弃并记账；
 *   - 内嵌/取数类字段只收 http(s) 与同源相对路径，伪协议和协议相对地址不许进画布；
 *   - 一个合法模块都没拿到时必须走保底布局，并且带上 usedFallback 让调用方明说
 *     「这不是按原规划生成的」。
 */
import { describe, it, expect } from 'vitest'
import { BUILTIN_WIDGET_CATALOG, MAX_CANVAS_WIDGETS, validateCanvasWidgets } from '../src/modular'

const PREFIX = 'ai-widget-test'
const run = (widgets: unknown, extra: Record<string, unknown> = {}) =>
  validateCanvasWidgets({ ...(widgets === undefined ? {} : { widgets }), ...extra }, { idPrefix: PREFIX })

describe('跨度：按每类型目录上下限收敛，并记账', () => {
  it('低于该卡 minColSpan 被夹上来，且留下一条 adjusted 记录', () => {
    // hyperbolic-radar 的 minColSpan 是 4：老实现夹到 1 也算「成功」，卡片会挤破栅格
    const meta = BUILTIN_WIDGET_CATALOG['hyperbolic-radar']
    const out = run([{ type: 'hyperbolic-radar', colSpan: 2, rowSpan: 1 }])
    expect(out.usedFallback).toBe(false)
    expect(out.widgets[0]!.colSpan).toBe(meta.minColSpan)
    const issue = out.issues.find((i) => i.field === 'span' && i.key === 'colSpan')
    expect(issue?.action).toBe('adjusted')
    expect(issue?.message).toContain(`${meta.minColSpan}~${meta.maxColSpan}`)
  })

  it('高于该卡 maxRowSpan 被夹下来', () => {
    const meta = BUILTIN_WIDGET_CATALOG['weather-clock']
    const out = run([{ type: 'weather-clock', colSpan: 4, rowSpan: 9 }])
    expect(out.widgets[0]!.rowSpan).toBe(meta.maxRowSpan)
    expect(out.issues.some((i) => i.field === 'span' && i.key === 'rowSpan' && i.action === 'adjusted')).toBe(true)
  })

  it('跨度写成非数字时回默认值，而不是 Number(x)||4 那种偷偷换成 4', () => {
    const meta = BUILTIN_WIDGET_CATALOG['github-heatmap']
    const out = run([{ type: 'github-heatmap', colSpan: '很宽', rowSpan: 2 }])
    expect(out.widgets[0]!.colSpan).toBe(meta.defaultColSpan)
    expect(out.issues.some((i) => i.field === 'span' && i.key === 'colSpan' && i.action === 'defaulted')).toBe(true)
  })

  it('数字字符串按数字处理（模型常把 colSpan 打成 "4"）', () => {
    const out = run([{ type: 'quick-search', colSpan: '4', rowSpan: '1' }])
    expect(out.widgets[0]).toMatchObject({ colSpan: 4, rowSpan: 1 })
    expect(out.issues.filter((i) => i.field === 'span')).toHaveLength(0)
  })
})

describe('非法类型与结构：不许静默丢卡', () => {
  it('目录里没有的类型进 droppedTypes，并留下整条丢弃记录', () => {
    const out = run([{ type: 'clock', colSpan: 4, rowSpan: 1 }, { type: 'quick-search', colSpan: 4, rowSpan: 1 }])
    expect(out.droppedTypes).toEqual(['clock'])
    expect(out.widgets.map((w) => w.type)).toEqual(['quick-search'])
    const dropped = out.issues.find((i) => i.key === 'type')
    expect(dropped?.action).toBe('dropped')
    expect(dropped?.message).toContain('clock')
  })

  it('空类型也进 droppedTypes，用占位名而不是空串', () => {
    const out = run([{ colSpan: 4 }, { type: 'quick-search' }])
    expect(out.droppedTypes).toEqual(['(空类型)'])
  })

  it('widgets 缺失或不是数组 ⇒ 保底布局 + usedFallback', () => {
    for (const bad of [undefined, {}, { widgets: 'nope' }, { widgets: {} }]) {
      const out = validateCanvasWidgets(bad, { idPrefix: PREFIX })
      expect(out.usedFallback).toBe(true)
      expect(out.widgets.length).toBeGreaterThan(0)
      expect(out.widgets.every((w) => Boolean(BUILTIN_WIDGET_CATALOG[w.type]))).toBe(true)
      expect(out.issues.some((i) => i.field === 'structure')).toBe(true)
    }
  })

  it('全部非法 ⇒ 保底布局，并且不谎称按规划生成', () => {
    const out = run([{ type: 'metrics' }, { type: 'weather' }])
    expect(out.usedFallback).toBe(true)
    expect(out.droppedTypes).toEqual(['metrics', 'weather'])
  })

  it('模块数量超上限时截断并记账，不许画布上百张卡', () => {
    const many = Array.from({ length: MAX_CANVAS_WIDGETS + 6 }, () => ({ type: 'markdown-notes', colSpan: 3, rowSpan: 1 }))
    const out = run(many)
    expect(out.widgets).toHaveLength(MAX_CANVAS_WIDGETS)
    expect(out.issues.some((i) => i.field === 'structure' && /上限/.test(i.message))).toBe(true)
  })
})

describe('config：逐字段按目录声明校验', () => {
  it('select 选了不存在的城市 ⇒ 回默认值并记账（不是整卡作废）', () => {
    const meta = BUILTIN_WIDGET_CATALOG['weather-clock']
    const citySchema = meta.configSchema?.find((c) => c.key === 'city')
    const out = run([{ type: 'weather-clock', colSpan: 4, rowSpan: 1, config: { city: 'atlantis', unit: 'celsius' } }])
    const widget = out.widgets[0]!
    expect(widget.config.city).toBe(citySchema?.defaultValue)
    expect(widget.config.unit).toBe('celsius')
    expect(out.issues.some((i) => i.field === 'config' && i.key === 'city' && i.action === 'defaulted')).toBe(true)
  })

  it('boolean 的字符串 "false" 判成 false（z.coerce.boolean() 会把它变成 true）', () => {
    const out = run([{ type: 'iframe-embed', colSpan: 4, rowSpan: 1, config: { allowFullscreen: 'false' } }])
    expect(out.widgets[0]!.config.allowFullscreen).toBe(false)
  })

  it('number 字段接受数字字符串，拒绝非数字并回默认', () => {
    const ok = run([{ type: 'custom-category', colSpan: 4, rowSpan: 1, config: { limit: '9' } }])
    expect(ok.widgets[0]!.config.limit).toBe(9)
    const bad = run([{ type: 'custom-category', colSpan: 4, rowSpan: 1, config: { limit: '很多' } }])
    expect(bad.widgets[0]!.config.limit).toBe(BUILTIN_WIDGET_CATALOG['custom-category'].configSchema?.find((c) => c.key === 'limit')?.defaultValue)
    expect(bad.issues.some((i) => i.key === 'limit' && i.action === 'defaulted')).toBe(true)
  })

  it('目录没声明的字段一律丢弃并记账（不许把任意键塞进用户本地画布）', () => {
    const out = run([{ type: 'quick-search', colSpan: 4, rowSpan: 1, config: { defaultEngine: 'github', evil: { a: 1 } } }])
    expect(out.widgets[0]!.config).toEqual({ defaultEngine: 'github' })
    expect(out.issues.some((i) => i.key === 'evil' && i.action === 'dropped')).toBe(true)
  })

  it('无 configSchema 的模块被塞了配置 ⇒ 清空并记账', () => {
    const meta = BUILTIN_WIDGET_CATALOG['markdown-notes']
    expect(meta.configSchema ?? []).toHaveLength(0)
    const out = run([{ type: 'markdown-notes', colSpan: 3, rowSpan: 1, config: { theme: 'dark' } }])
    expect(out.widgets[0]!.config).toEqual({})
    expect(out.issues.some((i) => i.key === 'config' && i.action === 'dropped')).toBe(true)
  })

  it('缺字段是提示词允许的正常情形：静默回默认值，不制造噪声记录', () => {
    const out = run([{ type: 'quick-search', colSpan: 4, rowSpan: 1, config: {} }])
    expect(out.widgets[0]!.config.defaultEngine).toBe('google')
    expect(out.issues).toHaveLength(0)
  })
})

describe('取数类字段：伪协议与协议相对地址不进画布', () => {
  it('javascript: 被清空并记账', () => {
    const out = run([{ type: 'iframe-embed', colSpan: 4, rowSpan: 1, config: { url: 'javascript:alert(1)' } }])
    expect(out.widgets[0]!.config.url).toBe('')
    expect(out.issues.some((i) => i.key === 'url' && i.action === 'dropped')).toBe(true)
  })

  it('//host 属协议相对的外部地址，同样拒绝', () => {
    const out = run([{ type: 'rss-feed', colSpan: 4, rowSpan: 1, config: { feedUrl: '//evil.example/feed.xml' } }])
    expect(out.widgets[0]!.config.feedUrl).toBe('')
    expect(out.issues.some((i) => i.key === 'feedUrl' && i.action === 'dropped')).toBe(true)
  })

  it('http(s) 绝对地址与同源相对路径放行（live-api 默认就是 /api/hub/health）', () => {
    const out = run([
      { type: 'live-api', colSpan: 3, rowSpan: 1, config: { apiUrl: '/api/hub/health' } },
      { type: 'rss-feed', colSpan: 4, rowSpan: 1, config: { feedUrl: 'https://example.com/feed.xml' } },
    ])
    expect(out.widgets[0]!.config.apiUrl).toBe('/api/hub/health')
    expect(out.widgets[1]!.config.feedUrl).toBe('https://example.com/feed.xml')
    expect(out.issues).toHaveLength(0)
  })
})

describe('保底布局本身合法', () => {
  it('每张卡都用目录默认跨度，id 带调用方前缀', () => {
    const out = run([{ type: 'no-such-card' }])
    for (const w of out.widgets) {
      const meta = BUILTIN_WIDGET_CATALOG[w.type]
      expect(w.id.startsWith(PREFIX)).toBe(true)
      expect(w.colSpan).toBe(meta.defaultColSpan)
      expect(w.rowSpan).toBe(meta.defaultRowSpan)
      expect(w.config).toEqual({})
    }
  })
})
