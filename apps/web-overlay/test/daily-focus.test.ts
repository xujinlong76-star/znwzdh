/**
 * 「今日专注」红线测试：日期滚动、校验、持久化往返、接线守卫。
 *
 * 全部用注入的固定日期/时间，不读真实时钟：同一份输入在任何一天跑
 * 都必须得到同一份输出。存储读写用 localStorage 替身（node 环境
 * 没有 window，见 click-evidence.test.ts 的同款做法）。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DAILY_FOCUS_MAX_LENGTH,
  DAILY_FOCUS_STORAGE_KEY,
  cleanFocusText,
  clearDailyFocus,
  createDailyFocus,
  focusForToday,
  isValidFocusText,
  parseDailyFocus,
  readDailyFocus,
  readDailyFocusForToday,
  serializeDailyFocus,
  todayKey,
  withDone,
  withText,
  writeDailyFocus,
  type DailyFocus,
} from '../src/lib/daily-focus'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

const NOW = Date.UTC(2026, 10, 13, 1, 0, 0)
const TODAY = '2026-11-13'
const YESTERDAY = '2026-11-12'

function stubBrowserEnv() {
  const map = new Map<string, string>()
  const store = {
    get length() {
      return map.size
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v)
    },
    removeItem: (k: string) => {
      map.delete(k)
    },
  }
  vi.stubGlobal('localStorage', store)
  vi.stubGlobal('window', { localStorage: store })
  return map
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('todayKey', () => {
  it('本地日期 YYYY-MM-DD，月份与日子补零', () => {
    expect(todayKey(new Date(2026, 10, 13))).toBe('2026-11-13')
    expect(todayKey(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('cleanFocusText / isValidFocusText', () => {
  it('去首尾空白、连续空白折成一个空格', () => {
    expect(cleanFocusText('  把   三篇  长文 读完  ')).toBe('把 三篇 长文 读完')
    expect(cleanFocusText('\n\t读完\n')).toBe('读完')
  })
  it('空白与空串没有内容', () => {
    expect(cleanFocusText('')).toBe('')
    expect(cleanFocusText('   ')).toBe('')
    expect(isValidFocusText('')).toBe(false)
    expect(isValidFocusText('   ')).toBe(false)
    expect(isValidFocusText('读完')).toBe(true)
  })
  it('超长截断到 80 字，不静默丢弃整条', () => {
    const long = '读'.repeat(120)
    expect(cleanFocusText(long).length).toBe(DAILY_FOCUS_MAX_LENGTH)
    expect(DAILY_FOCUS_MAX_LENGTH).toBe(80)
  })
})

describe('createDailyFocus', () => {
  it('正常建一条未完成的专注', () => {
    expect(createDailyFocus(' 读完三篇长文 ', TODAY, NOW)).toEqual({
      date: TODAY,
      text: '读完三篇长文',
      done: false,
      updatedAt: NOW,
    })
  })
  it('空内容或坏日期不建（返回 null，调用方不写存储）', () => {
    expect(createDailyFocus('   ', TODAY, NOW)).toBeNull()
    expect(createDailyFocus('读完', '2026-11-13T00:00', NOW)).toBeNull()
    expect(createDailyFocus('读完', '昨天', NOW)).toBeNull()
  })
})

describe('parseDailyFocus / serializeDailyFocus', () => {
  const focus: DailyFocus = { date: TODAY, text: '读完三篇长文', done: false, updatedAt: NOW }

  it('序列化后解析回来原样（持久化往返）', () => {
    expect(parseDailyFocus(serializeDailyFocus(focus))).toEqual(focus)
  })
  it('坏 JSON、空串、非字符串一律 null，不抛', () => {
    expect(parseDailyFocus('{bad json')).toBeNull()
    expect(parseDailyFocus('')).toBeNull()
    expect(parseDailyFocus(null)).toBeNull()
    expect(parseDailyFocus(42)).toBeNull()
  })
  it('缺字段、坏类型、空内容一律 null', () => {
    expect(parseDailyFocus(JSON.stringify({ date: TODAY, text: '读完' }))).toBeNull()
    expect(parseDailyFocus(JSON.stringify({ ...focus, done: 'yes' }))).toBeNull()
    expect(parseDailyFocus(JSON.stringify({ ...focus, updatedAt: 'now' }))).toBeNull()
    expect(parseDailyFocus(JSON.stringify({ ...focus, date: '11-13' }))).toBeNull()
    expect(parseDailyFocus(JSON.stringify({ ...focus, text: '   ' }))).toBeNull()
  })
  it('解析时清洗文字（首尾空白去掉），不把脏数据原样留给界面', () => {
    expect(parseDailyFocus(JSON.stringify({ ...focus, text: '  读完  ' }))?.text).toBe('读完')
  })
})

describe('focusForToday（日期滚动）', () => {
  it('当天的专注认，昨天的专注不漏进今天', () => {
    const todayRaw = serializeDailyFocus({ date: TODAY, text: '读完', done: false, updatedAt: NOW })
    const yesterdayRaw = serializeDailyFocus({ date: YESTERDAY, text: '昨天的事', done: false, updatedAt: NOW })
    expect(focusForToday(todayRaw, TODAY)?.text).toBe('读完')
    expect(focusForToday(yesterdayRaw, TODAY)).toBeNull()
    expect(focusForToday(yesterdayRaw, YESTERDAY)?.text).toBe('昨天的事')
  })
  it('已完成的专注跨天也不认（新的一天从空白开始）', () => {
    const doneYesterday = serializeDailyFocus({ date: YESTERDAY, text: '昨天的事', done: true, updatedAt: NOW })
    expect(focusForToday(doneYesterday, TODAY)).toBeNull()
  })
})

describe('withDone / withText', () => {
  const focus: DailyFocus = { date: TODAY, text: '读完', done: false, updatedAt: NOW }

  it('标记完成只改 done 与 updatedAt，不动文字与日期', () => {
    const done = withDone(focus, true, NOW + 1000)
    expect(done).toEqual({ date: TODAY, text: '读完', done: true, updatedAt: NOW + 1000 })
    expect(withDone(done, false, NOW + 2000).done).toBe(false)
  })
  it('改文字清洗后写入；空内容返回 null（不写空串进去）', () => {
    expect(withText(focus, '  改成跑步  ', NOW + 1000)?.text).toBe('改成跑步')
    expect(withText(focus, '   ', NOW + 1000)).toBeNull()
  })
})

describe('存储读写（localStorage 往返）', () => {
  it('写 → 读 → 清：同一键、同一天往返，清除后读不到', () => {
    stubBrowserEnv()
    const focus = createDailyFocus('读完三篇长文', TODAY, NOW)
    expect(focus).not.toBeNull()
    expect(writeDailyFocus(focus!)).toBe(true)
    expect(readDailyFocus()).toEqual(focus)
    expect(readDailyFocusForToday(TODAY)).toEqual(focus)
    expect(clearDailyFocus()).toBe(true)
    expect(readDailyFocus()).toBeNull()
  })
  it('读今天的专注：存的是昨天的，按没有算', () => {
    const map = stubBrowserEnv()
    map.set(
      DAILY_FOCUS_STORAGE_KEY,
      serializeDailyFocus({ date: YESTERDAY, text: '昨天的事', done: false, updatedAt: NOW }),
    )
    expect(readDailyFocusForToday(TODAY)).toBeNull()
    // 原始记录还在（不擅自删昨天的专注，只是不把它当成今天的）
    expect(readDailyFocus()?.text).toBe('昨天的事')
  })
  it('存储里是坏数据时读 null，不抛', () => {
    const map = stubBrowserEnv()
    map.set(DAILY_FOCUS_STORAGE_KEY, '{corrupt')
    expect(readDailyFocus()).toBeNull()
    expect(readDailyFocusForToday(TODAY)).toBeNull()
  })
})

describe('接线守卫', () => {
  it('简报页把专注岛挂在最前面（面包屑之后、简报开场之前）', () => {
    const page = read('src/app/brief/page.tsx')
    expect(page).toContain('<DailyFocus />')
    expect(page.indexOf('<DailyFocus />')).toBeGreaterThan(page.indexOf('<Breadcrumbs'))
    expect(page.indexOf('<DailyFocus />')).toBeLessThan(page.indexOf('aria-label="今日简报"'))
  })

  it('专注岛只走 lib/daily-focus 的读写助手，不直读直写 localStorage', () => {
    const island = read('src/components/daily-focus.tsx')
    expect(island).toContain("from '@/lib/daily-focus'")
    expect(island).toContain('readDailyFocusForToday')
    expect(island).toContain('writeDailyFocus')
    // 岛里不许直碰 window.localStorage（读写走 lib 助手，才有坏数据兜底）
    expect(island).not.toContain('window.localStorage')
  })

  it('SSR 页不读专注（用户数据只在客户端岛里出现）', () => {
    const page = read('src/app/brief/page.tsx')
    expect(page).not.toContain('readDailyFocus')
    expect(page).not.toContain('localStorage')
  })

  it('专注是用户自己定的，没有示例目标冒充用户数据', () => {
    const island = read('src/components/daily-focus.tsx')
    // 空态只给输入框：不得出现写死的「今日目标」式假内容
    expect(island).not.toMatch(/今日目标[：:]/)
    expect(island).toContain('今天最想完成的一件事是什么')
  })

  it('不做「关注分类过滤」：中枢 newSites 没有分类字段，硬做就是假功能', () => {
    const brief = read('src/lib/server/brief.ts')
    expect(brief).not.toMatch(/category/i)
    const page = read('src/app/brief/page.tsx')
    expect(page).not.toMatch(/followed|关注分类/)
  })
})
