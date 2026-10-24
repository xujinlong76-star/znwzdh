/**
 * 模块目录的「三处真相」必须同源。
 *
 * 真实缺陷：同一个模块清单存在三份独立维护的副本——
 *  1. 前端卡片注册表 apps/web-overlay/src/lib/modular/registry.ts（决定配置弹窗与渲染）；
 *  2. core 的 BUILTIN_WIDGET_CATALOG（AI 规划提示词与合法类型都从它派生）；
 *  3. 曾经还有一份 API 侧手写白名单（已改为从 core 派生）。
 * 三份各自漂移的后果：AI 按提示词里的旧类型名（clock / notes / weather …）规划，
 * API 用 `.filter(合法类型)` 把这些卡静默丢掉，用户只看到「生成的排版比规划的少」；
 * 反过来 core 里写着的 configSchema 若前端不认，配置项就是看得见改了没用的假承诺。
 *
 * 所以这里钉两件事：类型键集合完全相等，且每个类型的 configSchema 键与标题一致。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  BUILTIN_WIDGET_CATALOG,
  WIDGET_TYPE_NAMES,
  findUnknownWorkspaceWidgetTypes,
  validatePluginManifestWithCatalog,
} from '../src/modular.ts'
import { WEATHER_CITIES } from '../../../apps/web-overlay/src/lib/modular/weather.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const REGISTRY_PATH = resolve(HERE, '..', '..', '..', 'apps', 'web-overlay', 'src', 'lib', 'modular', 'registry.ts')

/** 从注册表源码里切出每个类型的那一段（顶层两空格缩进的 `'type': {` 到下一个同级键之前） */
function registryEntries(source: string): Map<string, string> {
  const entries = new Map<string, string>()
  const starts: Array<{ key: string; index: number }> = []
  const headPattern = /^ {2}'([a-z0-9-]+)': \{/gm
  let match: RegExpExecArray | null
  while ((match = headPattern.exec(source))) starts.push({ key: match[1], index: match.index })
  for (let i = 0; i < starts.length; i++) {
    const next = i + 1 < starts.length ? starts[i + 1].index : source.length
    entries.set(starts[i].key, source.slice(starts[i].index, next))
  }
  return entries
}

function schemaKeysOf(entry: string): string[] {
  return [...entry.matchAll(/key:\s*'([a-zA-Z0-9_]+)'/g)].map((m) => m[1])
}

/**
 * 按 `key:` 边界切出每个配置项，再取该项里的候选值。
 * 用 \bvalue 而不是 value，否则 defaultValue 会被当成候选值。
 */
function schemaOptionsOf(entry: string): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  const starts = [...entry.matchAll(/key:\s*'([a-zA-Z0-9_]+)'/g)]
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i].index
    const to = i + 1 < starts.length ? starts[i + 1].index : entry.length
    out[starts[i][1]] = [...entry.slice(from, to).matchAll(/\bvalue:\s*'([^']*)'/g)].map((m) => m[1])
  }
  return out
}

function titleOf(entry: string): string {
  return /title:\s*'((?:[^'\\]|\\.)*)'/.exec(entry)?.[1] ?? ''
}

const registrySource = readFileSync(REGISTRY_PATH, 'utf8')
const entries = registryEntries(registrySource)

describe('core 模块目录 ↔ 前端卡片注册表同源', () => {
  it('注册表能按顶层键切出条目（守测试自己）', () => {
    expect(entries.size).toBeGreaterThan(10)
  })

  it('类型键集合一一对应：谁都不许多一个或少一个', () => {
    expect([...entries.keys()].sort()).toEqual([...WIDGET_TYPE_NAMES].sort())
  })

  it('WIDGET_TYPE_NAMES 就是目录键，顺序一致', () => {
    expect(WIDGET_TYPE_NAMES).toEqual(Object.keys(BUILTIN_WIDGET_CATALOG))
  })

  it('configSchema 的字段名两侧完全一致（配置可达性承诺）', () => {
    const drift: string[] = []
    for (const [type, meta] of Object.entries(BUILTIN_WIDGET_CATALOG)) {
      const entry = entries.get(type)
      if (!entry) continue
      const fromCore = (meta.configSchema ?? []).map((item) => item.key)
      const fromRegistry = schemaKeysOf(entry)
      if (fromCore.join('|') !== fromRegistry.join('|')) drift.push(`${type}: core=[${fromCore}] registry=[${fromRegistry}]`)
    }
    expect(drift).toEqual([])
  })

  it('select 的候选值两侧一致：弹窗里能选的就是目录承诺的', () => {
    const drift: string[] = []
    for (const [type, meta] of Object.entries(BUILTIN_WIDGET_CATALOG)) {
      const entry = entries.get(type)
      if (!entry) continue
      const registryOptions = schemaOptionsOf(entry)
      for (const item of meta.configSchema ?? []) {
        const coreValues = (item.options ?? []).map((o) => o.value)
        const registryValues = registryOptions[item.key] ?? []
        if (coreValues.join('|') !== registryValues.join('|')) {
          drift.push(`${type}.${item.key}: core=[${coreValues}] registry=[${registryValues}]`)
        }
      }
    }
    expect(drift).toEqual([])
  })

  it('天气城市候选值 = 服务端坐标表：选了就得能取到数', () => {
    const citySchema = BUILTIN_WIDGET_CATALOG['weather-clock'].configSchema?.find((s) => s.key === 'city')
    const registryCities = schemaOptionsOf(entries.get('weather-clock') ?? '')['city'] ?? []
    const keys = Object.keys(WEATHER_CITIES)
    expect((citySchema?.options ?? []).map((o) => o.value)).toEqual(keys)
    expect(registryCities).toEqual(keys)
    // 坐标缺失会让 /api/weather 拼出 NaN 经纬度，表内每个城市都得有合法坐标
    for (const city of Object.values(WEATHER_CITIES)) {
      expect(Number.isFinite(city.latitude), city.key).toBe(true)
      expect(Number.isFinite(city.longitude), city.key).toBe(true)
      expect(city.timezone, city.key).toMatch(/^[A-Za-z_]+\/[A-Za-z_]+$/)
    }
  })

  it('标题两侧一致：AI 规划弹窗列的名字必须就是卡片自己的名字', () => {
    const drift: string[] = []
    for (const [type, meta] of Object.entries(BUILTIN_WIDGET_CATALOG)) {
      const entry = entries.get(type)
      if (!entry) continue
      if (titleOf(entry) !== meta.title) drift.push(`${type}: core="${meta.title}" registry="${titleOf(entry)}"`)
    }
    expect(drift).toEqual([])
  })

  it('每个类型都有卡可渲染：注册表条目必须挂 component', () => {
    for (const [type, entry] of entries) {
      expect(entry, type).toMatch(/component:\s*[A-Z]\w*Widget/)
    }
  })
})

describe('findUnknownWorkspaceWidgetTypes：格式合法但渲染不出来的模块类型要被抓出来', () => {
  it('清单里的模块类型都不存在时逐个点名，重复的只报一次', () => {
    const manifest = {
      manifestVersion: 1,
      kind: 'workspace-preset',
      name: '坏预设',
      version: '1.0.0',
      payload: {
        boards: [
          {
            name: 'b',
            widgets: [
              { type: 'clock', colSpan: 4, rowSpan: 1 },
              { type: 'notes', colSpan: 4, rowSpan: 1 },
              { type: 'clock', colSpan: 4, rowSpan: 1 },
            ],
          },
        ],
      },
    }
    const res = validatePluginManifestWithCatalog(manifest)
    expect(res.ok).toBe(false)
    if (res.ok) return
    const detail = res.errors.find((e) => e.includes('没有对应卡片')) ?? ''
    // 「非法类型」与「合法清单」两段分开断言：合法清单里本来就含 clock-pomodoro，
    // 整串去搜 clock 会恒真，测不出任何东西。
    const [unknownPart, legalPart] = detail.split('。合法类型：')
    expect(unknownPart).toContain('clock')
    expect(unknownPart).toContain('notes')
    expect(unknownPart.match(/clock/g)?.length).toBe(1)
    expect(legalPart).toContain('clock-pomodoro')
  })

  it('合法类型（目录里全部 16 个模块）一律放行', () => {
    const manifest = {
      manifestVersion: 1,
      kind: 'workspace-preset',
      name: '好预设',
      version: '1.0.0',
      payload: {
        boards: [
          {
            name: 'b',
            widgets: WIDGET_TYPE_NAMES.map((type) => ({ type, colSpan: 3, rowSpan: 1, config: {} })),
          },
        ],
      },
    }
    const res = validatePluginManifestWithCatalog(manifest)
    if (!res.ok) throw new Error(res.errors.join('; '))
    expect(res.manifest.kind).toBe('workspace-preset')
  })

  it('core 校验已经失败时，目录错误并进原有错误一起返回', () => {
    const res = validatePluginManifestWithCatalog({
      manifestVersion: 1,
      kind: 'workspace-preset',
      name: '缺版本',
      payload: { boards: [{ name: 'b', widgets: [{ type: 'weather', colSpan: 3, rowSpan: 1 }] }] },
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.errors.some((e) => !e.includes('没有对应卡片'))).toBe(true)
    expect(res.errors.some((e) => e.includes('weather'))).toBe(true)
  })

  it('非工作台预设的载荷不做目录核对（site-pack 不该被模块清单管）', () => {
    expect(
      findUnknownWorkspaceWidgetTypes({
        kind: 'site-pack',
        payload: { sites: [{ url: 'https://example.com', title: 'x' }] },
      }),
    ).toEqual([])
    for (const dirty of [null, undefined, 'x', 42, {}, { payload: {} }, { payload: { boards: 'nope' } }]) {
      expect(findUnknownWorkspaceWidgetTypes(dirty)).toEqual([])
    }
  })

  it('boards 里缺 widgets / 类型为非字符串时跳过而不是崩', () => {
    expect(
      findUnknownWorkspaceWidgetTypes({
        payload: { boards: [{ name: 'a' }, { name: 'b', widgets: [] }, { name: 'c', widgets: [{ type: 1 }, null, 'junk'] }] },
      }),
    ).toEqual([])
  })
})
