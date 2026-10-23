/**
 * 配置清洗与防御：校验并清洗外部导入的 DIY JSON 配置 (Config Sanitization)。
 *
 * 分享链接经 #diy= hash 在 URL 里传播，因此这里是不可信输入的第一道防线：
 * 体积上限、枚举白名单、URL 协议白名单、数组长度与字符串长度全部夹紧。
 */

export function validateAndCleanDIYConfig(raw: any): { valid: boolean; config?: any; error?: string } {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: '导入的配置文件不是合法的 JSON 对象' }
  }
  // 长度上限：#diy= hash 分享经 URL 传播，4KB 以上拒绝（防 URL 过长与指纹滥用）
  try {
    if (JSON.stringify(raw).length > 4096) return { valid: false, error: '配置过大（上限 4KB），请精简后再分享' };
  } catch { return { valid: false, error: '配置序列化失败' }; }

  if (typeof raw.viewMode !== 'string' && typeof raw.version !== 'number') {
    return { valid: false, error: '缺失必要的 DIY 配置元数据 (viewMode/version)' }
  }

  const validViewModes = ['hybrid', 'classic', 'workbench']
  const validCardModes = ['compact', 'standard', 'rich']
  const validCanvasBgs = ['mesh', 'dots', 'grid', 'aurora', 'clean']
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
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>).slice(0, 500)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      if (typeof k === 'string' && Array.isArray(v)) {
        out[k.slice(0, 128)] = v
          .filter((id): id is string => typeof id === 'string')
          .map((id) => id.slice(0, 128))
          .slice(0, 500);
      }
    }
    return out;
  };

  const cleaned = {
    version: 3,
    viewMode: validViewModes.includes(raw.viewMode) ? raw.viewMode : 'hybrid',
    cardDisplayMode: validCardModes.includes(raw.cardDisplayMode) ? raw.cardDisplayMode : 'standard',
    canvasBackground: validCanvasBgs.includes(raw.canvasBackground) ? raw.canvasBackground : 'mesh',
    accentColor: typeof raw.accentColor === 'string' ? raw.accentColor.slice(0, 64) : 'default',
    customWallpaperUrl: isSafeWallpaper(raw.customWallpaperUrl) ? String(raw.customWallpaperUrl).slice(0, 2048) : undefined,
    glassmorphismBlur: Number.isFinite(Number(raw.glassmorphismBlur)) ? Math.max(0, Math.min(30, Number(raw.glassmorphismBlur))) : undefined,
    cardOpacity: Number.isFinite(Number(raw.cardOpacity)) ? Math.max(0.2, Math.min(1, Number(raw.cardOpacity))) : undefined,
    siteCategoryOverrides: typeof raw.siteCategoryOverrides === 'object' && raw.siteCategoryOverrides !== null && !Array.isArray(raw.siteCategoryOverrides)
      ? Object.fromEntries(
          Object.entries(raw.siteCategoryOverrides as Record<string, unknown>)
            .filter(([k, v]) => k !== '__proto__' && k !== 'constructor' && k !== 'prototype' && typeof k === 'string' && typeof v === 'string')
            .slice(0, 2000)
        )
      : undefined,
    heroDeckCollapsed: Boolean(raw.heroDeckCollapsed),
    heroDeckWidgets: Array.isArray(raw.heroDeckWidgets) ? (raw.heroDeckWidgets as unknown[]).filter((w) => typeof w === 'string').map((w) => String(w).slice(0, 64)).slice(0, 32) : ['quick-search', 'clock-pomodoro', 'favorites-dock', 'quick-tools'],
    categoryOrder: Array.isArray(raw.categoryOrder) ? (raw.categoryOrder as unknown[]).filter((x) => typeof x === 'string').map(String).slice(0, 500) : [],
    pinnedCategoryIds: Array.isArray(raw.pinnedCategoryIds) ? (raw.pinnedCategoryIds as unknown[]).filter((x) => typeof x === 'string').map(String).slice(0, 500) : [],
    hiddenCategoryIds: Array.isArray(raw.hiddenCategoryIds) ? (raw.hiddenCategoryIds as unknown[]).filter((x) => typeof x === 'string').map(String).slice(0, 500) : [],
    collapsedCategoryIds: Array.isArray(raw.collapsedCategoryIds) ? (raw.collapsedCategoryIds as unknown[]).filter((x) => typeof x === 'string').map(String).slice(0, 500) : [],
    pinnedSiteIdsByCategory: sanitizePinnedMap(raw.pinnedSiteIdsByCategory),
    customCategories: Array.isArray(raw.customCategories)
      ? raw.customCategories.map((c: any) => ({
          id: String(c.id || `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
          title: String(c.title || '自定义分类').slice(0, 64),
          icon: String(c.icon || 'FolderHeart').slice(0, 64),
          items: Array.isArray(c.items)
            ? c.items.map((i: any) => ({
                id: String(i.id || `item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
                title: String(i.title || '').slice(0, 200),
                href: isSafeHref(i.href) ? String(i.href).slice(0, 2048) : '',
                icon: isSafeIcon(i.icon) ? String(i.icon).slice(0, 2048) : undefined,
                description: i.description ? String(i.description).slice(0, 1000) : undefined,
              })).filter((it: { href: string }) => Boolean(it.href)).slice(0, 500)
            : [],
          createdAt: Number(c.createdAt) || Date.now(),
        })).slice(0, 100)
      : [],
    updatedAt: Date.now(),
  }

  return { valid: true, config: cleaned }
}
