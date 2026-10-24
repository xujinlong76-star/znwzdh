/**
 * 概览页与设置页对「同一份偏好」口径一致（2026-10-25 run45）。
 *
 * 真实缺陷（本轮 §7 逐行读出来，比账本原记更重一档）：
 * `/api/me` 的载荷就是 overview + settings，而共用概览钩子在两条路径上无条件
 * `writeLocalUserSettings(云端值)`（原 use-me-overview.ts:76 / :87）。`user_settings`
 * 无行时服务端按既有契约返回**默认值 + updatedAt:0**
 * （packages/store/src/repository/settings.ts:149-156，run43 已把它钉成契约用例），
 * 于是「登录后第一次打开 /me（或 /me/account、/me/plugins）」就把匿名期攒下的偏好
 * 冲成默认值 —— 而 writeLocalUserSettings 顺手打上 updatedAt=now（user-settings.ts:271），
 * 连「本机存过真实偏好」这个判断依据一起抹掉。结果 run43 设置页那句修复也失效：
 * 用户先看过概览，设置页再交接时上传的已经是默认值。
 *
 * 本文件锁四层：
 *   1. 口径只有一份：判定 + 上云 + 文案 + 埋点全在 lib/me-settings-save 的
 *      hydrateSettingsFromCloud 里，两个钩子都调它，任何钩子里再出现字面量比较都会红；
 *   2. 失败不覆盖：交接失败时返回的必须是本机那一份，localStorage 里也还是那一份；
 *   3. 云端有行才是「以云端为准」，且这条路径不发写请求、不上报埋点；
 *   4. 埋点词表两侧一致（服务端不在名单里的 kind 直接 400），正文只有 kind/outcome/code/anonId。
 * 镜像到 apps/web/test 后由根 vitest 执行。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const mockedGetIdentity = vi.hoisted(() => vi.fn((): string => 'anon-mehydrate01234567'))
vi.mock('../src/lib/identity', () => ({ getIdentity: mockedGetIdentity }))

const { hydrateSettingsFromCloud, SETTINGS_HANDOFF_ERROR, SETTINGS_HANDOFF_NOTICE, shouldUploadLocalSettingsFirst } =
  await import('../src/lib/me-settings-save')
const { settingsHandoffTelemetryVocabulary, trackSettingsHandoffEvent } = await import('../src/lib/navhub-api')
const { USER_SETTINGS_STORAGE_KEY, normalizeUserSettings, readLocalUserSettings } = await import(
  '../src/lib/user-settings'
)

const HERE = dirname(fileURLToPath(import.meta.url))

/** 读 overlay 源文件正文；镜像副本（apps/web/**）不会被误当成源 */
function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return readFileSync(hit, 'utf8')
}

const overviewHook = overlayFile('src/hooks/use-me-overview.ts')
const settingsHook = overlayFile('src/hooks/use-me-settings.ts')
const saveLib = overlayFile('src/lib/me-settings-save.ts')
const meView = overlayFile('src/app/me/me-view.tsx')
const serverTelemetry = resolveApiSource('apps/api/src/routes/telemetry.ts')

/** 服务端源码从两个根都能走到仓库根（apps/web-overlay/test 与 apps/web/test 深度相同） */
function resolveApiSource(rel: string): string {
  const p = resolve(HERE, '..', '..', '..', rel)
  if (!existsSync(p)) throw new Error(`找不到服务端源码：${p}`)
  return readFileSync(p, 'utf8')
}

/** 从源码里抠出一个数组字面量的字符串集合（白名单是路由闭包里的局部常量，不导出） */
function constArrayLiterals(source: string, declaration: string): string[] {
  const start = source.indexOf(declaration)
  if (start < 0) throw new Error(`找不到声明：${declaration}`)
  const open = source.indexOf('[', start)
  const close = source.indexOf(']', open)
  if (open < 0 || close < 0) throw new Error(`声明不是数组字面量：${declaration}`)
  return [...source.slice(open, close).matchAll(/"([a-z_]+)"|'([a-z_]+)'/g)].map((m) => m[1] ?? m[2]!)
}

/** 匿名期攒下的偏好：卡片密度紧凑、0-RTT 关掉，与默认值明显不同 */
const LOCAL_PREFS = { ...normalizeUserSettings({ cardDensity: 'compact', speculativeZeroRttEnabled: false }), updatedAt: 1_700_000_000_000 }
/** 云端无行时服务端返回的那一份（默认值 + updatedAt:0） */
const CLOUD_NO_ROW = normalizeUserSettings({})
const CLOUD_WITH_ROW = normalizeUserSettings({ cardDensity: 'cozy', telemetryEnabled: false, updatedAt: 1_600_000_000_000 })

let store: Map<string, string>
let fetchCalls: { url: string; init?: RequestInit }[]
let eventBodies: Record<string, unknown>[]

function lastEventBody(): Record<string, unknown> {
  const ev = eventBodies[eventBodies.length - 1]
  if (!ev) throw new Error('没有埋点请求发出')
  return ev
}

beforeEach(() => {
  store = new Map()
  fetchCalls = []
  eventBodies = []
  const localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  }
  // 概览钩子与埋点都只在浏览器里跑；node 环境下生产代码会直接 return
  vi.stubGlobal('window', { localStorage, dispatchEvent: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      fetchCalls.push({ url, init })
      // hubUrl 会把 /api 前缀归一成 BASE：埋点实际落在 /api/hub/events
      if (url.includes('/events')) {
        eventBodies.push(JSON.parse(String(init?.body ?? '{}')))
        return new Response(JSON.stringify({ ok: true }), { status: 202, headers: { 'Content-Type': 'application/json' } })
      }
      // PATCH /api/me/settings 的默认回答：把本机那一份原样回读（服务端落库后返回值）
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
      return new Response(JSON.stringify({ settings: { ...LOCAL_PREFS, ...body, updatedAt: 1_700_000_000_001 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
  store.set(USER_SETTINGS_STORAGE_KEY, JSON.stringify(LOCAL_PREFS))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('交接判定：口径只有一份实现', () => {
  it('判定函数仍然只在 lib 里导出，两个钩子都不再自带字面量比较', () => {
    expect(saveLib).toContain('export function shouldUploadLocalSettingsFirst')
    for (const [name, src] of [['概览钩子', overviewHook], ['设置钩子', settingsHook]] as const) {
      expect(src).toContain('hydrateSettingsFromCloud')
      // 第二份 `cloud.updatedAt === 0` 就是漂移的开始
      expect(src, name + ' 不该自己比较 updatedAt').not.toContain('cloud.updatedAt === 0')
    }
  })

  it('概览钩子彻底不再无条件把云端值写进本机', () => {
    // 修复前的两处覆盖点（load 与 initialOverview 注入）都必须消失
    expect(overviewHook).not.toContain('writeLocalUserSettings(normalizeUserSettings(data.settings))')
    expect(overviewHook).not.toContain('writeLocalUserSettings(normalizeUserSettings(initialOverview.settings))')
    expect(overviewHook).not.toContain('writeLocalUserSettings(cloud)')
  })

  it('本机快照在任何写本机之前读取（判定依据不能已被覆盖）', () => {
    const snapshotAt = overviewHook.indexOf('const localBefore = readLocalUserSettings()')
    const hydrateAt = overviewHook.indexOf('await hydrate(data.settings, localBefore)')
    expect(snapshotAt).toBeGreaterThan(-1)
    expect(hydrateAt).toBeGreaterThan(snapshotAt)
  })

  it('SSR 注入路径同样只经统一口径（不允许同步覆盖那一份留在效果里）', () => {
    const effect = overviewHook.slice(overviewHook.indexOf('useEffect('))
    expect(effect).toContain('await hydrate(initialOverview.settings, readLocalUserSettings())')
    expect(effect).not.toContain('writeLocalUserSettings')
  })
})

describe('交接行为：失败与成功都必须留住本机那一份', () => {
  it('云端无行 + 本机存过 → 先把本机上云，返回的是云端回读值', async () => {
    const res = await hydrateSettingsFromCloud(CLOUD_NO_ROW, LOCAL_PREFS)
    expect(res.handoff).toBe('uploaded')
    expect(res.notice).toBe(SETTINGS_HANDOFF_NOTICE)
    expect(res.error).toBeNull()
    const patch = fetchCalls.find((c) => c.init?.method === 'PATCH')
    expect(patch?.url).toContain('/api/me/settings')
    // 上云的内容必须是本机那一份，而不是云端默认值
    expect(JSON.parse(String(patch?.init?.body))).toMatchObject({ cardDensity: 'compact', speculativeZeroRttEnabled: false })
    expect(res.settings.cardDensity).toBe('compact')
  })

  it('上云失败（断网）→ 原样返回本机值，本机存储一个字段都没被默认值冲掉', async () => {
    vi.mocked(fetch).mockImplementationOnce(async () => {
      throw new TypeError('fetch failed')
    })
    const res = await hydrateSettingsFromCloud(CLOUD_NO_ROW, LOCAL_PREFS)
    expect(res.handoff).toBe('upload_failed')
    expect(res.error).toBe(SETTINGS_HANDOFF_ERROR)
    expect(res.settings).toEqual(LOCAL_PREFS)
    expect(readLocalUserSettings()).toEqual(LOCAL_PREFS)
    expect(JSON.parse(store.get(USER_SETTINGS_STORAGE_KEY)!).cardDensity).toBe('compact')
  })

  it('上云被拒（非 2xx）与断网是两种成因，原因码可分', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        fetchCalls.push({ url, init })
        if (url.includes('/events')) {
          eventBodies.push(JSON.parse(String(init?.body ?? '{}')))
          return new Response('{}', { status: 202 })
        }
        return new Response('{}', { status: 503 })
      }),
    )
    const res = await hydrateSettingsFromCloud(CLOUD_NO_ROW, LOCAL_PREFS)
    expect(res.handoff).toBe('upload_failed')
    expect(lastEventBody()).toMatchObject({ kind: 'settings_handoff', outcome: 'failed', code: 'hub_error' })
  })

  it('云端已有行 → 以云端为准，不发写请求、不上报交接', async () => {
    const res = await hydrateSettingsFromCloud(CLOUD_WITH_ROW, LOCAL_PREFS)
    expect(res.handoff).toBe('none')
    expect(res.notice).toBeNull()
    expect(res.settings.telemetryEnabled).toBe(false)
    expect(fetchCalls.some((c) => c.init?.method === 'PATCH')).toBe(false)
    expect(eventBodies).toHaveLength(0)
  })

  it('首访用户（两边都没有）→ 不触发任何写请求，也不制造漏斗噪声', async () => {
    store.clear()
    const res = await hydrateSettingsFromCloud(CLOUD_NO_ROW, readLocalUserSettings())
    expect(res.handoff).toBe('none')
    expect(fetchCalls.some((c) => c.init?.method === 'PATCH')).toBe(false)
    expect(eventBodies).toHaveLength(0)
  })

  it('shouldUploadLocalSettingsFirst 三态判定本身不变（run43 的口径继续成立）', () => {
    expect(shouldUploadLocalSettingsFirst({ updatedAt: 0 }, { updatedAt: 1_700_000_000_000 })).toBe(true)
    expect(shouldUploadLocalSettingsFirst({ updatedAt: 1_600_000_000_000 }, { updatedAt: 1_700_000_000_000 })).toBe(false)
    expect(shouldUploadLocalSettingsFirst({ updatedAt: 0 }, { updatedAt: 0 })).toBe(false)
  })
})

describe('交接埋点：词表两侧一致且不携带内容', () => {
  it('客户端 kind / outcome 全部在服务端白名单内（不在名单里的 kind 会被 400 丢掉）', () => {
    const serverKinds = constArrayLiterals(serverTelemetry, 'const EVENT_KINDS = [')
    const serverOutcomes = constArrayLiterals(serverTelemetry, 'const EVENT_OUTCOMES = [')
    for (const kind of settingsHandoffTelemetryVocabulary.kinds) {
      expect(serverKinds, kind).toContain(kind)
    }
    for (const outcome of settingsHandoffTelemetryVocabulary.outcomes) {
      expect(serverOutcomes, outcome).toContain(outcome)
    }
    expect([...settingsHandoffTelemetryVocabulary.kinds]).toEqual(['settings_handoff'])
  })

  it('原因码有界：长度 ≤32 且不含任何设置内容', () => {
    for (const code of settingsHandoffTelemetryVocabulary.codes) {
      expect(code.length, code).toBeLessThanOrEqual(32)
      expect(code).not.toMatch(/compact|cozy|true|false|\d{4}/)
    }
  })

  it('埋点正文只有 kind / outcome / code / anonId 四类键，身份走 header', async () => {
    await hydrateSettingsFromCloud(CLOUD_NO_ROW, LOCAL_PREFS)
    expect(Object.keys(lastEventBody()).sort()).toEqual(['anonId', 'kind', 'outcome'])
    const headers = (fetchCalls.find((c) => c.url.includes('/events'))?.init?.headers ?? {}) as Record<string, string>
    expect(headers['X-Navhub-Anon-Id']).toBe('anon-mehydrate01234567')
    eventBodies.length = 0
    trackSettingsHandoffEvent('failed', 'network_unavailable')
    await Promise.resolve()
    expect(Object.keys(lastEventBody()).sort()).toEqual(['anonId', 'code', 'kind', 'outcome'])
  })

  it('交接成功上报 success，且只在交接被尝试时上报', async () => {
    await hydrateSettingsFromCloud(CLOUD_NO_ROW, LOCAL_PREFS)
    expect(lastEventBody()).toMatchObject({ kind: 'settings_handoff', outcome: 'success' })
    expect(eventBodies.filter((b) => b.kind === 'settings_handoff')).toHaveLength(1)
  })
})

describe('概览页接线：把结果说给人看', () => {
  it('展示用的初值同口径：云端无行时用本机值，不用服务端默认值', () => {
    const initializer = meView.slice(meView.indexOf('const [localPrefs'), meView.indexOf('const [verifyNotice'))
    expect(initializer).toContain('shouldUploadLocalSettingsFirst(cloud, local)')
    expect(initializer).toContain('const local = readLocalUserSettings()')
    // 修复前这里是「有注入就信注入」，等于把服务端默认值当成「你的设置」显示
    expect(initializer).not.toMatch(/useState<UserSettingsModel>\(\(\)\s*=>\s*\n?\s*initialOverview/)
  })

  it('成功是常驻 role=status，失败是独立 role=alert + 重试（不在同一元素上切换 role）', () => {
    expect(meView).toContain('settingsNotice &&')
    expect(meView).toContain('settingsError &&')
    const noticeBlock = meView.slice(meView.indexOf('settingsNotice &&'), meView.indexOf('settingsError &&'))
    const alertBlock = meView.slice(meView.indexOf('settingsError &&'), meView.indexOf("{state === 'loading'"))
    expect(noticeBlock).toContain('role="status"')
    expect(noticeBlock).not.toContain('role="alert"')
    expect(alertBlock).toContain('role="alert"')
    expect(alertBlock).not.toContain('role="status"')
    expect(alertBlock).toContain('reloadOnce()')
    expect(alertBlock).toContain('重试同步')
  })

  it('交接结论不再靠概览钩子自己造文案（两份文案必然漂移）', () => {
    expect(overviewHook).not.toContain('已把你在本机保存的偏好同步到云端')
    expect(settingsHook).not.toContain('已把你在本机保存的偏好同步到云端')
    expect(saveLib).toContain('已把你在本机保存的偏好同步到云端')
  })
})
