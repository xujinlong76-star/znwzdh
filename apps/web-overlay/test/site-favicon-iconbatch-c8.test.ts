import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveLogoTile, resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复 C 类第 8 批（2026-11-19）。
 *
 * 19/20 站：石墨文档 / 语雀 / Obsidian / AppFlowy / AFFiNE / 思源笔记 /
 * Excalidraw / XMind / MindManager / ProcessOn / GitMind / tldraw /
 * Draw.io / Miro / Khan Academy / Skillshare / 慕课网 / 学习强国 /
 * 菜鸟教程。网易云课堂阻塞未入（见事实钉死）。
 *
 * 本批 CASES 必须传三参数（url, title, customIcon）：navigation.json 的
 * icon 字段（customIcon）在 resolveSiteIcon 里优先级最高，不传就复现不了
 * 真实解析链。19 站的 href / 标题 / customIcon 均按当前 main 的
 * navigation.json 逐个核对，不可猜；19 站 customIcon 均为远端
 * …/favicon.ico，均被 isRemoteRawFavicon 拦截后回落 map。
 *
 * 来源要点（设计证据 ~/workspace/icon-full/staging/c8/EVIDENCE.md）：
 * - 石墨文档：as.smgv.cn 站方 favicon.ico 单帧 32×32 转 PNG 原样
 *   （与 shimo.im/favicon.ico 字节相同，md5 04a038c4…）。
 * - 语雀：mdn.alipayobjects.com 首页声明图 200×200 缩至 128；
 *   站方 /favicon.ico 仅 96×96，未用。
 * - Obsidian：obsidian.md/favicon.svg 原样（viewBox 0 0 256 256，紫色水晶标）。
 *   字节注：源文件 1361 B 含 6 处 CRLF；入 git 后 blob 为 1355 B，系
 *   .gitattributes `* text=auto eol=lf` 归一化所致，本克隆 core.autocrlf
 *   为空，并非 core.autocrlf=true。
 * - AppFlowy：appflowy.com 首页声明的带构建 hash ICO 32×32 转 PNG 原样
 *   （hash 只下载落盘、不进代码；站方 /favicon.ico 404 未用；
 *   以 href 域名 appflowy.com 为准，icon 字段的 appflowy.io 未用）。
 * - AFFiNE：affine.pro/favicon-96.png 96×96 原样（白底圆角方块，透明像素仅 760/9216，深色底上清晰可见）。
 * - 思源笔记：b3log.org/images/brand/siyuan-128.png 128×128 原样。
 * - Excalidraw：apple-touch-icon.png 180×180 缩至 128；
 *   favicon-32×32.png 仅 32px 未用。
 * - XMind：xmind.cn 首页声明 SVG 原样（viewBox 0 0 25.0793 25，
 *   红橙渐变圆角方块 + 白色 X 形）。
 * - MindManager：站方 .ico 实为 PNG 50×45，按内容解码原样落盘 .png。
 * - ProcessOn：首页声明的带构建 hash ICO 64×64 转 PNG 原样
 *   （hash 只下载落盘、不进代码）。
 * - GitMind：cfcdn.apowersoft.info 首页声明图 72×72 原样；
 *   内联 base64 32×32 data URI 未用。
 * - tldraw：tldraw.com/favicon.svg 原样（viewBox 0 0 33 33，
 *   白底圆角 + 黑色画笔标）。
 * - Draw.io：app.diagrams.net/apple-touch-icon.png 180×180 缩至 128；
 *   favicon.ico 仅 32px 未用。
 * - Miro：framerusercontent.com 首页声明图 128×128 原样
 *   （浅/深两主题同 URL；站方 /favicon.ico 48×48 未用）。
 * - Khan Academy：站方 favicon.ico 单帧 32×32 转 PNG 原样；
 *   首页被机器人验证墙拦截，可达的唯一官方标即此 32px。
 * - Skillshare：apple-touch-icon.png 120×120 原样；
 *   首页被 Cloudflare 验证墙拦截但该直链 200；
 *   favicon-32×32.png 404 未用。
 * - 慕课网：站方 favicon.ico 最大帧 48×48 转 PNG 原样；
 *   直链间歇性返回机器人检查页（复验 3 次 2 次命中正确字节），
 *   宽版白字 wordmark logo.png（128×40）已排除，勿替换。
 * - 学习强国：站方 favicon 内容为 PNG 30×30，原样落盘；
 *   首页无 icon 声明，apple-touch-icon 与 /images/logo.png 均错误页。
 * - 菜鸟教程：runoob.com/pwa/icon-192.png 192×192 缩至 128；
 *   static.char123.com/favicon.ico 仅 32px、mobile-icon.png 均未用。
 *
 * 事实钉死（只记、不加底块、不改组件、不擅自换图）：
 * - 网易云课堂阻塞未接线：站方 /favicon.ico 仅 16×16（1150 B）质量
 *   不达标；吉祥物图不是 logo；站点头部 logo 是雪碧图区域且直链超时；
 *   图标字体无图片文件。本批不放占位图，该站仍解析为空（字母徽标兜底），
 *   解阻塞二选一：浏览器端取材后复审定夺，或用户拍板接受 16px 原样。
 * - khanacademy.png 为 32×32 原样（唯一可达官方标）；更大品牌标须
 *   浏览器端取材或接受 32px，未擅自替换。
 * - imooc.png 为 48×48 火焰 favicon 原样；宽版白字 wordmark 已排除。
 * - affine.png 白底圆角方块（实测透明像素仅 760/9216），深色底上清晰可见，
 *   本批不加底块；resolveLogoTile 对该站返回 null（未进 LOGO_TILE_MAP）。
 * - SVG 3 站（obsidian / tldraw / xmind）本机未做栅格渲染复核
 *   （无 rsvg/inkscape/chromium），请复审在浏览器/浅深主题渲染确认。
 * - 小尺寸原样站（源 <128 不放大）：32×32（石墨 / AppFlowy / Khan）、
 *   96×96（AFFiNE）、50×45（MindManager）、64×64（ProcessOn）、
 *   72×72（GitMind）、120×120（Skillshare）、48×48（慕课网）、
 *   30×30（学习强国）。
 * - 光栅单站落盘均 ≤ ~15 KB（yuque 13559 B、runoob 11187 B 为本批最大）。
 * - SVG 3 站原样落盘，不受光栅单站 ≤ ~15 KB 规则约束。
 */

const CASES: Array<{ url: string; title: string; customIcon?: string; expected: string }> = [
  // 石墨文档 / 语雀 / Obsidian / AppFlowy / AFFiNE 的 customIcon 均含 favicon
  { url: 'https://shimo.im', title: '石墨文档', customIcon: 'https://shimo.im/favicon.ico', expected: '/brand-icons/shimo.png' },
  { url: 'https://www.yuque.com', title: '语雀', customIcon: 'https://www.yuque.com/favicon.ico', expected: '/brand-icons/yuque.png' },
  { url: 'https://obsidian.md', title: 'Obsidian', customIcon: 'https://obsidian.md/favicon.ico', expected: '/brand-icons/obsidian.svg' },
  { url: 'https://appflowy.com/', title: 'AppFlowy', customIcon: 'https://appflowy.io/favicon.ico', expected: '/brand-icons/appflowy.png' },
  { url: 'https://affine.pro', title: 'AFFiNE', customIcon: 'https://affine.pro/favicon.ico', expected: '/brand-icons/affine.png' },
  // 思源笔记 / Excalidraw / XMind / MindManager / ProcessOn 的 customIcon 均含 favicon
  { url: 'https://b3log.org/siyuan', title: '思源笔记', customIcon: 'https://b3log.org/favicon.ico', expected: '/brand-icons/siyuan.png' },
  { url: 'https://excalidraw.com', title: 'Excalidraw', customIcon: 'https://excalidraw.com/favicon.ico', expected: '/brand-icons/excalidraw.png' },
  { url: 'https://www.xmind.cn/', title: 'XMind', customIcon: 'https://www.xmind.cn/favicon.ico', expected: '/brand-icons/xmind.svg' },
  { url: 'https://www.mindmanager.com/', title: 'MindManager', customIcon: 'https://www.mindmanager.com/favicon.ico', expected: '/brand-icons/mindmanager.png' },
  { url: 'https://www.processon.com/', title: 'ProcessOn', customIcon: 'https://www.processon.com/favicon.ico', expected: '/brand-icons/processon.png' },
  // GitMind / tldraw / Draw.io / Miro / Khan Academy 的 customIcon 均含 favicon
  { url: 'https://gitmind.com/', title: 'GitMind', customIcon: 'https://gitmind.com/favicon.ico', expected: '/brand-icons/gitmind.png' },
  { url: 'https://www.tldraw.com', title: 'tldraw', customIcon: 'https://www.tldraw.com/favicon.ico', expected: '/brand-icons/tldraw.svg' },
  { url: 'https://app.diagrams.net', title: 'Draw.io', customIcon: 'https://app.diagrams.net/favicon.ico', expected: '/brand-icons/diagrams.png' },
  { url: 'https://miro.com', title: 'Miro', customIcon: 'https://miro.com/favicon.ico', expected: '/brand-icons/miro.png' },
  { url: 'https://www.khanacademy.org', title: 'Khan Academy', customIcon: 'https://www.khanacademy.org/favicon.ico', expected: '/brand-icons/khanacademy.png' },
  // Skillshare / 慕课网 / 学习强国 / 菜鸟教程 的 customIcon 均含 favicon
  { url: 'https://www.skillshare.com', title: 'Skillshare', customIcon: 'https://www.skillshare.com/favicon.ico', expected: '/brand-icons/skillshare.png' },
  { url: 'https://www.imooc.com/', title: '慕课网', customIcon: 'https://www.imooc.com/favicon.ico', expected: '/brand-icons/imooc.png' },
  { url: 'https://www.xuexi.cn/', title: '学习强国', customIcon: 'https://www.xuexi.cn/favicon.ico', expected: '/brand-icons/xuexi.png' },
  { url: 'https://www.runoob.com', title: '菜鸟教程', customIcon: 'https://runoob.com/favicon.ico', expected: '/brand-icons/runoob.png' },
]

const LOCAL_ASSETS: Array<{ name: string; width: number; height: number }> = [
  // SVG 原样（无 PNG 尺寸钉死，见下方 SVG 断言）
  { name: 'obsidian.svg', width: 0, height: 0 },
  { name: 'xmind.svg', width: 0, height: 0 },
  { name: 'tldraw.svg', width: 0, height: 0 },
  // PNG：≥128 源缩到 128，<128 源原样不放大；非方标原样
  { name: 'shimo.png', width: 32, height: 32 },
  { name: 'yuque.png', width: 128, height: 128 },
  { name: 'appflowy.png', width: 32, height: 32 },
  { name: 'affine.png', width: 96, height: 96 },
  { name: 'siyuan.png', width: 128, height: 128 },
  { name: 'excalidraw.png', width: 128, height: 128 },
  { name: 'mindmanager.png', width: 50, height: 45 },
  { name: 'processon.png', width: 64, height: 64 },
  { name: 'gitmind.png', width: 72, height: 72 },
  { name: 'diagrams.png', width: 128, height: 128 },
  { name: 'miro.png', width: 128, height: 128 },
  { name: 'khanacademy.png', width: 32, height: 32 },
  { name: 'skillshare.png', width: 120, height: 120 },
  { name: 'imooc.png', width: 48, height: 48 },
  { name: 'xuexi.png', width: 30, height: 30 },
  { name: 'runoob.png', width: 128, height: 128 },
]

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG 魔数 8 字节 + IHDR：宽（offset 16，BE u32）、高（offset 20，BE u32）
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（图标修复 C 类第 8 批）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, customIcon, expected }) => {
    expect(resolveSiteIcon(url, title, customIcon)).toBe(expected)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘（19 文件）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(LOCAL_ASSETS).toHaveLength(19)
    for (const { name } of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('尺寸钉死：PNG 16 站按表，SVG 3 站只验存在与文本', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name, width, height } of LOCAL_ASSETS) {
      const buf = readFileSync(`${dir}${name}`)
      if (name.endsWith('.png')) {
        const dims = readPngDimensions(buf)
        expect(dims, name).toEqual({ width, height })
      } else {
        expect(buf.toString('utf8').includes('<svg'), name).toBe(true)
      }
    }
  })

  it('光栅单站落盘 ≤ ~15KB（SVG 文本除外）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name } of LOCAL_ASSETS) {
      if (name.endsWith('.png')) {
        expect(statSync(`${dir}${name}`).size, name).toBeLessThanOrEqual(15 * 1024)
      }
    }
  })

  it('事实钉死：网易云课堂阻塞未接线，仍解析为空（无占位图）', () => {
    // 站方 /favicon.ico 仅 16×16 质量不达标；吉祥物不是 logo；
    // 站点头部 logo 是雪碧图区域且直链超时；图标字体无图片文件。
    // 解阻塞二选一：浏览器端取材后复审定夺，或用户拍板接受 16px 原样。
    expect(resolveSiteIcon('https://study.163.com', '网易云课堂', 'https://study.163.com/favicon.ico')).toBe('')
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(existsSync(`${dir}study163.png`)).toBe(false)
    expect(existsSync(`${dir}wangyiyunketang.png`)).toBe(false)
  })

  it('事实钉死：khanacademy.png 为 32×32 原样（唯一可达官方标）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const buf = readFileSync(`${dir}khanacademy.png`)
    expect(readPngDimensions(buf)).toEqual({ width: 32, height: 32 })
    expect(statSync(`${dir}khanacademy.png`).size).toBe(1028)
    // 首页被机器人验证墙拦截，可达的唯一官方标是 32×32 站方 favicon；
    // 更大品牌标须浏览器端取材或接受 32px，未擅自替换
    expect(resolveSiteIcon('https://www.khanacademy.org', 'Khan Academy', 'https://www.khanacademy.org/favicon.ico')).toBe('/brand-icons/khanacademy.png')
  })

  it('事实钉死：imooc.png 为 48×48 火焰 favicon（宽版白字 wordmark 已排除）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const buf = readFileSync(`${dir}imooc.png`)
    expect(readPngDimensions(buf)).toEqual({ width: 48, height: 48 })
    expect(statSync(`${dir}imooc.png`).size).toBe(1617)
    // 宽版白字 wordmark logo.png（128×40）浅色卡上不可见，已排除，勿替换
    expect(resolveSiteIcon('https://www.imooc.com/', '慕课网', 'https://www.imooc.com/favicon.ico')).toBe('/brand-icons/imooc.png')
  })

  it('事实钉死：affine.png 白底圆角方块、未进 LOGO_TILE_MAP（深色底上清晰可见，不加底块）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const buf = readFileSync(`${dir}affine.png`)
    expect(readPngDimensions(buf)).toEqual({ width: 96, height: 96 })
    // 白底圆角方块（透明像素仅 760/9216），深色底上清晰可见，本批不加底块
    expect(resolveLogoTile('https://affine.pro')).toBeNull()
  })

  it('事实钉死：mindmanager.png 为 PNG 50×45（源 .ico 实为 PNG，按内容解码）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const buf = readFileSync(`${dir}mindmanager.png`)
    expect(readPngDimensions(buf)).toEqual({ width: 50, height: 45 })
    expect(statSync(`${dir}mindmanager.png`).size).toBe(2803)
  })

  it('事实钉死：SVG 3 站原样（viewBox 钉死；栅格渲染复核留待复审）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const obsidian = readFileSync(`${dir}obsidian.svg`, 'utf8')
    expect(obsidian.includes('viewBox="0 0 256 256"')).toBe(true)
    const xmind = readFileSync(`${dir}xmind.svg`, 'utf8')
    expect(xmind.includes('viewBox="0 0 25.0793 25"')).toBe(true)
    const tldraw = readFileSync(`${dir}tldraw.svg`, 'utf8')
    expect(tldraw.includes('viewBox="0 0 33 33"')).toBe(true)
    // 本机无 rsvg/inkscape/chromium，未做栅格渲染复核；
    // 请复审在浏览器/浅深主题下渲染确认后再放行
  })

  it('事实钉死：appflowy.com 键只命中 AppFlowy（icon 字段的 appflowy.io 未用）', () => {
    // navigation.json：AppFlowy href 为 appflowy.com/，icon 字段为
    // appflowy.io/favicon.ico（错域）；设计以 href 域名官网为准
    expect(resolveSiteIcon('https://appflowy.com/', 'AppFlowy', 'https://appflowy.io/favicon.ico')).toBe('/brand-icons/appflowy.png')
  })

  it('事实钉死：b3log.org 键只命中思源笔记（href 为 b3log.org/siyuan）', () => {
    expect(resolveSiteIcon('https://b3log.org/siyuan', '思源笔记', 'https://b3log.org/favicon.ico')).toBe('/brand-icons/siyuan.png')
  })

  it('事实钉死：小尺寸原样站（源 <128 不放大）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(readPngDimensions(readFileSync(`${dir}shimo.png`))).toEqual({ width: 32, height: 32 })
    expect(readPngDimensions(readFileSync(`${dir}appflowy.png`))).toEqual({ width: 32, height: 32 })
    expect(readPngDimensions(readFileSync(`${dir}affine.png`))).toEqual({ width: 96, height: 96 })
    expect(readPngDimensions(readFileSync(`${dir}processon.png`))).toEqual({ width: 64, height: 64 })
    expect(readPngDimensions(readFileSync(`${dir}gitmind.png`))).toEqual({ width: 72, height: 72 })
    expect(readPngDimensions(readFileSync(`${dir}skillshare.png`))).toEqual({ width: 120, height: 120 })
    expect(readPngDimensions(readFileSync(`${dir}xuexi.png`))).toEqual({ width: 30, height: 30 })
  })
})
