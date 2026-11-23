/**
 * C1 14 点只读验证脚本之一：日期点核对（verify-points）。
 *
 * 2026-11-23 10:22 轮重建：0822-W3 的 /tmp/verify-points.mts 已随机器重启
 * 丢失，本文件按 0822-W3 §3 的方法重写，落盘进克隆（不再只放 /tmp）。
 *
 * 用法（克隆根目录）：node scripts/verify-guokao-return-card-points.mts
 * 只读：直接 import 仓库真实 apps/web-overlay/src/lib/exam-calendar.ts
 * （该文件零 import，Node 24 类型剥离可直接跑），核对 0422-W3 §3.4
 * #1–#12 的 phase / d；不写任何克隆文件，不跑构建/测试。
 */
import {
  EXAMS,
  daysUntil,
  firstExamDay,
  guokaoAdmissionPhase,
  shanghaiMidnightMs,
} from '../apps/web-overlay/src/lib/exam-calendar.ts'

const guokao = EXAMS.find((exam) => exam.id === 'guokao')!
const at = (date: string, h = 0, m = 0, s = 0) =>
  shanghaiMidnightMs(date) + ((h * 60 + m) * 60 + s) * 1000

const cases: Array<[string, number, string, number]> = [
  ['11-22 23:59', at('2026-11-22', 23, 59), 'warmup', 6],
  ['11-23 00:00', at('2026-11-23', 0, 0), 'open', 5],
  ['11-23 12:00', at('2026-11-23', 12, 0), 'open', 5],
  ['11-26 23:59', at('2026-11-26', 23, 59), 'open', 2],
  ['11-27 00:00', at('2026-11-27', 0, 0), 'last-call', 1],
  ['11-28 13:59', at('2026-11-28', 13, 59), 'last-call', 0],
  ['11-28 14:00', at('2026-11-28', 14, 0), 'last-call', 0],
  ['11-29 08:59', at('2026-11-29', 8, 59), 'last-call', -1],
  ['11-29 14:59', at('2026-11-29', 14, 59), 'last-call', -1],
  ['11-29 15:00', at('2026-11-29', 15, 0), 'null', -1],
  ['11-29 15:00:01', at('2026-11-29', 15, 0, 1), 'null', -1],
  ['11-30 00:00', at('2026-11-30', 0, 0), 'null', -2],
]

let pass = 0
for (const [label, now, wantPhase, wantD] of cases) {
  const phase = guokaoAdmissionPhase(now) ?? 'null'
  const d = daysUntil(firstExamDay(guokao), now)
  const ok = phase === wantPhase && d === wantD
  if (ok) pass++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: phase=${phase} (want ${wantPhase}), d=${d} (want ${wantD})`)
}
console.log(`\n${pass}/12 通过`)
if (pass !== 12) process.exit(1)
