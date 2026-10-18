'use client'

import { useState, useRef, useEffect } from 'react'
import { Input } from '@/registry/new-york/ui/input'
import { Command, CommandList, CommandGroup, CommandItem } from '@/registry/new-york/ui/command'
import { Search, X } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { highlightParts } from '@/lib/highlight'
import type { NavigationData, NavigationItem, NavigationSubItem } from '@/types/navigation'
import type { SiteConfig } from '@/types/site'
import { safeHref, isSafeHttpUrl } from '@/lib/safe-url'

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

export function SearchBar({ onSearch, searchResults, searchQuery, siteConfig }: SearchBarProps) {
  const [isFocused, setIsFocused] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsFocused(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsFocused(false)
        inputRef.current?.blur()
      }
      
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
        setIsFocused(true)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const renderBadges = (channels?: string[]) => {
    if (!channels || channels.length === 0) return null
    return (
      <div className="flex items-center gap-1 flex-shrink-0">
        {channels.includes('semantic') && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-700 dark:text-purple-300 font-medium leading-none border border-purple-500/20">语义</span>
        )}
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
      const linkTarget = siteConfig?.navigation?.linkTarget || '_blank'
      if (linkTarget === '_self') {
        window.location.href = href
      } else {
        window.open(href, linkTarget, 'noopener,noreferrer')
      }
    }
    onSearch('')
    setIsFocused(false)
  }

  const clearSearch = () => {
    onSearch('')
    setIsFocused(false)
    inputRef.current?.focus()
  }

  const showResults = isFocused && searchQuery.trim().length > 0

  return (
    <div ref={searchRef} className="relative w-full max-w-lg mx-auto">
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground/80" />
        <Input
          ref={inputRef}
          type="search"
          aria-label="搜索导航"
          placeholder="搜索导航 (按 ⌘K 或 Ctrl+K 快速定位)..."
          value={searchQuery}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          className="pl-10 pr-20 h-10 sm:h-11 rounded-xl border-border/80 shadow-xs focus:shadow-md bg-background/80 backdrop-blur-xs transition-all duration-200"
        />
        <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-1">
          {searchQuery && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSearch}
              aria-label="清空搜索"
              className="h-6 w-6 p-0 hover:bg-muted rounded-full"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
          <kbd className="hidden h-5 select-none items-center gap-0.5 rounded-md border border-border/60 bg-muted/70 px-1.5 font-mono text-xs text-muted-foreground opacity-100 sm:flex">
            <span>⌘</span>K
          </kbd>
        </div>
      </div>

      {showResults && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-background/95 backdrop-blur-md border border-border/80 rounded-xl shadow-2xl z-50 max-h-[70vh] overflow-hidden">
          <Command className="border-0 shadow-none">
            <CommandList className="max-h-[70vh] overflow-y-auto">
              {searchResults.length === 0 ? (
                <div className="py-8 text-center">
                  <div className="text-muted-foreground text-sm">
                    未找到与 &ldquo;<span className="font-medium">{searchQuery}</span>&rdquo; 相关的导航
                  </div>
                  <div className="text-xs text-muted-foreground/70 mt-1">
                    尝试使用不同的关键词搜索
                  </div>
                  {/* 空结果不能是死路：给一个明确的「回到完整列表」出口 */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={clearSearch}
                  >
                    清空搜索，查看全部导航
                  </Button>
                </div>
              ) : (
                searchResults.map((result) => (
                  <CommandGroup key={result.category.id} heading={result.category.title}>
                    {result.items.map((item) => (
                      <CommandItem
                        key={item.id}
                        value={item.title}
                        onSelect={() => handleItemSelect(item)}
                        className="flex items-center gap-3 py-3 px-3 cursor-pointer hover:bg-accent/50"
                      >
                        <div className="flex-shrink-0 w-8 h-8">
                          {item.icon && (
                            <img
                              src={item.icon}
                              alt={`${item.title} icon`}
                              loading="lazy"
                              decoding="async"
                              className="w-full h-full object-contain rounded"
                              onError={(e) => {
                                const target = e.target as HTMLImageElement
                                target.style.display = 'none'
                              }}
                            />
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
                    ))}
                    {result.subCategories.map((sub) => (
                      <div key={sub.title}>
                        <div className="px-3 py-2 text-xs font-medium text-muted-foreground bg-muted/30 border-b">
                          {result.category.title} / {sub.title}
                        </div>
                        {sub.items.map((item) => (
                          <CommandItem
                            key={item.id}
                            value={item.title}
                            onSelect={() => handleItemSelect(item)}
                            className="flex items-center gap-3 py-3 px-3 cursor-pointer hover:bg-accent/50"
                          >
                            <div className="flex-shrink-0 w-8 h-8">
                              {item.icon && (
                                <img
                                  src={item.icon}
                                  alt={`${item.title} icon`}
                                  loading="lazy"
                                  decoding="async"
                                  className="w-full h-full object-contain rounded"
                                  onError={(e) => {
                                    const target = e.target as HTMLImageElement
                                    target.style.display = 'none'
                                  }}
                                />
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
                        ))}
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