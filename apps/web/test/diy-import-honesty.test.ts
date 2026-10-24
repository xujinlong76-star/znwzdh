/**
 * F4：DIY 配置的「导入 / 还原」不再谎报全量。
 *
 * 真实缺陷：`validateAndCleanDIYConfig` 是白名单 + 上限的清洗器，
 * 它一定会吃掉内容（heroDeckWidgets 32、id 列表 500、自定义分类 100、
 * 单分类站点 500、站点重映射 500/2000、非法 href 整条丢弃、非法枚举回退默认），
 * 但返回值只有 {valid, config}。于是所有导入入口只能写「配置已成功导入并生效！」
 * 「零知识金库验证成功，排版与专属配置已全量还原！」——用户少了一批私人分类，
 * 界面却告诉他「全量」，这是假话；`#diy=` 分享链接侧更糟，连一句提示都没有。
 *
 * 顺带修掉两个同源问题：
 *   - `out['__proto__'] = [...]` 这类键能通过老的 SAFE_ID_RE，真会把原型改掉；
 *   - core 版对 `customCategories: [null]` 直接 `c.id` 取值，抛错炸掉整次导入。
 *
 * 现在清洗会记账（dropped + notes），导入方必须把台账说出来。这里钉住：
 *   1. 干净配置 → 零申报；超限/非法 → 条数与原因一一对得上；
 *   2. __proto__ 等危险键被丢弃且不动原型链；
 *   3. 枚举回退只进 notes，不冒充「丢弃条数」；
 *   4. overlay 与 core 两份实现给得出同一套台账；
 *   5. 导入文案含实际条数与丢弃申报，源码里不再有「全量还原」这类无法验证的承诺；
 *   6. 分享链接被吃掉的内容挂到用户看得见的横幅上。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { describeDiyRestoreReport, importDIYConfig, importEncryptedDIYConfig, syncFromCloudVault } from '@/lib/modular/home-diy-io'
import {
  applyHomeDiyShareHash,
  getHomeDiySnapshot,
  hydrateHomeDiy,
  resetHomeDiySharedState,
} from '@/lib/modular/home-diy-storage'
import { validateAndCleanDIYConfig } from '@/lib/modular/diy-presets'
import { fetchCloudVault } from '@/lib/navhub-api'
import { decryptGenericPayload } from '@/lib/vault'

vi.mock('@/lib/identity', () => ({ getIdentity: () => 'user-1' }))
vi.mock('@/lib/navhub-api', () => ({
  fetchCloudVault: vi.fn(async () => null as unknown),
  saveCloudVault: vi.fn(async () => ({ ok: true, version: 1 })),
  deleteCloudVault: vi.fn(async () => true),
}))
vi.mock('@/lib/vault', () => ({
  encryptGenericPayload: vi.fn(async () => ({ cipherTextBase64: 'x', ivHex: 'y', saltHex: 'z' })),
  decryptGenericPayload: vi.fn(async () => ({ viewMode: 'hybrid' })),
}))

const HERE = dirname(fileURLToPath(import.meta.url))

/** overlay 真相文件（镜像 apps/web/** 由门禁保持同步，这里优先读 overlay） */
function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsRead(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

/** 仓库根视角的文件（core 侧实现） */
function repoFile(rel: string): string {
  const p = resolve(HERE, '..', '..', '..', rel)
  if (!existsRead(p)) throw new Error('无法定位仓库文件 ' + rel + '（' + p + '）')
  return readFileSync(p, 'utf8')
}

function existsRead(p: string): boolean {
  try {
    readFileSync(p)
    return true
  } catch {
    return false
  }
}

/** 只留代码：注释里会引用「全量还原」当反面教材，全文断言会被自己顶穿 */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const ioSource = overlayFile('src/lib/modular/home-diy-io.ts')
const dialogSource = overlayFile('src/components/home-diy-backup-dialog.tsx')
const storageSource = overlayFile('src/lib/modular/home-diy-storage.ts')

/** 一份合法且小巧的配置：清洗后不该有任何申报 */
function tinyConfig(overrides: Record<string, unknown> = {}) {
  return {
    viewMode: 'hybrid',
    cardDisplayMode: 'standard',
    canvasBackground: 'mesh',
    heroDeckWidgets: ['quick-search', 'clock-pomodoro'],
    categoryOrder: ['cat-a', 'cat-b'],
    customCategories: [
      { id: 'cust-1', title: '我的工具', icon: 'FolderHeart', items: [{ id: 'i1', title: '示例', href: 'https://example.com' }] },
    ],
    ...overrides,
  }
}

/* ------------------------------------------------------------------ *
 * 1. 清洗台账
 * ------------------------------------------------------------------ */
describe('DIY 清洗台账：白名单和上限吃掉多少就得报多少', () => {
  it('干净配置零申报（这才是唯一能说「全部还原」的情形）', () => {
    const res = validateAndCleanDIYConfig(tinyConfig())
    expect(res.valid).toBe(true)
    expect(res.dropped).toBe(0)
    expect(res.notes).toEqual([])
  })

  it('自定义分类超出 100 个：截断数量与实际保留条数对得上', () => {
    const many = Array.from({ length: 103 }, (_, i) => ({
      id: `cust-${i}`,
      title: `分类${i}`,
      items: [{ id: `i-${i}`, title: 'x', href: 'https://example.com' }],
    }))
    const res = validateAndCleanDIYConfig(tinyConfig({ customCategories: many }))
    expect(res.valid).toBe(true)
    expect(res.config.customCategories).toHaveLength(100)
    expect(res.dropped).toBe(3)
    expect(res.notes.join('\n')).toContain('自定义分类：超出 100 个上限，截断 3 个')
  })

  it('非法 href 整条丢弃，且申报里说清是协议问题', () => {
    const res = validateAndCleanDIYConfig(
      tinyConfig({
        customCategories: [
          {
            id: 'cust-1',
            title: '我的工具',
            items: [
              { id: 'i1', title: 'ok', href: 'https://example.com' },
              { id: 'i2', title: 'bad', href: 'javascript:alert(1)' },
              { id: 'i3', title: 'bad2', href: 'data:text/html,<script>1</script>' },
            ],
          },
        ],
      }),
    )
    expect(res.config.customCategories[0].items).toHaveLength(1)
    expect(res.dropped).toBe(2)
    expect(res.notes.join('\n')).toContain('链接协议不安全')
    expect(JSON.stringify(res.config)).not.toContain('javascript:')
  })

  it('单分类站点超出 500 条：截断申报', () => {
    const items = Array.from({ length: 504 }, (_, i) => ({ id: `i${i}`, title: 'x', href: 'https://example.com' }))
    const res = validateAndCleanDIYConfig(tinyConfig({ customCategories: [{ id: 'c1', title: 't', items }] }))
    expect(res.config.customCategories[0].items).toHaveLength(500)
    expect(res.dropped).toBe(4)
    expect(res.notes.join('\n')).toContain('单个分类超出 500 条上限，截断 4 条')
  })

  it('id 列表同时有非法项与超上限项时，两条原因分开申报', () => {
    const order = Array.from({ length: 502 }, (_, i) => `cat-${i}`).concat([5, {}, 'a b'] as unknown as string[])
    const res = validateAndCleanDIYConfig(tinyConfig({ categoryOrder: order }))
    expect(res.config.categoryOrder).toHaveLength(500)
    // 3 个非法（数字/对象/带空格）+ 2 个超出上限
    expect(res.dropped).toBe(5)
    const notes = res.notes.join('\n')
    expect(notes).toContain('分类顺序：3 个 id 不在白名单，已丢弃')
    expect(notes).toContain('分类顺序：超出 500 个上限，截断 2 个')
  })

  it('__proto__ / constructor 之类键只会被丢弃，且不许碰到原型链', () => {
    // 必须用 JSON.parse 造载荷：对象字面量里的 __proto__: 走的是原型 setter，压根不是普通键
    const hostile = JSON.parse(
      '{"viewMode":"hybrid","categoryOrder":["cat-a","__proto__","constructor"],' +
        '"pinnedSiteIdsByCategory":{"__proto__":["polluted"],"cat-a":["s1",42]},' +
        '"siteCategoryOverrides":{"__proto__":"polluted","cat-a":"cat-b"}}',
    )
    const res = validateAndCleanDIYConfig(hostile)
    expect(res.valid).toBe(true)
    expect(res.config.categoryOrder).toEqual(['cat-a'])
    expect(Object.getPrototypeOf(res.config.pinnedSiteIdsByCategory)).toBe(Object.prototype)
    expect(Object.getPrototypeOf(res.config.siteCategoryOverrides)).toBe(Object.prototype)
    expect(Object.keys(res.config.pinnedSiteIdsByCategory)).not.toContain('__proto__')
    expect(Object.keys(res.config.siteCategoryOverrides)).not.toContain('__proto__')
    expect(res.config.pinnedSiteIdsByCategory['cat-a']).toEqual(['s1'])
    // 原型污染载荷本身也算「丢弃的内容」，不能悄悄放过
    expect(res.dropped).toBe(5)
  })

  it('枚举值不在白名单：只回退并说明，不冒充丢弃条数', () => {
    const res = validateAndCleanDIYConfig(tinyConfig({ viewMode: 'zen', cardDisplayMode: 'huge' }))
    expect(res.config.viewMode).toBe('hybrid')
    expect(res.config.cardDisplayMode).toBe('standard')
    expect(res.dropped).toBe(0)
    expect(res.notes.length).toBe(2)
    expect(res.notes.join('\n')).toContain('不在支持列表')
    const text = describeDiyRestoreReport(res.config, res)
    expect(text).toContain('已回退默认')
    expect(text).not.toContain('被丢弃')
  })

  it('不安全壁纸被忽略时申报一条', () => {
    const res = validateAndCleanDIYConfig(tinyConfig({ customWallpaperUrl: 'javascript:alert(1)' }))
    expect(res.config.customWallpaperUrl).toBe('')
    expect(res.dropped).toBe(1)
    expect(res.notes.join('\n')).toContain('自定义壁纸')
  })

  it('结构不合法时同样带台账字段，调用方不必判空', () => {
    const res = validateAndCleanDIYConfig(null)
    expect(res.valid).toBe(false)
    expect(res.dropped).toBe(0)
    expect(res.notes).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * 2. core 侧同一套语义（行为断言见 packages/core/test/diy-layout.test.ts）
 * ------------------------------------------------------------------ */
describe('core 侧清洗给得出同一套台账', () => {
  const coreSanitize = repoFile('packages/core/src/diy-layout/sanitize.ts')

  it('core 版的返回值同样是 dropped + notes，而不是只有 {valid,config}', () => {
    expect(coreSanitize).toMatch('dropped: number')
    expect(coreSanitize).toMatch('notes: string[]')
    expect(coreSanitize).not.toMatch(/return \{ valid: true, config: cleaned \}/)
  })

  it('两份实现的申报口径一致（同样的上限、同样的措辞）', () => {
    const overlayClean = overlayFile('src/lib/modular/diy-presets.ts')
    for (const cap of ['100', '500', '32']) {
      expect(overlayClean).toContain(cap)
      expect(coreSanitize).toContain(cap)
    }
    expect(coreSanitize).toContain('超出 100 个上限')
    expect(coreSanitize).toContain('不在支持列表')
  })
})

/* ------------------------------------------------------------------ *
 * 3. 导入文案
 * ------------------------------------------------------------------ */
describe('导入与还原的文案：说清还原了什么、丢了什么', () => {
  it('明文导入超限配置：结果里带条数与丢弃申报', () => {
    const many = Array.from({ length: 102 }, (_, i) => ({ id: `cust-${i}`, title: `分类${i}`, items: [] }))
    const persist = vi.fn()
    const res = importDIYConfig(JSON.stringify(tinyConfig({ customCategories: many })), persist)
    expect(res.ok).toBe(true)
    expect(persist).toHaveBeenCalledTimes(1)
    expect(res.dropped).toBe(2)
    expect(res.message).toContain('自定义分类 100 个')
    expect(res.message).toContain('因白名单或上限被丢弃/截断')
    expect(res.summary).toContain('截断 2 个')
  })

  it('干净配置的导入文案不制造「有内容被丢弃」的错觉', () => {
    const res = importDIYConfig(JSON.stringify(tinyConfig()), vi.fn())
    expect(res.ok).toBe(true)
    expect(res.dropped).toBe(0)
    expect(res.message).toContain('未发现被丢弃的内容')
  })

  it('金库解密导入同样申报，并且不再出现「全量还原」', async () => {
    vi.mocked(decryptGenericPayload).mockResolvedValueOnce(
      tinyConfig({ categoryOrder: ['a', 'b', 'c'.repeat(200)] }) as never,
    )
    const res = await importEncryptedDIYConfig(
      JSON.stringify({ cipherTextBase64: 'a', ivHex: 'b', saltHex: 'c' }),
      'passphrase',
      vi.fn(),
    )
    expect(res.ok).toBe(true)
    expect(res.dropped).toBe(1)
    expect(res.message).toContain('零知识金库解密成功')
    expect(res.message).toContain('1 条内容因白名单或上限被丢弃/截断')
    expect(res.message).not.toContain('全量')
  })

  it('云端拉取把小结一路带到调用方（弹窗不许再自己写死「全量还原」）', async () => {
    vi.mocked(fetchCloudVault).mockResolvedValueOnce({
      payload: JSON.stringify({ cipherTextBase64: 'a', ivHex: 'b', saltHex: 'c' }),
      updatedAt: 123,
      version: 4,
    } as never)
    vi.mocked(decryptGenericPayload).mockResolvedValueOnce(
      tinyConfig({ heroDeckWidgets: Array.from({ length: 33 }, (_, i) => `w${i}`) }) as never,
    )
    const res = await syncFromCloudVault('passphrase', vi.fn())
    expect(res.success).toBe(true)
    expect(res.dropped).toBe(1)
    expect(res.summary).toContain('首屏小组件：超出 32 个上限，截断 1 个')
  })

  it('源码里不再有「全量还原」「已成功导入并生效」这类无法验证的承诺', () => {
    for (const src of [ioSource, dialogSource, storageSource]) {
      expect(codeOnly(src)).not.toContain('全量还原')
      expect(codeOnly(src)).not.toContain('已成功导入并生效')
    }
  })

  it('弹窗按 dropped 变色与改标题，而不是永远庆祝', () => {
    const dialog = codeOnly(dialogSource)
    expect(dialog).toMatch(/res\.dropped > 0 \? '⚠️ 已导入，但部分内容被丢弃' : '🎉 导入成功'/)
    expect(dialog).toMatch(/res\.dropped > 0 \? '⚠️ 已还原，但部分内容被丢弃' : '🎉 解密恢复成功'/)
    expect(dialog).toMatch(/title: res\.dropped > 0 \? '☁️ 已还原，但部分内容被丢弃'/)
    expect(dialog).toMatch(/description: res\.summary/)
  })

  it('导入结果类型带台账，调用方拿到的是数据不是形容词', () => {
    expect(ioSource).toMatch('export interface HomeDiyImportResult')
    expect(codeOnly(ioSource)).toMatch(/dropped: number/)
    expect(codeOnly(dialogSource)).toMatch(/importDIYConfig: \(json: string\) => HomeDiyImportResult/)
  })
})

/* ------------------------------------------------------------------ *
 * 4. #diy= 分享链接侧
 * ------------------------------------------------------------------ */
describe('分享链接接收侧：被吃掉的内容挂到横幅上', () => {
  interface FakeWindow {
    localStorage: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void }
    location: { hash: string; pathname: string; search: string }
    history: { replaceState: (a: unknown, b: string, url: string) => void }
  }

  let win: FakeWindow

  beforeEach(() => {
    resetHomeDiySharedState()
    const store = new Map<string, string>()
    win = {
      localStorage: {
        getItem: (k) => (store.has(k) ? (store.get(k) as string) : null),
        setItem: (k, v) => void store.set(k, String(v)),
        removeItem: (k) => void store.delete(k),
      },
      location: { hash: '', pathname: '/', search: '' },
      history: { replaceState: () => void (win.location.hash = '') },
    }
    ;(globalThis as unknown as { window: unknown }).window = win
  })

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window
  })

  const encode = (obj: unknown) => '#diy=' + btoa(encodeURIComponent(JSON.stringify(obj)))

  it('链接里有非法条目：applied 仍为真，但 warning 说清丢了几条', () => {
    win.location.hash = encode({ vm: 'hybrid', co: ['cat-a', 'cat-b', 5, {}, '__proto__'] })
    const res = applyHomeDiyShareHash()
    expect(res.applied).toBe(true)
    expect(res.warning).toContain('3 项内容被丢弃或截断')
    expect(res.warning).toContain('分类顺序')
  })

  it('干净链接：不制造噪音，warning 为空', () => {
    win.location.hash = encode({ vm: 'classic', co: ['cat-a'] })
    const res = applyHomeDiyShareHash()
    expect(res.applied).toBe(true)
    expect(res.warning).toBeNull()
  })

  it('超出 4KB 的链接整条忽略，也要告诉用户「沿用了本地排版」', () => {
    win.location.hash = '#diy=' + 'A'.repeat(4200)
    const res = applyHomeDiyShareHash()
    expect(res.applied).toBe(false)
    expect(res.warning).toContain('4KB')
  })

  it('校验失败的链接不再只是 console.warn 一下就没了', () => {
    win.location.hash = '#diy=' + btoa(encodeURIComponent(JSON.stringify({ nothing: true })))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = applyHomeDiyShareHash()
    expect(res.applied).toBe(false)
    expect(res.warning).toContain('分享链接未能应用')
    warn.mockRestore()
  })

  it('hydrate 把 warning 落到共享状态，工具栏横幅才可能显示出来', () => {
    win.location.hash = encode({ vm: 'hybrid', wp: 'javascript:alert(1)' })
    hydrateHomeDiy()
    const snap = getHomeDiySnapshot()
    expect(snap.storageWarning).toContain('分享链接已应用')
    expect(snap.storageWarning).toContain('自定义壁纸')
  })
})
