import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveLogoTile, resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复 C 类第 7 批补批 W2（2026-11-20，视频组 2）。
 *
 * 3/3 站：芒果TV / 咪咕视频·短剧 / 央视频。无阻塞站。
 *
 * 本批 CASES 必须传三参数（url, title, customIcon）：navigation.json 的
 * icon 字段（customIcon）在 resolveSiteIcon 里优先级最高，不传就复现不了
 * 真实解析链。3 站的 href / 标题 / customIcon 均按当前 main 的
 * navigation.json 逐个核对，不可猜；3 站 customIcon 均为远端
 * …/favicon.ico，均被 isRemoteRawFavicon 拦截后回落 map。
 *
 * 来源要点（2026-11-20 15:01–15:03 CST，curl，Chrome UA）：
 * - 芒果TV：首页 200（21,650 B），声明 rel="icon" /favicon.ico 与
 *   rel="shortcut icon"
 *   https://static.hitv.com/pc/icons/icon_64x64.1b7ca7.png；落盘后者
 *   （64×64 PNG，3,383 B，md5 1871e528cd65055d306a2f20e945eb63），
 *   橙底圆角方块 + 白色 M 标原样。根 /favicon.ico 另有 32×32 橙色描
 *   边 M 标（4,286 B，image/x-icon，单帧 ICO），本轮选用首页声明的
 *   64×64 完整应用标（仿 C12 Imperva / Coolify“首页声明的最大尺寸
 *   icon”先例），见下方事实钉死。
 * - 咪咕视频·短剧：href 域名 cmread.com 为准（计划 §C7 备注：icon
 *   字段域名 miguvideo.com 与 href 域名不一致，以 href 域名官网为
 *   准）。短剧页 200（2,199,683 B），源为 cmread 声明的 favicon.png
 *   https://www.cmread.com/wenxueinterface/images/favicon.png
 *   （200，4,286 B，内容实为 ICO 32×32，解码落 PNG，1,181 B，md5
 *   ceb642a6715d5d790f4d5ae07a731341），蓝色 #2E6DED 单色字标原样。
 *   miguvideo.com/favicon.ico（200，9,662 B，48×48 红蓝 M 标）仅作
 *   交叉核对、未采用；同页另声明的 logo-mark.svg（19.16×28 竖版页
 *   眉 logo mark）未采用——以 favicon 为准（调查报告
 *   icon-c7-defer-reason-2026-11-20.md §5）。
 * - 央视频：首页 200 但仅 177 B（meta-refresh 跳转页，声明
 *   link rel="icon" href="data:,"，即首页无 icon 声明）；根
 *   /favicon.ico 直链 200（9,662 B，image/vnd.microsoft.icon，
 *   48×48 ICO），解码落 PNG（2,220 B，md5
 *   b32d9387e7d784e1a317d6d41a9d53ab），红底 #D60010 + 白色央视花标
 *   原样；仿 C8 学习强国“首页无声明、favicon 直链可用即落地”先例。
 *
 * 事实钉死（只记、不加占位、不擅自换图）：
 * - 芒果TV 选用 64×64 应用标而非 32×32 favicon.ico：两者均为官网
 *   首页声明在用标；64×64 为完整橙底应用标，在小卡片内比 32×32
 *   细描边 M 标更可读；改用 32×32 版或另找 SVG 由复审裁决，本轮按
 *   设计原样接线、不擅自换图。
 * - 'miguvideo.com' 键绝不加：咪咕视频·短剧的 icon 字段虽为
 *   miguvideo.com/favicon.ico，但设计源以 href 域名 cmread.com 为
 *   准；miguvideo.com 在全库 383 站中无任何 href 站，加键会让一条
 *   无站命中的键空挂，且与“以 href 域名为准”的计划备注冲突。
 *   miguvideo.com 解析仍为空（见下方守卫断言）。
 * - 'yangshipin.cn' 裸域键绝不加：央视频 href 主机为 m.yangshipin.cn
 *   （www 剥离不适用于 m. 子域），键用完整 hostname
 *   'm.yangshipin.cn'；裸域键会把未来可能出现的 www.yangshipin.cn
 *   等子域站一并指为央视频标。
 * - 无底块：mgtv.png 不透明橙方块、yangshipin.png 全图不透明红底、
 *   cmread.png 蓝 #2E6DED 在浅/深主题下均可见，resolveLogoTile 三
 *   站均为 null，不做单站补丁（见下方守卫断言）。
 * - 全库 383 站核对：'mgtv.com' / 'cmread.com' / 'm.yangshipin.cn'
 *   三键各只命中 1 站，无后缀串站。
 */

const CASES: Array<{ url: string; title: string; customIcon?: string; expected: string }> = [
  // 芒果TV：customIcon 为远端 …/favicon.ico，被拦截后回落 map
  { url: 'https://www.mgtv.com', title: '芒果TV', customIcon: 'https://www.mgtv.com/favicon.ico', expected: '/brand-icons/mgtv.png' },
  // 咪咕视频·短剧：customIcon 是错域的 miguvideo.com/favicon.ico（被拦截，未用）
  { url: 'https://www.cmread.com/yuekan/drama/index.html', title: '咪咕视频·短剧', customIcon: 'https://www.miguvideo.com/favicon.ico', expected: '/brand-icons/cmread.png' },
  // 央视频：customIcon 为远端 …/favicon.ico，被拦截后回落 map（完整 hostname 键）
  { url: 'https://m.yangshipin.cn/', title: '央视频', customIcon: 'https://m.yangshipin.cn/favicon.ico', expected: '/brand-icons/yangshipin.png' },
]

const LOCAL_ASSETS: Array<{ name: string; width: number; height: number; bytes: number; md5: string }> = [
  // PNG：<128 源原样不放大；mgtv 64×64 首页声明 shortcut icon 原样，
  // cmread / yangshipin 为 ICO 内容解码落 PNG 原样
  { name: 'mgtv.png', width: 64, height: 64, bytes: 3383, md5: '1871e528cd65055d306a2f20e945eb63' },
  { name: 'cmread.png', width: 32, height: 32, bytes: 1181, md5: 'ceb642a6715d5d790f4d5ae07a731341' },
  { name: 'yangshipin.png', width: 48, height: 48, bytes: 2220, md5: 'b32d9387e7d784e1a317d6d41a9d53ab' },
]

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG 魔数 8 字节 + IHDR：宽（offset 16，BE u32）、高（offset 20，BE u32）
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（图标修复 C 类第 7 批补批 W2）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, customIcon, expected }) => {
    expect(resolveSiteIcon(url, title, customIcon)).toBe(expected)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘（3 文件）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(LOCAL_ASSETS).toHaveLength(3)
    for (const { name } of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('尺寸与字节钉死：PNG 3 站按表（尺寸 + 精确字节数 + md5）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name, width, height, bytes, md5 } of LOCAL_ASSETS) {
      const buf = readFileSync(`${dir}${name}`)
      const dims = readPngDimensions(buf)
      expect(dims, name).toEqual({ width, height })
      expect(statSync(`${dir}${name}`).size, name).toBe(bytes)
      expect(createHash('md5').update(buf).digest('hex'), name).toBe(md5)
    }
  })

  it('光栅单站落盘 ≤ ~15KB', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name } of LOCAL_ASSETS) {
      expect(statSync(`${dir}${name}`).size, name).toBeLessThanOrEqual(15 * 1024)
    }
  })

  it('事实钉死：三站均无深色底块（resolveLogoTile 为 null）', () => {
    expect(resolveLogoTile('https://www.mgtv.com')).toBeNull()
    expect(resolveLogoTile('https://www.cmread.com/yuekan/drama/index.html')).toBeNull()
    expect(resolveLogoTile('https://m.yangshipin.cn/')).toBeNull()
  })

  it('事实钉死：miguvideo.com 键绝不加（错域 icon 字段未用，解析仍为空）', () => {
    expect(resolveSiteIcon('https://www.miguvideo.com', '咪咕视频', 'https://www.miguvideo.com/favicon.ico')).toBe('')
    expect(resolveSiteIcon('https://www.miguvideo.com', '咪咕视频')).toBe('')
  })

  it('事实钉死：yangshipin.cn 裸域键绝不加（只命中完整 hostname 键）', () => {
    expect(resolveSiteIcon('https://m.yangshipin.cn/', '央视频', 'https://m.yangshipin.cn/favicon.ico')).toBe('/brand-icons/yangshipin.png')
    // www.yangshipin.cn 在库内无站：即使未来出现，也绝不自动解析为央视频标
    expect(resolveSiteIcon('https://www.yangshipin.cn/', '央视频', 'https://www.yangshipin.cn/favicon.ico')).not.toBe('/brand-icons/yangshipin.png')
  })
})
