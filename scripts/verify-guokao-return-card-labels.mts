/**
 * C1 14 点只读验证脚本之二：标签 + 源码守卫核对（verify-labels）。
 *
 * 2026-11-23 10:22 轮重建：0822-W3 的 /tmp/verify-labels.mts 已随机器重启
 * 丢失，本文件按 0822-W3 §3 的方法重写，落盘进克隆（不再只放 /tmp）。
 *
 * 用法（克隆根目录）：node scripts/verify-guokao-return-card-labels.mts
 * 只读：不写任何克隆文件，不跑构建/测试。
 *
 * 注意：组件文件 import 了 next/link、lucide-react 与 @/ 别名，在 /tmp 或
 * node 直跑下无法解析，故本脚本把组件内 guokaoReturnCardContent 函数体
 * 逐字复制到这里验证（下方 COPY 区与组件文件保持逐字一致，改一处须同步
 * 改另一处）；正式断言在 vitest 文件里直接 import 组件实名导出重跑。
 * #13/#14/C-G5/C-G6 是对组件源码的守卫检查。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  EXAMS,
  daysUntil,
  firstExamDay,
  guokaoAdmissionPhase,
  shanghaiMidnightMs,
} from '../apps/web-overlay/src/lib/exam-calendar.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const COMPONENT = resolve(
  HERE,
  '..',
  'apps/web-overlay/src/components/guokao-checklist-return-card.tsx',
)
const src = readFileSync(COMPONENT, 'utf8')
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|\s)\/\/.*$/gm, '$1')

// ---- COPY 区开始：与组件文件内 guokaoReturnCardContent 逐字一致 ----
type GuokaoReturnCardContent =
  | { phase: 'open' | 'last-call'; title: string; label: string }
  | null

const LAST_CALL_TITLE = '末班提醒：准考证打印 11 月 29 日 15:00 截止'

function guokaoReturnCardContent(nowMs: number): GuokaoReturnCardContent {
  const phase = guokaoAdmissionPhase(nowMs)
  if (phase !== 'open' && phase !== 'last-call') return null
  const guokao = EXAMS.find((exam) => exam.id === 'guokao')
  if (!guokao) return null
  const d = daysUntil(firstExamDay(guokao), nowMs)
  if (d > 0 && phase === 'open') {
    return { phase, title: '准考证打印已开放', label: `距国考 ${d} 天` }
  }
  if (d > 0) {
    return { phase, title: LAST_CALL_TITLE, label: guokao.eveLabel ?? `明天${guokao.shortName}` }
  }
  if (d === 0) {
    return { phase, title: LAST_CALL_TITLE, label: guokao.firstDayLabel ?? `今天${guokao.shortName}` }
  }
  return { phase, title: LAST_CALL_TITLE, label: '今天笔试' }
}
// ---- COPY 区结束 ----

const at = (date: string, h = 0, m = 0, s = 0) =>
  shanghaiMidnightMs(date) + ((h * 60 + m) * 60 + s) * 1000

let pass = 0
let total = 0
const check = (label: string, ok: boolean, detail = '') => {
  total++
  if (ok) pass++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
}

// #1–#12 标签 / 渲染
const labelCases: Array<[string, number, { phase: string; title: string; label: string } | null]> = [
  ['11-22 23:59', at('2026-11-22', 23, 59), null],
  ['11-23 00:00', at('2026-11-23', 0, 0), { phase: 'open', title: '准考证打印已开放', label: '距国考 5 天' }],
  ['11-23 12:00', at('2026-11-23', 12, 0), { phase: 'open', title: '准考证打印已开放', label: '距国考 5 天' }],
  ['11-26 23:59', at('2026-11-26', 23, 59), { phase: 'open', title: '准考证打印已开放', label: '距国考 2 天' }],
  ['11-27 00:00', at('2026-11-27', 0, 0), { phase: 'last-call', title: LAST_CALL_TITLE, label: '明天国考（专业科目先考 11 月 28 日）' }],
  ['11-28 13:59', at('2026-11-28', 13, 59), { phase: 'last-call', title: LAST_CALL_TITLE, label: '今天国考 · 专业科目 14:00 开考' }],
  ['11-28 14:00', at('2026-11-28', 14, 0), { phase: 'last-call', title: LAST_CALL_TITLE, label: '今天国考 · 专业科目 14:00 开考' }],
  ['11-29 08:59', at('2026-11-29', 8, 59), { phase: 'last-call', title: LAST_CALL_TITLE, label: '今天笔试' }],
  ['11-29 14:59', at('2026-11-29', 14, 59), { phase: 'last-call', title: LAST_CALL_TITLE, label: '今天笔试' }],
  ['11-29 15:00', at('2026-11-29', 15, 0), null],
  ['11-29 15:00:01', at('2026-11-29', 15, 0, 1), null],
  ['11-30 00:00', at('2026-11-30', 0, 0), null],
]
for (const [label, now, want] of labelCases) {
  const got = guokaoReturnCardContent(now)
  check(
    `#标签 ${label}`,
    JSON.stringify(got) === JSON.stringify(want),
    `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`,
  )
}
// #5 补充：不出现「距国考 1 天」
check('#5 不出现「距国考 1 天」', guokaoReturnCardContent(at('2026-11-27', 0, 0))!.label !== '距国考 1 天')
// #8/#9 补充：标签不含数字与「天」
for (const now of [at('2026-11-29', 8, 59), at('2026-11-29', 14, 59)]) {
  const label = guokaoReturnCardContent(now)!.label
  // 禁令是不出现 0 天/负数（数字或「距…天」），不是禁「天」字本身——「今天笔试」含「天」是合法的
  check('#8/#9 标签无数字无距天', !/[0-9]/.test(label) && !label.includes('距'), label)
}

// #13：CTA href + 记录口径（源码守卫）
check('#13 CTA href 写死', src.includes('href="/exam/guokao-checklist"'))
check('#13 同页跳无 target', !code.includes('target="_blank"'))
check('#13 CTA 文案复用', src.includes('打印前清单：三件事先勾好 →'))
check('#13 recordOfflineVisit 合成 id', code.includes("id: 'in-site:guokao-checklist'"))
check('#13 不调 reportClick', !code.includes('reportClick'))

// #14 + C-G4：禁写死
check('#14 无写死天数', !/距国考 [0-9]+ 天/.test(code) && !/还有 [0-9]+ 天/.test(code))
check('#14 唯一合法模板恰一处', (code.match(/`距国考 \$\{d\} 天`/g) ?? []).length === 1)
check('#14 门控只认 guokaoAdmissionPhase', code.includes('guokaoAdmissionPhase(nowMs)'))
check('#14 无日期字面量门控', !code.includes("'2026-11-") && !code.includes('"2026-11-'))

// C-G5 / C-G6 / 岛接线
check('C-G5 不含查分', !code.includes('查分'))
check('C-G6 文案块 basis-full', code.includes('<div className="min-w-0 flex-1 basis-full sm:basis-0">'))
check('C-G6 CTA min-h-11', code.includes('min-h-11'))
check('C-G6 小字仅徽章一处', (code.match(/text-xs/g) ?? []).length === 1)
check('岛接线 useState null', code.includes('useState<number | null>(null)'))
check('岛接线 60 秒 tick', code.includes('setInterval(() => setNow(Date.now()), 60_000)'))
check('岛接线 clearInterval', code.includes('clearInterval(timer)'))

console.log(`\n${pass}/${total} 通过`)
if (pass !== total) process.exit(1)
