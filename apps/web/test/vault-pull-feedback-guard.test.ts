/**
 * 云端金库「拉取失败」与「对表播报」的反馈完整性守卫（run68）。
 *
 * 真实缺口（2026-10-26 run67 复核，证据 E1–E11）：
 *   - `syncFromCloudVault` 不传 `fetchCloudVault` 的 onDegraded 回调，网络/5xx 与
 *     「云端确实没有备份」都折成 null，一律报 no_vault —— 中枢一挂，用户被告知
 *     「你的备份不存在」；
 *   - 弹窗所有拉取失败共用一句 toast「云端拉取或解密校验失败」，code 只进埋点，
 *     界面上没有下一步（密码错 / 没备份 / 断网三种纠正动作完全不同）；
 *   - 对表是裸 `.then`：先发的慢响应可以覆盖后发的结论，且徽章是普通 span，
 *     读屏收不到任何状态变化；对表失败还会把上次已知版本号一起抹掉。
 *
 * 本文件锁四层（A1–A11）：
 *   1. io：四类失败各有独立 code，degraded 绝不冒充 no_vault；
 *   2. 文案：一个 code 一种标题 + 一个可执行纠正动作（纯函数全分支）；
 *   3. 徽章：对表失败保留 last-known 版本，不退回「云端暂无备份」；
 *   4. 弹窗源码：持久 role=alert、live region、aria-busy、禁用原因与 aria-describedby、
 *      对表走 settleLatest。镜像到 apps/web/test 后由根 vitest 执行。
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { VaultResultCode } from '../src/lib/navhub-api'

const mockedGetIdentity = vi.hoisted(() => vi.fn((): string => 'anon-pullguard01234567'))
vi.mock('../src/lib/identity', () => ({ getIdentity: mockedGetIdentity }))
vi.mock('../src/lib/vault', () => ({
  encryptGenericPayload: async () => ({ cipherTextBase64: 'Z3VhcmQ=', ivHex: 'aa', saltHex: 'bb' }),
  decryptGenericPayload: async () => {
    throw new Error('主密码不匹配或密文已被篡改')
  },
}))

const { syncFromCloudVault } = await import('../src/lib/modular/home-diy-io')
const { cloudPullFailureNotice, cloudVaultBadgeLabel, mergeCloudVaultMeta } = await import(
  '../src/lib/modular/vault-copy'
)

const HERE = dirname(fileURLToPath(import.meta.url))

/** 定位 overlay 里的源文件；镜像副本（apps/web/**）不会被误当成源 */
function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return hit
}

const originalFetch = globalThis.fetch
let fetchCalls: string[] = []

function stubFetch(handler: (url: string, init: any) => { status: number; body: unknown }) {
  fetchCalls = []
  globalThis.fetch = (async (input: unknown, init?: any) => {
    fetchCalls.push(String(input))
    const res = handler(String(input), init)
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      text: async () => JSON.stringify(res.body),
      json: async () => res.body,
    } as unknown as Response
  }) as typeof fetch
}

const persist = vi.fn()

beforeEach(() => {
  mockedGetIdentity.mockReturnValue('anon-pullguard01234567')
})

afterEach(() => {
  globalThis.fetch = originalFetch
  persist.mockClear()
})

describe('拉取失败的四类事实各有独立 code（A1）', () => {
  it('中枢 5xx → check_failed，绝不冒充「云端没有备份」', async () => {
    stubFetch(() => ({ status: 503, body: { error: '存储层读取失败' } }))
    const res = await syncFromCloudVault('sup3rsecret', persist)
    expect(res.success).toBe(false)
    expect(res.code).toBe('check_failed')
    expect(res.error).toContain('没查到')
    expect(persist).not.toHaveBeenCalled()
  })

  it('200 + vault:null → no_vault（服务端「真的没有」的唯一口径）', async () => {
    stubFetch(() => ({ status: 200, body: { ok: true, vault: null } }))
    const res = await syncFromCloudVault('sup3rsecret', persist)
    expect(res.success).toBe(false)
    expect(res.code).toBe('no_vault')
  })

  it('密文包合法但解不开 → decrypt_failed（不是「没备份」也不是「没查到」）', async () => {
    stubFetch(() => ({
      status: 200,
      body: {
        ok: true,
        vault: {
          userId: 'anon-pullguard01234567',
          payload: JSON.stringify({
            cipherTextBase64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
            ivHex: '00112233445566778899aabb',
            saltHex: 'ff'.repeat(16),
          }),
          version: 2,
          updatedAt: 1,
        },
      },
    }))
    const res = await syncFromCloudVault('wrongpassphrase', persist)
    expect(res.success).toBe(false)
    expect(res.code).toBe('decrypt_failed')
    expect(persist).not.toHaveBeenCalled()
  })

  it('取不到本机身份 → no_identity，且一个请求都不发', async () => {
    stubFetch(() => ({ status: 200, body: { ok: true, vault: null } }))
    mockedGetIdentity.mockReturnValue('')
    const res = await syncFromCloudVault('sup3rsecret', persist)
    expect(res.code).toBe('no_identity')
    expect(fetchCalls).toHaveLength(0)
  })

  it('四类结果互不等于 no_vault（旧实现把它们全折成它）', async () => {
    stubFetch(() => ({ status: 500, body: { error: 'boom' } }))
    const serverDown = await syncFromCloudVault('sup3rsecret', persist)
    stubFetch(() => ({ status: 200, body: { ok: true, vault: null } }))
    const trulyAbsent = await syncFromCloudVault('sup3rsecret', persist)
    expect(serverDown.code).not.toBe(trulyAbsent.code)
  })
})

describe('cloudPullFailureNotice：一个 code 一种标题 + 一个可执行纠正（A2）', () => {
  const cases: [VaultResultCode, string, string][] = [
    ['check_failed', '这次没查到云端状态', 'retry'],
    ['hub_error', '这次没查到云端状态', 'retry'],
    ['no_vault', '云端确实没有备份', 'create-first'],
    ['no_identity', '没取到本机身份', 'restore-identity'],
    ['decrypt_failed', '主密码不对，或密文已损坏', 'fix-passphrase'],
    ['passphrase_rejected', '主密码不对，或密文已损坏', 'fix-passphrase'],
    ['invalid_cipher_package', '云端密文格式不受支持', 'use-local-export'],
    ['invalid_json', '云端密文格式不受支持', 'use-local-export'],
    ['validation_failed', '云端密文格式不受支持', 'use-local-export'],
  ]

  it.each(cases)('%s → 「%s」/ %s', (code, title, action) => {
    const notice = cloudPullFailureNotice(code)
    expect(notice.title).toBe(title)
    expect(notice.action).toBe(action)
    expect(notice.description.length).toBeGreaterThan(20)
  })

  it('四类事实的标题互不相同（没有一句兜底吃遍所有失败）', () => {
    const titles = new Set([
      cloudPullFailureNotice('check_failed').title,
      cloudPullFailureNotice('no_vault').title,
      cloudPullFailureNotice('no_identity').title,
      cloudPullFailureNotice('decrypt_failed').title,
      cloudPullFailureNotice('invalid_cipher_package').title,
    ])
    expect(titles.size).toBe(5)
  })

  it('未知/缺失 code 仍有可执行兜底，但标题不是旧的泛化句', () => {
    const notice = cloudPullFailureNotice(undefined)
    expect(notice.title).not.toBe('云端拉取或解密校验失败')
    expect(notice.title).toContain('云端拉取')
    expect(notice.action).toBe('retry')
    expect(notice.description).toContain('.enc.json')
  })

  it('「云端确实没有备份」的纠正动作是建立第一份，而不是反复重试', () => {
    const notice = cloudPullFailureNotice('no_vault')
    expect(notice.action).toBe('create-first')
    expect(notice.description).toContain('加密同步至云端')
  })
})

describe('对表失败保留上次已知版本（A11）', () => {
  it('先成功得到 v3，再失败 → 徽章说「上次对表 v3」，不退回「暂无备份」', () => {
    const lastKnown = { hasCloudVault: true, version: 3, updatedAt: 99, code: 'has_vault' as const }
    const failed = mergeCloudVaultMeta(lastKnown, { hasCloudVault: false, code: 'check_failed' as const })
    expect(failed).toEqual({ hasCloudVault: true, version: 3, updatedAt: 99, code: 'check_failed' })
    expect(cloudVaultBadgeLabel(failed)).toBe('云端状态未知（上次对表 v3）')
    expect(cloudVaultBadgeLabel(failed)).not.toContain('暂无备份')
  })

  it('从未查到过 → 没有 last-known，也不冒充「没有备份」', () => {
    const failed = mergeCloudVaultMeta(null, { hasCloudVault: false, code: 'check_failed' as const })
    expect(failed).toEqual({ hasCloudVault: false, code: 'check_failed' })
    expect(cloudVaultBadgeLabel(failed)).toBe('云端状态未知：对表失败')
    expect(cloudVaultBadgeLabel(failed)).not.toContain('暂无备份')
  })

  it('非 check_failed 的结果原样落库（不拿旧版本号污染新事实）', () => {
    expect(mergeCloudVaultMeta({ hasCloudVault: true, version: 3 }, { hasCloudVault: false, code: 'no_vault' })).toEqual({
      hasCloudVault: false,
      code: 'no_vault',
    })
    expect(mergeCloudVaultMeta(null, { hasCloudVault: true, version: 7, code: 'has_vault' })).toEqual({
      hasCloudVault: true,
      version: 7,
      code: 'has_vault',
    })
  })

  it('徽章四态：对表中 / 未对表 / 有备份 / 确实没有', () => {
    expect(cloudVaultBadgeLabel(null, true)).toBe('正在与云端对表…')
    expect(cloudVaultBadgeLabel(null)).toBe('尚未与云端对表')
    expect(cloudVaultBadgeLabel({ hasCloudVault: true, version: 4, code: 'has_vault' })).toBe('云端金库 v4')
    expect(cloudVaultBadgeLabel({ hasCloudVault: true, code: 'has_vault' })).toBe('云端有备份（版本号未知）')
    expect(cloudVaultBadgeLabel({ hasCloudVault: false, code: 'no_vault' })).toBe('云端暂无备份')
    expect(cloudVaultBadgeLabel({ hasCloudVault: false, code: 'no_identity' })).toBe('未取到本机身份')
  })
})

describe('弹窗源码钉子（A3/A4/A5/A6）', () => {
  const dialog = () => readFileSync(overlayFile('src/components/home-diy-backup-dialog.tsx'), 'utf8')

  it('拉取失败是持久 role=alert 块，位置在操作按钮之后、冲突块之前', () => {
    const src = dialog()
    const alertAt = src.indexOf('{cloudPullNotice ? (')
    const buttonsAt = src.indexOf('aria-describedby="cloud-action-hint"')
    const conflictAt = src.indexOf('{vaultConflict ? (')
    expect(alertAt).toBeGreaterThan(buttonsAt)
    expect(conflictAt).toBeGreaterThan(alertAt)
    expect(src.slice(alertAt, alertAt + 200)).toContain('role="alert"')
    expect(src.slice(alertAt, alertAt + 200)).toContain('border-red-500/35')
  })

  it('按 action 给出可执行按钮：重试拉取 / 建立第一份 / 换主密码 / 选本地密文', () => {
    const src = dialog()
    expect(src).toContain("cloudPullNotice.action === 'retry'")
    expect(src).toContain("cloudPullNotice.action === 'create-first'")
    expect(src).toContain("cloudPullNotice.action === 'fix-passphrase'")
    expect(src).toContain("cloudPullNotice.action === 'use-local-export'")
    expect(src).toContain("'重试拉取'")
    expect(src).toContain('passphraseInputRef.current?.focus()')
  })

  it('旧的泛化失败 toast 已删除（失败只走持久块，不再弹一句话了事）', () => {
    expect(dialog()).not.toContain('云端拉取或解密校验失败')
  })

  it('重开面板 / 切 tab / 改主密码都会清掉上一条拉取失败', () => {
    const src = dialog()
    const clearEffect = src.slice(src.indexOf('// 重开面板或切 tab'), src.indexOf('const handleCloudUpload'))
    expect(clearEffect).toContain('setVaultPullFailure(null)')
    expect(clearEffect).toContain('[open, backupTab]')
    const passBlock = src.slice(src.indexOf('setVaultPassphrase(e.target.value)'), src.indexOf('setVaultPassphrase(e.target.value)') + 220)
    expect(passBlock).toContain('setVaultPullFailure(null)')
  })

  it('徽章是 live region：role=status + aria-live + aria-busy（A4）', () => {
    const src = dialog()
    const badge = src.slice(src.indexOf('role="status"'), src.indexOf('role="status"') + 900)
    expect(badge).toContain('aria-live="polite"')
    expect(badge).toContain('aria-busy={isCheckingCloud}')
    expect(badge).toContain('{cloudBadgeLabel}')
    expect(src).toContain('cloudVaultBadgeLabel(cloudVaultMeta, isCheckingCloud)')
  })

  it('两个主按钮都由 cloud-action-hint 解释禁用原因，拉取中改文案（A5）', () => {
    const src = dialog()
    expect((src.match(/aria-describedby="cloud-action-hint"/g) ?? []).length).toBe(2)
    expect(src).toContain('id="cloud-action-hint"')
    expect(src).toContain("isPullingCloud ? '拉取中...'")
    expect(src).toContain('正在从云端拉取并逐条还原，完成前同步与删除不可用。')
    expect(src).toContain('正在与云端同步或对表，完成前拉取与删除不可用。')
    expect(src).toContain('先在上方输入金库主密码')
  })

  it('对表一律走 settleLatest，且先判 stale 再写状态（A6）', () => {
    const src = dialog()
    expect(src).toContain('settleLatest(cloudMetaGate, () => checkCloudVaultStatus())')
    expect(src).toContain("if (out.status === 'stale') return undefined")
    // 旧的裸 then 写法不得回来
    expect(src).not.toContain('void checkCloudVaultStatus().then(')
  })

  it('对表失败时删除入口继续隐藏（last-known 有备份也不放行删除）', () => {
    expect(dialog()).toContain(
      "const cloudVaultPresent = !!cloudVaultMeta?.hasCloudVault && cloudVaultMeta.code !== 'check_failed'",
    )
  })
})

// mock 卫生（D2）：清除本文件的模块 mock 缓存，避免驻留同 worker 的后续文件
afterAll(() => {
  vi.resetModules()
})
