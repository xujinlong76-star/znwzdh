import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复 C 类第 12 批（2026-11-19）。
 *
 * 17/20 站：中国政府网 / 国家信访局 / 国家税务局 / 国家林业和草原局 /
 * Soul / 积目 / 百合网 / 世纪佳缘 / Akamai / F5 Networks / Imperva /
 * Ansible Collaborative / Alibaba Cloud / Qiniu Cloud / 腾讯云 / 华为云 /
 * Coolify。国家网信办举报中心 / 公安部 / 伊对阻塞未入（见事实钉死）。
 *
 * 本批 CASES 必须传三参数（url, title, customIcon）：navigation.json 的
 * icon 字段（customIcon）在 resolveSiteIcon 里优先级最高，不传就复现不了
 * 真实解析链。17 站的 href / 标题 / customIcon 均按当前 main 的
 * navigation.json 逐个核对，不可猜；17 站 customIcon 均为远端
 * …/favicon.ico（含 Ansible 错域的 ansible.com/favicon.ico），均被
 * isRemoteRawFavicon 拦截后回落标题规则 / map。
 *
 * 来源要点（设计证据 ~/workspace/icon-full/staging/c12/EVIDENCE.md）：
 * - 中国政府网：首页声明的 trs_favicon.ico，内容实为 PNG 16×16
 *   （扩展名与内容不一致，按内容解码），国徽标原样。
 * - 国家信访局：根 favicon.ico 单帧 32×32 转 PNG 原样，国徽标。
 * - 国家税务局：站内无 favicon 声明、根 /favicon.ico 回首页 HTML；
 *   用官网页眉官方标 header_logo.png，967×217 宽版原样（见备注 2）。
 * - 国家林业和草原局：favicon.ico 内容实为 JPEG 58×53（扩展名与
 *   内容不一致，按内容解码落为 .jpg），林业局绿标原样（见备注 3）。
 * - Soul：首页声明的 soulapp.cn CDN PNG 32×32 原样，黑底字标。
 * - 积目：首页声明的 favicon.ico，内容实为 PNG 100×100，原样。
 * - 百合网：根 favicon.ico 单帧 16×16 转 PNG 原样，粉心标
 *   （md5 与世纪佳缘不同，确为两站各自的标）。
 * - 世纪佳缘：根 favicon.ico 单帧 16×16 转 PNG 原样，粉字标。
 * - Akamai：首页 403 被 Bot 墙挡，但 favicon 直取 200，单帧 64×64
 *   转 PNG 原样，蓝波标。
 * - F5 Networks：首页声明的 favicon.ico 单帧 32×32 转 PNG 原样，
 *   红圆标。
 * - Imperva：首页声明的最大尺寸 icon favicon-192.png 192×192，
 *   Pillow LANCZOS 只缩小至 128×128。
 * - Ansible Collaborative：本站页声明的 redhat.com/favicon.ico，
 *   3 帧取最大 48×48 转 PNG 原样——页面 favicon 就是 Red Hat 红帽标
 *   （见备注 1，需裁决）；ansible.com/favicon.ico 301 跳转至本站页。
 * - Alibaba Cloud：首页声明的 alicdn 32×32 PNG 原样，橙括号标
 *   （落盘 aliyun.png，hostname 派生；未用 alibabacloud，见备注 8）。
 * - Qiniu Cloud：首页声明的 static.qiniu.com/favicon.ico 单帧 32×32
 *   转 PNG 原样，七牛蓝标。
 * - 腾讯云：首页声明的 cloudcache favicon.ico 单帧 32×32（内含 PNG
 *   数据）转 PNG 原样，蓝云标。
 * - 华为云：首页声明的 favicon.ico 单帧 96×96 转 PNG 原样，
 *   菊花＋HUAWEI 字标。
 * - Coolify：首页声明的最大尺寸 icon 192×192，LANCZOS 缩至 128×128，
 *   紫 C 标。
 *
 * 事实钉死（只记、不加占位、不擅自换图）：
 * - 阻塞 3 站未接线：国家网信办举报中心（首页与 /favicon.ico 均 403
 *   WAF；http、完整浏览器头、图片请求头复试仍 403；裸域无响应）、
 *   公安部（首页与 /favicon.ico 均 521，疑似源站经 Cloudflare 回源
 *   失败 / 境外不可达；http、完整浏览器头、裸域复试均失败）、伊对
 *   （首页与 /favicon.ico 均 403；http、完整浏览器头复试仍 403）。
 *   3 站仍解析为空（字母徽标兜底），无落盘文件。
 * - 中国政府网不进 map：'gov.cn' 键绝不加——后缀匹配会让全库 12 个
 *   *.gov.cn 命中站全部解析为 gov.png，其中公安部（mps.gov.cn，本批
 *   阻塞）、国家公务员局 3 站（scs.gov.cn，C9 阻塞）、生态环境部 2 站
 *   （mee.gov.cn，C11 未上 main）均无精确键兜底，会被错指为国徽标。
 *   仿 C6 亚马逊 / C9 标题规则先例走标题规则；子串 '中国政府网' 在
 *   全库 369 站标题中仅命中一站。nhsa.gov.cn / 12333.gov.cn 各有精确
 *   键（nhsa.jpg / 12333.jpg），不受影响，见下方守卫断言。
 * - 'aliyun.com' 键无后缀串站：全库命中 4 站，通义千问
 *   （qianwen.aliyun.com → qwen.svg）、Tongyi Lingma
 *   （lingma.aliyun.com → lingma.png）、Codeup
 *   （codeup.aliyun.com → codeup.png）各有精确键先行命中，只剩
 *   Alibaba Cloud 一站落到本键；tongyi / wan2 子域亦各有精确键。
 * - 'redhat.com' 键全库仅命中 Ansible Collaborative 一站（无 Red Hat
 *   主站），无串站。
 * - Ansible 红帽标待裁决：ansible-collaborative.png 为 Red Hat 红帽标
 *   48×48（页面 favicon 为准）；页内另两处 Ansible 品牌资产均不适合
 *   直接做 tile 图标（宽版 lockup SVG 1150×350 小卡片内文字不可读；
 *   ansible-logo_white.svg 纯白版浅色主题下不可见）。本轮按设计原样
 *   接线，保留红帽标 / 改用宽版 lockup SVG / 另找 Ansible “A” 单标
 *   由复审裁决，不擅自换图。
 * - chinatax.png 98,842 B（967×217 宽版页眉标原样）与 forestry.jpg
 *   21,108 B（58×53 JPEG 原样）均超光栅单站 ~15 KB 参考线，按原样
 *   接线、待复审裁决（接受原样或无损压缩、尺寸须保持）；下方 ≤15 KB
 *   断言明确排除这两站，另以精确字节数钉死。
 * - 16px 三站（gov.png / baihe.png / jiayuan.png）：均为官网 favicon
 *   原尺寸，按规范 §1.1“<128 原样保留、绝不放大”落盘；已核查无更大
 *   官方方形标（gov.cn 页内国徽图仅 14×14、页眉小标 50×54；
 *   百合网/世纪佳缘无 apple-touch-icon 与 favicon-32x32）。16px 在
 *   卡片内会显小，是已知特性，非质量问题。
 * - 全库 369 站核对：其余 14 个 map 键各只命中 1 站，无后缀串站。
 */

const CASES: Array<{ url: string; title: string; customIcon?: string; expected: string }> = [
  // 中国政府网走标题规则（'gov.cn' 键绝不加，见上方事实钉死）
  { url: 'https://www.gov.cn', title: '中国政府网', customIcon: 'https://www.gov.cn/favicon.ico', expected: '/brand-icons/gov.png' },
  // 国家信访局 / 国家税务局 / 国家林业和草原局的 customIcon 均含 favicon
  { url: 'https://www.gjxfj.gov.cn', title: '国家信访局', customIcon: 'https://www.gjxfj.gov.cn/favicon.ico', expected: '/brand-icons/gjxfj.png' },
  { url: 'https://www.chinatax.gov.cn', title: '国家税务局', customIcon: 'https://www.chinatax.gov.cn/favicon.ico', expected: '/brand-icons/chinatax.png' },
  { url: 'https://www.forestry.gov.cn', title: '国家林业和草原局', customIcon: 'https://www.forestry.gov.cn/favicon.ico', expected: '/brand-icons/forestry.jpg' },
  // Soul / 积目 / 百合网 / 世纪佳缘的 customIcon 均含 favicon
  { url: 'https://www.soulapp.cn', title: 'Soul', customIcon: 'https://www.soulapp.cn/favicon.ico', expected: '/brand-icons/soul.png' },
  { url: 'https://www.jimoapp.com', title: '积目', customIcon: 'https://www.jimoapp.com/favicon.ico', expected: '/brand-icons/jimo.png' },
  { url: 'https://www.baihe.com', title: '百合网', customIcon: 'https://www.baihe.com/favicon.ico', expected: '/brand-icons/baihe.png' },
  { url: 'https://www.jiayuan.com', title: '世纪佳缘', customIcon: 'https://www.jiayuan.com/favicon.ico', expected: '/brand-icons/jiayuan.png' },
  // Akamai / F5 Networks / Imperva 的 customIcon 均含 favicon
  { url: 'https://www.akamai.com/', title: 'Akamai', customIcon: 'https://www.akamai.com/favicon.ico', expected: '/brand-icons/akamai.png' },
  { url: 'https://www.f5.com/', title: 'F5 Networks', customIcon: 'https://www.f5.com/favicon.ico', expected: '/brand-icons/f5.png' },
  { url: 'https://www.imperva.com/', title: 'Imperva', customIcon: 'https://www.imperva.com/favicon.ico', expected: '/brand-icons/imperva.png' },
  // Ansible Collaborative 的 customIcon 是错域的 ansible.com/favicon.ico（被拦截，未用）
  { url: 'https://www.redhat.com/en/ansible-collaborative', title: 'Ansible Collaborative', customIcon: 'https://www.ansible.com/favicon.ico', expected: '/brand-icons/ansible-collaborative.png' },
  // Alibaba Cloud / Qiniu Cloud / 腾讯云 / 华为云 / Coolify 的 customIcon 均含 favicon
  { url: 'https://www.aliyun.com/', title: 'Alibaba Cloud', customIcon: 'https://www.aliyun.com/favicon.ico', expected: '/brand-icons/aliyun.png' },
  { url: 'https://www.qiniu.com/', title: 'Qiniu Cloud', customIcon: 'https://www.qiniu.com/favicon.ico', expected: '/brand-icons/qiniu.png' },
  { url: 'https://cloud.tencent.com/', title: '腾讯云', customIcon: 'https://cloud.tencent.com/favicon.ico', expected: '/brand-icons/tencent-cloud.png' },
  { url: 'https://www.huaweicloud.com/', title: '华为云', customIcon: 'https://www.huaweicloud.com/favicon.ico', expected: '/brand-icons/huaweicloud.png' },
  { url: 'https://coolify.io', title: 'Coolify', customIcon: 'https://coolify.io/favicon.ico', expected: '/brand-icons/coolify.png' },
]

const LOCAL_ASSETS: Array<{ name: string; width: number; height: number }> = [
  // PNG：≥128 源缩到 128，<128 源原样不放大；非方标等比缩略 / 宽版原样
  { name: 'gov.png', width: 16, height: 16 },
  { name: 'gjxfj.png', width: 32, height: 32 },
  { name: 'chinatax.png', width: 967, height: 217 },
  { name: 'soul.png', width: 32, height: 32 },
  { name: 'jimo.png', width: 100, height: 100 },
  { name: 'baihe.png', width: 16, height: 16 },
  { name: 'jiayuan.png', width: 16, height: 16 },
  { name: 'akamai.png', width: 64, height: 64 },
  { name: 'f5.png', width: 32, height: 32 },
  { name: 'imperva.png', width: 128, height: 128 },
  { name: 'ansible-collaborative.png', width: 48, height: 48 },
  { name: 'aliyun.png', width: 32, height: 32 },
  { name: 'qiniu.png', width: 32, height: 32 },
  { name: 'tencent-cloud.png', width: 32, height: 32 },
  { name: 'huaweicloud.png', width: 96, height: 96 },
  { name: 'coolify.png', width: 128, height: 128 },
  // JPEG 原样（内容即 JPEG，按内容解码落 .jpg）
  { name: 'forestry.jpg', width: 58, height: 53 },
]

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG 魔数 8 字节 + IHDR：宽（offset 16，BE u32）、高（offset 20，BE u32）
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

function readJpegDimensions(buf: Buffer): { width: number; height: number } {
  // JPEG 魔数 SOI（FF D8）；逐段走 marker，SOF0（FF C0）/ SOF2（FF C2）
  // 段内：长度 2 字节 + 精度 1 字节 + 高 2 字节 + 宽 2 字节（均为 BE）
  expect(buf.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))).toBe(true)
  let offset = 2
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) throw new Error(`bad JPEG marker at ${offset}`)
    const marker = buf[offset + 1]
    if (marker === 0xc0 || marker === 0xc2) {
      return { width: buf.readUInt16BE(offset + 7), height: buf.readUInt16BE(offset + 5) }
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    const length = buf.readUInt16BE(offset + 2)
    offset += 2 + length
  }
  throw new Error('no SOF0/SOF2 marker found')
}

describe('resolveSiteIcon（图标修复 C 类第 12 批）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, customIcon, expected }) => {
    expect(resolveSiteIcon(url, title, customIcon)).toBe(expected)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘（17 文件）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(LOCAL_ASSETS).toHaveLength(17)
    for (const { name } of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('尺寸钉死：PNG 16 站按表，JPEG 1 站按表', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name, width, height } of LOCAL_ASSETS) {
      const buf = readFileSync(`${dir}${name}`)
      if (name.endsWith('.png')) {
        const dims = readPngDimensions(buf)
        expect(dims, name).toEqual({ width, height })
      } else {
        const dims = readJpegDimensions(buf)
        expect(dims, name).toEqual({ width, height })
      }
    }
  })

  it('光栅单站落盘 ≤ ~15KB（chinatax.png 与 forestry.jpg 除外，见事实钉死）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name } of LOCAL_ASSETS) {
      if (name === 'chinatax.png' || name === 'forestry.jpg') continue
      expect(statSync(`${dir}${name}`).size, name).toBeLessThanOrEqual(15 * 1024)
    }
  })

  it('事实钉死：阻塞 3 站未接线，仍解析为空（无占位图）', () => {
    // 国家网信办举报中心：首页与 /favicon.ico 均 403 WAF，复试仍 403。
    expect(resolveSiteIcon('https://www.12377.cn', '国家网信办举报中心', 'https://12377.cn/favicon.ico')).toBe('')
    // 公安部：首页与 /favicon.ico 均 521，疑似源站回源失败 / 境外不可达。
    expect(resolveSiteIcon('https://www.mps.gov.cn', '公安部', 'https://www.mps.gov.cn/favicon.ico')).toBe('')
    // 伊对：首页与 /favicon.ico 均 403，复试仍 403。
    expect(resolveSiteIcon('https://www.yidui.net', '伊对', 'https://www.yidui.net/favicon.ico')).toBe('')
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const name of ['12377.png', '12377.svg', 'mps.png', 'mps.svg', 'yidui.png', 'yidui.svg']) {
      expect(existsSync(`${dir}${name}`), name).toBe(false)
    }
  })

  it('事实钉死：中国政府网标题规则不串站（gov.cn 后缀站不受影响）', () => {
    // 标题规则只命中中国政府网一站；其余 *.gov.cn 站各有自己的解析，
    // 绝不解析为 gov.png。scs.gov.cn 3 站（C9 阻塞）与 mee.gov.cn 2 站
    // （C11 未上 main）在本基线上仍解析为空，待各自批次落地后复核；
    // nhsa / 12333 各有精确键，不受影响。
    expect(resolveSiteIcon('https://www.gov.cn', '中国政府网', 'https://www.gov.cn/favicon.ico')).toBe('/brand-icons/gov.png')
    expect(resolveSiteIcon('http://www.scs.gov.cn', '国家公务员局', 'http://www.scs.gov.cn/favicon.ico')).not.toBe('/brand-icons/gov.png')
    expect(resolveSiteIcon('http://bm.scs.gov.cn/kl2027', '2027年国家公务员考试专题', 'http://www.scs.gov.cn/favicon.ico')).not.toBe('/brand-icons/gov.png')
    expect(resolveSiteIcon('http://subb.scs.gov.cn/lx2027', '中央机关公开遴选和公开选调专题', 'http://www.scs.gov.cn/favicon.ico')).not.toBe('/brand-icons/gov.png')
    expect(resolveSiteIcon('https://www.mee.gov.cn', '生态环境部', 'https://www.mee.gov.cn/favicon.ico')).not.toBe('/brand-icons/gov.png')
    expect(resolveSiteIcon('https://permit.mee.gov.cn', '全国排污许可证管理信息平台', 'https://permit.mee.gov.cn/favicon.ico')).not.toBe('/brand-icons/gov.png')
    expect(resolveSiteIcon('https://www.nhsa.gov.cn', '国家医保局', 'https://www.nhsa.gov.cn/favicon.ico')).toBe('/brand-icons/nhsa.jpg')
    expect(resolveSiteIcon('https://www.12333.gov.cn/', '12333 人社服务', undefined)).toBe('/brand-icons/12333.jpg')
  })

  it('事实钉死：aliyun.com 键不串站（3 个子域站各有精确键）', () => {
    expect(resolveSiteIcon('https://qianwen.aliyun.com', '通义千问', 'https://qianwen.aliyun.com/favicon.ico')).toBe('/brand-icons/qwen.svg')
    expect(resolveSiteIcon('https://lingma.aliyun.com', 'Tongyi Lingma', 'https://lingma.aliyun.com/favicon.ico')).toBe('/brand-icons/lingma.png')
    expect(resolveSiteIcon('https://codeup.aliyun.com', 'Codeup', 'https://codeup.aliyun.com/favicon.ico')).toBe('/brand-icons/codeup.png')
    expect(resolveSiteIcon('https://www.aliyun.com/', 'Alibaba Cloud', 'https://www.aliyun.com/favicon.ico')).toBe('/brand-icons/aliyun.png')
  })

  it('事实钉死：Ansible 落盘为 Red Hat 红帽标 48×48（按设计原样，裁决待定）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const buf = readFileSync(`${dir}ansible-collaborative.png`)
    expect(readPngDimensions(buf)).toEqual({ width: 48, height: 48 })
    expect(statSync(`${dir}ansible-collaborative.png`).size).toBe(1290)
    expect(resolveSiteIcon('https://www.redhat.com/en/ansible-collaborative', 'Ansible Collaborative', 'https://www.ansible.com/favicon.ico')).toBe('/brand-icons/ansible-collaborative.png')
  })

  it('事实钉死：超 ~15KB 两站原样接线（字节数钉死，裁决待定）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    // chinatax.png：967×217 宽版页眉标原样，不裁、不压方形、尺寸保持。
    expect(readPngDimensions(readFileSync(`${dir}chinatax.png`))).toEqual({ width: 967, height: 217 })
    expect(statSync(`${dir}chinatax.png`).size).toBe(98842)
    // forestry.jpg：58×53 JPEG 原样（源 .ico 内容实为 JPEG，按内容解码）。
    expect(readJpegDimensions(readFileSync(`${dir}forestry.jpg`))).toEqual({ width: 58, height: 53 })
    expect(statSync(`${dir}forestry.jpg`).size).toBe(21108)
  })

  it('事实钉死：16px 三站原样小图（gov / 百合网 / 世纪佳缘，无更大官方方标）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(readPngDimensions(readFileSync(`${dir}gov.png`))).toEqual({ width: 16, height: 16 })
    expect(statSync(`${dir}gov.png`).size).toBe(1728)
    expect(readPngDimensions(readFileSync(`${dir}baihe.png`))).toEqual({ width: 16, height: 16 })
    expect(statSync(`${dir}baihe.png`).size).toBe(396)
    expect(readPngDimensions(readFileSync(`${dir}jiayuan.png`))).toEqual({ width: 16, height: 16 })
    expect(statSync(`${dir}jiayuan.png`).size).toBe(575)
    // 百合网与世纪佳缘确为两站各自的标（md5 不同，此处以字节数区分钉死）。
    expect(readFileSync(`${dir}baihe.png`).equals(readFileSync(`${dir}jiayuan.png`))).toBe(false)
  })
})
