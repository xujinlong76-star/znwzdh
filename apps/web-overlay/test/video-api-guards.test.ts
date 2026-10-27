import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * 源码守卫：这轮的几个修复都是「一行改错就静默失效」的类型，行为测试很难覆盖
 * （要么需要起服务 + 登录态，要么需要构造并发写入）。用最直接的方式守住：
 * 读源码，断言错误写法不再出现。
 *
 * 本仓已有同类先例（`video-items-honesty.test.ts` 就是读源码断言失败分支顺序）。
 */

function src(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), 'utf8')
}

/** 去掉注释，避免「注释里写了旧代码」导致守卫误判 */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('租约锁：acquire 与 release 必须用同一个 owner', () => {
  const code = stripComments(src('lib/video-task-queue.ts'))

  it('不存在 releaseLock(task.id) 这种 owner 不匹配的写法', () => {
    // 旧实现：acquireLock(`worker_${Date.now()}`) 配 releaseLock(task.id)
    // → owner 永不相等 → 锁只能等 5 分钟 TTL 过期
    expect(code).not.toMatch(/releaseLock\(\s*task\.id\s*\)/)
  })

  it('同一函数内先声明 lockOwner，再用于 acquire 与 release', () => {
    expect(code).toMatch(/const\s+lockOwner\s*=/)
    expect(code).toMatch(/acquireLock\(\s*lockOwner\s*\)/)
    expect(code).toMatch(/releaseLock\(\s*lockOwner\s*\)/)
  })

  it('长任务会续租，避免 TTL 到期后互斥失效', () => {
    expect(code).toMatch(/renewLock\(/)
  })
})

describe('Cron 端点：fail-closed 且不接受 ?secret=', () => {
  const files = [
    'app/api/cron/video-harvest/route.ts',
    'app/api/cron/video-health-sweep/route.ts',
  ]

  for (const file of files) {
    it(`${file} 走 requireCronSecret`, () => {
      const code = stripComments(src(file))
      expect(code).toMatch(/requireCronSecret/)
      expect(code).not.toMatch(/searchParams\.get\(['"]secret['"]\)/)
      // 旧写法：if (cronSecret && providedSecret !== cronSecret)
      expect(code).not.toMatch(/if\s*\(\s*cronSecret\s*&&/)
    })
  }

  it('health-sweep 读写的是视频库，不是站点导航', () => {
    // 去注释后判断：注释里会提到这个错误路径作为历史说明
    const code = stripComments(src('app/api/cron/video-health-sweep/route.ts'))
    expect(code).toContain("'src/navsphere/content/videos.json'")
    expect(code).not.toContain("'data/navigation.json'")
  })

  it('health-sweep 落盘的是 updatedData（prune 与 healthStatus 才生效）', () => {
    const code = stripComments(src('app/api/cron/video-health-sweep/route.ts'))
    expect(code).toMatch(/const\s*\{\s*report,\s*updatedData\s*\}/)
    expect(code).toMatch(/JSON\.stringify\(updatedData/)
  })
})

describe('鉴权：可写入口不得匿名开放', () => {
  it('ai-autonomous-harvest 的 GET 与 POST 都校验管理员会话', () => {
    const code = stripComments(src('app/api/videos/ai-autonomous-harvest/route.ts'))
    const getBlock = code.slice(code.indexOf('export async function GET'), code.indexOf('export async function POST'))
    const postBlock = code.slice(code.indexOf('export async function POST'))
    expect(getBlock).toMatch(/verifyAdminSession/)
    expect(postBlock).toMatch(/verifyAdminSession/)
  })

  it('webhook-harvest 未配置密钥时直接 503，且不再有硬编码默认密钥', () => {
    const code = stripComments(src('app/api/videos/webhook-harvest/route.ts'))
    expect(code).not.toContain('navhub_video_webhook_secret_2026')
    expect(code).toMatch(/503/)
    expect(code).toMatch(/NAVHUB_VIDEO_WEBHOOK_SECRET/)
  })

  it('webhook 用原始 body 验签（不是 JSON.stringify(parsed)）', () => {
    const code = stripComments(src('app/api/videos/webhook-harvest/route.ts'))
    expect(code).toMatch(/await request\.text\(\)/)
    expect(code).toMatch(/processWebhook\([^)]*rawBody/)
  })
})

describe('验签：不得回退到伪哈希', () => {
  const code = stripComments(src('lib/video-multi-source-connector.ts'))

  it('不再有 includes(simulatedHex) 这类子串匹配', () => {
    expect(code).not.toMatch(/includes\(\s*simulatedHex/)
    expect(code).not.toMatch(/hash\s*<<\s*5/)
  })

  it('委托给 webhook-signature 的真 HMAC 实现', () => {
    expect(code).toMatch(/verifyHmacSha256/)
  })

  it('processWebhook 的签名是必填（fail-closed）', () => {
    // 旧写法：if (signature && !verify(...)) —— 不带签名直接放行
    expect(code).not.toMatch(/if\s*\(\s*signature\s*&&\s*!verify/)
    expect(code).toMatch(/verifyWebhookSignature\(signingInput,\s*signature\s*\?\?\s*['"]{2}/)
  })
})

describe('单条编辑不得丢弃顶层字段', () => {
  const code = stripComments(src('app/api/videos/[id]/items/route.ts'))

  it('写盘时展开原数据，只替换 navigationItems', () => {
    const stringifies = code.match(/JSON\.stringify\([^)]*navigationItems[^)]*\)/g) ?? []
    expect(stringifies.length).toBeGreaterThanOrEqual(3)
    for (const call of stringifies) {
      expect(call, `写盘语句丢了顶层字段：${call}`).toMatch(/\.\.\.data/)
    }
  })
})

describe('采集失败必须可见', () => {
  it('harvestVideosForTopic 记录 failures 而不是只 console.warn', () => {
    const code = stripComments(src('lib/video-harvester.ts'))
    expect(code).toMatch(/failures\?\.push/)
    expect(code).toMatch(/degradedKeywords/)
  })

  it('不再用 results.length 做跨关键词的 break（会超额采集）', () => {
    const code = stripComments(src('lib/video-harvester.ts'))
    expect(code).not.toMatch(/results\.length\s*>=\s*limitPerKeyword\s*\*\s*keywords\.length/)
  })
})
