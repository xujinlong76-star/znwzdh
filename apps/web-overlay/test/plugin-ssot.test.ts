/**
 * 插件市场 SSOT 回归测试。
 *
 * 覆盖 resolvePluginDescription（描述数字与摘要徽章同源）的正常 / 边界 /
 * 中文数字 / 误伤防护用例，主题 5 色色板，以及「所有 seed 描述不含破损
 * 文案」的仓库级护栏。数字与 payload 的一致性由 resolvePluginDescription
 * 的幂等/边界用例 + 运行时 summary 派生共同保证。
 *
 * 导入刻意用相对路径 ../src/...：vitest 的 @/ 别名指向 apps/web/src（镜像产物），
 * 而本测试随 overlay 源码一同维护，用相对路径直接锁定当前事实源副本。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  type PluginManifestSummary,
  resolvePluginDescription,
  hslTripleToHex,
  paletteSwatches,
} from '../src/lib/plugins/plugin-manifest.ts'
import { cardTitle } from '../src/lib/plugins/display-title.ts'

const SEED_DIR = fileURLToPath(new URL('../../api/src/seed-data/', import.meta.url))

function listSeedTs(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listSeedTs(full))
    else if (entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}

/** 抓出 seed 文本里所有 description 字段的字符串字面量值（兼容 "description": 与 description:） */
const DESCRIPTION_RE = /["']?description["']?\s*:\s*(["'`])([\s\S]*?)\1/g

/** 构造一份完整摘要，按需覆盖统计字段，避免用 any 绕过类型 */
function summary(patch: Partial<PluginManifestSummary> = {}): PluginManifestSummary {
  return {
    kind: 'site-pack',
    siteCount: 0,
    categoryCount: 0,
    uniqueTagCount: 0,
    hosts: [],
    boardCount: 0,
    widgetCount: 0,
    widgetTypes: [],
    themeTokenCount: 0,
    engineCount: 0,
    enginePrefixes: [],
    bundleItemCount: 0,
    bundleKinds: [],
    ...patch,
  }
}

describe('resolvePluginDescription（描述 SSOT 收敛）', () => {
  it('网址包：大分类 / 站点数用摘要派生值覆盖', () => {
    expect(
      resolvePluginDescription('完整导航（18 大分类 / 约 200 个站点）：开箱即用', summary({ categoryCount: 19, siteCount: 203 })),
    ).toBe('完整导航（19 大分类 / 约 203 个站点）：开箱即用')
  })

  it('网址包：个精选站点单位不被个站点抢先匹配', () => {
    expect(
      resolvePluginDescription('19 大分类 / 203 个精选站点', summary({ categoryCount: 21, siteCount: 213 })),
    ).toBe('21 大分类 / 213 个精选站点')
  })

  it('工作台预设：看板数与组件数同源，保留原有单位措辞', () => {
    expect(
      resolvePluginDescription('4 看板布局（共 24 个组件）：安装即用', summary({ boardCount: 3, widgetCount: 20 })),
    ).toBe('3 看板布局（共 20 个组件）：安装即用')
  })

  it('主题：项变量数同源', () => {
    expect(
      resolvePluginDescription('经典调色盘（20 项变量全覆盖）', summary({ themeTokenCount: 22 })),
    ).toBe('经典调色盘（22 项变量全覆盖）')
  })

  it('搜索引擎包 / 组合包：引擎与成员数同源', () => {
    expect(resolvePluginDescription('38 个引擎一次装齐', summary({ engineCount: 40 }))).toBe('40 个引擎一次装齐')
    expect(resolvePluginDescription('9 个成员的组合包', summary({ bundleItemCount: 12 }))).toBe('12 个成员的组合包')
  })

  it('中文数字片段也覆盖（四看板 / 十二看板）', () => {
    expect(
      resolvePluginDescription('四看板布局（共 21 个模块）', summary({ boardCount: 4, widgetCount: 21 })),
    ).toBe('4 看板布局（共 21 个模块）')
    expect(resolvePluginDescription('十二看板布局', summary({ boardCount: 5 }))).toBe('5 看板布局')
  })

  it('补「的4 看板」这类缺空格文案', () => {
    expect(resolvePluginDescription('重度用户的4 看板布局', summary({ boardCount: 4 }))).toBe('重度用户的 4 看板布局')
  })

  it('不误伤非统计数字：18 大类 / 5 色 / 2026 年份', () => {
    const text = '18 大类 / 5 色主题 / 2026 前沿发布 / 一站式'
    expect(
      resolvePluginDescription(
        text,
        summary({ categoryCount: 99, siteCount: 99, boardCount: 99, widgetCount: 99, themeTokenCount: 99, engineCount: 99 }),
      ),
    ).toBe(text)
  })

  it('边界：空描述原样返回', () => {
    expect(resolvePluginDescription('', summary({ siteCount: 203 }))).toBe('')
  })

  it('边界：summary 缺失 / 为 null 时不覆盖，仅补空格', () => {
    expect(resolvePluginDescription('4 看板布局（共 24 个组件）', undefined)).toBe('4 看板布局（共 24 个组件）')
    expect(resolvePluginDescription('的4 看板', null)).toBe('的 4 看板')
  })

  it('边界：摘要对应字段为 0 时保留原文，避免把 0 写进不相关描述', () => {
    expect(resolvePluginDescription('4 看板布局（共 24 个组件）', summary())).toBe('4 看板布局（共 24 个组件）')
  })

  it('幂等：服务端与客户端重复调用结果一致', () => {
    const s = summary({ categoryCount: 18, siteCount: 203 })
    const once = resolvePluginDescription('18 大分类 / 203 个精选站点', s)
    expect(resolvePluginDescription(once, s)).toBe(once)
  })
})

describe('主题色板（不编造色值）', () => {
  it('paletteSwatches 为 5 个合法 HEX', () => {
    expect(paletteSwatches).toHaveLength(5)
    for (const hex of paletteSwatches) expect(hex).toMatch(/^#[0-9A-F]{6}$/)
  })

  it('hslTripleToHex 换算正确，非法输入返回 null', () => {
    expect(hslTripleToHex('0 0% 0%')).toBe('#000000')
    expect(hslTripleToHex('0 0% 100%')).toBe('#FFFFFF')
    expect(hslTripleToHex('120 100% 50%')).toBe('#00FF00')
    expect(hslTripleToHex('265 70% 68%')).toMatch(/^#[0-9A-F]{6}$/)
    expect(hslTripleToHex('not-a-color')).toBeNull()
  })
})

describe('seed 描述护栏（防回潮）', () => {
  it('所有 seed 描述不含破损文案（的\\d / 中文数字看板）', () => {
    const broken: string[] = []
    for (const file of listSeedTs(SEED_DIR)) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(DESCRIPTION_RE)) {
        const desc = match[2]
        if (/的\d/.test(desc)) broken.push(`${file}: 的\\d → ${desc.slice(0, 40)}`)
        if (/[一二三四五六七八九十两]+看板/.test(desc)) broken.push(`${file}: 中文数字看板 → ${desc.slice(0, 40)}`)
      }
    }
    expect(broken).toEqual([])
  })
})

/**
 * 卡片标题展示：只在会溢出时去掉结尾括注。
 *
 * 事故背景：`AI 智能体时代旗舰全家桶 (Agentic Future Bundle)` 在两行卡片里
 * 被裁成「…(Agentic Future Bundle」——半个括号挂在卡片上，像数据损坏。
 * 这里钉住三条：短标题原样、长标题去括注、去完不能只剩空壳。
 */
describe('卡片标题：括号截断收敛', () => {
  it('短标题原样返回，不做任何改写', () => {
    expect(cardTitle('北欧冰川极简冷灰主题')).toBe('北欧冰川极简冷灰主题')
    expect(cardTitle('ROI 计算器')).toBe('ROI 计算器')
  })

  it('超长且以括注结尾时只保留正文', () => {
    const name = 'AI 智能体时代旗舰全家桶 (Agentic Future Bundle)'
    expect(cardTitle(name)).toBe('AI 智能体时代旗舰全家桶')
    // 全角括号同样处理
    expect(cardTitle('独立黑客出海增长工具包（含 200 个站点）')).toBe('独立黑客出海增长工具包')
  })

  it('超长但没有括注时不动它——那是 CSS 行数裁剪的事', () => {
    const name = '面向内容创作者的全流程生产力工作台合集'
    expect(cardTitle(name)).toBe(name)
  })

  it('去掉括注后不足 4 个字则保留原名，避免只剩「AI」这种残句', () => {
    const name = 'AI (Artificial Intelligence Bundle Edition)'
    expect(cardTitle(name)).toBe(name)
  })

  it('幂等：对结果再跑一次不会再变', () => {
    const once = cardTitle('投资研究盯盘工作台 (Invest Desk Pro)')
    expect(cardTitle(once)).toBe(once)
  })

  it('空值与空白安全', () => {
    expect(cardTitle('')).toBe('')
    expect(cardTitle('   ')).toBe('')
  })
})
