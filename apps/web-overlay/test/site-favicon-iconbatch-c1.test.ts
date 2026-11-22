import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复 C 类第 1 批（2026-11-18）。
 *
 * 19 站：G1 Perplexity / Hugging Face / Suno / ElevenLabs（Midjourney 阻塞，
 * 本批无文件、无 map 条目、无用例）；G2 智谱清言 / 讯飞星火 / n8n / GitHub
 * （Trae 由补救轮另行落地）；G3 淘宝 / 京东 / 抖音 / 快手 / 哔哩哔哩；
 * G4 飞书 / Stack Overflow / 知乎 / 豆瓣 / 小红书；Trae 补救 1 站。
 *
 * 本批 CASES 必须传三参数（url, title, customIcon）：navigation.json 的
 * icon 字段（customIcon）在 resolveSiteIcon 里优先级最高，不传就复现不了
 * 真实解析链。19 站的 href / 标题 / customIcon 均按当前 main 的
 * navigation.json（349 站）逐个核对，不可猜；19 站 customIcon 均为远端
 * …/favicon.ico，isRemoteRawFavicon 会拦截后回落 map / 标题规则。
 *
 * GitHub 标题规则（见 site-favicon.tsx）：github.com 为 7 站共享域名，
 * 严禁加 'github.com' 域名映射键；子串 'github' 全库仅命中 3 个标题
 * （GitHub、GitHub Trending、GitHub Copilot），其中 Copilot 由上方
 * 'copilot' 规则先行命中；GitHub Trending（C4）已由 C4 的 'trending'
 * 规则（排在 'github' 规则之前）命中、解析为 github-trending.svg，
 * 本文件 Trending 期望已随 C4（2026-11-19）同步改。
 *
 * 深色事实钉死（只记、不加底块、不改组件）：
 * - github.svg 为 #24292E 深色标透明底，深色下对比度弱是已知局限
 *   （同 Cline / Copilot）。
 * - trae.png 为不透明黑底 RGB（IHDR 色彩类型 2），双主题下均显示为
 *   黑色方块标，是已知局限。
 * - elevenlabs.svg 白底为标识自带底色（白底圆角方 + 两条黑色竖杠），
 *   原样呈现，双主题可用。
 * - douyin.png 为黑底标（自带黑底，双主题可用，原样呈现）。
 * - zhipu.png 自带白底不透明，双主题可用。
 * - 其余光栅站自带彩色底（淘宝橙底、京东红底、快手橙底、哔哩哔哩蓝底、
 *   飞书透明底三瓣标除外、Stack Overflow 满幅橙底、知乎蓝底、小红书红底、
 *   豆瓣绿字透明底），不处理。
 * 京东取帧提醒：ICO 最大帧为第 7 帧 48×48 32bpp，PIL 默认帧是 4bpp
 * 抖动帧，复核不要用 PIL 默认帧。
 */

const CASES: Array<{ url: string; title: string; customIcon?: string; expected: string }> = [
  // G1：域名映射；www.perplexity.ai 去 www 后命中 perplexity.ai 键
  { url: 'https://www.perplexity.ai/', title: 'Perplexity', customIcon: 'https://www.perplexity.ai/favicon.ico', expected: '/brand-icons/perplexity.svg' },
  { url: 'https://elevenlabs.io', title: 'ElevenLabs', customIcon: 'https://elevenlabs.io/favicon.ico', expected: '/brand-icons/elevenlabs.svg' },
  { url: 'https://huggingface.co', title: 'Hugging Face', customIcon: 'https://huggingface.co/favicon.ico', expected: '/brand-icons/huggingface.png' },
  { url: 'https://suno.com', title: 'Suno', customIcon: 'https://suno.com/favicon.ico', expected: '/brand-icons/suno.png' },
  // G2：域名映射 3 站 + GitHub 标题规则
  { url: 'https://chatglm.cn', title: '智谱清言', customIcon: 'https://chatglm.cn/favicon.ico', expected: '/brand-icons/zhipu.png' },
  { url: 'https://xinghuo.xfyun.cn', title: '讯飞星火', customIcon: 'https://xinghuo.xfyun.cn/favicon.ico', expected: '/brand-icons/xinghuo.png' },
  { url: 'https://n8n.io', title: 'n8n', customIcon: 'https://n8n.io/favicon.ico', expected: '/brand-icons/n8n.png' },
  { url: 'https://github.com', title: 'GitHub', customIcon: 'https://github.com/favicon.ico', expected: '/brand-icons/github.svg' },
  // Trending 由 C4 的 'trending' 规则（排在 'github' 规则之前）命中；期望已随 C4 同步改
  { url: 'https://github.com/trending', title: 'GitHub Trending', customIcon: 'https://github.com/favicon.ico', expected: '/brand-icons/github-trending.svg' },
  // Copilot 由上方 'copilot' 规则先行命中，不受 github 规则影响，作回归钉死
  { url: 'https://github.com/features/copilot', title: 'GitHub Copilot', customIcon: 'https://github.com/favicon.ico', expected: '/brand-icons/copilot.svg' },
  // G3：域名映射；淘宝/京东/抖音/快手/哔哩哔哩的 customIcon 均为远端 …/favicon.ico
  { url: 'https://www.taobao.com', title: '淘宝', customIcon: 'https://taobao.com/favicon.ico', expected: '/brand-icons/taobao.png' },
  { url: 'https://www.jd.com/?cu=true', title: '京东', customIcon: 'https://jd.com/favicon.ico', expected: '/brand-icons/jd.png' },
  { url: 'https://www.douyin.com', title: '抖音', customIcon: 'https://www.douyin.com/favicon.ico', expected: '/brand-icons/douyin.png' },
  { url: 'https://www.kuaishou.com', title: '快手', customIcon: 'https://www.kuaishou.com/favicon.ico', expected: '/brand-icons/kuaishou.png' },
  { url: 'https://www.bilibili.com', title: '哔哩哔哩', customIcon: 'https://bilibili.com/favicon.ico', expected: '/brand-icons/bilibili.png' },
  // G4：域名映射
  { url: 'https://www.feishu.cn', title: '飞书', customIcon: 'https://www.feishu.cn/favicon.ico', expected: '/brand-icons/feishu.png' },
  { url: 'https://stackoverflow.com', title: 'Stack Overflow', customIcon: 'https://stackoverflow.com/favicon.ico', expected: '/brand-icons/stackoverflow.png' },
  { url: 'https://www.zhihu.com', title: '知乎', customIcon: 'https://zhihu.com/favicon.ico', expected: '/brand-icons/zhihu.png' },
  { url: 'https://www.douban.com', title: '豆瓣', customIcon: 'https://douban.com/favicon.ico', expected: '/brand-icons/douban.png' },
  { url: 'https://www.xiaohongshu.com', title: '小红书', customIcon: 'https://xiaohongshu.com/favicon.ico', expected: '/brand-icons/xiaohongshu.png' },
  // Trae 补救：域名映射；trae.ai 不在站内，不加键
  { url: 'https://www.trae.cn', title: 'Trae', customIcon: 'https://www.trae.cn/favicon.ico', expected: '/brand-icons/trae.png' },
]

const LOCAL_ASSETS: Array<{ name: string; width: number; height: number }> = [
  // SVG 原样（无 PNG 尺寸钉死，见下方 SVG 断言）
  { name: 'perplexity.svg', width: 0, height: 0 },
  { name: 'elevenlabs.svg', width: 0, height: 0 },
  { name: 'github.svg', width: 0, height: 0 },
  // PNG：≥128 源缩到 128，<128 源原样不放大
  { name: 'huggingface.png', width: 128, height: 128 },
  { name: 'suno.png', width: 128, height: 128 },
  { name: 'zhipu.png', width: 64, height: 64 },
  { name: 'xinghuo.png', width: 32, height: 32 },
  { name: 'n8n.png', width: 48, height: 48 },
  { name: 'taobao.png', width: 114, height: 114 },
  { name: 'jd.png', width: 48, height: 48 },
  { name: 'douyin.png', width: 32, height: 32 },
  { name: 'kuaishou.png', width: 32, height: 32 },
  { name: 'bilibili.png', width: 32, height: 32 },
  { name: 'feishu.png', width: 128, height: 128 },
  { name: 'stackoverflow.png', width: 128, height: 128 },
  { name: 'zhihu.png', width: 128, height: 128 },
  { name: 'douban.png', width: 32, height: 32 },
  { name: 'xiaohongshu.png', width: 32, height: 32 },
  { name: 'trae.png', width: 128, height: 128 },
]

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG 魔数 8 字节 + IHDR：宽（offset 16，BE u32）、高（offset 20，BE u32）
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（图标修复 C 类第 1 批）', () => {
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

  it('单站落盘 ≤ ~15KB', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name } of LOCAL_ASSETS) {
      expect(statSync(`${dir}${name}`).size, name).toBeLessThanOrEqual(15 * 1024)
    }
  })

  it('深色事实钉死：github.svg 为 #24292E 深色标透明底', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const text = readFileSync(`${dir}github.svg`, 'utf8')
    expect(text.includes('#24292E')).toBe(true)
  })

  it('深色事实钉死：trae.png 为不透明黑底 RGB（IHDR 色彩类型 2，无 alpha 通道）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const buf = readFileSync(`${dir}trae.png`)
    // IHDR：色彩类型在 offset 25；2 = 真彩色 RGB（不透明），6 = RGBA
    expect(buf[25]).toBe(2)
  })

  it('深色事实钉死：elevenlabs.svg 白底为标识自带底色（白底圆角方 + 两条黑色竖杠）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const text = readFileSync(`${dir}elevenlabs.svg`, 'utf8')
    expect(text.includes('<svg')).toBe(true)
    expect(text.includes('rx="100"')).toBe(true)
  })
})
