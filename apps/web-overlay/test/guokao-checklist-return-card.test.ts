/**
 * C1 国考准考证打印回访卡单测（2026-11-23 10:22 轮重建）。
 *
 * 定稿依据：evolution-round-2026-11-23-0422-w3.md（§3.4 的 14 个日期点、
 * §4 的 C-G1–C-G7）；重建依据：0822-W3 §3/§4——0822 轮 /tmp 测试草稿
 * （10,138 字节、15 个 it）已随机器重启丢失，本文件按笔记重新著码，
 * 14 个点的期望值与 0822-W3 §3 表逐项一致。
 *
 * 新文件，不并入 exam-guokao-checklist-u285.test.ts（理由见 0822-W3 §1，
 * 待 W7 复审确认）。
 *
 * 落盘路径：apps/web-overlay/test/guokao-checklist-return-card.test.ts
 * （事实源）；跑之前先 pnpm mirror:web 同步到 apps/web/test/，
 * 再 pnpm vitest run apps/web/test/guokao-checklist-return-card.test.ts。
 * @/ 别名指向 apps/web/src（vendored 镜像），overlay 里直接跑会解析失败。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import {
  EXAMS,
  daysUntil,
  firstExamDay,
  guokaoAdmissionPhase,
  shanghaiMidnightMs,
} from '@/lib/exam-calendar'
import {
  GuokaoChecklistReturnCard,
  guokaoReturnCardContent,
} from '@/components/guokao-checklist-return-card'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..', '..')
const OVERLAY_ROOT = resolve(REPO_ROOT, 'apps', 'web-overlay')

const guokao = EXAMS.find((exam) => exam.id === 'guokao')!

/** 北京时间某日某时某分某秒（毫秒），沿用既有测试模式 */
const at = (date: string, h = 0, m = 0, s = 0) =>
  shanghaiMidnightMs(date) + ((h * 60 + m) * 60 + s) * 1000

/** 组件源码（去注释后做字面量守卫；overlay 事实源一份） */
const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
const componentSrc = readFileSync(
  resolve(OVERLAY_ROOT, 'src/components/guokao-checklist-return-card.tsx'),
  'utf8',
)
const componentCode = stripComments(componentSrc)

describe('C1 国考准考证打印回访卡（0422-W3 §3.4）', () => {
  it('#1–#12：phase / d 全量交叉核对（事实源 exam-calendar.ts）', () => {
    const cases: Array<[number, string, number]> = [
      [at('2026-11-22', 23, 59), 'warmup', 6],
      [at('2026-11-23', 0, 0), 'open', 5],
      [at('2026-11-23', 12, 0), 'open', 5],
      [at('2026-11-26', 23, 59), 'open', 2],
      [at('2026-11-27', 0, 0), 'last-call', 1],
      [at('2026-11-28', 13, 59), 'last-call', 0],
      [at('2026-11-28', 14, 0), 'last-call', 0],
      [at('2026-11-29', 8, 59), 'last-call', -1],
      [at('2026-11-29', 14, 59), 'last-call', -1],
      [at('2026-11-29', 15, 0), 'null', -1],
      [at('2026-11-29', 15, 0, 1), 'null', -1],
      [at('2026-11-30', 0, 0), 'null', -2],
    ]
    for (const [now, phase, d] of cases) {
      expect(guokaoAdmissionPhase(now) ?? 'null', new Date(now).toISOString()).toBe(phase)
      expect(daysUntil(firstExamDay(guokao), now), new Date(now).toISOString()).toBe(d)
    }
  })

  it('#1：11-22 23:59 warmup，不渲染', () => {
    expect(guokaoReturnCardContent(at('2026-11-22', 23, 59))).toBeNull()
  })

  it('#2/#3：11-23 open，日内不翻天——「距国考 5 天」+「准考证打印已开放」', () => {
    for (const now of [at('2026-11-23', 0, 0), at('2026-11-23', 12, 0)]) {
      expect(guokaoReturnCardContent(now)).toEqual({
        phase: 'open',
        title: '准考证打印已开放',
        label: '距国考 5 天',
      })
    }
  })

  it('#4：11-26 23:59 open，「距国考 2 天」', () => {
    expect(guokaoReturnCardContent(at('2026-11-26', 23, 59))).toEqual({
      phase: 'open',
      title: '准考证打印已开放',
      label: '距国考 2 天',
    })
  })

  it('#5：11-27 00:00 last-call，标题切「末班提醒」，标签为 eveLabel 全句，不出现「距国考 1 天」', () => {
    const content = guokaoReturnCardContent(at('2026-11-27', 0, 0))
    expect(content).toEqual({
      phase: 'last-call',
      title: '末班提醒：准考证打印 11 月 29 日 15:00 截止',
      label: '明天国考（专业科目先考 11 月 28 日）',
    })
    expect(content!.label).not.toContain('距国考 1 天')
  })

  it('#6/#7：11-28 last-call，标签为 firstDayLabel，不显示天数（开考时刻标签不变）', () => {
    for (const now of [at('2026-11-28', 13, 59), at('2026-11-28', 14, 0)]) {
      expect(guokaoReturnCardContent(now)).toEqual({
        phase: 'last-call',
        title: '末班提醒：准考证打印 11 月 29 日 15:00 截止',
        label: '今天国考 · 专业科目 14:00 开考',
      })
    }
  })

  it('#8/#9：11-29 last-call，标签「今天笔试」，不出现 0 天/负数', () => {
    for (const now of [at('2026-11-29', 8, 59), at('2026-11-29', 14, 59)]) {
      const content = guokaoReturnCardContent(now)
      expect(content).toEqual({
        phase: 'last-call',
        title: '末班提醒：准考证打印 11 月 29 日 15:00 截止',
        label: '今天笔试',
      })
      expect(content!.label).not.toMatch(/[0-9]/)
      // 禁令是不出现 0 天/负数（数字或「距…天」），不是禁「天」字本身——「今天笔试」含「天」是合法的
      expect(content!.label).not.toContain('距')
    }
  })

  it('#10/#11/#12：11-29 15:00（含整点）、15:00:01、11-30 00:00，整卡消失', () => {
    for (const now of [at('2026-11-29', 15, 0), at('2026-11-29', 15, 0, 1), at('2026-11-30', 0, 0)]) {
      expect(guokaoReturnCardContent(now)).toBeNull()
    }
  })

  it('#13：CTA href 写死 /exam/guokao-checklist，同页跳（无 target="_blank"）', () => {
    expect(componentCode).toContain('href="/exam/guokao-checklist"')
    expect(componentCode).not.toContain('target="_blank"')
    expect(componentCode).toContain('打印前清单：三件事先勾好 →')
  })

  it('#13：点击只调 recordOfflineVisit（合成 id 四字段），不调 reportClick', () => {
    expect(componentCode).toContain("recordOfflineVisit({")
    expect(componentCode).toContain("id: 'in-site:guokao-checklist'")
    expect(componentCode).toContain("title: '国考准考证打印前清单'")
    expect(componentCode).toContain("href: '/exam/guokao-checklist'")
    expect(componentCode).toContain('icon: null')
    expect(componentCode).not.toContain('reportClick')
  })

  it('#14 + C-G4：零写死——无写死天数字面量，唯一合法模板恰一处；门控只认 guokaoAdmissionPhase()', () => {
    expect(componentCode).not.toMatch(/距国考 [0-9]+ 天/)
    expect(componentCode).not.toMatch(/还有 [0-9]+ 天/)
    expect(componentCode.match(/`距国考 \$\{d\} 天`/g) ?? []).toHaveLength(1)
    expect(componentCode).toContain('guokaoAdmissionPhase(nowMs)')
    // 门控不得另写日期字面量：组件内不出现 11-23 / 11-27 / 11-29 日期字面量
    expect(componentCode).not.toContain("'2026-11-")
    expect(componentCode).not.toContain('"2026-11-')
  })

  it('岛接线：挂载前渲染 null（renderToString 不跑 useEffect），60 秒 tick + 清理', () => {
    expect(renderToString(createElement(GuokaoChecklistReturnCard))).toBe('')
    expect(componentCode).toContain('useState<number | null>(null)')
    expect(componentCode).toContain('setInterval(() => setNow(Date.now()), 60_000)')
    expect(componentCode).toContain('clearInterval(timer)')
    expect(componentCode).toContain('if (now === null) return null')
  })

  it('C-G6：390px 可读可点——文案块 basis-full sm:basis-0，CTA min-h-11，正文一律 text-sm，小字仅徽章一处', () => {
    expect(componentCode).toContain('<div className="min-w-0 flex-1 basis-full sm:basis-0">')
    expect(componentCode).toContain('min-h-11')
    expect(componentCode).toContain('<p className="text-sm font-semibold text-foreground">')
    expect(componentCode).toContain('<p className="mt-0.5 text-sm text-muted-foreground">')
    // C-G6 的禁令只限卡片正文：徽章沿用条带同款小字，去注释后源码中小字只出现 1 次（徽章 pill）
    expect(componentCode.match(/text-xs/g) ?? []).toHaveLength(1)
  })

  it('C-G7：单落点——仅首页 navigation-content.tsx 一处挂载，/brief 与 AnnouncementBar 不渲染（2026-11-23 11:22 轮挂载落地后启用）', () => {
    // 挂载已落地（navigation-content.tsx，HomeSubtitleHint 之后、C4 卡之上）；本 it 在挂载落地后取消 skip。
    for (const root of [resolve(REPO_ROOT, 'apps', 'web'), OVERLAY_ROOT]) {
      const nav = readFileSync(resolve(root, 'src/components/navigation-content.tsx'), 'utf8')
      expect(nav.match(/<GuokaoReturnCardContent/g) ?? []).toHaveLength(1)
      const brief = readFileSync(resolve(root, 'src/app/brief/page.tsx'), 'utf8')
      expect(brief).not.toContain('GuokaoChecklistReturnCard')
      expect(brief).not.toContain('guokao-checklist-return-card')
      expect(brief).not.toContain('国考准考证打印前清单')
      const layout = readFileSync(resolve(root, 'src/app/layout.tsx'), 'utf8')
      expect(layout).not.toContain('GuokaoChecklistReturnCard')
      expect(layout).not.toContain('guokao-checklist-return-card')
    }
  })

  it('C-G5：不编查分日期——卡片源码不含「查分」', () => {
    expect(componentCode).not.toContain('查分')
  })
})
