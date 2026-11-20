/**
 * U-285：国考准考证打印前清单勾选岛（Spec §4.2 C）。
 * 交互照抄 U-237：① <label> 包复选框 + 行文本（点行文字即勾选），行内无外链；
 * ② 复选框视觉保持 20px，加 ::after 隐形扩区到 44×44（站内 U-27 同款
 * after:-inset-3）；③ 已勾行 line-through；④ 挂载前渲染与服务端一致的
 * 未勾选视图（checked 为 null 时按空数组渲染）。
 * 清单项 id 与文案一律复用 W2 内容定稿（@/lib/guokao-checklist），本文件
 * 不另编项；状态照抄 my-exams.ts 收敛模式：新键
 * navhub.guokao-admission-checklist.v1，只存已勾项 id 数组；未知 id 丢弃；
 * 绝不复用 toggleNodeCheck（R8）。
 * 渲染用 renderToString（node 环境前例见 exam-tracker-label-u237.test.ts）；
 * hook 用 vi.doMock 桩 useGuokaoChecklist 后动态 import 渲染。
 */
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'
import {
  GUOKAO_CHECKLIST_GROUPS,
  GUOKAO_CHECKLIST_SOURCE_NOTE,
} from '../src/lib/guokao-checklist'
import {
  GUOKAO_CHECKLIST_ITEMS,
  groupCheckedCount,
  parseGuokaoChecklist,
  toggleGuokaoChecklist,
} from '../src/lib/guokao-checklist-state'
import {
  GuokaoChecklistPhaseBannerView,
  checklistPhaseBanner,
} from '../src/components/guokao-checklist-phase-banner'
import { GUOKAO_ADMISSION_URL, GUOKAO_PORTAL_URL } from '../src/lib/exam-calendar'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

// mock-hygiene 守卫：跨模块 vi.mock 须带 vi.resetModules() 清理（isolate:false 下模块缓存会跨文件驻留）。
afterAll(() => {
  vi.resetModules()
})

async function renderIsland(checked: string[] | null, storageBlocked: string | null = null) {
  vi.resetModules()
  vi.doMock('@/hooks/useGuokaoChecklist', () => ({
    useGuokaoChecklist: () => ({
      checked,
      storageBlocked,
      toggle: () => false,
    }),
  }))
  const { GuokaoChecklistIsland } = await import(
    '../src/app/exam/guokao-checklist/guokao-checklist-island'
  )
  return renderToString(createElement(GuokaoChecklistIsland))
}

/** 逐 <li> 切块 */
function liChunks(h: string): string[] {
  const out: string[] = []
  const re = /<li[^>]*>([\s\S]*?)<\/li>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(h)) !== null) out.push(m[1])
  return out
}

/** 逐 <label> 切块 */
function labelChunks(h: string): string[] {
  const out: string[] = []
  const re = /<label[^>]*>([\s\S]*?)<\/label>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(h)) !== null) out.push(m[1])
  return out
}

describe('U-285 纯规则层：清单项与收敛（复用 W2 定稿）', () => {
  it('清单共 7 项：A 组 3 项 + B 组 3 项 + C 组 1 项，id 与文案与 W2 定稿一致', () => {
    expect(GUOKAO_CHECKLIST_ITEMS).toHaveLength(7)
    expect(GUOKAO_CHECKLIST_GROUPS.map((g) => g.items.length)).toEqual([3, 3, 1])
    expect(GUOKAO_CHECKLIST_ITEMS.map((i) => i.id)).toEqual([
      'registration-number',
      'id-number',
      'account-login',
      'exam-site',
      'exam-room',
      'exam-time',
      'spare-copies',
    ])
    const labels = GUOKAO_CHECKLIST_ITEMS.map((i) => i.label)
    expect(labels).toEqual([
      '报名序号已找到',
      '身份证号在手边',
      '账号可登录',
      '考点名称',
      '考场号',
      '考试时间',
      '多打两份备用',
    ])
    // 时间值与国考节点一致（行测 9:00–11:00、申论 14:00–17:00、专业科目 11-28 14:00–16:00）。
    const timeItem = GUOKAO_CHECKLIST_ITEMS.find((i) => i.id === 'exam-time')!
    expect(timeItem.note).toContain('行测 11 月 29 日 9:00–11:00')
    expect(timeItem.note).toContain('申论 14:00–17:00')
    expect(timeItem.note).toContain('专业科目 11 月 28 日 14:00–16:00')
    expect(timeItem.note).toContain('仅部分职位')
    // C 组注：电子版另存一份 + 《须知》兜底。
    const spare = GUOKAO_CHECKLIST_ITEMS.find((i) => i.id === 'spare-copies')!
    expect(spare.note).toContain('电子版另存一份')
    expect(spare.note).toContain('以报名系统《准考证打印须知》为准')
  })

  it('parse：未知 id 与非字符串丢弃、去重；非数组返回空', () => {
    expect(
      parseGuokaoChecklist(['registration-number', 'no-such-item', 3, 'registration-number']),
    ).toEqual(['registration-number'])
    expect(parseGuokaoChecklist(null)).toEqual([])
    expect(parseGuokaoChecklist('registration-number')).toEqual([])
  })

  it('toggle：未知 id 是 no-op；同一项反复切换', () => {
    expect(toggleGuokaoChecklist([], 'no-such-item')).toEqual([])
    expect(toggleGuokaoChecklist([], 'registration-number')).toEqual(['registration-number'])
    expect(toggleGuokaoChecklist(['registration-number'], 'registration-number')).toEqual([])
    expect(toggleGuokaoChecklist(['registration-number'], 'id-number')).toEqual([
      'registration-number',
      'id-number',
    ])
  })

  it('groupCheckedCount：按组计数（A 组「已完成 x / 3」的分子）', () => {
    const groupA = GUOKAO_CHECKLIST_GROUPS[0]
    expect(groupCheckedCount(['registration-number', 'exam-site'], groupA)).toBe(1)
    expect(
      groupCheckedCount(['registration-number', 'id-number', 'account-login'], groupA),
    ).toBe(3)
  })
})

describe('U-285 勾选岛：label 包复选框 + 行文本，行内无外链', () => {
  it('7 项各一个 <label>，复选框在 label 内、行文本在 label 内', async () => {
    const html = await renderIsland(['registration-number'])
    const labels = labelChunks(html)
    expect(labels).toHaveLength(7)
    for (const label of labels) {
      expect(label).toContain('<input type="checkbox"')
      expect(label).toContain('font-medium')
    }
    expect(liChunks(html)).toHaveLength(7)
  })

  it('label 内无任何 <a>：行内不嵌交互元素，点行文字只触发勾选', async () => {
    const html = await renderIsland([])
    for (const label of labelChunks(html)) {
      expect(label).not.toContain('<a ')
    }
    expect(html).not.toContain('<a ')
  })

  it('复选框视觉保持 20px，但 ::after 隐形扩区到 44×44', async () => {
    const html = await renderIsland([])
    expect(html).toContain('after:-inset-3')
    expect(html).toContain('after:content-')
    for (const label of labelChunks(html)) {
      expect(label).toContain('h-5 w-5')
      expect(label).toContain('after:-inset-3')
    }
  })

  it('已勾选行打删除线、未勾选行不打', async () => {
    const html = await renderIsland(['registration-number', 'exam-site'])
    const chunks = liChunks(html)
    expect(chunks.find((c) => c.includes('报名序号已找到'))).toContain('line-through')
    expect(chunks.find((c) => c.includes('考点名称'))).toContain('line-through')
    expect(chunks.find((c) => c.includes('身份证号在手边'))).not.toContain('line-through')
  })

  it('进度文案：总进度「已完成 x / 7」，A 组「已完成 x / 3」', async () => {
    const html = await renderIsland(['registration-number', 'id-number'])
    expect(html).toContain('已完成 2 / 7')
    expect(html).toContain('已完成 2 / 3')
  })

  it('组 footnote 与页脚来源小字（转载级措辞）齐全', async () => {
    const html = await renderIsland([])
    expect(html).toContain('据官方公告转载整理，以官方最新公告为准')
    expect(html).toContain('异地考生请提前安排住宿与交通（转载建议）')
    expect(html).toContain(GUOKAO_CHECKLIST_SOURCE_NOTE)
    expect(html).toContain('勾选只保存在本机浏览器，不登录、不跨设备同步')
  })
})

describe('U-285 勾选岛：挂载前 SSR 一致 + 存储被禁不崩', () => {
  it('checked 为 null（挂载前）时按未勾选渲染：无 line-through、无 checked 框', async () => {
    const html = await renderIsland(null)
    expect(html).not.toContain('line-through')
    expect(html).not.toContain('checked=""')
    expect(html).toContain('已完成 0 / 7')
    expect(html).toContain('报名序号已找到')
  })

  it('存储被禁时显示原因（role=alert），不崩、清单仍可见', async () => {
    const html = await renderIsland([], '浏览器不允许读写本地存储')
    expect(html).toContain('role="alert"')
    expect(html).toContain('浏览器不允许读写本地存储')
    expect(html).toContain('报名序号已找到')
  })
})

describe('U-285：源码守卫——U-237 结构与新键不回潮', () => {
  it('岛源码：label 包行、after 扩区、line-through；不用 toggleNodeCheck', () => {
    const src = read('src/app/exam/guokao-checklist/guokao-checklist-island.tsx')
    expect(src).toContain('<label')
    expect(src).toContain('after:-inset-3')
    expect(src).toContain('line-through')
    // 守卫只拦真实调用/引用：注释里提及 toggleNodeCheck（说明为何不用）是允许的。
    expect(src).not.toContain('toggleNodeCheck(')
    expect(src).not.toContain("from '@/lib/my-exams'")
    expect(src).not.toContain("from '@/hooks/useMyExams'")
  })

  it('状态层源码：新键独立，复用 W2 定稿的 id 与文案', () => {
    const src = read('src/lib/guokao-checklist-state.ts')
    expect(src).toContain('navhub.guokao-admission-checklist.v1')
    expect(src).toContain("from './guokao-checklist'")
    expect(src).not.toContain('MY_EXAMS_STORAGE_KEY')
    expect(src).not.toContain('报名序号已找到')
  })

  it('my-exams.ts 旧键未被改动（本轮只读新键）', () => {
    const src = read('src/lib/my-exams.ts')
    expect(src).toContain("MY_EXAMS_STORAGE_KEY = 'navhub.my-exams.v1'")
  })
})

/**
 * U-285 D 步：入口链接 + 阶段横幅（Spec §4.2 D，§3.3 结构第 2 项）。
 * 横幅复用 `guokaoAdmissionPhase`（唯一门控事实源，与提醒岛同一函数）：
 * 11-15–11-21 倒计时、11-22 预热、11-23–11-26 已开放、11-27–11-29 15:00
 * 末班；11-15 之前仍显示距开放天数（G3，横幅不随门控消失）；11-29 15:00
 * 之后显示已截止。入口链接读常量不写死域名；门户写 http，不“修正”为 https。
 */
/** 北京时间 2026-11-14 12:00（UTC 11-14 04:00）：门控窗口前一天 */
const NOV_14_NOON_CST = Date.UTC(2026, 10, 14, 4, 0, 0)
/** 北京时间 2026-11-15 12:00（UTC 11-15 04:00）：距打印开启 8 天 */
const NOV_15_NOON_CST = Date.UTC(2026, 10, 15, 4, 0, 0)
/** 北京时间 2026-11-21 12:00（UTC 11-21 04:00）：距打印开启 2 天 */
const NOV_21_NOON_CST = Date.UTC(2026, 10, 21, 4, 0, 0)
/** 北京时间 2026-11-22 12:00（UTC 11-22 04:00）：预热 */
const NOV_22_NOON_CST = Date.UTC(2026, 10, 22, 4, 0, 0)
/** 北京时间 2026-11-23 12:00（UTC 11-23 04:00）：已开放 */
const NOV_23_NOON_CST = Date.UTC(2026, 10, 23, 4, 0, 0)
/** 北京时间 2026-11-27 12:00（UTC 11-27 04:00）：末班 */
const NOV_27_NOON_CST = Date.UTC(2026, 10, 27, 4, 0, 0)
/** 北京时间 2026-11-29 14:59（UTC 11-29 06:59）：截止前一分钟仍在末班 */
const NOV_29_1459_CST = Date.UTC(2026, 10, 29, 6, 59, 0)
/** 北京时间 2026-11-29 15:00（UTC 11-29 07:00）：截止时刻整 */
const NOV_29_1500_CST = Date.UTC(2026, 10, 29, 7, 0, 0)
/** 北京时间 2026-11-30 08:00（UTC 11-30 00:00）：截止后 */
const NOV_30_0800_CST = Date.UTC(2026, 10, 30, 0, 0, 0)

const bannerHtml = (nowMs: number) =>
  renderToString(createElement(GuokaoChecklistPhaseBannerView, { nowMs }))

describe('U-285 D：阶段横幅四态 + 窗口外两态（复用 guokaoAdmissionPhase）', () => {
  it('倒计时档：11-15 距打印开启 8 天、11-21 距打印开启 2 天', () => {
    expect(checklistPhaseBanner(NOV_15_NOON_CST).phase).toBe('countdown')
    expect(checklistPhaseBanner(NOV_15_NOON_CST).line).toContain('距打印开启 8 天')
    expect(checklistPhaseBanner(NOV_21_NOON_CST).phase).toBe('countdown')
    expect(checklistPhaseBanner(NOV_21_NOON_CST).line).toContain('距打印开启 2 天')
  })

  it('G4：预热档 11-22 显示“明天 0:00 开放打印”', () => {
    const banner = checklistPhaseBanner(NOV_22_NOON_CST)
    expect(banner.phase).toBe('warmup')
    expect(banner.line).toContain('明天 0:00 开放打印')
    expect(banner.line).toContain('11 月 29 日 15:00 截止')
  })

  it('已开放档：11-23 显示已开放 + 首日即打 + 截止时刻', () => {
    const banner = checklistPhaseBanner(NOV_23_NOON_CST)
    expect(banner.phase).toBe('open')
    expect(banner.line).toContain('已开放')
    expect(banner.line).toContain('一开就打')
    expect(banner.line).toContain('11 月 29 日 15:00 截止')
    expect(banner.line).toContain('逾期无法补打')
  })

  it('末班档：11-27 与 11-29 14:59 均为末班提醒，写明系统关闭、无法补打', () => {
    for (const t of [NOV_27_NOON_CST, NOV_29_1459_CST]) {
      const banner = checklistPhaseBanner(t)
      expect(banner.phase).toBe('last-call')
      expect(banner.line).toContain('末班提醒')
      expect(banner.line).toContain('11 月 29 日 15:00 截止')
      expect(banner.line).toContain('系统关闭、无法补打')
    }
  })

  it('G3：11-15 之前横幅不消失，11-14 显示距打印开启 9 天', () => {
    const banner = checklistPhaseBanner(NOV_14_NOON_CST)
    expect(banner.phase).toBe('pre-window')
    expect(banner.line).toContain('距打印开启 9 天')
    expect(banner.line).toContain('11 月 23 日 0:00 开放打印')
  })

  it('截止后：11-29 15:00 整点与 11-30 均为已截止，不写“仍可打印”', () => {
    for (const t of [NOV_29_1500_CST, NOV_30_0800_CST]) {
      const banner = checklistPhaseBanner(t)
      expect(banner.phase).toBe('closed')
      expect(banner.line).toContain('已截止')
      expect(banner.line).toContain('11 月 29 日 15:00 后系统关闭、无法补打')
      expect(banner.line).not.toContain('仍可打印')
    }
  })

  it('四档文案都含截止时刻；末班行不写按自然日算的“距关闭不足 X 天”', () => {
    for (const t of [
      NOV_15_NOON_CST,
      NOV_22_NOON_CST,
      NOV_23_NOON_CST,
      NOV_27_NOON_CST,
    ]) {
      expect(checklistPhaseBanner(t).line).toContain('11 月 29 日 15:00')
    }
    expect(checklistPhaseBanner(NOV_27_NOON_CST).line).not.toContain('距关闭不足')
  })
})

describe('U-285 D：横幅渲染（role=status，各阶段标签与文案直出）', () => {
  it('倒计时 / 预热 / 已开放 / 末班 / 已截止五态直出标签与文案', () => {
    expect(bannerHtml(NOV_15_NOON_CST)).toContain('距打印开启 8 天')
    expect(bannerHtml(NOV_22_NOON_CST)).toContain('明天 0:00 开放打印')
    const open = bannerHtml(NOV_23_NOON_CST)
    expect(open).toContain('打印已开放')
    expect(open).toContain('一开就打')
    const last = bannerHtml(NOV_27_NOON_CST)
    expect(last).toContain('末班提醒')
    expect(last).toContain('无法补打')
    expect(bannerHtml(NOV_29_1500_CST)).toContain('打印已截止')
  })

  it('横幅带 role=status 与阶段 data 属性，挂载岛与展示视图分离', () => {
    const html = bannerHtml(NOV_23_NOON_CST)
    expect(html).toContain('role="status"')
    expect(html).toContain('data-checklist-phase-banner="open"')
    expect(bannerHtml(NOV_14_NOON_CST)).toContain(
      'data-checklist-phase-banner="pre-window"',
    )
  })
})

describe('U-285 D：/exam 国考卡片入口链接（G8 一半）', () => {
  const page = read('src/app/exam/page.tsx')

  it('国考卡片内有且仅有一行清单页入口：文案与路由字面量一致', () => {
    expect(page).toContain('href="/exam/guokao-checklist"')
    expect(page).toContain('打印前清单：三件事先勾好 →')
    expect(page.match(/\/exam\/guokao-checklist/g)?.length).toBe(1)
  })

  it('入口在提醒岛之后、note 之前，且只挂国考卡片', () => {
    const islandAt = page.indexOf('GuokaoAdmissionReminderIsland exam={exam}')
    const linkAt = page.indexOf('href="/exam/guokao-checklist"')
    const noteAt = page.indexOf('{exam.note ? (')
    expect(islandAt).toBeGreaterThan(0)
    expect(linkAt).toBeGreaterThan(islandAt)
    expect(noteAt).toBeGreaterThan(linkAt)
    expect(page).toContain("exam.id === 'guokao' ? (")
  })

  it('入口是内部 Next Link（非外链），点击区 min-h-11，页面不写死官方域名', () => {
    expect(page).toContain("from 'next/link'")
    expect(page).toContain('min-h-11 items-center gap-1 text-sm font-medium text-sky-700')
    expect(page).not.toContain('scs.gov.cn')
    expect(page).not.toContain('gwy.cpta.com.cn')
  })
})

describe('U-285 D：清单页入口双写（G8 另一半）+ 横幅接线守卫', () => {
  const checklist = read('src/app/exam/guokao-checklist/page.tsx')
  const banner = read('src/components/guokao-checklist-phase-banner.tsx')

  it('G8：主按钮读 GUOKAO_ADMISSION_URL 常量，门户读 GUOKAO_PORTAL_URL 常量，均写 http', () => {
    expect(GUOKAO_ADMISSION_URL).toBe('http://gwy.cpta.com.cn')
    expect(GUOKAO_PORTAL_URL).toBe('http://bm.scs.gov.cn/kl2027')
    expect(checklist).toContain('safeHref(GUOKAO_ADMISSION_URL)')
    expect(checklist).toContain('safeHref(GUOKAO_PORTAL_URL)')
    expect(checklist).not.toContain('href="http://')
    expect(checklist).not.toContain('href="https://')
    expect(checklist).not.toContain('https://gwy.cpta.com.cn')
    expect(checklist).not.toContain('https://bm.scs.gov.cn')
    expect(checklist).toContain('报名/审查走专题网站门户')
    expect(checklist).toContain('选「考生考务入口」进入打印系统（直达 gwy.cpta.com.cn）')
  })

  it('横幅接在展板之后、截止警示框之前，canonical 与面包屑未被接线改动', () => {
    expect(checklist).toContain('<GuokaoChecklistPhaseBanner />')
    const bannerAt = checklist.indexOf('<GuokaoChecklistPhaseBanner />')
    const alertAt = checklist.indexOf('role="alert"')
    expect(bannerAt).toBeGreaterThan(0)
    expect(alertAt).toBeGreaterThan(bannerAt)
    expect(checklist).toContain("canonical: '/exam/guokao-checklist'")
    expect(checklist).toContain("{ label: '考试日历', path: '/exam' }")
  })

  it('横幅组件：门控只走 exam-calendar 常量与函数，不写死域名；挂载前 null + 60 秒 tick', () => {
    expect(banner).toContain("from '@/lib/exam-calendar'")
    expect(banner).toContain('guokaoAdmissionPhase')
    expect(banner).toContain('daysUntil')
    expect(banner).toContain('useState<number | null>(null)')
    expect(banner).toContain('if (now === null) return null')
    expect(banner).toContain('setInterval(() => setNow(Date.now()), 60_000)')
    expect(banner).not.toContain('gwy.cpta.com.cn')
    expect(banner).not.toContain('scs.gov.cn')
    expect(banner).not.toMatch(/https?:\/\/[a-zA-Z0-9]/)
  })
})

describe('U-285 C+D：清单页已接线——勾选岛 + 阶段横幅均已挂上，无静态 □ 残留', () => {
  it('page 含勾选岛与阶段横幅，不含静态 □ 占位符', () => {
    const page = read('src/app/exam/guokao-checklist/page.tsx')
    expect(page).toContain('<GuokaoChecklistIsland />')
    expect(page).toContain('<GuokaoChecklistPhaseBanner />')
    expect(page).not.toContain('□')
  })
})
