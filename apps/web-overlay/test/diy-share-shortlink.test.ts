/**
 * DIY 分享短链（M6）：完整 `#diy=` 链接之外，再给一个短链选项。
 *
 * 今天的实话（中枢两层把关）：`POST /api/shortlinks` 只认 `/marketplace/`
 * 内、≤500 字符的目标，首页 `#diy=` 目标一定被 400 拒掉。所以这里钉住
 * 的不是「短链一定能生成」，而是三条诚实性：
 * 1. 目标派生是纯的：只取路径 + hash，不带 origin，不丢负载；
 * 2. 请求如实发给中枢、如实翻译中枢的 verdict：400 → unsupported-target，
 *    其余失败 → request-failed，绝不编一个短链出来；
 * 3. 分享对话框里有「复制短链」入口，且短链拿不到时回退复制完整链接、
 *    并说清为什么是长链接（而不是静默失败或谎称已复制短链）。
 *
 * 中枢放开首页目标的那天，同一段调用开始返回真短链——这些测试不用改，
 * 成功那条分支（fake creator 返回 path）已经钉住了成功形态。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { diyShareUrlToShortlinkTarget } from '../src/lib/diy-share-link'
import {
  requestDiyShareShortLink,
  type DiyShortLinkCreator,
} from '../src/lib/modular/home-diy-io'

const HERE = dirname(fileURLToPath(import.meta.url))
/** overlay 与 apps/web 两份布局下都指向包根 */
const ROOT = resolve(HERE, '..')

const LONG_URL = 'https://nav.example/#diy=eyJ2bSI6ImNsYXNzaWMifQ=='

function hubErrorLike(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number }
  err.status = status
  return err
}

describe('diyShareUrlToShortlinkTarget：只取路径 + hash，不带 origin', () => {
  it('完整分享链接 → /#diy=…（origin 剥掉，hash 原样保留）', () => {
    const out = diyShareUrlToShortlinkTarget(LONG_URL)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.target).toBe('/#diy=eyJ2bSI6ImNsYXNzaWMifQ==')
  })

  it('带路径与 query 的分享链接：路径 + query + hash 都保留', () => {
    const out = diyShareUrlToShortlinkTarget('https://nav.example/foo?bar=1#diy=abc123')
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.target).toBe('/foo?bar=1#diy=abc123')
  })

  it('不是 #diy= 链接：拒绝，不去给中枢发一个注定 400 的请求', () => {
    expect(diyShareUrlToShortlinkTarget('https://nav.example/').ok).toBe(false)
    expect(diyShareUrlToShortlinkTarget('https://nav.example/#other=1').ok).toBe(false)
    expect(diyShareUrlToShortlinkTarget('https://nav.example/marketplace/x').ok).toBe(false)
  })

  it('空串 / 非法地址：拒绝，不抛错', () => {
    expect(diyShareUrlToShortlinkTarget('').ok).toBe(false)
    expect(diyShareUrlToShortlinkTarget('not-a-url').ok).toBe(false)
  })
})

describe('requestDiyShareShortLink：如实翻译中枢的 verdict', () => {
  it('成功：返回 <origin>/s/<code>，创建时传的是派生目标', async () => {
    const seen: string[] = []
    const create: DiyShortLinkCreator = async (target) => {
      seen.push(target)
      return { success: true, code: 'abc12345', path: '/s/abc12345', target }
    }
    const res = await requestDiyShareShortLink(LONG_URL, create)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.url).toBe('https://nav.example/s/abc12345')
    expect(seen).toEqual(['/#diy=eyJ2bSI6ImNsYXNzaWMifQ=='])
  })

  it('中枢 400（目标口径不认，今天的 #diy= 一定走到这里）：unsupported-target', async () => {
    const create: DiyShortLinkCreator = async () => {
      throw hubErrorLike(400, '短链目标必须是站内 /marketplace/ 路径')
    }
    const res = await requestDiyShareShortLink(LONG_URL, create)
    expect(res).toEqual({ ok: false, reason: 'unsupported-target' })
  })

  it('5xx / 无 status 的错误 / 非 Error 抛出：一律 request-failed，不猜成口径问题', async () => {
    const failing500: DiyShortLinkCreator = async () => {
      throw hubErrorLike(500, 'boom')
    }
    expect(await requestDiyShareShortLink(LONG_URL, failing500)).toEqual({
      ok: false,
      reason: 'request-failed',
    })
    const failingGeneric: DiyShortLinkCreator = async () => {
      throw new Error('network down')
    }
    expect(await requestDiyShareShortLink(LONG_URL, failingGeneric)).toEqual({
      ok: false,
      reason: 'request-failed',
    })
    const failingString: DiyShortLinkCreator = async () => {
      throw 'boom'
    }
    expect(await requestDiyShareShortLink(LONG_URL, failingString)).toEqual({
      ok: false,
      reason: 'request-failed',
    })
  })

  it('中枢回 success:false / 空 path：request-failed，不拼一个坏链接', async () => {
    const noSuccess: DiyShortLinkCreator = async (target) => ({
      success: false,
      code: '',
      path: '/s/x',
      target,
    })
    expect(await requestDiyShareShortLink(LONG_URL, noSuccess)).toEqual({
      ok: false,
      reason: 'request-failed',
    })
    const emptyPath: DiyShortLinkCreator = async (target) => ({
      success: true,
      code: 'x',
      path: '',
      target,
    })
    expect(await requestDiyShareShortLink(LONG_URL, emptyPath)).toEqual({
      ok: false,
      reason: 'request-failed',
    })
  })

  it('传入的根本不是 #diy= 链接：invalid-share-url，且不发请求', async () => {
    let called = false
    const create: DiyShortLinkCreator = async (target) => {
      called = true
      return { success: true, code: 'x', path: '/s/x', target }
    }
    const res = await requestDiyShareShortLink('https://nav.example/', create)
    expect(res).toEqual({ ok: false, reason: 'invalid-share-url' })
    expect(called).toBe(false)
  })
})

describe('接线守卫：备份对话框里有短链入口，拿不到时回退完整链接', () => {
  const dialog = readFileSync(resolve(ROOT, 'src', 'components', 'home-diy-backup-dialog.tsx'), 'utf8')
  const navhub = readFileSync(resolve(ROOT, 'src', 'lib', 'navhub-api.ts'), 'utf8')

  it('中枢客户端有按目标创建短链的入口（POST /api/shortlinks 的 { target } 形态）', () => {
    expect(navhub).toContain('export async function createShortLinkForTarget(')
    expect(navhub).toContain("sendJson('/api/shortlinks', 'POST', { target })")
  })

  it('对话框有「复制短链」按钮，走 requestDiyShareShortLink', () => {
    expect(dialog).toContain('handleShareShortLink')
    expect(dialog).toContain('requestDiyShareShortLink(')
    expect(dialog).toContain('复制短链')
  })

  it('短链拿不到时回退复制完整链接，并说清为什么是长链接', () => {
    const body = dialog.slice(dialog.indexOf('const handleShareShortLink'))
    // 先拿完整链接（与长链按钮同一来源），短链失败后复制的还是它
    expect(body).toContain('const out = exportPresetToUrlHash()')
    expect(body).toContain('requestDiyShareShortLink(out.url)')
    expect(body).toContain('copyText(out.url)')
    expect(body).toContain('unsupported-target')
    expect(body).toContain('短链服务目前只支持市场插件链接')
  })

  it('短链成功时复制的是短链，不是完整链接', () => {
    const body = dialog.slice(dialog.indexOf('const handleShareShortLink'))
    expect(body).toContain('copyText(short.url)')
    expect(body).toContain('已复制短链')
  })
})
