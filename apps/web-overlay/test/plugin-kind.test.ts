import { describe, expect, it } from 'vitest'
import {
  PLUGIN_KIND_CLASS,
  PLUGIN_KIND_LABEL,
  inferPluginKind,
  pluginHighlight,
} from '../src/lib/plugins/plugin-kind'

/**
 * 插件类型微标签与卖点回归（2026-11-21）。
 *
 * 插件榜每行原本只有「名称 + 安装数/日期」，用户看不出这是主题皮肤还是
 * AI 工作台，直接压低进市场的转化率。这里推断只用插件已有字段，
 * 推断不出来就返回 null（宁可不显示，也不给错标签）。
 */
describe('inferPluginKind', () => {
  const p = (o: { name?: string; tags?: string[]; kind?: string }) =>
    ({ name: o.name ?? 'X', tags: o.tags ?? [], kind: o.kind }) as never

  it('显式 kind 优先', () => {
    expect(inferPluginKind(p({ name: '任意', kind: 'theme' }))).toBe('theme')
    expect(inferPluginKind(p({ name: '任意', kind: 'workspace' }))).toBe('workspace')
  })
  it('按名称识别主题皮肤', () => {
    expect(inferPluginKind(p({ name: '北欧冰霜 (Nord Frost)' }))).toBe('theme')
    expect(inferPluginKind(p({ name: '赛博深色主题' }))).toBe('theme')
  })
  it('按 tags 识别主题', () => {
    expect(inferPluginKind(p({ name: 'X', tags: ['配色'] }))).toBe('theme')
  })
  it('识别 AI 组合包', () => {
    expect(inferPluginKind(p({ name: 'AI 效率组合包' }))).toBe('ai-pack')
    expect(inferPluginKind(p({ name: 'AI 与大模型工具包' }))).toBe('ai-pack')
  })
  it('识别工作台', () => {
    expect(inferPluginKind(p({ name: 'AI 智能体工作台' }))).toBe('workspace')
  })
  it('识别工具/扩展', () => {
    expect(inferPluginKind(p({ name: '批量导出工具' }))).toBe('tool')
    expect(inferPluginKind(p({ name: '标签扩展' }))).toBe('extension')
  })
  it('推断不出来返回 null（不猜）', () => {
    expect(inferPluginKind(p({ name: 'Zyx 无关名称' }))).toBeNull()
  })
  it('每个类型都有标签与样式', () => {
    for (const k of Object.keys(PLUGIN_KIND_LABEL) as Array<keyof typeof PLUGIN_KIND_LABEL>) {
      expect(PLUGIN_KIND_LABEL[k]).toBeTruthy()
      expect(PLUGIN_KIND_CLASS[k]).toContain('border')
    }
  })
})

describe('pluginHighlight', () => {
  const p = (d?: string) => ({ description: d }) as never

  it('短描述原样返回', () => {
    expect(pluginHighlight(p('一键深色主题'))).toBe('一键深色主题')
  })
  it('取第一句', () => {
    expect(pluginHighlight(p('一键深色主题。支持自定义。'))).toBe('一键深色主题')
  })
  it('超长截断到 20 字并加省略号', () => {
    const long = '这是一个非常非常长的插件描述文案超过二十个字符应该被截断处理'
    const out = pluginHighlight(p(long))!
    expect(out.length).toBeLessThanOrEqual(21) // 20 + '…'
    expect(out.endsWith('…')).toBe(true)
  })
  it('无描述返回 null（不编卖点）', () => {
    expect(pluginHighlight(p(undefined))).toBeNull()
    expect(pluginHighlight(p(''))).toBeNull()
    expect(pluginHighlight(p('   '))).toBeNull()
  })
})
