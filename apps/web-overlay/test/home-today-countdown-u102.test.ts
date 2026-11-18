/**
 * (c) U-102 今日行倒计时：失败测试先行（测试先行员 W6）。
 *
 * 既定格式（任务中途发现并行轮 W7 已落盘
 * `src/components/home-today-countdown.tsx`，基底 3ba09a48 时 git status
 * 干净，该文件是任务执行期间新出现的未跟踪文件；本文件以它为准，
 * 不另立冲突格式）：
 *  - 纯函数 `formatRemaining(targetMs, nowMs, endedLabel?)`
 *    （`src/components/home-today-countdown.tsx`，已存在，直接测它）：
 *      已过（diff <= 0）→ endedLabel，缺省「已截止」；
 *      不足 1 分钟 → 「剩不到 1 分」（带空格）；
 *      不足 1 小时 → 「剩X分」（X 向下取整，>= 1）；
 *      1 小时及以上 → 「剩X小时Y分」（X 向下取整，Y 为余分钟，可为 0，
 *      如「剩10小时0分」）。
 *  - 组件 `HomeTodayCountdown({ target, endedLabel?, hideWhenPassed? })`
 *    （同文件，已存在，`'use client'`）：target 为 ISO 字符串或 Date，
 *    无效值渲染 null；挂载前（nowMs === null）只渲染固定静态文案
 *    「倒计时」（role="timer"），挂载后 effect 取 Date.now() 并每 30 秒
 *    tick 一次重算。
 *  - 站内此前没有其他「剩X小时Y分」既定格式（/exam 倒计时岛用
 *    「距国考 N 天」天级文案；favorites-triage 用「还剩 X 小时/天」），
 *    故以 W7 已落盘的 formatRemaining 为准。
 *
 * 行为契约（以 2026-11-18 今日行 7 项为准）：
 *  - 倒计时目标时刻取节点自身的截止时刻（北京时间）：
 *      江西成绩查询 09:00、成考广东成绩查询 16:20、新疆成绩查询 12:00、
 *      京考报名 18:00、军队文职缴费 18:00、江苏成绩查询 10:00、
 *      广东自考成绩查询 15:00（均为 11-18 当日）。
 *    成考广东取 16:20（小程序自查开通时刻；16:00 仅短信推送，不是自查开通时刻）；
 *    广东自考取 15:00（省自考委办 11-10 公告“定于 11 月 18 日 15 时公布考试成绩”），
 *    与成考广东 16:20 是两场考试、两个时刻，不得混淆。
 *  - 截止前：行内倒计时文案为 formatRemaining 的值；截止后：文案翻
 *    「已截止」；永不写「已开通」「已可查」（江西 09:00、新疆 12:00
 *    开通均未核实，只写公告时刻）。
 *  - todayNodes 仍是日期口径（A1 守卫：不给 ExamNode 加时刻字段、不新造
 *    时刻门控函数），倒计时只是在渲染层按节点算目标时刻；18:00 过后
 *    7 项仍在今日行内（日期未过），只是文案翻为「已截止」。
 *  - U-144 江苏成绩复核（11-20 17:00 截止，endsToday 行）：目标时刻进表，
 *    不挂 hideWhenPassed，17:00 后 chip 显示「已截止」；江苏成绩查询
 *    （11-18 10:00，today 行）：挂 hideWhenPassed，10:00 后 chip 直接消失。
 *  - U-158 成考三省复核 11-20 截止：广东 15:00（today 行，过期 chip 消失）、
 *    新疆 12:00、江西 17:00（endsToday 行，过期显示「已截止」）。
 *  - SSR 首屏不水合错位：W7 组件挂载前只渲染固定文案「倒计时」，服务端
 *    输出与客户端首帧逐字一致，tick 只在客户端 effect 里发生。本文件
 *    覆盖：同一 nowMs 两次渲染字节一致；SSR 输出不含随分钟跳动的活值
 *    （08:00 与 08:01 的 SSR 输出相同）；每行一个 role="timer" 徽章；
 *    今日区源码无 setInterval、Date.now() 只出现在 nowMs 默认参数。
 *    注意（已确认为设计取舍，见报告）：按此设计，SSR HTML 里永远只有
 *    「倒计时」占位、没有真实剩余值、截止后也没有「已截止」——真实值
 *    与「已截止」只在客户端挂载后出现。本文件据此写断言：值级契约由
 *    formatRemaining 单测锁定，行级契约由 SSR 占位 + 源码接线守卫锁定；
 *    若 coordinator 要求 SSR 直出真实值 / 截止后 SSR 直出「已截止」，
 *    需改 W7 组件为服务端可算初值的形态，本文件 C3/C5 相关断言随之改。
 *
 * 实现轮需提供的接口（本文件只 import 已存在的 API）：
 *  - 已存在、无需新造：`formatRemaining`、
 *    `HomeTodayCountdown({ target, endedLabel?, hideWhenPassed? })`。
 *  - 已实现（实现轮已补，接线已完成，C3 已绿；本文件以源码接线守卫 +
 *    SSR 占位断言覆盖）：
 *    ① `HomeTodayZone` 在今日节点 `<li>` 内渲染 `<HomeTodayCountdown
 *    target={...} />`，每行一个；②目标时刻解析：把节点映射到上表
 *    五个时刻——建议新增纯函数
 *    `todayNodeDeadlineMs(item: TodayNodeItem): number | undefined`
 *    （放 src/lib/exam-calendar.ts），查表（`${exam.id}:${node.label}`）
 *    或解析 detail 首个 HH:MM 均可，但不得给 ExamNode 加时刻字段
 *    （A1 守卫禁止 hour/minute/deadline/cutoff），不得让 todayNodes
 *    带时刻门控；③ target 请传 ISO 字符串（可跨 RSC 序列化）。
 *  未决问题（见报告，由 coordinator 定）：①「今日截止」徽章在截止后
 *  是否保留；②查分节点「已截止」的语义（指公告时刻已过，不代表查分
 *  通道关闭）；③是否把倒计时推广到 startsToday / 其他 endsToday 节点
 *  （如 11-19 江西成绩复核，窗口末日 11-20 17:00）——U-144 已定其一：
 *  江苏成绩复核 11-20 17:00 进表（endsToday 行，显示「已截止」），
 *  其余推广仍未决；④ SSR 是否要直出
 *  真实值 / 截止后直出「已截止」（见上）。
 *
 * 环境：与 home-today-zone-u102.test.ts 相同——node 环境、无 jsdom，
 * 用 react-dom/server 的 renderToString 做服务端渲染断言；DailyFocus /
 * BriefResurface / 短剧榜首用桩隔离，只测今日行本身；next/link 替成
 * 直通 <a>。mock-hygiene：跨模块 vi.mock 须带 afterAll(vi.resetModules())。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { EXAMS, countdownParts, examNodeDeadlineLabel, todayNodeDeadlineMs, todayNodes } from '../src/lib/exam-calendar'
import {
  HomeTodayCountdown,
  formatRemaining,
} from '../src/components/home-today-countdown'
import { HomeTodayZone } from '../src/components/home-today-zone'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

// next/link 在 node 测试环境没有 Next 运行时：替成直通 <a>，只保留 href/文案。
vi.mock('next/link', async () => {
  const React = await import('react')
  return {
    default: ({ href, children, ...props }: { href?: string; children?: React.ReactNode }) =>
      React.createElement(
        'a',
        { href: typeof href === 'string' ? href : '#', ...props },
        children,
      ),
  }
})

// 今日专注与今日重温是客户端岛：渲染期返回 null，只测今日行本身。
vi.mock('@/components/daily-focus', () => ({ default: () => null }))
vi.mock('@/app/brief/brief-resurface', () => ({ default: () => null }))
// 短剧榜首固定为空：卡片是否渲染只取决于倒计时与今日节点，不依赖榜单数据。
vi.mock('@/lib/drama-featured', () => ({ loadDramaFeatured: () => ({ dramas: [] }) }))

// mock-hygiene 守卫：跨模块 vi.mock 须带 vi.resetModules() 清理（isolate:false 下模块缓存会跨文件驻留）。
afterAll(() => {
  vi.resetModules()
})

/** 2026-11-18 08:00 北京时间（UTC 午夜）：成考三省查分日、京考报名与文职缴费末日 */
const NOV_18_0800_CST = Date.UTC(2026, 10, 18, 0, 0, 0)
/** 2026-11-18 08:01 北京时间：与 08:00 只差 1 分钟（SSR 不含活值时输出应相同） */
const NOV_18_0801_CST = NOV_18_0800_CST + 60 * 1000
/** 2026-11-18 09:30 北京时间：江西 09:00 已过，新疆 12:00 未到 */
const NOV_18_0930_CST = Date.UTC(2026, 10, 18, 1, 30, 0)
/** 2026-11-18 12:30 北京时间：新疆 12:00 已过，广东 16:20 未到 */
const NOV_18_1230_CST = Date.UTC(2026, 10, 18, 4, 30, 0)
/** 2026-11-18 16:30 北京时间：广东 16:20 已过，京考/文职 18:00 未到 */
const NOV_18_1630_CST = Date.UTC(2026, 10, 18, 8, 30, 0)
/** 2026-11-18 17:59 北京时间：距 18:00 剩 1 分钟 */
const NOV_18_1759_CST = Date.UTC(2026, 10, 18, 9, 59, 0)
/** 2026-11-18 17:59:30 北京时间：距 18:00 剩 30 秒（formatRemaining 写「剩不到 1 分」） */
const NOV_18_1759_30_CST = Date.UTC(2026, 10, 18, 9, 59, 30)
/** 2026-11-18 18:00 北京时间：七项目标时刻全部到达（边界：恰到即截止） */
const NOV_18_1800_CST = Date.UTC(2026, 10, 18, 10, 0, 0)
/** 2026-11-18 18:30 北京时间：七项全部截止后，今日行仍在（日期未过） */
const NOV_18_1830_CST = Date.UTC(2026, 10, 18, 10, 30, 0)
/** 2026-11-18 09:59 北京时间：距江苏查分 10:00 剩 1 分钟 */
const NOV_18_0959_CST = Date.UTC(2026, 10, 18, 1, 59, 0)
/** 2026-11-18 09:59:59 北京时间：距江苏查分 10:00 剩 1 秒 */
const NOV_18_095959_CST = Date.UTC(2026, 10, 18, 1, 59, 59)
/** 2026-11-18 10:00 北京时间：江苏查分目标时刻（边界：恰到即截止） */
const NOV_18_1000_CST = Date.UTC(2026, 10, 18, 2, 0, 0)
/** 2026-11-18 14:59 北京时间：距广东自考查分 15:00 剩 1 分钟 */
const NOV_18_1459_CST = Date.UTC(2026, 10, 18, 6, 59, 0)
/** 2026-11-18 14:59:59 北京时间：距广东自考查分 15:00 剩 1 秒 */
const NOV_18_145959_CST = Date.UTC(2026, 10, 18, 6, 59, 59)
/** 2026-11-18 15:00 北京时间：广东自考查分目标时刻（边界：恰到即截止） */
const NOV_18_1500_CST = Date.UTC(2026, 10, 18, 7, 0, 0)
/** 2026-11-20 08:00 北京时间：江苏复核末日白天 */
const NOV_20_0800_CST = Date.UTC(2026, 10, 20, 0, 0, 0)
/** 2026-11-20 16:59 北京时间：距江苏复核 17:00 剩 1 分钟 */
const NOV_20_1659_CST = Date.UTC(2026, 10, 20, 8, 59, 0)
/** 2026-11-20 16:59:59 北京时间：距江苏复核 17:00 剩 1 秒 */
const NOV_20_165959_CST = Date.UTC(2026, 10, 20, 8, 59, 59)
/** 2026-11-20 17:00 北京时间：江苏复核目标时刻（边界：恰到即截止） */
const NOV_20_1700_CST = Date.UTC(2026, 10, 20, 9, 0, 0)
/** 2026-11-20 17:30 北京时间：江苏复核截止后半小时 */
const NOV_20_1730_CST = Date.UTC(2026, 10, 20, 9, 30, 0)
/** 2026-11-20 11:59:59 北京时间：距新疆复核 12:00 剩 1 秒 */
const NOV_20_115959_CST = Date.UTC(2026, 10, 20, 3, 59, 59)
/** 2026-11-20 12:00 北京时间：新疆复核目标时刻（边界：恰到即截止） */
const NOV_20_1200_CST = Date.UTC(2026, 10, 20, 4, 0, 0)
/** 2026-11-20 14:59:59 北京时间：距广东复核 15:00 剩 1 秒 */
const NOV_20_145959_CST = Date.UTC(2026, 10, 20, 6, 59, 59)
/** 2026-11-20 15:00 北京时间：广东复核目标时刻（边界：恰到即截止） */
const NOV_20_1500_CST = Date.UTC(2026, 10, 20, 7, 0, 0)

/** 七项节点的倒计时目标时刻（北京时间，毫秒）：取节点自身的截止/公告时刻；
 * 键为 `${exam.id}:${node.label}`——江苏与广东自考同名「成绩查询」，label 键容不下两个 */
const DEADLINE_MS = {
  'chengkao:江西成绩查询': Date.UTC(2026, 10, 18, 1, 0, 0), // 09:00
  'chengkao:新疆成绩查询': Date.UTC(2026, 10, 18, 4, 0, 0), // 12:00
  'chengkao:广东成绩查询': Date.UTC(2026, 10, 18, 8, 20, 0), // 16:20（成考；小程序自查开通时刻）
  'jingkao:报名': Date.UTC(2026, 10, 18, 10, 0, 0), // 京考报名 18:00
  'jundui-wenzhi:缴费': Date.UTC(2026, 10, 18, 10, 0, 0), // 文职缴费 18:00
  'jiangsu-zikao:成绩查询': Date.UTC(2026, 10, 18, 2, 0, 0), // 江苏成绩查询 10:00（U-144）
  'guangdong-zikao:成绩查询': Date.UTC(2026, 10, 18, 7, 0, 0), // 广东自考成绩查询 15:00（U-144）
} as const

/** 江苏成绩复核目标时刻（北京时间，毫秒）：11-20 17:00（U-144，endsToday 行） */
const JIANGSU_REVIEW_DEADLINE_MS = Date.UTC(2026, 10, 20, 9, 0, 0)

/**
 * 成考三省复核目标时刻（北京时间，毫秒）：11-20 截止（U-158）。
 * 不进 DEADLINE_MS：C3 在 11-18 遍历 DEADLINE_MS 断言每行挂徽章，11-20
 * 行不在 11-18 今日行内；与 JIANGSU_REVIEW_DEADLINE_MS 同款独立常量。
 */
const CHENGKAO_REVIEW_DEADLINE_MS = {
  'chengkao:广东成绩复核': Date.UTC(2026, 10, 20, 7, 0, 0), // 15:00
  'chengkao:新疆成绩复核': Date.UTC(2026, 10, 20, 4, 0, 0), // 12:00
  'chengkao:江西成绩复核': Date.UTC(2026, 10, 20, 9, 0, 0), // 17:00
} as const

/**
 * liFor 按 label 子串取行：行内写「${shortName} · ${label}」，故用该全串定位；
 * 裸 label「成绩查询」会先命中「江西成绩查询」行，江苏与广东自考两行
 * 必须用「江苏自考 · 成绩查询」「广东自考 · 成绩查询」全串定位。
 */
const SEARCH_KEY: Record<string, string> = {
  'chengkao:江西成绩查询': '成考 · 江西成绩查询',
  'chengkao:新疆成绩查询': '成考 · 新疆成绩查询',
  'chengkao:广东成绩查询': '成考 · 广东成绩查询',
  'jingkao:报名': '京考 · 报名',
  'jundui-wenzhi:缴费': '军队文职 · 缴费',
  'jiangsu-zikao:成绩查询': '江苏自考 · 成绩查询',
  'guangdong-zikao:成绩查询': '广东自考 · 成绩查询',
}

const renderZone = (nowMs: number) =>
  renderToString(createElement(HomeTodayZone, { nowMs }))

/** renderToString 会转义引号与 &：断言原文前先还原，与源码逐字比对。 */
const unesc = (html: string) =>
  html.replaceAll('&quot;', '"').replaceAll('&#x27;', "'").replaceAll('&amp;', '&')

/** 取含指定 label 的 <li> 块（今日节点行内无嵌套 <li>，非贪婪匹配即整行）。 */
const liFor = (html: string, label: string): string => {
  const blocks = [...html.matchAll(/<li[\s\S]*?<\/li>/g)].map((m) => m[0])
  const hit = blocks.find((b) => b.includes(label))
  expect(hit).toBeDefined()
  return hit!
}

/** 全文倒计时徽章个数（role="timer"，每行一个）。 */
const timerBadgeCount = (html: string) => html.match(/role="timer"/g)?.length ?? 0

describe('C1 纯函数层：formatRemaining（已存在）锁定七项目标时刻的值级契约', () => {
  it('11-18 08:00：江西剩1小时0分、新疆剩4小时0分、成考广东剩8小时20分、京考/文职剩10小时0分、江苏剩2小时0分、广东自考剩7小时0分', () => {
    expect(formatRemaining(DEADLINE_MS['chengkao:江西成绩查询'], NOV_18_0800_CST)).toBe('剩1小时0分')
    expect(formatRemaining(DEADLINE_MS['chengkao:新疆成绩查询'], NOV_18_0800_CST)).toBe('剩4小时0分')
    expect(formatRemaining(DEADLINE_MS['chengkao:广东成绩查询'], NOV_18_0800_CST)).toBe('剩8小时20分')
    expect(formatRemaining(DEADLINE_MS['jingkao:报名'], NOV_18_0800_CST)).toBe('剩10小时0分')
    expect(formatRemaining(DEADLINE_MS['jundui-wenzhi:缴费'], NOV_18_0800_CST)).toBe('剩10小时0分')
    expect(formatRemaining(DEADLINE_MS['jiangsu-zikao:成绩查询'], NOV_18_0800_CST)).toBe('剩2小时0分')
    expect(formatRemaining(DEADLINE_MS['guangdong-zikao:成绩查询'], NOV_18_0800_CST)).toBe('剩7小时0分')
  })

  it('09:30：江西已截止，江苏剩30分、新疆剩2小时30分、成考广东剩6小时50分、广东自考剩5小时30分、京考/文职剩8小时30分', () => {
    expect(formatRemaining(DEADLINE_MS['chengkao:江西成绩查询'], NOV_18_0930_CST)).toBe('已截止')
    expect(formatRemaining(DEADLINE_MS['jiangsu-zikao:成绩查询'], NOV_18_0930_CST)).toBe('剩30分')
    expect(formatRemaining(DEADLINE_MS['guangdong-zikao:成绩查询'], NOV_18_0930_CST)).toBe('剩5小时30分')
    expect(formatRemaining(DEADLINE_MS['chengkao:新疆成绩查询'], NOV_18_0930_CST)).toBe('剩2小时30分')
    expect(formatRemaining(DEADLINE_MS['chengkao:广东成绩查询'], NOV_18_0930_CST)).toBe('剩6小时50分')
    expect(formatRemaining(DEADLINE_MS['jingkao:报名'], NOV_18_0930_CST)).toBe('剩8小时30分')
    expect(formatRemaining(DEADLINE_MS['jundui-wenzhi:缴费'], NOV_18_0930_CST)).toBe('剩8小时30分')
  })

  it('12:30：江西/新疆/江苏已截止，成考广东剩3小时50分、广东自考剩2小时30分、京考/文职剩5小时30分', () => {
    expect(formatRemaining(DEADLINE_MS['chengkao:江西成绩查询'], NOV_18_1230_CST)).toBe('已截止')
    expect(formatRemaining(DEADLINE_MS['chengkao:新疆成绩查询'], NOV_18_1230_CST)).toBe('已截止')
    expect(formatRemaining(DEADLINE_MS['jiangsu-zikao:成绩查询'], NOV_18_1230_CST)).toBe('已截止')
    expect(formatRemaining(DEADLINE_MS['guangdong-zikao:成绩查询'], NOV_18_1230_CST)).toBe('剩2小时30分')
    expect(formatRemaining(DEADLINE_MS['chengkao:广东成绩查询'], NOV_18_1230_CST)).toBe('剩3小时50分')
    expect(formatRemaining(DEADLINE_MS['jingkao:报名'], NOV_18_1230_CST)).toBe('剩5小时30分')
    expect(formatRemaining(DEADLINE_MS['jundui-wenzhi:缴费'], NOV_18_1230_CST)).toBe('剩5小时30分')
  })

  it('16:30：五处查分行已截止（江西/新疆/成考广东/江苏/广东自考），京考/文职剩1小时30分', () => {
    for (const label of ['chengkao:江西成绩查询', 'chengkao:新疆成绩查询', 'chengkao:广东成绩查询', 'jiangsu-zikao:成绩查询', 'guangdong-zikao:成绩查询'] as const) {
      expect(formatRemaining(DEADLINE_MS[label], NOV_18_1630_CST)).toBe('已截止')
    }
    expect(formatRemaining(DEADLINE_MS['jingkao:报名'], NOV_18_1630_CST)).toBe('剩1小时30分')
    expect(formatRemaining(DEADLINE_MS['jundui-wenzhi:缴费'], NOV_18_1630_CST)).toBe('剩1小时30分')
  })

  it('17:59 写「剩1分」（分钟级形式，不写「剩0小时」）；17:59:30 剩 30 秒写「剩不到 1 分」；江苏与广东自考查分此时已截止', () => {
    expect(formatRemaining(DEADLINE_MS['jingkao:报名'], NOV_18_1759_CST)).toBe('剩1分')
    expect(formatRemaining(DEADLINE_MS['jundui-wenzhi:缴费'], NOV_18_1759_CST)).toBe('剩1分')
    expect(formatRemaining(DEADLINE_MS['jingkao:报名'], NOV_18_1759_30_CST)).toBe('剩不到 1 分')
    expect(formatRemaining(DEADLINE_MS['jundui-wenzhi:缴费'], NOV_18_1759_30_CST)).toBe('剩不到 1 分')
    expect(formatRemaining(DEADLINE_MS['jiangsu-zikao:成绩查询'], NOV_18_1759_CST)).toBe('已截止')
    expect(formatRemaining(DEADLINE_MS['jiangsu-zikao:成绩查询'], NOV_18_1759_30_CST)).toBe('已截止')
    expect(formatRemaining(DEADLINE_MS['guangdong-zikao:成绩查询'], NOV_18_1759_CST)).toBe('已截止')
    expect(formatRemaining(DEADLINE_MS['guangdong-zikao:成绩查询'], NOV_18_1759_30_CST)).toBe('已截止')
  })

  it('18:00 恰到即截止（diff = 0 → 已截止），18:30 七项全部已截止', () => {
    for (const target of Object.values(DEADLINE_MS)) {
      expect(formatRemaining(target, NOV_18_1800_CST)).toBe('已截止')
      expect(formatRemaining(target, NOV_18_1830_CST)).toBe('已截止')
    }
  })

  it('endedLabel 可覆盖缺省「已截止」；文案永不含「已开通」「已可查」', () => {
    expect(formatRemaining(DEADLINE_MS['jingkao:报名'], NOV_18_1830_CST, '已结束')).toBe('已结束')
    for (const target of Object.values(DEADLINE_MS)) {
      for (const now of [NOV_18_0800_CST, NOV_18_0930_CST, NOV_18_1830_CST]) {
        const text = formatRemaining(target, now)
        expect(text).not.toContain('已开通')
        expect(text).not.toContain('已可查')
      }
    }
  })

  it('七项目标时刻与 todayNodes(11-18 08:00) 的 7 项一一对应（无多无少）', () => {
    const keys = todayNodes(NOV_18_0800_CST).map((i) => `${i.exam.id}:${i.node.label}`)
    expect([...keys].sort()).toEqual(Object.keys(DEADLINE_MS).sort())
  })

  it('countdownParts 拆分与上表一致（08:00 距目标 江西1小时/新疆4小时/成考广东8小时20分/京考·文职10小时/江苏2小时/广东自考7小时；已过全 0）', () => {
    expect(countdownParts(DEADLINE_MS['chengkao:江西成绩查询'], NOV_18_0800_CST)).toEqual({
      days: 0, hours: 1, minutes: 0, seconds: 0,
    })
    expect(countdownParts(DEADLINE_MS['chengkao:新疆成绩查询'], NOV_18_0800_CST)).toEqual({
      days: 0, hours: 4, minutes: 0, seconds: 0,
    })
    expect(countdownParts(DEADLINE_MS['chengkao:广东成绩查询'], NOV_18_0800_CST)).toEqual({
      days: 0, hours: 8, minutes: 20, seconds: 0,
    })
    expect(countdownParts(DEADLINE_MS['jingkao:报名'], NOV_18_0800_CST)).toEqual({
      days: 0, hours: 10, minutes: 0, seconds: 0,
    })
    expect(countdownParts(DEADLINE_MS['jiangsu-zikao:成绩查询'], NOV_18_0800_CST)).toEqual({
      days: 0, hours: 2, minutes: 0, seconds: 0,
    })
    expect(countdownParts(DEADLINE_MS['guangdong-zikao:成绩查询'], NOV_18_0800_CST)).toEqual({
      days: 0, hours: 7, minutes: 0, seconds: 0,
    })
    for (const target of Object.values(DEADLINE_MS)) {
      expect(countdownParts(target, target)).toEqual({
        days: 0, hours: 0, minutes: 0, seconds: 0,
      })
      expect(countdownParts(target, target + 30 * 60 * 1000)).toEqual({
        days: 0, hours: 0, minutes: 0, seconds: 0,
      })
    }
  })
})

describe('C2 组件层：HomeTodayCountdown（已存在）挂载前只渲染固定文案「倒计时」', () => {
  it('服务端渲染（renderToString，无 effect）输出 role="timer" 的「倒计时」占位，不含真实剩余值', () => {
    const target = new Date(DEADLINE_MS['jingkao:报名']).toISOString()
    const html = renderToString(createElement(HomeTodayCountdown, { target }))
    expect(html).toContain('role="timer"')
    expect(html).toContain('倒计时')
    expect(html).not.toMatch(/剩\d+小时\d+分|剩\d+分|剩不到 1 分|已截止/)
  })

  it('无效 target 渲染 null，不编造文案', () => {
    const html = renderToString(createElement(HomeTodayCountdown, { target: 'not-a-date' }))
    expect(html).toBe('')
  })

  it('水合安全形态源码守卫：初始 nowMs 为 null、effect 里取时 + setInterval tick', () => {
    const src = read('src/components/home-today-countdown.tsx')
    expect(src).toContain("'use client'")
    expect(src).toContain('useState<number | null>(null)')
    expect(src).toContain('setInterval')
    expect(src).toContain('setNowMs(Date.now())')
    expect(src).not.toContain('已开通')
    expect(src).not.toContain('已可查')
  })
})

describe('C3 行级接线：HomeTodayZone 每行挂一个倒计时徽章', () => {
  it('11-18 08:00：7 个节点行内各一个 role="timer" 徽章，全文恰好 7 个', () => {
    const html = unesc(renderZone(NOV_18_0800_CST))
    expect(timerBadgeCount(html)).toBe(7)
    for (const label of Object.keys(DEADLINE_MS)) {
      expect(liFor(html, SEARCH_KEY[label] ?? label)).toContain('role="timer"')
      expect(liFor(html, SEARCH_KEY[label] ?? label)).toContain('倒计时')
    }
  })

  it('18:30 七项全部截止后：今日行仍在，7 个徽章仍在（SSR 占位不随截止翻文案，真实值只在挂载后翻）', () => {
    const html = unesc(renderZone(NOV_18_1830_CST))
    expect(html).toContain('aria-label="今日节点"')
    expect(timerBadgeCount(html)).toBe(7)
    for (const label of Object.keys(DEADLINE_MS)) {
      expect(liFor(html, SEARCH_KEY[label] ?? label)).toContain('role="timer"')
    }
  })

  it('今日区源码接线守卫：import 并渲染 HomeTodayCountdown，每行传 target', () => {
    const zone = read('src/components/home-today-zone.tsx')
    expect(zone).toContain('HomeTodayCountdown')
    expect(zone).toContain('home-today-countdown')
    expect(zone).toContain('<HomeTodayCountdown')
    expect(zone).toContain('target=')
  })

  it('hideWhenPassed 只挂 kind === \'today\' 的查分行', () => {
    const zone = read('src/components/home-today-zone.tsx')
    expect(zone.match(/hideWhenPassed: true/g)?.length).toBe(1)
    expect(zone).toContain("kind === 'today' ? { hideWhenPassed: true }")
    const src = read('src/components/home-today-countdown.tsx')
    expect(src).toContain('if (hideWhenPassed && targetMs <= nowMs) return null')
  })

  it('天级倒计时行「距国考 10 天」原样不动（行级徽章不挤占、不改写它）', () => {
    const html = unesc(renderZone(NOV_18_0800_CST))
    expect(html).toContain('距国考 10 天')
  })
})

describe('C4 永不写「已开通」/「已可查」（江西/新疆开通未核实，只写公告时刻）', () => {
  it('09:30 / 12:30 / 16:30 / 18:30 任一时刻的 SSR 输出都不出现「已开通」「已可查」', () => {
    for (const now of [
      NOV_18_0930_CST,
      NOV_18_1230_CST,
      NOV_18_1630_CST,
      NOV_18_1830_CST,
    ]) {
      const html = renderZone(now)
      expect(html).not.toContain('已开通')
      expect(html).not.toContain('已可查')
    }
  })

  it('今日区源码不含「已开通」「已可查」（渲染与源码双重守卫）', () => {
    const zone = read('src/components/home-today-zone.tsx')
    expect(zone).not.toContain('已开通')
    expect(zone).not.toContain('已可查')
  })
})

describe('C5 SSR 首屏不水合错位：同一输入同一输出，SSR 不含随分钟跳动的活值', () => {
  it('同一 nowMs 两次服务端渲染字节一致（08:00 与 18:30 各验一次）', () => {
    expect(renderZone(NOV_18_0800_CST)).toBe(renderZone(NOV_18_0800_CST))
    expect(renderZone(NOV_18_1830_CST)).toBe(renderZone(NOV_18_1830_CST))
  })

  it('08:00 与 08:01 的 SSR 输出相同：占位文案不随分钟跳动，活值只在客户端挂载后出现', () => {
    expect(renderZone(NOV_18_0800_CST)).toBe(renderZone(NOV_18_0801_CST))
    const html = unesc(renderZone(NOV_18_0800_CST))
    expect(html).not.toMatch(/剩\d+小时\d+分|剩\d+分|剩不到 1 分/)
  })

  it('今日区源码无 tick 岛：无 setInterval / useEffect，Date.now() 只出现在 nowMs 默认参数', () => {
    const zone = read('src/components/home-today-zone.tsx')
    expect(zone).not.toContain('setInterval')
    expect(zone).not.toContain('useEffect')
    expect(zone.match(/Date\.now\(\)/g)?.length).toBe(1)
    expect(zone).toContain('nowMs = Date.now()')
  })
})

describe('C6 U-144 江苏自考两节点 chip 行为：查分行过期消失、复核行过期显示「已截止」', () => {
  it('查分行 10:00 边界：09:59 剩1分、09:59:59 剩不到 1 分、10:00 恰到即「已截止」', () => {
    expect(formatRemaining(DEADLINE_MS['jiangsu-zikao:成绩查询'], NOV_18_0959_CST)).toBe('剩1分')
    expect(formatRemaining(DEADLINE_MS['jiangsu-zikao:成绩查询'], NOV_18_095959_CST)).toBe('剩不到 1 分')
    expect(formatRemaining(DEADLINE_MS['jiangsu-zikao:成绩查询'], NOV_18_1000_CST)).toBe('已截止')
    expect(formatRemaining(DEADLINE_MS['jiangsu-zikao:成绩查询'], NOV_18_1830_CST)).toBe('已截止')
  })

  it('复核行 11-20 17:00 边界：08:00 剩9小时0分、16:59 剩1分、16:59:59 剩不到 1 分、17:00 恰到即「已截止」、17:30 仍「已截止」', () => {
    expect(formatRemaining(JIANGSU_REVIEW_DEADLINE_MS, NOV_20_0800_CST)).toBe('剩9小时0分')
    expect(formatRemaining(JIANGSU_REVIEW_DEADLINE_MS, NOV_20_1659_CST)).toBe('剩1分')
    expect(formatRemaining(JIANGSU_REVIEW_DEADLINE_MS, NOV_20_165959_CST)).toBe('剩不到 1 分')
    expect(formatRemaining(JIANGSU_REVIEW_DEADLINE_MS, NOV_20_1700_CST)).toBe('已截止')
    expect(formatRemaining(JIANGSU_REVIEW_DEADLINE_MS, NOV_20_1730_CST)).toBe('已截止')
  })

  it('chip 目标时刻取自 todayNodeDeadlineMs（不是手写毫秒）：查分 11-18 10:00、复核 11-20 17:00', () => {
    const byKey18 = new Map(
      todayNodes(NOV_18_0800_CST).map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    expect(todayNodeDeadlineMs(byKey18.get('jiangsu-zikao:成绩查询')!)).toBe(
      Date.UTC(2026, 10, 18, 2, 0, 0),
    )
    const byKey20 = new Map(
      todayNodes(NOV_20_0800_CST).map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    expect(todayNodeDeadlineMs(byKey20.get('jiangsu-zikao:成绩复核')!)).toBe(
      Date.UTC(2026, 10, 20, 9, 0, 0),
    )
    // 复核目标绝不是 11-18 17:00（1020 分钟错值）
    expect(todayNodeDeadlineMs(byKey20.get('jiangsu-zikao:成绩复核')!)).not.toBe(
      Date.UTC(2026, 10, 18, 9, 0, 0),
    )
  })

  it('hideWhenPassed 分流：查分行 kind today（过期 chip 消失）、复核行 kind endsToday（过期显示「已截止」）', () => {
    const query = todayNodes(NOV_18_0800_CST).find((t) => t.exam.id === 'jiangsu-zikao')!
    expect(query.node.label).toBe('成绩查询')
    expect(query.kind).toBe('today')
    const review = todayNodes(NOV_20_0800_CST).find((t) => t.exam.id === 'jiangsu-zikao')!
    expect(review.node.label).toBe('成绩复核')
    expect(review.kind).toBe('endsToday')
    // 接线与组件语义仍由 C3 锁定：kind today 才传 hideWhenPassed，
    // 组件内 hideWhenPassed 且目标已过直接 return null（不渲染 endedLabel）。
    const zone = read('src/components/home-today-zone.tsx')
    expect(zone).toContain("kind === 'today' ? { hideWhenPassed: true }")
    const src = read('src/components/home-today-countdown.tsx')
    expect(src).toContain('if (hideWhenPassed && targetMs <= nowMs) return null')
    // 渲染层文案：复核 16:59:59 为 null、17:00 起「已截止」；查分 09:59:59 为 null、10:00 起「已截止」
    // （查分行挂载后按 hideWhenPassed 消失，不显示该「已截止」，见接线）。
    const jiangsu = EXAMS.find((e) => e.id === 'jiangsu-zikao')!
    expect(examNodeDeadlineLabel(jiangsu, query.node, NOV_18_095959_CST)).toBeNull()
    expect(examNodeDeadlineLabel(jiangsu, query.node, NOV_18_1000_CST)).toBe('已截止')
    expect(examNodeDeadlineLabel(jiangsu, review.node, NOV_20_165959_CST)).toBeNull()
    expect(examNodeDeadlineLabel(jiangsu, review.node, NOV_20_1700_CST)).toBe('已截止')
  })

  it('11-20 SSR：今日行 5 项，其中 4 项挂倒计时徽章（三省复核 + 江苏复核）；上海自考成绩复核无徽章', () => {
    const items = todayNodes(NOV_20_0800_CST)
    expect(items).toHaveLength(5)
    const html = unesc(renderZone(NOV_20_0800_CST))
    expect(timerBadgeCount(html)).toBe(4)
    expect(liFor(html, '江苏自考 · 成绩复核')).toContain('role="timer"')
    expect(liFor(html, '江苏自考 · 成绩复核')).toContain('倒计时')
    expect(liFor(html, '成考 · 广东成绩复核')).toContain('role="timer"')
    expect(liFor(html, '成考 · 广东成绩复核')).toContain('倒计时')
    expect(liFor(html, '成考 · 新疆成绩复核')).toContain('role="timer"')
    expect(liFor(html, '成考 · 新疆成绩复核')).toContain('倒计时')
    expect(liFor(html, '成考 · 江西成绩复核')).toContain('role="timer"')
    expect(liFor(html, '成考 · 江西成绩复核')).toContain('倒计时')
    // 上海自考成绩复核 11-20 首日 startsToday 加入今日行，但不入 PEAK 表、
    // 无倒计时徽章（U-163 复审必改 1：复核无截止时刻）
    expect(liFor(html, '上海自考 · 成绩复核')).not.toContain('role="timer"')
  })
})

describe('C7 U-144 广东自考成绩查询 chip 行为：查分行过期消失（kind today，hideWhenPassed）', () => {
  it('查分行 15:00 边界：14:59 剩1分、14:59:59 剩不到 1 分、15:00 恰到即「已截止」', () => {
    expect(formatRemaining(DEADLINE_MS['guangdong-zikao:成绩查询'], NOV_18_1459_CST)).toBe('剩1分')
    expect(formatRemaining(DEADLINE_MS['guangdong-zikao:成绩查询'], NOV_18_145959_CST)).toBe('剩不到 1 分')
    expect(formatRemaining(DEADLINE_MS['guangdong-zikao:成绩查询'], NOV_18_1500_CST)).toBe('已截止')
    expect(formatRemaining(DEADLINE_MS['guangdong-zikao:成绩查询'], NOV_18_1830_CST)).toBe('已截止')
  })

  it('chip 目标时刻取自 todayNodeDeadlineMs（不是手写毫秒）：查分 11-18 15:00（自考）', () => {
    const byKey18 = new Map(
      todayNodes(NOV_18_0800_CST).map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    expect(todayNodeDeadlineMs(byKey18.get('guangdong-zikao:成绩查询')!)).toBe(
      Date.UTC(2026, 10, 18, 7, 0, 0),
    )
    // 陷阱守卫：绝不是成考广东 16:20，也不是江苏 10:00
    expect(todayNodeDeadlineMs(byKey18.get('guangdong-zikao:成绩查询')!)).not.toBe(
      Date.UTC(2026, 10, 18, 8, 20, 0),
    )
    expect(todayNodeDeadlineMs(byKey18.get('guangdong-zikao:成绩查询')!)).not.toBe(
      Date.UTC(2026, 10, 18, 2, 0, 0),
    )
  })

  it('hideWhenPassed 分流：查分行 kind today（过期 chip 消失）；渲染层文案 14:59:59 为 null、15:00 起「已截止」', () => {
    const query = todayNodes(NOV_18_0800_CST).find((t) => t.exam.id === 'guangdong-zikao')!
    expect(query.node.label).toBe('成绩查询')
    expect(query.kind).toBe('today')
    // 接线与组件语义由 C3 锁定：kind today 才传 hideWhenPassed，
    // 组件内 hideWhenPassed 且目标已过直接 return null（不渲染 endedLabel）。
    const guangdong = EXAMS.find((e) => e.id === 'guangdong-zikao')!
    expect(examNodeDeadlineLabel(guangdong, query.node, NOV_18_145959_CST)).toBeNull()
    expect(examNodeDeadlineLabel(guangdong, query.node, NOV_18_1500_CST)).toBe('已截止')
  })
})

describe('C8 U-158 成考三省复核 chip 行为：广东 today 行过期消失、新疆/江西 endsToday 行过期显示「已截止」', () => {
  it('新疆复核行 11-20 12:00 边界：08:00 剩4小时0分、11:59:59 剩不到 1 分、12:00 恰到即「已截止」', () => {
    expect(formatRemaining(CHENGKAO_REVIEW_DEADLINE_MS['chengkao:新疆成绩复核'], NOV_20_0800_CST)).toBe('剩4小时0分')
    expect(formatRemaining(CHENGKAO_REVIEW_DEADLINE_MS['chengkao:新疆成绩复核'], NOV_20_115959_CST)).toBe('剩不到 1 分')
    expect(formatRemaining(CHENGKAO_REVIEW_DEADLINE_MS['chengkao:新疆成绩复核'], NOV_20_1200_CST)).toBe('已截止')
    expect(formatRemaining(CHENGKAO_REVIEW_DEADLINE_MS['chengkao:新疆成绩复核'], NOV_20_1730_CST)).toBe('已截止')
  })

  it('广东复核行 11-20 15:00 边界：08:00 剩7小时0分、14:59:59 剩不到 1 分、15:00 恰到即「已截止」', () => {
    expect(formatRemaining(CHENGKAO_REVIEW_DEADLINE_MS['chengkao:广东成绩复核'], NOV_20_0800_CST)).toBe('剩7小时0分')
    expect(formatRemaining(CHENGKAO_REVIEW_DEADLINE_MS['chengkao:广东成绩复核'], NOV_20_145959_CST)).toBe('剩不到 1 分')
    expect(formatRemaining(CHENGKAO_REVIEW_DEADLINE_MS['chengkao:广东成绩复核'], NOV_20_1500_CST)).toBe('已截止')
    expect(formatRemaining(CHENGKAO_REVIEW_DEADLINE_MS['chengkao:广东成绩复核'], NOV_20_1730_CST)).toBe('已截止')
  })

  it('江西复核行 11-20 17:00 边界：08:00 剩9小时0分、16:59:59 剩不到 1 分、17:00 恰到即「已截止」、17:30 仍「已截止」', () => {
    expect(formatRemaining(CHENGKAO_REVIEW_DEADLINE_MS['chengkao:江西成绩复核'], NOV_20_0800_CST)).toBe('剩9小时0分')
    expect(formatRemaining(CHENGKAO_REVIEW_DEADLINE_MS['chengkao:江西成绩复核'], NOV_20_165959_CST)).toBe('剩不到 1 分')
    expect(formatRemaining(CHENGKAO_REVIEW_DEADLINE_MS['chengkao:江西成绩复核'], NOV_20_1700_CST)).toBe('已截止')
    expect(formatRemaining(CHENGKAO_REVIEW_DEADLINE_MS['chengkao:江西成绩复核'], NOV_20_1730_CST)).toBe('已截止')
  })

  it('chip 目标时刻取自 todayNodeDeadlineMs（不是手写毫秒）：广东 15:00、新疆 12:00、江西 17:00', () => {
    const byKey20 = new Map(
      todayNodes(NOV_20_0800_CST).map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    expect(todayNodeDeadlineMs(byKey20.get('chengkao:广东成绩复核')!)).toBe(
      CHENGKAO_REVIEW_DEADLINE_MS['chengkao:广东成绩复核'],
    )
    expect(todayNodeDeadlineMs(byKey20.get('chengkao:新疆成绩复核')!)).toBe(
      CHENGKAO_REVIEW_DEADLINE_MS['chengkao:新疆成绩复核'],
    )
    expect(todayNodeDeadlineMs(byKey20.get('chengkao:江西成绩复核')!)).toBe(
      CHENGKAO_REVIEW_DEADLINE_MS['chengkao:江西成绩复核'],
    )
    // 陷阱守卫：广东成考复核 15:00 绝不是广东自考 11-18 15:00，也不是成考广东查分 16:20
    expect(todayNodeDeadlineMs(byKey20.get('chengkao:广东成绩复核')!)).not.toBe(
      Date.UTC(2026, 10, 18, 7, 0, 0),
    )
    expect(todayNodeDeadlineMs(byKey20.get('chengkao:广东成绩复核')!)).not.toBe(
      Date.UTC(2026, 10, 18, 8, 20, 0),
    )
  })

  it('hideWhenPassed 分流：广东复核行 kind today（过期 chip 消失）、新疆/江西复核行 kind endsToday（过期显示「已截止」）', () => {
    const gd = todayNodes(NOV_20_0800_CST).find(
      (t) => t.exam.id === 'chengkao' && t.node.label === '广东成绩复核',
    )!
    expect(gd.kind).toBe('today')
    const xj = todayNodes(NOV_20_0800_CST).find(
      (t) => t.exam.id === 'chengkao' && t.node.label === '新疆成绩复核',
    )!
    expect(xj.kind).toBe('endsToday')
    const jx = todayNodes(NOV_20_0800_CST).find(
      (t) => t.exam.id === 'chengkao' && t.node.label === '江西成绩复核',
    )!
    expect(jx.kind).toBe('endsToday')
    // 接线与组件语义由 C3/C6 锁定：kind today 才传 hideWhenPassed，
    // 组件内 hideWhenPassed 且目标已过直接 return null（不渲染 endedLabel）。
    // 渲染层文案：广东 14:59:59 为 null、15:00 起「已截止」（chip 挂载后按 hideWhenPassed 消失，不显示该「已截止」）；
    // 新疆 11:59:59 为 null、12:00 起「已截止」；江西 16:59:59 为 null、17:00 起「已截止」。
    const chengkao = EXAMS.find((e) => e.id === 'chengkao')!
    expect(examNodeDeadlineLabel(chengkao, gd.node, NOV_20_145959_CST)).toBeNull()
    expect(examNodeDeadlineLabel(chengkao, gd.node, NOV_20_1500_CST)).toBe('已截止')
    expect(examNodeDeadlineLabel(chengkao, xj.node, NOV_20_115959_CST)).toBeNull()
    expect(examNodeDeadlineLabel(chengkao, xj.node, NOV_20_1200_CST)).toBe('已截止')
    expect(examNodeDeadlineLabel(chengkao, jx.node, NOV_20_165959_CST)).toBeNull()
    expect(examNodeDeadlineLabel(chengkao, jx.node, NOV_20_1700_CST)).toBe('已截止')
  })
})
