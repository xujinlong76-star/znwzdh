/**
 * F4 档 3：NavDrop 快传的条数台账必须算得出来，也必须被界面说出来。
 *
 * 改之前的四处静默丢弃／假话（apps/web-overlay/src/components/p2p/p2p-airdrop-modal.tsx）：
 *   1. `raw.slice(0, 500)`：本机 800 项收藏只带走 500 项，toast 照写
 *      「已向 X 投送 500 项本地收藏」，尾巴 300 项既不提示也补不回来；
 *   2. `parsed.corrupt → return []`：本地收藏读不出来被伪装成「你没有收藏」，
 *      合并时 `parsed.corrupt` 只是跳过写入，toast 依旧「已成功合并…（新增 0 项收藏）」；
 *   3. 逐条 `continue`（缺 siteId／标题空／href 非 http）与 `slice(0, 200)`、`slice(0, 1024)`
 *      截断完全没有申报；接收侧 `diyConfigRaw.length <= 65536 ? ... : null` 整包丢排版也无声；
 *   4. `siteCount: cleanBookmarks.length || 对端申报` 反过来用清洗后条数盖掉对端申报数，
 *      「这一包少了几项」永远对不出来。
 *   另外：标题栏写着「局域网 / WebRTC P2P / 无损协同」，实现只有 `BroadcastChannel`
 *   （全站无 RTCPeerConnection），手机与别的浏览器永远收不到 yet 界面上看不出来。
 *
 * 现在跨端进出全走 `@/lib/p2p/airdrop-transfer` 的纯函数。本文件先跑真实台账的不变式，
 * 再钉住接线：闸门代码不许没人调用。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  DIY_CONFIG_LIMIT,
  MAX_TRANSFER_BOOKMARKS,
  buildIncomingReport,
  buildLocalBookmarkInventory,
  checkSendFeasibility,
  countFavoriteDelta,
  formatIncomingSummary,
  formatMergeNotice,
  formatSendNotice,
  indexFavorites,
  isTransferableTheme,
  mergeBookmarkLists,
  sanitizeTransferBookmarksWithLedger,
  type AirDropPayload,
  type BookmarkLedger,
  type LocalBookmarkInventory,
} from '@/lib/p2p/airdrop-transfer'

const HERE = dirname(fileURLToPath(import.meta.url))

function existsRead(p: string): boolean {
  try {
    readFileSync(p)
    return true
  } catch {
    return false
  }
}

/** overlay 真相文件（镜像 apps/web/** 由门禁保持同步，这里优先读 overlay） */
function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsRead(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

/** 只留代码：文件头注释里要拿旧文案当反面教材，全文断言会被自己顶穿 */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function goodFav(i: number) {
  return { siteId: `s${i}`, title: `站点 ${i}`, href: `https://e${i}.com`, createdAt: 1 }
}

function favoritesJson(n: number): string {
  return JSON.stringify(Array.from({ length: n }, (_, i) => goodFav(i)))
}

function inventoryOf(raw: string | null | undefined): LocalBookmarkInventory {
  return buildLocalBookmarkInventory(raw)
}

/** 条数加法必须闭合，否则「另有 N 项收不到」本身就是假话 */
function expectLedgerBalances(ledger: BookmarkLedger) {
  expect(ledger.declared).toBe(
    ledger.items.length + ledger.overCap + ledger.malformed + ledger.invalid
  )
  expect(ledger.omitted).toBe(ledger.overCap + ledger.malformed + ledger.invalid)
  expect(ledger.declared - ledger.items.length).toBe(ledger.omitted)
}

describe('sanitizeTransferBookmarksWithLedger：逐因台账', () => {
  it('守恒：脏输入里每条都要有归属', () => {
    const ledger = sanitizeTransferBookmarksWithLedger([
      goodFav(1),
      null,
      'not-an-object',
      { siteId: '', title: '缺 ID', href: 'https://a.com' },
      { siteId: 's2', title: '   ', href: 'https://b.com' },
      { siteId: 's3', title: '伪协议', href: 'javascript:alert(1)' },
      goodFav(2),
    ])
    expectLedgerBalances(ledger)
    expect(ledger.declared).toBe(7)
    expect(ledger.items).toHaveLength(2)
    expect(ledger.malformed).toBe(2)
    expect(ledger.invalid).toBe(3)
    expect(ledger.overCap).toBe(0)
    expect(ledger.omitted).toBe(5)
  })

  it('非数组输入不伪装成「一条都没有的清单」', () => {
    for (const bad of [undefined, null, 'str', 7, {}]) {
      const ledger = sanitizeTransferBookmarksWithLedger(bad)
      expect(ledger.declared).toBe(0)
      expect(ledger.items).toEqual([])
      expectLedgerBalances(ledger)
    }
  })

  it('超出单次上限的条数单独记账，而且根本没被检查', () => {
    const raw = Array.from({ length: MAX_TRANSFER_BOOKMARKS + 3 }, (_, i) => goodFav(i))
    raw[MAX_TRANSFER_BOOKMARKS + 1] = null as never
    const ledger = sanitizeTransferBookmarksWithLedger(raw)
    expect(ledger.declared).toBe(MAX_TRANSFER_BOOKMARKS + 3)
    expect(ledger.overCap).toBe(3)
    expect(ledger.items).toHaveLength(MAX_TRANSFER_BOOKMARKS)
    expect(ledger.malformed).toBe(0) // 上限外的 null 不该混进「脏记录」桶
    expectLedgerBalances(ledger)
  })

  it('截断逐字段计数，而不是默默变短', () => {
    const ledger = sanitizeTransferBookmarksWithLedger([
      {
        siteId: 's1',
        title: 'T'.repeat(250),
        href: 'https://e.com/' + 'p'.repeat(1100),
        description: 'd'.repeat(600),
        note: 'n'.repeat(600),
        icon: 'data:image/svg+xml,evil',
        createdAt: 1,
      },
    ])
    expect(ledger.items).toHaveLength(1)
    expect(ledger.truncatedTitles).toBe(1)
    expect(ledger.truncatedHrefs).toBe(1)
    expect(ledger.truncatedDescriptions).toBe(1)
    expect(ledger.truncatedNotes).toBe(1)
    expect(ledger.droppedIcons).toBe(1)
    expect(ledger.items[0].title).toHaveLength(200)
    expect(ledger.items[0].href).toHaveLength(1024)
    expect(ledger.items[0].icon).toBeUndefined()
    expect(ledger.omitted).toBe(0) // 截断不算「少带走一条」
  })

  it('合法 http(s) 与站内图标地址保留', () => {
    const ledger = sanitizeTransferBookmarksWithLedger([
      { siteId: 's1', title: 'a', href: 'HTTP://E.COM', icon: '/icons/a.svg', createdAt: 1 },
      { siteId: 's2', title: 'b', href: 'https://e.com', icon: 'https://e.com/i.png', createdAt: 2 },
    ])
    expect(ledger.items).toHaveLength(2)
    expect(ledger.droppedIcons).toBe(0)
    expect(ledger.items[0].icon).toBe('/icons/a.svg')
  })

  it('缺 createdAt 补当前时间，坏数字不写进存储', () => {
    const ledger = sanitizeTransferBookmarksWithLedger([
      { siteId: 's1', title: 'a', href: 'https://e.com', createdAt: NaN },
      { siteId: 's2', title: 'b', href: 'https://e.com' },
    ])
    for (const item of ledger.items) expect(Number.isFinite(item.createdAt)).toBe(true)
  })
})

describe('buildLocalBookmarkInventory：读不出来 ≠ 没有收藏', () => {
  it('坏 JSON 走 corrupt，条数保持未知', () => {
    const inv = inventoryOf('[{"siteId":"s1"')
    expect(inv.corrupt).toBe(true)
    expect(inv.storedCount).toBe(0)
    expect(inv.ledger.declared).toBe(0)
    expect(inv.ledger.items).toEqual([])
  })

  it('结构不是数组也算读不出来，不能当成空收藏', () => {
    expect(inventoryOf('{"items":[]}').corrupt).toBe(true)
  })

  it('只有真的没有数据（null／空串）才是空收藏', () => {
    for (const raw of [null, undefined, '']) {
      const inv = inventoryOf(raw)
      expect(inv.corrupt).toBe(false)
      expect(inv.storedCount).toBe(0)
    }
  })

  it('storedCount 是存储条数，可投送数是清洗后的条数，两者分开', () => {
    const raw = JSON.stringify([goodFav(1), { siteId: '', title: 'x', href: 'https://a.com' }, goodFav(2)])
    const inv = inventoryOf(raw)
    expect(inv.storedCount).toBe(3)
    expect(inv.ledger.items).toHaveLength(2)
    expect(inv.ledger.omitted).toBe(1)
    expectLedgerBalances(inv.ledger)
  })
})

describe('buildIncomingReport：对端申报与实际收到要能对账', () => {
  it('不合法包直接返回 null（旧实现会把字符串当对象读）', () => {
    for (const bad of [null, undefined, 'str', 7, []]) {
      expect(buildIncomingReport(bad)).toBe(null)
    }
  })

  it('siteCount 用实际可用条数，绝不采信对端自报', () => {
    const report = buildIncomingReport({
      senderId: 'dev_1',
      senderName: '标签页 A',
      type: 'bookmarks',
      timestamp: 1,
      data: {
        siteCount: 999,
        declaredTotal: 999,
        bookmarks: [goodFav(1), goodFav(2)],
      },
    })!
    expect(report.payload.data.siteCount).toBe(2)
    expect(report.declaredBySender).toBe(999)
    expect(report.missingAgainstDeclaration).toBe(997)
    expect(report.payload.data.bookmarks).toHaveLength(2)
  })

  it('旧客户端没申报总数时不承诺「不缺件」', () => {
    const report = buildIncomingReport({
      senderName: '老版本',
      type: 'bookmarks',
      data: { siteCount: 50, bookmarks: [goodFav(1)] },
    })!
    expect(report.declaredBySender).toBe(null)
    expect(report.missingAgainstDeclaration).toBe(0)
  })

  it('排版超长是「拒收」而不是「没带」', () => {
    const oversize = buildIncomingReport({
      senderName: 'A',
      type: 'all',
      data: { bookmarks: [goodFav(1)], diyConfigRaw: 'x'.repeat(DIY_CONFIG_LIMIT + 1), diyDeclared: true },
    })!
    expect(oversize.payload.data.diyConfigRaw).toBe(null)
    expect(oversize.diyConfigOversize).toBe(true)
    expect(oversize.diyConfigMissing).toBe(false)

    const missing = buildIncomingReport({
      senderName: 'A',
      type: 'all',
      data: { bookmarks: [goodFav(1)], diyConfigRaw: null, diyDeclared: true },
    })!
    expect(missing.diyConfigOversize).toBe(false)
    expect(missing.diyConfigMissing).toBe(true)
  })

  it('投送收藏的包不该有排版：超长不算进台账', () => {
    const report = buildIncomingReport({
      senderName: 'A',
      type: 'bookmarks',
      data: { bookmarks: [goodFav(1)], diyConfigRaw: 'x'.repeat(DIY_CONFIG_LIMIT + 1), diyDeclared: true },
    })!
    expect(report.diyConfigOversize).toBe(false)
    expect(report.diyConfigMissing).toBe(false)
  })

  it('署名与备注截断要留痕', () => {
    const report = buildIncomingReport({
      senderId: 'dev_1',
      senderName: 'N'.repeat(100),
      type: 'bookmarks',
      timestamp: 5,
      data: { bookmarks: [goodFav(1)], notes: 'Z'.repeat(300) },
    })!
    expect(report.payload.senderName).toHaveLength(64)
    expect(report.senderNameTruncated).toBe(true)
    expect(report.payload.data.notes).toHaveLength(200)
    expect(report.notesTruncated).toBe(true)
  })

  it('缺署名回落默认名，而不是渲染成空标题', () => {
    const report = buildIncomingReport({ type: 'bookmarks', data: { bookmarks: [] } })!
    expect(report.payload.senderName).toBe('未知终端')
  })

  it('脏记录在接收侧同样计数', () => {
    const report = buildIncomingReport({
      senderName: 'A',
      type: 'bookmarks',
      data: { declaredTotal: 4, bookmarks: [goodFav(1), null, { href: 'https://no-id.com' }] },
    })!
    expectLedgerBalances(report.ledger)
    expect(report.ledger.items).toHaveLength(1)
    expect(report.ledger.omitted).toBe(2)
    expect(report.missingAgainstDeclaration).toBe(3)
  })

  it('空包要标出来：主题合法就不算空包', () => {
    const empty = buildIncomingReport({ senderName: 'A', type: 'all', data: { bookmarks: [] } })!
    expect(empty.nothingUsable).toBe(true)
    const themed = buildIncomingReport({
      senderName: 'A',
      type: 'theme',
      data: { bookmarks: [], themeName: 'dark' },
    })!
    expect(themed.nothingUsable).toBe(false)
  })

  it('主题原样带出，由界面判断能不能落地', () => {
    const report = buildIncomingReport({
      senderName: 'A',
      type: 'all',
      data: { bookmarks: [goodFav(1)], themeName: 'hot-pink' },
    })!
    expect(report.payload.data.themeName).toBe('hot-pink')
    expect(isTransferableTheme('hot-pink')).toBe(false)
    expect(isTransferableTheme('system')).toBe(true)
  })
})

describe('mergeBookmarkLists：去重与顺序', () => {
  it('保持对端内部顺序（旧实现逐条 unshift，多条会整体反转）', () => {
    const existing = sanitizeTransferBookmarksWithLedger([goodFav(9)]).items
    const incoming = sanitizeTransferBookmarksWithLedger([goodFav(1), goodFav(2), goodFav(3)]).items
    const merged = mergeBookmarkLists(existing, incoming)
    expect(merged.next.map((b) => b.siteId)).toEqual(['s1', 's2', 's3', 's9'])
    expect(merged.added).toBe(3)
    expect(merged.skippedDuplicate).toBe(0)
    expect(merged.next).toHaveLength(existing.length + merged.added)
  })

  it('包内自重复也只算一次（同址不同 ID 不再被重复塞进收藏）', () => {
    const incoming = sanitizeTransferBookmarksWithLedger([
      { siteId: 'sx', title: '同址', href: 'https://e1.com', createdAt: 1 },
      { siteId: 'sy', title: '还是同址', href: 'https://e1.com', createdAt: 2 },
      { siteId: 'sz', title: '同 ID', href: 'https://e2.com', createdAt: 3 },
    ]).items
    const existing = sanitizeTransferBookmarksWithLedger([{ siteId: 'sz', title: '旧', href: 'https://old.com', createdAt: 0 }]).items
    const merged = mergeBookmarkLists(existing, incoming)
    expect(merged.added).toBe(1)
    expect(merged.skippedDuplicate).toBe(2)
    expect(merged.next).toHaveLength(2)
  })

  it('预览与合并同一口径：新增数与落地数不许两个样', () => {
    const existing = sanitizeTransferBookmarksWithLedger([goodFav(1), goodFav(2)]).items
    const incoming = sanitizeTransferBookmarksWithLedger([
      goodFav(1),
      { siteId: 'new', title: '新站', href: 'https://e2.com', createdAt: 9 },
      { siteId: 'other', title: '另一址', href: 'https://fresh.com', createdAt: 8 },
    ]).items
    const delta = countFavoriteDelta(indexFavorites(existing), incoming)
    const merged = mergeBookmarkLists(existing, incoming)
    expect(delta.newCount).toBe(merged.added)
    expect(delta.existingCount).toBe(merged.skippedDuplicate)
    expect(delta.newCount + delta.existingCount).toBe(incoming.length)
  })
})

describe('checkSendFeasibility：能发／不能发要分得开', () => {
  it('本地读不出来 → block（旧实现照发不误）', () => {
    const check = checkSendFeasibility({
      payloadType: 'bookmarks',
      inventory: inventoryOf('{坏数据'),
      diyConfigRaw: null,
      themeName: 'dark',
    })!
    expect(check.kind).toBe('block')
    expect(check.text).toContain('读不出来')
  })

  it('零收藏投送收藏 → block，并说清是「还没有」还是「全不合格」', () => {
    const none = checkSendFeasibility({
      payloadType: 'bookmarks',
      inventory: inventoryOf('[]'),
      diyConfigRaw: null,
      themeName: 'dark',
    })!
    expect(none.kind).toBe('block')
    expect(none.text).toContain('本机还没有收藏')

    const allBad = checkSendFeasibility({
      payloadType: 'bookmarks',
      inventory: inventoryOf(JSON.stringify([{ title: 'x' }, { title: 'y' }, { title: 'z' }])),
      diyConfigRaw: null,
      themeName: 'dark',
    })!
    expect(allBad.kind).toBe('block')
    expect(allBad.text).toContain('3 项收藏全都缺少站点 ID 或合法网址')
  })

  it('排版缺失／超长 → warn，能发的部分照发', () => {
    const noDiy = checkSendFeasibility({
      payloadType: 'all',
      inventory: inventoryOf(favoritesJson(2)),
      diyConfigRaw: null,
      themeName: 'dark',
    })!
    expect(noDiy.kind).toBe('warn')
    expect(noDiy.text).toContain('本机还没有自定义工作台排版')

    const oversize = checkSendFeasibility({
      payloadType: 'theme',
      inventory: inventoryOf(favoritesJson(2)),
      diyConfigRaw: 'x'.repeat(DIY_CONFIG_LIMIT + 1),
      themeName: 'dark',
    })!
    expect(oversize.kind).toBe('warn')
    expect(oversize.text).toContain('超过 64KB')
  })

  it('排版超长且没有收藏、主题又不合法 → 什么都不发，直接 block', () => {
    const check = checkSendFeasibility({
      payloadType: 'theme',
      inventory: inventoryOf('[]'),
      diyConfigRaw: 'x'.repeat(DIY_CONFIG_LIMIT + 1),
      themeName: 'hot-pink',
    })!
    expect(check.kind).toBe('block')
    expect(check.text).toContain('什么都发不出去')
  })

  it('一切正常 → null', () => {
    expect(
      checkSendFeasibility({
        payloadType: 'all',
        inventory: inventoryOf(favoritesJson(3)),
        diyConfigRaw: JSON.stringify({ a: 1 }),
        themeName: 'system',
      })
    ).toBe(null)
  })

  it('投送收藏不该顺带把对方配色改掉', () => {
    const check = checkSendFeasibility({
      payloadType: 'bookmarks',
      inventory: inventoryOf(favoritesJson(1)),
      diyConfigRaw: null,
      themeName: 'dark',
    })
    expect(check).toBe(null)
  })
})

describe('发送／接收／合并的措辞只能照台账走', () => {
  it('零丢失才是 ok，超上限一律降级成告警', () => {
    const clean = sanitizeTransferBookmarksWithLedger([goodFav(1), goodFav(2)])
    const notice = formatSendNotice({
      peerName: '标签页 A',
      ledger: clean,
      carriesBookmarks: true,
      sentBookmarks: 2,
      sentDiy: true,
      sentTheme: true,
    })
    expect(notice.tone).toBe('ok')
    expect(notice.text).toBe('已向「标签页 A」投送 2 项收藏 · 工作台排版 · 主题。')

    const big = sanitizeTransferBookmarksWithLedger(
      Array.from({ length: MAX_TRANSFER_BOOKMARKS + 5 }, (_, i) => goodFav(i))
    )
    const warn = formatSendNotice({
      peerName: '标签页 A',
      ledger: big,
      carriesBookmarks: true,
      sentBookmarks: MAX_TRANSFER_BOOKMARKS,
      sentDiy: false,
      sentTheme: true,
    })
    expect(warn.tone).toBe('warn')
    expect(warn.text).toContain(`${MAX_TRANSFER_BOOKMARKS} 项上限`)
    expect(warn.text).toContain('这部分对方收不到')
    expect(warn.text).not.toContain('无损')
  })

  it('不带收藏的包不该拿收藏台账说事', () => {
    const dirty = sanitizeTransferBookmarksWithLedger([null, { siteId: '', title: '', href: '' }])
    const notice = formatSendNotice({
      peerName: 'A',
      ledger: dirty,
      carriesBookmarks: false,
      sentBookmarks: 0,
      sentDiy: true,
      sentTheme: true,
    })
    expect(notice.tone).toBe('ok')
    expect(notice.text).not.toContain('上限')
    expect(notice.text).not.toContain('缺站点')
  })

  it('接收预览把差额与脏件摊开', () => {
    const report = buildIncomingReport({
      senderName: 'A',
      type: 'all',
      data: {
        declaredTotal: 800,
        bookmarks: [goodFav(1), goodFav(2), { siteId: 'bad', title: '', href: 'ftp://x' }],
        diyConfigRaw: null,
        diyDeclared: true,
      },
    })!
    const summary = formatIncomingSummary({ report, newCount: 2, existingCount: 0 })
    expect(summary.tone).toBe('warn')
    expect(summary.text).toContain('可用收藏 2 项')
    expect(summary.text).toContain('少 798 项')
    expect(summary.text).toContain('1 项缺站点 ID')
    expect(summary.text).toContain('对端申报了排版但没收到')

    const clean = formatIncomingSummary({
      report: buildIncomingReport({
        senderName: 'A',
        type: 'bookmarks',
        data: { declaredTotal: 2, bookmarks: [goodFav(1), goodFav(2)] },
      })!,
      newCount: 1,
      existingCount: 1,
    })
    expect(clean.tone).toBe('ok')
    expect(clean.text).toContain('与本机重复 1')
  })

  it('本地读不出来时合并绝不写「成功」，两种成因分开说', () => {
    const report = buildIncomingReport({
      senderName: 'A',
      type: 'bookmarks',
      data: { declaredTotal: 1, bookmarks: [goodFav(1)] },
    })!
    const quarantined = formatMergeNotice({
      senderName: report.payload.senderName,
      ledger: report.ledger,
      merge: null,
      localCorrupt: true,
      unavailableRaw: false,
      diyApplied: false,
      diyRejectedReason: null,
      appliedTheme: null,
      rejectedTheme: null,
      nothingUsable: false,
    })
    expect(quarantined.tone).toBe('error')
    expect(quarantined.text).toContain('没有写入')
    expect(quarantined.text).toContain('隔离键')
    expect(quarantined.text).not.toContain('成功')

    const noStorage = formatMergeNotice({
      senderName: report.payload.senderName,
      ledger: report.ledger,
      merge: null,
      localCorrupt: true,
      unavailableRaw: true,
      diyApplied: false,
      diyRejectedReason: null,
      appliedTheme: null,
      rejectedTheme: null,
      nothingUsable: false,
    })
    expect(noStorage.tone).toBe('error')
    expect(noStorage.text).toContain('隐私模式')
    expect(noStorage.text).not.toContain('隔离')
  })

  it('半成功逐项点名：排版坏 JSON、主题不认识、包内少件', () => {
    const report = buildIncomingReport({
      senderName: 'A',
      type: 'all',
      data: { declaredTotal: 4, bookmarks: [goodFav(1), goodFav(2)], themeName: 'hot-pink' },
    })!
    const merge = mergeBookmarkLists([], report.ledger.items)
    const notice = formatMergeNotice({
      senderName: report.payload.senderName,
      ledger: report.ledger,
      merge,
      localCorrupt: false,
      unavailableRaw: false,
      diyApplied: false,
      diyRejectedReason: 'malformed',
      appliedTheme: null,
      rejectedTheme: 'hot-pink',
      nothingUsable: false,
    })
    expect(notice.tone).toBe('warn')
    expect(notice.text).toContain('新增 2 项收藏')
    expect(notice.text).toContain('不是合法 JSON')
    expect(notice.text).toContain('本机不支持')
    expect(notice.text).toContain('排版内容不是合法 JSON')
  })

  it('排版写不进去是存储问题，不报成「内容不合法」', () => {
    const report = buildIncomingReport({
      senderName: 'A',
      type: 'all',
      data: { declaredTotal: 1, bookmarks: [goodFav(1)], diyConfigRaw: JSON.stringify({ grid: [] }) },
    })!
    const notice = formatMergeNotice({
      senderName: 'A',
      ledger: report.ledger,
      merge: mergeBookmarkLists([], report.ledger.items),
      localCorrupt: false,
      unavailableRaw: false,
      diyApplied: false,
      diyRejectedReason: 'write-failed',
      appliedTheme: null,
      rejectedTheme: null,
      nothingUsable: false,
    })
    expect(notice.tone).toBe('warn')
    expect(notice.text).toContain('排版写入失败')
    expect(notice.text).not.toContain('不是合法 JSON')
  })

  it('全量落地才用「已接收」的平铺口径', () => {
    const report = buildIncomingReport({
      senderName: 'A',
      type: 'all',
      data: {
        declaredTotal: 2,
        bookmarks: [goodFav(1), goodFav(2)],
        themeName: 'dark',
        diyConfigRaw: JSON.stringify({ grid: [] }),
      },
    })!
    const merge = mergeBookmarkLists([], report.ledger.items)
    const notice = formatMergeNotice({
      senderName: report.payload.senderName,
      ledger: report.ledger,
      merge,
      localCorrupt: false,
      unavailableRaw: false,
      diyApplied: true,
      diyRejectedReason: null,
      appliedTheme: 'dark',
      rejectedTheme: null,
      nothingUsable: false,
    })
    expect(notice.tone).toBe('ok')
    expect(notice.text).toContain('新增 2 项收藏')
    expect(notice.text).toContain('工作台排版已套用')
    expect(notice.text).toContain('主题切到「dark」')
    expect(notice.text).not.toMatch(/另有|已丢弃|不支持/)
  })

  it('空包不得写成合并成功', () => {
    const report = buildIncomingReport({ senderName: 'A', type: 'bookmarks', data: { bookmarks: [] } })!
    const notice = formatMergeNotice({
      senderName: 'A',
      ledger: report.ledger,
      merge: null,
      localCorrupt: false,
      unavailableRaw: false,
      diyApplied: false,
      diyRejectedReason: null,
      appliedTheme: null,
      rejectedTheme: null,
      nothingUsable: true,
    })
    expect(notice.tone).toBe('warn')
    expect(notice.text).toContain('没有可用的内容')
  })
})

describe('接线守则：台账必须真的被界面调用', () => {
  const modal = codeOnly(overlayFile('src/components/p2p/p2p-airdrop-modal.tsx'))
  const spotlight = codeOnly(overlayFile('src/components/search/spotlight-modal.tsx'))
  const lib = codeOnly(overlayFile('src/lib/p2p/airdrop-transfer.ts'))

  it('跨端进出全走纯函数，不再手写上限与 slice', () => {
    expect(modal).toContain('buildIncomingReport(msg.payload)')
    expect(modal).toContain('buildLocalBookmarkInventory(localStorage.getItem(FAVORITES_STORAGE_KEY))')
    expect(modal).toContain('mergeBookmarkLists(local.ledger.items, incomingBookmarks)')
    expect(modal).toContain('checkSendFeasibility({ payloadType, inventory: latest, diyConfigRaw, themeName: currentTheme })')
    expect(modal).toContain('formatSendNotice({')
    expect(modal).toContain('formatMergeNotice({')
    expect(modal).toContain('formatIncomingSummary({ report: incoming,')
    expect(modal).not.toMatch(/next\.unshift\(/)
    expect(modal).not.toMatch(/\.slice\(0, 500\)/)
    expect(modal).not.toMatch(/\.slice\(0, 200\)/)
    expect(modal).not.toMatch(/65536/)
    expect(lib).toContain('raw.slice(0, MAX_TRANSFER_BOOKMARKS)')
  })

  it('发送申报本机总数，接收不采信对端自报', () => {
    expect(modal).toContain('declaredTotal: latest.corrupt ? null : latest.storedCount')
    expect(modal).not.toMatch(/data\?\.siteCount/)
    expect(modal).not.toMatch(/siteCount:\s*bookmarks\.length\s*\|\|/)
  })

  it('block 与 corrupt 都有出口：不发也不写', () => {
    expect(modal).toContain("if (check?.kind === 'block')")
    expect(modal).toContain('if (local.corrupt) {')
    expect(modal).toContain('disabled={inventory.corrupt}')
    expect(modal).toContain('disabled={!canSend}')
    expect(modal).toContain('const canSend = !inventory.corrupt && sendableCount > 0')
    expect(modal).toContain('toneToToast(notice.tone)(notice.text)')
    expect(modal).toMatch(/role=\{incomingSummary\.tone === 'warn' \? 'alert' : 'status'\}/)
  })

  it('坏数据进隔离键、写失败回滚：不再「跳过写入却报成功」', () => {
    expect(modal).toContain('localStorage.setItem(corruptBackupKey(Date.now()), rawNow)')
    expect(modal).toContain('if (!local.unavailableRaw) {')
    expect(modal).toContain('rollbackFailed = true')
    expect(modal).toContain('localStorage.removeItem(FAVORITES_STORAGE_KEY)')
    expect(modal).toContain('toast.error(rollbackFailed ? FAVORITES_ROLLBACK_FAILED_HINT : FAVORITES_WRITE_FAILED_HINT)')
    // 先写成功再记账：旧实现是「先算 merge 再试写」，写失败时界面无从知道少了什么
    expect(modal).toContain('const candidate = mergeBookmarkLists(local.ledger.items, incomingBookmarks)')
    expect(modal).not.toContain('合并跨端快传数据失败')
    // 预览与合并同一口径，且不许残留旧的单键 Set 判定
    expect(modal).toContain('countFavoriteDelta(indexFavorites(inventory.ledger.items)')
    expect(modal).not.toMatch(/new Set\(.*\.map\(\(b\) => b\.siteId \|\| b\.href\)\)/)
  })

  it('配色只在「主题/全部」包里改动，且必须过白名单', () => {
    expect(modal).toContain('const themeIncluded = carriesDiy && isTransferableTheme(currentTheme)')
    expect(modal).toContain("report.payload.type === 'bookmarks' ? undefined : report.payload.data.themeName")
    expect(modal).toContain('setTheme(incomingTheme)')
  })

  it('设备类型不再硬写 desktop', () => {
    expect(modal).toContain('deviceType: deviceTypeRef.current')
    expect(modal).not.toMatch(/deviceType: 'desktop'/)
  })

  it('本机条数说「存储 vs 可投送」两个数，读不出来单独成态', () => {
    expect(modal).toContain('本机收藏 ${inventory.storedCount} 项，可投送 ${sendableCount} 项')
    expect(modal).toContain('本机收藏读不出来（条数未知），已暂停读写')
    expect(modal).toContain('本机 ${inventory.ledger.omitted} 项收藏不合格或超出单次上限，不会随包发出')
  })

  it('谎报能力的文案清零：没有 WebRTC，也没有局域网', () => {
    for (const banned of ['局域网', 'WebRTC', '无损', 'P2P v2.1', '隔空投送', '周围在线设备']) {
      expect(modal).not.toContain(banned)
    }
    for (const banned of ['局域网', 'WebRTC', '无损快传']) {
      expect(spotlight).not.toContain(banned)
    }
    expect(modal).toContain('同浏览器直连')
    expect(modal).toContain('跨设备请去「数据」页导出备份')
  })

  it('通道不可用要说出来，而不是假装在扫描', () => {
    expect(modal).toContain('当前浏览器不支持 BroadcastChannel，快传通道不可用')
    expect(modal).toContain('快传通道不可用：当前浏览器没有 BroadcastChannel')
  })

  it('payload 类型是共享契约：组件与台账用的是同一份', () => {
    const declared = modal.match(/const payload: AirDropPayload = \{[\s\S]*?\n    \}/)
    expect(declared).not.toBeNull()
    for (const key of ['siteCount', 'declaredTotal', 'bookmarks', 'themeName', 'diyConfigRaw', 'diyDeclared', 'notes']) {
      expect(declared![0]).toContain(`${key}:`)
    }
    const libPayload = lib.match(/export interface AirDropPayload \{[\s\S]*?\n\}/)
    expect(libPayload).not.toBeNull()
    for (const key of ['siteCount', 'declaredTotal', 'diyDeclared']) {
      expect(libPayload![0]).toContain(key)
    }
    const sample = JSON.parse(
      JSON.stringify({
        senderId: 'dev_1',
        senderName: 'A',
        type: 'all',
        timestamp: 1,
        data: { siteCount: 1, declaredTotal: 1, bookmarks: [goodFav(1)], diyDeclared: true },
      } satisfies AirDropPayload)
    )
    expect(buildIncomingReport(sample)!.payload.data.declaredTotal).toBe(1)
  })
})
