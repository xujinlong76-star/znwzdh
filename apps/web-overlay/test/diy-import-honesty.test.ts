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
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyPreparedHomeDiyImport, describeDiyRestoreReport, importDIYConfig, importEncryptedDIYConfig, prepareHomeDiyImport, prepareHomeDiyImportFromValue, syncFromCloudVault } from '@/lib/modular/home-diy-io'
import {
  applyHomeDiyShareHash,
  commitHomeDiyConfig,
  computeHomeDiyShareDiff,
  confirmHomeDiyShare,
  DEFAULT_CONFIG,
  dismissHomeDiyShare,
  getHomeDiySnapshot,
  hydrateHomeDiy,
  mergeHomeDiyShareFields,
  resetHomeDiySharedState,
  STORAGE_CLOCKS_KEY,
  STORAGE_KEY,
  undoHomeDiy,
  type HomeDIYConfig,
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

  it('首屏小组件超出 32 个：只留前 32 个并申报截断数（W2-5 直接测清洗器）', () => {
    // 注意：这里只测 validateAndCleanDIYConfig 本身，不走 E2E——导入/分享
    // 管线会先把 heroDeckWidgets 收敛到 ≤16 个已知小组件 id，33 个组件在
    // 端到端路径上根本到不了清洗器；32 上限的唯一可达面就是清洗器直调。
    const widgets = Array.from({ length: 33 }, (_, i) => `widget-${i}`)
    const res = validateAndCleanDIYConfig(tinyConfig({ heroDeckWidgets: widgets }))
    expect(res.valid).toBe(true)
    expect(res.config.heroDeckWidgets).toHaveLength(32)
    expect(res.config.heroDeckWidgets).toEqual(widgets.slice(0, 32))
    expect(res.dropped).toBe(1)
    expect(res.notes.join('\n')).toContain('首屏小组件：超出 32 个上限，截断 1 个')
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
  it('明文导入超限配置：结果里带条数与丢弃申报', async () => {
    const many = Array.from({ length: 102 }, (_, i) => ({ id: `cust-${i}`, title: `分类${i}`, items: [] }))
    const persist = vi.fn()
    const res = await importDIYConfig(JSON.stringify(tinyConfig({ customCategories: many })), persist)
    expect(res.ok).toBe(true)
    expect(persist).toHaveBeenCalledTimes(1)
    expect(res.dropped).toBe(2)
    expect(res.message).toContain('自定义分类 100 个')
    expect(res.message).toContain('因白名单或上限被丢弃/截断')
    expect(res.summary).toContain('截断 2 个')
  })

  it('干净配置的导入文案不制造「有内容被丢弃」的错觉', async () => {
    const res = await importDIYConfig(JSON.stringify(tinyConfig()), vi.fn())
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
      // P1-5 起：heroDeckWidgets 只认注册表里的 16 个已知类型，拿 33 个
      // 任意 id 当超限填充物会先被「未知小组件」点名丢弃（dropped=33），
      // 不再走到清洗器的 32 上限。超限记账本身改用分类顺序测（同口径）。
      tinyConfig({ categoryOrder: Array.from({ length: 501 }, (_, i) => `cat-${i}`) }) as never,
    )
    const res = await syncFromCloudVault('passphrase', vi.fn())
    expect(res.success).toBe(true)
    expect(res.dropped).toBe(1)
    expect(res.summary).toContain('分类顺序：超出 500 个上限，截断 1 个')
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
    expect(codeOnly(dialogSource)).toMatch(/importDIYConfig: \(json: string\) => Promise<HomeDiyImportResult>/)
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

  it('链接里有非法条目：挂起待确认，但 warning 说清丢了几条', async () => {
    win.location.hash = encode({ vm: 'hybrid', co: ['cat-a', 'cat-b', 5, {}, '__proto__'] })
    const res = await applyHomeDiyShareHash()
    expect(res.applied).toBe(false)
    expect(res.warning).toContain('3 项内容被丢弃或截断')
    expect(res.warning).toContain('分类顺序')
    const pending = getHomeDiySnapshot().pendingShare
    expect(pending).not.toBeNull()
    expect(pending?.imported.viewMode).toBe('hybrid')
    expect(pending?.warning).toContain('3 项内容被丢弃或截断')
  })

  it('干净链接：不制造噪音，warning 为空', async () => {
    win.location.hash = encode({ vm: 'classic', co: ['cat-a'] })
    const res = await applyHomeDiyShareHash()
    expect(res.applied).toBe(false)
    expect(res.warning).toBeNull()
    const pending = getHomeDiySnapshot().pendingShare
    expect(pending).not.toBeNull()
    expect(pending?.imported.viewMode).toBe('classic')
    expect(pending?.warning).toBeNull()
  })

  it('超出 4KB 的链接整条忽略，也要告诉用户「沿用了本地排版」', async () => {
    win.location.hash = '#diy=' + 'A'.repeat(4200)
    const res = await applyHomeDiyShareHash()
    expect(res.applied).toBe(false)
    expect(res.warning).toContain('4KB')
  })

  it('校验失败的链接不再只是 console.warn 一下就没了', async () => {
    win.location.hash = '#diy=' + btoa(encodeURIComponent(JSON.stringify({ nothing: true })))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await applyHomeDiyShareHash()
    expect(res.applied).toBe(false)
    expect(res.warning).toContain('分享链接未能应用')
    warn.mockRestore()
  })

  it('解码失败不清除 hash：链接还留在地址栏，刷新即可重试（UX 审计 P2）', async () => {
    win.location.hash = '#diy=' + 'A'.repeat(4200)
    const hashBefore = win.location.hash
    const res = await applyHomeDiyShareHash()
    expect(res.applied).toBe(false)
    expect(res.warning).toContain('4KB')
    expect(win.location.hash).toBe(hashBefore)
  })

  it('校验失败不清除 hash：链接还留在地址栏，刷新即可重试（UX 审计 P2）', async () => {
    win.location.hash = '#diy=' + btoa(encodeURIComponent(JSON.stringify({ nothing: true })))
    const hashBefore = win.location.hash
    const res = await applyHomeDiyShareHash()
    expect(res.applied).toBe(false)
    expect(res.warning).toContain('分享链接未能应用')
    expect(win.location.hash).toBe(hashBefore)
  })

  it('hydrate 把 warning 落到共享状态，工具栏横幅才可能显示出来', async () => {
    win.location.hash = encode({ vm: 'hybrid', wp: 'javascript:alert(1)' })
    await hydrateHomeDiy()
    const snap = getHomeDiySnapshot()
    expect(snap.storageWarning).toContain('分享链接待你确认')
    expect(snap.storageWarning).toContain('自定义壁纸')
    expect(snap.pendingShare).not.toBeNull()
    expect(snap.pendingShare?.imported.viewMode).toBe('hybrid')
  })

  it('差异预览：只列链接实际携带的字段——没带的自建分类/折叠/壁纸不再算成变化', async () => {
    commitHomeDiyConfig((prev) => ({
      ...prev,
      customCategories: [{ id: 'my-cat', title: '我的分类', items: [], createdAt: 1 }],
      collapsedCategoryIds: ['cat-a'],
      customWallpaperUrl: 'https://example.com/w.jpg',
    }))
    const before = getHomeDiySnapshot().config
    win.location.hash = encode({ vm: 'hybrid', co: ['cat-a'] })
    const res = await applyHomeDiyShareHash()
    expect(res.applied).toBe(false)
    const pending = getHomeDiySnapshot().pendingShare
    expect(pending).not.toBeNull()
    expect(pending?.carriedFields).toEqual(['viewMode', 'categoryOrder'])
    // 链接只带了 vm + co：自建分类/折叠/壁纸是本地独有的，确认时不会被动，
    // 预览里出现它们就是撒谎；只应列出携带且不同的字段（这里是分类顺序）。
    const joined = (pending?.diff ?? []).join(' ')
    expect(joined).not.toContain('自建分类')
    expect(joined).not.toContain('折叠状态')
    expect(joined).not.toContain('自定义壁纸')
    expect(joined).toContain('分类顺序')
    expect(getHomeDiySnapshot().config).toBe(before)
  })

  it('差异预览（全量比对旧口径）：不传 carriedFields 时仍按全字段比对', () => {
    // 直接拿两份全量配置比对的调用（不走分享链接）保持旧行为：
    // 自建分类/折叠/壁纸在 imported 里确实变了，就要逐项列出。
    commitHomeDiyConfig((prev) => ({
      ...prev,
      customCategories: [{ id: 'my-cat', title: '我的分类', items: [], createdAt: 1 }],
      collapsedCategoryIds: ['cat-a'],
      customWallpaperUrl: 'https://example.com/w.jpg',
    }))
    const current = getHomeDiySnapshot().config
    const imported = { ...current, customCategories: [], collapsedCategoryIds: [], customWallpaperUrl: '' }
    const diff = computeHomeDiyShareDiff(current, imported)
    expect(diff.join(' ')).toContain('自建分类')
    expect(diff.join(' ')).toContain('折叠状态')
    expect(diff.join(' ')).toContain('自定义壁纸')
    // 同一份 imported、但声明只携带 viewMode 时，这些行一律不出。
    expect(computeHomeDiyShareDiff(current, imported, ['viewMode'])).toEqual([])
  })

  it('确认分享：先备份当前配置，再按字段级合并应用，旧配置可 Ctrl+Z 撤回', async () => {
    commitHomeDiyConfig((prev) => ({
      ...prev,
      customCategories: [{ id: 'my-cat', title: '我的分类', items: [], createdAt: 1 }],
      collapsedCategoryIds: ['cat-a'],
      accentColor: 'violet',
      canvasBackground: 'aurora',
    }))
    const before = getHomeDiySnapshot().config
    win.location.hash = encode({ vm: 'classic', co: ['cat-a'] })
    await applyHomeDiyShareHash()
    const out = confirmHomeDiyShare()
    expect(out.applied).toBe(true)
    expect(out.backupKey).not.toBeNull()
    const backupRaw = win.localStorage.getItem(out.backupKey as string)
    expect(backupRaw).not.toBeNull()
    expect(JSON.parse(backupRaw as string).customCategories[0].title).toBe('我的分类')
    // 只应用链接携带的字段……
    expect(getHomeDiySnapshot().config.viewMode).toBe('classic')
    expect(getHomeDiySnapshot().config.categoryOrder).toEqual(['cat-a'])
    // ……没携带的字段保持本地值，不再被 imported 里的默认值整表压掉。
    expect(getHomeDiySnapshot().config.customCategories).toEqual(before.customCategories)
    expect(getHomeDiySnapshot().config.collapsedCategoryIds).toEqual(['cat-a'])
    expect(getHomeDiySnapshot().config.accentColor).toBe('violet')
    expect(getHomeDiySnapshot().config.canvasBackground).toBe('aurora')
    expect(getHomeDiySnapshot().pendingShare).toBeNull()
    undoHomeDiy()
    expect(getHomeDiySnapshot().config).toEqual(before)
  })

  it('字段级合并：只带背景 + 强调色的链接（不带 vm）也能应用，且只改这两项', async () => {
    commitHomeDiyConfig((prev) => ({
      ...prev,
      viewMode: 'classic',
      cardDisplayMode: 'rich',
      categoryOrder: ['cat-z'],
      customWallpaperUrl: 'https://example.com/mine.jpg',
      glassmorphismBlur: 20,
      cardOpacity: 0.95,
    }))
    const before = getHomeDiySnapshot().config
    win.location.hash = encode({ bg: 'aurora', ac: 'emerald' })
    const res = await applyHomeDiyShareHash()
    expect(res.applied).toBe(false)
    expect(res.warning).toBeNull()
    expect(getHomeDiySnapshot().pendingShare?.carriedFields).toEqual(['canvasBackground', 'accentColor'])
    const out = confirmHomeDiyShare()
    expect(out.applied).toBe(true)
    const after = getHomeDiySnapshot().config
    expect(after.canvasBackground).toBe('aurora')
    expect(after.accentColor).toBe('emerald')
    expect(after.viewMode).toBe(before.viewMode)
    expect(after.cardDisplayMode).toBe(before.cardDisplayMode)
    expect(after.categoryOrder).toEqual(before.categoryOrder)
    expect(after.customWallpaperUrl).toBe(before.customWallpaperUrl)
    expect(after.glassmorphismBlur).toBe(before.glassmorphismBlur)
    expect(after.cardOpacity).toBe(before.cardOpacity)
    undoHomeDiy()
    expect(getHomeDiySnapshot().config).toEqual(before)
  })

  it('字段级合并：带全部 11 个短字段的链接仍全量应用（含 co_op 下限抬升）', async () => {
    commitHomeDiyConfig((prev) => ({
      ...prev,
      viewMode: 'classic',
      cardDisplayMode: 'rich',
      canvasBackground: 'aurora',
      accentColor: 'violet',
      categoryOrder: ['old'],
      pinnedCategoryIds: ['old-pin'],
      hiddenCategoryIds: ['old-hide'],
      siteCategoryOverrides: { 'site-old': 'cat-old' },
      customWallpaperUrl: 'https://example.com/old.jpg',
      glassmorphismBlur: 5,
      cardOpacity: 0.95,
    }))
    win.location.hash = encode({
      vm: 'workbench',
      cdm: 'compact',
      bg: 'dots',
      ac: 'amber',
      co: ['cat-a', 'cat-b'],
      pco: ['pin-1'],
      hco: ['hide-1'],
      sco: { 'site-1': 'cat-a' },
      wp: 'https://example.com/new.jpg',
      gb: 18,
      co_op: 0.2,
    })
    await applyHomeDiyShareHash()
    expect(getHomeDiySnapshot().pendingShare?.carriedFields).toEqual([
      'viewMode',
      'cardDisplayMode',
      'canvasBackground',
      'accentColor',
      'categoryOrder',
      'pinnedCategoryIds',
      'hiddenCategoryIds',
      'siteCategoryOverrides',
      'customWallpaperUrl',
      'glassmorphismBlur',
      'cardOpacity',
    ])
    expect(confirmHomeDiyShare().applied).toBe(true)
    const after = getHomeDiySnapshot().config
    expect(after.viewMode).toBe('workbench')
    expect(after.cardDisplayMode).toBe('compact')
    expect(after.canvasBackground).toBe('dots')
    expect(after.accentColor).toBe('amber')
    expect(after.categoryOrder).toEqual(['cat-a', 'cat-b'])
    expect(after.pinnedCategoryIds).toEqual(['pin-1'])
    expect(after.hiddenCategoryIds).toEqual(['hide-1'])
    expect(after.siteCategoryOverrides).toEqual({ 'site-1': 'cat-a' })
    expect(after.customWallpaperUrl).toBe('https://example.com/new.jpg')
    expect(after.glassmorphismBlur).toBe(18)
    // co_op=0.2 按可读性下限抬升到 0.88（与旧整表行为一致）
    expect(after.cardOpacity).toBe(0.88)
  })

  it('字段级合并：长字段名同样计入携带集，短字段优先于长字段', async () => {
    win.location.hash = encode({ viewMode: 'classic', bg: 'grid', accentColor: 'rose' })
    await applyHomeDiyShareHash()
    const pending = getHomeDiySnapshot().pendingShare
    expect(pending?.carriedFields).toEqual(['viewMode', 'canvasBackground', 'accentColor'])
    expect(pending?.imported.viewMode).toBe('classic')
    expect(pending?.imported.canvasBackground).toBe('grid')
    expect(pending?.imported.accentColor).toBe('rose')
    expect(confirmHomeDiyShare().applied).toBe(true)
    expect(getHomeDiySnapshot().config.viewMode).toBe('classic')
    expect(getHomeDiySnapshot().config.accentColor).toBe('rose')
  })

  it('mergeHomeDiyShareFields：只写携带字段，未携带的 co_op 默认值 0.9 不会压掉本地不透明度', () => {
    const current = getHomeDiySnapshot().config
    const local = { ...current, cardOpacity: 0.95, accentColor: 'violet' as const }
    const imported = { ...current, viewMode: 'classic' as const, cardOpacity: 0.9, accentColor: 'default' as const }
    const merged = mergeHomeDiyShareFields(local, imported, ['viewMode'])
    expect(merged.viewMode).toBe('classic')
    expect(merged.cardOpacity).toBe(0.95)
    expect(merged.accentColor).toBe('violet')
    // 不传携带集时退回整份 imported（旧调用兜底）
    expect(mergeHomeDiyShareFields(local, imported, null).cardOpacity).toBe(0.9)
  })

  it('STORAGE_CLOCKS_KEY 导出值与 use-home-diy 硬编码过的旧字面量完全一致', () => {
    expect(STORAGE_CLOCKS_KEY).toBe('navhub_home_diy_clocks_v1')
  })

  it('取消分享：本地配置原样不动，待确认状态与横幅提示一起清掉', async () => {
    commitHomeDiyConfig((prev) => ({
      ...prev,
      customCategories: [{ id: 'my-cat', title: '我的分类', items: [], createdAt: 1 }],
    }))
    const before = getHomeDiySnapshot().config
    win.location.hash = encode({ vm: 'hybrid', co: ['cat-a', 'cat-b', 5] })
    await hydrateHomeDiy()
    expect(getHomeDiySnapshot().pendingShare).not.toBeNull()
    expect(getHomeDiySnapshot().storageWarning).toContain('分享链接待你确认')
    expect(dismissHomeDiyShare()).toBe(true)
    expect(getHomeDiySnapshot().pendingShare).toBeNull()
  expect(getHomeDiySnapshot().config.customCategories).toHaveLength(before.customCategories.length)
  expect(getHomeDiySnapshot().config.customCategories.map((c) => c.title)).toEqual(before.customCategories.map((c) => c.title))
    expect(getHomeDiySnapshot().storageWarning).toBeNull()
    expect(dismissHomeDiyShare()).toBe(false)
  })

  it('差异预览：两份相同配置返回空数组，单字段变化只列一行', () => {
    const current = getHomeDiySnapshot().config
    expect(computeHomeDiyShareDiff(current, current)).toEqual([])
    const imported = { ...current, cardOpacity: (current.cardOpacity ?? 0.9) + 0.01 }
    expect(computeHomeDiyShareDiff(current, imported)).toHaveLength(1)
  })
})

describe('收录站点：写盘失败不能报成功', () => {
  const read = (rel: string) => readFileSync(resolve(HERE, '..', rel), 'utf8')

  it('addSiteToCustomCategory 返回 added / duplicate / failed 三态', () => {
    const src = read('src/lib/modular/use-home-diy.ts')
    expect(src).toContain("'added' | 'duplicate' | 'failed'")
    expect(src).toContain('if (!result.ok) return')
    // persistConfig 必须把落盘结果交回调用方（原实现直接丢弃）
    expect(src).toContain('return result')
  })

  it('单条收录与批量收录都按真实结果提示', () => {
    const src = read('src/components/navigation-content.tsx')
    expect(src).toContain("if (outcome === 'failed')")
    expect(src).toContain('这一下没能保存')
    expect(src).toContain('let failed = 0')
  })

  it('拖拽收录同样区分失败与重复', () => {
    // 拖拽落点处理随 DRAG-2 迁移进 diy-drag-kit.tsx 的 provider（旧 section
    // 里的 HTML5 onDrop 已删除）；失败/重复区分逻辑在 kit 的 handleDragEnd。
    const src = read('src/components/diy/diy-drag-kit.tsx')
    expect(src).toContain("if (outcome === 'failed')")
  })
})

// mock 卫生（D2）：清除本文件的模块 mock 缓存，避免驻留同 worker 的后续文件
afterAll(() => {
  vi.resetModules();
});

/* ------------------------------------------------------------------ *
 * 5. P0-5：导入走分享确认管线 —— 校验 → diff 预览 → 自动备份 →
 *    字段级合并 → 一次可撤销提交（不再整表替换）
 * ------------------------------------------------------------------ */
describe('导入走分享确认管线：只合携带字段，其余保持本地值', () => {
  /** 能真实执行 updater 的 persist：合并结果落到本地变量里 */
  function makeCapturePersist(initial: HomeDIYConfig) {
    let current = initial
    const persist = (updater: (prev: HomeDIYConfig) => HomeDIYConfig) => {
      current = updater(current)
    }
    return { persist, getCurrent: () => current }
  }

  function makeFakeStorage() {
    const store = new Map<string, string>()
    return {
      store,
      storage: {
        getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
        setItem: (k: string, v: string) => void store.set(k, String(v)),
      },
    }
  }

  function localConfig(): HomeDIYConfig {
    return {
      ...DEFAULT_CONFIG,
      viewMode: 'hybrid',
      categoryOrder: ['cat-a'],
      customCategories: [{ id: 'my-cat', title: '我的分类', icon: 'FolderHeart', items: [], createdAt: 1 }],
      customWallpaperUrl: 'https://example.com/mine.jpg',
      accentColor: 'violet',
    }
  }

  it('prepare：只带 viewMode 的导入，diff 只列视图模式', async () => {
    const local = localConfig()
    const prepared = await prepareHomeDiyImport(JSON.stringify({ viewMode: 'classic', version: 3 }), local)
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    expect(prepared.pending.carriedFields).toEqual(['viewMode'])
    expect(prepared.pending.diff).toHaveLength(1)
    expect(prepared.pending.diff[0]).toContain('视图模式')
    expect(prepared.pending.warning).toBeNull()
  })

  it('apply：只合携带字段，没带的自建分类/壁纸/强调色保持本地值', async () => {
    const local = localConfig()
    const cap = makeCapturePersist(local)
    const fake = makeFakeStorage()
    const prepared = await prepareHomeDiyImport(
      JSON.stringify({ viewMode: 'classic', categoryOrder: ['cat-a', 'cat-b'], version: 3 }),
      local,
    )
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    const applied = applyPreparedHomeDiyImport(prepared, cap.persist, fake.storage)
    expect(applied.applied).toBe(true)
    const after = cap.getCurrent()
    expect(after.viewMode).toBe('classic')
    expect(after.categoryOrder).toEqual(['cat-a', 'cat-b'])
    expect(after.customCategories).toEqual(local.customCategories)
    expect(after.customWallpaperUrl).toBe('https://example.com/mine.jpg')
    expect(after.accentColor).toBe('violet')
  })

  it('apply：超限数组只合白名单内条数，本地其余字段不动', async () => {
    const local = localConfig()
    const cap = makeCapturePersist(local)
    const many = Array.from({ length: 102 }, (_, i) => ({ id: `cust-${i}`, title: `分类${i}`, items: [] }))
    const prepared = await prepareHomeDiyImport(JSON.stringify(tinyConfig({ customCategories: many })), local)
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    expect(prepared.dropped).toBe(2)
    applyPreparedHomeDiyImport(prepared, cap.persist, makeFakeStorage().storage)
    expect(cap.getCurrent().customCategories).toHaveLength(100)
    expect(cap.getCurrent().viewMode).toBe(local.viewMode)
    expect(cap.getCurrent().customWallpaperUrl).toBe('https://example.com/mine.jpg')
  })

  it('apply：导入前自动备份到时间戳键，备份内容就是导入前那份', async () => {
    const local = localConfig()
    const cap = makeCapturePersist(local)
    const fake = makeFakeStorage()
    const prepared = await prepareHomeDiyImport(JSON.stringify({ viewMode: 'classic', version: 3 }), local)
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    const applied = applyPreparedHomeDiyImport(prepared, cap.persist, fake.storage)
    expect(applied.backupKey).not.toBeNull()
    expect(applied.backupKey as string).toMatch(new RegExp(`^${STORAGE_KEY.replace(/\./g, '\\.')}\\.share-backup\\.\\d+$`))
    const backupRaw = fake.store.get(applied.backupKey as string)
    expect(backupRaw).toBeDefined()
    // 备份键能还原：读回来的就是导入前那份本地配置
    expect(JSON.parse(backupRaw as string)).toEqual({ ...local, updatedAt: expect.any(Number) })
    expect(cap.getCurrent().viewMode).toBe('classic')
  })

  it('prepare：未知字段与未知小组件只合白名单字段，并点名丢弃', async () => {
    const local = localConfig()
    const prepared = await prepareHomeDiyImport(
      JSON.stringify({
        viewMode: 'classic',
        version: 3,
        totallyUnknown: { x: 1 },
        heroDeckWidgets: ['quick-search', 'nope-widget'],
      }),
      local,
    )
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    expect(prepared.pending.carriedFields).not.toContain('totallyUnknown')
    expect(prepared.pending.imported.heroDeckWidgets).toEqual(['quick-search'])
    expect(prepared.notes.join('\n')).toContain('未知字段「totallyUnknown」')
    expect(prepared.notes.join('\n')).toContain('nope-widget')
    expect(prepared.pending.warning).toContain('不是已知小组件')
    expect(prepared.dropped).toBe(2)
  })

  it('importDIYConfig 直接导入也不再整表替换，且同样自动备份', async () => {
    const local = localConfig()
    const cap = makeCapturePersist(local)
    // fake window：safeLocalStorage() 走 window.localStorage 拿备份句柄
    const fake = makeFakeStorage()
    ;(globalThis as unknown as { window: unknown }).window = { localStorage: fake.storage }
    try {
      const res = await importDIYConfig(JSON.stringify({ viewMode: 'classic', version: 3 }), cap.persist, local)
      expect(res.ok).toBe(true)
      expect(res.backupKey).not.toBeNull()
      expect(cap.getCurrent().viewMode).toBe('classic')
      expect(cap.getCurrent().customCategories).toEqual(local.customCategories)
      expect(cap.getCurrent().customWallpaperUrl).toBe('https://example.com/mine.jpg')
      const backupRaw = fake.store.get(res.backupKey as string)
      expect(JSON.parse(backupRaw as string).customCategories[0].title).toBe('我的分类')
    } finally {
      delete (globalThis as unknown as { window?: unknown }).window
    }
  })

  it('加密导入同样字段级合并：解密出的部分配置不压掉本地自建分类', async () => {
    const local = localConfig()
    const cap = makeCapturePersist(local)
    vi.mocked(decryptGenericPayload).mockResolvedValueOnce(
      { viewMode: 'classic', categoryOrder: ['cat-z'], version: 3 } as never,
    )
    const res = await importEncryptedDIYConfig(
      JSON.stringify({ cipherTextBase64: 'a', ivHex: 'b', saltHex: 'c' }),
      'passphrase',
      cap.persist,
    )
    expect(res.ok).toBe(true)
    expect(cap.getCurrent().viewMode).toBe('classic')
    expect(cap.getCurrent().categoryOrder).toEqual(['cat-z'])
    expect(cap.getCurrent().customCategories).toEqual(local.customCategories)
    expect(cap.getCurrent().customWallpaperUrl).toBe('https://example.com/mine.jpg')
  })

  it('prepare：超大 JSON（>5MB）拒收，不进清洗器', async () => {
    const big = JSON.stringify({ viewMode: 'hybrid', blob: 'x'.repeat(6 * 1024 * 1024) })
    const res = await prepareHomeDiyImport(big)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.message).toContain('5MB')
  })

  it('prepare：JSON 解析失败给 invalid_json', async () => {
    const res = await prepareHomeDiyImport('{oops')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('invalid_json')
  })

  it('prepareHomeDiyImportFromValue：循环引用对象直接拒收', async () => {
    const circle: Record<string, unknown> = { viewMode: 'hybrid' }
    circle.self = circle
    const res = await prepareHomeDiyImportFromValue(circle)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.message).toContain('循环引用')
  })
})

describe('确认对话框与备份弹窗：导入来源有自己的文案与入口', () => {
  it('分享确认对话框按来源换文案，并展示被丢弃内容的提示', () => {
    const dialog = overlayFile('src/components/diy/home-diy-share-confirm-dialog.tsx')
    expect(dialog).toContain('应用导入的排版配置？')
    expect(dialog).toContain('已取消导入')
    expect(dialog).toContain('✅ 导入的排版已应用')
    expect(dialog).toContain('pendingShare.warning')
    // 分享路径的文案一个字没动
    expect(dialog).toContain('应用好友分享的排版？')
    expect(dialog).toContain('已忽略这条分享链接')
  })

  it('备份弹窗：有 stageImportForConfirm 时走挂起确认，没接线时回退直接导入', async () => {
    const dialog = overlayFile('src/components/home-diy-backup-dialog.tsx')
    expect(dialog).toContain('stageImportForConfirm?: (json: string) => Promise<{ ok: boolean; message: string }>')
    expect(dialog).toContain('stageImportForConfirm(importJsonText.trim())')
    expect(dialog).toContain('请核对导入内容')
    expect(dialog).toContain('const res = await importDIYConfig(importJsonText.trim())')
  })
})

describe('W2：搜索面板与本机备份的诚实接线（预设密度 / 导入确认 / 还原报数）', () => {
  it('搜索面板应用预设时把密度回调传进去，toast 只在密度落地后才敢提密度', () => {
    const palette = overlayFile('src/components/search-palette.tsx')
    expect(palette).toContain('useDensity')
    expect(palette).toContain('applyDIYPreset(presetId, (d) => {')
    expect(palette).toContain('densityApplied')
    expect(palette).toContain('卡片密度未改变')
  })

  it('搜索面板 ⌘K 导入走 stageImportForConfirm，不再直接 importDIYConfig 一把应用', () => {
    const palette = overlayFile('src/components/search-palette.tsx')
    const body = palette.slice(
      palette.indexOf('const handleDiyImportFile'),
      palette.indexOf('const matchedDiyActions'),
    )
    expect(body).toContain('stageImportForConfirm(')
    expect(body).not.toContain('importDIYConfig(')
    expect(body).toContain('请核对导入内容')
  })

  it('搜索面板空查询的编辑按钮 kbd 是 Ctrl/⌘+E，不是裸 E', () => {
    const palette = overlayFile('src/components/search-palette.tsx')
    expect(palette).toContain("{isEditingLayout ? 'Esc' : 'Ctrl/⌘+E'}")
    expect(palette).not.toContain("{isEditingLayout ? 'Esc' : 'E'}")
  })

  it('特征掩码里 DIY 悬浮按钮的标题与描述都说 Ctrl/Cmd+E，不说裸 E', () => {
    const store = overlayFile('src/lib/modular/feature-mask-store.ts')
    expect(store).toContain("title: '右下角 [DIY 排版工坊 Ctrl/⌘+E] 悬浮按钮'")
    expect(store).toContain('仍可随时按 Ctrl/Cmd+E 呼出恢复中心')
    expect(store).not.toContain('按键盘 E 键呼出恢复中心')
    expect(store).not.toContain('[DIY 排版工坊 E] 悬浮按钮')
  })

  it('本机备份还原：先校验、再看 commit 返回值，个数按落地那份算', () => {
    const mgr = overlayFile('src/components/user-center/local-data-manager.tsx')
    const body = mgr.slice(mgr.indexOf('const handleFileChange'), mgr.indexOf('const handleClearVisits'))
    expect(body).toContain('validateAndCleanDIYConfig(data.diyConfig)')
    expect(body).toContain('const result = commitHomeDiyConfig(')
    expect(body).toContain('if (!result.ok)')
    expect(body).toContain('result.config.customCategories')
    expect(body).toContain('本地数据已部分还原')
    expect(body).not.toContain('...data.diyConfig')
  })

  it('快照恢复：自动备份返回值要验，失败文案不许说「排版未改动」', () => {
    const mgr = overlayFile('src/components/user-center/local-data-manager.tsx')
    const body = mgr.slice(
      mgr.indexOf('const handleRestoreSnapshot'),
      mgr.indexOf('const handleDeleteSnapshot'),
    )
    expect(body).toContain('const autoBackup = saveDiySnapshot(')
    expect(body).toContain('description: autoBackup')
    expect(body).toContain('恢复前自动备份失败')
    expect(body).toContain('已在内存中生效')
    // 「排版未改动」只许出现在注释里当反面教材：codeOnly 去掉注释后，用户可见
    // 文案里不许再有这句假话
    expect(codeOnly(body)).not.toContain('排版未改动')
  })
})
