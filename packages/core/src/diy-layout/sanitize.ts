/**
 * 配置清洗与防御：校验并清洗外部导入的 DIY JSON 配置 (Config Sanitization)。
 *
 * 分享链接经 #diy= hash 在 URL 里传播，因此这里是不可信输入的第一道防线：
 * 体积上限、枚举白名单、URL 协议白名单、数组长度与字符串长度全部夹紧。
 *
 * 夹紧必然吃掉内容，所以这里同时记账：dropped = 被丢弃/截断的条目数，
 * notes = 逐条原因。导入方有义务把它们展示给用户，不许宣称「全量还原」。
 * 本文件与 apps/web-overlay/src/lib/modular/diy-presets.ts 里的同名实现保持同一套台账语义。
 */

export interface DIYSanitizeResult {
  valid: boolean
  config?: any
  error?: string
  /** 被白名单或上限丢弃/截断的用户内容条数 */
  dropped: number
  /** 逐条人话原因（含未计入 dropped 的枚举回退） */
  notes: string[]
}

function createLedger() {
  return {
    dropped: 0,
    notes: [] as string[],
    claim(count: number, note: string) {
      if (!(count > 0)) return
      this.dropped += count
      this.notes.push(note)
    },
    note(text: string) {
      this.notes.push(text)
    },
  };
}

type Ledger = ReturnType<typeof createLedger>

const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/** 分类/站点 id 列表：非法项与超限项分别记账 */
function cleanIdList(v: unknown, ledger: Ledger, label: string, max = 500): string[] {
  if (!Array.isArray(v)) return []
  const kept = (v as unknown[])
    .filter((x) => typeof x === 'string')
    .map((x) => String(x).slice(0, 128))
    .filter((x) => !UNSAFE_OBJECT_KEYS.has(x))
  ledger.claim(v.length - kept.length, `${label}：${v.length - kept.length} 项非法，已丢弃`)
  const out = kept.slice(0, max)
  ledger.claim(kept.length - out.length, `${label}：超出 ${max} 个上限，截断 ${kept.length - out.length} 个`)
  return out
}

export function validateAndCleanDIYConfig(raw: any): DIYSanitizeResult {
  const ledger = createLedger()
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: '导入的配置文件不是合法的 JSON 对象', dropped: 0, notes: ledger.notes }
  }
  // 长度上限：#diy= hash 分享经 URL 传播，4KB 以上拒绝（防 URL 过长与指纹滥用）
  try {
    if (JSON.stringify(raw).length > 4096) {
      return { valid: false, error: '配置过大（上限 4KB），请精简后再分享', dropped: 0, notes: ledger.notes }
    }
  } catch { return { valid: false, error: '配置序列化失败', dropped: 0, notes: ledger.notes } }

  if (typeof raw.viewMode !== 'string' && typeof raw.version !== 'number') {
    return { valid: false, error: '缺失必要的 DIY 配置元数据 (viewMode/version)', dropped: 0, notes: ledger.notes }
  }

  const validViewModes = ['hybrid', 'classic', 'workbench']
  const validCardModes = ['compact', 'standard', 'rich']
  const validCanvasBgs = ['mesh', 'dots', 'grid', 'aurora', 'clean']
  if (typeof raw.viewMode === 'string' && !validViewModes.includes(raw.viewMode)) {
    ledger.note(`视图模式「${String(raw.viewMode).slice(0, 32)}」不在支持列表，已回退 hybrid`)
  }
  if (raw.cardDisplayMode != null && !validCardModes.includes(raw.cardDisplayMode)) {
    ledger.note(`卡片样式「${String(raw.cardDisplayMode).slice(0, 32)}」不在支持列表，已回退 standard`)
  }
  if (raw.canvasBackground != null && !validCanvasBgs.includes(raw.canvasBackground)) {
    ledger.note(`画布背景「${String(raw.canvasBackground).slice(0, 32)}」不在支持列表，已回退 mesh`)
  }
  const isSafeWallpaper = (u: unknown): boolean => {
    if (typeof u !== 'string' || !u) return false;
    if (u.startsWith('/') && !u.startsWith('//')) return true;
    if (/^data:image\/(png|jpeg|webp);base64,/.test(u)) return u.length <= 4096;
    try {
      const parsed = new URL(u);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch { return false; }
  };
  const isSafeHref = (h: unknown): boolean => {
    if (typeof h !== 'string' || !h) return false;
    if (h.startsWith('/') && !h.startsWith('//')) return true;
    try {
      const parsed = new URL(h, 'https://navhub.local');
      // 相对路径已在上分支返回；此处只放行 http/https 绝对地址
      if (h.startsWith('http://') || h.startsWith('https://')) return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      return false;
    } catch { return false; }
  };
  const isSafeIcon = (ic: unknown): boolean => {
    if (typeof ic !== 'string' || !ic) return false;
    if (/^[a-zA-Z0-9_-]{1,64}$/.test(ic)) return true;
    return isSafeWallpaper(ic);
  };
  const sanitizePinnedMap = (input: unknown): Record<string, string[]> => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    const all = Object.entries(input as Record<string, unknown>)
    const entries = all.filter(([k, v]) => !UNSAFE_OBJECT_KEYS.has(k) && Array.isArray(v))
    const keptEntries = entries.slice(0, 500)
    const out: Record<string, string[]> = {};
    let droppedIds = 0
    for (const [k, v] of keptEntries) {
      const list = (v as unknown[]).filter((id) => typeof id === 'string').map((id) => id.slice(0, 128))
      droppedIds += (v as unknown[]).length - list.length
      const capped = list.slice(0, 500)
      droppedIds += list.length - capped.length
      out[k.slice(0, 128)] = capped
    }
    ledger.claim(all.length - entries.length, `分类置顶：${all.length - entries.length} 个分类键非法，已丢弃`)
    const skippedKeys = entries.length - keptEntries.length
    ledger.claim(skippedKeys, `分类置顶：超出 500 个分类上限，截断 ${skippedKeys} 个`)
    ledger.claim(droppedIds, `分类置顶：${droppedIds} 个站点 id 非法或超出 500 上限，已丢弃`)
    return out
  };
  const wallpaperRaw = raw.customWallpaperUrl
  const customWallpaperUrl = isSafeWallpaper(wallpaperRaw) ? String(wallpaperRaw).slice(0, 2048) : undefined
  if (customWallpaperUrl === undefined && typeof wallpaperRaw === 'string' && wallpaperRaw.trim()) {
    ledger.claim(1, '自定义壁纸：地址不在 http/https/相对路径/data:image 白名单，已忽略')
  }
  const overridesRaw =
    typeof raw.siteCategoryOverrides === 'object' && raw.siteCategoryOverrides !== null && !Array.isArray(raw.siteCategoryOverrides)
      ? Object.entries(raw.siteCategoryOverrides as Record<string, unknown>).filter(
          ([k, v]) => !UNSAFE_OBJECT_KEYS.has(k) && typeof k === 'string' && typeof v === 'string',
        )
      : null
  if (overridesRaw) {
    const overflow = Math.max(0, overridesRaw.length - 2000)
    ledger.claim(overflow, `站点分类重映射：超出 2000 条上限，截断 ${overflow} 条`)
  }
  const heroDeck = Array.isArray(raw.heroDeckWidgets)
    ? (raw.heroDeckWidgets as unknown[]).filter((w) => typeof w === 'string').map((w) => String(w).slice(0, 64))
    : null
  if (heroDeck) {
    const invalid = (raw.heroDeckWidgets as unknown[]).length - heroDeck.length
    ledger.claim(invalid, `首屏小组件：${invalid} 个 id 非字符串，已丢弃`)
    const overflow = Math.max(0, heroDeck.length - 32)
    ledger.claim(overflow, `首屏小组件：超出 32 个上限，截断 ${overflow} 个`)
  }
  const categoryList = Array.isArray(raw.customCategories) ? (raw.customCategories as any[]).slice(0, 100) : []
  if (Array.isArray(raw.customCategories)) {
    const overflow = (raw.customCategories as unknown[]).length - categoryList.length
    ledger.claim(overflow, `自定义分类：超出 100 个上限，截断 ${overflow} 个`)
  }
  const customCategories = categoryList.map((c: any) => {
    const rawItems = Array.isArray(c?.items) ? (c.items as any[]) : []
    let unsafeItems = 0
    const mapped = rawItems
      .map((i: any) => {
        const ok = isSafeHref(i?.href)
        if (!ok) {
          unsafeItems += 1
          return null
        }
        return {
          id: String(i?.id || `item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
          title: String(i?.title || '').slice(0, 200),
          href: String(i.href).slice(0, 2048),
          icon: isSafeIcon(i?.icon) ? String(i.icon).slice(0, 2048) : undefined,
          description: i?.description ? String(i.description).slice(0, 1000) : undefined,
        }
      })
      .filter(Boolean)
    ledger.claim(unsafeItems, `自定义分类站点：${unsafeItems} 条链接协议不安全，已丢弃`)
    const capped = mapped.slice(0, 500)
    ledger.claim(mapped.length - capped.length, `自定义分类站点：单个分类超出 500 条上限，截断 ${mapped.length - capped.length} 条`)
    return {
      id: String(c?.id || `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
      title: String(c?.title || '自定义分类').slice(0, 64),
      icon: String(c?.icon || 'FolderHeart').slice(0, 64),
      items: capped,
      createdAt: Number(c?.createdAt) || Date.now(),
    }
  })

  const cleaned = {
    version: 3,
    viewMode: validViewModes.includes(raw.viewMode) ? raw.viewMode : 'hybrid',
    cardDisplayMode: validCardModes.includes(raw.cardDisplayMode) ? raw.cardDisplayMode : 'standard',
    canvasBackground: validCanvasBgs.includes(raw.canvasBackground) ? raw.canvasBackground : 'mesh',
    accentColor: typeof raw.accentColor === 'string' ? raw.accentColor.slice(0, 64) : 'default',
    customWallpaperUrl,
    glassmorphismBlur: Number.isFinite(Number(raw.glassmorphismBlur)) ? Math.max(0, Math.min(30, Number(raw.glassmorphismBlur))) : undefined,
    cardOpacity: Number.isFinite(Number(raw.cardOpacity)) ? Math.max(0.2, Math.min(1, Number(raw.cardOpacity))) : undefined,
    siteCategoryOverrides: overridesRaw
      ? Object.fromEntries(overridesRaw.slice(0, 2000) as [string, string][])
      : undefined,
    heroDeckCollapsed: Boolean(raw.heroDeckCollapsed),
    heroDeckWidgets: heroDeck ? heroDeck.slice(0, 32) : ['quick-search', 'clock-pomodoro', 'favorites-dock', 'quick-tools'],
    categoryOrder: cleanIdList(raw.categoryOrder, ledger, '分类顺序'),
    pinnedCategoryIds: cleanIdList(raw.pinnedCategoryIds, ledger, '置顶分类'),
    hiddenCategoryIds: cleanIdList(raw.hiddenCategoryIds, ledger, '隐藏分类'),
    collapsedCategoryIds: cleanIdList(raw.collapsedCategoryIds, ledger, '折叠分类'),
    pinnedSiteIdsByCategory: sanitizePinnedMap(raw.pinnedSiteIdsByCategory),
    customCategories,
    updatedAt: Date.now(),
  }

  return { valid: true, config: cleaned, dropped: ledger.dropped, notes: ledger.notes }
}
