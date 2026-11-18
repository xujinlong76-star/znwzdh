'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { Input } from '@/registry/new-york/ui/input'
import { Command, CommandList, CommandGroup, CommandItem } from '@/registry/new-york/ui/command'
import { Search, X, ExternalLink } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { highlightParts } from '@/lib/highlight'
import { SiteFavicon, isRemoteRawFavicon } from '@/components/site-favicon'
import type { NavigationData, NavigationItem, NavigationSubItem } from '@/types/navigation'
import type { SiteConfig } from '@/types/site'
import { isSafeHttpUrl, safeHref, safeWindowOpen } from '@/lib/safe-url'
import { matchSearchShortcut, getAllSearchEngines } from '@/lib/plugins/search-pack-runtime'
import {
  matchQuicklinkCommand,
  quicklinkFromFavorite,
  toSearchEngines,
  type QuicklinkEntry,
} from '@/lib/quicklinks'
import { useFavorites } from '@/hooks/useFavorites'
import { useToast } from '@/components/ui/use-toast'
import { getIdentity } from '@/lib/identity'
import { recordOfflineVisit } from '@/lib/offline-recent'
import { reportClick } from '@/lib/navhub-api'
import { useExternalLinkTarget } from '@/lib/user-preferences'

interface SearchBarProps {
  navigationData: NavigationData
  onSearch: (query: string) => void
  searchResults: Array<{
    category: NavigationItem
    items: (NavigationItem | NavigationSubItem)[]
    subCategories: Array<{
      title: string
      items: (NavigationItem | NavigationSubItem)[]
    }>
  }>
  searchQuery: string
  siteConfig?: SiteConfig
}

/** 结果项的链接：一级导航项没有 href，不能直接读 item.url（该字段不存在）。 */
function itemHref(item: NavigationItem | NavigationSubItem): string | undefined {
  return 'href' in item && typeof item.href === 'string' ? item.href : undefined
}

export function SearchBar({ navigationData, onSearch, searchResults, searchQuery, siteConfig }: SearchBarProps) {
  const [isFocused, setIsFocused] = useState(false)
  // combobox 键盘导航：焦点留在 Input，用 activeIndex + aria-activedescendant 告知读屏，
  // 与 search-palette 的处理同源。cmdk 自己的方向键导航在焦点位于兄弟节点 Input 时不生效，
  // 因此这里手动维护高亮。
  const [activeIndex, setActiveIndex] = useState(-1)
  const searchRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const resultsPanelRef = useRef<HTMLDivElement>(null)
  // 站点配置只是默认值：用户中心的「新标签页打开站点」开关决定最终打开方式
  const linkTarget = useExternalLinkTarget(siteConfig?.navigation?.linkTarget)
  const favorites = useFavorites()
  const { toast } = useToast()
  const identity = useMemo(() => getIdentity(), [])

  /** 与渲染顺序一致的扁平结果列表（先普通项，再各子分类项），供方向键线性导航 */
  const { flatItems, indexById } = useMemo(() => {
    const flat: Array<NavigationItem | NavigationSubItem> = []
    const map = new Map<string, number>()
    for (const result of searchResults) {
      for (const item of result.items) { map.set(item.id, flat.length); flat.push(item) }
      for (const sub of result.subCategories) {
        for (const item of sub.items) { map.set(item.id, flat.length); flat.push(item) }
      }
    }
    return { flatItems: flat, indexById: map }
  }, [searchResults])

  useEffect(() => { setActiveIndex(-1) }, [searchQuery])

  useEffect(() => {
    if (activeIndex < 0) return
    resultsPanelRef.current?.querySelector<HTMLElement>(`[data-nav-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsFocused(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 呼出键（⌘K / 「/」）由 SpotlightModal 一处处理：这里是 /videos 的内联筛选框，
  // 再挂一个 keydown 只会与弹窗抢同一次按键（详见 search-palette 的同名注释）。
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (document.activeElement !== inputRef.current) return
      setIsFocused(false)
      inputRef.current?.blur()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const renderBadges = (channels?: string[]) => {
    if (!channels || channels.length === 0) return null
    return (
      <div className="flex items-center gap-1 flex-shrink-0">
        {channels.includes('pinyin') && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-700 dark:text-blue-300 font-medium leading-none border border-blue-500/20">拼音</span>
        )}
        {channels.includes('fts') && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-medium leading-none border border-emerald-500/20">全文</span>
        )}
        {channels.includes('exact') && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 font-medium leading-none border border-amber-500/20">精确</span>
        )}
      </div>
    )
  }

  const highlightText = (text: string) => {
    if (!searchQuery) return text
    // 用 @/lib/highlight 的安全实现，替换上游的 `new RegExp(query)`：
    //  1) 原实现把查询原样塞进正则，输入 `(` `[` `\` `+` 等元字符会在**渲染期**
    //     抛 SyntaxError，整页白屏（/videos 没有错误边界兜底）。
    //  2) 原实现把整串查询当一个 token，输入 "react vue" 就不会高亮任何单词。
    // highlightParts 逐 token 转义、按空白切分，且失败时降级为不高亮，不阻断渲染。
    return highlightParts(text, searchQuery).map((seg, i) =>
      seg.hit ? (
        <span key={i} className="text-primary font-semibold underline decoration-primary/40 underline-offset-2 bg-primary/10 px-0.5 rounded-xs">
          {seg.text}
        </span>
      ) : (
        seg.text
      ),
    )
  }

  const handleInputChange = (value: string) => {
    onSearch(value)
    setIsFocused(true)
  }

  const handleItemSelect = (item: NavigationItem | NavigationSubItem) => {
    const itemWithHref = item as NavigationSubItem
    // href 来自可编辑的导航配置（后台能写），必须过安全闸：
    // 直接 window.location.href 赋值会让 javascript: 这种脏数据原样执行。
    // 与 navigation-card 的处理保持一致（那里早就用了 safeHref）。
    const href = safeHref(itemWithHref.href, '')
    if (href && isSafeHttpUrl(href)) {
      if (linkTarget === '_self') {
        // 用 assign 而非给 location.href 赋值：渲染期对宿主对象赋值会被
        // react-hooks/immutability 判为修改外部值，语义等价但更明确。
        window.location.assign(href)
      } else {
        window.open(href, linkTarget, 'noopener,noreferrer')
      }
    }
    // 查询词要保留：新标签页打开后用户回来还能在原查询上继续挑下一条，
    // 而不是被迫重打一遍（research #2）。面板只收起；清空仍由 × 按钮显式做。
    setIsFocused(false)
  }

  /**
   * 零结果救援（research #2）：按收录量取前 5 个一级分类，点一下就拿分类名
   * 当查询词再搜一次——比干巴巴的「换个词」多一个真出口。分类名本身也是
   * 站内检索的关键词（标题/简介里常见），通常能直接出结果。
   */
  const relatedCategories = useMemo(
    () =>
      navigationData.navigationItems
        .map((cat) => ({
          title: cat.title,
          count:
            (cat.items?.length ?? 0) +
            (cat.subCategories ?? []).reduce((n, sub) => n + (sub.items?.length ?? 0), 0),
        }))
        .filter((c) => c.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
    [navigationData],
  )

  const clearSearch = () => {
    onSearch('')
    setIsFocused(false)
    inputRef.current?.focus()
  }

  const showResults = isFocused && searchQuery.trim().length > 0
  /**
   * 参数化快捷链接：用户自建的 search-pack 引擎排在内置引擎之前
   *（toSearchEngines：同前缀覆盖内置），`!gh x` 走 matchSearchShortcut
   * 的合并列表；裸 `gh x`（matchSearchShortcut 不认）走
   * matchQuicklinkCommand——两条路都命中时以前者为准，优先级
   * quicklink > OMNI 硬编码引擎 > 导航首条。
   */
  const quicklinkEntries = useMemo(
    () =>
      favorites.items
        .map((fav) => quicklinkFromFavorite(fav))
        .filter((e): e is QuicklinkEntry => e !== null),
    [favorites.items],
  )
  const mergedEngines = useMemo(
    () => toSearchEngines(quicklinkEntries, getAllSearchEngines()),
    [quicklinkEntries],
  )
  const matchedShortcut = useMemo(
    () => matchSearchShortcut(searchQuery, mergedEngines),
    [searchQuery, mergedEngines],
  )
  const quicklinkMatch = useMemo(
    () => matchQuicklinkCommand(searchQuery, quicklinkEntries),
    [searchQuery, quicklinkEntries],
  )
  /**
   * 横幅与回车的唯一口径：quicklink 命中时用它，否则用合并引擎的命中。
   * 前缀命中但代入失败（quicklinkMatch 非空、url 为 null）时 displayShortcut
   * 必须为 null，绝不能回落到 matchedShortcut——合并引擎列表里的同一条
   * 模板会被 matchSearchShortcut 无上限代入，是绕过 500 字符上限的第二入口。
   */
  const quicklinkBanner =
    quicklinkMatch?.url != null
      ? {
          prefix: `!${quicklinkMatch.entry.quickPrefix}`,
          engineName: quicklinkMatch.entry.title,
          keyword: quicklinkMatch.arg,
          directUrl: quicklinkMatch.url,
          entry: quicklinkMatch.entry,
          arg: quicklinkMatch.arg,
        }
      : null
  const displayShortcut =
    quicklinkMatch != null
      ? quicklinkBanner
      : matchedShortcut.matched && matchedShortcut.engine && matchedShortcut.directUrl
        ? {
            prefix: matchedShortcut.prefix ?? '',
            engineName: matchedShortcut.engine.name,
            keyword: matchedShortcut.keyword ?? '',
            directUrl: matchedShortcut.directUrl,
          }
        : null
  /** 前缀命中但代入失败（参数超 500 字符 / 模板已不安全）：拦截态 */
  const quicklinkBlocked = quicklinkMatch != null && quicklinkMatch.url == null
  /** 拦截态的唯一出口：toast、不开页、不 clearSearch、不落回正常搜索 */
  const toastQuicklinkBlocked = () => {
    toast({
      title: '快捷链接打不开',
      description: '参数超过 500 字符或模板不安全，已拦截。',
      variant: 'destructive',
    })
  }

  const openQuicklink = () => {
    if (!quicklinkBanner) return false
    // 打开后记账与收藏打开同口径：离线记录 + 点击上报（带参数）+ 重温计时
    recordOfflineVisit({
      id: quicklinkBanner.entry.siteId,
      title: quicklinkBanner.entry.title,
      href: quicklinkBanner.entry.href,
      icon: quicklinkBanner.entry.icon ?? null,
    })
    reportClick(quicklinkBanner.entry.siteId, identity, { query: quicklinkBanner.arg })
    favorites.recordOpened(quicklinkBanner.entry.siteId)
    safeWindowOpen(quicklinkBanner.directUrl)
    clearSearch()
    return true
  }

  return (
    <div ref={searchRef} className="relative w-full max-w-lg mx-auto">
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          type="search"
          aria-label="搜索导航"
          role="combobox"
          aria-expanded={showResults}
          aria-autocomplete="list"
          aria-controls={showResults ? 'navhub-search-bar-results' : undefined}
          aria-activedescendant={
            showResults && activeIndex >= 0 && flatItems[activeIndex]
              ? `navhub-search-bar-opt-${activeIndex}` : undefined
          }
          placeholder="搜索导航 (支持 !gh, !npm, !mdn 直达)..."
          value={searchQuery}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onKeyDown={(e) => {
            // 方向键在扁平结果中线性移动高亮；焦点始终在 Input，靠 aria-activedescendant 同步读屏。
            if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && showResults && flatItems.length > 0) {
              e.preventDefault()
              setActiveIndex((prev) => {
                if (e.key === 'ArrowDown') return prev < 0 ? 0 : (prev + 1) % flatItems.length
                return prev <= 0 ? flatItems.length - 1 : prev - 1
              })
              return
            }
            // 有高亮项时回车打开它（优先于 quicklink 直达，符合 combobox 惯例）
            if (e.key === 'Enter' && activeIndex >= 0 && flatItems[activeIndex]) {
              e.preventDefault()
              handleItemSelect(flatItems[activeIndex])
              setActiveIndex(-1)
              return
            }
            if (e.key === 'Enter' && quicklinkBlocked) {
              e.preventDefault()
              toastQuicklinkBlocked()
              return
            }
            if (e.key === 'Enter' && displayShortcut?.directUrl) {
              e.preventDefault()
              if (quicklinkBanner) openQuicklink()
              else {
                // 非 quicklink 分支：displayShortcut 就是 matchedShortcut 的直通
                // （构造时 directUrl 原样取自 matchedShortcut.directUrl），
                // 这里直接用 matchedShortcut 的口径经安全闸打开；500 字符拦截门
                // 在上方 quicklinkBlocked 分支已先行，不会落到这里。
                safeWindowOpen(matchedShortcut.directUrl)
                clearSearch()
              }
            }
          }}
          className="pl-10 pr-20 h-11 rounded-xl border-border/80 shadow-xs focus:shadow-md bg-background/80 backdrop-blur-xs transition-all duration-200"
        />
        <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-1">
          {searchQuery && (
            // 清空 × 只有 24px：视觉保持小圆钮，::after 把点击区无形扩到 44px
            // （输入框只有 44px 高，扩出去的部分正好贴合框边，不遮挡输入文字）
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSearch}
              aria-label="清空搜索"
              className="relative h-6 w-6 p-0 hover:bg-muted rounded-full after:absolute after:-inset-2.5 after:content-['']"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
          <kbd className="hidden h-5 select-none items-center gap-0.5 rounded-md border border-border/60 bg-muted/70 px-1.5 font-mono text-xs text-muted-foreground opacity-100 sm:flex sm:pointer-coarse:hidden">
            <span>⌘</span>K
          </kbd>
        </div>
      </div>

      {showResults && (
        <div ref={resultsPanelRef} id="navhub-search-bar-results" role="listbox" className="absolute top-full left-0 right-0 mt-2 bg-background/95 backdrop-blur-md border border-border/80 rounded-xl shadow-2xl z-50 max-h-[70vh] overflow-hidden">
          {displayShortcut && (
            <div className="p-2 border-b border-border/70 bg-primary/5">
              <button
                type="button"
                onClick={() => {
                  if (quicklinkBlocked) {
                    toastQuicklinkBlocked()
                    return
                  }
                  if (quicklinkBanner) openQuicklink()
                  else {
                    // 同回车分支：非 quicklink 时 displayShortcut 即 matchedShortcut，
                    // 直接用 matchedShortcut 的口径经安全闸打开；拦截门在上方已先行。
                    safeWindowOpen(matchedShortcut.directUrl)
                    clearSearch()
                  }
                }}
                className="w-full min-h-11 text-left flex items-center justify-between p-2.5 rounded-lg bg-background hover:bg-muted/80 border border-primary/20 hover:border-primary/40 cursor-pointer shadow-xs transition-all group"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-primary text-primary-foreground">
                    {displayShortcut.prefix}
                  </span>
                  <div className="text-xs sm:text-sm text-foreground truncate">
                    <span>在 </span>
                    <strong className="text-primary">{displayShortcut.engineName}</strong>
                    <span> 搜索：</span>
                    <span className="font-semibold text-primary underline decoration-primary/40">
                      {displayShortcut.keyword ? `"${displayShortcut.keyword}"` : '(全部)'}
                    </span>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0 font-medium group-hover:text-foreground">
                  回车直达 <ExternalLink className="w-3 h-3 text-primary" />
                </span>
              </button>
            </div>
          )}
          <Command className="border-0 shadow-none">
            <CommandList className="max-h-[70vh] overflow-y-auto">
              {searchResults.length === 0 ? (
                <div className="py-8 text-center px-4">
                  <div className="text-muted-foreground text-sm">
                    未找到与 &ldquo;<span className="font-medium">{searchQuery}</span>&rdquo; 相关的导航
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    尝试使用不同的关键词搜索
                  </div>
                  {/* 零结果救援：相关分类 chips——点一下拿分类名当查询词再搜一次，
                      再不行才是清空回全部列表 */}
                  {relatedCategories.length > 0 && (
                    <div className="mt-4">
                      <div className="text-xs text-muted-foreground mb-2">试试这些分类</div>
                      <div className="flex flex-wrap justify-center gap-1.5">
                        {relatedCategories.map((cat) => (
                          <button
                            key={cat.title}
                            type="button"
                            onClick={() => handleInputChange(cat.title)}
                            className="inline-flex min-h-11 items-center justify-center px-3.5 py-2 text-xs rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                          >
                            {cat.title}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* 空结果不能是死路：给一个明确的「回到完整列表」出口 */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 min-h-11"
                    onClick={clearSearch}
                  >
                    清空搜索，查看全部导航
                  </Button>
                </div>
              ) : (
                searchResults.map((result) => (
                  <CommandGroup key={result.category.id} heading={result.category.title}>
                    {result.items.map((item) => {
                      const idx = indexById.get(item.id) ?? -1
                      const active = idx === activeIndex
                      return (
                      <CommandItem
                        key={item.id}
                        id={`navhub-search-bar-opt-${idx}`}
                        data-nav-index={idx}
                        role="option"
                        aria-selected={active}
                        value={item.title}
                        onSelect={() => handleItemSelect(item)}
                        className={`flex items-center gap-3 py-3 px-3 cursor-pointer hover:bg-accent/50 ${active ? 'bg-accent text-accent-foreground' : ''}`}
                      >
                        <div className="flex-shrink-0 w-8 h-8">
                          {item.icon && !isRemoteRawFavicon(item.icon) ? (
                            <img
                              src={item.icon}
                              alt={`${item.title} icon`}
                              loading="lazy"
                              decoding="async"
                              width={32}
                              height={32}
                              className="w-full h-full object-contain rounded"
                              onError={(e) => {
                                const target = e.target as HTMLImageElement
                                target.style.display = 'none'
                              }}
                            />
                          ) : (
                            <SiteFavicon title={item.title} url={itemHref(item)} icon={item.icon} className="w-8 h-8 rounded" />
                          )}
                        </div>
                        <div className="flex flex-col flex-1 gap-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium truncate">
                              {highlightText(item.title)}
                            </span>
                            {renderBadges((item as any).matchedChannels)}
                          </div>
                          {item.description && (
                            <span className="text-xs text-muted-foreground line-clamp-1">
                              {highlightText(item.description)}
                            </span>
                          )}
                        </div>
                      </CommandItem>
                      )
                    })}
                    {result.subCategories.map((sub) => (
                      <div key={sub.title}>
                        <div className="px-3 py-2 text-xs font-medium text-muted-foreground bg-muted/30 border-b">
                          {result.category.title} / {sub.title}
                        </div>
                        {sub.items.map((item) => {
                          const idx = indexById.get(item.id) ?? -1
                          const active = idx === activeIndex
                          return (
                          <CommandItem
                            key={item.id}
                            id={`navhub-search-bar-opt-${idx}`}
                            data-nav-index={idx}
                            role="option"
                            aria-selected={active}
                            value={item.title}
                            onSelect={() => handleItemSelect(item)}
                            className={`flex items-center gap-3 py-3 px-3 cursor-pointer hover:bg-accent/50 ${active ? 'bg-accent text-accent-foreground' : ''}`}
                          >
                            <div className="flex-shrink-0 w-8 h-8">
                              {item.icon && !isRemoteRawFavicon(item.icon) ? (
                                <img
                                  src={item.icon}
                                  alt={`${item.title} icon`}
                                  loading="lazy"
                                  decoding="async"
                                  width={32}
                                  height={32}
                                  className="w-full h-full object-contain rounded"
                                  onError={(e) => {
                                    const target = e.target as HTMLImageElement
                                    target.style.display = 'none'
                                  }}
                                />
                              ) : (
                                <SiteFavicon title={item.title} url={itemHref(item)} icon={item.icon} className="w-8 h-8 rounded" />
                              )}
                            </div>
                            <div className="flex flex-col flex-1 gap-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-medium truncate">
                                  {highlightText(item.title)}
                                </span>
                                {renderBadges((item as any).matchedChannels)}
                              </div>
                              {item.description && (
                                <span className="text-xs text-muted-foreground line-clamp-1">
                                  {highlightText(item.description)}
                                </span>
                              )}
                            </div>
                          </CommandItem>
                          )
                        })}
                      </div>
                    ))}
                  </CommandGroup>
                ))
              )}
            </CommandList>
          </Command>
        </div>
      )}
    </div>
  )
}