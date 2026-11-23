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
 *
 * 2026-11-23 12:22 轮追加（备选 Q4 + Q1）：C-G8 高度守卫与 C1+C4 双卡叠加
 * 首屏预算（见文件末尾）。只加测试，不改组件源码、不改数据文件。
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
import { guangdongZikaoSignupCardCopy } from '@/components/guangdong-zikao-signup-card'

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

/** C4 组件源码（双卡叠加测试用；overlay 事实源一份） */
const c4ComponentSrc = readFileSync(
  resolve(OVERLAY_ROOT, 'src/components/guangdong-zikao-signup-card.tsx'),
  'utf8',
)
const c4ComponentCode = stripComments(c4ComponentSrc)

/**
 * C-G8 / Q1 共用：字宽模型与 C1 高度预算（2026-11-23 12:22 轮）。
 *
 * 阈值依据：Tailwind text-sm = 14px 字号；CJK/全角/箭头字形 advance ≈ 1em
 * = 14px，ASCII/数字/半角 ≈ 8px（保守值，系统字数字 advance 约 7–8px，
 * 「·」实宽更窄也按 8px 计）。行高取 Tailwind 默认：text-sm 20px、
 * text-xs 16px；min-h-11 = 44px；py-3 = 24px；pt-3 = 12px；
 * gap-x-4/gap-y-2 = 16px/8px；border 2px；mt-0.5 = 2px。
 * 390px 视口内容宽 = 390 - section px-3×2 (24) - 卡体 px-4×2 (32) = 334px；
 * 桌面内容宽 = min(vw, 1600) - sm:px-5×2 (40) - sm:px-5×2 (40)。
 */
/** CJK/全角/箭头字形（advance ≈ 1em），其余半角字符按 8px 计 */
const isWideChar = (ch: string) => {
  const c = ch.codePointAt(0)!
  return (
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0x2190 && c <= 0x21ff) ||
    (c >= 0x20000 && c <= 0x3fffd)
  )
}
const estimateTextWidthPx = (s: string) =>
  [...s].reduce((sum, ch) => sum + (isWideChar(ch) ? 14 : 8), 0)

/** C1 各相位标题行（title + ' · ' + label）的字宽最大值，取自文案函数实算 */
const c1MaxTitleWidthPx = () => {
  const moments = [
    at('2026-11-23', 12, 0),
    at('2026-11-27', 0, 0),
    at('2026-11-28', 14, 0),
    at('2026-11-29', 8, 59),
  ]
  return Math.max(
    ...moments.map((now) => {
      const content = guokaoReturnCardContent(now)!
      return estimateTextWidthPx(`${content.title} · ${content.label}`)
    }),
  )
}

/**
 * C1 高度预算（px），从文案函数实算推导，不写死行数：
 *  - mobile390：三行叠放（徽章 26 + gap 8 + 文案块 + gap 8 + CTA 44）
 *    + 卡体 py-3 24 + border 2 + section pt-3 12；文案块 = 标题行数×20
 *    + mt-0.5 2 + 副行 1 行×20。
 *  - desktopTotals：桌面单行 flex，文案块宽 = 内容宽 - 徽章宽 - CTA 宽
 *    - gap-x-4×2；行高取 max(徽章 26, 文案块, CTA 44)。
 */
const c1HeightBudgetPx = () => {
  const maxTitleW = c1MaxTitleWidthPx()
  const titleLines390 = Math.ceil(maxTitleW / 334)
  const mobile390 =
    12 + (26 + 8 + (titleLines390 * 20 + 2 + 20) + 8 + 44) + 24 + 2
  const badgeW = estimateTextWidthPx('国考 · 准考证打印') + 14 + 6 + 20 + 2
  const ctaW = estimateTextWidthPx('打印前清单：三件事先勾好 →') + 28 + 4 + 2
  const desktopTotals: Record<number, number> = {}
  for (const vw of [640, 768, 1024, 1280, 1536, 1920]) {
    const textW = Math.min(vw, 1600) - 80 - badgeW - ctaW - 32
    const titleLines = Math.ceil(maxTitleW / textW)
    desktopTotals[vw] =
      12 + Math.max(26, titleLines * 20 + 2 + 20, 44) + 24 + 2
  }
  return { mobile390, desktopTotals, desktop1920: desktopTotals[1920] }
}

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

describe('C-G8 高度守卫：C1 卡片高度预算（2026-11-23 12:22 轮，备选 Q4）', () => {
  it('外壳/卡体/行结构定死：section pt-3 无上下 margin、卡体 py-3、flex 行 gap 定死', () => {
    expect(componentCode).toContain(
      'className="mx-auto w-full max-w-[1600px] px-3 pt-3 sm:px-5"',
    )
    expect(componentCode).not.toMatch(
      /className="mx-auto w-full max-w-\[1600px\][^"]*(mb-|mt-)/,
    )
    expect(componentCode).toContain(
      'className="rounded-2xl border bg-gradient-to-r from-card via-card to-card px-4 py-3 sm:px-5"',
    )
    expect(componentCode).toContain(
      'className="flex flex-wrap items-center gap-x-4 gap-y-2"',
    )
  })

  it('行数定死：文案块恰 2 个 text-sm <p>（标题行 + 副行），徽章 1 个、CTA 1 个、CTA min-h-11', () => {
    // 注意：副行 <p> 的 class 以 mt-0.5 开头（text-sm 在中间），故用 [^"]* 匹配；
    // 两个 <p> 都有 text-sm（标题行 text-sm 打头、副行 mt-0.5 text-sm）。
    expect(componentCode.match(/<p className="[^"]*text-sm/g) ?? []).toHaveLength(2)
    expect(componentCode.match(/<span className="inline-flex/g) ?? []).toHaveLength(1)
    expect(componentCode.match(/<Link/g) ?? []).toHaveLength(1)
    expect(componentCode).toContain('min-h-11')
  })

  it('标题行逐相位 ≤ 2 行（390px 内容宽 334px）：副行 1 行', () => {
    // 四个相位各取一个代表时刻（open / last-call 11-27 / 11-28 / 11-29），
    // 标题行 = title + ' · ' + label（组件内同一 <p> 渲染，见源码）。
    const moments = [
      at('2026-11-23', 12, 0),
      at('2026-11-27', 0, 0),
      at('2026-11-28', 14, 0),
      at('2026-11-29', 8, 59),
    ]
    for (const now of moments) {
      const content = guokaoReturnCardContent(now)!
      const titleLine = `${content.title} · ${content.label}`
      expect(estimateTextWidthPx(titleLine)).toBeLessThanOrEqual(2 * 334)
    }
    expect(componentCode).toContain('打印截止 11 月 29 日 15:00，逾期无法补打')
    expect(
      estimateTextWidthPx('打印截止 11 月 29 日 15:00，逾期无法补打'),
    ).toBeLessThanOrEqual(334)
  })

  it('高度预算 390px ≤ 186px（徽章 26 + gap 8 + 文案块 + gap 8 + CTA 44 + py-3 24 + border 2 + pt-3 12）', () => {
    // 文案块 = 标题行数×20 + mt-0.5 2 + 副行 1 行×20；行数由上一条的字宽实算钉死，
    // 文案变长超 2 行会先红在上一条、再红在这里（206px > 186px）。
    expect(c1HeightBudgetPx().mobile390).toBeLessThanOrEqual(186)
  })

  it('高度预算桌面 640–1920px：最坏 640px ≤ 160px，1920px ≤ 82px', () => {
    const { desktopTotals, desktop1920 } = c1HeightBudgetPx()
    expect(desktopTotals[640]).toBeLessThanOrEqual(160)
    expect(Math.max(...Object.values(desktopTotals))).toBeLessThanOrEqual(160)
    expect(desktop1920).toBeLessThanOrEqual(82)
  })
})

describe('C1+C4 双卡叠加首屏预算（2026-11-23 12:22 轮，备选 Q1）', () => {
  it('挂载顺序：C1 在上、C4 在下，均在 HomeSubtitleHint 之后、胶囊行之前，且在 viewMode 守卫内', () => {
    for (const root of [resolve(REPO_ROOT, 'apps', 'web'), OVERLAY_ROOT]) {
      const nav = readFileSync(resolve(root, 'src/components/navigation-content.tsx'), 'utf8')
      const c1At = nav.indexOf('<GuokaoReturnCardContent />')
      const c4At = nav.indexOf('<GuangdongZikaoSignupCardContent />')
      expect(c1At).toBeGreaterThan(-1)
      expect(c4At).toBeGreaterThan(-1)
      expect(c1At).toBeLessThan(c4At)
      expect(c1At).toBeGreaterThan(nav.indexOf('HomeSubtitleHint'))
      expect(c4At).toBeLessThan(nav.indexOf('<HomeCapsuleRow'))
      expect(nav).toContain(
        "{viewMode !== 'workbench' ? <GuokaoReturnCardContent /> : null}",
      )
      expect(nav).toContain(
        "{viewMode !== 'workbench' ? <GuangdongZikaoSignupCardContent /> : null}",
      )
    }
  })

  it('双卡外壳同款：C4 section 与 C1 同一套 class，无额外 margin，卡间只有各自 pt-3', () => {
    expect(c4ComponentCode).toContain(
      'className="mx-auto w-full max-w-[1600px] px-3 pt-3 sm:px-5"',
    )
    expect(c4ComponentCode).not.toMatch(
      /className="mx-auto w-full max-w-\[1600px\][^"]*(mb-|mt-)/,
    )
  })

  it('叠加预算 1920px ≤ 228px：C1 82 + C4 146（C4 五相位最多 5 行文案，行行 1 行）', () => {
    // C4 146px：逐相位 copy 实算——标题 1 + statusLines + subLines + 防仿冒 1，
    // 最多 5 行（P4 apply，2 行副行），行高 5×20 + 4×2 = 108px；
    // 1920px 下每行都 ≤ 文案宽（徽章/CTA 占位后余 1058px），不折行。
    const c4BadgeW = estimateTextWidthPx('广东自考 · 报名报考') + 14 + 6 + 20 + 2
    const c4MaxCtaW = Math.max(
      ...(
        ['signup', 'signup-last-call', 'apply', 'pay-last-call'] as const
      ).map((phase) => {
        const label = guangdongZikaoSignupCardCopy(phase).ctaLabel!
        return estimateTextWidthPx(label) + 28 + 4 + 2
      }),
    )
    const textW1920 = 1520 - c4BadgeW - c4MaxCtaW - 32
    let c4MaxLines = 0
    for (const phase of [
      'signup',
      'signup-last-call',
      'waiting',
      'apply',
      'pay-last-call',
    ] as const) {
      const copy = guangdongZikaoSignupCardCopy(phase)
      const lines = [copy.title, ...copy.statusLines, ...copy.subLines, copy.antiFraudLine]
      for (const line of lines) {
        expect(estimateTextWidthPx(line)).toBeLessThanOrEqual(textW1920)
      }
      c4MaxLines = Math.max(c4MaxLines, lines.length)
    }
    expect(c4MaxLines).toBe(5)
    const c4Total1920 =
      12 + Math.max(26, c4MaxLines * 20 + (c4MaxLines - 1) * 2, 44) + 24 + 2
    expect(c4Total1920).toBeLessThanOrEqual(146)
    expect(c1HeightBudgetPx().desktop1920 + c4Total1920).toBeLessThanOrEqual(228)
  })

  it('叠加预算 390px ≤ 406px：C1 186（C-G8 实算）+ C4 220（1022-W2 §5.6 设计预算）', () => {
    // C4 220px 是 1022-W2 §5.6 定稿的设计预算，C4-G6 已用行数代理钉死结构；
    // 像素实测待 live L1，见末尾 it.todo。C1 的 186 来自 C-G8 的逐相位实算。
    const C4_MOBILE_BUDGET_PX = 220
    expect(c1HeightBudgetPx().mobile390 + C4_MOBILE_BUDGET_PX).toBeLessThanOrEqual(406)
  })
})

describe('待补（live L1 实测，不在本文件断言范围）', () => {
  it.todo(
    'live L1：390px 各相位实测高度 ≤ 186px、1920px ≤ 82px、640px ≤ 160px（C-G8 预算值）；超预算回协调员，不许悄悄压字号凑数',
  )
  it.todo(
    'live L1：C1+C4 双卡叠加实测 ≤ 406px（390px）/ ≤ 228px（1920px），并重测首屏露出卡数/百分比，对照 b702e89 基线 41.7%/43.8%（@1920×911，C1/C4 挂载前）',
  )
})
