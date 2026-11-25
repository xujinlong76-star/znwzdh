import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { LOCAL_LOGO_MAP, resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复 C 类第 9 批（2026-11-19）。
 *
 * 15/20 站：研招网 / 考研网上报名 / 全国大学英语四、六级考试官网 /
 * 四六级成绩查询 / 中国教育考试网 / 粉笔 / 华图教育 / 新东方在线 /
 * BOSS直聘 / 拉勾网 / 前程无忧 / 猎聘 / 五百丁 / Codecademy / 维基百科。
 *
 * 5 站阻塞未入（本次不接线、不放占位图，见文件末事实钉死）：
 * 国家公务员局 / 2027年国家公务员考试专题 /
 * 中央机关公开遴选和公开选调专题（scs.gov.cn 机器人验证墙）、
 * 中公教育（403 WAF）、廖雪峰教程（无 favicon）。
 * 2026-11-25 更新：其中 scs.gov.cn 3 站已由剩余图标补齐 W6 落地——
 * 官方标志取自 gkweb 平台静态 host dl.scs.gov.cn 的 logo.png
 * （scs.png，见 site-favicon-iconbatch-remaining-w6.test.ts 与
 * EVIDENCE-w6.md）；文件末事实钉死已同步更新，仍阻塞的只剩
 * 中公教育、廖雪峰教程 2 站。
 *
 * 本批 CASES 必须传三参数（url, title, customIcon）：navigation.json 的
 * icon 字段（customIcon）在 resolveSiteIcon 里优先级最高，不传就复现不了
 * 真实解析链。15 站的 href / 标题 / customIcon 均按当前 main 的
 * navigation.json 逐个核对，不可猜；15 站 customIcon 均为远端
 * …/favicon.ico，均被 isRemoteRawFavicon 拦截后回落标题规则 / map。
 *
 * 来源要点（设计证据 ~/workspace/icon-full/staging/c9/EVIDENCE.md）：
 * - 研招网：t1.chei.com.cn/yz/favicon.ico（首页 shortcut icon 声明），
 *   ICO 帧 32+16，取最大 32 转 PNG 原样 32×32。
 * - 考研网上报名：与研招网同一官方源（像素相同），文件名不同。
 * - 全国大学英语四、六级考试官网：neea.edu.cn 官方 favicon 路径，
 *   ICO 16×16 单帧，原样 16×16。
 * - 四六级成绩查询：成绩查询页 Shortcut Icon 声明，与官网同源同文件。
 * - 中国教育考试网：neea 首页默认官方路径，与成绩查询页声明一致。
 * - 粉笔：fb.fbstatic.cn/favicon.ico（首页 icon 声明），ICO 32×32 单帧。
 * - 华图教育：www.huatu.com/favicon.ico（默认路径；扩展名 .ico 实为
 *   PNG，按内容解码），PNG 16×16 RGBA 原样。
 * - 新东方在线：www.koolearn.com/favicon.ico（首页 icon 声明），
 *   ICO 32×32 单帧。
 * - BOSS直聘：static.zhipin.com/favicon.ico（首页 shortcut icon 声明），
 *   ICO 16×16 单帧。
 * - 拉勾网：lgstatic 构建路径 favicon（首页 Shortcut Icon 声明；
 *   扩展名 .ico 实为 PNG，按内容解码），PNG 16×16 RGBA 原样。
 * - 前程无忧：51jobcdn 构建路径 favicon（首页 icon 声明；扩展名 .ico
 *   实为 PNG，按内容解码），PNG 128×128 RGBA。
 * - 猎聘：lietou-static 构建路径 favicon（首页 icon 声明），
 *   ICO 32×32 单帧。
 * - 五百丁：www.500d.me/favicon.ico（首页 icon 声明，含版本查询串），
 *   ICO 帧 64+48+32+16，取最大 64 转 PNG 原样 64×64。
 * - Codecademy：apple-touch-icon.png（首页声明；favicon.ico 仅 32×32，
 *   取官方 180 版），PNG 180×180 RGB 缩至 128×128。
 * - 维基百科：apple-touch-icon 声明的 wikipedia.png（favicon.ico 仅
 *   48×48、16 色，取官方 160 版），PNG 160×160 灰度缩至 128×128。
 *
 * 事实钉死（只记、不加底块、不改组件）：
 * - 同域共享源、像素相同、文件名不同，须走标题规则（仿 C1 GitHub 模式）：
 *   yz.png / yz-yzwb.png 逐字节相同；cet.png / cet-query.png / neea.png
 *   逐字节相同（官方源本身同一文件）。'chsi.com.cn' / 'neea.edu.cn' /
 *   'cet.neea.edu.cn' 键绝不进 map，否则同域多站串站。
 * - 6 站为 16×16 原样小图（cet、cet-query、neea、huatu、zhipin、lagou），
 *   按规范 §1.1 原样保留、绝不放大；卡片上显小是合规状态而非质量问题。
 * - 5 站阻塞站本次不接线：resolveSiteIcon 仍返回空串（字母徽标兜底），
 *   不得擅自处理、不得放占位图。
 */

const CASES: Array<{ url: string; title: string; customIcon?: string; expected: string }> = [
  // 研招网 / 考研网上报名：同为 yz.chsi.com.cn，走标题规则
  { url: 'https://yz.chsi.com.cn', title: '研招网', customIcon: 'https://yz.chsi.com.cn/favicon.ico', expected: '/brand-icons/yz.png' },
  { url: 'https://yz.chsi.com.cn/yzwb/', title: '考研网上报名', customIcon: 'https://yz.chsi.com.cn/favicon.ico', expected: '/brand-icons/yz-yzwb.png' },
  // 全国大学英语四、六级考试官网 / 四六级成绩查询 / 中国教育考试网：neea.edu.cn 系，走标题规则
  { url: 'https://cet.neea.edu.cn/', title: '全国大学英语四、六级考试官网', customIcon: 'https://cet.neea.edu.cn/favicon.ico', expected: '/brand-icons/cet.png' },
  { url: 'https://cet.neea.edu.cn/cet', title: '四六级成绩查询', customIcon: 'https://cet.neea.edu.cn/favicon.ico', expected: '/brand-icons/cet-query.png' },
  { url: 'https://www.neea.edu.cn/', title: '中国教育考试网', customIcon: 'https://www.neea.edu.cn/favicon.ico', expected: '/brand-icons/neea.png' },
  // 粉笔 / 华图教育 / 新东方在线 / BOSS直聘 / 拉勾网：map 域名键
  { url: 'https://www.fenbi.com', title: '粉笔', customIcon: 'https://www.fenbi.com/favicon.ico', expected: '/brand-icons/fenbi.png' },
  { url: 'https://www.huatu.com', title: '华图教育', customIcon: 'https://www.huatu.com/favicon.ico', expected: '/brand-icons/huatu.png' },
  { url: 'https://www.koolearn.com', title: '新东方在线', customIcon: 'https://www.koolearn.com/favicon.ico', expected: '/brand-icons/koolearn.png' },
  { url: 'https://www.zhipin.com', title: 'BOSS直聘', customIcon: 'https://www.zhipin.com/favicon.ico', expected: '/brand-icons/zhipin.png' },
  { url: 'https://www.lagou.com', title: '拉勾网', customIcon: 'https://www.lagou.com/favicon.ico', expected: '/brand-icons/lagou.png' },
  // 前程无忧 / 猎聘 / 五百丁 / Codecademy / 维基百科：map 域名键
  { url: 'https://www.51job.com', title: '前程无忧', customIcon: 'https://www.51job.com/favicon.ico', expected: '/brand-icons/51job.png' },
  { url: 'https://www.liepin.com', title: '猎聘', customIcon: 'https://www.liepin.com/favicon.ico', expected: '/brand-icons/liepin.png' },
  { url: 'https://www.500d.me', title: '五百丁', customIcon: 'https://www.500d.me/favicon.ico', expected: '/brand-icons/500d.png' },
  { url: 'https://www.codecademy.com', title: 'Codecademy', customIcon: 'https://www.codecademy.com/favicon.ico', expected: '/brand-icons/codecademy.png' },
  { url: 'https://zh.wikipedia.org', title: '维基百科', customIcon: 'https://zh.wikipedia.org/favicon.ico', expected: '/brand-icons/wikipedia.png' },
]

const LOCAL_ASSETS: Array<{ name: string; width: number; height: number }> = [
  // PNG：≥128 源缩到 128，<128 源原样不放大
  { name: 'yz.png', width: 32, height: 32 },
  { name: 'yz-yzwb.png', width: 32, height: 32 },
  { name: 'cet.png', width: 16, height: 16 },
  { name: 'cet-query.png', width: 16, height: 16 },
  { name: 'neea.png', width: 16, height: 16 },
  { name: 'fenbi.png', width: 32, height: 32 },
  { name: 'huatu.png', width: 16, height: 16 },
  { name: 'koolearn.png', width: 32, height: 32 },
  { name: 'zhipin.png', width: 16, height: 16 },
  { name: 'lagou.png', width: 16, height: 16 },
  { name: '51job.png', width: 128, height: 128 },
  { name: 'liepin.png', width: 32, height: 32 },
  { name: '500d.png', width: 64, height: 64 },
  { name: 'codecademy.png', width: 128, height: 128 },
  { name: 'wikipedia.png', width: 128, height: 128 },
]

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG 魔数 8 字节 + IHDR：宽（offset 16，BE u32）、高（offset 20，BE u32）
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（图标修复 C 类第 9 批）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, customIcon, expected }) => {
    expect(resolveSiteIcon(url, title, customIcon)).toBe(expected)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘（15 文件）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(LOCAL_ASSETS).toHaveLength(15)
    for (const { name } of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('尺寸钉死：PNG 15 站按表（16px 六站 16×16、128 站 128×128）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name, width, height } of LOCAL_ASSETS) {
      const buf = readFileSync(`${dir}${name}`)
      const dims = readPngDimensions(buf)
      expect(dims, name).toEqual({ width, height })
    }
  })

  it('光栅单站落盘 ≤ ~15KB', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name } of LOCAL_ASSETS) {
      expect(statSync(`${dir}${name}`).size, name).toBeLessThanOrEqual(15 * 1024)
    }
  })

  it('事实钉死：同域共享源走标题规则，共享域名键绝不进 map', () => {
    // yz.chsi.com.cn 2 站、neea.edu.cn 系 3 站：hostname 键无法区分
    expect('chsi.com.cn' in LOCAL_LOGO_MAP).toBe(false)
    expect('yz.chsi.com.cn' in LOCAL_LOGO_MAP).toBe(false)
    expect('neea.edu.cn' in LOCAL_LOGO_MAP).toBe(false)
    expect('cet.neea.edu.cn' in LOCAL_LOGO_MAP).toBe(false)
    // 标题规则在 map 精确查找之前：同域两站各解析到各自文件，不串站
    expect(resolveSiteIcon('https://yz.chsi.com.cn', '研招网', 'https://yz.chsi.com.cn/favicon.ico')).toBe('/brand-icons/yz.png')
    expect(resolveSiteIcon('https://yz.chsi.com.cn/yzwb/', '考研网上报名', 'https://yz.chsi.com.cn/favicon.ico')).toBe('/brand-icons/yz-yzwb.png')
    expect(resolveSiteIcon('https://cet.neea.edu.cn/', '全国大学英语四、六级考试官网', 'https://cet.neea.edu.cn/favicon.ico')).toBe('/brand-icons/cet.png')
    expect(resolveSiteIcon('https://cet.neea.edu.cn/cet', '四六级成绩查询', 'https://cet.neea.edu.cn/favicon.ico')).toBe('/brand-icons/cet-query.png')
    expect(resolveSiteIcon('https://www.neea.edu.cn/', '中国教育考试网', 'https://www.neea.edu.cn/favicon.ico')).toBe('/brand-icons/neea.png')
  })

  it('事实钉死：同源文件像素相同但文件名不同（官方源本身同一文件）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const yz = readFileSync(`${dir}yz.png`)
    const yzYzwb = readFileSync(`${dir}yz-yzwb.png`)
    expect(yz.equals(yzYzwb)).toBe(true)
    const cet = readFileSync(`${dir}cet.png`)
    const cetQuery = readFileSync(`${dir}cet-query.png`)
    const neea = readFileSync(`${dir}neea.png`)
    expect(cet.equals(cetQuery)).toBe(true)
    expect(cet.equals(neea)).toBe(true)
    // 文件名不同、解析不同：不得复用同一文件名冒充两站
    expect(resolveSiteIcon('https://yz.chsi.com.cn', '研招网', 'https://yz.chsi.com.cn/favicon.ico'))
      .not.toBe(resolveSiteIcon('https://yz.chsi.com.cn/yzwb/', '考研网上报名', 'https://yz.chsi.com.cn/favicon.ico'))
    expect(resolveSiteIcon('https://cet.neea.edu.cn/', '全国大学英语四、六级考试官网', 'https://cet.neea.edu.cn/favicon.ico'))
      .not.toBe(resolveSiteIcon('https://cet.neea.edu.cn/cet', '四六级成绩查询', 'https://cet.neea.edu.cn/favicon.ico'))
  })

  it('事实钉死：6 站 16×16 原样小图（合规，不放大）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const name of ['cet.png', 'cet-query.png', 'neea.png', 'huatu.png', 'zhipin.png', 'lagou.png']) {
      const buf = readFileSync(`${dir}${name}`)
      // 按规范 §1.1 原样保留、绝不放大；卡片上显小是合规状态
      expect(readPngDimensions(buf), name).toEqual({ width: 16, height: 16 })
    }
  })

  it('事实钉死：2 站阻塞站仍不接线，仍解析为空串（字母徽标兜底）；scs 3 站已由剩余补齐 W6 落地', () => {
    // 2026-11-25：scs.gov.cn 3 站不再阻塞（剩余补齐 W6 落地 scs.png，
    // 官方标志源 dl.scs.gov.cn logo.png）；中公教育（403 WAF）、
    // 廖雪峰教程（无 favicon）仍阻塞未入。
    expect(resolveSiteIcon('http://www.scs.gov.cn/gkIndex.html', '国家公务员局', 'http://www.scs.gov.cn/favicon.ico')).toBe('/brand-icons/scs.png')
    expect(resolveSiteIcon('http://bm.scs.gov.cn/kl2027', '2027年国家公务员考试专题', 'http://www.scs.gov.cn/favicon.ico')).toBe('/brand-icons/scs.png')
    expect(resolveSiteIcon('http://subb.scs.gov.cn/lx2027', '中央机关公开遴选和公开选调专题', 'http://www.scs.gov.cn/favicon.ico')).toBe('/brand-icons/scs.png')
    expect(resolveSiteIcon('https://www.offcn.com', '中公教育', 'https://www.offcn.com/favicon.ico')).toBe('')
    expect(resolveSiteIcon('https://www.liaoxuefeng.com', '廖雪峰教程', 'https://liaoxuefeng.com/favicon.ico')).toBe('')
  })
})
