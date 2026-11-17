import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复第二批 2b 剩余 + 2c 回归（2026-11-17，进化轮）。
 *
 * 背景：2b 之开发设计类修了 10 站后，2b 剩余 12 站的站方自有图标与
 * 2c 的 5 站 iTunes 128px 应用图标仍显示渐变字母（研究笔记
 * icon-batch2-research-2026-11-17-0101.md §2b/§2c）。本批 17 站全
 * 部 curl 重新验证（200 + image MIME + 魔数 + 尺寸/字节数与研究
 * 笔记逐个相符）后本地落盘，与第一批/2a/2b 同款做法。
 *
 * 这个测试直接执行 resolveSiteIcon：map 键写错一个字符（多一个 www、
 * 少一个字母）都不会报错，只会静默回落渐变——只有跑起来才看得见。
 * 全部 17 站的 href 与标题均按 navigation.json（342 站）逐个核对，
 * 不可猜。有戏 AI 600x600 422KB 已用 PIL 压到 128px（23013B）；
 * 天音 .ico 实为 PNG、智联 .png 实为 ICO，文件名按魔数定；时光网
 * 站方图标仅 16px，改用 iTunes 128px 版。极客公园/海珀/国家公务
 * 员局不在本批，未动。
 */

const CASES: Array<{ url: string; title: string; expected: string }> = [
  { url: 'https://www.capcut.cn/', title: '剪映专业版', expected: '/brand-icons/capcut.png' },
  { url: 'https://jimeng.jianying.com', title: '即梦AI', expected: '/brand-icons/jimeng.png' },
  { url: 'https://tianyin.163.com/', title: '网易天音', expected: '/brand-icons/tianyin.png' },
  { url: 'https://www.icourse163.org', title: '中国大学MOOC', expected: '/brand-icons/icourse163.png' },
  { url: 'https://time.geekbang.org/', title: '极客时间', expected: '/brand-icons/geekbang.jpg' },
  { url: 'https://www.zhaopin.com', title: '智联招聘', expected: '/brand-icons/zhaopin.png' },
  { url: 'https://www.fanqienovel.com', title: '番茄小说', expected: '/brand-icons/fanqie.png' },
  { url: 'https://www.tantan.com', title: '探探', expected: '/brand-icons/tantan.png' },
  { url: 'https://www.reelshort.com', title: 'ReelShort', expected: '/brand-icons/reelshort.png' },
  { url: 'https://www.nmc.cn', title: '中央气象台', expected: '/brand-icons/nmc.png' },
  { url: 'https://www.ncpssd.org', title: '国家哲学社会科学文献中心', expected: '/brand-icons/ncpssd.png' },
  { url: 'https://youxi.fullpeace.net', title: '有戏AI', expected: '/brand-icons/youxi.png' },
  { url: 'https://www.mtime.com', title: '时光网', expected: '/brand-icons/mtime.jpg' },
  { url: 'https://www.wondercv.com', title: '超级简历', expected: '/brand-icons/wondercv.jpg' },
  { url: 'https://www.nhsa.gov.cn', title: '国家医保局', expected: '/brand-icons/nhsa.jpg' },
  { url: 'https://www.12333.gov.cn/', title: '12333 人社服务', expected: '/brand-icons/12333.jpg' },
  { url: 'https://www.xiaoyunque.com/', title: '小云雀AI', expected: '/brand-icons/xiaoyunque.jpg' },
]

const LOCAL_ASSETS = [
  'capcut.png',
  'jimeng.png',
  'tianyin.png',
  'icourse163.png',
  'geekbang.jpg',
  'zhaopin.png',
  'fanqie.png',
  'tantan.png',
  'reelshort.png',
  'nmc.png',
  'ncpssd.png',
  'youxi.png',
  'mtime.jpg',
  'wondercv.jpg',
  'nhsa.jpg',
  '12333.jpg',
  'xiaoyunque.jpg',
]

describe('resolveSiteIcon（图标修复第二批 2b 剩余 + 2c）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, expected }) => {
    expect(resolveSiteIcon(url, title)).toBe(expected)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const name of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('本地资产魔数钉死：PNG 以魔数开头、JPEG 以 FF D8 FF 开头', () => {
    // 2026-11-17：17 个文件均由 curl 重新验证后落盘（200 + image MIME +
    // 魔数 + 尺寸/字节数与研究笔记逐个相符）。此断言把“落盘的是真图片而
    // 非 HTML 壳页”钉死。B 批合批后剪映/即梦/智联的 .ico 已由设计提交
    // 解码为 .png（ICO 64x64/48x48 取帧），孤儿 .ico 已删，本批不再有
    // .ico 文件；天音 URL 后缀 .ico 实为 PNG，文件名按魔数定。有戏 AI
    // 原图 422KB 已压到 128px（23013B < 50KB）。
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    for (const name of ['capcut.png', 'jimeng.png', 'tianyin.png', 'icourse163.png', 'zhaopin.png', 'fanqie.png', 'tantan.png', 'reelshort.png', 'nmc.png', 'ncpssd.png', 'youxi.png']) {
      const buf = readFileSync(`${dir}${name}`)
      expect(buf.subarray(0, 8).equals(pngMagic), name).toBe(true)
    }
    const jpegMagic = Buffer.from([0xff, 0xd8, 0xff])
    for (const name of ['geekbang.jpg', 'mtime.jpg', 'wondercv.jpg', 'nhsa.jpg', '12333.jpg', 'xiaoyunque.jpg']) {
      const buf = readFileSync(`${dir}${name}`)
      expect(buf.subarray(0, 3).equals(jpegMagic), name).toBe(true)
    }
    // 有戏 AI 压图后须 < 50KB（原图 422095B，600x600 → 128x128）。
    const youxi = readFileSync(`${dir}youxi.png`)
    expect(youxi.length).toBeLessThan(50 * 1024)
  })
})
