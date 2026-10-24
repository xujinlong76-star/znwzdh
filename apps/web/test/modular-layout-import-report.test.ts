/**
 * F4 档 3：工作台导入/安装的台账必须真算得出来，也必须被界面说出来。
 *
 * 改之前（apps/web-overlay/src/lib/modular/use-modular-layout.ts + modular-canvas.tsx）：
 *   1. `importLayoutJson` 返回 boolean。净化会剔掉下线的模块类型，整块被剔空的看板也会被
 *      丢掉，这些都不在布尔值里 → 调用方只能写「工作台配置已成功还原！」：6 个看板 40 个模块
 *      的备份，回来只剩 2 个看板，界面还是绿的；
 *   2. `installWidgetPreset` 同样只回 boolean，而且 `b.widgets` / `w.type` 没有类型守卫，
 *      远端订阅源的清单里出现 `null` 条目会直接抛 TypeError（manifest payload 是外部输入）；
 *      AI 生成布局那条路更糟：连返回值都没读，无论如何都报「已成功套用」；
 *   3. 浮层写死 emerald 配色，失败与告警也是绿色。
 *
 * 现在台账是纯函数（`layout-import-plan.ts`），本文件先用真实 JSON 跑它的不变式，
 * 再钉住接线：措辞、配色、`formatLayoutReport` 必须真的被三个调用点用上——
 * 闸门代码不许没人调用。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { sanitizeWidgetInstances, sanitizeWidgetInstancesWithReport } from '@/lib/modular/sanitize'
import { planLayoutImport, planPresetInstall } from '@/lib/modular/layout-import-plan'
import { formatLayoutReport } from '@/lib/modular/layout-report'

const HERE = dirname(fileURLToPath(import.meta.url))

function existsRead(p: string): boolean {
  try {
    readFileSync(p)
    return true
  } catch {
    return false
  }
}

/** overlay 真相文件（镜像 apps/web/** 由门禁保持同步，这里优先读 overlay） */
function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsRead(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

function codeOnly(source: string): string {

  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}
/** 详情页家族联合源（A3.1 拆分后守卫锁整个特性，不单壳文件） */
function detailFamily(): string {
  const parts = [overlayFile('src/app/marketplace/[slug]/plugin-detail-view.tsx')]
  for (const extra of ['detail-tab-panels.tsx', 'detail-modals.tsx']) {
    try { parts.push(overlayFile(`src/app/marketplace/[slug]/${extra}`)) } catch { /* 拆分前不存在则忽略 */ }
  }
  return parts.join(String.fromCharCode(10))
}


const KNOWN_TYPES = ['clock', 'weather']
const isKnownType = (type: string) => KNOWN_TYPES.includes(type)

function widget(type: string, id: string) {
  return { id, type, colSpan: 4, rowSpan: 1, config: {}, createdAt: 1 }
}

/** 台账的加法必须闭合，否则「另有 N 个未导入」本身就是假话 */
function expectLedgerBalances(report: { declaredBoards: number; importedBoards: number; emptiedBoards: number; invalidBoards: number }) {
  expect(report.declaredBoards).toBe(report.importedBoards + report.emptiedBoards + report.invalidBoards)
  expect(report.importedBoards >= 0 && report.emptiedBoards >= 0 && report.invalidBoards >= 0).toBe(true)
}

describe('净化台账：剔掉了多少、为什么剔', () => {
  it('条数守恒：items + dropped === total，dropped === 三类之和', () => {
    const list = [widget('clock', 'a'), null, 42, { id: 'b' }, { id: 'c', type: 7 }, widget('ghost', 'd')]
    const r = sanitizeWidgetInstancesWithReport(list, isKnownType)
    expect(r.total).toBe(6)
    expect(r.items).toHaveLength(1)
    expect(r.dropped).toBe(5)
    expect(r.droppedByKind).toEqual({ malformed: 2, missingType: 2, unknownType: 1 })
    expect(r.dropped).toBe(r.droppedByKind.malformed + r.droppedByKind.missingType + r.droppedByKind.unknownType)
    expect(r.dropped).toBe(r.total - r.items.length)
  })

  it('unknownTypes 只收「类型确实是个字符串但查不到」的名字，且去重限量', () => {
    const many = Array.from({ length: 20 }, (_, i) => widget(`ghost-${i % 10}`, `w${i}`))
    const r = sanitizeWidgetInstancesWithReport(many, isKnownType)
    expect(r.droppedByKind.unknownType).toBe(20)
    expect(r.unknownTypes).toHaveLength(6)
    expect(new Set(r.unknownTypes).size).toBe(6)
    expect(r.unknownTypes).not.toContain('')
    // 缺 type / 非对象不进 unknownTypes：界面要说的是「哪几类模块下线了」
    const noise = sanitizeWidgetInstancesWithReport([null, { id: 'x' }, { id: 'y', type: 9 }], isKnownType)
    expect(noise.unknownTypes).toEqual([])
    expect(noise.dropped).toBe(3)
  })

  it('老 API 的行为与净化结果逐条一致（委托不能改判定）', () => {
    const cases: unknown[] = [
      null,
      'not-array',
      {},
      [],
      [widget('clock', 'a'), widget('ghost', 'b'), null],
      [{ id: 'x' }, { id: 'y', type: 9 }],
    ]
    for (const list of cases) {
      expect(sanitizeWidgetInstances(list, isKnownType)).toEqual(sanitizeWidgetInstancesWithReport(list, isKnownType).items)
    }
  })
})

describe('planLayoutImport：导入台账逐项算清', () => {
  it('干净备份：全部看板落地，台账全零', () => {
    const json = JSON.stringify({
      version: 2,
      activeBoardId: 'b2',
      boards: [
        { id: 'b1', name: '看板一', widgets: [widget('clock', 'a')] },
        { id: 'b2', name: '看板二', widgets: [widget('clock', 'b'), widget('weather', 'c')] },
      ],
    })
    const plan = planLayoutImport(json, isKnownType)
    expectLedgerBalances(plan.report)
    expect(plan.report).toMatchObject({ ok: true, declaredBoards: 2, importedBoards: 2, importedWidgets: 3, droppedWidgets: 0, emptiedBoards: 0, invalidBoards: 0 })
    expect(plan.mode).toBe('replace')
    expect(plan.activeBoardId).toBe('b2')
    expect(plan.boards.map((b) => b.name)).toEqual(['看板一', '看板二'])
  })

  it('混合脏数据：坏看板项、被剔空的看板、下线的模块各记各的账', () => {
    const json = JSON.stringify({
      boards: [
        { id: 'ok-1', name: '留下', widgets: [widget('clock', 'a'), widget('ghost', 'b')] },
        null,
        'junk',
        { id: 'dead', name: '全是下线模块', widgets: [widget('ghost', 'c'), widget('retired', 'd')] },
        { id: 'ok-2', name: '也留下', widgets: [widget('weather', 'e')] },
      ],
    })
    const plan = planLayoutImport(json, isKnownType)
    expectLedgerBalances(plan.report)
    expect(plan.report).toMatchObject({
      ok: true,
      declaredBoards: 5,
      importedBoards: 2,
      importedWidgets: 2,
      invalidBoards: 2,
      emptiedBoards: 1,
      droppedWidgets: 3,
    })
    expect(plan.report.unknownTypes).toEqual(expect.arrayContaining(['ghost', 'retired']))
    expect(plan.boards.map((b) => b.widgets.map((w) => w.type))).toEqual([['clock'], ['weather']])
  })

  it('全军覆没时 ok=false 且不给看板：画布必须保持原样', () => {
    const plan = planLayoutImport(JSON.stringify({ boards: [{ id: 'x', widgets: [widget('ghost', 'a')] }] }), isKnownType)
    expectLedgerBalances(plan.report)
    expect(plan.report.ok).toBe(false)
    expect(plan.boards).toEqual([])
    expect(plan.report.reason).toContain('下线')
  })

  it('文件里一个模块都没有时，不许报成「有 N 个模块不支持」', () => {
    const text = formatLayoutReport(planLayoutImport(JSON.stringify({ boards: [{ id: 'x', widgets: [] }] }), isKnownType).report, '工作台配置')
    expect(text.tone).toBe('warn')
    expect(text.text).toContain('本来就没有模块')
    expect(text.text).not.toContain('不支持')
  })

  it('旧单看板格式走 append，并且不覆盖现有看板', () => {
    const plan = planLayoutImport(JSON.stringify({ widgets: [widget('clock', 'a'), widget('ghost', 'b')] }), isKnownType)
    expectLedgerBalances(plan.report)
    expect(plan.mode).toBe('append')
    expect(plan.report).toMatchObject({ ok: true, legacySingleBoard: true, importedBoards: 1, importedWidgets: 1, droppedWidgets: 1 })
    expect(plan.boards).toHaveLength(1)
    expect(plan.activeBoardId).toBeNull()
  })

  it('声明的 activeBoardId 不在结果里时退回第一个看板，不留野指针', () => {
    const plan = planLayoutImport(JSON.stringify({ activeBoardId: 'missing', boards: [{ id: 'real', widgets: [widget('clock', 'a')] }] }), isKnownType)
    expect(plan.activeBoardId).toBe('real')
  })

  it('各种认不出来的输入都给原因，不给静默 false', () => {
    const cases: Array<[string, string]> = [
      ['{not json', '合法的 JSON'],
      ['null', '配置对象'],
      ['[1,2]', '配置对象'],
      ['"just a string"', '配置对象'],
      ['{"foo":1}', '既没有 boards 也没有 widgets'],
      ['{"boards":[]}', '既没有 boards 也没有 widgets'],
    ]
    for (const [json, needle] of cases) {
      const plan = planLayoutImport(json, isKnownType)
      expect(plan.report.ok, json).toBe(false)
      expect(plan.boards, json).toEqual([])
      expect(plan.report.reason ?? '', json).toContain(needle)
    }
  })

  it('非对象看板项与 widgets 不是数组都不能抛（远端清单什么都可能给）', () => {
    expect(() =>
      planLayoutImport(JSON.stringify({ boards: [null, 1, 'x', { id: 'a', widgets: 'nope' }, { id: 'b', widgets: [null, widget('clock', 'w')] }] }), isKnownType),
    ).not.toThrow()
    const plan = planLayoutImport(JSON.stringify({ boards: [null, 1, 'x', { id: 'a', widgets: 'nope' }, { id: 'b', widgets: [null, widget('clock', 'w')] }] }), isKnownType)
    expectLedgerBalances(plan.report)
    expect(plan.report).toMatchObject({ ok: true, importedBoards: 1, invalidBoards: 3, emptiedBoards: 1, droppedWidgets: 1 })
  })
})

describe('planPresetInstall：外部清单的台账与崩溃回归', () => {
  it('null 看板项与 null 模块条目都不再抛 TypeError', () => {
    // 这份 fixture 故意越出清单类型：远端 tap 的 JSON 就是会这么脏
    const preset = { boards: [null, { name: '坏条目', widgets: [null, undefined, 7] }, { name: '好', widgets: [widget('clock', 'a')] }] }
    expect(() => planPresetInstall(preset as never, isKnownType)).not.toThrow()
    const { report } = planPresetInstall(preset as never, isKnownType)
    expectLedgerBalances(report)
    expect(report).toMatchObject({ ok: true, declaredBoards: 3, importedBoards: 1, invalidBoards: 1, emptiedBoards: 1, droppedWidgets: 3 })
  })

  it('缺 type 归「缺 type」，不许伪装成「一个下线的模块类型」', () => {
    const { report } = planPresetInstall({ boards: [{ name: 'x', widgets: [{ id: 'a' }, { id: 'b', type: 9 }, widget('ghost', 'c')] }] }, isKnownType)
    expect(report.droppedWidgets).toBe(3)
    expect(report.unknownTypes).toEqual(['ghost'])
    expect(report.unknownTypes).not.toContain('')
  })

  it('空预设给原因，而不是返回一个看不懂的 false', () => {
    for (const preset of [undefined, null, {}, { boards: [] }, { boards: 'nope' }]) {
      const { report, boards } = planPresetInstall(preset as never, isKnownType)
      expect(report.ok).toBe(false)
      expect(boards).toEqual([])
      expect(report.reason).toContain('预设里没有看板数据')
    }
  })

  it('看板名缺省时给可读占位，且保留字段兜底', () => {
    const { boards } = planPresetInstall({ boards: [{ widgets: [{ id: 'a', type: 'clock' }] }] }, isKnownType)
    expect(boards[0]?.name).toBe('预设看板 1')
    expect(boards[0]?.widgets[0]).toMatchObject({ colSpan: 4, rowSpan: 1, config: {} })
  })
})

describe('formatLayoutReport：措辞只能照着台账说', () => {
  const plan = (json: string) => planLayoutImport(json, isKnownType).report

  it('零丢失才是唯一的绿色口径', () => {
    const clean = formatLayoutReport(plan(JSON.stringify({ boards: [{ id: 'a', widgets: [widget('clock', 'w')] }] })), '工作台配置')
    expect(clean.tone).toBe('ok')
    expect(clean.text).toBe('工作台配置：已导入 1 个看板（1 个模块）')
  })

  it('有丢失就降级成告警，并把少了多少写进同一句话', () => {
    const r = formatLayoutReport(
      plan(JSON.stringify({ boards: [{ id: 'a', widgets: [widget('clock', 'w'), widget('ghost', 'x')] }, { id: 'b', widgets: [widget('retired', 'y')] }] })),
      '工作台配置',
    )
    expect(r.tone).toBe('warn')
    expect(r.text).toContain('已导入 1 个看板')
    expect(r.text).toContain('2 个模块不支持')
    expect(r.text).toContain('1 个看板被剔空后没有保留')
    expect(r.text).toContain('未导入')
  })

  it('类型名最多展示 3 个，超出用「等」收尾', () => {
    const many = { boards: [{ id: 'a', widgets: ['g1', 'g2', 'g3', 'g4', 'g5'].map((t, i) => widget(t, `w${i}`)) }] }
    const r = formatLayoutReport(plan(JSON.stringify(many)), '工作台配置')
    expect(r.text).toContain('g1、g2、g3')
    expect(r.text).toContain(' 等）')
    expect(r.text).not.toContain('g4')
  })

  it('彻底失败要告诉用户画布没动，而不是含糊的「格式不对」', () => {
    expect(formatLayoutReport(plan('{bad'), '工作台配置').text).toBe('工作台配置：导入失败，文件不是合法的 JSON')
    const wiped = formatLayoutReport(plan(JSON.stringify({ boards: [{ id: 'a', widgets: [widget('ghost', 'w')] }] })), '工作台配置')
    expect(wiped.tone).toBe('warn')
    expect(wiped.text).toContain('导入失败')
    expect(wiped.text).toContain('画布保持原样')
  })

  it('不许出现无法验证的断言（成功还原 / 无损 / 全部）', () => {
    const fixtures = [
      JSON.stringify({ boards: [{ id: 'a', widgets: [widget('clock', 'w')] }] }),
      JSON.stringify({ boards: [{ id: 'a', widgets: [widget('clock', 'w'), widget('ghost', 'x')] }, null] }),
      JSON.stringify({ boards: [{ id: 'a', widgets: [] }] }),
      '{bad',
      JSON.stringify({ widgets: [widget('clock', 'w')] }),
    ]
    for (const json of fixtures) {
      const text = formatLayoutReport(plan(json), '工作台配置').text
      for (const banned of ['已成功还原', '成功还原', '无损', '全部', '完整恢复']) {
        expect(text, `${json} -> ${text}`).not.toContain(banned)
      }
    }
  })
})

describe('接线：台账必须真的被界面读出来', () => {
  const hook = codeOnly(overlayFile('src/lib/modular/use-modular-layout.ts'))
  const canvas = codeOnly(overlayFile('src/components/modular/modular-canvas.tsx'))
  const detail = codeOnly(detailFamily())

  it('hook 把 state 变更挡在 ok 之后（失败一律不动画布）', () => {
    expect(hook).toContain('const plan = planLayoutImport(jsonStr, (type) => Boolean(WIDGET_REGISTRY[type]))')
    expect(hook).toContain('if (!plan.report.ok) return plan.report')
    expect(hook).toContain('const plan = planPresetInstall(preset, (type) => Boolean(WIDGET_REGISTRY[type]))')
    expect(hook).toContain('if (!report.ok) return report')
    // 布尔返回值已经没了：任何一处退回 boolean 都会让调用方重新只能写「成功了」
    expect(hook).not.toMatch(/importLayoutJson[\s\S]{0,400}?return false/)
  })

  it('三条导入路径都过 formatLayoutReport（导入 JSON / 暂存预设 / AI 布局）', () => {
    expect(canvas).toContain("import { formatLayoutReport, type NoticeTone } from '@/lib/modular/layout-report'")
    expect(canvas).toContain("formatLayoutReport(importLayoutJson(text), '工作台配置')")
    expect(canvas).toContain('formatLayoutReport(report, `插件「${staged.name}」`)')
    expect(canvas).toContain("formatLayoutReport(report, `AI 规划「${layout.title || '工作台'}」`)")
    // 「可切换看板查看」只允许在真有看板时说
    expect(canvas).toContain('report.ok ? `${notice.text}，可切换看板查看` : notice.text')
  })

  it('谎报全量的旧文案已经清零', () => {
    for (const banned of ['工作台配置已成功还原', '已成功套用 AI 规划工作台', '全部工作台看板配置已导出', '消除了多余空间碎片']) {
      expect(canvas, banned).not.toContain(banned)
    }
    // 详情页以前连返回值都不读；现在走动态直装接缝，但台账仍必须被读出来
    expect(detail).toContain('const { report, persisted } = await installWidgetPresetDirect(preset, mode)')
    expect(detail).toContain('formatLayoutReport(report, `工作台预设「${plugin.name}」`)')
    expect(detail).toContain('toast.warning(notice.text)')
  })

  it('浮层配色跟着 tone 走，不再写死绿色', () => {
    expect(canvas).toContain("exportNotice.tone === 'warn'")
    expect(canvas).toContain('bg-amber-500/10')
    expect(canvas).toContain("role={exportNotice.tone === 'warn' ? 'alert' : 'status'}")
    // 定时器收进 ref：连续两次提示时前一条的 timeout 不能把后一条抹掉
    expect(canvas).toContain('if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)')
    expect(canvas).not.toMatch(/setExportNotice\([^)]*\)\s*\n\s*setTimeout\(\(\) => setExportNotice\(null\)/)
  })
})
