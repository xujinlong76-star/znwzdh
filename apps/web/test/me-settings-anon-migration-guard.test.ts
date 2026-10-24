import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { shouldUploadLocalSettingsFirst } from '@/lib/me-settings-save'

/**
 * 「本机偏好 → 云端」交接守卫（用户中心批次 run43）。
 *
 * 界面承诺「登录后会自动把本机偏好同步到云端」。这句承诺只有在代码里
 * 真的存在上云路径时才是真话，因此本文件守三件事：
 *   1. 判定逻辑：云端无行（updatedAt === 0）且本机存过设置时才上云，其余情形仍以云端为准；
 *   2. 读取顺序：本机快照必须在任何「写本机」之前取，否则判断依据已被云端值覆盖；
 *   3. 失败诚实：401 不再压平成匿名，保存失败必须带原因且可重试（不再 `catch { return false }`）。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

const hook = read('src/hooks/use-me-settings.ts')
const view = read('src/components/user-center/me-settings-view.tsx')
const saveLib = read('src/lib/me-settings-save.ts')

describe('匿名 → 登录的设置交接判定', () => {
  it('云端无行且本机存过设置 → 先把本机这份交上去', () => {
    expect(shouldUploadLocalSettingsFirst({ updatedAt: 0 }, { updatedAt: 1_700_000_000_000 })).toBe(true)
  })

  it('云端已有落盘记录 → 以云端为准，不再上抛本机值', () => {
    expect(shouldUploadLocalSettingsFirst({ updatedAt: 1_600_000_000_000 }, { updatedAt: 1_700_000_000_000 })).toBe(
      false,
    )
  })

  it('本机也没存过 → 不需要迁移（首访用户不该触发一次写请求）', () => {
    expect(shouldUploadLocalSettingsFirst({ updatedAt: 0 }, { updatedAt: 0 })).toBe(false)
  })

  it('判定函数只放在一处，钩子必须复用它', () => {
    expect(saveLib).toContain('export function shouldUploadLocalSettingsFirst')
    expect(hook).toContain('shouldUploadLocalSettingsFirst(cloud, localBefore)')
    // 不在钩子里另写一份字面量比较（两份口径会漂移）
    expect(hook).not.toContain('cloud.updatedAt === 0')
  })
})

describe('读取顺序与上云路径', () => {
  it('本机快照在任何「写本机」之前读取', () => {
    const snapshotAt = hook.indexOf('const localBefore = readLocalUserSettings()')
    const writeCloudAt = hook.indexOf('writeLocalUserSettings(cloud)')
    const getAt = hook.indexOf("fetch('/api/me/settings', { cache: 'no-store' })")
    expect(snapshotAt).toBeGreaterThan(-1)
    expect(getAt).toBeGreaterThan(-1)
    expect(writeCloudAt).toBeGreaterThan(-1)
    expect(snapshotAt).toBeLessThan(getAt)
    expect(snapshotAt).toBeLessThan(writeCloudAt)
  })

  it('界面那句「登录后同步到云端」有实现兜着', () => {
    expect(view).toContain('登录后会自动把本机偏好同步到云端')
    expect(hook).toContain('saveSettingsPatchToCloud(localBefore)')
    expect(hook).toContain('已把你在本机保存的偏好同步到云端')
  })

  it('迁移上行失败不假装成功：保留本机值并如实标错', () => {
    expect(hook).toContain('setSettings(localBefore)')
    expect(hook).toContain('本机这一份没能同步上去')
  })
})

describe('降级与失败不再静默', () => {
  it('会话说已登录但设置服务返回 401 → 落 error，不压平成 anonymous', () => {
    const from = hook.indexOf('if (res.status === 401)')
    expect(from).toBeGreaterThan(-1)
    const block = hook.slice(from, hook.indexOf('if (!res.ok)', from))
    expect(block).toContain("setState('error')")
    expect(block).toContain('401')
    expect(block).not.toContain("setState('anonymous')")
  })

  it('保存失败带原因并留住待重发的改动（不再有空的 return false 吞错）', () => {
    expect(hook).not.toMatch(/catch\s*\{\s*return false\s*\}/)
    expect(hook).toContain('setSaveError(describeSaveFailure(err))')
    expect(hook).toContain('setLastFailedPatch(patchValue)')
    expect(hook).toContain('这次改动没有保存上，当前显示的仍是原值')
    expect(hook).toContain('retrySave')
  })

  it('失败提示常驻可读（role=alert）且可重试，不再猜「中枢暂不可用」', () => {
    expect(view).toContain('saveError &&')
    expect(view).toContain('role="alert"')
    expect(view).toContain('controller.retrySave()')
    expect(view).toContain('saveError ??')
    expect(view).not.toContain('中枢暂不可用')
  })
})
