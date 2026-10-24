/**
 * NavDrop 快传的数据边界：条数上限、字段长度，以及「这份包到底装了多少」的台账。
 *
 * 改之前的四处假话／静默丢弃（`components/p2p/p2p-airdrop-modal.tsx`）：
 *   1. `raw.slice(0, 500)`：本机有 800 项收藏时只带走 500 项，界面仍写
 *      「已向 X 投送 500 项本地收藏」——尾巴 300 项既不提示也补不回来；
 *   2. `parsed.corrupt` → `return []`：本地收藏读不出来时被伪装成「你没有收藏」，
 *      按钮显示「隔空快传 (0)」，合并时又把这份「空」直接写回 localStorage；
 *   3. 逐条 `continue` 丢掉的脏记录（缺 siteId / 标题空 / href 非 http）与
 *      `slice(0, 200)`、`slice(0, 1024)` 截断的标题、网址完全没有申报；
 *   4. 接收侧 `diyConfigRaw.length <= 65536 ? ... : null` 与 `notes.slice(0, 200)`
 *      整包丢弃排版却毫无痕迹；`siteCount: cleanBookmarks.length || 对端申报`
 *      反过来用「清洗后条数」盖掉对端申报数，缺件永远对不出来。
 *
 * 现在所有跨端进出都过本文件的纯函数，逐因回传（overCap / malformed / invalid /
 * truncated* / diyConfigOversize / missingAgainstDeclaration）。
 * 不变式：`declared === items.length + overCap + malformed + invalid`。
 * `ok` 口径只能是「零丢失」；只要有任何一项没随包走，措辞就必须降级成告警。
 *
 * 本文件零 React、零 DOM：`localStorage` 与 `BroadcastChannel` 留在调用方，
 * 这里只吃字符串与 unknown，因此台账能直接用真实数据跑断言。
 */

import { corruptKeyFor, parseFavorites } from '@/lib/favorites-storage'

/** 单次投送携带的收藏条数上限：按最坏 1024 字符网址估算，整包约 2MB 量级 */
export const MAX_TRANSFER_BOOKMARKS = 2000
const SITE_ID_LIMIT = 128
const TITLE_LIMIT = 200
const HREF_LIMIT = 1024
const ICON_LIMIT = 512
const TEXT_FIELD_LIMIT = 500
const FOLDER_ID_LIMIT = 64
const NAME_LIMIT = 64
const NOTES_LIMIT = 200
/** 工作台排版的整包上限：超过则对端直接不收，发送前就要说清楚 */
export const DIY_CONFIG_LIMIT = 65536

export interface TransferFavoriteItem {
  siteId: string
  title: string
  href: string
  icon?: string
  description?: string
  note?: string
  folderId?: string | null
  createdAt: number
}

export type AirDropPayloadType = 'bookmarks' | 'theme' | 'all'

export interface AirDropPayload {
  senderId: string
  senderName: string
  type: AirDropPayloadType
  timestamp: number
  data: {
    /** 实际随包走的收藏条数 */
    siteCount: number
    /** 发送方本机存储里的收藏总数；未知（读不出来）时为 null */
    declaredTotal: number | null
    bookmarks?: TransferFavoriteItem[]
    themeName?: string
    diyConfigRaw?: string | null
    /** 发送方是否本应带上排版：让接收侧能区分「没带」与「带了但被拒收」 */
    diyDeclared?: boolean
    notes?: string
  }
}

/** 收藏列表清洗的逐因台账 */
export interface BookmarkLedger {
  items: TransferFavoriteItem[]
  /** 输入里声明的条数（非数组时为 0） */
  declared: number
  /** 超出单次上限、根本没被检查的条数 */
  overCap: number
  /** 条目本身不是对象 */
  malformed: number
  /** 缺 siteId / 标题为空 / href 不是 http(s) */
  invalid: number
  truncatedTitles: number
  truncatedHrefs: number
  truncatedDescriptions: number
  truncatedNotes: number
  /** 有 icon 但形状不合法，被丢弃该字段 */
  droppedIcons: number
  /** `declared - items.length`：本次没能随包带走的条数 */
  omitted: number
}

function emptyLedger(): BookmarkLedger {
  return {
    items: [],
    declared: 0,
    overCap: 0,
    malformed: 0,
    invalid: 0,
    truncatedTitles: 0,
    truncatedHrefs: 0,
    truncatedDescriptions: 0,
    truncatedNotes: 0,
    droppedIcons: 0,
    omitted: 0,
  }
}

/** 清洗收藏并逐因记账：任何一条没进包都要能说出为什么 */
export function sanitizeTransferBookmarksWithLedger(raw: unknown): BookmarkLedger {
  const ledger = emptyLedger()
  if (!Array.isArray(raw)) return ledger
  ledger.declared = raw.length
  if (raw.length > MAX_TRANSFER_BOOKMARKS) {
    ledger.overCap = raw.length - MAX_TRANSFER_BOOKMARKS
  }
  for (const item of raw.slice(0, MAX_TRANSFER_BOOKMARKS)) {
    if (!item || typeof item !== 'object') {
      ledger.malformed++
      continue
    }
    const rec = item as Record<string, unknown>
    const siteId = typeof rec.siteId === 'string' ? rec.siteId.trim() : ''
    const title = typeof rec.title === 'string' ? rec.title.trim() : ''
    const href = typeof rec.href === 'string' ? rec.href.trim() : ''
    if (!siteId || !title || !/^https?:\/\//i.test(href)) {
      ledger.invalid++
      continue
    }
    if (title.length > TITLE_LIMIT) ledger.truncatedTitles++
    if (href.length > HREF_LIMIT) ledger.truncatedHrefs++
    const rawIcon = typeof rec.icon === 'string' ? rec.icon.trim() : ''
    const iconOk = /^https?:\/\//i.test(rawIcon) || rawIcon.startsWith('/')
    if (rawIcon && !iconOk) ledger.droppedIcons++
    const description = typeof rec.description === 'string' ? rec.description : ''
    if (description.length > TEXT_FIELD_LIMIT) ledger.truncatedDescriptions++
    const note = typeof rec.note === 'string' ? rec.note : ''
    if (note.length > TEXT_FIELD_LIMIT) ledger.truncatedNotes++
    ledger.items.push({
      siteId: siteId.slice(0, SITE_ID_LIMIT),
      title: title.slice(0, TITLE_LIMIT),
      href: href.slice(0, HREF_LIMIT),
      icon: iconOk ? rawIcon.slice(0, ICON_LIMIT) : undefined,
      description: description ? description.slice(0, TEXT_FIELD_LIMIT) : undefined,
      note: note ? note.slice(0, TEXT_FIELD_LIMIT) : undefined,
      folderId: typeof rec.folderId === 'string' ? rec.folderId.slice(0, FOLDER_ID_LIMIT) : null,
      createdAt: typeof rec.createdAt === 'number' && Number.isFinite(rec.createdAt) ? rec.createdAt : Date.now(),
    })
  }
  ledger.omitted = ledger.overCap + ledger.malformed + ledger.invalid
  return ledger
}

/** 本机收藏库存：把「读不出来」与「真的没有」分开 */
export interface LocalBookmarkInventory {
  /** 存储里读到的原始条数；读不出来时是 0（条数未知，不能瞎报） */
  storedCount: number
  corrupt: boolean
  /** 连原始字符串都没拿到（localStorage 抛异常）：坏数据没处隔离，只能就地说明 */
  unavailableRaw: boolean
  ledger: BookmarkLedger
}

/**
 * 「读不出来」这一状态的唯一起点：调用方（存储本身抛异常时）也用它，
 * 好让界面能说清「条数未知」而不是滑回「你没有收藏」。
 */
export function corruptInventory(unavailableRaw = false): LocalBookmarkInventory {
  return { storedCount: 0, corrupt: true, unavailableRaw, ledger: emptyLedger() }
}

/**
 * 从 localStorage 的原始字符串算出库存。
 * `corrupt` 时 ledger 全零：调用方必须据此**拒绝投送与合并**，
 * 而不是拿一份「空收藏」去覆盖用户真实数据。
 */
export function buildLocalBookmarkInventory(raw: string | null | undefined): LocalBookmarkInventory {
  const parsed = parseFavorites<TransferFavoriteItem>(raw)
  if (parsed.corrupt) return corruptInventory()
  const ledger = sanitizeTransferBookmarksWithLedger(parsed.items)
  return { storedCount: parsed.items.length, corrupt: false, unavailableRaw: false, ledger }
}

/** 接收侧对整包的逐因台账 */
export interface IncomingReport {
  payload: AirDropPayload
  ledger: BookmarkLedger
  /** 对端申报的总数；旧客户端没申报时为 null（此时不承诺「不缺件」） */
  declaredBySender: number | null
  /** 对端申报数 − 实际可用条数：>0 就是这一包少给了 */
  missingAgainstDeclaration: number
  senderNameTruncated: boolean
  notesTruncated: boolean
  /** 对端说带了排版，但整包超过上限被拒收 */
  diyConfigOversize: boolean
  /** 对端申报带了排版，收到的包里却没有 */
  diyConfigMissing: boolean
  /** 收藏与排版都没带来——「接受」按下去什么也不会发生 */
  nothingUsable: boolean
}

function clampText(value: unknown, limit: number): { text: string; truncated: boolean } {
  const raw = typeof value === 'string' ? value : ''
  return { text: raw.slice(0, limit), truncated: raw.length > limit }
}

/** 把外部（不可信）的 payload 收成结构化台账；不合法包返回 null，调用方直接忽略 */
export function buildIncomingReport(rawPayload: unknown): IncomingReport | null {
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) return null
  const doc = rawPayload as Record<string, unknown>
  const data = (doc.data && typeof doc.data === 'object' ? doc.data : {}) as Record<string, unknown>
  const ledger = sanitizeTransferBookmarksWithLedger(data.bookmarks)
  const declared = typeof data.declaredTotal === 'number' && Number.isFinite(data.declaredTotal) ? data.declaredTotal : null
  const senderName = clampText(doc.senderName, NAME_LIMIT)
  if (senderName.text === '') senderName.text = '未知终端'
  const notes = clampText(data.notes, NOTES_LIMIT)
  const diyRawIsString = typeof data.diyConfigRaw === 'string' && (data.diyConfigRaw as string) !== ''
  const diyOversize = diyRawIsString && (data.diyConfigRaw as string).length > DIY_CONFIG_LIMIT
  const diyDeclared = data.diyDeclared === true
  const type: AirDropPayloadType = doc.type === 'theme' || doc.type === 'all' ? doc.type : 'bookmarks'
  const payload: AirDropPayload = {
    senderId: clampText(doc.senderId, SITE_ID_LIMIT).text,
    senderName: senderName.text,
    type,
    timestamp: typeof doc.timestamp === 'number' && Number.isFinite(doc.timestamp) ? doc.timestamp : Date.now(),
    data: {
      siteCount: ledger.items.length,
      declaredTotal: declared,
      bookmarks: ledger.items,
      themeName: typeof data.themeName === 'string' ? clampText(data.themeName, NAME_LIMIT).text : undefined,
      diyConfigRaw: diyRawIsString && !diyOversize ? (data.diyConfigRaw as string) : null,
      diyDeclared: diyDeclared || diyRawIsString,
      notes: notes.text || undefined,
    },
  }
  const carriesBookmarks = type !== 'theme'
  const carriesDiy = type !== 'bookmarks'
  // 排版或合法主题都算「有东西可落地」：只有两者都没有才算空包
  const anythingForDiySlot = !!payload.data.diyConfigRaw || isTransferableTheme(payload.data.themeName)
  return {
    payload,
    ledger,
    declaredBySender: declared,
    missingAgainstDeclaration: declared === null ? 0 : Math.max(0, declared - ledger.items.length),
    senderNameTruncated: senderName.truncated,
    notesTruncated: notes.truncated,
    diyConfigOversize: carriesDiy && diyOversize,
    diyConfigMissing: carriesDiy && diyDeclared && !diyRawIsString,
    nothingUsable:
      (carriesBookmarks ? ledger.items.length === 0 : true) && (carriesDiy ? !anythingForDiySlot : true),
  }
}

/**
 * 收藏的去重索引：`siteId` 与 `href` 两根键各存一份。
 * 旧实现预览用「两根键都查」、合并只用「siteId 或 href 单键」，
 * 于是同一包会出现「预览说已存在、合并却新增」，两个数永远对不上。
 * 现在预览与合并共用这一份索引判定。
 */
export interface FavoriteIndex {
  ids: Set<string>
  hrefs: Set<string>
}

export function indexFavorites(items: readonly TransferFavoriteItem[]): FavoriteIndex {
  const ids = new Set<string>()
  const hrefs = new Set<string>()
  for (const item of items) {
    ids.add(item.siteId)
    hrefs.add(item.href)
  }
  return { ids, hrefs }
}

export function isKnownFavorite(index: FavoriteIndex, item: TransferFavoriteItem): boolean {
  return index.ids.has(item.siteId) || index.hrefs.has(item.href)
}

/** 差量预览：新增几项 / 已存在几项（与 mergeBookmarkLists 同一判定口径） */
export function countFavoriteDelta(
  index: FavoriteIndex,
  incoming: readonly TransferFavoriteItem[]
): { newCount: number; existingCount: number } {
  const probe: FavoriteIndex = { ids: new Set(index.ids), hrefs: new Set(index.hrefs) }
  let newCount = 0
  let existingCount = 0
  for (const item of incoming) {
    if (isKnownFavorite(probe, item)) {
      existingCount++
      continue
    }
    probe.ids.add(item.siteId)
    probe.hrefs.add(item.href)
    newCount++
  }
  return { newCount, existingCount }
}

/** 合并结果：新增 / 重复 / 因本地读不出来而放弃写入 */
export interface MergeResult {
  next: TransferFavoriteItem[]
  added: number
  skippedDuplicate: number
}

/**
 * 去重合并。两条真缺陷顺手修掉：
 *   - 旧实现逐条 `unshift`，多条时**整个顺序被反转**，收藏夹排序跟着乱；
 *   - 旧实现只用 `siteId || href` 单键判重，同址不同 ID 的对端记录会被重复塞进来。
 * 这里保持对端内部顺序，且包内自重复也只算一次。
 */
export function mergeBookmarkLists(
  existing: readonly TransferFavoriteItem[],
  incoming: readonly TransferFavoriteItem[]
): MergeResult {
  const index = indexFavorites(existing)
  const toAdd: TransferFavoriteItem[] = []
  let skippedDuplicate = 0
  for (const item of incoming) {
    if (isKnownFavorite(index, item)) {
      skippedDuplicate++
      continue
    }
    index.ids.add(item.siteId)
    index.hrefs.add(item.href)
    toAdd.push(item)
  }
  return { next: [...toAdd, ...existing], added: toAdd.length, skippedDuplicate }
}

export type NoticeTone = 'ok' | 'warn' | 'error'

/** 台账里「少带走的条数」说成一句人话；零丢失时返回 null */
export function describeOmitted(ledger: BookmarkLedger): string | null {
  const parts: string[] = []
  if (ledger.overCap > 0) parts.push(`${ledger.overCap} 项超出单次 ${MAX_TRANSFER_BOOKMARKS} 项上限`)
  if (ledger.invalid > 0) parts.push(`${ledger.invalid} 项缺站点 ID／标题或网址不是 http(s)`)
  if (ledger.malformed > 0) parts.push(`${ledger.malformed} 项不是有效记录`)
  if (parts.length === 0) return null
  return parts.join('、')
}

/** 字段被截短的提示（可选信息丢失，不影响收录，只降级措辞，不谎称「无损」） */
function describeTruncation(ledger: BookmarkLedger): string | null {
  const parts: string[] = []
  if (ledger.truncatedTitles > 0) parts.push(`${ledger.truncatedTitles} 条标题`)
  if (ledger.truncatedHrefs > 0) parts.push(`${ledger.truncatedHrefs} 条网址`)
  if (ledger.truncatedDescriptions > 0 || ledger.truncatedNotes > 0) {
    parts.push(`${ledger.truncatedDescriptions + ledger.truncatedNotes} 条备注／简介`)
  }
  if (ledger.droppedIcons > 0) parts.push(`${ledger.droppedIcons} 个图标地址不合法被去掉`)
  if (parts.length === 0) return null
  return `${parts.join('、')}被截短`
}

export const CORRUPT_FAVORITES_HINT =
  '本机收藏数据读不出来（条数未知）。为避免把真实收藏覆盖成空列表，已暂停快传读写 —— 坏数据已另存到隔离键，可在「数据」页备份后重置。'

/** localStorage 本身抛异常（隐私模式／配额）时没有隔离处可写，只能就地说明 */
export const STORAGE_UNAVAILABLE_HINT =
  '本机存储读不出来（浏览器可能禁用了 localStorage，或处于隐私模式）。快传需要读写收藏，已暂停 —— 换普通窗口再试。'

export const FAVORITES_WRITE_FAILED_HINT =
  '写入本机收藏失败（存储不可用或配额已满），已回滚到合并前的列表 —— 对端内容没有落地。'

export const FAVORITES_ROLLBACK_FAILED_HINT =
  '写入本机收藏失败，且回滚也没成功：本机收藏状态未知，已暂停快传读写，请到「数据」页检查后再用。'

/** 发送前置检查：`block` 按下去不会发包，`warn` 是「能发但要说清缺了什么」 */
export interface SendCheck {
  kind: 'block' | 'warn'
  text: string
}

/**
 * 投送前就决定得到的口径。
 * 旧实现什么都不检查：收藏为空也照发，toast 照样写成功；排版超 64KB 发送侧照塞，
 * 接收侧静默丢整包 —— 两端都以为传完了。
 */
export function checkSendFeasibility(args: {
  payloadType: AirDropPayloadType
  inventory: LocalBookmarkInventory
  diyConfigRaw: string | null
  themeName: string
}): SendCheck | null {
  const { payloadType, inventory, diyConfigRaw, themeName } = args
  if (inventory.corrupt) {
    return {
      kind: 'block',
      text: inventory.unavailableRaw ? STORAGE_UNAVAILABLE_HINT : CORRUPT_FAVORITES_HINT,
    }
  }
  const carriesBookmarks = payloadType !== 'theme'
  const carriesDiy = payloadType !== 'bookmarks'
  const sendableCount = inventory.ledger.items.length
  const diyTooBig = !!diyConfigRaw && diyConfigRaw.length > DIY_CONFIG_LIMIT
  const diyUsable = carriesDiy && !!diyConfigRaw && !diyTooBig
  // 主题只在「主题/全部」这类包里携带：点「投送收藏」却把对方配色改掉是越界
  const themeUsable = carriesDiy && isTransferableTheme(themeName)

  const problems: string[] = []
  if (carriesBookmarks && sendableCount === 0) {
    problems.push(
      inventory.storedCount === 0
        ? '本机还没有收藏'
        : `本机 ${inventory.storedCount} 项收藏全都缺少站点 ID 或合法网址`,
    )
  }
  if (carriesDiy && !diyUsable) {
    problems.push(
      diyTooBig
        ? `工作台排版超过 ${Math.floor(DIY_CONFIG_LIMIT / 1024)}KB，对端会整包拒收`
        : '本机还没有自定义工作台排版',
    )
  }
  if (carriesDiy && !themeUsable) {
    problems.push(`本机主题「${themeName}」不在 light/dark/system 之内，对端不会切换`)
  }
  if (problems.length === 0) return null
  const willLand = (carriesBookmarks && sendableCount > 0) || diyUsable || themeUsable
  if (!willLand) return { kind: 'block', text: `这次什么都发不出去：${problems.join('；')}。` }
  return { kind: 'warn', text: `${problems.join('；')} —— 这次只发能落地的部分。` }
}

/** next-themes 在本站的取值：`attribute="class"` + `enableSystem`，别的值一律不接受 */
export const TRANSFERABLE_THEMES = ['light', 'dark', 'system'] as const
export type TransferableTheme = (typeof TRANSFERABLE_THEMES)[number]

export function isTransferableTheme(value: unknown): value is TransferableTheme {
  return typeof value === 'string' && (TRANSFERABLE_THEMES as readonly string[]).includes(value)
}

/** 投送后的确认文案：只说「实际装进包里的东西」，有任何一项没随包走就不是干净的「成功」 */
export function formatSendNotice(args: {
  peerName: string
  ledger: BookmarkLedger
  carriesBookmarks: boolean
  sentBookmarks: number
  sentDiy: boolean
  sentTheme: boolean
}): { text: string; tone: NoticeTone } {
  const parts: string[] = []
  if (args.carriesBookmarks && args.sentBookmarks > 0) parts.push(`${args.sentBookmarks} 项收藏`)
  if (args.sentDiy) parts.push('工作台排版')
  if (args.sentTheme) parts.push('主题')
  const subject = parts.join(' · ') || '空包'
  const omitted = args.carriesBookmarks ? describeOmitted(args.ledger) : null
  const truncated = args.carriesBookmarks ? describeTruncation(args.ledger) : null
  if (omitted) {
    return { text: `已向「${args.peerName}」投送 ${subject}，${omitted} —— 这部分对方收不到。`, tone: 'warn' }
  }
  if (truncated) {
    return { text: `已向「${args.peerName}」投送 ${subject}，${truncated}。`, tone: 'warn' }
  }
  return { text: `已向「${args.peerName}」投送 ${subject}。`, tone: 'ok' }
}

/** 接收预览：把「对端申报 vs 实际可用」差额摊开，而不是照抄对端的数字 */
export function formatIncomingSummary(args: {
  report: IncomingReport
  newCount: number
  existingCount: number
}): { text: string; tone: NoticeTone } {
  const { report, newCount, existingCount } = args
  const parts: string[] = []
  const carriedBookmarks = report.payload.type !== 'theme'
  if (carriedBookmarks) {
    parts.push(`可用收藏 ${report.ledger.items.length} 项（新增 ${newCount}，与本机重复 ${existingCount}）`)
  } else {
    parts.push('不带收藏')
  }
  const themeCarried = report.payload.type !== 'bookmarks' && report.payload.data.themeName
  if (themeCarried) parts.push(`主题「${report.payload.data.themeName}」`)
  if (report.payload.data.diyConfigRaw) parts.push('工作台排版')
  else if (report.diyConfigOversize) parts.push('排版超长被拒收')
  else if (report.diyConfigMissing) parts.push('对端申报了排版但没收到')
  const omitted = describeOmitted(report.ledger)
  if (omitted) parts.push(`包里有 ${omitted}`)
  const missing = report.missingAgainstDeclaration
  if (missing > 0) parts.push(`比对方申报的 ${report.declaredBySender} 项少 ${missing} 项`)
  if (report.senderNameTruncated || report.notesTruncated) parts.push('对端署名或备注被截短')
  if (report.nothingUsable) parts.push('这一包里没有任何可落地的内容')
  return {
    text: parts.join(' · '),
    tone:
      report.nothingUsable ||
      missing > 0 ||
      report.ledger.omitted > 0 ||
      report.diyConfigOversize ||
      report.diyConfigMissing
        ? 'warn'
        : 'ok',
  }
}

/** 合并后的结果文案：失败与半成功都不能写成「已成功合并」 */
export function formatMergeNotice(args: {
  senderName: string
  ledger: BookmarkLedger
  merge: MergeResult | null
  localCorrupt: boolean
  unavailableRaw: boolean
  diyApplied: boolean
  diyRejectedReason: 'malformed' | 'oversize' | 'write-failed' | null
  appliedTheme: TransferableTheme | null
  rejectedTheme: string | null
  nothingUsable: boolean
}): { text: string; tone: NoticeTone } {
  const {
    senderName,
    ledger,
    merge,
    localCorrupt,
    unavailableRaw,
    diyApplied,
    diyRejectedReason,
    appliedTheme,
    rejectedTheme,
    nothingUsable,
  } = args
  if (localCorrupt) {
    return {
      text: `没有写入「${senderName}」的内容：${unavailableRaw ? STORAGE_UNAVAILABLE_HINT : CORRUPT_FAVORITES_HINT}`,
      tone: 'error',
    }
  }
  const problems: string[] = []
  const omitted = describeOmitted(ledger)
  if (omitted) problems.push(`包里有 ${omitted}`)
  const truncated = describeTruncation(ledger)
  if (truncated) problems.push(`且有 ${truncated}`)
  if (diyRejectedReason === 'oversize') problems.push('排版整包超长，已丢弃')
  if (diyRejectedReason === 'malformed') problems.push('排版内容不是合法 JSON，已忽略')
  if (diyRejectedReason === 'write-failed') problems.push('排版写入失败（存储不可用或配额已满）')
  if (rejectedTheme) problems.push(`对方主题「${rejectedTheme}」本机不支持，没有切换`)
  if (nothingUsable) {
    return {
      text: `「${senderName}」的快传里没有可用的内容${problems.length ? `：${problems.join('；')}` : ''}`,
      tone: 'warn',
    }
  }
  const applied: string[] = []
  if (merge && merge.added > 0) applied.push(`新增 ${merge.added} 项收藏`)
  if (merge && merge.skippedDuplicate > 0) applied.push(`${merge.skippedDuplicate} 项已存在被跳过`)
  if (diyApplied) applied.push('工作台排版已套用')
  if (appliedTheme) applied.push(`主题切到「${appliedTheme}」`)
  const head = `已接收来自「${senderName}」的跨端配置：${applied.join('、') || '没有任何内容落地'}`
  if (problems.length > 0) {
    return { text: `${head}；${problems.join('；')}`, tone: 'warn' }
  }
  return { text: head, tone: 'ok' }
}
