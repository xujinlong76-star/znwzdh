/**
 * 首页影院区首张海报的服务端读取（升级第 1 条：影院区 LCP）。
 *
 * 只在服务端用（本目录是服务端取数约定，客户端不要 import——node:fs 在
 * 浏览器 bundle 里不存在）。首张海报是 data URI（约 40KB），只把这一张当
 * prop 传下去，首张 <img> 直接进 SSR HTML；其余 5 张图留在客户端懒加载，
 * 不进 RSC payload（整份 JSON 约 216KB，全传会把首页 flight 撑大）。
 *
 * 读不到 / 解析失败 / 形状不对一律返回 null，调用方退化为客户端 fetch
 *（影院组件原有逻辑），不弹错。文件是静态素材、内容不随请求变，进程内
 * 缓存一次读取结果；改图要重新部署，本就是静态资源同一节奏。
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { DramaPoster } from '@/lib/drama-sites'

function isDramaPoster(value: unknown): value is DramaPoster {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.key === 'string' &&
    typeof v.title === 'string' &&
    typeof v.width === 'number' &&
    typeof v.height === 'number' &&
    typeof v.data === 'string' &&
    v.data.length > 0
  )
}

// 候选路径（按顺序试）：Next 服务端进程的 cwd 通常是应用目录
// （apps/web-overlay）；测试与根目录启动时回退到仓库根相对路径。
const CANDIDATES = [
  join('public', 'drama-media.json'),
  join('apps', 'web-overlay', 'public', 'drama-media.json'),
]

let cached: Promise<DramaPoster | null> | null = null

/** 首张海报（posters[0]），读不到返回 null（调用方退化为客户端 fetch）。 */
export function getFirstDramaPoster(): Promise<DramaPoster | null> {
  if (!cached) cached = readFirstPoster()
  return cached
}

async function readFirstPoster(): Promise<DramaPoster | null> {
  for (const rel of CANDIDATES) {
    let raw: string
    try {
      raw = await readFile(join(process.cwd(), rel), 'utf8')
    } catch {
      continue
    }
    // 文件读到了：解析失败或形状不对直接判 null，不再试下一路径
    //（同一份文件不会因路径不同而变形状）。
    try {
      const json = JSON.parse(raw) as { posters?: unknown }
      const first = Array.isArray(json?.posters) ? json.posters[0] : undefined
      return isDramaPoster(first) ? first : null
    } catch {
      return null
    }
  }
  return null
}
