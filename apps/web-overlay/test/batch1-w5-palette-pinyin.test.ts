/**
 * 04 命令面板 · 拼音前端匹配层 PoC（W5）定向测试。
 *
 * 只测 `palette-pinyin.ts` 本身，不接命令面板、不碰服务端：
 * - 纯函数（isLatinQuery / matchPinyin / PINYIN_FIXES）用手写键测，不依赖
 *   pinyin-pro 是否装好；
 * - 未加载时 buildPinyinKeys 必须抛错（静默空键会漏命中，比抛错更难查）；
 * - ensurePinyinLoaded 的断言是环境自适应的：本克隆 apps/web 未装
 *   pinyin-pro（见报告：需协调员裁决是否把 pinyin-pro 加进 web 依赖），
 *   动态 import 失败时它返回 false 且不抛错；装好后返回 true 时，
 *   进一步验真库算出的键（导航 → daohang / dh）与修正名单。
 */
import { describe, expect, it } from 'vitest'
import {
  PINYIN_FIXES,
  buildPinyinKeys,
  ensurePinyinLoaded,
  isLatinQuery,
  isPinyinLoaded,
  matchPinyin,
  type PinyinKeys,
} from '@/lib/palette-pinyin'

/** 手写键：pyFull=daohang（导航），pyFirst=dh，多音展开含 dao/hang/xing。 */
const NAV_KEYS: PinyinKeys = {
  pyFull: 'daohang',
  pyFirst: 'dh',
  polyphonic: ['dao', 'hang', 'xing'],
}

describe('isLatinQuery', () => {
  it('纯拉丁/数字/空格为真', () => {
    expect(isLatinQuery('qdjb')).toBe(true)
    expect(isLatinQuery('github copilot')).toBe(true)
    expect(isLatinQuery('a1')).toBe(true)
  })

  it('中文、空串、拉丁外字符为假', () => {
    expect(isLatinQuery('启动')).toBe(false)
    expect(isLatinQuery('你好abc')).toBe(false)
    expect(isLatinQuery('')).toBe(false)
    expect(isLatinQuery('   ')).toBe(false)
    expect(isLatinQuery('dao-hang')).toBe(false)
  })
})

describe('matchPinyin（手写键，不依赖真库）', () => {
  it('全拼/首字母全等得 1.0，查询大小写不敏感', () => {
    expect(matchPinyin('daohang', NAV_KEYS)).toBe(1)
    expect(matchPinyin('dh', NAV_KEYS)).toBe(1)
    expect(matchPinyin('DAOHANG', NAV_KEYS)).toBe(1)
  })

  it('单 token 取最高一项：全拼前缀 0.9 / 中间 0.7 / 多音前缀 0.85', () => {
    expect(matchPinyin('dao', NAV_KEYS)).toBe(0.9)
    expect(matchPinyin('oh', NAV_KEYS)).toBe(0.7)
    expect(matchPinyin('x', NAV_KEYS)).toBe(0.85)
    expect(matchPinyin('h', NAV_KEYS)).toBe(0.85)
  })

  it('多 token 全部命中取乘积，任一 token 不命中即 0', () => {
    expect(matchPinyin('dao hang', NAV_KEYS)).toBeCloseTo(0.9 * 0.85, 10)
    expect(matchPinyin('daohang daohang', NAV_KEYS)).toBe(1)
    expect(matchPinyin('dao xyz', NAV_KEYS)).toBe(0)
  })

  it('中文查询与空查询直接返 0，不进拼音通道', () => {
    expect(matchPinyin('启动', NAV_KEYS)).toBe(0)
    expect(matchPinyin('', NAV_KEYS)).toBe(0)
  })
})

describe('PINYIN_FIXES（防御性钉死，见 palette-pinyin.ts 文件头）', () => {
  it('三条最高频易错多音词钉死当前默认读音', () => {
    expect(PINYIN_FIXES).toEqual({
      '长辈': 'zhǎng bèi',
      '出行': 'chū xíng',
      '校验': 'jiào yàn',
    })
  })
})

describe('加载状态（环境自适应：真库未装进 web 依赖时走失败分支）', () => {
  it('初始未加载，buildPinyinKeys 抛错而不是静默返空键', () => {
    expect(isPinyinLoaded()).toBe(false)
    expect(() => buildPinyinKeys('导航')).toThrow(/尚未加载/)
  })

  it('ensurePinyinLoaded 永不抛错；返回值与 isPinyinLoaded 一致', async () => {
    const ok = await ensurePinyinLoaded()
    expect(typeof ok).toBe('boolean')
    expect(isPinyinLoaded()).toBe(ok)
    if (ok) {
      // 真库已装好：验算出的键与修正名单（导航 → daohang / dh）。
      const keys = buildPinyinKeys('导航')
      expect(keys.pyFull).toBe('daohang')
      expect(keys.pyFirst).toBe('dh')
      expect(keys.polyphonic).toEqual(expect.arrayContaining(['dao', 'hang']))
      expect(matchPinyin('dh', keys)).toBe(1)
      expect(matchPinyin('daoh', keys)).toBe(0.9)
    } else {
      // 真库未装：加载失败后拼音通道静默关闭，buildPinyinKeys 仍抛错。
      expect(() => buildPinyinKeys('导航')).toThrow(/尚未加载/)
    }
  })
})
